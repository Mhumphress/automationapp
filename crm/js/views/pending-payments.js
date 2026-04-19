// ─────────────────────────────────────────────────────────────────
//  pending-payments.js — CRM operator inbox for customer payment
//  submissions that haven't been reconciled yet.
//
//  Shows every tenants/{t}/payment_intents doc where status === 'pending',
//  across every tenant, in one live list. Operator can click "Mark as
//  Received" to open the Record Payment modal (pre-filled) or Cancel to
//  flip the intent to failed so the customer can resubmit.
// ─────────────────────────────────────────────────────────────────

import { db } from '../config.js';
import {
  collectionGroup, onSnapshot, doc, updateDoc, serverTimestamp,
  collection, getDocs
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { openRecordPaymentModal } from '../components/record-payment-modal.js';
import { escapeHtml, formatDate, showToast } from '../ui.js';

let unsub = null;
let tenantsById = {};
let intents = [];

export function init() {}

export function destroy() {
  if (unsub) { try { unsub(); } catch {} unsub = null; }
}

export async function render() {
  destroy();
  const container = document.getElementById('view-pending-payments');
  if (!container) return;
  container.innerHTML = '<div class="loading">Loading pending payments…</div>';

  // Cache tenants for company-name lookup
  try {
    const tSnap = await getDocs(collection(db, 'tenants'));
    tenantsById = Object.fromEntries(
      tSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }])
    );
  } catch (err) {
    console.warn('Tenants load for pending-payments failed:', err);
  }

  // No where-filter on the collection-group query — a filtered CG query would
  // need an explicit index. Pull everything, filter client-side. Low volume
  // (only admin-visible submissions), cheap.
  try {
    unsub = onSnapshot(collectionGroup(db, 'payment_intents'), (snap) => {
      intents = snap.docs
        .map(d => ({
          id: d.id,
          _path: d.ref.path,
          _tenantId: extractTenantId(d.ref.path),
          ...d.data(),
        }))
        .filter(i => i.status === 'pending');
      draw(container);
    }, (err) => {
      console.error('pending_payments subscription error:', err);
      container.innerHTML = `
        <div style="padding:1rem;background:rgba(220,38,38,0.08);color:var(--danger);border-radius:8px;">
          <strong>Can't load pending payments:</strong> ${escapeHtml(err.code || err.message)}
          ${err.code === 'permission-denied' ? '<div style="margin-top:0.3rem;font-size:0.85rem;color:var(--gray-dark);">Rules may need publishing — the collection-group read for payment_intents was added recently.</div>' : ''}
        </div>`;
    });
  } catch (err) {
    container.innerHTML = `<div style="padding:1rem;color:var(--danger);">Query failed: ${escapeHtml(err.message)}</div>`;
  }
}

function extractTenantId(path) {
  // payment_intents live under tenants/{tid}/payment_intents/{id}
  const m = /^tenants\/([^/]+)\//.exec(path);
  return m ? m[1] : null;
}

function draw(container) {
  const sorted = [...intents].sort((a, b) => {
    const ta = a.submittedAt?.toDate?.()?.getTime?.() || 0;
    const tb = b.submittedAt?.toDate?.()?.getTime?.() || 0;
    return tb - ta;
  });

  const total = sorted.reduce((s, i) => s + (Number(i.amount) || 0), 0);

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;margin-bottom:1rem;">
      <div>
        <h1 style="margin:0 0 0.25rem;font-size:1.5rem;">Pending Payments</h1>
        <p style="color:var(--gray-dark);font-size:0.88rem;margin:0;">
          Customer submissions waiting for reconciliation. Mark as Received once you've confirmed the funds cleared in your bank / processor.
        </p>
      </div>
      <div style="text-align:right;">
        <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--gray-dark);">Total pending</div>
        <div style="font-size:1.75rem;font-weight:600;font-variant-numeric:tabular-nums;">${fmtMoney(total)}</div>
        <div style="font-size:0.78rem;color:var(--gray-dark);">${sorted.length} submission${sorted.length === 1 ? '' : 's'}</div>
      </div>
    </div>

    ${sorted.length === 0 ? `
      <div class="empty-state" style="padding:3rem 1rem;background:white;border:1px solid var(--off-white);border-radius:12px;">
        <div class="empty-title" style="font-size:1.1rem;">All caught up</div>
        <p class="empty-description">No customer payments waiting for reconciliation.</p>
      </div>
    ` : `
      <table class="data-table">
        <thead><tr>
          <th>Submitted</th>
          <th>Tenant</th>
          <th>Customer</th>
          <th>Invoice</th>
          <th>Method</th>
          <th>Amount</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${sorted.map(i => {
            const tenant = tenantsById[i._tenantId];
            const methodLabel = describeIntentMethod(i);
            return `
              <tr data-intent-id="${escapeHtml(i.id)}" data-tenant-id="${escapeHtml(i._tenantId)}">
                <td>${escapeHtml(formatDate(i.submittedAt))}</td>
                <td style="font-weight:500;">${escapeHtml(tenant?.companyName || i._tenantId || '—')}</td>
                <td>${escapeHtml(i.customerName || i.customerEmail || '—')}</td>
                <td style="font-family:var(--font-mono);">${escapeHtml(i.invoiceNumber || '—')}</td>
                <td>${escapeHtml(methodLabel)}</td>
                <td style="font-family:var(--font-mono);font-weight:500;">${fmtMoney(i.amount)}</td>
                <td style="text-align:right;white-space:nowrap;">
                  <button class="btn btn-primary btn-sm" data-action="reconcile">Mark as Received</button>
                  <button class="btn btn-ghost btn-sm" data-action="cancel" style="color:var(--danger);">Cancel</button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `}
  `;

  container.querySelectorAll('[data-action="reconcile"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tr = btn.closest('tr');
      const intent = sorted.find(x => x.id === tr.dataset.intentId);
      if (!intent) return;
      await reconcileIntent(intent);
    });
  });
  container.querySelectorAll('[data-action="cancel"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tr = btn.closest('tr');
      const intent = sorted.find(x => x.id === tr.dataset.intentId);
      if (!intent) return;
      if (!confirm('Cancel this pending payment? The customer will need to resubmit.')) return;
      try {
        await updateDoc(doc(db, 'tenants', intent._tenantId, 'payment_intents', intent.id), {
          status: 'failed',
          statusMessage: 'Cancelled by operator.',
          reconciledAt: serverTimestamp(),
        });
        showToast('Cancelled', 'success');
      } catch (err) {
        console.error(err);
        showToast('Failed: ' + err.message, 'error');
      }
    });
  });
}

async function reconcileIntent(intent) {
  // Load candidate invoices for the target tenant so the modal can pre-fill.
  let candidateInvoices = [];
  let targetInvoice = null;

  const tenantId = intent._tenantId;
  if (!tenantId) {
    showToast('Can\'t determine which tenant this belongs to.', 'error');
    return;
  }

  // Try tenant subscription invoices + tenant outgoing invoices.
  for (const coll of ['invoices', 'invoices_crm']) {
    try {
      const snap = await getDocs(collection(db, 'tenants', tenantId, coll));
      snap.docs.forEach(d => {
        candidateInvoices.push({ id: d.id, _coll: coll, ...d.data() });
      });
    } catch {}
  }

  if (intent.invoiceId) {
    targetInvoice = candidateInvoices.find(i => i.id === intent.invoiceId) || null;
  }

  const open = candidateInvoices.filter(i =>
    ['sent', 'draft', 'overdue', 'partial', 'issued'].includes(i.status)
  );

  const result = await openRecordPaymentModal({
    tenantId,
    invoices: targetInvoice ? [targetInvoice] : open,
    presetInvoiceId: intent.invoiceId || null,
    singleInvoiceMode: !!targetInvoice,
    title: `Reconcile ${describeIntentMethod(intent)} — ${fmtMoney(intent.amount)}`,
  });

  if (result && result.recorded) {
    try {
      await updateDoc(doc(db, 'tenants', tenantId, 'payment_intents', intent.id), {
        status: 'succeeded',
        statusMessage: 'Reconciled manually by operator.',
        reconciledAt: serverTimestamp(),
      });
    } catch (err) {
      console.warn('Failed to mark intent succeeded:', err);
    }
  }
}

function describeIntentMethod(p) {
  if (p.method === 'card') {
    const brand = (p.cardBrand || 'card').toUpperCase();
    return p.cardLast4 ? `${brand} ····${p.cardLast4}` : brand;
  }
  if (p.method === 'apple_pay') return 'Apple Pay';
  if (p.method === 'google_pay') return 'Google Pay';
  if (p.method === 'ach') return p.achAccountLast4 ? `ACH ····${p.achAccountLast4}` : 'ACH';
  return p.method || '—';
}

function fmtMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}
