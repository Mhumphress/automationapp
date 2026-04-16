import { db } from '../config.js';
import { queryDocuments, addDocument, updateDocument, deleteDocument, getDocument } from '../services/firestore.js';
import { addActivity, logFieldEdit, getActivity } from '../services/activity.js';
import { createModal } from '../components/modal.js';
import { makeEditable } from '../components/inline-edit.js';
import { createDropdown } from '../components/dropdown.js';
import { showToast, escapeHtml, timeAgo, formatCurrency, formatDate } from '../ui.js';
import { createContactFromDropdown } from '../utils/entity-create.js';
import { canDelete } from '../services/roles.js';

const DEFAULT_STAGES = [
  { id: 'lead', label: 'Lead', order: 0 },
  { id: 'qualified', label: 'Qualified', order: 1 },
  { id: 'proposal', label: 'Proposal', order: 2 },
  { id: 'won', label: 'Won', order: 3, closed: true },
  { id: 'lost', label: 'Lost', order: 4, closed: true }
];

let deals = [];
let contacts = [];
let companies = [];
let stages = [...DEFAULT_STAGES];
let currentMode = 'kanban';
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
    console.error('Pipeline render error:', err);
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
      queryDocuments('deals', 'createdAt', 'desc'),
      queryDocuments('contacts', 'lastName', 'asc'),
      queryDocuments('companies', 'name', 'asc'),
      getDocument('settings', 'pipeline')
    ]);
    deals = results[0].status === 'fulfilled' ? results[0].value : [];
    contacts = results[1].status === 'fulfilled' ? results[1].value : [];
    companies = results[2].status === 'fulfilled' ? results[2].value : [];
    const stagesDoc = results[3].status === 'fulfilled' ? results[3].value : null;
    if (stagesDoc && stagesDoc.stages) {
      stages = stagesDoc.stages;
    }
    results.forEach((r, i) => {
      if (r.status === 'rejected') console.error(`loadData query ${i} failed:`, r.reason);
    });
  } catch (err) {
    console.error('loadData error:', err);
  }
}

// ---------------------------------------------------------------------------
// List View
// ---------------------------------------------------------------------------

function renderListView() {
  const container = document.getElementById('view-pipeline');
  container.innerHTML = '';

  const topbar = document.createElement('div');
  topbar.className = 'view-topbar';
  topbar.innerHTML = `
    <input type="text" class="search-input" placeholder="Search deals..." value="${escapeHtml(searchTerm)}">
    <div class="view-toggle">
      <button data-mode="kanban" class="${currentMode === 'kanban' ? 'active' : ''}">Kanban</button>
      <button data-mode="table" class="${currentMode === 'table' ? 'active' : ''}">Table</button>
    </div>
    <button class="btn btn-ghost" id="pipelineSettingsBtn" title="Pipeline settings">
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
    </button>
    <button class="btn btn-primary" id="addDealBtn">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Add Deal
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

  topbar.querySelector('#addDealBtn').addEventListener('click', () => openCreateModal());
  topbar.querySelector('#pipelineSettingsBtn').addEventListener('click', () => openSettingsModal());

  renderContent(container);
}

// ---------------------------------------------------------------------------
// Content Switcher (empty state / kanban / table)
// ---------------------------------------------------------------------------

function renderContent(container) {
  const existing = container.querySelector('.view-content');
  if (existing) existing.remove();

  const wrapper = document.createElement('div');
  wrapper.className = 'view-content';

  const filtered = getFilteredDeals();

  if (filtered.length === 0 && deals.length === 0) {
    wrapper.innerHTML = `
      <div class="empty-state">
        <svg class="empty-icon" xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
        <div class="empty-title">No deals yet</div>
        <p class="empty-description">Start tracking your sales pipeline by adding your first deal.</p>
        <button class="btn btn-primary empty-state-add">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add First Deal
        </button>
      </div>
    `;
  } else if (filtered.length === 0) {
    wrapper.innerHTML = `
      <div class="empty-state">
        <div class="empty-title">No matches</div>
        <p class="empty-description">No deals match your search.</p>
      </div>
    `;
  } else if (currentMode === 'kanban') {
    wrapper.appendChild(renderKanban(filtered));
  } else {
    wrapper.appendChild(renderTable(filtered));
  }

  container.appendChild(wrapper);
  const emptyAddBtn = wrapper.querySelector('.empty-state-add');
  if (emptyAddBtn) emptyAddBtn.addEventListener('click', () => openCreateModal());
}

function getFilteredDeals() {
  let list = [...deals];
  if (searchTerm) {
    const lower = searchTerm.toLowerCase();
    list = list.filter(d =>
      (d.name || '').toLowerCase().includes(lower) ||
      (d.contactName || '').toLowerCase().includes(lower) ||
      (d.companyName || '').toLowerCase().includes(lower)
    );
  }
  return list;
}

// ---------------------------------------------------------------------------
// Kanban
// ---------------------------------------------------------------------------

function renderKanban(list) {
  const board = document.createElement('div');
  board.className = 'kanban-board';

  stages.forEach(stage => {
    const stageDeals = list.filter(d => d.stage === stage.id);
    const totalValue = stageDeals.reduce((sum, d) => sum + (d.value || 0), 0);

    const col = document.createElement('div');
    col.className = 'kanban-column';
    col.dataset.stage = stage.id;

    col.innerHTML = `
      <div class="kanban-column-header">
        <div class="kanban-column-title">${escapeHtml(stage.label)}</div>
        <div class="kanban-column-meta">${stageDeals.length} deal${stageDeals.length !== 1 ? 's' : ''} &middot; ${formatCurrency(totalValue)}</div>
      </div>
    `;

    const body = document.createElement('div');
    body.className = 'kanban-column-body';
    body.dataset.stage = stage.id;

    body.addEventListener('dragover', (e) => {
      e.preventDefault();
      body.classList.add('drag-over');
    });
    body.addEventListener('dragleave', () => body.classList.remove('drag-over'));
    body.addEventListener('drop', async (e) => {
      e.preventDefault();
      body.classList.remove('drag-over');
      const dealId = e.dataTransfer.getData('text/plain');
      const deal = deals.find(d => d.id === dealId);
      if (deal && deal.stage !== stage.id) {
        const oldStage = stages.find(s => s.id === deal.stage);
        try {
          await updateDocument('deals', dealId, { stage: stage.id });
          await logFieldEdit('deals', dealId, 'Stage', oldStage ? oldStage.label : deal.stage, stage.label);
          deal.stage = stage.id;
          renderListView();
          showToast(`Moved to ${stage.label}`, 'success');
        } catch (err) {
          console.error('Drag stage change failed:', err);
          showToast('Failed to move deal', 'error');
        }
      }
    });

    stageDeals.forEach(deal => {
      const card = document.createElement('div');
      card.className = 'deal-card';
      card.draggable = true;
      card.dataset.dealId = deal.id;

      card.innerHTML = `
        <div class="deal-card-name">${escapeHtml(deal.name)}</div>
        ${deal.value ? `<div class="deal-card-value">${formatCurrency(deal.value)}</div>` : ''}
        <div class="deal-card-meta">
          ${deal.contactName ? `<span>${escapeHtml(deal.contactName)}</span>` : ''}
          ${deal.companyName ? `<span>${escapeHtml(deal.companyName)}</span>` : ''}
          ${deal.expectedClose ? `<span>Close: ${formatDate(deal.expectedClose)}</span>` : ''}
        </div>
      `;

      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', deal.id);
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      card.addEventListener('click', () => showDealDetail(deal));

      body.appendChild(card);
    });

    col.appendChild(body);
    board.appendChild(col);
  });

  return board;
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

function renderTable(list) {
  const sorted = [...list].sort((a, b) => {
    let valA = a[sortField] || '';
    let valB = b[sortField] || '';
    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();
    if (valA < valB) return sortDir === 'asc' ? -1 : 1;
    if (valA > valB) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const table = document.createElement('table');
  table.className = 'data-table';

  const columns = [
    { key: 'name', label: 'Deal' },
    { key: 'value', label: 'Value' },
    { key: 'stage', label: 'Stage' },
    { key: 'contactName', label: 'Contact' },
    { key: 'companyName', label: 'Company' },
    { key: 'expectedClose', label: 'Expected Close' }
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
  sorted.forEach(deal => {
    const stageObj = stages.find(s => s.id === deal.stage);
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    tr.innerHTML = `
      <td>${escapeHtml(deal.name)}</td>
      <td>${deal.value ? formatCurrency(deal.value) : '\u2014'}</td>
      <td><span class="badge-status ${deal.stage}">${escapeHtml(stageObj ? stageObj.label : deal.stage)}</span></td>
      <td>${escapeHtml(deal.contactName || '\u2014')}</td>
      <td>${escapeHtml(deal.companyName || '\u2014')}</td>
      <td>${formatDate(deal.expectedClose)}</td>
    `;
    tr.addEventListener('click', () => showDealDetail(deal));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  return table;
}

// ---------------------------------------------------------------------------
// Create Deal Modal
// ---------------------------------------------------------------------------

function openCreateModal() {
  const form = document.createElement('form');
  form.className = 'modal-form';
  form.innerHTML = `
    <div class="modal-field">
      <label>Deal Name *</label>
      <input type="text" name="name" required placeholder="Deal name">
    </div>
    <div class="modal-form-grid">
      <div class="modal-field">
        <label>Value</label>
        <input type="number" name="value" step="0.01" placeholder="0.00">
      </div>
      <div class="modal-field">
        <label>Stage</label>
        <select name="stage">
          ${stages.map(s => `<option value="${s.id}" ${s.id === 'lead' ? 'selected' : ''}>${escapeHtml(s.label)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="modal-field">
      <label>Contact</label>
      <div id="contactSlot"></div>
    </div>
    <div class="modal-field">
      <label>Expected Close</label>
      <input type="date" name="expectedClose">
    </div>
    <div class="modal-field">
      <label>Notes</label>
      <textarea name="notes" rows="3" placeholder="Notes..."></textarea>
    </div>
    <div class="modal-actions">
      <button type="submit" class="btn btn-primary btn-lg">Create Deal</button>
      <span class="modal-cancel">Cancel</span>
    </div>
  `;

  let selectedContact = null;
  const dropdown = createDropdown({
    fetchItems: async () => contacts.map(c => ({
      id: c.id,
      label: `${c.firstName} ${c.lastName}`,
      sublabel: c.companyName || ''
    })),
    onSelect: (item) => { selectedContact = item; },
    onCreate: async (name) => {
      const result = await createContactFromDropdown(name);
      if (result) {
        await loadData();
        selectedContact = result;
        dropdown.setSelected && dropdown.setSelected(result);
      }
    },
    placeholder: 'Search contacts...'
  });
  form.querySelector('#contactSlot').appendChild(dropdown);

  modal.open('New Deal', form);

  form.querySelector('.modal-cancel').addEventListener('click', () => modal.close());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);

    let companyId = '';
    let companyName = '';
    if (selectedContact) {
      const contact = contacts.find(c => c.id === selectedContact.id);
      if (contact) {
        companyId = contact.companyId || '';
        companyName = contact.companyName || '';
      }
    }

    const data = {
      name: fd.get('name').trim(),
      value: parseFloat(fd.get('value')) || 0,
      stage: fd.get('stage'),
      contactId: selectedContact ? selectedContact.id : '',
      contactName: selectedContact ? selectedContact.label : '',
      companyId,
      companyName,
      expectedClose: fd.get('expectedClose') || '',
      notes: fd.get('notes').trim()
    };

    try {
      await addDocument('deals', data);
      showToast('Deal created', 'success');
      modal.close();
      await loadData();
      renderListView();
    } catch (err) {
      console.error('Create deal failed:', err);
      showToast('Failed to create deal', 'error');
    }
  });
}

// ---------------------------------------------------------------------------
// Deal Detail Page
// ---------------------------------------------------------------------------

async function showDealDetail(deal) {
  currentPage = 'detail';
  const container = document.getElementById('view-pipeline');
  container.innerHTML = '';

  // Back button
  const backBtn = document.createElement('button');
  backBtn.className = 'detail-back';
  backBtn.innerHTML = '&larr; Back to Pipeline';
  backBtn.addEventListener('click', () => goBackToList());
  container.appendChild(backBtn);

  // Header
  const allowDelete = await canDelete(deal);
  const header = document.createElement('div');
  header.className = 'detail-header';
  header.innerHTML = `
    <div class="detail-avatar" style="background:var(--accent-dim);color:var(--accent);">$</div>
    <div style="flex:1;">
      <div class="detail-name">${escapeHtml(deal.name)}</div>
      <div class="detail-subtitle" style="color:var(--accent);font-family:var(--font-display);font-size:1.25rem;font-weight:600;">${formatCurrency(deal.value || 0)}</div>
    </div>
    ${allowDelete ? '<button class="btn btn-ghost detail-delete-btn" style="color:var(--danger);">Delete</button>' : ''}
  `;
  container.appendChild(header);

  // Delete handler
  const deleteBtn = header.querySelector('.detail-delete-btn');
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    if (!confirm(`Delete "${deal.name}"? This cannot be undone.`)) return;
    try {
      await deleteDocument('deals', deal.id);
      showToast('Deal deleted', 'success');
      await loadData();
      goBackToList();
    } catch (err) {
      console.error('Delete failed:', err);
      showToast('Failed to delete deal', 'error');
    }
  });

  // Stage pills
  const pillsContainer = document.createElement('div');
  pillsContainer.className = 'stage-pills';
  renderStagePills(pillsContainer, deal, container);
  container.appendChild(pillsContainer);

  // Two-column layout
  const layout = document.createElement('div');
  layout.className = 'detail-layout';

  // Left column — Deal Information
  const leftCol = document.createElement('div');
  const leftTitle = document.createElement('div');
  leftTitle.className = 'detail-section-title';
  leftTitle.textContent = 'Deal Information';
  leftCol.appendChild(leftTitle);
  renderDealFields(leftCol, deal);

  // Right column — Activity
  const rightCol = document.createElement('div');
  const rightTitle = document.createElement('div');
  rightTitle.className = 'detail-section-title';
  rightTitle.textContent = 'Activity';
  rightCol.appendChild(rightTitle);
  renderDealActivity(rightCol, deal);

  layout.appendChild(leftCol);
  layout.appendChild(rightCol);
  container.appendChild(layout);
}

// ---------------------------------------------------------------------------
// Stage Pills
// ---------------------------------------------------------------------------

function renderStagePills(pillsContainer, deal, pageContainer) {
  pillsContainer.innerHTML = '';

  stages.forEach(stage => {
    const pill = document.createElement('button');
    pill.className = 'stage-pill' + (deal.stage === stage.id ? ' active' : '');
    pill.textContent = stage.label;

    pill.addEventListener('click', async () => {
      if (deal.stage === stage.id) return;
      const oldStage = stages.find(s => s.id === deal.stage);
      const newStage = stage;
      try {
        await updateDocument('deals', deal.id, { stage: stage.id });
        await logFieldEdit('deals', deal.id, 'Stage', oldStage?.label || deal.stage, newStage.label);
        deal.stage = stage.id;
        // Re-render pills to show new active state
        renderStagePills(pillsContainer, deal, pageContainer);
        // Update subtitle value display
        const subtitle = pageContainer.querySelector('.detail-subtitle');
        if (subtitle) {
          subtitle.style.color = 'var(--accent)';
        }
        showToast(`Stage: ${newStage.label}`, 'success');
      } catch (err) {
        console.error('Stage change failed:', err);
        showToast('Failed to change stage', 'error');
      }
    });

    pillsContainer.appendChild(pill);
  });
}

// ---------------------------------------------------------------------------
// Deal Fields (editable inline)
// ---------------------------------------------------------------------------

function renderDealFields(container, deal) {
  const textFields = [
    { key: 'name', label: 'Deal Name', type: 'text' },
    { key: 'value', label: 'Value', type: 'number' },
    { key: 'expectedClose', label: 'Expected Close', type: 'date' },
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
      value: deal[f.key] || '',
      onSave: async (newValue, oldValue) => {
        await updateDocument('deals', deal.id, { [f.key]: newValue });
        await logFieldEdit('deals', deal.id, f.label, oldValue, newValue);
        deal[f.key] = newValue;
        const idx = deals.findIndex(d => d.id === deal.id);
        if (idx !== -1) deals[idx] = { ...deals[idx], [f.key]: newValue };
      }
    });

    container.appendChild(field);
  });

  // Contact field (dropdown on click)
  const contactField = document.createElement('div');
  contactField.className = 'detail-field';
  contactField.innerHTML = `<div class="detail-field-label">Contact</div>`;

  const contactValue = document.createElement('div');
  contactValue.className = 'detail-field-value' + (deal.contactName ? '' : ' empty');
  contactValue.textContent = deal.contactName || 'Click to add...';
  contactValue.style.cursor = 'pointer';

  contactValue.addEventListener('click', () => {
    contactValue.innerHTML = '';
    const dropdown = createDropdown({
      fetchItems: async () => contacts.map(c => ({
        id: c.id,
        label: `${c.firstName} ${c.lastName}`,
        sublabel: c.companyName || ''
      })),
      onSelect: async (item) => {
        const oldName = deal.contactName || '';
        const contact = contacts.find(c => c.id === item.id);
        const updates = {
          contactId: item.id,
          contactName: item.label,
          companyId: contact ? contact.companyId || '' : '',
          companyName: contact ? contact.companyName || '' : ''
        };
        try {
          await updateDocument('deals', deal.id, updates);
          await logFieldEdit('deals', deal.id, 'Contact', oldName, item.label);
          Object.assign(deal, updates);
          contactValue.textContent = item.label;
          contactValue.classList.remove('empty');
          contactValue.classList.add('flash-success');
          setTimeout(() => contactValue.classList.remove('flash-success'), 600);
        } catch (err) {
          console.error('Contact update failed:', err);
          showToast('Failed to update contact', 'error');
        }
      },
      onCreate: async (name) => {
        const result = await createContactFromDropdown(name);
        if (result) {
          await loadData();
          const contact = contacts.find(c => c.id === result.id);
          const updates = {
            contactId: result.id,
            contactName: result.label,
            companyId: contact ? contact.companyId || '' : '',
            companyName: contact ? contact.companyName || '' : ''
          };
          try {
            await updateDocument('deals', deal.id, updates);
            await logFieldEdit('deals', deal.id, 'Contact', deal.contactName || '', result.label);
            Object.assign(deal, updates);
            contactValue.textContent = result.label;
            contactValue.classList.remove('empty');
            contactValue.classList.add('flash-success');
            setTimeout(() => contactValue.classList.remove('flash-success'), 600);
          } catch (err) {
            console.error('Contact update failed:', err);
            showToast('Failed to update contact', 'error');
          }
        }
      },
      placeholder: 'Search contacts...'
    });
    contactValue.appendChild(dropdown);
    const input = contactValue.querySelector('input');
    if (input) input.focus();
  });

  contactField.appendChild(contactValue);
  container.appendChild(contactField);

  // Company (read-only, derived from contact)
  const companyField = document.createElement('div');
  companyField.className = 'detail-field';
  companyField.innerHTML = `
    <div class="detail-field-label">Company</div>
    <div class="detail-field-value${deal.companyName ? '' : ' empty'}">${escapeHtml(deal.companyName || 'Linked via contact')}</div>
  `;
  container.appendChild(companyField);
}

// ---------------------------------------------------------------------------
// Deal Activity (composer + timeline)
// ---------------------------------------------------------------------------

function renderDealActivity(container, deal) {
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
      await addActivity('deals', deal.id, { type: selectedType, description: desc });
      showToast('Activity logged', 'success');
      textarea.value = '';

      // Refresh timeline
      const timeline = container.querySelector('.detail-timeline');
      if (timeline) timeline.remove();
      await loadDealTimeline(container, deal);
    } catch (err) {
      console.error('Failed to log activity:', err);
      showToast('Failed to log activity', 'error');
    }
  });

  container.appendChild(composer);

  // Timeline
  loadDealTimeline(container, deal);
}

async function loadDealTimeline(container, deal) {
  let activities = [];
  try {
    activities = await getActivity('deals', deal.id);
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
// Back to List
// ---------------------------------------------------------------------------

function goBackToList() {
  currentPage = 'list';
  renderListView();
}

// ---------------------------------------------------------------------------
// Pipeline Settings Modal
// ---------------------------------------------------------------------------

function openSettingsModal() {
  const content = document.createElement('div');
  content.className = 'pipeline-settings';

  let editableStages = stages.map(s => ({ ...s }));

  function renderSettings() {
    content.innerHTML = `
      <p style="font-size:0.8rem;color:var(--gray-dark);margin-bottom:1rem;">Drag to reorder. Won and Lost are locked as closed stages.</p>
      <div class="stage-list" id="stageList"></div>
      <button class="btn btn-ghost" id="addStageBtn" style="width:100%;margin-bottom:1rem;">+ Add Stage</button>
      <div class="modal-actions">
        <button class="btn btn-primary btn-lg" id="saveStages">Save</button>
        <span class="modal-cancel" id="cancelStages">Cancel</span>
      </div>
    `;

    const list = content.querySelector('#stageList');

    function renderStageList() {
      list.innerHTML = '';
      editableStages.forEach((stage, idx) => {
        const item = document.createElement('div');
        item.className = 'stage-item';
        item.draggable = !stage.closed;

        if (stage.closed) {
          item.innerHTML = `
            <span class="drag-handle" style="visibility:hidden;">&#x2807;</span>
            <input type="text" value="${escapeHtml(stage.label)}" data-idx="${idx}">
            <span class="stage-lock">closed</span>
          `;
        } else {
          item.innerHTML = `
            <span class="drag-handle">&#x2807;</span>
            <input type="text" value="${escapeHtml(stage.label)}" data-idx="${idx}">
            <button class="btn-remove-stage" data-idx="${idx}" title="Remove">&#x2715;</button>
          `;
        }

        item.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', String(idx));
        });
        item.addEventListener('dragover', (e) => e.preventDefault());
        item.addEventListener('drop', (e) => {
          e.preventDefault();
          const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
          const toIdx = idx;
          if (fromIdx === toIdx) return;
          const [moved] = editableStages.splice(fromIdx, 1);
          editableStages.splice(toIdx, 0, moved);
          editableStages.forEach((s, i) => s.order = i);
          renderStageList();
        });

        list.appendChild(item);
      });

      list.querySelectorAll('.btn-remove-stage').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.idx);
          const stage = editableStages[idx];
          const dealsInStage = deals.filter(d => d.stage === stage.id);
          if (dealsInStage.length > 0) {
            alert(`Cannot delete "${stage.label}" \u2014 ${dealsInStage.length} deal(s) are in this stage. Move them first.`);
            return;
          }
          editableStages.splice(idx, 1);
          editableStages.forEach((s, i) => s.order = i);
          renderStageList();
        });
      });

      list.querySelectorAll('input').forEach(input => {
        input.addEventListener('change', () => {
          const idx = parseInt(input.dataset.idx);
          editableStages[idx].label = input.value.trim();
        });
      });
    }

    renderStageList();

    content.querySelector('#addStageBtn').addEventListener('click', () => {
      const closedStages = editableStages.filter(s => s.closed);
      const openStages = editableStages.filter(s => !s.closed);
      const newId = 'stage_' + Date.now();
      openStages.push({ id: newId, label: 'New Stage', order: openStages.length });
      editableStages = [...openStages, ...closedStages];
      editableStages.forEach((s, i) => s.order = i);
      renderStageList();
    });

    content.querySelector('#cancelStages').addEventListener('click', () => modal.close());

    content.querySelector('#saveStages').addEventListener('click', async () => {
      // Flush any pending input changes
      list.querySelectorAll('input').forEach(input => {
        const idx = parseInt(input.dataset.idx);
        editableStages[idx].label = input.value.trim();
      });

      try {
        const { doc: firestoreDoc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
        await setDoc(firestoreDoc(db, 'settings', 'pipeline'), { stages: editableStages });
        stages = editableStages;
        showToast('Pipeline stages saved', 'success');
        modal.close();
        renderListView();
      } catch (err) {
        console.error('Save stages failed:', err);
        showToast('Failed to save stages', 'error');
      }
    });
  }

  renderSettings();
  modal.open('Pipeline Settings', content);
}
