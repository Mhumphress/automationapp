// ─────────────────────────────────────────────────────────────────
//  recurring-billing.js — Shared engine for recurring + one-off
//  charges that generate invoices in tenants/{t}/invoices_crm.
//
//  Used by:
//    - Property management: monthly rent, insurance, HOA, parking
//    - Salon: monthly memberships
//    - Services: retainer billing
//    - Trades: recurring service contracts
//
//  Data lives at tenants/{t}/recurring_charges/{id} (see rules).
//  CRM MIRROR: this file is mirrored byte-identical at
//  crm/js/services/recurring-billing.js. Keep in sync.
// ─────────────────────────────────────────────────────────────────

import { db, auth } from '../config.js';
import {
  collection, doc, addDoc, getDoc, getDocs, updateDoc, deleteDoc,
  query, where, orderBy, serverTimestamp, Timestamp, runTransaction
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

export const FREQUENCIES = Object.freeze([
  'monthly', 'annual', 'quarterly', 'weekly', 'biweekly', 'one_time',
]);

export const CHARGE_TYPES = Object.freeze([
  'rent', 'insurance', 'parking', 'hoa', 'utility', 'pet_fee',
  'late_fee', 'policy_violation', 'maintenance', 'membership',
  'retainer', 'service', 'other',
]);

const MS_DAY = 86400000;

function toDate(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  if (ts instanceof Date) return ts;
  return new Date(ts);
}

function advanceDate(date, frequency) {
  const d = new Date(date);
  switch (frequency) {
    case 'weekly':    d.setDate(d.getDate() + 7); break;
    case 'biweekly':  d.setDate(d.getDate() + 14); break;
    case 'monthly':   d.setMonth(d.getMonth() + 1); break;
    case 'quarterly': d.setMonth(d.getMonth() + 3); break;
    case 'annual':    d.setFullYear(d.getFullYear() + 1); break;
    default:          return null;
  }
  return d;
}

/**
 * Create a recurring (or one-off) charge against a parent record.
 *
 * @param {string} tenantId
 * @param {object} p
 * @param {string}  p.name                      human-readable label
 * @param {string}  [p.description]
 * @param {string}  [p.parentType]              'lease' | 'contact' | 'subscription' | ...
 * @param {string}  [p.parentId]
 * @param {string}  p.customerName
 * @param {string}  [p.customerId]
 * @param {string}  [p.customerEmail]
 * @param {string}  p.chargeType
 * @param {number}  p.amount
 * @param {string}  p.frequency                 from FREQUENCIES
 * @param {Date}    [p.startDate=now]
 * @param {Date}    [p.endDate]                 null = open-ended
 * @param {number}  [p.dayOfMonth]              1–31 (monthly/annual anchor)
 * @param {number}  [p.dueInDays=14]            invoice due after generation
 * @param {boolean} [p.autoGenerate=true]
 * @param {string}  [p.notes]
 */
export async function createCharge(tenantId, p) {
  if (!tenantId) throw new Error('tenantId required');
  if (!p || !p.name || !p.customerName || !(p.amount > 0) || !p.frequency) {
    throw new Error('name, customerName, amount > 0, and frequency are required');
  }
  if (!FREQUENCIES.includes(p.frequency)) throw new Error(`Unknown frequency: ${p.frequency}`);

  const user = auth.currentUser;
  const startDate = p.startDate ? toDate(p.startDate) : new Date();
  const nextDue = computeNextDueFromStart(startDate, p.frequency, p.dayOfMonth);

  const data = {
    name:             p.name.trim(),
    description:      (p.description || '').trim(),
    parentType:       p.parentType || null,
    parentId:         p.parentId || null,
    customerId:       p.customerId || null,
    customerName:     p.customerName.trim(),
    customerEmail:    (p.customerEmail || '').trim(),
    chargeType:       p.chargeType || 'other',
    amount:           Number(p.amount),
    frequency:        p.frequency,
    dayOfMonth:       p.dayOfMonth != null ? Number(p.dayOfMonth) : null,
    startDate:        Timestamp.fromDate(startDate),
    endDate:          p.endDate ? Timestamp.fromDate(toDate(p.endDate)) : null,
    nextDueDate:      Timestamp.fromDate(nextDue),
    dueInDays:        p.dueInDays != null ? Number(p.dueInDays) : 14,
    status:           'active',
    autoGenerate:     p.autoGenerate !== false,
    lastGeneratedInvoiceId: null,
    lastGeneratedAt:  null,
    notes:            p.notes || '',
    createdAt:        serverTimestamp(),
    createdBy:        user ? user.uid : null,
    createdByEmail:   user ? user.email || '' : '',
  };

  const ref = await addDoc(collection(db, 'tenants', tenantId, 'recurring_charges'), data);
  return { id: ref.id, ...data };
}

function computeNextDueFromStart(startDate, frequency, dayOfMonth) {
  if (frequency === 'one_time') return startDate;
  if (!dayOfMonth || (frequency !== 'monthly' && frequency !== 'annual' && frequency !== 'quarterly')) {
    return startDate;
  }
  const d = new Date(startDate);
  d.setDate(dayOfMonth);
  if (d < startDate) {
    // first billing day has passed in the start month — push to next cycle
    return advanceDate(d, frequency) || startDate;
  }
  return d;
}

export async function updateCharge(tenantId, chargeId, data) {
  const user = auth.currentUser;
  await updateDoc(doc(db, 'tenants', tenantId, 'recurring_charges', chargeId), {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: user ? user.uid : null,
  });
}

export async function deleteCharge(tenantId, chargeId) {
  await deleteDoc(doc(db, 'tenants', tenantId, 'recurring_charges', chargeId));
}

export async function setChargeStatus(tenantId, chargeId, status) {
  return updateCharge(tenantId, chargeId, { status });
}

export async function listCharges(tenantId, filter = {}) {
  try {
    const snap = await getDocs(collection(db, 'tenants', tenantId, 'recurring_charges'));
    let list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (filter.parentType) list = list.filter(c => c.parentType === filter.parentType);
    if (filter.parentId)   list = list.filter(c => c.parentId === filter.parentId);
    if (filter.customerId) list = list.filter(c => c.customerId === filter.customerId);
    if (filter.status)     list = list.filter(c => c.status === filter.status);
    list.sort((a, b) => {
      const ta = a.nextDueDate?.toDate?.()?.getTime() || 0;
      const tb = b.nextDueDate?.toDate?.()?.getTime() || 0;
      return ta - tb;
    });
    return list;
  } catch (err) {
    console.warn('listCharges failed:', err);
    return [];
  }
}

export async function listInvoicesGeneratedFor(tenantId, parentType, parentId) {
  try {
    // Invoices tagged by source.parentType/parentId
    const snap = await getDocs(collection(db, 'tenants', tenantId, 'invoices_crm'));
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(i => i.source?.parentType === parentType && i.source?.parentId === parentId)
      .sort((a, b) => {
        const ta = a.issueDate?.toDate?.()?.getTime?.() || new Date(a.issueDate || 0).getTime();
        const tb = b.issueDate?.toDate?.()?.getTime?.() || new Date(b.issueDate || 0).getTime();
        return tb - ta;
      });
  } catch (err) {
    console.warn('listInvoicesGeneratedFor failed:', err);
    return [];
  }
}

/**
 * Generate a single one-off invoice (late fee, policy violation, etc.) against
 * a parent record. Does NOT create a recurring charge — just an invoice.
 *
 * @param {string} tenantId
 * @param {object} p
 * @param {string} p.customerName
 * @param {string} [p.customerId]
 * @param {string} [p.customerEmail]
 * @param {string} [p.parentType]
 * @param {string} [p.parentId]
 * @param {Array<{description, amount}>} p.lineItems  at least one
 * @param {number} [p.dueInDays=14]
 * @param {string} [p.notes]
 * @param {string} [p.chargeType]
 */
export async function generateOneTimeInvoice(tenantId, p) {
  if (!tenantId || !p || !Array.isArray(p.lineItems) || p.lineItems.length === 0) {
    throw new Error('tenantId and at least one lineItem required');
  }
  const user = auth.currentUser;
  const subtotal = p.lineItems.reduce((s, li) => s + (Number(li.amount) || 0), 0);
  const now = new Date();
  const dueDays = p.dueInDays != null ? Number(p.dueInDays) : 14;
  const issueDate = now.toISOString().split('T')[0];
  const dueDate = new Date(now.getTime() + dueDays * MS_DAY).toISOString().split('T')[0];

  const nextNumber = await allocateInvoiceNumber(tenantId);
  const invoiceData = {
    invoiceNumber: nextNumber,
    clientId:      p.customerId || null,
    clientName:    p.customerName,
    clientEmail:   p.customerEmail || '',
    lineItems:     p.lineItems.map(li => ({
      description: li.description || '',
      quantity:    Number(li.quantity || 1),
      rate:        Number(li.rate ?? li.amount ?? 0),
      amount:      Number(li.amount || (li.rate || 0) * (li.quantity || 1)),
    })),
    subtotal,
    taxRate:       0,
    taxAmount:     0,
    total:         subtotal,
    status:        'sent',
    type:          'charge',
    issueDate,
    dueDate,
    notes:         p.notes || '',
    source:        (p.parentType || p.parentId) ? {
      parentType: p.parentType || null,
      parentId:   p.parentId || null,
      chargeType: p.chargeType || 'one_time',
    } : null,
    createdAt:     serverTimestamp(),
    createdBy:     user ? user.uid : null,
  };

  const ref = await addDoc(collection(db, 'tenants', tenantId, 'invoices_crm'), invoiceData);
  return { id: ref.id, ...invoiceData };
}

async function allocateInvoiceNumber(tenantId) {
  // Per-tenant invoice counter: tenants/{t}/counters/invoices_crm
  const counterRef = doc(db, 'tenants', tenantId, 'counters', 'invoices_crm');
  let next = 1;
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(counterRef);
      const current = snap.exists() ? Number(snap.data().value || 0) : 0;
      next = current + 1;
      tx.set(counterRef, { value: next, updatedAt: serverTimestamp() }, { merge: true });
    });
  } catch (err) {
    console.warn('Counter allocation failed, falling back to timestamp:', err);
    next = Number(String(Date.now()).slice(-6));
  }
  return `INV-${String(next).padStart(5, '0')}`;
}

/**
 * Sweep: generate invoices for all active recurring charges with
 * nextDueDate <= now. Idempotent — safe to run on every admin load.
 * Returns { generated: number }.
 *
 * @param {string} tenantId
 * @param {Date}   [asOf=now]
 */
export async function runRecurringSweep(tenantId, asOf = new Date()) {
  const MAX_CATCHUP_CYCLES = 12;  // safety: don't bill 100 months at once
  let generated = 0;

  const snap = await getDocs(collection(db, 'tenants', tenantId, 'recurring_charges'));
  for (const d of snap.docs) {
    const charge = { id: d.id, ...d.data() };
    if (charge.status !== 'active' || !charge.autoGenerate) continue;

    const endDate = toDate(charge.endDate);
    if (endDate && endDate < asOf) continue;

    let nextDue = toDate(charge.nextDueDate);
    if (!nextDue) continue;

    let cycles = 0;
    while (nextDue && nextDue <= asOf && cycles < MAX_CATCHUP_CYCLES) {
      try {
        const invoice = await generateOneTimeInvoice(tenantId, {
          customerName:  charge.customerName,
          customerId:    charge.customerId,
          customerEmail: charge.customerEmail,
          parentType:    charge.parentType,
          parentId:      charge.parentId,
          chargeType:    charge.chargeType,
          dueInDays:     charge.dueInDays || 14,
          notes:         `Auto-generated from "${charge.name}" (${charge.frequency})`,
          lineItems:     [{
            description: charge.description || charge.name,
            quantity:    1,
            rate:        charge.amount,
            amount:      charge.amount,
          }],
        });
        generated += 1;

        // Advance nextDueDate. For one_time we mark the charge done.
        if (charge.frequency === 'one_time') {
          await updateCharge(tenantId, charge.id, {
            lastGeneratedInvoiceId: invoice.id,
            lastGeneratedAt: serverTimestamp(),
            status: 'completed',
            nextDueDate: null,
          });
          nextDue = null;
        } else {
          const newNext = advanceDate(nextDue, charge.frequency);
          if (!newNext) { break; }
          await updateCharge(tenantId, charge.id, {
            lastGeneratedInvoiceId: invoice.id,
            lastGeneratedAt: serverTimestamp(),
            nextDueDate: Timestamp.fromDate(newNext),
          });
          nextDue = newNext;
          cycles += 1;
        }
      } catch (err) {
        console.warn(`Generate invoice for charge ${charge.id} failed:`, err);
        break;
      }
    }
  }

  return { generated };
}

/** Sweep across all tenants (CRM admin load). */
export async function runRecurringSweepForAllTenants() {
  const tSnap = await getDocs(collection(db, 'tenants'));
  let total = 0;
  for (const t of tSnap.docs) {
    const status = t.data().status;
    if (status !== 'active' && status !== 'past_due') continue;
    try {
      const { generated } = await runRecurringSweep(t.id);
      total += generated;
    } catch (err) {
      console.warn(`Sweep for tenant ${t.id} failed:`, err);
    }
  }
  if (total > 0) console.log(`[recurring-billing] Generated ${total} invoice(s) across all tenants`);
  return { generated: total };
}

// Exposed for the UI modal — used to show a human-friendly "next bill" label.
export function describeSchedule(charge) {
  const freq = charge.frequency || 'monthly';
  const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(charge.amount || 0);
  const next = toDate(charge.nextDueDate);
  const nextLabel = next
    ? next.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'no schedule';
  if (freq === 'one_time') return `${amount} · one-time, scheduled ${nextLabel}`;
  return `${amount} · ${freq} · next ${nextLabel}`;
}
