import { addDocument, updateDocument, deleteDocument, queryDocuments } from '../../services/firestore.js';
import { canWrite, gateWrite } from '../../tenant-context.js';

let invoices = [];
let currentPage = 'list';
let pendingDeepLinkId = null;

// Called by other views (e.g., customer profile) to request that we open a
// specific invoice after navigating to #invoicing.
export function requestInvoice(invoiceId) {
  pendingDeepLinkId = invoiceId;
}

export function init() {}

export async function render() {
  try { invoices = await queryDocuments('invoices_crm', 'createdAt', 'desc'); } catch (err) { console.error(err); invoices = []; }
  if (pendingDeepLinkId) {
    const id = pendingDeepLinkId;
    pendingDeepLinkId = null;
    const inv = invoices.find(i => i.id === id);
    if (inv) return showDetail(inv);
  }
  if (currentPage === 'list') renderList();
}

export function destroy() { currentPage = 'list'; }

function renderList() {
  const container = document.getElementById('view-invoicing');
  container.innerHTML = '';

  const topbar = document.createElement('div');
  topbar.className = 'view-topbar';
  topbar.innerHTML = `
    ${canWrite() ? `<button class="btn btn-primary" id="addInvoiceBtn">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      New Invoice
    </button>` : ''}
  `;
  container.appendChild(topbar);

  const addBtn = topbar.querySelector('#addInvoiceBtn');
  if (addBtn) addBtn.addEventListener('click', gateWrite(() => openCreateForm()));

  const wrapper = document.createElement('div');
  wrapper.className = 'view-content';

  if (invoices.length === 0) {
    wrapper.innerHTML = '<div class="empty-state"><div class="empty-title">No invoices yet</div><p class="empty-description">Create your first invoice to start billing clients.</p></div>';
  } else {
    const table = document.createElement('table');
    table.className = 'data-table';
    table.innerHTML = '<thead><tr><th>Invoice #</th><th>Client</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead>';
    const tbody = document.createElement('tbody');

    invoices.forEach(inv => {
      const statusClass = inv.status === 'paid' ? 'badge-success' : inv.status === 'sent' ? 'badge-info' : inv.status === 'overdue' ? 'badge-danger' : 'badge-default';
      const tr = document.createElement('tr');
      tr.className = 'clickable';
      tr.innerHTML = `
        <td style="font-weight:500;">${escapeHtml(inv.invoiceNumber || '-')}</td>
        <td>${escapeHtml(inv.clientName || '-')}</td>
        <td>${formatCurrency(inv.total || 0)}</td>
        <td><span class="badge ${statusClass}">${escapeHtml(inv.status || 'draft')}</span></td>
        <td>${formatDate(inv.issueDate || inv.createdAt)}</td>
      `;
      tr.addEventListener('click', () => showDetail(inv));
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrapper.appendChild(table);
  }

  container.appendChild(wrapper);
}

function openCreateForm() {
  currentPage = 'create';
  const container = document.getElementById('view-invoicing');
  container.innerHTML = '';

  const backBtn = document.createElement('button');
  backBtn.className = 'detail-back';
  backBtn.innerHTML = '&larr; Back';
  backBtn.addEventListener('click', () => { currentPage = 'list'; renderList(); });
  container.appendChild(backBtn);

  const invNum = `INV-${String(Date.now()).slice(-6)}`;

  const form = document.createElement('form');
  form.className = 'modal-form';
  form.style.maxWidth = '700px';
  form.innerHTML = `
    <h2 style="margin-bottom:1rem;">New Invoice</h2>
    <div class="modal-form-grid">
      <div class="modal-field"><label>Invoice #</label><input type="text" name="invoiceNumber" value="${invNum}" readonly style="background:var(--bg);"></div>
      <div class="modal-field"><label>Client Name *</label><input type="text" name="clientName" required></div>
    </div>
    <div class="modal-form-grid">
      <div class="modal-field"><label>Issue Date</label><input type="date" name="issueDate" value="${new Date().toISOString().split('T')[0]}"></div>
      <div class="modal-field"><label>Due Date</label><input type="date" name="dueDate" value="${new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0]}"></div>
    </div>

    <div class="modal-field"><label>Line Items</label></div>
    <table class="data-table" id="lineItemsTable" style="margin-bottom:0.5rem;">
      <thead><tr><th>Description</th><th style="width:80px;">Qty</th><th style="width:100px;">Rate</th><th style="width:100px;">Amount</th><th style="width:40px;"></th></tr></thead>
      <tbody id="lineItemsBody">
        <tr class="line-item-row">
          <td><input type="text" name="desc_0" placeholder="Description" style="width:100%;border:none;outline:none;"></td>
          <td><input type="number" name="qty_0" value="1" step="0.5" min="0" style="width:100%;border:none;outline:none;text-align:right;"></td>
          <td><input type="number" name="rate_0" value="0" step="0.01" min="0" style="width:100%;border:none;outline:none;text-align:right;"></td>
          <td class="line-amount" style="text-align:right;">$0.00</td>
          <td><button type="button" class="btn btn-ghost btn-sm remove-line" style="color:var(--danger);padding:0.2rem;">&times;</button></td>
        </tr>
      </tbody>
    </table>
    <button type="button" class="btn btn-ghost btn-sm" id="addLineBtn">+ Add Line</button>

    <div style="display:flex;justify-content:flex-end;margin-top:1rem;gap:1rem;align-items:center;">
      <span id="invoiceTotal" style="font-size:1.1rem;font-weight:600;">Total: $0.00</span>
    </div>

    <div class="modal-field" style="margin-top:1rem;"><label>Notes</label><textarea name="notes" rows="2"></textarea></div>
    <div style="display:flex;gap:0.5rem;margin-top:1rem;">
      <button type="submit" class="btn btn-primary">Create Invoice</button>
      <button type="button" class="btn btn-ghost" id="cancelCreate">Cancel</button>
    </div>
  `;

  let lineCount = 1;

  function recalcTotals() {
    let total = 0;
    form.querySelectorAll('.line-item-row').forEach((row, i) => {
      const qty = parseFloat(row.querySelector(`[name^="qty_"]`).value) || 0;
      const rate = parseFloat(row.querySelector(`[name^="rate_"]`).value) || 0;
      const amount = qty * rate;
      total += amount;
      row.querySelector('.line-amount').textContent = formatCurrency(amount);
    });
    form.querySelector('#invoiceTotal').textContent = `Total: ${formatCurrency(total)}`;
  }

  form.addEventListener('input', (e) => {
    if (e.target.name && (e.target.name.startsWith('qty_') || e.target.name.startsWith('rate_'))) recalcTotals();
  });

  form.querySelector('#addLineBtn').addEventListener('click', () => {
    const tbody = form.querySelector('#lineItemsBody');
    const tr = document.createElement('tr');
    tr.className = 'line-item-row';
    tr.innerHTML = `
      <td><input type="text" name="desc_${lineCount}" placeholder="Description" style="width:100%;border:none;outline:none;"></td>
      <td><input type="number" name="qty_${lineCount}" value="1" step="0.5" min="0" style="width:100%;border:none;outline:none;text-align:right;"></td>
      <td><input type="number" name="rate_${lineCount}" value="0" step="0.01" min="0" style="width:100%;border:none;outline:none;text-align:right;"></td>
      <td class="line-amount" style="text-align:right;">$0.00</td>
      <td><button type="button" class="btn btn-ghost btn-sm remove-line" style="color:var(--danger);padding:0.2rem;">&times;</button></td>
    `;
    tbody.appendChild(tr);
    lineCount++;
  });

  form.addEventListener('click', (e) => {
    if (e.target.classList.contains('remove-line')) {
      const row = e.target.closest('tr');
      if (form.querySelectorAll('.line-item-row').length > 1) { row.remove(); recalcTotals(); }
    }
  });

  form.querySelector('#cancelCreate').addEventListener('click', () => { currentPage = 'list'; renderList(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const lineItems = [];
    let total = 0;
    form.querySelectorAll('.line-item-row').forEach((row, i) => {
      const desc = row.querySelector(`[name^="desc_"]`).value.trim();
      const qty = parseFloat(row.querySelector(`[name^="qty_"]`).value) || 0;
      const rate = parseFloat(row.querySelector(`[name^="rate_"]`).value) || 0;
      const amount = qty * rate;
      if (desc) { lineItems.push({ description: desc, quantity: qty, rate, amount }); total += amount; }
    });

    try {
      await addDocument('invoices_crm', {
        invoiceNumber: fd.get('invoiceNumber'),
        clientName: fd.get('clientName').trim(),
        issueDate: fd.get('issueDate'),
        dueDate: fd.get('dueDate'),
        lineItems,
        subtotal: total,
        taxRate: 0,
        taxAmount: 0,
        total,
        status: 'draft',
        notes: fd.get('notes').trim()
      });
      currentPage = 'list';
      await render();
    } catch (err) {
      console.error('Create invoice failed:', err);
      alert('Failed to create invoice: ' + err.message);
    }
  });

  container.appendChild(form);
}

function openEditForm(inv) {
  currentPage = 'edit';
  const container = document.getElementById('view-invoicing');
  container.innerHTML = '';

  const backBtn = document.createElement('button');
  backBtn.className = 'detail-back';
  backBtn.innerHTML = '&larr; Back';
  backBtn.addEventListener('click', () => { showDetail(inv); });
  container.appendChild(backBtn);

  const form = document.createElement('form');
  form.className = 'modal-form';
  form.style.maxWidth = '700px';

  const existingLines = Array.isArray(inv.lineItems) ? inv.lineItems : [];
  const nonDiscountLines = existingLines.filter(l => !l.isDiscount);
  const discountLine = existingLines.find(l => l.isDiscount);
  const hasDiscount = !!discountLine || (inv.discountAmount || 0) > 0;

  form.innerHTML = `
    <h2 style="margin-bottom:1rem;">Edit Invoice ${escapeHtml(inv.invoiceNumber)}</h2>
    <div class="modal-form-grid">
      <div class="modal-field"><label>Invoice #</label><input type="text" name="invoiceNumber" value="${escapeHtml(inv.invoiceNumber || '')}" readonly style="background:var(--bg);"></div>
      <div class="modal-field"><label>Client Name *</label><input type="text" name="clientName" required value="${escapeHtml(inv.clientName || '')}"></div>
    </div>
    <div class="modal-form-grid">
      <div class="modal-field"><label>Issue Date</label><input type="date" name="issueDate" value="${escapeHtml(inv.issueDate || new Date().toISOString().split('T')[0])}"></div>
      <div class="modal-field"><label>Due Date</label><input type="date" name="dueDate" value="${escapeHtml(inv.dueDate || '')}"></div>
    </div>

    <div class="modal-field"><label>Line Items</label></div>
    <table class="data-table" id="lineItemsTable" style="margin-bottom:0.5rem;">
      <thead><tr><th>Description</th><th style="width:80px;">Qty</th><th style="width:100px;">Rate</th><th style="width:100px;">Amount</th><th style="width:40px;"></th></tr></thead>
      <tbody id="lineItemsBody">
        ${nonDiscountLines.map((li, i) => `
          <tr class="line-item-row">
            <td><input type="text" name="desc_${i}" value="${escapeHtml(li.description || '')}" style="width:100%;border:none;outline:none;"></td>
            <td><input type="number" name="qty_${i}" value="${li.quantity || 0}" step="0.5" min="0" style="width:100%;border:none;outline:none;text-align:right;"></td>
            <td><input type="number" name="rate_${i}" value="${li.rate || 0}" step="0.01" min="0" style="width:100%;border:none;outline:none;text-align:right;"></td>
            <td class="line-amount" style="text-align:right;">${formatCurrency(li.amount || 0)}</td>
            <td><button type="button" class="btn btn-ghost btn-sm remove-line" style="color:var(--danger);padding:0.2rem;">&times;</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <button type="button" class="btn btn-ghost btn-sm" id="addLineBtn">+ Add Line</button>

    <details style="margin-top:1rem;" ${hasDiscount ? 'open' : ''}>
      <summary style="cursor:pointer;font-weight:500;padding:0.25rem 0;">Discount</summary>
      <div class="modal-form-grid" style="padding-top:0.5rem;">
        <div class="modal-field">
          <label>Reason</label>
          <input type="text" name="discountReason" value="${escapeHtml(inv.discountReason || '')}" placeholder="e.g., Military">
        </div>
        <div class="modal-field">
          <label>Type</label>
          <select name="discountType">
            <option value="percent" ${inv.discountType === 'percent' ? 'selected' : ''}>% off</option>
            <option value="amount" ${inv.discountType === 'amount' ? 'selected' : ''}>$ off</option>
          </select>
        </div>
        <div class="modal-field">
          <label>Value</label>
          <input type="number" name="discountValue" min="0" step="0.01" value="${inv.discountValue || 0}">
        </div>
      </div>
    </details>

    <div style="display:flex;justify-content:flex-end;margin-top:1rem;gap:1rem;align-items:center;">
      <span id="invoiceSubtotal" style="color:var(--gray);">Subtotal: ${formatCurrency(0)}</span>
      <span id="invoiceDiscount" style="color:#059669;">Discount: ${formatCurrency(0)}</span>
      <span id="invoiceTotal" style="font-size:1.1rem;font-weight:600;">Total: ${formatCurrency(0)}</span>
    </div>

    <div class="modal-field" style="margin-top:1rem;"><label>Notes</label><textarea name="notes" rows="2">${escapeHtml(inv.notes || '')}</textarea></div>
    <div style="display:flex;gap:0.5rem;margin-top:1rem;">
      <button type="submit" class="btn btn-primary">Save Changes</button>
      <button type="button" class="btn btn-ghost" id="cancelEdit">Cancel</button>
    </div>
  `;

  let lineCount = nonDiscountLines.length || 1;
  if (nonDiscountLines.length === 0) {
    // Add one empty row
    const tbody = form.querySelector('#lineItemsBody');
    const tr = document.createElement('tr');
    tr.className = 'line-item-row';
    tr.innerHTML = `
      <td><input type="text" name="desc_0" placeholder="Description" style="width:100%;border:none;outline:none;"></td>
      <td><input type="number" name="qty_0" value="1" step="0.5" min="0" style="width:100%;border:none;outline:none;text-align:right;"></td>
      <td><input type="number" name="rate_0" value="0" step="0.01" min="0" style="width:100%;border:none;outline:none;text-align:right;"></td>
      <td class="line-amount" style="text-align:right;">$0.00</td>
      <td><button type="button" class="btn btn-ghost btn-sm remove-line" style="color:var(--danger);padding:0.2rem;">&times;</button></td>
    `;
    tbody.appendChild(tr);
  }

  function recalcTotals() {
    let subtotal = 0;
    form.querySelectorAll('.line-item-row').forEach((row) => {
      const qty = parseFloat(row.querySelector(`[name^="qty_"]`).value) || 0;
      const rate = parseFloat(row.querySelector(`[name^="rate_"]`).value) || 0;
      const amount = qty * rate;
      subtotal += amount;
      row.querySelector('.line-amount').textContent = formatCurrency(amount);
    });

    const dType = form.querySelector('[name="discountType"]').value;
    const dVal = parseFloat(form.querySelector('[name="discountValue"]').value) || 0;
    let discount = 0;
    if (dVal > 0) {
      if (dType === 'percent') discount = Math.round(subtotal * (Math.min(dVal, 100) / 100) * 100) / 100;
      else discount = Math.min(dVal, subtotal);
    }
    const total = Math.max(0, subtotal - discount);

    form.querySelector('#invoiceSubtotal').textContent = `Subtotal: ${formatCurrency(subtotal)}`;
    form.querySelector('#invoiceDiscount').textContent = `Discount: ${formatCurrency(discount)}`;
    form.querySelector('#invoiceDiscount').style.display = discount > 0 ? '' : 'none';
    form.querySelector('#invoiceTotal').textContent = `Total: ${formatCurrency(total)}`;
  }

  form.addEventListener('input', (e) => {
    if (e.target.name && (e.target.name.startsWith('qty_') || e.target.name.startsWith('rate_') || e.target.name === 'discountValue' || e.target.name === 'discountType')) {
      recalcTotals();
    }
  });
  form.addEventListener('change', (e) => {
    if (e.target.name === 'discountType') recalcTotals();
  });

  form.querySelector('#addLineBtn').addEventListener('click', () => {
    const tbody = form.querySelector('#lineItemsBody');
    const tr = document.createElement('tr');
    tr.className = 'line-item-row';
    tr.innerHTML = `
      <td><input type="text" name="desc_${lineCount}" placeholder="Description" style="width:100%;border:none;outline:none;"></td>
      <td><input type="number" name="qty_${lineCount}" value="1" step="0.5" min="0" style="width:100%;border:none;outline:none;text-align:right;"></td>
      <td><input type="number" name="rate_${lineCount}" value="0" step="0.01" min="0" style="width:100%;border:none;outline:none;text-align:right;"></td>
      <td class="line-amount" style="text-align:right;">$0.00</td>
      <td><button type="button" class="btn btn-ghost btn-sm remove-line" style="color:var(--danger);padding:0.2rem;">&times;</button></td>
    `;
    tbody.appendChild(tr);
    lineCount++;
  });

  form.addEventListener('click', (e) => {
    if (e.target.classList.contains('remove-line')) {
      const row = e.target.closest('tr');
      if (form.querySelectorAll('.line-item-row').length > 1) { row.remove(); recalcTotals(); }
    }
  });

  form.querySelector('#cancelEdit').addEventListener('click', () => { showDetail(inv); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const lineItems = [];
    let subtotal = 0;
    form.querySelectorAll('.line-item-row').forEach((row) => {
      const desc = row.querySelector(`[name^="desc_"]`).value.trim();
      const qty = parseFloat(row.querySelector(`[name^="qty_"]`).value) || 0;
      const rate = parseFloat(row.querySelector(`[name^="rate_"]`).value) || 0;
      const amount = qty * rate;
      if (desc) { lineItems.push({ description: desc, quantity: qty, rate, amount }); subtotal += amount; }
    });

    const dReason = fd.get('discountReason').trim();
    const dType = fd.get('discountType');
    const dVal = parseFloat(fd.get('discountValue')) || 0;
    let discountAmount = 0;
    if (dVal > 0 && dReason) {
      if (dType === 'percent') discountAmount = Math.round(subtotal * (Math.min(dVal, 100) / 100) * 100) / 100;
      else discountAmount = Math.min(dVal, subtotal);
      if (discountAmount > 0) {
        const label = dType === 'percent' ? `Discount — ${dReason} (${dVal}% off)` : `Discount — ${dReason}`;
        lineItems.push({ description: label, quantity: 1, rate: -discountAmount, amount: -discountAmount, isDiscount: true });
      }
    }
    const total = Math.max(0, subtotal - discountAmount);

    try {
      await updateDocument('invoices_crm', inv.id, {
        clientName: fd.get('clientName').trim(),
        issueDate: fd.get('issueDate'),
        dueDate: fd.get('dueDate'),
        lineItems,
        subtotal,
        discountReason: dVal > 0 && dReason ? dReason : '',
        discountType: dVal > 0 && dReason ? dType : '',
        discountValue: dVal > 0 && dReason ? dVal : 0,
        discountAmount,
        taxRate: 0,
        taxAmount: 0,
        total,
        notes: fd.get('notes').trim()
      });
      // Merge the updated values into the in-memory invoice so showDetail shows them
      Object.assign(inv, {
        clientName: fd.get('clientName').trim(),
        issueDate: fd.get('issueDate'),
        dueDate: fd.get('dueDate'),
        lineItems, subtotal, discountReason: dVal > 0 && dReason ? dReason : '',
        discountType: dVal > 0 && dReason ? dType : '',
        discountValue: dVal > 0 && dReason ? dVal : 0,
        discountAmount, total, notes: fd.get('notes').trim()
      });
      showDetail(inv);
    } catch (err) {
      console.error('Update invoice failed:', err);
      alert('Failed to save: ' + err.message);
    }
  });

  container.appendChild(form);
  recalcTotals();
}

function showDetail(inv) {
  currentPage = 'detail';
  const container = document.getElementById('view-invoicing');
  container.innerHTML = '';

  const backBtn = document.createElement('button');
  backBtn.className = 'detail-back';
  backBtn.innerHTML = '&larr; Back';
  backBtn.addEventListener('click', () => { currentPage = 'list'; renderList(); });
  container.appendChild(backBtn);

  const statusClassMap = {
    paid: 'badge-success',
    sent: 'badge-info',
    overdue: 'badge-danger',
    void: 'badge-default',
    cancelled: 'badge-default',
    refunded: 'badge-warning',
    draft: 'badge-default'
  };
  const statusClass = statusClassMap[inv.status] || 'badge-default';

  const header = document.createElement('div');
  header.className = 'detail-header';
  header.innerHTML = `
    <div style="flex:1;">
      <div class="detail-name">${escapeHtml(inv.invoiceNumber)}</div>
      <div class="detail-subtitle">${escapeHtml(inv.clientName || '-')} &middot; <span class="badge ${statusClass}">${escapeHtml(inv.status || 'draft')}</span></div>
    </div>
    <div style="font-size:1.5rem;font-weight:600;font-family:var(--font-display);">${formatCurrency(inv.total || 0)}</div>
  `;
  container.appendChild(header);

  // Status change + lifecycle action buttons
  async function doStatusChange(newStatus, successMsg) {
    try {
      await updateDocument('invoices_crm', inv.id, { status: newStatus });
      inv.status = newStatus;
      showDetail(inv);
    } catch (err) {
      console.error('Status update failed:', err);
      alert('Failed to update status: ' + err.message);
    }
  }

  if (canWrite()) {
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:0.5rem;margin:1rem 0;flex-wrap:wrap;';

    const st = inv.status || 'draft';
    const addBtn = (label, cls, onClick, extraStyle = '') => {
      const b = document.createElement('button');
      b.className = `btn ${cls} btn-sm`;
      b.textContent = label;
      if (extraStyle) b.style.cssText = extraStyle;
      b.addEventListener('click', onClick);
      actions.appendChild(b);
    };

    if (st === 'draft' || st === 'sent') {
      addBtn('Edit', 'btn-ghost', gateWrite(() => openEditForm(inv)));
    }
    if (st === 'draft') {
      addBtn('Mark as Sent', 'btn-primary', gateWrite(() => doStatusChange('sent')));
    }
    if (st === 'draft' || st === 'sent' || st === 'overdue') {
      addBtn('Mark as Paid', 'btn-primary', gateWrite(() => doStatusChange('paid')), 'background:#059669;');
    }
    if (st === 'paid') {
      addBtn('Refund', 'btn-ghost', gateWrite(async () => {
        if (!confirm('Mark this invoice as refunded? This records that you returned the payment to the customer.')) return;
        await doStatusChange('refunded');
      }), 'color:#d97706;');
    }
    if (st === 'draft' || st === 'sent' || st === 'overdue') {
      addBtn('Cancel', 'btn-ghost', gateWrite(async () => {
        if (!confirm('Cancel this invoice? It will stay on record but be excluded from outstanding totals.')) return;
        await doStatusChange('cancelled');
      }), 'color:#d97706;');
    }
    if (st !== 'void' && st !== 'cancelled') {
      addBtn('Void', 'btn-ghost', gateWrite(async () => {
        const msg = st === 'paid'
          ? 'Void a PAID invoice? This is for accounting corrections only — usually you want Refund instead. Continue?'
          : 'Void this invoice? Use this for invoices created in error.';
        if (!confirm(msg)) return;
        await doStatusChange('void');
      }), 'color:var(--danger);');
    }
    if (st === 'draft' || st === 'void' || st === 'cancelled') {
      addBtn('Delete', 'btn-ghost', gateWrite(async () => {
        if (!confirm('Permanently delete this invoice? This cannot be undone.')) return;
        try {
          await deleteDocument('invoices_crm', inv.id);
          // If the invoice was linked to a ticket, clear the ticket's invoiceId
          // so the user can generate a replacement invoice from it.
          if (inv.ticketId) {
            try { await updateDocument('tickets', inv.ticketId, { invoiceId: null }); }
            catch (e) { console.warn('Failed to unlink invoice from ticket', e); }
          }
          currentPage = 'list';
          await render();
        } catch (err) { alert('Delete failed: ' + err.message); }
      }), 'color:var(--danger);');
    }

    if (actions.children.length > 0) container.appendChild(actions);
  }

  if (inv.ticketNumber) {
    const link = document.createElement('div');
    link.style.cssText = 'margin:0.5rem 0;font-size:0.85rem;color:var(--gray);';
    link.innerHTML = `From ticket <a href="#tickets" style="font-family:monospace;">${escapeHtml(inv.ticketNumber)}</a>`;
    container.appendChild(link);
  }

  // Line items
  if (inv.lineItems && inv.lineItems.length > 0) {
    const table = document.createElement('table');
    table.className = 'data-table';
    table.innerHTML = '<thead><tr><th>Description</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Rate</th><th style="text-align:right;">Amount</th></tr></thead>';
    const tbody = document.createElement('tbody');
    inv.lineItems.forEach(li => {
      const tr = document.createElement('tr');
      const color = li.isDiscount ? 'color:#059669;' : '';
      tr.innerHTML = `
        <td style="${color}">${escapeHtml(li.description)}</td>
        <td style="text-align:right;${color}">${li.quantity}</td>
        <td style="text-align:right;${color}">${formatCurrency(li.rate)}</td>
        <td style="text-align:right;${color}">${formatCurrency(li.amount)}</td>
      `;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);

    const totals = document.createElement('div');
    totals.style.cssText = 'text-align:right;margin-top:1rem;font-size:0.95rem;';
    const hasDiscount = (inv.discountAmount || 0) > 0;
    const rows = [];
    if (hasDiscount) {
      rows.push(`<div>Subtotal: ${formatCurrency(inv.subtotal || 0)}</div>`);
      const discountLabel = inv.discountType === 'percent'
        ? `Discount (${inv.discountValue}% ${escapeHtml(inv.discountReason || '')})`
        : `Discount (${escapeHtml(inv.discountReason || '')})`;
      rows.push(`<div style="color:#059669;">${discountLabel}: -${formatCurrency(inv.discountAmount || 0)}</div>`);
    }
    rows.push(`<div style="font-size:1.1rem;font-weight:600;margin-top:0.35rem;">Total: ${formatCurrency(inv.total || 0)}</div>`);
    totals.innerHTML = rows.join('');
    container.appendChild(totals);
  }

  if (inv.notes) {
    const notes = document.createElement('div');
    notes.style.cssText = 'margin-top:1.5rem;padding:1rem;background:var(--bg);border-radius:8px;font-size:0.9rem;';
    notes.innerHTML = `<strong>Notes:</strong> ${escapeHtml(inv.notes)}`;
    container.appendChild(notes);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  const node = document.createElement('span');
  node.appendChild(document.createTextNode(str));
  return node.innerHTML;
}

function formatCurrency(amount) {
  if (amount == null || isNaN(amount)) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function formatDate(timestamp) {
  if (!timestamp) return '\u2014';
  try {
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    if (isNaN(date.getTime())) return '\u2014';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return '\u2014'; }
}
