import { addDocument, updateDocument, deleteDocument, queryDocuments } from '../../services/firestore.js';
import { canWrite, isReadOnly, gateWrite, term } from '../../tenant-context.js';

let contacts = [];
let searchTerm = '';
let currentPage = 'list';

export function init() {}

export async function render() {
  try { contacts = await queryDocuments('contacts', 'lastName', 'asc'); } catch (err) { console.error(err); contacts = []; }
  if (currentPage === 'list') renderList();
}

export function destroy() { currentPage = 'list'; }

function renderList() {
  const container = document.getElementById('view-contacts');
  container.innerHTML = '';

  const topbar = document.createElement('div');
  topbar.className = 'view-topbar';
  topbar.innerHTML = `
    <input type="text" class="search-input" placeholder="Search ${escapeHtml(term('client'))}s..." value="${escapeHtml(searchTerm)}">
    ${canWrite() ? `<button class="btn btn-primary" id="addContactBtn">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Add ${escapeHtml(term('client'))}
    </button>` : ''}
  `;
  container.appendChild(topbar);

  topbar.querySelector('.search-input').addEventListener('input', (e) => {
    searchTerm = e.target.value.trim();
    renderContent(container);
  });

  const addBtn = topbar.querySelector('#addContactBtn');
  if (addBtn) addBtn.addEventListener('click', gateWrite(() => openCreateForm(container)));

  renderContent(container);
}

function renderContent(container) {
  const existing = container.querySelector('.view-content');
  if (existing) existing.remove();

  const wrapper = document.createElement('div');
  wrapper.className = 'view-content';

  let filtered = [...contacts];
  if (searchTerm) {
    const lower = searchTerm.toLowerCase();
    filtered = filtered.filter(c =>
      (`${c.firstName || ''} ${c.lastName || ''}`).toLowerCase().includes(lower) ||
      (c.email || '').toLowerCase().includes(lower) ||
      (c.phone || '').toLowerCase().includes(lower) ||
      (c.company || '').toLowerCase().includes(lower)
    );
  }

  if (filtered.length === 0 && contacts.length === 0) {
    wrapper.innerHTML = `
      <div class="empty-state">
        <div class="empty-title">No ${escapeHtml(term('client'))}s yet</div>
        <p class="empty-description">Add your first ${escapeHtml(term('client'))} to get started.</p>
      </div>
    `;
  } else if (filtered.length === 0) {
    wrapper.innerHTML = '<div class="empty-state"><div class="empty-title">No matches</div></div>';
  } else {
    const table = document.createElement('table');
    table.className = 'data-table';
    table.innerHTML = `<thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Company</th></tr></thead>`;
    const tbody = document.createElement('tbody');
    filtered.forEach(c => {
      const tr = document.createElement('tr');
      tr.className = 'clickable';
      tr.innerHTML = `
        <td style="font-weight:500;">${escapeHtml(c.firstName || '')} ${escapeHtml(c.lastName || '')}</td>
        <td>${escapeHtml(c.email || '\u2014')}</td>
        <td>${escapeHtml(c.phone || '\u2014')}</td>
        <td>${escapeHtml(c.company || '\u2014')}</td>
      `;
      tr.addEventListener('click', () => showDetail(c, container));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrapper.appendChild(table);
  }

  container.appendChild(wrapper);
}

function openCreateForm(listContainer) {
  const container = document.getElementById('view-contacts');
  currentPage = 'create';
  container.innerHTML = '';

  const backBtn = document.createElement('button');
  backBtn.className = 'detail-back';
  backBtn.innerHTML = '&larr; Back';
  backBtn.addEventListener('click', () => { currentPage = 'list'; renderList(); });
  container.appendChild(backBtn);

  const form = document.createElement('form');
  form.className = 'modal-form';
  form.style.maxWidth = '600px';
  form.innerHTML = `
    <h2 style="margin-bottom:1rem;">New ${escapeHtml(term('client'))}</h2>
    <div class="modal-form-grid">
      <div class="modal-field"><label>First Name *</label><input type="text" name="firstName" required></div>
      <div class="modal-field"><label>Last Name *</label><input type="text" name="lastName" required></div>
    </div>
    <div class="modal-form-grid">
      <div class="modal-field"><label>Email</label><input type="email" name="email"></div>
      <div class="modal-field"><label>Phone</label><input type="tel" name="phone"></div>
    </div>
    <div class="modal-field"><label>Company</label><input type="text" name="company"></div>
    <div class="modal-field"><label>Notes</label><textarea name="notes" rows="3"></textarea></div>
    <div style="display:flex;gap:0.5rem;margin-top:1rem;">
      <button type="submit" class="btn btn-primary">Create</button>
      <button type="button" class="btn btn-ghost" id="cancelCreate">Cancel</button>
    </div>
  `;

  form.querySelector('#cancelCreate').addEventListener('click', () => { currentPage = 'list'; renderList(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    try {
      await addDocument('contacts', {
        firstName: fd.get('firstName').trim(),
        lastName: fd.get('lastName').trim(),
        email: fd.get('email').trim(),
        phone: fd.get('phone').trim(),
        company: fd.get('company').trim(),
        notes: fd.get('notes').trim()
      });
      currentPage = 'list';
      await render();
    } catch (err) {
      console.error('Create contact failed:', err);
      alert('Failed to create contact: ' + err.message);
    }
  });

  container.appendChild(form);
}

function showDetail(contact, listContainer) {
  currentPage = 'detail';
  const container = document.getElementById('view-contacts');
  container.innerHTML = '';

  const backBtn = document.createElement('button');
  backBtn.className = 'detail-back';
  backBtn.innerHTML = '&larr; Back';
  backBtn.addEventListener('click', () => { currentPage = 'list'; renderList(); });
  container.appendChild(backBtn);

  const header = document.createElement('div');
  header.className = 'detail-header';
  const initials = ((contact.firstName || '')[0] || '') + ((contact.lastName || '')[0] || '');
  header.innerHTML = `
    <div class="detail-avatar" style="width:64px;height:64px;font-size:1.5rem;">${escapeHtml(initials.toUpperCase())}</div>
    <div style="flex:1;">
      <div class="detail-name">${escapeHtml(contact.firstName || '')} ${escapeHtml(contact.lastName || '')}</div>
      <div class="detail-subtitle">${escapeHtml(contact.company || '')} ${contact.email ? '&middot; ' + escapeHtml(contact.email) : ''}</div>
    </div>
    ${canWrite() ? '<button class="btn btn-ghost detail-delete-btn" style="color:var(--danger);">Delete</button>' : ''}
  `;
  container.appendChild(header);

  const deleteBtn = header.querySelector('.detail-delete-btn');
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    if (!confirm('Delete this contact?')) return;
    try {
      await deleteDocument('contacts', contact.id);
      currentPage = 'list';
      await render();
    } catch (err) {
      alert('Failed to delete: ' + err.message);
    }
  });

  const fields = [
    { label: 'First Name', value: contact.firstName },
    { label: 'Last Name', value: contact.lastName },
    { label: 'Email', value: contact.email },
    { label: 'Phone', value: contact.phone },
    { label: 'Company', value: contact.company },
    { label: 'Notes', value: contact.notes },
  ];

  const detailFields = document.createElement('div');
  fields.forEach(f => {
    const field = document.createElement('div');
    field.className = 'detail-field';
    field.innerHTML = `<div class="detail-field-label">${escapeHtml(f.label)}</div><div class="detail-field-value">${escapeHtml(f.value || '\u2014')}</div>`;
    detailFields.appendChild(field);
  });
  container.appendChild(detailFields);
}

function escapeHtml(str) {
  if (!str) return '';
  const node = document.createElement('span');
  node.appendChild(document.createTextNode(str));
  return node.innerHTML;
}
