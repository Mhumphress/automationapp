// Keep the CRM root /invoices record and the tenant /tenants/{tid}/invoices
// mirror in lockstep. The admin edits on the CRM side; the tenant sees the
// result on their Billing tab as read-only. Fields propagate one way (CRM →
// tenant); tenant side has no modify UI anyway.

import { db, auth } from '../config.js';
import {
  doc, updateDoc, deleteDoc, addDoc, collection, serverTimestamp
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
