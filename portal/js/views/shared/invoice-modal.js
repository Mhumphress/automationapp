// ─────────────────────────────────────────────────────────────────
//  invoice-modal.js — Shared invoice detail modal for the portal.
//  Used from the Billing page and the Invoicing page. Shows full
//  invoice layout (bill-to, line items, totals, notes) and offers a
//  Print / Save as PDF button that opens the invoice in a clean new
//  window, triggers the browser print dialog, and the user saves to
//  PDF from there (no library dependency, works across browsers).
// ─────────────────────────────────────────────────────────────────

import { getTenant } from '../../tenant-context.js';

/**
 * Open the invoice modal. `invoice` may be a tenant invoice
 * (tenants/{t}/invoices/...) or an invoice_crm entry.
 */
export function openInvoiceModal(invoice) {
  if (!invoice) return;
  const tenant = getTenant();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop open';
  backdrop.innerHTML = `
    <div class="modal-dialog invoice-modal-dialog" style="max-width:720px;">
      <div class="modal-header">
        <h2 class="modal-title">Invoice ${escapeHtml(invoice.invoiceNumber || '')}</h2>
        <button class="modal-close" type="button">×</button>
      </div>
      <div class="modal-body" id="invoiceModalBody"></div>
      <div class="modal-footer" style="display:flex;gap:0.5rem;justify-content:flex-end;padding:0.75rem 1.25rem;border-top:1px solid var(--off-white);">
        <button type="button" class="btn btn-ghost" id="invModalClose">Close</button>
        <button type="button" class="btn btn-primary" id="invModalPrint">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:0.3rem;"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          Print / Save as PDF
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const body = backdrop.querySelector('#invoiceModalBody');
  body.innerHTML = renderInvoiceBodyHTML(invoice, tenant);

  const close = () => backdrop.remove();
  backdrop.querySelector('.modal-close').addEventListener('click', close);
  backdrop.querySelector('#invModalClose').addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

  backdrop.querySelector('#invModalPrint').addEventListener('click', () => {
    printInvoice(invoice, tenant);
  });
}

// ── Body rendering (shared by modal and print window) ───────────

function renderInvoiceBodyHTML(invoice, tenant) {
  const company = tenant?.companyName || 'Your Business';
  const lineItems = Array.isArray(invoice.lineItems) ? invoice.lineItems : [];
  const subtotal = Number(invoice.subtotal || 0);
  const taxRate = Number(invoice.taxRate || 0);
  const taxAmount = Number(invoice.taxAmount || 0);
  const total = Number(invoice.total != null ? invoice.total : invoice.amount || 0);
  const paidAmount = Number(invoice.paidAmount || 0);
  const balance = Math.max(0, Math.abs(total) - paidAmount);
  const statusInfo = statusPill(invoice);

  return `
    <div class="inv-print-root">
      <header class="inv-print-header">
        <div>
          <div class="inv-print-company">${escapeHtml(company)}</div>
          ${tenant?.vertical ? `<div class="inv-print-company-sub">${escapeHtml(formatLabel(tenant.vertical))}</div>` : ''}
        </div>
        <div style="text-align:right;">
          <div class="inv-print-number">${escapeHtml(invoice.invoiceNumber || '')}</div>
          <div class="inv-print-status" style="background:${statusInfo.bg};color:${statusInfo.fg};">${escapeHtml(statusInfo.label)}</div>
        </div>
      </header>

      <section class="inv-print-meta">
        <div>
          <div class="inv-print-label">Bill to</div>
          <div class="inv-print-value">${escapeHtml(invoice.clientName || '-')}</div>
          ${invoice.clientEmail ? `<div class="inv-print-value-sub">${escapeHtml(invoice.clientEmail)}</div>` : ''}
        </div>
        <div style="text-align:right;">
          <div class="inv-print-row"><span class="inv-print-label">Issued</span> ${escapeHtml(formatDate(invoice.issueDate || invoice.issuedDate || invoice.createdAt))}</div>
          <div class="inv-print-row"><span class="inv-print-label">Due</span> ${escapeHtml(formatDate(invoice.dueDate))}</div>
        </div>
      </section>

      <table class="inv-print-table">
        <thead>
          <tr><th>Description</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Rate</th><th style="text-align:right;">Amount</th></tr>
        </thead>
        <tbody>
          ${lineItems.length === 0
            ? '<tr><td colspan="4" style="color:#888;padding:1rem;">No line items.</td></tr>'
            : lineItems.map(li => `
              <tr>
                <td>${escapeHtml(li.description || '')}</td>
                <td style="text-align:right;">${escapeHtml(String(li.quantity ?? ''))}</td>
                <td style="text-align:right;">${formatMoney(li.rate ?? 0)}</td>
                <td style="text-align:right;font-variant-numeric:tabular-nums;">${formatMoney(li.amount ?? 0)}</td>
              </tr>
            `).join('')
          }
        </tbody>
      </table>

      <section class="inv-print-totals">
        <div class="inv-print-total-row"><span>Subtotal</span><span>${formatMoney(subtotal || total)}</span></div>
        ${taxAmount ? `<div class="inv-print-total-row"><span>Tax${taxRate ? ` (${taxRate}%)` : ''}</span><span>${formatMoney(taxAmount)}</span></div>` : ''}
        <div class="inv-print-total-row inv-print-grand"><span>Total</span><span>${formatMoney(Math.abs(total))}</span></div>
        ${paidAmount > 0 ? `
          <div class="inv-print-total-row" style="color:#059669;"><span>Paid</span><span>${formatMoney(paidAmount)}</span></div>
          ${balance > 0 ? `<div class="inv-print-total-row" style="color:#dc2626;font-weight:600;"><span>Balance due</span><span>${formatMoney(balance)}</span></div>` : ''}
        ` : ''}
      </section>

      ${invoice.notes ? `
        <section class="inv-print-notes">
          <div class="inv-print-label">Notes</div>
          <div class="inv-print-notes-body">${escapeHtml(invoice.notes)}</div>
        </section>
      ` : ''}

      <footer class="inv-print-footer">
        Thank you for your business.
      </footer>
    </div>
  `;
}

function statusPill(invoice) {
  const s = invoice.status || 'draft';
  if (s === 'paid')     return { label: 'PAID',      bg: '#d1fae5', fg: '#065f46' };
  if (s === 'partial')  return { label: 'PARTIAL',   bg: '#dbeafe', fg: '#1e40af' };
  if (s === 'overdue')  return { label: 'OVERDUE',   bg: '#fee2e2', fg: '#991b1b' };
  if (s === 'sent')     return { label: 'DUE',       bg: '#dbeafe', fg: '#1e40af' };
  if (s === 'refunded') return { label: 'REFUNDED',  bg: '#fef3c7', fg: '#92400e' };
  if (s === 'void' || s === 'cancelled') return { label: s.toUpperCase(), bg: '#f1f5f9', fg: '#334155' };
  return { label: s.toUpperCase(), bg: '#f1f5f9', fg: '#334155' };
}

// ── Print / PDF export ─────────────────────────────────────────
// Exported so views with their own header (like the Invoicing detail
// page) can offer a one-click Print without opening the modal first.

export function printInvoiceDirect(invoice, tenant = null) {
  const t = tenant || getTenant();
  printInvoice(invoice, t);
}

function printInvoice(invoice, tenant) {
  const bodyHTML = renderInvoiceBodyHTML(invoice, tenant);
  const title = `Invoice ${invoice.invoiceNumber || ''}`.trim();
  const stylesheet = PRINT_CSS;

  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w) {
    // Popup blocked — fall back to in-page print using a temporary class
    inlinePrintFallback(bodyHTML);
    return;
  }
  w.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)}</title>
  <style>${stylesheet}</style>
</head>
<body>${bodyHTML}</body>
</html>`);
  w.document.close();
  w.onload = () => {
    setTimeout(() => {
      w.focus();
      w.print();
      // Don't auto-close — user may want to save as PDF then close manually.
    }, 50);
  };
}

function inlinePrintFallback(bodyHTML) {
  // Last-resort: inject into the current document with a print-only class
  // and call window.print(). The print CSS hides everything else.
  const host = document.createElement('div');
  host.className = 'inv-print-fallback';
  host.innerHTML = `<style>${PRINT_CSS}
@media print {
  body > *:not(.inv-print-fallback) { display: none !important; }
  .inv-print-fallback { display: block !important; position: absolute; inset: 0; background: white; }
}
.inv-print-fallback { display: none; }
</style>${bodyHTML}`;
  document.body.appendChild(host);
  window.print();
  setTimeout(() => host.remove(), 1000);
}

// ── Print CSS (standalone — used in the new window + inline fallback) ──

const PRINT_CSS = `
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    color: #0F172A;
    margin: 0;
    padding: 2.5rem;
    background: white;
    line-height: 1.5;
    font-size: 14px;
  }

  .inv-print-root {
    max-width: 760px;
    margin: 0 auto;
  }

  .inv-print-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding-bottom: 1.25rem;
    margin-bottom: 1.75rem;
    border-bottom: 2px solid #0F172A;
  }

  .inv-print-company {
    font-size: 1.75rem;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .inv-print-company-sub {
    color: #64748B;
    font-size: 0.85rem;
    margin-top: 0.2rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .inv-print-number {
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 1.1rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    margin-bottom: 0.35rem;
  }

  .inv-print-status {
    display: inline-block;
    padding: 0.25rem 0.75rem;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.05em;
  }

  .inv-print-meta {
    display: flex;
    justify-content: space-between;
    gap: 2rem;
    margin-bottom: 1.5rem;
  }

  .inv-print-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #64748B;
    font-weight: 600;
  }

  .inv-print-value {
    font-size: 1rem;
    font-weight: 600;
    margin-top: 0.2rem;
  }

  .inv-print-value-sub {
    color: #64748B;
    font-size: 0.85rem;
  }

  .inv-print-row {
    font-size: 0.9rem;
    margin-top: 0.2rem;
  }
  .inv-print-row .inv-print-label { margin-right: 0.5rem; }

  .inv-print-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 1.5rem;
  }
  .inv-print-table th {
    text-align: left;
    padding: 0.6rem 0.75rem;
    background: #F8FAFC;
    color: #334155;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-bottom: 1px solid #E2E8F0;
  }
  .inv-print-table td {
    padding: 0.7rem 0.75rem;
    border-bottom: 1px solid #F1F5F9;
    vertical-align: top;
    font-size: 0.92rem;
  }

  .inv-print-totals {
    margin-left: auto;
    max-width: 320px;
    margin-bottom: 1.75rem;
  }
  .inv-print-total-row {
    display: flex;
    justify-content: space-between;
    padding: 0.35rem 0;
    font-size: 0.92rem;
    font-variant-numeric: tabular-nums;
  }
  .inv-print-total-row.inv-print-grand {
    font-size: 1.15rem;
    font-weight: 700;
    padding-top: 0.6rem;
    margin-top: 0.4rem;
    border-top: 2px solid #0F172A;
  }

  .inv-print-notes {
    background: #F8FAFC;
    border-left: 3px solid #64748B;
    padding: 0.85rem 1rem;
    margin-bottom: 1.75rem;
  }
  .inv-print-notes-body {
    margin-top: 0.3rem;
    font-size: 0.92rem;
    white-space: pre-wrap;
  }

  .inv-print-footer {
    text-align: center;
    color: #94A3B8;
    font-size: 0.85rem;
    padding-top: 1.5rem;
    border-top: 1px solid #E2E8F0;
  }

  @media print {
    body { padding: 1rem; }
    .inv-print-root { max-width: 100%; }
    @page { margin: 0.75in; }
  }
`;

// ── Utility helpers (self-contained so the module can be imported
//    from any view without bringing in portal runtime deps). ──

function escapeHtml(s) {
  if (s == null) return '';
  const n = document.createElement('span');
  n.appendChild(document.createTextNode(String(s)));
  return n.innerHTML;
}

function formatMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);
}

function formatDate(ts) {
  if (!ts) return '—';
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return '—'; }
}

function formatLabel(s) {
  if (!s) return '';
  return String(s).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
