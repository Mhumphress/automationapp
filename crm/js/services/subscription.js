import { db, auth } from '../config.js';
import {
  collection, doc, getDoc, addDoc, updateDoc, serverTimestamp, Timestamp,
  runTransaction
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getPackage } from './catalog.js';
import { createRootInvoiceMirror } from './invoice-sync.js';
import { recordEvent, EVENT_TYPES } from './subscription-events.js';

function snapshotTenantState(tenant) {
  if (!tenant) return null;
  return {
    packageId:     tenant.packageId || null,
    tier:          tenant.tier || null,
    basePrice:     tenant.basePrice != null ? Number(tenant.basePrice) : null,
    priceOverride: tenant.priceOverride != null ? Number(tenant.priceOverride) : null,
    addOns:        Array.isArray(tenant.addOns) ? tenant.addOns.map(a => ({ ...a })) : [],
    billingCycle:  tenant.billingCycle || 'monthly',
    status:        tenant.status || 'active',
    extraUsers:    Number(tenant.extraUsers) || 0,
  };
}

async function mirrorToCrmInvoices(tenantId, tenantInvoiceId, tenantInvoiceData) {
  try {
    const tSnap = await getDoc(doc(db, 'tenants', tenantId));
    const tenant = tSnap.exists() ? tSnap.data() : {};
    const crmId = await createRootInvoiceMirror({
      tenantId,
      tenantInvoiceId,
      tenantName: tenant.companyName || '',
      contactId: tenant.contactId || '',
      invoiceNumber: tenantInvoiceData.invoiceNumber,
      total: tenantInvoiceData.total,
      status: tenantInvoiceData.status || 'sent',
      lineItems: tenantInvoiceData.lineItems || [],
      notes: tenantInvoiceData.reason || '',
      type: tenantInvoiceData.type || 'charge',
      reason: tenantInvoiceData.reason || '',
    });
    // Link back from tenant invoice
    if (crmId) {
      try {
        await updateDoc(doc(db, `tenants/${tenantId}/invoices/${tenantInvoiceId}`), { crmInvoiceId: crmId });
      } catch {}
    }
    return crmId;
  } catch (err) {
    console.warn('CRM invoice mirror failed:', err);
    return null;
  }
}

// ── Proration ────────────────────────────────────────────

export function prorationRatio(currentPeriodStart, currentPeriodEnd, now = Date.now()) {
  const start = toMs(currentPeriodStart);
  const end = toMs(currentPeriodEnd);
  if (!start || !end || end <= start) return 0;
  const daysInPeriod = Math.max(1, (end - start) / 86400000);
  const daysRemaining = Math.max(0, (end - now) / 86400000);
  return Math.min(1, Math.max(0, daysRemaining / daysInPeriod));
}

function toMs(ts) {
  if (!ts) return 0;
  if (ts.toDate) return ts.toDate().getTime();
  if (ts instanceof Date) return ts.getTime();
  return Number(ts) || 0;
}

function round2(n) { return Math.round(n * 100) / 100; }

// ── Implementation fee lookup ────────────────────────────

async function getImplementationFee() {
  const snap = await getDoc(doc(db, 'settings', 'billing'));
  if (!snap.exists()) return 25;
  const v = snap.data().addOnImplementationFee;
  return typeof v === 'number' ? v : 25;
}

// ── Actions ──────────────────────────────────────────────

/**
 * Preview the math for adding an add-on. Returns {prorated, implementationFee, total}
 */
export function previewAddAddOn(tenant, addon) {
  const ratio = prorationRatio(tenant.currentPeriodStart, tenant.currentPeriodEnd);
  const monthlyPrice = (addon.priceMonthly || 0) * (addon.qty || 1);
  const prorated = round2(monthlyPrice * ratio);
  return { ratio, monthlyPrice, prorated };
}

export async function addAddOn(tenantId, addon) {
  const user = auth.currentUser;
  const tenantRef = doc(db, 'tenants', tenantId);
  const tenantSnap = await getDoc(tenantRef);
  if (!tenantSnap.exists()) throw new Error('Tenant not found');
  const tenant = tenantSnap.data();

  const fee = await getImplementationFee();
  const { ratio, monthlyPrice, prorated } = previewAddAddOn(tenant, addon);

  const lineItems = [];
  if (prorated > 0) {
    lineItems.push({
      description: `${addon.name} (prorated: ${(ratio * 100).toFixed(1)}% of billing period)`,
      quantity: 1, rate: prorated, amount: prorated,
    });
  }
  if (fee > 0) {
    lineItems.push({
      description: 'Add-on implementation fee',
      quantity: 1, rate: fee, amount: fee,
    });
  }
  const total = lineItems.reduce((s, l) => s + l.amount, 0);

  // Write: update tenant addOns + write invoice + log activity
  const newAddOns = Array.isArray(tenant.addOns) ? [...tenant.addOns] : [];
  newAddOns.push({ slug: addon.slug, name: addon.name, qty: addon.qty || 1, priceMonthly: addon.priceMonthly });

  await updateDoc(tenantRef, {
    addOns: newAddOns,
    updatedAt: serverTimestamp(),
    updatedBy: user ? user.uid : null,
  });

  const addAddOnInvoiceData = {
    invoiceNumber: `INV-T-${Date.now().toString().slice(-6)}`,
    type: 'charge',
    amount: total, total,
    status: 'sent',
    issuedDate: serverTimestamp(),
    dueDate: Timestamp.fromDate(new Date(Date.now() + 14 * 86400000)),
    lineItems,
    reason: `Added add-on: ${addon.name}`,
    createdAt: serverTimestamp(),
    createdBy: user ? user.uid : null,
  };
  const invoiceRef = await addDoc(collection(db, 'tenants', tenantId, 'invoices'), addAddOnInvoiceData);
  await mirrorToCrmInvoices(tenantId, invoiceRef.id, addAddOnInvoiceData);

  await addDoc(collection(db, 'tenants', tenantId, 'activity'), {
    type: 'addon_added',
    description: `Added ${addon.name} — invoice ${formatCurrency(total)}`,
    metadata: { slug: addon.slug, invoiceId: invoiceRef.id },
    createdAt: serverTimestamp(),
  });

  const fromState = snapshotTenantState(tenant);
  const toState = snapshotTenantState({ ...tenant, addOns: newAddOns });
  await recordEvent({
    tenantId,
    contactId: tenant.contactId || null,
    type: EVENT_TYPES.ADDON_ADDED,
    fromState, toState,
    invoiceId: invoiceRef.id,
    reason: `Added ${addon.name}`,
    metadata: { slug: addon.slug, qty: addon.qty || 1 },
  });

  return { invoiceId: invoiceRef.id, total };
}

export function previewRemoveAddOn(tenant, slug) {
  const addon = (tenant.addOns || []).find(a => a.slug === slug);
  if (!addon) return null;
  const ratio = prorationRatio(tenant.currentPeriodStart, tenant.currentPeriodEnd);
  const monthlyPrice = (addon.priceMonthly || 0) * (addon.qty || 1);
  const refund = round2(monthlyPrice * ratio);
  return { addon, ratio, refund };
}

export async function removeAddOn(tenantId, slug) {
  const user = auth.currentUser;
  const tenantRef = doc(db, 'tenants', tenantId);
  const tenantSnap = await getDoc(tenantRef);
  if (!tenantSnap.exists()) throw new Error('Tenant not found');
  const tenant = tenantSnap.data();

  const preview = previewRemoveAddOn(tenant, slug);
  if (!preview) throw new Error('Add-on not found on tenant');

  const newAddOns = (tenant.addOns || []).filter(a => a.slug !== slug);
  await updateDoc(tenantRef, {
    addOns: newAddOns,
    updatedAt: serverTimestamp(),
    updatedBy: user ? user.uid : null,
  });

  if (preview.refund > 0) {
    const removeData = {
      invoiceNumber: `CR-${Date.now().toString().slice(-6)}`,
      type: 'refund',
      amount: -preview.refund, total: -preview.refund,
      status: 'issued',
      issuedDate: serverTimestamp(),
      lineItems: [{
        description: `Prorated credit for removed add-on: ${preview.addon.name}`,
        quantity: 1, rate: -preview.refund, amount: -preview.refund,
      }],
      reason: `Removed add-on: ${preview.addon.name}`,
      createdAt: serverTimestamp(),
      createdBy: user ? user.uid : null,
    };
    const invoiceRef = await addDoc(collection(db, 'tenants', tenantId, 'invoices'), removeData);
    await mirrorToCrmInvoices(tenantId, invoiceRef.id, removeData);
    await addDoc(collection(db, 'tenants', tenantId, 'activity'), {
      type: 'addon_removed',
      description: `Removed ${preview.addon.name} — credit ${formatCurrency(preview.refund)}`,
      metadata: { slug, invoiceId: invoiceRef.id },
      createdAt: serverTimestamp(),
    });

    const fromState = snapshotTenantState(tenant);
    const toState = snapshotTenantState({ ...tenant, addOns: newAddOns });
    await recordEvent({
      tenantId,
      contactId: tenant.contactId || null,
      type: EVENT_TYPES.ADDON_REMOVED,
      fromState, toState,
      invoiceId: invoiceRef.id,
      reason: `Removed ${preview.addon.name}`,
      metadata: { slug, refund: preview.refund },
    });

    return { invoiceId: invoiceRef.id, refund: preview.refund };
  }

  await addDoc(collection(db, 'tenants', tenantId, 'activity'), {
    type: 'addon_removed',
    description: `Removed ${preview.addon.name} (no refund — billing period ended)`,
    metadata: { slug },
    createdAt: serverTimestamp(),
  });

  const fromStateNoRefund = snapshotTenantState(tenant);
  const toStateNoRefund = snapshotTenantState({ ...tenant, addOns: newAddOns });
  await recordEvent({
    tenantId,
    contactId: tenant.contactId || null,
    type: EVENT_TYPES.ADDON_REMOVED,
    fromState: fromStateNoRefund, toState: toStateNoRefund,
    reason: `Removed ${preview.addon.name} (no refund)`,
    metadata: { slug, refund: 0 },
  });

  return { invoiceId: null, refund: 0 };
}

export async function previewChangePlan(tenant, newPackageId) {
  const oldPkg = tenant.packageId ? await getPackage(tenant.packageId) : null;
  const newPkg = await getPackage(newPackageId);
  if (!newPkg) throw new Error('New package not found');
  const ratio = prorationRatio(tenant.currentPeriodStart, tenant.currentPeriodEnd);
  const oldPrice = oldPkg ? (tenant.priceOverride ?? oldPkg.basePrice ?? 0) : 0;
  const newPrice = newPkg.basePrice || 0;
  const refund = round2(oldPrice * ratio);
  const charge = round2(newPrice * ratio);
  const net = round2(charge - refund);
  return { oldPkg, newPkg, ratio, refund, charge, net };
}

export async function changePlan(tenantId, newPackageId) {
  const user = auth.currentUser;
  const tenantRef = doc(db, 'tenants', tenantId);
  const tenantSnap = await getDoc(tenantRef);
  if (!tenantSnap.exists()) throw new Error('Tenant not found');
  const tenant = tenantSnap.data();

  const preview = await previewChangePlan(tenant, newPackageId);

  const lineItems = [];
  if (preview.refund > 0) lineItems.push({
    description: `Credit — previous plan (${preview.oldPkg?.name || 'previous'})`,
    quantity: 1, rate: -preview.refund, amount: -preview.refund,
  });
  if (preview.charge > 0) lineItems.push({
    description: `New plan (${preview.newPkg.name}) prorated`,
    quantity: 1, rate: preview.charge, amount: preview.charge,
  });
  const total = preview.net;

  await updateDoc(tenantRef, {
    packageId: newPackageId,
    tier: preview.newPkg.tier,
    features: preview.newPkg.features || [],
    priceOverride: null, // reset override — user can set again if needed
    updatedAt: serverTimestamp(),
    updatedBy: user ? user.uid : null,
  });

  const changePlanData = {
    invoiceNumber: `INV-T-${Date.now().toString().slice(-6)}`,
    type: total >= 0 ? 'charge' : 'refund',
    amount: total, total,
    status: 'sent',
    issuedDate: serverTimestamp(),
    dueDate: Timestamp.fromDate(new Date(Date.now() + 14 * 86400000)),
    lineItems,
    reason: `Plan change: ${preview.oldPkg?.name || '-'} → ${preview.newPkg.name}`,
    createdAt: serverTimestamp(),
    createdBy: user ? user.uid : null,
  };
  const invoiceRef = await addDoc(collection(db, 'tenants', tenantId, 'invoices'), changePlanData);
  await mirrorToCrmInvoices(tenantId, invoiceRef.id, changePlanData);
  await addDoc(collection(db, 'tenants', tenantId, 'activity'), {
    type: 'plan_changed',
    description: `Plan changed to ${preview.newPkg.name} — net ${total >= 0 ? 'charge' : 'credit'} ${formatCurrency(Math.abs(total))}`,
    metadata: { oldPackageId: tenant.packageId, newPackageId, invoiceId: invoiceRef.id },
    createdAt: serverTimestamp(),
  });

  const fromState = snapshotTenantState(tenant);
  const toState = snapshotTenantState({
    ...tenant,
    packageId:     newPackageId,
    tier:          preview.newPkg.tier,
    basePrice:     preview.newPkg.basePrice || 0,
    priceOverride: null,
  });
  await recordEvent({
    tenantId,
    contactId: tenant.contactId || null,
    type: EVENT_TYPES.PLAN_CHANGED,
    fromState, toState,
    invoiceId: invoiceRef.id,
    reason: `Plan changed: ${preview.oldPkg?.name || '-'} → ${preview.newPkg.name}`,
    metadata: {
      oldPackageId: tenant.packageId,
      newPackageId,
      oldPrice: preview.oldPkg ? (tenant.priceOverride ?? preview.oldPkg.basePrice ?? 0) : 0,
      newPrice: preview.newPkg.basePrice || 0,
    },
  });

  return { invoiceId: invoiceRef.id, total };
}

export function previewCancelNow(tenant) {
  const pkg = tenant.packageId;
  const price = tenant.priceOverride ?? tenant.basePrice ?? 0;
  const ratio = prorationRatio(tenant.currentPeriodStart, tenant.currentPeriodEnd);
  return { refund: round2(price * ratio) };
}

export async function cancelNow(tenantId) {
  const user = auth.currentUser;
  const tenantRef = doc(db, 'tenants', tenantId);
  const tenantSnap = await getDoc(tenantRef);
  if (!tenantSnap.exists()) throw new Error('Tenant not found');
  const tenant = tenantSnap.data();

  const { refund } = previewCancelNow(tenant);

  await updateDoc(tenantRef, {
    status: 'cancelled',
    cancelAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: user ? user.uid : null,
  });

  let invoiceId = null;
  if (refund > 0) {
    const cancelData = {
      invoiceNumber: `CR-${Date.now().toString().slice(-6)}`,
      type: 'refund',
      amount: -refund, total: -refund,
      status: 'issued',
      issuedDate: serverTimestamp(),
      lineItems: [{
        description: `Prorated refund — cancellation`,
        quantity: 1, rate: -refund, amount: -refund,
      }],
      reason: 'Subscription cancelled',
      createdAt: serverTimestamp(),
      createdBy: user ? user.uid : null,
    };
    const invoiceRef = await addDoc(collection(db, 'tenants', tenantId, 'invoices'), cancelData);
    await mirrorToCrmInvoices(tenantId, invoiceRef.id, cancelData);
    invoiceId = invoiceRef.id;
  }

  await addDoc(collection(db, 'tenants', tenantId, 'activity'), {
    type: 'subscription_cancelled',
    description: `Subscription cancelled immediately${refund > 0 ? ` — credit ${formatCurrency(refund)}` : ''}`,
    metadata: { invoiceId },
    createdAt: serverTimestamp(),
  });

  const fromState = snapshotTenantState(tenant);
  const toState = snapshotTenantState({ ...tenant, status: 'cancelled' });
  await recordEvent({
    tenantId,
    contactId: tenant.contactId || null,
    type: EVENT_TYPES.CANCELLED,
    fromState, toState,
    invoiceId,
    reason: refund > 0 ? `Cancelled with $${refund.toFixed(2)} prorated refund` : 'Cancelled immediately',
    metadata: { refund, immediate: true },
  });

  return { invoiceId, refund };
}

export async function cancelAtPeriodEnd(tenantId) {
  const user = auth.currentUser;
  const tenantRef = doc(db, 'tenants', tenantId);
  const tenantSnap = await getDoc(tenantRef);
  if (!tenantSnap.exists()) throw new Error('Tenant not found');
  const tenant = tenantSnap.data();

  await updateDoc(tenantRef, {
    cancelAt: tenant.currentPeriodEnd || null,
    updatedAt: serverTimestamp(),
    updatedBy: user ? user.uid : null,
  });
  await addDoc(collection(db, 'tenants', tenantId, 'activity'), {
    type: 'subscription_cancel_scheduled',
    description: `Cancellation scheduled for end of billing period`,
    metadata: {},
    createdAt: serverTimestamp(),
  });

  const fromState = snapshotTenantState(tenant);
  await recordEvent({
    tenantId,
    contactId: tenant.contactId || null,
    type: EVENT_TYPES.CANCEL_SCHEDULED,
    fromState, toState: fromState,
    reason: 'Cancellation scheduled for end of billing period',
    metadata: { scheduledFor: tenant.currentPeriodEnd || null },
  });

  return { scheduledFor: tenant.currentPeriodEnd };
}

// ── cancelAt enforcement (called on admin load from main.js) ──

export async function enforceCancellations() {
  const { collection: col, getDocs: gd, query: q, where: w } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
  const snap = await gd(q(col(db, 'tenants'), w('status', '==', 'active')));
  const now = Date.now();
  const due = [];
  snap.forEach(docSnap => {
    const data = docSnap.data();
    const cancelAt = toMs(data.cancelAt);
    if (cancelAt && cancelAt <= now) due.push(docSnap.id);
  });
  for (const id of due) {
    const tSnap = await getDoc(doc(db, 'tenants', id));
    const tenantData = tSnap.exists() ? tSnap.data() : {};
    await updateDoc(doc(db, 'tenants', id), { status: 'cancelled', updatedAt: serverTimestamp() });
    await addDoc(collection(db, 'tenants', id, 'activity'), {
      type: 'subscription_cancelled',
      description: 'Scheduled cancellation took effect',
      createdAt: serverTimestamp(),
    });
    try {
      const fromState = snapshotTenantState(tenantData);
      const toState = snapshotTenantState({ ...tenantData, status: 'cancelled' });
      await recordEvent({
        tenantId: id,
        contactId: tenantData.contactId || null,
        type: EVENT_TYPES.CANCELLED,
        fromState, toState,
        reason: 'Scheduled cancellation took effect',
        metadata: { scheduled: true },
      });
    } catch (err) { console.warn('Event write failed during enforceCancellations:', err); }
  }
  return due.length;
}

function formatCurrency(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
}
