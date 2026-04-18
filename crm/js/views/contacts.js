import { queryDocuments, addDocument, updateDocument, queryDocumentsWhere } from '../services/firestore.js';
import { createModal } from '../components/modal.js';
import { makeEditable } from '../components/inline-edit.js';
import { createDropdown } from '../components/dropdown.js';
import { showToast, escapeHtml } from '../ui.js';
import { createCompanyFromDropdown } from '../utils/entity-create.js';
import { openCustomerDetail } from './customer-detail.js';

let contacts = [];
let companies = [];
let currentMode = 'table';
let searchTerm = '';
let sortField = 'lastName';
let sortDir = 'asc';
let currentPage = 'list';
let modal = null;

export function init() {
  modal = createModal();
}

let pendingContactId = null;
export function requestContact(id) { pendingContactId = id; }

export async function render() {
  try {
    await loadData();
  } catch (err) {
    console.error('Contacts render error:', err);
  }
  if (pendingContactId) {
    const id = pendingContactId;
    pendingContactId = null;
    const c = contacts.find(x => x.id === id);
    if (c) return showDetailPage(c);
  }
  if (currentPage === 'list') renderListView();
}

export function destroy() {
  currentPage = 'list';
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

let allQuotes = [];
let allInvoices = [];

async function loadData() {
  try {
    const results = await Promise.allSettled([
      queryDocuments('contacts', 'lastName', 'asc'),
      queryDocuments('companies', 'name', 'asc'),
      queryDocuments('quotes', 'createdAt', 'desc').catch(() => []),
      queryDocuments('invoices', 'createdAt', 'desc').catch(() => []),
    ]);
    contacts = results[0].status === 'fulfilled' ? results[0].value : [];
    companies = results[1].status === 'fulfilled' ? results[1].value : [];
    allQuotes = results[2].status === 'fulfilled' ? results[2].value : [];
    allInvoices = results[3].status === 'fulfilled' ? results[3].value : [];
    if (results[0].status === 'rejected') console.error('Failed to load contacts:', results[0].reason);
    if (results[1].status === 'rejected') console.error('Failed to load companies:', results[1].reason);
  } catch (err) {
    console.error('loadData error:', err);
  }
}

// ---------------------------------------------------------------------------
// List View
// ---------------------------------------------------------------------------

function renderListView() {
  const container = document.getElementById('view-contacts');
  container.innerHTML = '';

  const topbar = document.createElement('div');
  topbar.className = 'view-topbar';
  topbar.innerHTML = `
    <input type="text" class="search-input" placeholder="Search contacts..." value="${escapeHtml(searchTerm)}">
    <div class="view-toggle">
      <button data-mode="table" class="${currentMode === 'table' ? 'active' : ''}">Table</button>
      <button data-mode="cards" class="${currentMode === 'cards' ? 'active' : ''}">Cards</button>
    </div>
    <button class="btn btn-primary" id="addContactBtn">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Add Contact
    </button>
  `;
  container.appendChild(topbar);

  topbar.querySelector('.search-input').addEventListener('input', (e) => {
    searchTerm = e.target.value.trim();
    renderContent(container);
  });

  topbar.querySelectorAll('.view-toggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      currentMode = btn.dataset.mode;
      topbar.querySelectorAll('.view-toggle button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderContent(container);
    });
  });

  topbar.querySelector('#addContactBtn').addEventListener('click', () => openCreateModal());

  renderContent(container);
}

function renderContent(container) {
  const existing = container.querySelector('.view-content');
  if (existing) existing.remove();

  const wrapper = document.createElement('div');
  wrapper.className = 'view-content';

  const filtered = getFilteredContacts();

  if (filtered.length === 0 && contacts.length === 0) {
    wrapper.innerHTML = `
      <div class="empty-state">
        <svg class="empty-icon" xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
        <div class="empty-title">No contacts yet</div>
        <p class="empty-description">Add your first contact to get started.</p>
        <button class="btn btn-primary empty-state-add">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add First Contact
        </button>
      </div>
    `;
  } else if (filtered.length === 0) {
    wrapper.innerHTML = `
      <div class="empty-state">
        <div class="empty-title">No matches</div>
        <p class="empty-description">No contacts match your search.</p>
      </div>
    `;
  } else if (currentMode === 'table') {
    wrapper.appendChild(renderTable(filtered));
  } else {
    wrapper.appendChild(renderCards(filtered));
  }

  container.appendChild(wrapper);
  const emptyAddBtn = wrapper.querySelector('.empty-state-add');
  if (emptyAddBtn) emptyAddBtn.addEventListener('click', () => openCreateModal());
}

function getFilteredContacts() {
  let list = [...contacts];

  if (searchTerm) {
    const lower = searchTerm.toLowerCase();
    list = list.filter(c =>
      (`${c.firstName} ${c.lastName}`).toLowerCase().includes(lower) ||
      (c.email || '').toLowerCase().includes(lower) ||
      (c.company || c.companyName || '').toLowerCase().includes(lower) ||
      (c.phone || '').toLowerCase().includes(lower)
    );
  }

  list.sort((a, b) => {
    let valA = a[sortField] || '';
    let valB = b[sortField] || '';
    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();
    if (valA < valB) return sortDir === 'asc' ? -1 : 1;
    if (valA > valB) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  return list;
}

// ---------------------------------------------------------------------------
// Table (polished — avatar + stacked name/company in name cell)
// ---------------------------------------------------------------------------

function renderTable(list) {
  const table = document.createElement('table');
  table.className = 'data-table';

  const columns = [
    { key: 'lastName', label: 'Name' },
    { key: 'companyName', label: 'Company' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'jobTitle', label: 'Title' }
  ];

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  columns.forEach(col => {
    const th = document.createElement('th');
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
  list.forEach(contact => {
    const initials = ((contact.firstName || '')[0] || '') + ((contact.lastName || '')[0] || '');
    const tr = document.createElement('tr');
    tr.className = 'clickable';

    // Name cell with avatar + stacked name/company
    const nameTd = document.createElement('td');
    nameTd.innerHTML = `
      <div class="contact-name-cell">
        <div class="contact-card-avatar">${escapeHtml(initials.toUpperCase())}</div>
        <div>
          <div style="font-weight:500;">${escapeHtml(contact.firstName)} ${escapeHtml(contact.lastName)}</div>
          <div style="font-size:0.75rem;color:var(--gray);">${escapeHtml(contact.company || contact.companyName || '')}</div>
        </div>
      </div>
    `;
    tr.appendChild(nameTd);

    // Company cell
    const companyTd = document.createElement('td');
    companyTd.textContent = contact.company || contact.companyName || '\u2014';
    if (contact.companyId) {
      companyTd.style.cssText = 'color:var(--accent);cursor:pointer;';
      companyTd.addEventListener('click', (e) => {
        e.stopPropagation();
        const company = companies.find(c => c.id === contact.companyId);
        if (company) showCompanyPage(company);
      });
    }
    tr.appendChild(companyTd);

    // Email
    const emailTd = document.createElement('td');
    emailTd.textContent = contact.email || '\u2014';
    tr.appendChild(emailTd);

    // Phone
    const phoneTd = document.createElement('td');
    phoneTd.textContent = contact.phone || '\u2014';
    tr.appendChild(phoneTd);

    // Title
    const titleTd = document.createElement('td');
    titleTd.textContent = contact.jobTitle || '\u2014';
    tr.appendChild(titleTd);

    tr.addEventListener('click', () => showDetailPage(contact));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  return table;
}

// ---------------------------------------------------------------------------
// Cards (polished — 48px avatar, hover lift via CSS)
// ---------------------------------------------------------------------------

function renderCards(list) {
  const grid = document.createElement('div');
  grid.className = 'card-grid';

  list.forEach(contact => {
    const initials = ((contact.firstName || '')[0] || '') + ((contact.lastName || '')[0] || '');
    const card = document.createElement('div');
    card.className = 'contact-card';
    card.innerHTML = `
      <div class="contact-card-header">
        <div class="contact-card-avatar" style="width:48px;height:48px;font-size:1.1rem;">${escapeHtml(initials.toUpperCase())}</div>
        <div>
          <div class="contact-card-name">${escapeHtml(contact.firstName)} ${escapeHtml(contact.lastName)}</div>
          ${contact.jobTitle ? `<div class="contact-card-title">${escapeHtml(contact.jobTitle)}</div>` : ''}
        </div>
      </div>
      ${(contact.company || contact.companyName) ? `<div class="contact-card-detail">${escapeHtml(contact.company || contact.companyName)}</div>` : ''}
      ${contact.email ? `<div class="contact-card-detail">${escapeHtml(contact.email)}</div>` : ''}
      ${contact.phone ? `<div class="contact-card-detail">${escapeHtml(contact.phone)}</div>` : ''}
    `;
    card.addEventListener('click', () => showDetailPage(contact));
    grid.appendChild(card);
  });

  return grid;
}

// ---------------------------------------------------------------------------
// Create Modal
// ---------------------------------------------------------------------------

function openCreateModal() {
  const form = document.createElement('form');
  form.className = 'modal-form';
  form.innerHTML = `
    <div class="modal-form-grid">
      <div class="modal-field">
        <label>First Name *</label>
        <input type="text" name="firstName" required placeholder="First name">
      </div>
      <div class="modal-field">
        <label>Last Name *</label>
        <input type="text" name="lastName" required placeholder="Last name">
      </div>
    </div>
    <div class="modal-form-grid">
      <div class="modal-field">
        <label>Email</label>
        <input type="email" name="email" placeholder="email@example.com">
      </div>
      <div class="modal-field">
        <label>Phone</label>
        <input type="tel" name="phone" placeholder="Phone number">
      </div>
    </div>
    <div class="modal-field">
      <label>Job Title</label>
      <input type="text" name="jobTitle" placeholder="Job title">
    </div>
    <div class="modal-field">
      <label>Company</label>
      <div id="companySlot"></div>
    </div>
    <div class="modal-field">
      <label>Notes</label>
      <textarea name="notes" rows="3" placeholder="Notes..."></textarea>
    </div>
    <div class="modal-actions">
      <button type="submit" class="btn btn-primary btn-lg">Create Contact</button>
      <span class="modal-cancel">Cancel</span>
    </div>
  `;

  let selectedCompany = null;
  const dropdown = createDropdown({
    fetchItems: async () => companies.map(c => ({ id: c.id, label: c.name, sublabel: c.industry || '' })),
    onSelect: (item) => { selectedCompany = item; },
    onCreate: async (name) => {
      const result = await createCompanyFromDropdown(name);
      if (result) {
        await loadData();
        selectedCompany = result;
        dropdown.setSelected && dropdown.setSelected(result);
      }
    },
    placeholder: 'Search or create company...'
  });
  form.querySelector('#companySlot').appendChild(dropdown);

  modal.open('New Contact', form);

  form.querySelector('.modal-cancel').addEventListener('click', () => modal.close());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {
      firstName: fd.get('firstName').trim(),
      lastName: fd.get('lastName').trim(),
      email: fd.get('email').trim(),
      phone: fd.get('phone').trim(),
      jobTitle: fd.get('jobTitle').trim(),
      notes: fd.get('notes').trim(),
      companyId: selectedCompany ? selectedCompany.id : '',
      companyName: selectedCompany ? selectedCompany.label : ''
    };

    try {
      await addDocument('contacts', data);
      showToast('Contact created', 'success');
      modal.close();
      await loadData();
      renderListView();
    } catch (err) {
      console.error('Create contact failed:', err);
      showToast('Failed to create contact', 'error');
    }
  });
}

// ---------------------------------------------------------------------------
// Detail Page
// ---------------------------------------------------------------------------

async function showDetailPage(contact) {
  currentPage = 'detail';
  await openCustomerDetail(contact, {
    contacts,
    quotes: allQuotes,
    invoices: allInvoices,
    onBack: () => goBackToList(),
  });
}

function goBackToList() {
  currentPage = 'list';
  renderListView();
}


// ---------------------------------------------------------------------------
// Company Detail Page
// ---------------------------------------------------------------------------

async function showCompanyPage(company) {
  currentPage = 'detail';
  const container = document.getElementById('view-contacts');
  container.innerHTML = '';

  // Back button
  const backBtn = document.createElement('button');
  backBtn.className = 'detail-back';
  backBtn.innerHTML = '&larr; Back to Contacts';
  backBtn.addEventListener('click', () => goBackToList());
  container.appendChild(backBtn);

  // Header
  const nameInitial = (company.name || '?')[0].toUpperCase();
  const header = document.createElement('div');
  header.className = 'detail-header';
  header.innerHTML = `
    <div class="detail-avatar" style="width:64px;height:64px;font-size:1.5rem;">${escapeHtml(nameInitial)}</div>
    <div style="flex:1;">
      <div class="detail-name">${escapeHtml(company.name)}</div>
      <div class="detail-subtitle">${company.industry ? escapeHtml(company.industry) : 'Company'}</div>
    </div>
  `;
  container.appendChild(header);

  // Detail layout
  const layout = document.createElement('div');
  layout.className = 'detail-layout';

  // Left column — Company fields
  const leftCol = document.createElement('div');
  const leftTitle = document.createElement('div');
  leftTitle.className = 'detail-section-title';
  leftTitle.textContent = 'Company Information';
  leftCol.appendChild(leftTitle);

  const fields = [
    { key: 'name', label: 'Company Name', type: 'text' },
    { key: 'phone', label: 'Phone', type: 'tel' },
    { key: 'email', label: 'Email', type: 'email' },
    { key: 'website', label: 'Website', type: 'text' },
    { key: 'industry', label: 'Industry', type: 'text' },
    { key: 'notes', label: 'Notes', type: 'textarea' }
  ];

  fields.forEach(f => {
    const field = document.createElement('div');
    field.className = 'detail-field';
    field.innerHTML = `<div class="detail-field-label">${f.label}</div><div class="detail-field-value"></div>`;
    const valueEl = field.querySelector('.detail-field-value');

    makeEditable(valueEl, {
      field: f.key,
      type: f.type,
      value: company[f.key] || '',
      onSave: async (newValue, oldValue) => {
        await updateDocument('companies', company.id, { [f.key]: newValue });
        company[f.key] = newValue;
        // If company name changed, update all linked contacts
        if (f.key === 'name') {
          const linkedContacts = contacts.filter(c => c.companyId === company.id);
          for (const c of linkedContacts) {
            await updateDocument('contacts', c.id, { companyName: newValue });
            c.companyName = newValue;
          }
        }
      }
    });

    leftCol.appendChild(field);
  });

  // Address field
  const addr = company.address || {};
  const addrStr = [addr.street, addr.city, addr.state, addr.zip, addr.country].filter(Boolean).join(', ');
  const addrField = document.createElement('div');
  addrField.className = 'detail-field';
  addrField.innerHTML = `<div class="detail-field-label">Address</div><div class="detail-field-value"></div>`;
  const addrValue = addrField.querySelector('.detail-field-value');
  makeEditable(addrValue, {
    field: 'address',
    type: 'text',
    value: addrStr,
    onSave: async (newValue) => {
      const parts = newValue.split(',').map(s => s.trim());
      const address = { street: parts[0] || '', city: parts[1] || '', state: parts[2] || '', zip: parts[3] || '', country: parts[4] || '' };
      await updateDocument('companies', company.id, { address });
      company.address = address;
    }
  });
  leftCol.appendChild(addrField);

  // Right column — Linked contacts + deals
  const rightCol = document.createElement('div');

  // Linked contacts
  const linkedContacts = contacts.filter(c => c.companyId === company.id);
  const contactsTitle = document.createElement('div');
  contactsTitle.className = 'detail-section-title';
  contactsTitle.textContent = `Linked Contacts (${linkedContacts.length})`;
  rightCol.appendChild(contactsTitle);

  if (linkedContacts.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.style.cssText = 'font-size:0.85rem;color:var(--gray);margin-bottom:1.5rem;';
    emptyMsg.textContent = 'No contacts linked.';
    rightCol.appendChild(emptyMsg);
  } else {
    linkedContacts.forEach(c => {
      const row = document.createElement('div');
      row.style.cssText = 'padding:0.4rem 0;font-size:0.85rem;cursor:pointer;color:var(--accent);';
      row.textContent = `${c.firstName} ${c.lastName}`;
      row.addEventListener('click', () => showDetailPage(c));
      rightCol.appendChild(row);
    });
  }

  // Linked deals
  let linkedDeals = [];
  try {
    linkedDeals = await queryDocumentsWhere('deals', 'companyId', '==', company.id);
  } catch (e) {
    console.error(e);
  }

  const dealsTitle = document.createElement('div');
  dealsTitle.className = 'detail-section-title';
  dealsTitle.style.marginTop = '1.5rem';
  dealsTitle.textContent = `Linked Deals (${linkedDeals.length})`;
  rightCol.appendChild(dealsTitle);

  if (linkedDeals.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.style.cssText = 'font-size:0.85rem;color:var(--gray);';
    emptyMsg.textContent = 'No deals linked.';
    rightCol.appendChild(emptyMsg);
  } else {
    linkedDeals.forEach(d => {
      const row = document.createElement('div');
      row.style.cssText = 'padding:0.4rem 0;font-size:0.85rem;display:flex;justify-content:space-between;';
      row.innerHTML = `<span>${escapeHtml(d.name)}</span><span style="color:var(--accent);font-weight:500;">${formatCurrency(d.value)}</span>`;
      rightCol.appendChild(row);
    });
  }

  layout.appendChild(leftCol);
  layout.appendChild(rightCol);
  container.appendChild(layout);
}
