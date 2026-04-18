// ─────────────────────────────────────────────────────────────────
//  quick-invoice-section.js — Generic "bill this record" section
//  injected into any vertical detail page via detailSections.
//
//  Usage (in record-configs.js):
//    detailSections: [
//      { title: 'Billing', render: makeQuickInvoiceSection({
//          parentType: 'job',
//          buildLineItems: (rec) => [...],
//          customerFields: { name: 'customerName', email: 'customerEmail' },
//      }) },
//    ]
// ─────────────────────────────────────────────────────────────────

import { generateOneTimeInvoice, listInvoicesGeneratedFor } from '../services/recurring-billing.js';

/**
 * @param {object} opts
 * @param {string} opts.parentType            e.g. 'job', 'maintenance', 'appointment'
 * @param {Function} opts.buildLineItems      (record) => [{description, quantity, rate, amount}]
 * @param {object} [opts.customerFields]      { name: 'customerName', email: 'customerEmail' }
 * @param {string} [opts.chargeType]          catalog hint for the invoice
 * @param {number} [opts.dueInDays=14]
 */
export function makeQuickInvoiceSection(opts) {
  return function renderSection(record, env, ctx) {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<div style="color:var(--gray);font-size:0.85rem;">Loading…</div>';
    init(wrap, record, env, ctx, opts);
    return wrap;
  };
}

async function init(wrap, record, env, { reload }, opts) {
  const customerField = opts.customerFields?.name || 'customerName';
  const emailField = opts.customerFields?.email || 'customerEmail';
  const customerName = record[customerField] || record.tenantName || record.clientName || record.name || '';
  const customerEmail = record[emailField] || '';

  const existing = await listInvoicesGeneratedFor(env.tenantId, opts.parentType, record.id);
  wrap.innerHTML = '';

  // Summary
  const summary = document.createElement('div');
  const paid = existing.filter(i => i.status === 'paid').reduce((s, i) => s + (Number(i.total) || 0), 0);
  const open = existing.filter(i => ['sent', 'overdue', 'partial'].includes(i.status)).reduce((s, i) => s + (Number(i.total) || 0), 0);
  summary.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:0.5rem;margin-bottom:0.75rem;';
  summary.innerHTML = `
    ${kpi('Customer', customerName || '—')}
    ${kpi('Invoices', String(existing.length))}
    ${kpi('Open balance', fmtMoney(open))}
    ${kpi('Paid to date', fmtMoney(paid))}
  `;
  wrap.appendChild(summary);

  // Action
  if (env.canWrite) {
    const actionRow = document.createElement('div');
    actionRow.style.cssText = 'display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.75rem;';
    actionRow.innerHTML = `<button class="btn btn-primary btn-sm" data-action="bill">+ Create Invoice</button>`;
    actionRow.querySelector('[data-action="bill"]').addEventListener('click', () => {
      openBillModal(record, env, opts, reload, { customerName, customerEmail });
    });
    wrap.appendChild(actionRow);
  }

  // Invoice history
  const historyBox = document.createElement('div');
  historyBox.className = 'settings-section';
  historyBox.innerHTML = `<h3 class="section-title">Invoices from this ${formatLabel(opts.parentType)}</h3>`;
  if (!existing.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:0.5rem 0;color:var(--gray);font-size:0.85rem;';
    empty.textContent = 'No invoices yet.';
    historyBox.appendChild(empty);
  } else {
    const table = document.createElement('table');
    table.className = 'data-table';
    table.innerHTML = `
      <thead><tr><th>Invoice #</th><th>Issued</th><th>Due</th><th>Amount</th><th>Status</th></tr></thead>
      <tbody>
        ${existing.map(i => `
          <tr>
            <td style="font-family:var(--font-mono);">${escapeHtml(i.invoiceNumber || '-')}</td>
            <td>${escapeHtml(i.issueDate || '—')}</td>
            <td>${escapeHtml(i.dueDate || '—')}</td>
            <td>${escapeHtml(fmtMoney(i.total))}</td>
            <td><span class="badge ${badgeFor(i.status)}">${escapeHtml(statusLabel(i.status))}</span></td>
          </tr>
        `).join('')}
      </tbody>
    `;
    historyBox.appendChild(table);
  }
  wrap.appendChild(historyBox);
}

function openBillModal(record, env, opts, reload, { customerName, customerEmail }) {
  const suggestedLines = safeBuild(opts.buildLineItems, record);
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop open';
  backdrop.innerHTML = `
    <div class="modal-dialog">
      <div class="modal-header">
        <h2 class="modal-title">Create Invoice</h2>
        <button class="modal-close" type="button">×</button>
      </div>
      <div class="modal-body">
        <form class="modal-form" id="qiForm">
          <div class="modal-form-grid">
            <div class="modal-field">
              <label>Customer *</label>
              <input type="text" name="customerName" required value="${escapeAttr(customerName)}">
            </div>
            <div class="modal-field">
              <label>Email</label>
              <input type="email" name="customerEmail" value="${escapeAttr(customerEmail)}">
            </div>
          </div>
          <div class="modal-field">
            <label>Line items</label>
            <div id="qiLines"></div>
            <button type="button" class="btn btn-ghost btn-sm" id="qiAddLine">+ Add line</button>
          </div>
          <div class="modal-form-grid">
            <div class="modal-field">
              <label>Due in days</label>
              <input type="number" name="dueInDays" min="0" value="${opts.dueInDays || 14}">
            </div>
            <div class="modal-field">
              <label>Total</label>
              <input type="text" id="qiTotal" disabled style="background:var(--off-white);">
            </div>
          </div>
          <div class="modal-field">
            <label>Notes</label>
            <textarea name="notes" rows="2"></textarea>
          </div>
          <div class="modal-actions">
            <button type="submit" class="btn btn-primary btn-lg">Create Invoice</button>
            <span class="modal-cancel">Cancel</span>
          </div>
        </form>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector('.modal-close').addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector('.modal-cancel').addEventListener('click', close);

  const linesWrap = backdrop.querySelector('#qiLines');
  const totalEl = backdrop.querySelector('#qiTotal');
  const lines = [];
  function addLine(pref) {
    const idx = lines.length;
    const row = document.createElement('div');
    row.className = 'qi-line';
    row.style.cssText = 'display:grid;grid-template-columns:1fr 80px 100px 100px 30px;gap:0.4rem;margin-bottom:0.4rem;align-items:center;';
    row.innerHTML = `
      <input type="text" name="desc_${idx}" placeholder="Description" value="${escapeAttr(pref?.description || '')}">
      <input type="number" name="qty_${idx}" step="0.5" min="0" value="${pref?.quantity || 1}" placeholder="Qty">
      <input type="number" name="rate_${idx}" step="0.01" min="0" value="${pref?.rate || pref?.amount || ''}" placeholder="Rate">
      <input type="number" name="amount_${idx}" step="0.01" min="0" value="${pref?.amount || ''}" placeholder="Amount" readonly style="background:var(--off-white);">
      <button type="button" class="btn btn-ghost btn-sm qi-remove" style="color:var(--danger,#dc2626);">×</button>
    `;
    linesWrap.appendChild(row);
    lines.push(row);

    const [desc, qty, rate, amt] = row.querySelectorAll('input');
    function recalc() {
      const a = (Number(qty.value) || 0) * (Number(rate.value) || 0);
      amt.value = a.toFixed(2);
      updateTotal();
    }
    qty.addEventListener('input', recalc);
    rate.addEventListener('input', recalc);
    row.querySelector('.qi-remove').addEventListener('click', () => {
      row.remove();
      lines.splice(lines.indexOf(row), 1);
      updateTotal();
    });
    recalc();
  }
  function updateTotal() {
    const sum = lines.reduce((s, row) => {
      const amt = Number(row.querySelector('input[name^="amount_"]').value) || 0;
      return s + amt;
    }, 0);
    totalEl.value = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(sum);
  }

  (suggestedLines.length ? suggestedLines : [{ description: '', quantity: 1, rate: 0, amount: 0 }])
    .forEach(l => addLine(l));
  backdrop.querySelector('#qiAddLine').addEventListener('click', () => addLine());

  backdrop.querySelector('#qiForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const fd = new FormData(e.target);
    const customerName = (fd.get('customerName') || '').toString().trim();
    const customerEmail = (fd.get('customerEmail') || '').toString().trim();
    const notes = (fd.get('notes') || '').toString().trim();
    const dueInDays = Number(fd.get('dueInDays')) || 0;
    const lineItems = lines.map(row => {
      const inputs = row.querySelectorAll('input');
      return {
        description: inputs[0].value.trim(),
        quantity: Number(inputs[1].value) || 1,
        rate: Number(inputs[2].value) || 0,
        amount: Number(inputs[3].value) || 0,
      };
    }).filter(l => l.description && l.amount > 0);

    if (!lineItems.length) {
      showToast('Add at least one line item', 'error');
      return;
    }
    btn.disabled = true;
    try {
      await generateOneTimeInvoice(env.tenantId, {
        customerName,
        customerEmail,
        parentType: opts.parentType,
        parentId: record.id,
        chargeType: opts.chargeType || 'service',
        dueInDays,
        notes,
        lineItems,
      });
      showToast('Invoice created', 'success');
      close();
      reload();
    } catch (err) {
      console.error(err);
      showToast('Failed: ' + err.message, 'error');
      btn.disabled = false;
    }
  });
}

function safeBuild(fn, record) {
  try { return typeof fn === 'function' ? (fn(record) || []) : []; }
  catch { return []; }
}

// ── Local utility helpers ─────────────────────────────────

function kpi(label, value) {
  return `
    <div style="padding:0.6rem 0.75rem;background:var(--off-white,#F1F5F9);border-radius:8px;">
      <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--gray-dark,#64748B);">${escapeHtml(label)}</div>
      <div style="font-size:1rem;font-weight:600;margin-top:0.15rem;">${escapeHtml(value)}</div>
    </div>
  `;
}
function fmtMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}
function formatLabel(s) {
  if (!s) return '';
  return String(s).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
function badgeFor(s) {
  return s === 'paid' ? 'badge-success'
       : s === 'overdue' ? 'badge-danger'
       : s === 'sent' ? 'badge-info'
       : s === 'partial' ? 'badge-info'
       : 'badge-default';
}
function statusLabel(s) { return s === 'sent' ? 'due' : (s || 'draft'); }
function escapeHtml(s) {
  if (s == null) return '';
  const n = document.createElement('span');
  n.appendChild(document.createTextNode(String(s)));
  return n.innerHTML;
}
function escapeAttr(s) { return String(s || '').replace(/"/g, '&quot;'); }
function showToast(msg, type) {
  const c = document.getElementById('toastContainer');
  if (!c) { alert(msg); return; }
  const t = document.createElement('div');
  t.className = `toast toast-${type || 'info'}`;
  t.textContent = msg;
  c.appendChild(t);
  requestAnimationFrame(() => t.classList.add('toast-visible'));
  setTimeout(() => { t.classList.remove('toast-visible'); setTimeout(() => t.remove(), 400); }, 3000);
}
