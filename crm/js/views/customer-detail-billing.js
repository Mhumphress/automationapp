// ─────────────────────────────────────────────────────────────────
//  customer-detail-billing.js — Billing tab of Customer 360.
//  Invoices, payments ledger, record-payment modal, CSV export.
// ─────────────────────────────────────────────────────────────────

import { showToast, escapeHtml, formatDate } from '../ui.js';
import { downloadCSV, formatMoney as csvMoney, formatTimestamp } from '../utils/csv.js';
import { openRecordPaymentModal } from '../components/record-payment-modal.js';
import {
  invoiceEffectiveAmount, sumPaid, sumOpen, sumOverdue, sumRefunds, formatMoney
} from '../services/money.js';

let filterState = { status: 'all', from: '', to: '' };

export function renderBillingTab(body, state, rerender) {
  filterState = { status: 'all', from: '', to: '' };
  const customerInvoices = (state.invoices || []).filter(i => i.clientId === state.contact.id);

  // KPI strip
  const kpiRow = document.createElement('div');
  kpiRow.className = 'customer-kpi-row';
  kpiRow.innerHTML = `
    <div class="cust-kpi"><span class="cust-kpi-label">Paid</span><span class="cust-kpi-value">${escapeHtml(formatMoney(sumPaid(customerInvoices)))}</span></div>
    <div class="cust-kpi"><span class="cust-kpi-label">Open</span><span class="cust-kpi-value">${escapeHtml(formatMoney(sumOpen(customerInvoices)))}</span></div>
    <div class="cust-kpi"><span class="cust-kpi-label">Overdue</span><span class="cust-kpi-value cust-kpi-warn">${escapeHtml(formatMoney(sumOverdue(customerInvoices)))}</span></div>
    <div class="cust-kpi"><span class="cust-kpi-label">Refunds</span><span class="cust-kpi-value">${escapeHtml(formatMoney(sumRefunds(customerInvoices)))}</span></div>
  `;
  body.appendChild(kpiRow);

  // Action bar
  const actionBar = document.createElement('div');
  actionBar.className = 'billing-action-bar';
  actionBar.innerHTML = `
    <div class="billing-filter-group">
      <label>Status
        <select data-filter="status">
          <option value="all">All</option>
          <option value="paid">Paid</option>
          <option value="sent">Sent</option>
          <option value="partial">Partial</option>
          <option value="overdue">Overdue</option>
          <option value="draft">Draft</option>
          <option value="refund">Refund</option>
        </select>
      </label>
      <label>From <input type="date" data-filter="from"></label>
      <label>To <input type="date" data-filter="to"></label>
    </div>
    <div class="billing-action-right">
      ${state.tenant ? `<button class="btn btn-primary btn-sm" data-action="record-payment">Record Payment</button>` : ''}
      <button class="btn btn-ghost btn-sm" data-action="export-invoices">Export invoices</button>
    </div>
  `;
  body.appendChild(actionBar);

  // Invoice table
  const invoicesWrap = document.createElement('div');
  invoicesWrap.className = 'settings-section';
  invoicesWrap.innerHTML = `<h3 class="section-title">Invoices</h3><div class="billing-invoices-body"></div>`;
  body.appendChild(invoicesWrap);

  // Payments ledger
  const paymentsWrap = document.createElement('div');
  paymentsWrap.className = 'settings-section';
  paymentsWrap.innerHTML = `<h3 class="section-title">Payments</h3><div class="billing-payments-body"></div>`;
  body.appendChild(paymentsWrap);

  function redrawTables() {
    renderInvoicesTable(invoicesWrap.querySelector('.billing-invoices-body'), customerInvoices, filterState);
    renderPaymentsTable(paymentsWrap.querySelector('.billing-payments-body'), state.payments, state.invoices);
  }

  actionBar.querySelectorAll('[data-filter]').forEach(el => {
    el.addEventListener('change', () => {
      filterState[el.dataset.filter] = el.value;
      redrawTables();
    });
  });

  actionBar.querySelector('[data-action="record-payment"]')?.addEventListener('click', async () => {
    if (!state.tenant) {
      showToast('This customer has no tenant yet.', 'error');
      return;
    }
    const openInvoices = customerInvoices.filter(i =>
      ['sent', 'draft', 'overdue', 'partial', 'issued'].includes(i.status)
    );
    const result = await openRecordPaymentModal({
      tenantId: state.tenant.id,
      invoices: openInvoices,
    });
    if (result && result.recorded) {
      await rerenderWithFresh(state, rerender);
    }
  });

  actionBar.querySelector('[data-action="export-invoices"]').addEventListener('click', () => {
    exportInvoices(state.contact, customerInvoices);
  });

  redrawTables();
}

function renderInvoicesTable(container, invoices, filters) {
  const filtered = invoices.filter(i => {
    if (filters.status && filters.status !== 'all') {
      if (filters.status === 'refund') {
        if (i.type !== 'refund') return false;
      } else if (i.status !== filters.status) {
        return false;
      }
    }
    if (filters.from) {
      const d = invoiceDateMs(i);
      if (!d || d < new Date(filters.from).getTime()) return false;
    }
    if (filters.to) {
      const d = invoiceDateMs(i);
      if (!d || d > new Date(filters.to).getTime() + 86400000) return false;
    }
    return true;
  });

  if (!filtered.length) {
    container.innerHTML = '<div style="padding:1rem;color:var(--gray);font-size:0.85rem;">No invoices match filters.</div>';
    return;
  }

  container.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Invoice #</th>
          <th>Issued</th>
          <th>Due</th>
          <th>Total</th>
          <th>Paid</th>
          <th>Balance</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map(i => {
          const eff = invoiceEffectiveAmount(i);
          const paidAmt = Number(i.paidAmount) || 0;
          const bal = Math.max(0, Math.abs(eff) - paidAmt);
          const issued = i.issueDate || i.issuedDate || i.createdAt;
          return `
            <tr class="clickable" data-invoice-id="${escapeHtml(i.id)}">
              <td style="font-family:var(--font-mono);">${escapeHtml(i.invoiceNumber || '-')}</td>
              <td>${escapeHtml(formatDate(issued))}</td>
              <td>${escapeHtml(i.dueDate ? formatDate(i.dueDate) : '—')}</td>
              <td>${escapeHtml(formatMoney(eff))}</td>
              <td>${paidAmt ? escapeHtml(formatMoney(paidAmt)) : '—'}</td>
              <td>${i.status === 'paid' ? '—' : escapeHtml(formatMoney(bal))}</td>
              <td><span class="badge ${badgeClass(i.status, i.type)}">${escapeHtml(i.type === 'refund' ? 'Refund' : (i.status || 'draft'))}</span></td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
  container.querySelectorAll('tr[data-invoice-id]').forEach(tr => {
    tr.addEventListener('click', async () => {
      const m = await import('./invoices.js');
      m.requestInvoice(tr.dataset.invoiceId);
      window.location.hash = 'invoices';
    });
  });
}

function renderPaymentsTable(container, payments, invoices) {
  if (!payments || !payments.length) {
    container.innerHTML = '<div style="padding:1rem;color:var(--gray);font-size:0.85rem;">No payments recorded.</div>';
    return;
  }
  const byInvoice = {};
  (invoices || []).forEach(i => { byInvoice[i.id] = i; });

  container.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Received</th>
          <th>Amount</th>
          <th>Method</th>
          <th>Reference</th>
          <th>Applied to</th>
          <th>Recorded by</th>
        </tr>
      </thead>
      <tbody>
        ${payments.map(p => {
          const appliedLabels = (p.appliedTo || []).map(a => {
            const inv = byInvoice[a.invoiceId];
            return `${inv?.invoiceNumber || a.invoiceId} (${formatMoney(a.amount)})`;
          }).join(', ');
          const sign = p.type === 'refund' ? '-' : '';
          return `
            <tr>
              <td>${escapeHtml(formatDate(p.receivedAt || p.recordedAt))}</td>
              <td style="font-family:var(--font-mono);">${escapeHtml(sign + formatMoney(p.amount))}</td>
              <td>${escapeHtml(p.method || 'manual')}</td>
              <td>${escapeHtml(p.reference || '—')}</td>
              <td>${escapeHtml(appliedLabels || '—')}</td>
              <td>${escapeHtml(p.recordedByEmail || '—')}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

async function rerenderWithFresh(state, rerender) {
  const [{ listPayments }, { queryDocuments }] = await Promise.all([
    import('../services/payments.js'),
    import('../services/firestore.js'),
  ]);
  state.payments = await listPayments(state.tenant.id);
  try {
    state.invoices = await queryDocuments('invoices', 'createdAt', 'desc');
  } catch (err) { console.warn('invoice refresh failed:', err); }
  rerender();
}

function exportInvoices(contact, invoices) {
  const filename = `invoices-${(contact.lastName || 'customer').toLowerCase()}-${new Date().toISOString().slice(0,10)}.csv`;
  downloadCSV(filename, invoices, [
    { key: 'invoiceNumber', label: 'Invoice #' },
    { key: 'issueDate',     label: 'Issued',      format: formatTimestamp },
    { key: 'dueDate',       label: 'Due',         format: formatTimestamp },
    { key: 'total',         label: 'Total',       format: (v, r) => csvMoney(invoiceEffectiveAmount(r)) },
    { key: 'paidAmount',    label: 'Paid',        format: csvMoney },
    { key: 'status',        label: 'Status' },
    { key: 'type',          label: 'Type' },
  ]);
}

function badgeClass(s, type) {
  if (type === 'refund') return 'badge-warning';
  return s === 'paid' ? 'badge-success'
       : s === 'partial' ? 'badge-info'
       : s === 'sent' ? 'badge-info'
       : s === 'overdue' ? 'badge-danger'
       : s === 'refunded' ? 'badge-warning'
       : 'badge-default';
}

function invoiceDateMs(i) {
  const raw = i.issueDate || i.issuedDate || i.createdAt;
  if (!raw) return 0;
  if (raw.toDate) return raw.toDate().getTime();
  return new Date(raw).getTime() || 0;
}
