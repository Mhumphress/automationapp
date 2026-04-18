import { queryDocuments, addDocument, updateDocument, deleteDocument, queryDocumentsWhere } from '../services/firestore.js';
import { updateInvoiceWithSync, deleteInvoiceWithSync, createInvoiceWithTenantMirror } from '../services/invoice-sync.js';
import { addActivity, logFieldEdit, getActivity } from '../services/activity.js';
import { createModal } from '../components/modal.js';
import { makeEditable } from '../components/inline-edit.js';
import { createDropdown } from '../components/dropdown.js';
import { showToast, escapeHtml, timeAgo, formatCurrency, formatDate } from '../ui.js';
import { createContactFromDropdown } from '../utils/entity-create.js';
import { canDelete } from '../services/roles.js';
import { openRecordPaymentModal } from '../components/record-payment-modal.js';
import { listPayments } from '../services/payments.js';
import { invoiceEffectiveAmount, formatMoney } from '../services/money.js';

let invoices = [];
let contacts = [];
let currentPage = 'list';
let modal = null;
let searchTerm = '';
let sortField = 'createdAt';
let sortDir = 'desc';

const STATUSES = [
  { id: 'draft', label: 'Draft' },
  { id: 'sent', label: 'Sent' },
  { id: 'paid', label: 'Paid' },
  { id: 'overdue', label: 'Overdue' }
];

export function init() {
  modal = createModal();
}

let pendingDeepLinkId = null;
export function requestInvoice(id) { pendingDeepLinkId = id; }

export async function render() {
  try {
    await loadData();
  } catch (err) {
    console.error('Invoices render error:', err);
  }
  if (pendingDeepLinkId) {
    const id = pendingDeepLinkId;
    pendingDeepLinkId = null;
    const inv = invoices.find(i => i.id === id);
    if (inv) return showDetailPage(inv);
  }
  if (currentPage === 'list') renderListView();
}

export function destroy() {
  currentPage = 'list';
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

async function loadData() {
  try {
    const results = await Promise.allSettled([
      queryDocuments('invoices', 'createdAt', 'desc'),
      queryDocuments('contacts', 'lastName', 'asc')
    ]);
    invoices = results[0].status === 'fulfilled' ? results[0].value : [];
    contacts = results[1].status === 'fulfilled' ? results[1].value : [];
    results.forEach((r, i) => {
      if (r.status === 'rejected') console.error(`loadData query ${i} failed:`, r.reason);
    });
  } catch (err) {
    console.error('loadData error:', err);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getNextInvoiceNumber(existingInvoices) {
  let max = 0;
  existingInvoices.forEach(inv => {
    const match = (inv.invoiceNumber || '').match(/INV-(\d+)/);
    if (match) max = Math.max(max, parseInt(match[1]));
  });
  return `INV-${String(max + 1).padStart(3, '0')}`;
}

function isOverdue(invoice) {
  if (invoice.status === 'paid' || invoice.status === 'overdue') return invoice.status === 'overdue';
  if (!invoice.dueDate) return false;
  try {
    const d = invoice.dueDate.toDate ? invoice.dueDate.toDate() : new Date(invoice.dueDate);
    return d < new Date();
  } catch { return false; }
}

function getFilteredInvoices() {
  let list = [...invoices];
  if (searchTerm) {
    const lower = searchTerm.toLowerCase();
    list = list.filter(inv =>
      (inv.invoiceNumber || '').toLowerCase().includes(lower) ||
      (inv.clientName || '').toLowerCase().includes(lower) ||
      (inv.status || '').toLowerCase().includes(lower) ||
      (inv.notes || '').toLowerCase().includes(lower)
    );
  }

  list.sort((a, b) => {
    let valA = a[sortField];
    let valB = b[sortField];
    // Handle Firestore timestamps
    if (valA && valA.toDate) valA = valA.toDate();
    if (valB && valB.toDate) valB = valB.toDate();
    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();
    valA = valA || '';
    valB = valB || '';
    if (valA < valB) return sortDir === 'asc' ? -1 : 1;
    if (valA > valB) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  return list;
}

function toDateInputValue(val) {
  if (!val) return '';
  try {
    const d = val.toDate ? val.toDate() : new Date(val);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().split('T')[0];
  } catch { return ''; }
}

// ---------------------------------------------------------------------------
// List View
// ---------------------------------------------------------------------------

function renderListView() {
  const container = document.getElementById('view-invoices');
  container.innerHTML = '';

  const topbar = document.createElement('div');
  topbar.className = 'view-topbar';
  topbar.innerHTML = `
    <input type="text" class="search-input" placeholder="Search invoices..." value="${escapeHtml(searchTerm)}">
    <button class="btn btn-primary" id="addInvoiceBtn">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Create Invoice
    </button>
  `;
  container.appendChild(topbar);

  topbar.querySelector('.search-input').addEventListener('input', (e) => {
    searchTerm = e.target.value.trim();
    renderContent(container);
  });

  topbar.querySelector('#addInvoiceBtn').addEventListener('click', () => openCreateModal());

  renderContent(container);
}

function renderContent(container) {
  const existing = container.querySelector('.view-content');
  if (existing) existing.remove();

  const wrapper = document.createElement('div');
  wrapper.className = 'view-content';

  const filtered = getFilteredInvoices();

  if (filtered.length === 0 && invoices.length === 0) {
    wrapper.innerHTML = `
      <div class="empty-state">
        <svg class="empty-icon" xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/>
        </svg>
        <div class="empty-title">No invoices yet</div>
        <p class="empty-description">Create your first invoice to start billing clients.</p>
        <button class="btn btn-primary empty-state-add">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Create First Invoice
        </button>
      </div>
    `;
  } else if (filtered.length === 0) {
    wrapper.innerHTML = `
      <div class="empty-state">
        <div class="empty-title">No matches</div>
        <p class="empty-description">No invoices match your search.</p>
      </div>
    `;
  } else {
    wrapper.appendChild(renderTable(filtered));
  }

  container.appendChild(wrapper);
  const emptyAddBtn = wrapper.querySelector('.empty-state-add');
  if (emptyAddBtn) emptyAddBtn.addEventListener('click', () => openCreateModal());
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

function renderTable(list) {
  const table = document.createElement('table');
  table.className = 'data-table';

  const columns = [
    { key: 'invoiceNumber', label: 'Invoice #' },
    { key: 'clientName', label: 'Client' },
    { key: 'total', label: 'Amount' },
    { key: 'status', label: 'Status' },
    { key: 'issueDate', label: 'Issue Date' },
    { key: 'dueDate', label: 'Due Date' },
    { key: '_actions', label: '' },
  ];

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  columns.forEach(col => {
    const th = document.createElement('th');
    if (col.key === '_actions') {
      headerRow.appendChild(th);
      return;
    }
    th.className = 'sortable' + (sortField === col.key ? ' sort-active' : '');
    th.innerHTML = `${col.label} <span class="sort-icon">${sortField === col.key ? (sortDir === 'asc' ? '&#9650;' : '&#9660;') : '&#9650;'}</span>`;
    th.addEventListener('click', () => {
      if (sortField === col.key) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortField = col.key;
        sortDir = 'asc';
      }
      renderListView();
    });
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  list.forEach(invoice => {
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    if (invoice.status === 'overdue' || isOverdue(invoice)) {
      tr.classList.add('invoice-overdue-row');
    }

    // Invoice #
    const numTd = document.createElement('td');
    numTd.innerHTML = `<span style="font-weight:500;">${escapeHtml(invoice.invoiceNumber || '')}</span>`;
    tr.appendChild(numTd);

    // Client
    const clientTd = document.createElement('td');
    clientTd.textContent = invoice.clientName || '\u2014';
    tr.appendChild(clientTd);

    // Amount
    const amountTd = document.createElement('td');
    amountTd.textContent = formatCurrency(invoice.total || 0);
    tr.appendChild(amountTd);

    // Status badge
    const statusTd = document.createElement('td');
    const effectiveStatus = (invoice.status === 'overdue' || isOverdue(invoice)) ? 'overdue' : (invoice.status || 'draft');
    statusTd.innerHTML = `<span class="badge-status ${effectiveStatus}">${effectiveStatus.charAt(0).toUpperCase() + effectiveStatus.slice(1)}</span>`;
    tr.appendChild(statusTd);

    // Issue Date
    const issueTd = document.createElement('td');
    issueTd.textContent = formatDate(invoice.issueDate);
    tr.appendChild(issueTd);

    // Due Date
    const dueTd = document.createElement('td');
    dueTd.textContent = formatDate(invoice.dueDate);
    tr.appendChild(dueTd);

    // Actions — quick Record Payment for eligible rows
    const actionTd = document.createElement('td');
    actionTd.style.textAlign = 'right';
    actionTd.style.whiteSpace = 'nowrap';
    const canPay = invoice.tenantId && invoice.status !== 'paid' && invoice.type !== 'refund';
    if (canPay) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-ghost btn-sm';
      btn.textContent = 'Record Payment';
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();  // don't trigger row navigation
        const result = await openRecordPaymentModal({
          tenantId: invoice.tenantId,
          invoices: [invoice],
          presetInvoiceId: invoice.id,
          singleInvoiceMode: true,
          title: `Record Payment — ${invoice.invoiceNumber || 'Invoice'}`,
        });
        if (result && result.recorded) {
          await loadData();
          renderListView();
        }
      });
      actionTd.appendChild(btn);
    }
    tr.appendChild(actionTd);

    tr.addEventListener('click', () => showDetailPage(invoice));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  return table;
}

// ---------------------------------------------------------------------------
// Line Items Editor (shared by create modal and detail page)
// ---------------------------------------------------------------------------

function createLineItemsEditor(container, onUpdate) {
  let items = [{ description: '', quantity: 1, rate: 0 }];

  function render() {
    container.innerHTML = '';
    const table = document.createElement('table');
    table.className = 'line-items-table';
    table.innerHTML = `<thead><tr>
      <th class="col-desc">Description</th>
      <th class="col-qty">Hours / Qty</th>
      <th class="col-rate">Rate</th>
      <th class="col-amount">Amount</th>
      <th class="col-action"></th>
    </tr></thead>`;

    const tbody = document.createElement('tbody');
    items.forEach((item, idx) => {
      const tr = document.createElement('tr');
      const amount = (item.quantity || 0) * (item.rate || 0);
      tr.innerHTML = `
        <td><input type="text" value="${escapeHtml(item.description)}" data-idx="${idx}" data-field="description" placeholder="Item description"></td>
        <td><input type="number" value="${item.quantity}" data-idx="${idx}" data-field="quantity" min="0" step="0.5"></td>
        <td><input type="number" value="${item.rate}" data-idx="${idx}" data-field="rate" min="0" step="0.01"></td>
        <td class="amount-cell">${formatCurrency(amount)}</td>
        <td><span class="btn-remove-row" data-idx="${idx}">&times;</span></td>
      `;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);

    // Add line item button
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-ghost';
    addBtn.textContent = '+ Add Line Item';
    addBtn.addEventListener('click', () => {
      items.push({ description: '', quantity: 1, rate: 0 });
      render();
    });
    container.appendChild(addBtn);

    // Wire events
    container.querySelectorAll('input').forEach(input => {
      input.addEventListener('input', () => {
        const idx = parseInt(input.dataset.idx);
        const field = input.dataset.field;
        items[idx][field] = field === 'description' ? input.value : parseFloat(input.value) || 0;
        // Recalculate amount cell
        const amount = (items[idx].quantity || 0) * (items[idx].rate || 0);
        input.closest('tr').querySelector('.amount-cell').textContent = formatCurrency(amount);
        onUpdate(items);
      });
    });

    container.querySelectorAll('.btn-remove-row').forEach(btn => {
      btn.addEventListener('click', () => {
        if (items.length <= 1) return;
        items.splice(parseInt(btn.dataset.idx), 1);
        render();
        onUpdate(items);
      });
    });

    onUpdate(items);
  }

  render();
  return {
    getItems: () => items.map(i => ({ ...i, amount: (i.quantity || 0) * (i.rate || 0) })),
    setItems: (newItems) => {
      items = newItems.map(i => ({ description: i.description || '', quantity: i.quantity || 0, rate: i.rate || 0 }));
      render();
    }
  };
}

// ---------------------------------------------------------------------------
// Create Invoice Modal
// ---------------------------------------------------------------------------

function openCreateModal() {
  const form = document.createElement('form');
  form.className = 'modal-form';

  const nextNum = getNextInvoiceNumber(invoices);
  const today = new Date().toISOString().split('T')[0];
  const thirtyDaysOut = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  form.innerHTML = `
    <div class="modal-field">
      <label>Invoice Number</label>
      <input type="text" name="invoiceNumber" value="${nextNum}" readonly style="opacity:0.7;cursor:not-allowed;">
    </div>
    <div class="modal-field">
      <label>Client *</label>
      <div id="clientSlot"></div>
    </div>
    <div class="modal-form-grid">
      <div class="modal-field">
        <label>Issue Date</label>
        <input type="date" name="issueDate" value="${today}">
      </div>
      <div class="modal-field">
        <label>Due Date</label>
        <input type="date" name="dueDate" value="${thirtyDaysOut}">
      </div>
    </div>
    <div class="modal-field">
      <label>Line Items</label>
      <div id="lineItemsSlot"></div>
    </div>
    <div class="modal-field">
      <label>Tax Rate (%)</label>
      <input type="number" name="taxRate" value="0" min="0" max="100" step="0.01">
    </div>
    <div class="invoice-totals" id="modalTotals">
      <div class="invoice-totals-row">
        <span class="invoice-totals-label">Subtotal</span>
        <span class="invoice-totals-value" id="modalSubtotal">$0.00</span>
      </div>
      <div class="invoice-totals-row">
        <span class="invoice-totals-label">Tax</span>
        <span class="invoice-totals-value" id="modalTax">$0.00</span>
      </div>
      <div class="invoice-totals-row total">
        <span class="invoice-totals-label">Total</span>
        <span class="invoice-totals-value" id="modalTotal">$0.00</span>
      </div>
    </div>
    <div class="modal-field">
      <label>Notes</label>
      <textarea name="notes" rows="3" placeholder="Payment terms, notes..."></textarea>
    </div>
    <div class="modal-actions">
      <button type="submit" class="btn btn-primary btn-lg" style="width:100%;">Create Invoice</button>
      <span class="modal-cancel">Cancel</span>
    </div>
  `;

  // Client dropdown
  let selectedClient = null;
  const clientDropdown = createDropdown({
    fetchItems: async () => contacts.map(c => ({
      id: c.id,
      label: `${c.firstName} ${c.lastName}`,
      sublabel: c.companyName || c.email || ''
    })),
    onSelect: (item) => { selectedClient = item; },
    onCreate: async (name) => {
      const result = await createContactFromDropdown(name);
      if (result) {
        await loadData();
        selectedClient = result;
        clientDropdown.setSelected && clientDropdown.setSelected(result);
      }
    },
    placeholder: 'Search clients...'
  });
  form.querySelector('#clientSlot').appendChild(clientDropdown);

  // Line items editor
  const lineItemsSlot = form.querySelector('#lineItemsSlot');
  const taxInput = form.querySelector('[name="taxRate"]');

  function updateTotals(items) {
    const subtotal = items.reduce((sum, i) => sum + ((i.quantity || 0) * (i.rate || 0)), 0);
    const taxRate = parseFloat(taxInput.value) || 0;
    const taxAmount = subtotal * (taxRate / 100);
    const total = subtotal + taxAmount;

    form.querySelector('#modalSubtotal').textContent = formatCurrency(subtotal);
    form.querySelector('#modalTax').textContent = formatCurrency(taxAmount);
    form.querySelector('#modalTotal').textContent = formatCurrency(total);
  }

  const editor = createLineItemsEditor(lineItemsSlot, updateTotals);

  // Update totals when tax rate changes
  taxInput.addEventListener('input', () => updateTotals(editor.getItems()));

  modal.open('New Invoice', form);

  form.querySelector('.modal-cancel').addEventListener('click', () => modal.close());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!selectedClient) {
      showToast('Please select a client', 'error');
      return;
    }

    const fd = new FormData(e.target);
    const lineItems = editor.getItems();
    const subtotal = lineItems.reduce((sum, i) => sum + i.amount, 0);
    const taxRate = parseFloat(fd.get('taxRate')) || 0;
    const taxAmount = subtotal * (taxRate / 100);
    const total = subtotal + taxAmount;

    const data = {
      invoiceNumber: fd.get('invoiceNumber'),
      clientId: selectedClient.id,
      clientName: selectedClient.label,
      issueDate: fd.get('issueDate') || '',
      dueDate: fd.get('dueDate') || '',
      lineItems,
      taxRate,
      subtotal,
      taxAmount,
      total,
      notes: fd.get('notes').trim(),
      status: 'draft'
    };

    try {
      // Write to root /invoices AND mirror to tenant subcollection (if the
      // contact has a linked tenant) so the portal's Billing page sees it.
      const result = await createInvoiceWithTenantMirror(data);

      // Cross-reference activity on the contact
      if (data.clientId) {
        try {
          await addActivity('contacts', data.clientId, {
            type: 'note',
            description: `Invoice ${data.invoiceNumber} created for ${formatCurrency(total)}`
          });
        } catch (err) { console.error('Cross-ref contact activity failed:', err); }
      }

      if (result.tenantInvoiceId) {
        showToast(`Invoice created and synced to ${result.tenantName || 'tenant portal'}`, 'success');
      } else {
        showToast('Invoice created — customer has no portal account so it won\'t appear in a portal Billing tab.', 'info');
      }
      modal.close();
      await loadData();
      renderListView();
    } catch (err) {
      console.error('Create invoice failed:', err);
      showToast('Failed to create invoice', 'error');
    }
  });
}

// ---------------------------------------------------------------------------
// Detail Page
// ---------------------------------------------------------------------------

async function showDetailPage(invoice) {
  currentPage = 'detail';
  const container = document.getElementById('view-invoices');
  container.innerHTML = '';

  // Back button
  const backBtn = document.createElement('button');
  backBtn.className = 'detail-back';
  backBtn.innerHTML = '&larr; Back to Invoices';
  backBtn.addEventListener('click', () => goBackToList());
  container.appendChild(backBtn);

  // Header
  const allowDelete = await canDelete(invoice);
  const effectiveStatus = (invoice.status === 'overdue' || isOverdue(invoice)) ? 'overdue' : (invoice.status || 'draft');
  const canRecordPayment = !!invoice.tenantId && invoice.status !== 'paid' && invoice.type !== 'refund';
  const header = document.createElement('div');
  header.className = 'detail-header';
  header.innerHTML = `
    <div style="flex:1;">
      <div class="detail-name">${escapeHtml(invoice.invoiceNumber || 'Invoice')}</div>
      <div class="detail-subtitle">${escapeHtml(invoice.clientName || '')} &middot; <span class="badge-status ${effectiveStatus}">${effectiveStatus.charAt(0).toUpperCase() + effectiveStatus.slice(1)}</span></div>
    </div>
    ${canRecordPayment ? '<button class="btn btn-primary detail-record-pay-btn">Record Payment</button>' : ''}
    <button class="btn btn-ghost detail-pdf-btn">Download PDF</button>
    ${allowDelete ? '<button class="btn btn-ghost detail-delete-btn" style="color:var(--danger);">Delete</button>' : ''}
  `;
  container.appendChild(header);

  // Record Payment handler
  const payBtn = header.querySelector('.detail-record-pay-btn');
  if (payBtn) {
    payBtn.addEventListener('click', async () => {
      const result = await openRecordPaymentModal({
        tenantId: invoice.tenantId,
        invoices: [invoice],
        presetInvoiceId: invoice.id,
        singleInvoiceMode: true,
        title: `Record Payment — ${invoice.invoiceNumber || 'Invoice'}`,
      });
      if (result && result.recorded) {
        await loadData();
        const fresh = invoices.find(i => i.id === invoice.id) || invoice;
        showDetailPage(fresh);
      }
    });
  }

  // PDF handler
  header.querySelector('.detail-pdf-btn').addEventListener('click', () => printInvoice(invoice));

  // Delete handler
  const deleteBtn = header.querySelector('.detail-delete-btn');
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    if (!confirm(`Delete invoice ${invoice.invoiceNumber}? This cannot be undone.`)) return;
    try {
      await deleteInvoiceWithSync(invoice);
      showToast('Invoice deleted', 'success');
      await loadData();
      goBackToList();
    } catch (err) {
      console.error('Delete failed:', err);
      showToast('Failed to delete invoice', 'error');
    }
  });

  // Status pills
  const pillsContainer = document.createElement('div');
  pillsContainer.className = 'status-pills';
  renderStatusPills(pillsContainer, invoice, container);
  container.appendChild(pillsContainer);

  // Two-column layout
  const layout = document.createElement('div');
  layout.className = 'detail-layout';

  // Left column — Invoice information + line items + totals + payments
  const leftCol = document.createElement('div');
  const leftTitle = document.createElement('div');
  leftTitle.className = 'detail-section-title';
  leftTitle.textContent = 'Invoice Information';
  leftCol.appendChild(leftTitle);
  renderDetailFields(leftCol, invoice);
  renderDetailLineItems(leftCol, invoice);
  renderDetailTotals(leftCol, invoice);
  renderDetailPayments(leftCol, invoice);

  // Right column — Activity
  const rightCol = document.createElement('div');
  const rightTitle = document.createElement('div');
  rightTitle.className = 'detail-section-title';
  rightTitle.textContent = 'Activity';
  rightCol.appendChild(rightTitle);
  renderActivitySection(rightCol, invoice);

  layout.appendChild(leftCol);
  layout.appendChild(rightCol);
  container.appendChild(layout);
}

function goBackToList() {
  currentPage = 'list';
  renderListView();
}

// ---------------------------------------------------------------------------
// Status Pills
// ---------------------------------------------------------------------------

function renderStatusPills(pillsContainer, invoice, pageContainer) {
  pillsContainer.innerHTML = '';

  STATUSES.forEach(status => {
    const pill = document.createElement('button');
    pill.className = 'status-pill' + (invoice.status === status.id ? ' active' : '');
    pill.textContent = status.label;

    pill.addEventListener('click', async () => {
      if (invoice.status === status.id) return;
      const oldStatus = STATUSES.find(s => s.id === invoice.status);
      try {
        await updateInvoiceWithSync(invoice, { status: status.id });
        await logFieldEdit('invoices', invoice.id, 'Status', oldStatus?.label || invoice.status, status.label);

        // Cross-reference on contact
        if (invoice.clientId) {
          try {
            await addActivity('contacts', invoice.clientId, {
              type: 'note',
              description: `Invoice ${invoice.invoiceNumber} marked as ${status.label}`
            });
          } catch (err) { console.error('Cross-ref contact activity failed:', err); }
        }

        invoice.status = status.id;
        showDetailPage(invoice);
        showToast(`Status: ${status.label}`, 'success');
      } catch (err) {
        console.error('Status change failed:', err);
        showToast('Failed to change status', 'error');
      }
    });

    pillsContainer.appendChild(pill);
  });
}

// ---------------------------------------------------------------------------
// Detail Fields (editable inline)
// ---------------------------------------------------------------------------

function renderDetailFields(container, invoice) {
  // Client field (dropdown on click)
  const clientField = document.createElement('div');
  clientField.className = 'detail-field';
  clientField.innerHTML = `<div class="detail-field-label">Client</div>`;

  const clientValue = document.createElement('div');
  clientValue.className = 'detail-field-value' + (invoice.clientName ? '' : ' empty');
  clientValue.textContent = invoice.clientName || 'Click to add...';
  clientValue.style.cursor = 'pointer';

  clientValue.addEventListener('click', () => {
    clientValue.innerHTML = '';
    const dropdown = createDropdown({
      fetchItems: async () => contacts.map(c => ({
        id: c.id,
        label: `${c.firstName} ${c.lastName}`,
        sublabel: c.companyName || c.email || ''
      })),
      onSelect: async (item) => {
        const oldName = invoice.clientName || '';
        const updates = { clientId: item.id, clientName: item.label };
        try {
          await updateDocument('invoices', invoice.id, updates);
          await logFieldEdit('invoices', invoice.id, 'Client', oldName, item.label);
          Object.assign(invoice, updates);
          clientValue.textContent = item.label;
          clientValue.classList.remove('empty');
          clientValue.classList.add('flash-success');
          setTimeout(() => clientValue.classList.remove('flash-success'), 600);
        } catch (err) {
          console.error('Client update failed:', err);
          showToast('Failed to update client', 'error');
        }
      },
      onCreate: async (name) => {
        const result = await createContactFromDropdown(name);
        if (result) {
          await loadData();
          const oldName = invoice.clientName || '';
          const updates = { clientId: result.id, clientName: result.label };
          try {
            await updateDocument('invoices', invoice.id, updates);
            await logFieldEdit('invoices', invoice.id, 'Client', oldName, result.label);
            Object.assign(invoice, updates);
            clientValue.textContent = result.label;
            clientValue.classList.remove('empty');
            clientValue.classList.add('flash-success');
            setTimeout(() => clientValue.classList.remove('flash-success'), 600);
          } catch (err) {
            console.error('Client update failed:', err);
            showToast('Failed to update client', 'error');
          }
        }
      },
      placeholder: 'Search clients...'
    });
    clientValue.appendChild(dropdown);
    const input = clientValue.querySelector('input');
    if (input) input.focus();
  });

  clientField.appendChild(clientValue);
  container.appendChild(clientField);

  // Standard editable fields
  const textFields = [
    { key: 'issueDate', label: 'Issue Date', type: 'date' },
    { key: 'dueDate', label: 'Due Date', type: 'date' },
    { key: 'notes', label: 'Notes', type: 'textarea' }
  ];

  textFields.forEach(f => {
    const field = document.createElement('div');
    field.className = 'detail-field';
    field.innerHTML = `<div class="detail-field-label">${f.label}</div><div class="detail-field-value"></div>`;
    const valueEl = field.querySelector('.detail-field-value');

    makeEditable(valueEl, {
      field: f.key,
      type: f.type,
      value: invoice[f.key] || '',
      onSave: async (newValue, oldValue) => {
        await updateInvoiceWithSync(invoice, { [f.key]: newValue });
        await logFieldEdit('invoices', invoice.id, f.label, oldValue, newValue);
        invoice[f.key] = newValue;
        const idx = invoices.findIndex(i => i.id === invoice.id);
        if (idx !== -1) invoices[idx] = { ...invoices[idx], [f.key]: newValue };
      }
    });

    container.appendChild(field);
  });
}

// ---------------------------------------------------------------------------
// Detail Line Items (editable table)
// ---------------------------------------------------------------------------

function renderDetailLineItems(container, invoice) {
  const sectionTitle = document.createElement('div');
  sectionTitle.className = 'detail-section-title';
  sectionTitle.style.marginTop = '1.5rem';
  sectionTitle.textContent = 'Line Items';
  container.appendChild(sectionTitle);

  const lineItemsContainer = document.createElement('div');
  container.appendChild(lineItemsContainer);

  const existingItems = (invoice.lineItems || []).map(i => ({
    description: i.description || '',
    quantity: i.quantity || 0,
    rate: i.rate || 0
  }));

  if (existingItems.length === 0) {
    existingItems.push({ description: '', quantity: 1, rate: 0 });
  }

  function onLineItemsUpdate(items) {
    // Recalculate totals and save
    const subtotal = items.reduce((sum, i) => sum + ((i.quantity || 0) * (i.rate || 0)), 0);
    const taxRate = invoice.taxRate || 0;
    const taxAmount = subtotal * (taxRate / 100);
    const total = subtotal + taxAmount;

    // Update the totals display on the page
    const totalsWrap = container.querySelector('.invoice-totals');
    if (totalsWrap) {
      const subtotalEl = totalsWrap.querySelector('[data-field="subtotal"]');
      const taxEl = totalsWrap.querySelector('[data-field="taxAmount"]');
      const totalEl = totalsWrap.querySelector('[data-field="total"]');
      if (subtotalEl) subtotalEl.textContent = formatCurrency(subtotal);
      if (taxEl) taxEl.textContent = formatCurrency(taxAmount);
      if (totalEl) totalEl.textContent = formatCurrency(total);
    }
  }

  const editor = createLineItemsEditor(lineItemsContainer, onLineItemsUpdate);
  editor.setItems(existingItems);

  // Save button for line items
  const saveRow = document.createElement('div');
  saveRow.style.cssText = 'margin-top:0.5rem;';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = 'Save Line Items';
  saveBtn.addEventListener('click', async () => {
    const lineItems = editor.getItems();
    const subtotal = lineItems.reduce((sum, i) => sum + i.amount, 0);
    const taxRate = invoice.taxRate || 0;
    const taxAmount = subtotal * (taxRate / 100);
    const total = subtotal + taxAmount;

    try {
      await updateDocument('invoices', invoice.id, { lineItems, subtotal, taxAmount, total });
      await addActivity('invoices', invoice.id, {
        type: 'edit',
        description: 'Updated line items'
      });
      invoice.lineItems = lineItems;
      invoice.subtotal = subtotal;
      invoice.taxAmount = taxAmount;
      invoice.total = total;

      // Update totals display
      const totalsWrap = container.querySelector('.invoice-totals');
      if (totalsWrap) {
        const subtotalEl = totalsWrap.querySelector('[data-field="subtotal"]');
        const taxEl = totalsWrap.querySelector('[data-field="taxAmount"]');
        const totalEl = totalsWrap.querySelector('[data-field="total"]');
        if (subtotalEl) subtotalEl.textContent = formatCurrency(subtotal);
        if (taxEl) taxEl.textContent = formatCurrency(taxAmount);
        if (totalEl) totalEl.textContent = formatCurrency(total);
      }

      showToast('Line items saved', 'success');
    } catch (err) {
      console.error('Save line items failed:', err);
      showToast('Failed to save line items', 'error');
    }
  });
  saveRow.appendChild(saveBtn);
  container.appendChild(saveRow);
}

// ---------------------------------------------------------------------------
// Detail Totals
// ---------------------------------------------------------------------------

function renderDetailTotals(container, invoice) {
  const totals = document.createElement('div');
  totals.className = 'invoice-totals';
  totals.style.marginTop = '1rem';
  totals.innerHTML = `
    <div class="invoice-totals-row">
      <span class="invoice-totals-label">Subtotal</span>
      <span class="invoice-totals-value" data-field="subtotal">${formatCurrency(invoice.subtotal || 0)}</span>
    </div>
    <div class="invoice-totals-row">
      <span class="invoice-totals-label">Tax (${invoice.taxRate || 0}%)</span>
      <span class="invoice-totals-value" data-field="taxAmount">${formatCurrency(invoice.taxAmount || 0)}</span>
    </div>
    <div class="invoice-totals-row total">
      <span class="invoice-totals-label">Total</span>
      <span class="invoice-totals-value" data-field="total">${formatCurrency(invoice.total || 0)}</span>
    </div>
  `;
  container.appendChild(totals);

  // Balance + paid amount lines, below the totals block.
  const paidAmount = Number(invoice.paidAmount) || 0;
  if (paidAmount > 0 || invoice.status === 'paid' || invoice.status === 'partial') {
    const balanceRow = document.createElement('div');
    balanceRow.className = 'invoice-totals';
    balanceRow.style.marginTop = '0.25rem';
    const total = Math.abs(Number(invoice.total || 0));
    const balance = Math.max(0, total - paidAmount);
    balanceRow.innerHTML = `
      <div class="invoice-totals-row" style="color:var(--success,#059669);">
        <span class="invoice-totals-label">Paid</span>
        <span class="invoice-totals-value">${formatCurrency(paidAmount)}</span>
      </div>
      ${balance > 0 ? `
        <div class="invoice-totals-row" style="color:var(--danger,#dc2626);">
          <span class="invoice-totals-label">Balance due</span>
          <span class="invoice-totals-value">${formatCurrency(balance)}</span>
        </div>
      ` : ''}
    `;
    container.appendChild(balanceRow);
  }
}

// ---------------------------------------------------------------------------
// Payments on this invoice
// ---------------------------------------------------------------------------

async function renderDetailPayments(container, invoice) {
  if (!invoice.tenantId) return;

  const section = document.createElement('div');
  section.className = 'settings-section';
  section.style.marginTop = '1.5rem';
  section.innerHTML = `<h3 class="section-title">Payments</h3><div class="invoice-payments-body"><div style="color:var(--gray);font-size:0.85rem;padding:0.5rem 0;">Loading…</div></div>`;
  container.appendChild(section);

  let payments = [];
  try {
    const all = await listPayments(invoice.tenantId);
    // Only payments whose applications include THIS invoice
    payments = all.filter(p => Array.isArray(p.appliedTo) && p.appliedTo.some(a => a.invoiceId === invoice.id));
  } catch (err) {
    console.warn('Load payments failed:', err);
  }

  const body = section.querySelector('.invoice-payments-body');
  if (!payments.length) {
    body.innerHTML = '<div style="color:var(--gray);font-size:0.85rem;padding:0.5rem 0;">No payments recorded against this invoice yet.</div>';
    return;
  }

  body.innerHTML = `
    <table class="data-table">
      <thead>
        <tr><th>Received</th><th>Amount</th><th>Method</th><th>Reference</th><th>Recorded by</th></tr>
      </thead>
      <tbody>
        ${payments.map(p => {
          const applied = (p.appliedTo || []).find(a => a.invoiceId === invoice.id);
          const amt = applied ? Number(applied.amount) : Number(p.amount);
          return `
            <tr>
              <td>${escapeHtml(formatDate(p.receivedAt || p.recordedAt))}</td>
              <td style="font-family:var(--font-mono);">${escapeHtml(formatMoney(amt))}</td>
              <td>${escapeHtml(p.method || '—')}</td>
              <td>${escapeHtml(p.reference || '—')}</td>
              <td>${escapeHtml(p.recordedByEmail || '—')}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

// ---------------------------------------------------------------------------
// Activity Section (composer + timeline)
// ---------------------------------------------------------------------------

function renderActivitySection(container, invoice) {
  // Composer (always visible)
  const composer = document.createElement('div');
  composer.className = 'activity-composer';

  let selectedType = 'note';

  composer.innerHTML = `
    <div class="activity-type-pills">
      <button type="button" class="activity-type-pill" data-type="call">Call</button>
      <button type="button" class="activity-type-pill" data-type="email">Email</button>
      <button type="button" class="activity-type-pill" data-type="meeting">Meeting</button>
      <button type="button" class="activity-type-pill active" data-type="note">Note</button>
    </div>
    <textarea placeholder="Log an activity..."></textarea>
    <button class="btn btn-primary" style="align-self:flex-end;margin-top:0.5rem;">Save</button>
  `;

  // Type pill selection
  composer.querySelectorAll('.activity-type-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      composer.querySelectorAll('.activity-type-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      selectedType = pill.dataset.type;
    });
  });

  // Save handler
  const saveBtn = composer.querySelector('.btn-primary');
  const textarea = composer.querySelector('textarea');

  saveBtn.addEventListener('click', async () => {
    const desc = textarea.value.trim();
    if (!desc) return;

    try {
      await addActivity('invoices', invoice.id, { type: selectedType, description: desc });
      showToast('Activity logged', 'success');
      textarea.value = '';

      // Refresh timeline
      const timeline = container.querySelector('.detail-timeline');
      if (timeline) timeline.remove();
      await loadTimeline(container, invoice);
    } catch (err) {
      console.error('Failed to log activity:', err);
      showToast('Failed to log activity', 'error');
    }
  });

  container.appendChild(composer);

  // Timeline
  loadTimeline(container, invoice);
}

async function loadTimeline(container, invoice) {
  let activities = [];
  try {
    activities = await getActivity('invoices', invoice.id);
  } catch (err) {
    console.error('Failed to load activities:', err);
  }

  const timeline = document.createElement('div');
  timeline.className = 'detail-timeline';

  if (activities.length === 0) {
    timeline.innerHTML = '<div style="text-align:center;color:var(--gray);padding:2rem 0;font-size:0.85rem;">No activity yet.</div>';
  } else {
    const iconMap = { call: '\uD83D\uDCDE', email: '\u2709\uFE0F', meeting: '\uD83E\uDD1D', note: '\uD83D\uDCDD', edit: '\u270F\uFE0F' };

    activities.forEach(act => {
      const item = document.createElement('div');
      item.className = 'activity-item';

      let desc = escapeHtml(act.description || '');
      let diff = '';
      if (act.type === 'edit' && act.oldValue !== undefined) {
        diff = `<div class="activity-diff">&ldquo;${escapeHtml(act.oldValue || '(empty)')}&rdquo; &rarr; &ldquo;${escapeHtml(act.newValue || '(empty)')}&rdquo;</div>`;
      }

      item.innerHTML = `
        <div class="activity-icon ${act.type}">${iconMap[act.type] || '\u2022'}</div>
        <div class="activity-card">
          <div class="activity-desc">${desc}</div>
          ${diff}
          <div class="activity-meta">${escapeHtml(act.createdByEmail || 'Unknown')} &middot; ${timeAgo(act.createdAt)}</div>
        </div>
      `;
      timeline.appendChild(item);
    });
  }

  container.appendChild(timeline);
}

// ---------------------------------------------------------------------------
// PDF / Print View
// ---------------------------------------------------------------------------

function printInvoice(invoice) {
  // Remove any existing print div
  const existingPrint = document.querySelector('.print-invoice');
  if (existingPrint) existingPrint.remove();

  const lineItems = invoice.lineItems || [];
  const client = invoice.clientId ? contacts.find(c => c.id === invoice.clientId) : null;

  const clientInfo = client
    ? `<div>${escapeHtml(client.firstName)} ${escapeHtml(client.lastName)}</div>
       ${client.companyName ? `<div>${escapeHtml(client.companyName)}</div>` : ''}
       ${client.email ? `<div>${escapeHtml(client.email)}</div>` : ''}
       ${client.phone ? `<div>${escapeHtml(client.phone)}</div>` : ''}`
    : `<div>${escapeHtml(invoice.clientName || 'N/A')}</div>`;

  let lineItemsHtml = '';
  lineItems.forEach(item => {
    const amount = (item.quantity || 0) * (item.rate || 0);
    lineItemsHtml += `
      <tr>
        <td>${escapeHtml(item.description || '')}</td>
        <td style="text-align:center;">${item.quantity || 0}</td>
        <td style="text-align:right;">${formatCurrency(item.rate || 0)}</td>
        <td style="text-align:right;">${formatCurrency(amount)}</td>
      </tr>
    `;
  });

  const printDiv = document.createElement('div');
  printDiv.className = 'print-invoice';
  printDiv.innerHTML = `
    <div class="print-header">
      <div>
        <h1 class="print-title">INVOICE</h1>
        <div class="print-invoice-number">${escapeHtml(invoice.invoiceNumber || '')}</div>
      </div>
    </div>

    <div class="print-info-grid">
      <div class="print-info-section">
        <div class="print-info-label">Bill To</div>
        ${clientInfo}
      </div>
      <div class="print-info-section" style="text-align:right;">
        <div class="print-info-label">Details</div>
        <div>Issue Date: ${formatDate(invoice.issueDate)}</div>
        <div>Due Date: ${formatDate(invoice.dueDate)}</div>
        <div>Status: ${(invoice.status || 'draft').charAt(0).toUpperCase() + (invoice.status || 'draft').slice(1)}</div>
      </div>
    </div>

    <table class="print-table">
      <thead>
        <tr>
          <th style="text-align:left;">Description</th>
          <th style="text-align:center;">Hours / Qty</th>
          <th style="text-align:right;">Rate</th>
          <th style="text-align:right;">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${lineItemsHtml}
      </tbody>
    </table>

    <div class="print-totals">
      <div class="print-totals-row">
        <span>Subtotal</span>
        <span>${formatCurrency(invoice.subtotal || 0)}</span>
      </div>
      <div class="print-totals-row">
        <span>Tax (${invoice.taxRate || 0}%)</span>
        <span>${formatCurrency(invoice.taxAmount || 0)}</span>
      </div>
      <div class="print-totals-row print-totals-total">
        <span>Total</span>
        <span>${formatCurrency(invoice.total || 0)}</span>
      </div>
    </div>

    ${invoice.notes ? `
      <div class="print-notes">
        <div class="print-info-label">Notes</div>
        <div>${escapeHtml(invoice.notes)}</div>
      </div>
    ` : ''}
  `;

  document.body.appendChild(printDiv);
  window.print();

  // Remove after printing
  setTimeout(() => {
    const el = document.querySelector('.print-invoice');
    if (el) el.remove();
  }, 1000);
}
