// Keep the CRM root /invoices record and the tenant /tenants/{tid}/invoices
// mirror in lockstep. The admin edits on the CRM side; the tenant sees the
// result on their Billing tab as read-only. Fields propagate one way (CRM →
// tenant); tenant side has no modify UI anyway.

import { db, auth } from '../config.js';
import {
  doc, updateDoc, deleteDoc, addDoc, collection, serverTimestamp,
  query, where, getDocs
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// Fields that get mirrored to the tenant invoice on any root-side update.
// Status, totals, line items, due date, notes — anything the tenant should
// see exactly the same.
const SYNC_FIELDS = [
  'status', 'total', 'amount', 'subtotal',
  'dueDate', 'issueDate',
  'lineItems', 'notes',
  'taxRate', 'taxAmount',
  'discountReason', 'discountType', 'discountValue', 'discountAmount',
  'type',
];

export async function updateInvoiceWithSync(invoice, patch) {
  const user = auth.currentUser;
  const stamped = {
    ...patch,
    updatedAt: serverTimestamp(),
    updatedBy: user ? user.uid : null,
  };
  await updateDoc(doc(db, 'invoices', invoice.id), stamped);
  if (invoice.tenantId && invoice.tenantInvoiceId) {
    const tenantPatch = {};
    SYNC_FIELDS.forEach(f => { if (f in patch) tenantPatch[f] = patch[f]; });
    if (Object.keys(tenantPatch).length > 0) {
      try {
        await updateDoc(
          doc(db, `tenants/${invoice.tenantId}/invoices/${invoice.tenantInvoiceId}`),
          { ...tenantPatch, updatedAt: serverTimestamp(), syncedFromCrmAt: serverTimestamp() }
        );
      } catch (err) {
        console.warn('Tenant invoice mirror sync (update) failed:', err);
      }
    }
  }
}

export async function deleteInvoiceWithSync(invoice) {
  await deleteDoc(doc(db, 'invoices', invoice.id));
  if (invoice.tenantId && invoice.tenantInvoiceId) {
    try {
      await deleteDoc(doc(db, `tenants/${invoice.tenantId}/invoices/${invoice.tenantInvoiceId}`));
    } catch (err) {
      console.warn('Tenant invoice mirror sync (delete) failed:', err);
    }
  }
}

/**
 * Resolve which tenant a contact belongs to. Returns the tenant doc or null.
 * The tenant→contact link lives on tenant.contactId (set by provisioning).
 */
export async function findTenantForContact(contactId) {
  if (!contactId) return null;
  try {
    const q = query(collection(db, 'tenants'), where('contactId', '==', contactId));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...d.data() };
  } catch (err) {
    console.warn('findTenantForContact failed:', err);
    return null;
  }
}

/**
 * Operator-created invoice flow: write to both the CRM root /invoices (for
 * revenue tracking) and — if the contact is provisioned as a tenant — to
 * tenants/{tid}/invoices so the portal's Billing page shows it.
 *
 * Returns the root invoice ID. If a tenant mirror was written, both sides
 * carry the cross-link fields (crmInvoiceId, tenantInvoiceId, tenantId).
 */
export async function createInvoiceWithTenantMirror(data) {
  const user = auth.currentUser;
  const tenant = await findTenantForContact(data.clientId);

  let tenantInvoiceRef = null;
  if (tenant) {
    // Write to the tenant's billing subcollection FIRST so we have its ID
    // to include in the root mirror.
    try {
      tenantInvoiceRef = await addDoc(
        collection(db, 'tenants', tenant.id, 'invoices'),
        {
          ...data,
          tenantId: tenant.id,
          createdAt: serverTimestamp(),
          createdBy: user ? user.uid : null,
          source: { createdVia: 'crm_invoice_form' },
        }
      );
    } catch (err) {
      console.warn('Tenant invoice write failed — continuing with CRM-only invoice:', err);
      tenantInvoiceRef = null;
    }
  }

  const rootRef = await addDoc(collection(db, 'invoices'), {
    ...data,
    tenantId: tenant ? tenant.id : null,
    tenantInvoiceId: tenantInvoiceRef ? tenantInvoiceRef.id : null,
    createdAt: serverTimestamp(),
    createdBy: user ? user.uid : null,
    updatedAt: serverTimestamp(),
    updatedBy: user ? user.uid : null,
  });

  // Back-link the tenant invoice to the CRM invoice so paid-status mirror
  // in payments.js can find its way back.
  if (tenantInvoiceRef) {
    try {
      await updateDoc(tenantInvoiceRef, { crmInvoiceId: rootRef.id });
    } catch (err) {
      console.warn('Back-link tenant invoice to CRM invoice failed:', err);
    }
  }

  return {
    id: rootRef.id,
    tenantId: tenant ? tenant.id : null,
    tenantInvoiceId: tenantInvoiceRef ? tenantInvoiceRef.id : null,
    tenantName: tenant ? tenant.companyName : null,
  };
}

/**
 * Backfill tenantId + tenantInvoiceId on legacy root invoices. For each
 * root invoice that has a clientId but no tenantId, look up the contact's
 * tenant and (a) write the missing tenantId on the root, (b) create a
 * tenants/{tid}/invoices/{...} mirror if none exists, (c) cross-link
 * both sides with tenantInvoiceId / crmInvoiceId.
 *
 * Idempotent. Flag-gated. Runs once per CRM deployment.
 */
export async function backfillInvoiceTenantLinks() {
  const flagRef = doc(db, 'settings', 'migrations');
  const flagSnap = await getDocs(query(collection(db, 'settings'), where('__name__', '==', 'migrations')));
  const flags = flagSnap.docs[0]?.data() || {};
  if (flags.invoiceTenantLinksBackfilled) return { skipped: true, fixed: 0 };

  const invSnap = await getDocs(collection(db, 'invoices'));
  const user = auth.currentUser;
  let fixed = 0;

  // Cache tenant lookups per clientId — one query per contact.
  const tenantByContact = new Map();

  for (const d of invSnap.docs) {
    const inv = { id: d.id, ...d.data() };
    if (inv.tenantId && inv.tenantInvoiceId) continue;  // already linked
    if (!inv.clientId) continue;

    let tenant;
    if (tenantByContact.has(inv.clientId)) {
      tenant = tenantByContact.get(inv.clientId);
    } else {
      tenant = await findTenantForContact(inv.clientId);
      tenantByContact.set(inv.clientId, tenant);
    }
    if (!tenant) continue;

    const rootRef = doc(db, 'invoices', inv.id);
    const updates = {};
    if (!inv.tenantId) updates.tenantId = tenant.id;

    // Write the tenant-side mirror if it's missing.
    if (!inv.tenantInvoiceId) {
      try {
        const tenantMirror = await addDoc(
          collection(db, 'tenants', tenant.id, 'invoices'),
          {
            invoiceNumber: inv.invoiceNumber,
            clientId: inv.clientId,
            clientName: inv.clientName,
            tenantId: tenant.id,
            crmInvoiceId: inv.id,
            issueDate: inv.issueDate || '',
            dueDate: inv.dueDate || '',
            lineItems: inv.lineItems || [],
            subtotal: inv.subtotal || 0,
            taxRate: inv.taxRate || 0,
            taxAmount: inv.taxAmount || 0,
            total: inv.total || 0,
            paidAmount: inv.paidAmount || 0,
            status: inv.status || 'draft',
            type: inv.type || 'charge',
            notes: inv.notes || '',
            createdAt: serverTimestamp(),
            createdBy: user ? user.uid : null,
            source: { createdVia: 'backfill' },
          }
        );
        updates.tenantInvoiceId = tenantMirror.id;
      } catch (err) {
        console.warn(`Backfill mirror for invoice ${inv.id} failed:`, err);
      }
    }

    if (Object.keys(updates).length > 0) {
      try {
        await updateDoc(rootRef, { ...updates, updatedAt: serverTimestamp() });
        fixed += 1;
      } catch (err) {
        console.warn(`Backfill update for invoice ${inv.id} failed:`, err);
      }
    }
  }

  try {
    await updateDoc(doc(db, 'settings', 'migrations'), {
      invoiceTenantLinksBackfilled: { ranAt: serverTimestamp(), fixed },
    });
  } catch (err) {
    // Doc may not exist yet — use setDoc via merge.
    try {
      const { setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
      await setDoc(doc(db, 'settings', 'migrations'), {
        invoiceTenantLinksBackfilled: { ranAt: serverTimestamp(), fixed },
      }, { merge: true });
    } catch (e) { console.warn('Could not persist migration flag:', e); }
  }

  if (fixed > 0) console.log(`[invoice-sync] Backfilled ${fixed} invoice(s) with tenant links.`);
  return { skipped: false, fixed };
}

// Create a CRM root invoice record that mirrors a newly-created tenant
// billing invoice (used by subscription service when adding seats, changing
// plans, cancelling — anything that generates a tenant invoice should also
// produce a root-side mirror so revenue tracking is complete).
export async function createRootInvoiceMirror({
  tenantId,
  tenantInvoiceId,
  tenantName,
  contactId,
  invoiceNumber,
  total,
  status = 'sent',
  lineItems = [],
  notes = '',
  type = 'charge',
  reason = '',
}) {
  const user = auth.currentUser;
  const todayIso = new Date().toISOString().split('T')[0];
  const dueIso = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];
  const ref = await addDoc(collection(db, 'invoices'), {
    invoiceNumber,
    clientId: contactId || '',
    clientName: tenantName || 'Unknown',
    tenantId,
    tenantInvoiceId,
    issueDate: todayIso,
    dueDate: dueIso,
    lineItems,
    subtotal: total,
    taxRate: 0,
    taxAmount: 0,
    total,
    type,
    status,
    notes,
    reason,
    createdAt: serverTimestamp(),
    createdBy: user ? user.uid : null,
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}
