import { queryDocuments, addDocument, updateDocument, deleteDocument, queryDocumentsWhere } from '../services/firestore.js';
import { addActivity, logFieldEdit, getActivity } from '../services/activity.js';
import { createModal } from '../components/modal.js';
import { makeEditable } from '../components/inline-edit.js';
import { showToast, escapeHtml, timeAgo, formatCurrency } from '../ui.js';
import { canDelete } from '../services/roles.js';

let companies = [];
let currentMode = 'table';
let searchTerm = '';
let sortField = 'name';
let sortDir = 'asc';
let currentPage = 'list';
let modal = null;

export function init() {
  modal = createModal();
}

export async function render() {
  try {
    await loadData();
  } catch (err) {
    console.error('Companies render error:', err);
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
      queryDocuments('companies', 'name', 'asc')
    ]);
    companies = results[0].status === 'fulfilled' ? results[0].value : [];
    if (results[0].status === 'rejected') console.error('Failed to load companies:', results[0].reason);
  } catch (err) {
    console.error('loadData error:', err);
  }
}

// ---------------------------------------------------------------------------
// List View
// ---------------------------------------------------------------------------

function renderListView() {
  const container = document.getElementById('view-companies');
  container.innerHTML = '';

  // Header actions
  const headerActions = document.getElementById('headerActions');
  headerActions.innerHTML = '';
  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-primary';
  addBtn.id = 'addCompanyBtn';
  addBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    Add Company
  `;
  addBtn.addEventListener('click', () => openCreateModal());
  headerActions.appendChild(addBtn);

  const topbar = document.createElement('div');
  topbar.className = 'view-topbar';
  topbar.innerHTML = `
    <input type="text" class="search-input" placeholder="Search companies..." value="${escapeHtml(searchTerm)}">
    <div class="view-toggle">
      <button data-mode="table" class="${currentMode === 'table' ? 'active' : ''}">Table</button>
      <button data-mode="cards" class="${currentMode === 'cards' ? 'active' : ''}">Cards</button>
    </div>
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

  renderContent(container);
}

function renderContent(container) {
  const existing = container.querySelector('.view-content');
  if (existing) existing.remove();

  const wrapper = document.createElement('div');
  wrapper.className = 'view-content';

  const filtered = getFilteredSorted();

  if (filtered.length === 0 && companies.length === 0) {
    wrapper.innerHTML = `
      <div class="empty-state">
        <svg class="empty-icon" xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
        <div class="empty-title">No companies yet</div>
        <p class="empty-description">Add your first company to get started.</p>
        <button class="btn btn-primary empty-state-add">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add First Company
        </button>
      </div>
    `;
  } else if (filtered.length === 0) {
    wrapper.innerHTML = `
      <div class="empty-state">
        <div class="empty-title">No matches</div>
        <p class="empty-description">No companies match your search.</p>
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

function getFilteredSorted() {
  let list = [...companies];

  if (searchTerm) {
    const lower = searchTerm.toLowerCase();
    list = list.filter(c =>
      (c.name || '').toLowerCase().includes(lower) ||
      (c.industry || '').toLowerCase().includes(lower) ||
      (c.email || '').toLowerCase().includes(lower) ||
      (c.phone || '').toLowerCase().includes(lower) ||
      (c.website || '').toLowerCase().includes(lower)
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
// Table
// ---------------------------------------------------------------------------

function renderTable(list) {
  const table = document.createElement('table');
  table.className = 'data-table';

  const columns = [
    { key: 'name', label: 'Name' },
    { key: 'industry', label: 'Industry' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' }
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
  list.forEach(company => {
    const initial = (company.name || '?')[0].toUpperCase();
    const tr = document.createElement('tr');
    tr.className = 'clickable';

    // Name cell with avatar
    const nameTd = document.createElement('td');
    nameTd.innerHTML = `
      <div class="contact-name-cell">
        <div class="contact-card-avatar">${escapeHtml(initial)}</div>
        <div>
          <div style="font-weight:500;">${escapeHtml(company.name || '')}</div>
          <div style="font-size:0.75rem;color:var(--gray);">${escapeHtml(company.industry || '')}</div>
        </div>
      </div>
    `;
    tr.appendChild(nameTd);

    // Industry
    const industryTd = document.createElement('td');
    industryTd.textContent = company.industry || '\u2014';
    tr.appendChild(industryTd);

    // Email
    const emailTd = document.createElement('td');
    emailTd.textContent = company.email || '\u2014';
    tr.appendChild(emailTd);

    // Phone
    const phoneTd = document.createElement('td');
    phoneTd.textContent = company.phone || '\u2014';
    tr.appendChild(phoneTd);

    tr.addEventListener('click', () => showDetailPage(company));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  return table;
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function renderCards(list) {
  const grid = document.createElement('div');
  grid.className = 'card-grid';

  list.forEach(company => {
    const initial = (company.name || '?')[0].toUpperCase();
    const card = document.createElement('div');
    card.className = 'contact-card';
    card.innerHTML = `
      <div class="contact-card-header">
        <div class="contact-card-avatar" style="width:48px;height:48px;font-size:1.1rem;">${escapeHtml(initial)}</div>
        <div>
          <div class="contact-card-name">${escapeHtml(company.name || '')}</div>
          ${company.industry ? `<div class="contact-card-title">${escapeHtml(company.industry)}</div>` : ''}
        </div>
      </div>
      ${company.email ? `<div class="contact-card-detail">${escapeHtml(company.email)}</div>` : ''}
      ${company.phone ? `<div class="contact-card-detail">${escapeHtml(company.phone)}</div>` : ''}
    `;
    card.addEventListener('click', () => showDetailPage(company));
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
        <label>Name *</label>
        <input type="text" name="name" required placeholder="Company name">
      </div>
      <div class="modal-field">
        <label>Industry</label>
        <input type="text" name="industry" placeholder="Industry">
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
      <label>Website</label>
      <input type="text" name="website" placeholder="https://example.com">
    </div>
    <div class="modal-form-grid">
      <div class="modal-field">
        <label>Street</label>
        <input type="text" name="street" placeholder="Street address">
      </div>
      <div class="modal-field">
        <label>City</label>
        <input type="text" name="city" placeholder="City">
      </div>
    </div>
    <div class="modal-form-grid">
      <div class="modal-field">
        <label>State</label>
        <input type="text" name="state" placeholder="State">
      </div>
      <div class="modal-field">
        <label>Zip</label>
        <input type="text" name="zip" placeholder="Zip code">
      </div>
    </div>
    <div class="modal-field">
      <label>Notes</label>
      <textarea name="notes" rows="3" placeholder="Notes..."></textarea>
    </div>
    <div class="modal-actions">
      <button type="submit" class="btn btn-primary btn-lg">Create Company</button>
      <span class="modal-cancel">Cancel</span>
    </div>
  `;

  modal.open('New Company', form);

  form.querySelector('.modal-cancel').addEventListener('click', () => modal.close());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {
      name: fd.get('name').trim(),
      industry: fd.get('industry').trim(),
      email: fd.get('email').trim(),
      phone: fd.get('phone').trim(),
      website: fd.get('website').trim(),
      address: {
        street: fd.get('street').trim(),
        city: fd.get('city').trim(),
        state: fd.get('state').trim(),
        zip: fd.get('zip').trim(),
        country: ''
      },
      notes: fd.get('notes').trim()
    };

    try {
      await addDocument('companies', data);
      showToast('Company created', 'success');
      modal.close();
      await loadData();
      renderListView();
    } catch (err) {
      console.error('Create company failed:', err);
      showToast('Failed to create company', 'error');
    }
  });
}

// ---------------------------------------------------------------------------
// Detail Page
// ---------------------------------------------------------------------------

async function showDetailPage(company) {
  currentPage = 'detail';
  const container = document.getElementById('view-companies');
  container.innerHTML = '';

  // Clear header actions on detail page
  const headerActions = document.getElementById('headerActions');
  headerActions.innerHTML = '';

  // Back button
  const backBtn = document.createElement('button');
  backBtn.className = 'detail-back';
  backBtn.innerHTML = '&larr; Back to Companies';
  backBtn.addEventListener('click', () => goBackToList());
  container.appendChild(backBtn);

  // Header
  const allowDelete = await canDelete(company);
  const nameInitial = (company.name || '?')[0].toUpperCase();
  const header = document.createElement('div');
  header.className = 'detail-header';
  header.innerHTML = `
    <div class="detail-avatar" style="width:64px;height:64px;font-size:1.5rem;">${escapeHtml(nameInitial)}</div>
    <div style="flex:1;">
      <div class="detail-name">${escapeHtml(company.name || '')}</div>
      <div class="detail-subtitle">${company.industry ? escapeHtml(company.industry) : 'Company'}</div>
    </div>
    ${allowDelete ? '<button class="btn btn-ghost detail-delete-btn" style="color:var(--danger);">Delete</button>' : ''}
  `;
  container.appendChild(header);

  // Delete handler
  const deleteBtn = header.querySelector('.detail-delete-btn');
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    if (!confirm(`Delete ${company.name}? This cannot be undone.`)) return;
    try {
      await deleteDocument('companies', company.id);
      showToast('Company deleted', 'success');
      await loadData();
      goBackToList();
    } catch (err) {
      console.error('Delete failed:', err);
      showToast('Failed to delete company', 'error');
    }
  });

  // Two-column layout
  const layout = document.createElement('div');
  layout.className = 'detail-layout';

  // Left column — Company Information
  const leftCol = document.createElement('div');
  const leftTitle = document.createElement('div');
  leftTitle.className = 'detail-section-title';
  leftTitle.textContent = 'Company Information';
  leftCol.appendChild(leftTitle);
  renderDetailFields(leftCol, company);

  // Right column — Linked Contacts + Linked Deals
  const rightCol = document.createElement('div');
  await renderLinkedEntities(rightCol, company);

  layout.appendChild(leftCol);
  layout.appendChild(rightCol);
  container.appendChild(layout);

  // Activity section (full width below the two-column layout)
  const activitySection = document.createElement('div');
  activitySection.style.marginTop = '1.5rem';
  const activityTitle = document.createElement('div');
  activityTitle.className = 'detail-section-title';
  activityTitle.textContent = 'Activity';
  activitySection.appendChild(activityTitle);
  renderActivitySection(activitySection, company);
  container.appendChild(activitySection);
}

function goBackToList() {
  currentPage = 'list';
  renderListView();
}

// ---------------------------------------------------------------------------
// Detail Fields (editable inline)
// ---------------------------------------------------------------------------

function renderDetailFields(container, company) {
  const fields = [
    { key: 'name', label: 'Company Name', type: 'text' },
    { key: 'industry', label: 'Industry', type: 'text' },
    { key: 'email', label: 'Email', type: 'email' },
    { key: 'phone', label: 'Phone', type: 'tel' },
    { key: 'website', label: 'Website', type: 'text' },
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
        await logFieldEdit('companies', company.id, f.label, oldValue, newValue);
        company[f.key] = newValue;
        const idx = companies.findIndex(c => c.id === company.id);
        if (idx !== -1) companies[idx] = { ...companies[idx], [f.key]: newValue };
      }
    });

    container.appendChild(field);
  });

  // Address field (combined display, individual editing)
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
    onSave: async (newValue, oldValue) => {
      const parts = newValue.split(',').map(s => s.trim());
      const address = { street: parts[0] || '', city: parts[1] || '', state: parts[2] || '', zip: parts[3] || '', country: parts[4] || '' };
      await updateDocument('companies', company.id, { address });
      await logFieldEdit('companies', company.id, 'Address', oldValue, newValue);
      company.address = address;
    }
  });
  container.appendChild(addrField);
}

// ---------------------------------------------------------------------------
// Linked Entities (Contacts + Deals)
// ---------------------------------------------------------------------------

async function renderLinkedEntities(container, company) {
  // Linked Contacts
  let linkedContacts = [];
  try {
    linkedContacts = await queryDocumentsWhere('contacts', 'companyId', '==', company.id);
  } catch (e) {
    console.error('Failed to load linked contacts:', e);
  }

  const contactsTitle = document.createElement('div');
  contactsTitle.className = 'detail-section-title';
  contactsTitle.textContent = `Linked Contacts (${linkedContacts.length})`;
  container.appendChild(contactsTitle);

  if (linkedContacts.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.style.cssText = 'font-size:0.85rem;color:var(--gray);margin-bottom:1.5rem;';
    emptyMsg.textContent = 'No contacts linked.';
    container.appendChild(emptyMsg);
  } else {
    linkedContacts.forEach(c => {
      const row = document.createElement('div');
      row.style.cssText = 'padding:0.4rem 0;font-size:0.85rem;cursor:pointer;color:var(--accent);';
      row.textContent = `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Unnamed Contact';
      row.addEventListener('click', () => {
        window.location.hash = 'contacts';
      });
      container.appendChild(row);
    });
  }

  // Linked Deals
  let linkedDeals = [];
  try {
    linkedDeals = await queryDocumentsWhere('deals', 'companyId', '==', company.id);
  } catch (e) {
    console.error('Failed to load linked deals:', e);
  }

  const dealsTitle = document.createElement('div');
  dealsTitle.className = 'detail-section-title';
  dealsTitle.style.marginTop = '1.5rem';
  dealsTitle.textContent = `Linked Deals (${linkedDeals.length})`;
  container.appendChild(dealsTitle);

  if (linkedDeals.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.style.cssText = 'font-size:0.85rem;color:var(--gray);';
    emptyMsg.textContent = 'No deals linked.';
    container.appendChild(emptyMsg);
  } else {
    linkedDeals.forEach(d => {
      const row = document.createElement('div');
      row.style.cssText = 'padding:0.4rem 0;font-size:0.85rem;display:flex;justify-content:space-between;';
      row.innerHTML = `<span>${escapeHtml(d.name || 'Unnamed Deal')}</span><span style="color:var(--accent);font-weight:500;">${formatCurrency(d.value)}</span>`;
      container.appendChild(row);
    });
  }
}

// ---------------------------------------------------------------------------
// Activity Section (composer + timeline)
// ---------------------------------------------------------------------------

function renderActivitySection(container, company) {
  // Composer (always visible)
  const composer = document.createElement('div');
  composer.className = 'activity-composer';

  let selectedType = 'call';

  composer.innerHTML = `
    <div class="activity-type-pills">
      <button type="button" class="activity-type-pill active" data-type="call">Call</button>
      <button type="button" class="activity-type-pill" data-type="email">Email</button>
      <button type="button" class="activity-type-pill" data-type="meeting">Meeting</button>
      <button type="button" class="activity-type-pill" data-type="note">Note</button>
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
      await addActivity('companies', company.id, { type: selectedType, description: desc });
      showToast('Activity logged', 'success');
      textarea.value = '';

      // Refresh timeline
      const timeline = container.querySelector('.detail-timeline');
      if (timeline) timeline.remove();
      await loadTimeline(container, company);
    } catch (err) {
      console.error('Failed to log activity:', err);
      showToast('Failed to log activity', 'error');
    }
  });

  container.appendChild(composer);

  // Timeline
  loadTimeline(container, company);
}

async function loadTimeline(container, company) {
  let activities = [];
  try {
    activities = await getActivity('companies', company.id);
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
