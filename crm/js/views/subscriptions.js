import { auth, db } from '../config.js';
import { queryDocuments, addDocument, updateDocument, deleteDocument, queryDocumentsWhere } from '../services/firestore.js';
import { addActivity, logFieldEdit, getActivity } from '../services/activity.js';
import { createModal } from '../components/modal.js';
import { makeEditable } from '../components/inline-edit.js';
import { createDropdown } from '../components/dropdown.js';
import { showToast, escapeHtml, timeAgo, formatCurrency, formatDate } from '../ui.js';
import { createContactFromDropdown } from '../utils/entity-create.js';
import { canDelete } from '../services/roles.js';
import { collection, getDocs, addDoc, query, orderBy, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

let clientSubs = [];
let internalSubs = [];
let contacts = [];
let currentTab = 'client'; // 'client' or 'internal'
let currentPage = 'list';
let modal = null;
let searchTerm = '';

export function init() {
  modal = createModal();
}

export async function render() {
  try {
    await loadData();
  } catch (err) {
    console.error('Subscriptions render error:', err);
  }
  if (currentPage === 'list') renderListView();
}

export function destroy() {
  currentPage = 'list';
  currentTab = 'client';
  searchTerm = '';
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

async function loadData() {
  try {
    const results = await Promise.allSettled([
      queryDocuments('subscriptions', 'createdAt', 'desc'),
      queryDocuments('internal_subs', 'createdAt', 'desc'),
      queryDocuments('contacts', 'lastName', 'asc')
    ]);
    clientSubs = results[0].status === 'fulfilled' ? results[0].value : [];
    internalSubs = results[1].status === 'fulfilled' ? results[1].value : [];
    contacts = results[2].status === 'fulfilled' ? results[2].value : [];
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

function calcNextRenewal(startDate, cycle) {
  const d = new Date(startDate);
  if (cycle === 'yearly') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d.toISOString().split('T')[0];
}

function toDateInputValue(val) {
  if (!val) return '';
  try {
    const d = val.toDate ? val.toDate() : new Date(val);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().split('T')[0];
  } catch { return ''; }
}

function getFilteredClientSubs() {
  let list = [...clientSubs];
  if (searchTerm) {
    const lower = searchTerm.toLowerCase();
    list = list.filter(s =>
      (s.contactName || '').toLowerCase().includes(lower) ||
      (s.planName || '').toLowerCase().includes(lower) ||
      (s.companyName || '').toLowerCase().includes(lower)
    );
  }
  return list;
}

function getFilteredInternalSubs() {
  let list = [...internalSubs];
  if (searchTerm) {
    const lower = searchTerm.toLowerCase();
    list = list.filter(s =>
      (s.vendor || '').toLowerCase().includes(lower) ||
      (s.serviceName || '').toLowerCase().includes(lower) ||
      (s.category || '').toLowerCase().includes(lower)
    );
  }
  return list;
}

async function getPayments(subId) {
  const ref = collection(db, 'subscriptions', subId, 'payments');
  const q = query(ref, orderBy('date', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function addPayment(subId, data) {
  const user = auth.currentUser;
  const ref = collection(db, 'subscriptions', subId, 'payments');
  return addDoc(ref, {
    ...data,
    createdAt: serverTimestamp(),
    createdBy: user ? user.uid : null
  });
}

// ---------------------------------------------------------------------------
// List View
// ---------------------------------------------------------------------------

function renderListView() {
  const container = document.getElementById('view-subscriptions');
  container.innerHTML = '';

  // Tab toggle
  const tabToggle = document.createElement('div');
  tabToggle.className = 'sub-tab-toggle';
  tabToggle.innerHTML = `
    <button class="sub-tab-btn ${currentTab === 'client' ? 'active' : ''}" data-tab="client">Client</button>
    <button class="sub-tab-btn ${currentTab === 'internal' ? 'active' : ''}" data-tab="internal">Internal</button>
  `;
  container.appendChild(tabToggle);

  tabToggle.querySelectorAll('.sub-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentTab = btn.dataset.tab;
      searchTerm = '';
      renderListView();
    });
  });

  // Topbar — search + add button
  const addLabel = currentTab === 'client' ? 'Add Subscription' : 'Add Expense';
  const searchPlaceholder = currentTab === 'client' ? 'Search subscriptions...' : 'Search expenses...';

  const topbar = document.createElement('div');
  topbar.className = 'view-topbar';
  topbar.innerHTML = `
    <input type="text" class="search-input" placeholder="${searchPlaceholder}" value="${escapeHtml(searchTerm)}">
    <button class="btn btn-primary" id="addSubBtn">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      ${addLabel}
    </button>
  `;
  container.appendChild(topbar);

  topbar.querySelector('.search-input').addEventListener('input', (e) => {
    searchTerm = e.target.value.trim();
    renderContent(container);
  });

  topbar.querySelector('#addSubBtn').addEventListener('click', () => {
    if (currentTab === 'client') openClientCreateModal();
    else openInternalCreateModal();
  });

  renderContent(container);
}

function renderContent(container) {
  const existing = container.querySelector('.view-content');
  if (existing) existing.remove();

  const wrapper = document.createElement('div');
  wrapper.className = 'view-content';

  if (currentTab === 'client') {
    const filtered = getFilteredClientSubs();
    if (filtered.length === 0 && clientSubs.length === 0) {
      wrapper.innerHTML = `
        <div class="empty-state">
          <svg class="empty-icon" xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
          <div class="empty-title">No client subscriptions yet</div>
          <p class="empty-description">Add your first subscription to start tracking recurring revenue.</p>
          <button class="btn btn-primary" onclick="document.getElementById('addSubBtn').click()">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add First Subscription
          </button>
        </div>
      `;
    } else if (filtered.length === 0) {
      wrapper.innerHTML = `
        <div class="empty-state">
          <div class="empty-title">No matches</div>
          <p class="empty-description">No subscriptions match your search.</p>
        </div>
      `;
    } else {
      wrapper.appendChild(renderClientTable(filtered));
    }
  } else {
    const filtered = getFilteredInternalSubs();
    if (filtered.length === 0 && internalSubs.length === 0) {
      wrapper.innerHTML = `
        <div class="empty-state">
          <svg class="empty-icon" xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
          <div class="empty-title">No internal subscriptions yet</div>
          <p class="empty-description">Track your business expenses by adding internal subscriptions.</p>
          <button class="btn btn-primary" onclick="document.getElementById('addSubBtn').click()">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add First Expense
          </button>
        </div>
      `;
    } else if (filtered.length === 0) {
      wrapper.innerHTML = `
        <div class="empty-state">
          <div class="empty-title">No matches</div>
          <p class="empty-description">No expenses match your search.</p>
        </div>
      `;
    } else {
      wrapper.appendChild(renderInternalTable(filtered));
    }
  }

  container.appendChild(wrapper);
}

// ---------------------------------------------------------------------------
// Client Subscriptions Table
// ---------------------------------------------------------------------------

function renderClientTable(list) {
  const table = document.createElement('table');
  table.className = 'data-table';

  const columns = [
    { label: 'Client' },
    { label: 'Plan' },
    { label: 'Amount' },
    { label: 'Cycle' },
    { label: 'Status' },
    { label: 'Next Renewal' }
  ];

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  columns.forEach(col => {
    const th = document.createElement('th');
    th.textContent = col.label;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  list.forEach(sub => {
    const tr = document.createElement('tr');
    tr.className = 'clickable';

    // Client
    const clientTd = document.createElement('td');
    clientTd.innerHTML = `<span style="font-weight:500;">${escapeHtml(sub.contactName || '\u2014')}</span>`;
    tr.appendChild(clientTd);

    // Plan
    const planTd = document.createElement('td');
    planTd.textContent = sub.planName || '\u2014';
    tr.appendChild(planTd);

    // Amount
    const amountTd = document.createElement('td');
    amountTd.textContent = formatCurrency(sub.amount || 0);
    tr.appendChild(amountTd);

    // Cycle
    const cycleTd = document.createElement('td');
    cycleTd.textContent = sub.cycle ? sub.cycle.charAt(0).toUpperCase() + sub.cycle.slice(1) : '\u2014';
    tr.appendChild(cycleTd);

    // Status
    const statusTd = document.createElement('td');
    const status = sub.status || 'active';
    const statusLabel = status === 'past_due' ? 'Past Due' : status.charAt(0).toUpperCase() + status.slice(1);
    statusTd.innerHTML = `<span class="badge-status ${escapeHtml(status)}">${escapeHtml(statusLabel)}</span>`;
    tr.appendChild(statusTd);

    // Next Renewal
    const renewalTd = document.createElement('td');
    renewalTd.textContent = formatDate(sub.nextRenewal);
    tr.appendChild(renewalTd);

    tr.addEventListener('click', () => showClientDetailPage(sub));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  return table;
}

// ---------------------------------------------------------------------------
// Internal Subscriptions Table
// ---------------------------------------------------------------------------

function renderInternalTable(list) {
  const table = document.createElement('table');
  table.className = 'data-table';

  const columns = [
    { label: 'Vendor' },
    { label: 'Service' },
    { label: 'Cost' },
    { label: 'Cycle' },
    { label: 'Renewal Date' }
  ];

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  columns.forEach(col => {
    const th = document.createElement('th');
    th.textContent = col.label;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  list.forEach(sub => {
    const tr = document.createElement('tr');
    tr.className = 'clickable';

    // Vendor
    const vendorTd = document.createElement('td');
    vendorTd.innerHTML = `<span style="font-weight:500;">${escapeHtml(sub.vendor || '\u2014')}</span>`;
    tr.appendChild(vendorTd);

    // Service
    const serviceTd = document.createElement('td');
    serviceTd.textContent = sub.serviceName || '\u2014';
    tr.appendChild(serviceTd);

    // Cost
    const costTd = document.createElement('td');
    costTd.textContent = formatCurrency(sub.cost || 0);
    tr.appendChild(costTd);

    // Cycle
    const cycleTd = document.createElement('td');
    cycleTd.textContent = sub.cycle ? sub.cycle.charAt(0).toUpperCase() + sub.cycle.slice(1) : '\u2014';
    tr.appendChild(cycleTd);

    // Renewal Date
    const renewalTd = document.createElement('td');
    renewalTd.textContent = formatDate(sub.renewalDate);
    tr.appendChild(renewalTd);

    tr.addEventListener('click', () => showInternalDetailPage(sub));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  return table;
}

// ---------------------------------------------------------------------------
// Client Subscription — Create Modal
// ---------------------------------------------------------------------------

function openClientCreateModal() {
  const form = document.createElement('form');
  form.className = 'modal-form';

  const today = new Date().toISOString().split('T')[0];

  form.innerHTML = `
    <div class="modal-field">
      <label>Client *</label>
      <div id="clientSlot"></div>
    </div>
    <div class="modal-field">
      <label>Plan Name *</label>
      <input type="text" name="planName" required placeholder="e.g. Pro Plan">
    </div>
    <div class="modal-form-grid">
      <div class="modal-field">
        <label>Amount *</label>
        <input type="number" name="amount" required min="0" step="0.01" placeholder="0.00">
      </div>
      <div class="modal-field">
        <label>Billing Cycle</label>
        <select name="cycle">
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
      </div>
    </div>
    <div class="modal-field">
      <label>Start Date</label>
      <input type="date" name="startDate" value="${today}">
    </div>
    <div class="modal-field">
      <label>Notes</label>
      <textarea name="notes" rows="3" placeholder="Notes..."></textarea>
    </div>
    <div class="modal-actions">
      <button type="submit" class="btn btn-primary btn-lg" style="width:100%;">Create Subscription</button>
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

  modal.open('New Subscription', form);

  form.querySelector('.modal-cancel').addEventListener('click', () => modal.close());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!selectedClient) {
      showToast('Please select a client', 'error');
      return;
    }

    const fd = new FormData(e.target);
    const startDate = fd.get('startDate') || today;
    const cycle = fd.get('cycle') || 'monthly';
    const contact = contacts.find(c => c.id === selectedClient.id);

    const data = {
      contactId: selectedClient.id,
      contactName: selectedClient.label,
      companyId: contact ? (contact.companyId || '') : '',
      companyName: contact ? (contact.companyName || '') : '',
      planName: fd.get('planName').trim(),
      amount: parseFloat(fd.get('amount')) || 0,
      cycle,
      startDate,
      nextRenewal: calcNextRenewal(startDate, cycle),
      status: 'active',
      notes: fd.get('notes').trim()
    };

    try {
      await addDocument('subscriptions', data);
      showToast('Subscription created', 'success');
      modal.close();
      await loadData();
      renderListView();
    } catch (err) {
      console.error('Create subscription failed:', err);
      showToast('Failed to create subscription', 'error');
    }
  });
}

// ---------------------------------------------------------------------------
// Internal Subscription — Create Modal
// ---------------------------------------------------------------------------

function openInternalCreateModal() {
  const form = document.createElement('form');
  form.className = 'modal-form';

  const today = new Date().toISOString().split('T')[0];

  form.innerHTML = `
    <div class="modal-field">
      <label>Vendor *</label>
      <input type="text" name="vendor" required placeholder="e.g. Adobe, AWS">
    </div>
    <div class="modal-field">
      <label>Service Name *</label>
      <input type="text" name="serviceName" required placeholder="e.g. Creative Cloud">
    </div>
    <div class="modal-form-grid">
      <div class="modal-field">
        <label>Cost *</label>
        <input type="number" name="cost" required min="0" step="0.01" placeholder="0.00">
      </div>
      <div class="modal-field">
        <label>Billing Cycle</label>
        <select name="cycle">
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
      </div>
    </div>
    <div class="modal-field">
      <label>Renewal Date</label>
      <input type="date" name="renewalDate" value="${today}">
    </div>
    <div class="modal-field">
      <label>Category</label>
      <input type="text" name="category" placeholder="e.g. Software, Hosting">
    </div>
    <div class="modal-field">
      <label>Notes</label>
      <textarea name="notes" rows="3" placeholder="Notes..."></textarea>
    </div>
    <div class="modal-actions">
      <button type="submit" class="btn btn-primary btn-lg" style="width:100%;">Add Expense</button>
      <span class="modal-cancel">Cancel</span>
    </div>
  `;

  modal.open('New Internal Subscription', form);

  form.querySelector('.modal-cancel').addEventListener('click', () => modal.close());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const fd = new FormData(e.target);
    const data = {
      vendor: fd.get('vendor').trim(),
      serviceName: fd.get('serviceName').trim(),
      cost: parseFloat(fd.get('cost')) || 0,
      cycle: fd.get('cycle') || 'monthly',
      renewalDate: fd.get('renewalDate') || '',
      category: fd.get('category').trim(),
      notes: fd.get('notes').trim()
    };

    try {
      await addDocument('internal_subs', data);
      showToast('Expense added', 'success');
      modal.close();
      await loadData();
      renderListView();
    } catch (err) {
      console.error('Create internal subscription failed:', err);
      showToast('Failed to add expense', 'error');
    }
  });
}

// ---------------------------------------------------------------------------
// Client Subscription — Detail Page
// ---------------------------------------------------------------------------

async function showClientDetailPage(sub) {
  currentPage = 'detail';
  const container = document.getElementById('view-subscriptions');
  container.innerHTML = '';

  // Back button
  const backBtn = document.createElement('button');
  backBtn.className = 'detail-back';
  backBtn.innerHTML = '&larr; Back to Subscriptions';
  backBtn.addEventListener('click', () => goBackToList());
  container.appendChild(backBtn);

  // Header
  const allowDelete = await canDelete(sub);
  const status = sub.status || 'active';
  const statusLabel = status === 'past_due' ? 'Past Due' : status.charAt(0).toUpperCase() + status.slice(1);
  const header = document.createElement('div');
  header.className = 'detail-header';
  header.innerHTML = `
    <div style="flex:1;">
      <div class="detail-name">${escapeHtml(sub.planName || 'Subscription')}</div>
      <div class="detail-subtitle">${escapeHtml(sub.contactName || '')} &middot; <span class="badge-status ${escapeHtml(status)}">${escapeHtml(statusLabel)}</span></div>
    </div>
    ${allowDelete ? '<button class="btn btn-ghost detail-delete-btn" style="color:var(--danger);">Delete</button>' : ''}
  `;
  container.appendChild(header);

  // Delete handler
  const deleteBtn = header.querySelector('.detail-delete-btn');
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    if (!confirm(`Delete subscription "${sub.planName}"? This cannot be undone.`)) return;
    try {
      await deleteDocument('subscriptions', sub.id);
      showToast('Subscription deleted', 'success');
      await loadData();
      goBackToList();
    } catch (err) {
      console.error('Delete failed:', err);
      showToast('Failed to delete subscription', 'error');
    }
  });

  // Status pills
  const CLIENT_STATUSES = [
    { id: 'active', label: 'Active' },
    { id: 'cancelled', label: 'Cancelled' },
    { id: 'past_due', label: 'Past Due' }
  ];

  const pillsContainer = document.createElement('div');
  pillsContainer.className = 'status-pills';

  CLIENT_STATUSES.forEach(s => {
    const pill = document.createElement('button');
    pill.className = 'status-pill' + (sub.status === s.id ? ' active' : '');
    pill.textContent = s.label;

    pill.addEventListener('click', async () => {
      if (sub.status === s.id) return;
      const oldStatus = CLIENT_STATUSES.find(st => st.id === sub.status);
      try {
        await updateDocument('subscriptions', sub.id, { status: s.id });
        await logFieldEdit('subscriptions', sub.id, 'Status', oldStatus?.label || sub.status, s.label);
        sub.status = s.id;
        showClientDetailPage(sub);
        showToast(`Status: ${s.label}`, 'success');
      } catch (err) {
        console.error('Status change failed:', err);
        showToast('Failed to change status', 'error');
      }
    });

    pillsContainer.appendChild(pill);
  });
  container.appendChild(pillsContainer);

  // Generate Invoice button (only when active)
  if (sub.status === 'active') {
    const genBtn = document.createElement('button');
    genBtn.className = 'btn btn-primary';
    genBtn.style.marginBottom = '1rem';
    genBtn.textContent = 'Generate Invoice';
    genBtn.addEventListener('click', async () => {
      try {
        // Get next invoice number
        const existingInvoices = await queryDocuments('invoices', 'createdAt', 'desc');
        let max = 0;
        existingInvoices.forEach(inv => {
          const match = (inv.invoiceNumber || '').match(/INV-(\d+)/);
          if (match) max = Math.max(max, parseInt(match[1]));
        });
        const invoiceNumber = `INV-${String(max + 1).padStart(3, '0')}`;

        const today = new Date().toISOString().split('T')[0];

        const invoiceData = {
          invoiceNumber,
          clientId: sub.contactId || '',
          clientName: sub.contactName || '',
          companyId: sub.companyId || '',
          companyName: sub.companyName || '',
          lineItems: [{
            description: sub.planName || 'Subscription',
            quantity: 1,
            rate: sub.amount || 0,
            amount: sub.amount || 0
          }],
          subtotal: sub.amount || 0,
          taxRate: 0,
          taxAmount: 0,
          total: sub.amount || 0,
          status: 'draft',
          issueDate: today,
          dueDate: sub.nextRenewal || today,
          notes: `Auto-generated from subscription: ${sub.planName || ''}`
        };

        await addDocument('invoices', invoiceData);
        await addActivity('subscriptions', sub.id, {
          type: 'note',
          description: `Invoice ${invoiceNumber} generated for ${formatCurrency(sub.amount || 0)}`
        });

        showToast('Invoice generated', 'success');
      } catch (err) {
        console.error('Generate invoice failed:', err);
        showToast('Failed to generate invoice', 'error');
      }
    });
    container.appendChild(genBtn);
  }

  // Two-column layout
  const layout = document.createElement('div');
  layout.className = 'detail-layout';

  // Left column — Subscription fields
  const leftCol = document.createElement('div');
  const leftTitle = document.createElement('div');
  leftTitle.className = 'detail-section-title';
  leftTitle.textContent = 'Subscription Details';
  leftCol.appendChild(leftTitle);
  renderClientDetailFields(leftCol, sub);

  // Right column — Payment History + Activity
  const rightCol = document.createElement('div');

  // Payment History section
  const payTitle = document.createElement('div');
  payTitle.className = 'detail-section-title';
  payTitle.textContent = 'Payment History';
  rightCol.appendChild(payTitle);
  renderPaymentSection(rightCol, sub);

  // Activity section
  const actTitle = document.createElement('div');
  actTitle.className = 'detail-section-title';
  actTitle.style.marginTop = '1.5rem';
  actTitle.textContent = 'Activity';
  rightCol.appendChild(actTitle);
  renderActivitySection(rightCol, sub);

  layout.appendChild(leftCol);
  layout.appendChild(rightCol);
  container.appendChild(layout);
}

// ---------------------------------------------------------------------------
// Client Detail Fields (editable inline)
// ---------------------------------------------------------------------------

function renderClientDetailFields(container, sub) {
  const fields = [
    { key: 'planName', label: 'Plan Name', type: 'text' },
    { key: 'amount', label: 'Amount', type: 'number' },
    { key: 'cycle', label: 'Billing Cycle', type: 'text' },
    { key: 'startDate', label: 'Start Date', type: 'date' },
    { key: 'nextRenewal', label: 'Next Renewal', type: 'date' },
    { key: 'notes', label: 'Notes', type: 'textarea' }
  ];

  fields.forEach(f => {
    const field = document.createElement('div');
    field.className = 'detail-field';
    field.innerHTML = `<div class="detail-field-label">${f.label}</div><div class="detail-field-value"></div>`;
    const valueEl = field.querySelector('.detail-field-value');

    let displayValue = sub[f.key] || '';
    if (f.key === 'amount') displayValue = sub.amount || 0;

    makeEditable(valueEl, {
      field: f.key,
      type: f.type,
      value: displayValue,
      onSave: async (newValue, oldValue) => {
        const updates = { [f.key]: f.key === 'amount' ? (parseFloat(newValue) || 0) : newValue };
        await updateDocument('subscriptions', sub.id, updates);
        await logFieldEdit('subscriptions', sub.id, f.label, oldValue, newValue);
        sub[f.key] = updates[f.key];
        const idx = clientSubs.findIndex(s => s.id === sub.id);
        if (idx !== -1) clientSubs[idx] = { ...clientSubs[idx], ...updates };
      }
    });

    container.appendChild(field);
  });

  // Client field (dropdown on click)
  const clientField = document.createElement('div');
  clientField.className = 'detail-field';
  clientField.innerHTML = `<div class="detail-field-label">Client</div>`;

  const clientValue = document.createElement('div');
  clientValue.className = 'detail-field-value' + (sub.contactName ? '' : ' empty');
  clientValue.textContent = sub.contactName || 'Click to add...';
  clientValue.style.cursor = 'pointer';

  clientValue.addEventListener('click', () => {
    clientValue.innerHTML = '';
    clientValue.classList.add('editing');
    const dropdown = createDropdown({
      fetchItems: async () => contacts.map(c => ({
        id: c.id,
        label: `${c.firstName} ${c.lastName}`,
        sublabel: c.companyName || c.email || ''
      })),
      onSelect: async (item) => {
        const oldName = sub.contactName || '';
        const contact = contacts.find(c => c.id === item.id);
        const updates = {
          contactId: item.id,
          contactName: item.label,
          companyId: contact ? (contact.companyId || '') : '',
          companyName: contact ? (contact.companyName || '') : ''
        };
        try {
          await updateDocument('subscriptions', sub.id, updates);
          await logFieldEdit('subscriptions', sub.id, 'Client', oldName, item.label);
          Object.assign(sub, updates);
          clientValue.classList.remove('editing', 'empty');
          clientValue.textContent = item.label;
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
          const oldName = sub.contactName || '';
          const contact = contacts.find(c => c.id === result.id);
          const updates = {
            contactId: result.id,
            contactName: result.label,
            companyId: contact ? (contact.companyId || '') : '',
            companyName: contact ? (contact.companyName || '') : ''
          };
          try {
            await updateDocument('subscriptions', sub.id, updates);
            await logFieldEdit('subscriptions', sub.id, 'Client', oldName, result.label);
            Object.assign(sub, updates);
            clientValue.classList.remove('editing', 'empty');
            clientValue.textContent = result.label;
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
}

// ---------------------------------------------------------------------------
// Payment History Section
// ---------------------------------------------------------------------------

function renderPaymentSection(container, sub) {
  const paymentWrap = document.createElement('div');
  container.appendChild(paymentWrap);

  // Log Payment button
  const logBtn = document.createElement('button');
  logBtn.className = 'btn btn-ghost';
  logBtn.textContent = '+ Log Payment';
  logBtn.style.marginBottom = '0.75rem';
  container.appendChild(logBtn);

  // Inline payment form (hidden by default)
  const payForm = document.createElement('div');
  payForm.style.display = 'none';
  payForm.style.marginBottom = '1rem';
  payForm.innerHTML = `
    <div class="modal-form" style="padding:0;">
      <div class="modal-form-grid">
        <div class="modal-field">
          <label>Amount</label>
          <input type="number" name="payAmount" min="0" step="0.01" placeholder="0.00" value="${sub.amount || ''}">
        </div>
        <div class="modal-field">
          <label>Date</label>
          <input type="date" name="payDate" value="${new Date().toISOString().split('T')[0]}">
        </div>
      </div>
      <div class="modal-form-grid">
        <div class="modal-field">
          <label>Method</label>
          <select name="payMethod">
            <option value="card">Card</option>
            <option value="bank">Bank</option>
            <option value="cash">Cash</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div class="modal-field">
          <label>Notes</label>
          <input type="text" name="payNotes" placeholder="Optional note">
        </div>
      </div>
      <div style="display:flex;gap:0.5rem;margin-top:0.5rem;">
        <button type="button" class="btn btn-primary pay-save-btn">Save Payment</button>
        <button type="button" class="btn btn-ghost pay-cancel-btn">Cancel</button>
      </div>
    </div>
  `;
  container.appendChild(payForm);

  logBtn.addEventListener('click', () => {
    payForm.style.display = 'block';
    logBtn.style.display = 'none';
  });

  payForm.querySelector('.pay-cancel-btn').addEventListener('click', () => {
    payForm.style.display = 'none';
    logBtn.style.display = '';
  });

  payForm.querySelector('.pay-save-btn').addEventListener('click', async () => {
    const amount = parseFloat(payForm.querySelector('[name="payAmount"]').value) || 0;
    const date = payForm.querySelector('[name="payDate"]').value;
    const method = payForm.querySelector('[name="payMethod"]').value;
    const notes = payForm.querySelector('[name="payNotes"]').value.trim();

    if (!amount) {
      showToast('Please enter an amount', 'error');
      return;
    }

    try {
      await addPayment(sub.id, { amount, date, method, notes });
      await addActivity('subscriptions', sub.id, {
        type: 'note',
        description: `Payment of ${formatCurrency(amount)} logged via ${method}`
      });
      showToast('Payment logged', 'success');
      payForm.style.display = 'none';
      logBtn.style.display = '';

      // Refresh payment list
      loadPaymentList(paymentWrap, sub);
    } catch (err) {
      console.error('Failed to log payment:', err);
      showToast('Failed to log payment', 'error');
    }
  });

  // Load existing payments
  loadPaymentList(paymentWrap, sub);
}

async function loadPaymentList(container, sub) {
  container.innerHTML = '';

  let payments = [];
  try {
    payments = await getPayments(sub.id);
  } catch (err) {
    console.error('Failed to load payments:', err);
  }

  if (payments.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:var(--gray);padding:1rem 0;font-size:0.85rem;">No payments recorded.</div>';
    return;
  }

  const list = document.createElement('div');
  list.className = 'payment-list';

  payments.forEach(p => {
    const item = document.createElement('div');
    item.className = 'payment-item';
    item.innerHTML = `
      <div>
        <div style="font-weight:500;">${formatDate(p.date)}</div>
        ${p.notes ? `<div style="font-size:0.75rem;color:var(--gray);">${escapeHtml(p.notes)}</div>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:0.75rem;">
        <span class="payment-method">${escapeHtml((p.method || 'other').charAt(0).toUpperCase() + (p.method || 'other').slice(1))}</span>
        <span class="payment-amount">${formatCurrency(p.amount || 0)}</span>
      </div>
    `;
    list.appendChild(item);
  });

  container.appendChild(list);
}

// ---------------------------------------------------------------------------
// Internal Subscription — Detail Page
// ---------------------------------------------------------------------------

async function showInternalDetailPage(sub) {
  currentPage = 'detail';
  const container = document.getElementById('view-subscriptions');
  container.innerHTML = '';

  // Back button
  const backBtn = document.createElement('button');
  backBtn.className = 'detail-back';
  backBtn.innerHTML = '&larr; Back to Subscriptions';
  backBtn.addEventListener('click', () => goBackToList());
  container.appendChild(backBtn);

  // Header
  const allowDelete = await canDelete(sub);
  const header = document.createElement('div');
  header.className = 'detail-header';
  header.innerHTML = `
    <div style="flex:1;">
      <div class="detail-name">${escapeHtml(sub.serviceName || 'Expense')}</div>
      <div class="detail-subtitle">${escapeHtml(sub.vendor || '')}</div>
    </div>
    ${allowDelete ? '<button class="btn btn-ghost detail-delete-btn" style="color:var(--danger);">Delete</button>' : ''}
  `;
  container.appendChild(header);

  // Delete handler
  const deleteBtn = header.querySelector('.detail-delete-btn');
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    if (!confirm(`Delete "${sub.serviceName}"? This cannot be undone.`)) return;
    try {
      await deleteDocument('internal_subs', sub.id);
      showToast('Expense deleted', 'success');
      await loadData();
      goBackToList();
    } catch (err) {
      console.error('Delete failed:', err);
      showToast('Failed to delete expense', 'error');
    }
  });

  // Detail fields
  const leftTitle = document.createElement('div');
  leftTitle.className = 'detail-section-title';
  leftTitle.textContent = 'Expense Details';
  container.appendChild(leftTitle);

  renderInternalDetailFields(container, sub);
}

// ---------------------------------------------------------------------------
// Internal Detail Fields (editable inline)
// ---------------------------------------------------------------------------

function renderInternalDetailFields(container, sub) {
  const fields = [
    { key: 'vendor', label: 'Vendor', type: 'text' },
    { key: 'serviceName', label: 'Service Name', type: 'text' },
    { key: 'cost', label: 'Cost', type: 'number' },
    { key: 'cycle', label: 'Billing Cycle', type: 'text' },
    { key: 'renewalDate', label: 'Renewal Date', type: 'date' },
    { key: 'category', label: 'Category', type: 'text' },
    { key: 'notes', label: 'Notes', type: 'textarea' }
  ];

  fields.forEach(f => {
    const field = document.createElement('div');
    field.className = 'detail-field';
    field.innerHTML = `<div class="detail-field-label">${f.label}</div><div class="detail-field-value"></div>`;
    const valueEl = field.querySelector('.detail-field-value');

    let displayValue = sub[f.key] || '';
    if (f.key === 'cost') displayValue = sub.cost || 0;

    makeEditable(valueEl, {
      field: f.key,
      type: f.type,
      value: displayValue,
      onSave: async (newValue, oldValue) => {
        const updates = { [f.key]: f.key === 'cost' ? (parseFloat(newValue) || 0) : newValue };
        await updateDocument('internal_subs', sub.id, updates);
        sub[f.key] = updates[f.key];
        const idx = internalSubs.findIndex(s => s.id === sub.id);
        if (idx !== -1) internalSubs[idx] = { ...internalSubs[idx], ...updates };
      }
    });

    container.appendChild(field);
  });
}

// ---------------------------------------------------------------------------
// Activity Section (composer + timeline) — Client subscriptions only
// ---------------------------------------------------------------------------

function renderActivitySection(container, sub) {
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

  composer.querySelectorAll('.activity-type-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      composer.querySelectorAll('.activity-type-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      selectedType = pill.dataset.type;
    });
  });

  const saveBtn = composer.querySelector('.btn-primary');
  const textarea = composer.querySelector('textarea');

  saveBtn.addEventListener('click', async () => {
    const desc = textarea.value.trim();
    if (!desc) return;

    try {
      await addActivity('subscriptions', sub.id, { type: selectedType, description: desc });
      showToast('Activity logged', 'success');
      textarea.value = '';

      const timeline = container.querySelector('.detail-timeline');
      if (timeline) timeline.remove();
      await loadTimeline(container, sub);
    } catch (err) {
      console.error('Failed to log activity:', err);
      showToast('Failed to log activity', 'error');
    }
  });

  container.appendChild(composer);
  loadTimeline(container, sub);
}

async function loadTimeline(container, sub) {
  let activities = [];
  try {
    activities = await getActivity('subscriptions', sub.id);
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
// Navigation
// ---------------------------------------------------------------------------

function goBackToList() {
  currentPage = 'list';
  renderListView();
}
