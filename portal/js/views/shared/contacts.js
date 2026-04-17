import { addDocument, updateDocument, deleteDocument, queryDocuments, queryDocumentsWhere } from '../../services/firestore.js';
import { canWrite, isReadOnly, gateWrite, term } from '../../tenant-context.js';

let contacts = [];
let searchTerm = '';
let currentPage = 'list';

export function init() {}

export async function render() {
  try {
    // Firestore orderBy filters out docs missing the field, so we sort client-side
    // to include legacy contacts (shape {name, phone, email}) alongside new ones
    // with {firstName, lastName, ...}.
    contacts = await queryDocuments('contacts', 'createdAt', 'desc');
    contacts.sort((a, b) => {
      const aName = (`${a.firstName || ''} ${a.lastName || ''}`).trim() || a.name || a.email || '';
      const bName = (`${b.firstName || ''} ${b.lastName || ''}`).trim() || b.name || b.email || '';
      return aName.localeCompare(bName);
    });
  } catch (err) { console.error(err); contacts = []; }
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
      (c.name || '').toLowerCase().includes(lower) ||
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
      const displayName = (`${c.firstName || ''} ${c.lastName || ''}`).trim() || c.name || '(No name)';
      tr.innerHTML = `
        <td style="font-weight:500;">${escapeHtml(displayName)}</td>
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
  renderDetail(contact);
}

// Fallback: some contacts were created via the check-in flow with {name, phone, email}
// instead of {firstName, lastName, ...}. Migrate on display so the UI is consistent.
function normalizeContact(c) {
  if (!c.firstName && !c.lastName && c.name) {
    const parts = String(c.name).trim().split(/\s+/);
    return {
      ...c,
      firstName: parts.shift() || '',
      lastName: parts.join(' ') || '',
    };
  }
  return c;
}

function renderDetail(raw, isEditing = false) {
  const contact = normalizeContact(raw);
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
    ${canWrite() && !isEditing ? '<button class="btn btn-ghost detail-edit-btn">Edit</button>' : ''}
    ${canWrite() ? '<button class="btn btn-ghost detail-delete-btn" style="color:var(--danger);">Delete</button>' : ''}
  `;
  container.appendChild(header);

  const editBtn = header.querySelector('.detail-edit-btn');
  if (editBtn) editBtn.addEventListener('click', () => renderDetail(contact, true));

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

  if (isEditing) {
    const form = document.createElement('form');
    form.className = 'modal-form';
    form.style.maxWidth = '600px';
    form.innerHTML = `
      <div class="modal-form-grid">
        <div class="modal-field"><label>First Name *</label><input type="text" name="firstName" value="${escapeHtml(contact.firstName || '')}" required></div>
        <div class="modal-field"><label>Last Name</label><input type="text" name="lastName" value="${escapeHtml(contact.lastName || '')}"></div>
      </div>
      <div class="modal-form-grid">
        <div class="modal-field"><label>Email</label><input type="email" name="email" value="${escapeHtml(contact.email || '')}"></div>
        <div class="modal-field"><label>Phone</label><input type="tel" name="phone" value="${escapeHtml(contact.phone || '')}"></div>
      </div>
      <div class="modal-field"><label>Company</label><input type="text" name="company" value="${escapeHtml(contact.company || '')}"></div>
      <div class="modal-field"><label>Notes</label><textarea name="notes" rows="3">${escapeHtml(contact.notes || '')}</textarea></div>
      <div style="display:flex;gap:0.5rem;margin-top:1rem;">
        <button type="submit" class="btn btn-primary">Save Changes</button>
        <button type="button" class="btn btn-ghost" id="cancelEdit">Cancel</button>
      </div>
    `;
    form.querySelector('#cancelEdit').addEventListener('click', () => renderDetail(contact, false));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const patch = {
        firstName: fd.get('firstName').trim(),
        lastName: fd.get('lastName').trim(),
        email: fd.get('email').trim(),
        phone: fd.get('phone').trim(),
        company: fd.get('company').trim(),
        notes: fd.get('notes').trim(),
        // Clear the legacy `name` field so it doesn't shadow firstName/lastName on future loads
        name: ''
      };
      try {
        await updateDocument('contacts', contact.id, patch);
        // Refresh local cache and re-render
        contacts = await queryDocuments('contacts', 'lastName', 'asc');
        const fresh = contacts.find(c => c.id === contact.id) || { ...contact, ...patch };
        renderDetail(fresh, false);
      } catch (err) {
        console.error('Save contact failed:', err);
        alert('Failed to save: ' + err.message);
      }
    });

    container.appendChild(form);
    return;
  }

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

  // Repair tickets + invoices history
  const historyHost = document.createElement('div');
  historyHost.id = 'contactHistory';
  historyHost.style.marginTop = '1.5rem';
  historyHost.innerHTML = '<p style="color:var(--gray);font-size:0.9rem;">Loading history…</p>';
  container.appendChild(historyHost);
  loadContactHistory(contact.id, historyHost);
}

async function loadContactHistory(contactId, host) {
  try {
    const [tickets, invoices] = await Promise.all([
      queryDocumentsWhere('tickets', 'contactId', '==', contactId, 'createdAt', 'desc').catch(() => []),
      queryDocumentsWhere('invoices_crm', 'contactId', '==', contactId, 'createdAt', 'desc').catch(() => []),
    ]);

    host.innerHTML = '';

    // Tickets section
    const ticketsSection = document.createElement('div');
    ticketsSection.className = 'settings-section';
    ticketsSection.style.marginBottom = '1rem';
    let ticketsHtml = `<h3 class="section-title">Repair History (${tickets.length})</h3>`;
    if (tickets.length === 0) {
      ticketsHtml += '<p style="color:var(--gray);font-size:0.9rem;">No tickets yet.</p>';
    } else {
      ticketsHtml += '<table class="data-table"><thead><tr><th>Ticket #</th><th>Device</th><th>Status</th><th>Created</th></tr></thead><tbody>';
      tickets.forEach(t => {
        const statusClass = t.status === 'completed' ? 'badge-success'
          : t.status === 'ready' ? 'badge-info'
          : t.status === 'awaiting_parts' ? 'badge-warning'
          : 'badge-default';
        const labelMap = {
          checked_in: 'Checked In', diagnosed: 'Diagnosed',
          awaiting_parts: 'Awaiting Parts', in_repair: 'In Repair',
          qc: 'Quality Check', ready: 'Ready', completed: 'Completed'
        };
        ticketsHtml += `<tr>
          <td style="font-family:monospace;font-weight:500;">${escapeHtml(t.ticketNumber || '-')}</td>
          <td>${escapeHtml(t.deviceType || '-')}</td>
          <td><span class="badge ${statusClass}">${escapeHtml(labelMap[t.status] || t.status || '-')}</span></td>
          <td>${formatDate(t.createdAt)}</td>
        </tr>`;
      });
      ticketsHtml += '</tbody></table>';
    }
    ticketsSection.innerHTML = ticketsHtml;
    host.appendChild(ticketsSection);

    // Invoices section
    const invoicesSection = document.createElement('div');
    invoicesSection.className = 'settings-section';
    const totalPaid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (Number(i.total) || 0), 0);
    const totalOutstanding = invoices.filter(i => ['draft','sent','overdue'].includes(i.status)).reduce((s, i) => s + (Number(i.total) || 0), 0);
    let invoicesHtml = `<h3 class="section-title">Invoices (${invoices.length})</h3>`;
    if (invoices.length > 0) {
      invoicesHtml += `<div style="display:flex;gap:1.5rem;font-size:0.9rem;margin-bottom:0.75rem;">
        <div><span style="color:var(--gray);">Paid:</span> <strong>${formatCurrency(totalPaid)}</strong></div>
        <div><span style="color:var(--gray);">Outstanding:</span> <strong>${formatCurrency(totalOutstanding)}</strong></div>
      </div>`;
      invoicesHtml += '<table class="data-table"><thead><tr><th>Invoice #</th><th>Ticket</th><th>Total</th><th>Status</th><th>Issued</th></tr></thead><tbody>';
      invoices.forEach(inv => {
        const statusClass = inv.status === 'paid' ? 'badge-success'
          : inv.status === 'sent' ? 'badge-info'
          : inv.status === 'overdue' ? 'badge-danger'
          : inv.status === 'void' || inv.status === 'cancelled' ? 'badge-default'
          : inv.status === 'refunded' ? 'badge-warning'
          : 'badge-default';
        invoicesHtml += `<tr>
          <td style="font-family:monospace;font-weight:500;">${escapeHtml(inv.invoiceNumber || '-')}</td>
          <td style="font-family:monospace;font-size:0.85rem;color:var(--gray);">${escapeHtml(inv.ticketNumber || '-')}</td>
          <td>${formatCurrency(inv.total)}</td>
          <td><span class="badge ${statusClass}">${escapeHtml(inv.status || 'draft')}</span></td>
          <td>${escapeHtml(inv.issueDate || '-')}</td>
        </tr>`;
      });
      invoicesHtml += '</tbody></table>';
    } else {
      invoicesHtml += '<p style="color:var(--gray);font-size:0.9rem;">No invoices yet.</p>';
    }
    invoicesSection.innerHTML = invoicesHtml;
    host.appendChild(invoicesSection);
  } catch (err) {
    console.error('Load contact history failed:', err);
    host.innerHTML = '<p style="color:var(--danger);font-size:0.9rem;">Failed to load history.</p>';
  }
}

function formatCurrency(amount) {
  if (amount == null || isNaN(amount)) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function formatDate(ts) {
  if (!ts) return '\u2014';
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    if (isNaN(d.getTime())) return '\u2014';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return '\u2014'; }
}

function escapeHtml(str) {
  if (!str) return '';
  const node = document.createElement('span');
  node.appendChild(document.createTextNode(str));
  return node.innerHTML;
}
