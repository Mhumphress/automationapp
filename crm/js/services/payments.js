// ─────────────────────────────────────────────────────────────────
//  payments.js — Manual payment recording against tenant invoices.
//
//  Until Stripe is wired, payments are recorded by hand. This service
//  writes under tenants/{t}/payments/, applies amounts to open invoices,
//  and flips invoice status to 'paid' when fully covered or keeps
//  'partial' with a running paidAmount when not.
// ─────────────────────────────────────────────────────────────────

import { db, auth } from '../config.js';
import {
  collection, doc, addDoc, getDoc, getDocs, updateDoc, query, orderBy,
  serverTimestamp, runTransaction, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

export const PAYMENT_METHODS = Object.freeze([
  'check', 'ach', 'card', 'cash', 'wire', 'manual',
]);

/**
 * Record a payment against one or more invoices.
 *
 * @param {string} tenantId
 * @param {object} p
 * @param {number} p.amount        total payment amount (positive)
 * @param {string} p.method
 * @param {string} [p.reference]
 * @param {Date}   [p.receivedAt]
 * @param {string} [p.notes]
 * @param {string} [p.type]        'payment' | 'refund' (default 'payment')
 * @param {Array<{invoiceId: string, amount: number}>} [p.appliedTo]
 */
export async function recordPayment(tenantId, p) {
  if (!tenantId) throw new Error('tenantId required');
  if (!p || !(p.amount > 0)) throw new Error('amount must be positive');
  if (!PAYMENT_METHODS.includes(p.method)) throw new Error('invalid method');

  const user = auth.currentUser;
  const applied = Array.isArray(p.appliedTo) ? p.appliedTo : [];

  // 1. Write the payment doc first.
  const paymentData = {
    tenantId,
    amount:          Number(p.amount),
    currency:        'USD',
    method:          p.method,
    status:          'received',
    type:            p.type || 'payment',
    reference:       p.reference || '',
    appliedTo:       applied,
    receivedAt:      p.receivedAt
      ? (p.receivedAt instanceof Date ? Timestamp.fromDate(p.receivedAt) : p.receivedAt)
      : serverTimestamp(),
    recordedAt:      serverTimestamp(),
    recordedBy:      user ? user.uid : null,
    recordedByEmail: user ? user.email || '' : '',
    notes:           p.notes || '',
  };

  const paymentRef = await addDoc(collection(db, 'tenants', tenantId, 'payments'), paymentData);

  // 2. Apply to each invoice in its own transaction so partial failures
  //    don't corrupt state. Each invoice gets paidAmount += applied amount;
  //    status flips to 'paid' when paidAmount >= invoice total.
  for (const entry of applied) {
    if (!entry.invoiceId || !(entry.amount > 0)) continue;

    // The invoice may live at tenants/{t}/invoices/{id} (tenant billing)
    // OR at root /invoices/{id} (CRM revenue mirror). Try tenant first.
    let invoicePath = `tenants/${tenantId}/invoices/${entry.invoiceId}`;
    let exists = false;
    try {
      const s = await getDoc(doc(db, invoicePath));
      exists = s.exists();
    } catch { exists = false; }
    if (!exists) {
      invoicePath = `invoices/${entry.invoiceId}`;
    }

    try {
      await runTransaction(db, async (tx) => {
        const invRef = doc(db, invoicePath);
        const snap = await tx.get(invRef);
        if (!snap.exists()) return;
        const inv = snap.data();
        const currentPaid = Number(inv.paidAmount || 0);
        const newPaid = currentPaid + Number(entry.amount);
        const invoiceTotal = Math.abs(Number(inv.total || inv.amount || 0));
        const fullyPaid = newPaid >= invoiceTotal - 0.0049;

        const update = {
          paidAmount: Math.round(newPaid * 100) / 100,
          lastPaymentId: paymentRef.id,
          lastPaymentAt: serverTimestamp(),
        };
        if (fullyPaid) {
          update.status = 'paid';
          update.paidAt = serverTimestamp();
        } else if (newPaid > 0 && inv.status !== 'paid') {
          update.status = 'partial';
        }
        tx.update(invRef, update);
      });

      // Mirror paid status to the CRM root invoice if this was a tenant invoice.
      if (invoicePath.startsWith('tenants/')) {
        const tSnap = await getDoc(doc(db, invoicePath));
        if (tSnap.exists()) {
          const crmInvoiceId = tSnap.data().crmInvoiceId;
          if (crmInvoiceId) {
            try {
              await updateDoc(doc(db, 'invoices', crmInvoiceId), {
                paidAmount: tSnap.data().paidAmount || 0,
                status: tSnap.data().status || 'sent',
                lastPaymentAt: serverTimestamp(),
              });
            } catch (err) {
              console.warn('Mirror paid-status to CRM invoice failed:', err);
            }
          }
        }
      }
    } catch (err) {
      console.error(`Apply payment to ${invoicePath} failed:`, err);
    }
  }

  return { id: paymentRef.id, ...paymentData };
}

/** List payments for a tenant, newest first. */
export async function listPayments(tenantId) {
  if (!tenantId) return [];
  try {
    const q = query(
      collection(db, 'tenants', tenantId, 'payments'),
      orderBy('receivedAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn('listPayments failed:', err);
    return [];
  }
}

/**
 * List payments for a contact. Resolves via the tenant linked to that
 * contact (tenant.contactId === contactId). Returns empty if no tenant.
 */
export async function listPaymentsForContact(contactId) {
  if (!contactId) return [];
  try {
    const tSnap = await getDocs(
      query(collection(db, 'tenants'), orderBy('createdAt', 'desc'))
    );
    const tenants = tSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(t => t.contactId === contactId);
    if (!tenants.length) return [];

    const all = [];
    for (const t of tenants) {
      const list = await listPayments(t.id);
      list.forEach(p => all.push({ ...p, _tenantId: t.id }));
    }
    all.sort((a, b) => {
      const ta = a.receivedAt && a.receivedAt.toDate ? a.receivedAt.toDate().getTime() : 0;
      const tb = b.receivedAt && b.receivedAt.toDate ? b.receivedAt.toDate().getTime() : 0;
      return tb - ta;
    });
    return all;
  } catch (err) {
    console.warn('listPaymentsForContact failed:', err);
    return [];
  }
}
