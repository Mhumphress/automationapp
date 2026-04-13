import { queryDocuments, addDocument, updateDocument, deleteDocument, queryDocumentsWhere } from '../services/firestore.js';
import { addActivity, logFieldEdit, getActivity } from '../services/activity.js';
import { createDetailPanel } from '../components/detail-panel.js';
import { makeEditable } from '../components/inline-edit.js';
import { createDropdown } from '../components/dropdown.js';
import { showToast, escapeHtml, timeAgo, formatCurrency } from '../ui.js';

let contacts = [];
let companies = [];
let currentMode = 'table';
let searchTerm = '';
let sortField = 'lastName';
let sortDir = 'asc';
let panel = null;

export function init() {
  panel = createDetailPanel();
}

export async function render() {
  await loadData();
  renderView();
}

export function destroy() {}

async function loadData() {
  [contacts, companies] = await Promise.all([
    queryDocuments('contacts', 'lastName', 'asc'),
    queryDocuments('companies', 'name', 'asc')
  ]);
}

function renderView() {
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

  topbar.querySelector('#addContactBtn').addEventListener('click', () => openCreatePanel());

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
        <button class="btn btn-primary" onclick="document.getElementById('addContactBtn').click()">
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
}

function getFilteredContacts() {
  let list = [...contacts];

  if (searchTerm) {
    const lower = searchTerm.toLowerCase();
    list = list.filter(c =>
      (`${c.firstName} ${c.lastName}`).toLowerCase().includes(lower) ||
      (c.email || '').toLowerCase().includes(lower) ||
      (c.companyName || '').toLowerCase().includes(lower) ||
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
    th.innerHTML = `${col.label} <span class="sort-icon">${sortField === col.key ? (sortDir === 'asc' ? '▲' : '▼') : '▲'}</span>`;
    th.addEventListener('click', () => {
      if (sortField === col.key) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortField = col.key;
        sortDir = 'asc';
      }
      renderView();
    });
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  list.forEach(contact => {
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    tr.innerHTML = `
      <td>${escapeHtml(contact.firstName)} ${escapeHtml(contact.lastName)}</td>
      <td>${escapeHtml(contact.companyName || '—')}</td>
      <td>${escapeHtml(contact.email || '—')}</td>
      <td>${escapeHtml(contact.phone || '—')}</td>
      <td>${escapeHtml(contact.jobTitle || '—')}</td>
    `;
    tr.addEventListener('click', () => openDetailPanel(contact));

    // Make company name clickable
    if (contact.companyId) {
      const companyTd = tr.querySelectorAll('td')[1];
      companyTd.style.cssText = 'color:var(--accent);cursor:pointer;';
      companyTd.addEventListener('click', (e) => {
        e.stopPropagation();
        const company = companies.find(c => c.id === contact.companyId);
        if (company) openCompanyPanel(company);
      });
    }

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  return table;
}

function renderCards(list) {
  const grid = document.createElement('div');
  grid.className = 'card-grid';

  list.forEach(contact => {
    const initials = ((contact.firstName || '')[0] || '') + ((contact.lastName || '')[0] || '');
    const card = document.createElement('div');
    card.className = 'contact-card';
    card.innerHTML = `
      <div class="contact-card-header">
        <div class="contact-card-avatar">${escapeHtml(initials.toUpperCase())}</div>
        <div>
          <div class="contact-card-name">${escapeHtml(contact.firstName)} ${escapeHtml(contact.lastName)}</div>
          ${contact.jobTitle ? `<div class="contact-card-title">${escapeHtml(contact.jobTitle)}</div>` : ''}
        </div>
      </div>
      ${contact.companyName ? `<div class="contact-card-detail">${escapeHtml(contact.companyName)}</div>` : ''}
      ${contact.email ? `<div class="contact-card-detail">${escapeHtml(contact.email)}</div>` : ''}
      ${contact.phone ? `<div class="contact-card-detail">${escapeHtml(contact.phone)}</div>` : ''}
    `;
    card.addEventListener('click', () => openDetailPanel(contact));
    grid.appendChild(card);
  });

  return grid;
}

function openCreatePanel() {
  const form = document.createElement('div');
  form.innerHTML = `
    <form class="create-form" id="createContactForm">
      <div class="panel-field">
        <div class="panel-field-label">First Name *</div>
        <input type="text" name="firstName" required placeholder="First name">
      </div>
      <div class="panel-field">
        <div class="panel-field-label">Last Name *</div>
        <input type="text" name="lastName" required placeholder="Last name">
      </div>
      <div class="panel-field">
        <div class="panel-field-label">Email</div>
        <input type="email" name="email" placeholder="email@example.com">
      </div>
      <div class="panel-field">
        <div class="panel-field-label">Phone</div>
        <input type="tel" name="phone" placeholder="Phone number">
      </div>
      <div class="panel-field">
        <div class="panel-field-label">Job Title</div>
        <input type="text" name="jobTitle" placeholder="Job title">
      </div>
      <div class="panel-field">
        <div class="panel-field-label">Company</div>
        <div id="companyDropdownSlot"></div>
      </div>
      <div class="panel-field">
        <div class="panel-field-label">Notes</div>
        <textarea name="notes" rows="3" placeholder="Notes..."></textarea>
      </div>
      <div style="display:flex;gap:0.5rem;margin-top:1rem;">
        <button type="submit" class="btn btn-primary" style="flex:1;">Save Contact</button>
        <button type="button" class="btn btn-secondary" id="cancelCreate">Cancel</button>
      </div>
    </form>
  `;

  let selectedCompany = null;
  const dropdown = createDropdown({
    fetchItems: async () => companies.map(c => ({ id: c.id, label: c.name, sublabel: c.industry || '' })),
    onSelect: (item) => { selectedCompany = item; },
    onCreate: async (name) => {
      const ref = await addDocument('companies', { name });
      await loadData();
      selectedCompany = { id: ref.id, label: name };
      showToast(`Company "${name}" created`, 'success');
    },
    placeholder: 'Search or create company...'
  });
  form.querySelector('#companyDropdownSlot').appendChild(dropdown);

  panel.open('New Contact', form);

  form.querySelector('#cancelCreate').addEventListener('click', () => panel.close());

  form.querySelector('#createContactForm').addEventListener('submit', async (e) => {
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
      panel.close();
      await loadData();
      renderView();
    } catch (err) {
      console.error('Create contact failed:', err);
      showToast('Failed to create contact', 'error');
    }
  });
}

async function openDetailPanel(contact) {
  const content = document.createElement('div');
  let activeTab = 'details';

  function renderPanelContent() {
    content.innerHTML = '';

    const tabs = document.createElement('div');
    tabs.className = 'panel-tabs';
    tabs.innerHTML = `
      <button class="panel-tab ${activeTab === 'details' ? 'active' : ''}" data-tab="details">Details</button>
      <button class="panel-tab ${activeTab === 'activity' ? 'active' : ''}" data-tab="activity">Activity</button>
    `;
    tabs.querySelectorAll('.panel-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        activeTab = tab.dataset.tab;
        renderPanelContent();
      });
    });
    content.appendChild(tabs);

    const body = document.createElement('div');
    body.style.paddingTop = '1rem';

    if (activeTab === 'details') {
      renderDetailsTab(body, contact);
    } else {
      renderActivityTab(body, contact);
    }

    content.appendChild(body);

    const deleteRow = document.createElement('div');
    deleteRow.style.cssText = 'margin-top:2rem;padding-top:1rem;border-top:1px solid #E2E8F0;';
    deleteRow.innerHTML = `<button class="btn btn-ghost" style="color:var(--danger);">Delete Contact</button>`;
    deleteRow.querySelector('button').addEventListener('click', async () => {
      if (!confirm(`Delete ${contact.firstName} ${contact.lastName}? This cannot be undone.`)) return;
      try {
        await deleteDocument('contacts', contact.id);
        showToast('Contact deleted', 'success');
        panel.close();
        await loadData();
        renderView();
      } catch (err) {
        console.error('Delete failed:', err);
        showToast('Failed to delete contact', 'error');
      }
    });
    content.appendChild(deleteRow);
  }

  renderPanelContent();
  panel.open(`${contact.firstName} ${contact.lastName}`, content);
}

function renderDetailsTab(container, contact) {
  const fields = [
    { key: 'firstName', label: 'First Name', type: 'text' },
    { key: 'lastName', label: 'Last Name', type: 'text' },
    { key: 'email', label: 'Email', type: 'email' },
    { key: 'phone', label: 'Phone', type: 'tel' },
    { key: 'jobTitle', label: 'Job Title', type: 'text' },
    { key: 'notes', label: 'Notes', type: 'textarea' }
  ];

  fields.forEach(f => {
    const field = document.createElement('div');
    field.className = 'panel-field';
    field.innerHTML = `<div class="panel-field-label">${f.label}</div><div class="panel-field-value"></div>`;
    const valueEl = field.querySelector('.panel-field-value');

    makeEditable(valueEl, {
      field: f.key,
      type: f.type,
      value: contact[f.key] || '',
      onSave: async (newValue, oldValue) => {
        await updateDocument('contacts', contact.id, { [f.key]: newValue });
        await logFieldEdit('contacts', contact.id, f.label, oldValue, newValue);
        contact[f.key] = newValue;
        const idx = contacts.findIndex(c => c.id === contact.id);
        if (idx !== -1) contacts[idx] = { ...contacts[idx], [f.key]: newValue };
      }
    });

    container.appendChild(field);
  });

  // Company field (special — uses dropdown)
  const companyField = document.createElement('div');
  companyField.className = 'panel-field';
  companyField.innerHTML = `<div class="panel-field-label">Company</div>`;

  const companyValue = document.createElement('div');
  companyValue.className = 'panel-field-value' + (contact.companyName ? '' : ' empty');
  companyValue.textContent = contact.companyName || 'Click to add...';
  companyValue.style.cursor = 'pointer';

  companyValue.addEventListener('click', () => {
    companyValue.innerHTML = '';
    const dropdown = createDropdown({
      fetchItems: async () => companies.map(c => ({ id: c.id, label: c.name, sublabel: c.industry || '' })),
      onSelect: async (item) => {
        const oldName = contact.companyName || '';
        await updateDocument('contacts', contact.id, { companyId: item.id, companyName: item.label });
        await logFieldEdit('contacts', contact.id, 'Company', oldName, item.label);
        contact.companyId = item.id;
        contact.companyName = item.label;
        companyValue.textContent = item.label;
        companyValue.classList.remove('empty');
        companyValue.classList.add('flash-success');
        setTimeout(() => companyValue.classList.remove('flash-success'), 600);
      },
      onCreate: async (name) => {
        const ref = await addDocument('companies', { name });
        await loadData();
        const oldName = contact.companyName || '';
        await updateDocument('contacts', contact.id, { companyId: ref.id, companyName: name });
        await logFieldEdit('contacts', contact.id, 'Company', oldName, name);
        contact.companyId = ref.id;
        contact.companyName = name;
        companyValue.textContent = name;
        companyValue.classList.remove('empty');
        showToast(`Company "${name}" created`, 'success');
      },
      placeholder: 'Search or create company...'
    });
    companyValue.appendChild(dropdown);
    companyValue.querySelector('input').focus();
  });

  companyField.appendChild(companyValue);
  container.appendChild(companyField);
}

async function renderActivityTab(container, contact) {
  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-secondary';
  addBtn.style.marginBottom = '1rem';
  addBtn.textContent = '+ Add Activity';

  const formWrapper = document.createElement('div');
  formWrapper.style.display = 'none';
  formWrapper.innerHTML = `
    <div class="add-activity-form">
      <select id="activityType">
        <option value="call">Call</option>
        <option value="email">Email</option>
        <option value="meeting">Meeting</option>
        <option value="note">Note</option>
      </select>
      <textarea id="activityDesc" placeholder="What happened?"></textarea>
      <div class="add-activity-actions">
        <button class="btn btn-primary btn-sm" id="saveActivity">Save</button>
        <button class="btn btn-ghost btn-sm" id="cancelActivity">Cancel</button>
      </div>
    </div>
  `;

  addBtn.addEventListener('click', () => {
    formWrapper.style.display = 'block';
    addBtn.style.display = 'none';
  });

  container.appendChild(addBtn);
  container.appendChild(formWrapper);

  formWrapper.querySelector('#cancelActivity').addEventListener('click', () => {
    formWrapper.style.display = 'none';
    addBtn.style.display = '';
  });

  formWrapper.querySelector('#saveActivity').addEventListener('click', async () => {
    const type = formWrapper.querySelector('#activityType').value;
    const desc = formWrapper.querySelector('#activityDesc').value.trim();
    if (!desc) return;

    await addActivity('contacts', contact.id, { type, description: desc });
    showToast('Activity logged', 'success');
    formWrapper.style.display = 'none';
    addBtn.style.display = '';
    formWrapper.querySelector('#activityDesc').value = '';

    const timeline = container.querySelector('.activity-timeline');
    if (timeline) timeline.remove();
    await appendTimeline(container, contact);
  });

  await appendTimeline(container, contact);
}

async function appendTimeline(container, contact) {
  const activities = await getActivity('contacts', contact.id);

  const timeline = document.createElement('div');
  timeline.className = 'activity-timeline';

  if (activities.length === 0) {
    timeline.innerHTML = '<div style="text-align:center;color:var(--gray);padding:2rem 0;font-size:0.85rem;">No activity yet.</div>';
  } else {
    activities.forEach(act => {
      const iconMap = { call: '📞', email: '✉️', meeting: '🤝', note: '📝', edit: '✏️' };
      const item = document.createElement('div');
      item.className = 'activity-item';

      let desc = escapeHtml(act.description || '');
      let diff = '';
      if (act.type === 'edit' && act.oldValue !== undefined) {
        diff = `<div class="activity-diff">"${escapeHtml(act.oldValue || '(empty)')}" → "${escapeHtml(act.newValue || '(empty)')}"</div>`;
      }

      item.innerHTML = `
        <div class="activity-icon ${act.type}">${iconMap[act.type] || '•'}</div>
        <div class="activity-body">
          <div class="activity-desc">${desc}</div>
          ${diff}
          <div class="activity-meta">${escapeHtml(act.createdByEmail || 'Unknown')} · ${timeAgo(act.createdAt)}</div>
        </div>
      `;
      timeline.appendChild(item);
    });
  }

  container.appendChild(timeline);
}

async function openCompanyPanel(company) {
  const content = document.createElement('div');

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
    field.className = 'panel-field';
    field.innerHTML = `<div class="panel-field-label">${f.label}</div><div class="panel-field-value"></div>`;
    const valueEl = field.querySelector('.panel-field-value');

    makeEditable(valueEl, {
      field: f.key,
      type: f.type,
      value: company[f.key] || '',
      onSave: async (newValue, oldValue) => {
        await updateDocument('companies', company.id, { [f.key]: newValue });
        company[f.key] = newValue;
        if (f.key === 'name') {
          const linkedContacts = contacts.filter(c => c.companyId === company.id);
          for (const c of linkedContacts) {
            await updateDocument('contacts', c.id, { companyName: newValue });
            c.companyName = newValue;
          }
        }
      }
    });

    content.appendChild(field);
  });

  // Address
  const addr = company.address || {};
  const addrStr = [addr.street, addr.city, addr.state, addr.zip, addr.country].filter(Boolean).join(', ');
  const addrField = document.createElement('div');
  addrField.className = 'panel-field';
  addrField.innerHTML = `<div class="panel-field-label">Address</div><div class="panel-field-value"></div>`;
  const addrValue = addrField.querySelector('.panel-field-value');
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
  content.appendChild(addrField);

  // Linked contacts
  const linkedContacts = contacts.filter(c => c.companyId === company.id);
  const contactsSection = document.createElement('div');
  contactsSection.style.cssText = 'margin-top:1.5rem;padding-top:1rem;border-top:1px solid #E2E8F0;';
  contactsSection.innerHTML = `<div class="panel-field-label" style="margin-bottom:0.75rem;">Linked Contacts (${linkedContacts.length})</div>`;
  if (linkedContacts.length === 0) {
    contactsSection.innerHTML += '<div style="font-size:0.85rem;color:var(--gray);">No contacts linked.</div>';
  } else {
    linkedContacts.forEach(c => {
      const row = document.createElement('div');
      row.style.cssText = 'padding:0.4rem 0;font-size:0.85rem;cursor:pointer;color:var(--accent);';
      row.textContent = `${c.firstName} ${c.lastName}`;
      row.addEventListener('click', () => openDetailPanel(c));
      contactsSection.appendChild(row);
    });
  }
  content.appendChild(contactsSection);

  // Linked deals
  let linkedDeals = [];
  try {
    linkedDeals = await queryDocumentsWhere('deals', 'companyId', '==', company.id);
  } catch (e) { console.error(e); }

  const dealsSection = document.createElement('div');
  dealsSection.style.cssText = 'margin-top:1rem;padding-top:1rem;border-top:1px solid #E2E8F0;';
  dealsSection.innerHTML = `<div class="panel-field-label" style="margin-bottom:0.75rem;">Linked Deals (${linkedDeals.length})</div>`;
  if (linkedDeals.length === 0) {
    dealsSection.innerHTML += '<div style="font-size:0.85rem;color:var(--gray);">No deals linked.</div>';
  } else {
    linkedDeals.forEach(d => {
      const row = document.createElement('div');
      row.style.cssText = 'padding:0.4rem 0;font-size:0.85rem;display:flex;justify-content:space-between;';
      row.innerHTML = `<span>${escapeHtml(d.name)}</span><span style="color:var(--accent);font-weight:500;">${formatCurrency(d.value)}</span>`;
      dealsSection.appendChild(row);
    });
  }
  content.appendChild(dealsSection);

  panel.open(company.name, content);
}
