import { db } from '../config.js';
import { queryDocuments, addDocument, updateDocument, deleteDocument, getDocument } from '../services/firestore.js';
import { addActivity, logFieldEdit, getActivity } from '../services/activity.js';
import { createDetailPanel } from '../components/detail-panel.js';
import { makeEditable } from '../components/inline-edit.js';
import { createDropdown } from '../components/dropdown.js';
import { showToast, escapeHtml, timeAgo, formatCurrency, formatDate } from '../ui.js';

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
let panel = null;

export function init() {
  panel = createDetailPanel();
}

export async function render() {
  try {
    await loadData();
  } catch (err) {
    console.error('Pipeline render error:', err);
  }
  renderView();
}

export function destroy() {}

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

function renderView() {
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

  topbar.querySelector('#addDealBtn').addEventListener('click', () => openCreatePanel());
  topbar.querySelector('#pipelineSettingsBtn').addEventListener('click', () => openSettingsPanel());

  renderContent(container);
}

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
        <button class="btn btn-primary" onclick="document.getElementById('addDealBtn').click()">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add First Deal
        </button>
      </div>
    `;
  } else if (currentMode === 'kanban') {
    wrapper.appendChild(renderKanban(filtered));
  } else {
    wrapper.appendChild(renderTable(filtered));
  }

  container.appendChild(wrapper);
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
        <div class="kanban-column-meta">${stageDeals.length} deal${stageDeals.length !== 1 ? 's' : ''} · ${formatCurrency(totalValue)}</div>
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
        await updateDocument('deals', dealId, { stage: stage.id });
        await logFieldEdit('deals', dealId, 'Stage', oldStage ? oldStage.label : deal.stage, stage.label);
        deal.stage = stage.id;
        renderView();
        showToast(`Moved to ${stage.label}`, 'success');
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
      card.addEventListener('click', () => openDetailPanel(deal));

      body.appendChild(card);
    });

    col.appendChild(body);
    board.appendChild(col);
  });

  return board;
}

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
    th.innerHTML = `${col.label} <span class="sort-icon">${sortField === col.key ? (sortDir === 'asc' ? '▲' : '▼') : '▲'}</span>`;
    th.addEventListener('click', () => {
      if (sortField === col.key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else { sortField = col.key; sortDir = 'asc'; }
      renderView();
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
      <td>${deal.value ? formatCurrency(deal.value) : '—'}</td>
      <td><span class="badge-status ${deal.stage}">${escapeHtml(stageObj ? stageObj.label : deal.stage)}</span></td>
      <td>${escapeHtml(deal.contactName || '—')}</td>
      <td>${escapeHtml(deal.companyName || '—')}</td>
      <td>${formatDate(deal.expectedClose)}</td>
    `;
    tr.addEventListener('click', () => openDetailPanel(deal));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  return table;
}

function openCreatePanel() {
  const form = document.createElement('div');
  form.innerHTML = `
    <form class="create-form" id="createDealForm">
      <div class="panel-field">
        <div class="panel-field-label">Deal Name *</div>
        <input type="text" name="name" required placeholder="Deal name">
      </div>
      <div class="panel-field">
        <div class="panel-field-label">Value</div>
        <input type="number" name="value" step="0.01" placeholder="0.00">
      </div>
      <div class="panel-field">
        <div class="panel-field-label">Stage</div>
        <select name="stage">
          ${stages.map(s => `<option value="${s.id}" ${s.id === 'lead' ? 'selected' : ''}>${escapeHtml(s.label)}</option>`).join('')}
        </select>
      </div>
      <div class="panel-field">
        <div class="panel-field-label">Contact</div>
        <div id="contactDropdownSlot"></div>
      </div>
      <div class="panel-field">
        <div class="panel-field-label">Expected Close</div>
        <input type="date" name="expectedClose">
      </div>
      <div class="panel-field">
        <div class="panel-field-label">Notes</div>
        <textarea name="notes" rows="3" placeholder="Notes..."></textarea>
      </div>
      <div style="display:flex;gap:0.5rem;margin-top:1rem;">
        <button type="submit" class="btn btn-primary" style="flex:1;">Save Deal</button>
        <button type="button" class="btn btn-secondary" id="cancelCreate">Cancel</button>
      </div>
    </form>
  `;

  let selectedContact = null;
  const dropdown = createDropdown({
    fetchItems: async () => contacts.map(c => ({
      id: c.id,
      label: `${c.firstName} ${c.lastName}`,
      sublabel: c.companyName || ''
    })),
    onSelect: (item) => { selectedContact = item; },
    placeholder: 'Search contacts...'
  });
  form.querySelector('#contactDropdownSlot').appendChild(dropdown);

  panel.open('New Deal', form);

  form.querySelector('#cancelCreate').addEventListener('click', () => panel.close());

  form.querySelector('#createDealForm').addEventListener('submit', async (e) => {
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
      panel.close();
      await loadData();
      renderView();
    } catch (err) {
      console.error('Create deal failed:', err);
      showToast('Failed to create deal', 'error');
    }
  });
}

async function openDetailPanel(deal) {
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
      renderDealDetails(body, deal);
    } else {
      renderDealActivity(body, deal);
    }

    content.appendChild(body);

    const deleteRow = document.createElement('div');
    deleteRow.style.cssText = 'margin-top:2rem;padding-top:1rem;border-top:1px solid #E2E8F0;';
    deleteRow.innerHTML = `<button class="btn btn-ghost" style="color:var(--danger);">Delete Deal</button>`;
    deleteRow.querySelector('button').addEventListener('click', async () => {
      if (!confirm(`Delete "${deal.name}"? This cannot be undone.`)) return;
      try {
        await deleteDocument('deals', deal.id);
        showToast('Deal deleted', 'success');
        panel.close();
        await loadData();
        renderView();
      } catch (err) {
        console.error('Delete failed:', err);
        showToast('Failed to delete deal', 'error');
      }
    });
    content.appendChild(deleteRow);
  }

  renderPanelContent();
  panel.open(deal.name, content);
}

function renderDealDetails(container, deal) {
  // Stage dropdown
  const stageField = document.createElement('div');
  stageField.className = 'panel-field';
  stageField.innerHTML = `<div class="panel-field-label">Stage</div>`;
  const stageSelect = document.createElement('select');
  stageSelect.style.cssText = 'width:100%;padding:0.4rem 0.5rem;font-size:0.9rem;border:1px solid #E2E8F0;border-radius:var(--radius-sm);';
  stages.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.label;
    if (deal.stage === s.id) opt.selected = true;
    stageSelect.appendChild(opt);
  });
  stageSelect.addEventListener('change', async () => {
    const oldStage = stages.find(s => s.id === deal.stage);
    const newStage = stages.find(s => s.id === stageSelect.value);
    await updateDocument('deals', deal.id, { stage: stageSelect.value });
    await logFieldEdit('deals', deal.id, 'Stage', oldStage ? oldStage.label : deal.stage, newStage ? newStage.label : stageSelect.value);
    deal.stage = stageSelect.value;
    showToast(`Stage: ${newStage ? newStage.label : stageSelect.value}`, 'success');
  });
  stageField.appendChild(stageSelect);
  container.appendChild(stageField);

  const textFields = [
    { key: 'name', label: 'Deal Name', type: 'text' },
    { key: 'value', label: 'Value', type: 'number' },
    { key: 'expectedClose', label: 'Expected Close', type: 'date' },
    { key: 'notes', label: 'Notes', type: 'textarea' }
  ];

  textFields.forEach(f => {
    const field = document.createElement('div');
    field.className = 'panel-field';
    field.innerHTML = `<div class="panel-field-label">${f.label}</div><div class="panel-field-value"></div>`;
    const valueEl = field.querySelector('.panel-field-value');

    makeEditable(valueEl, {
      field: f.key,
      type: f.type,
      value: deal[f.key] || '',
      onSave: async (newValue, oldValue) => {
        await updateDocument('deals', deal.id, { [f.key]: newValue });
        await logFieldEdit('deals', deal.id, f.label, oldValue, newValue);
        deal[f.key] = newValue;
      }
    });

    container.appendChild(field);
  });

  // Contact field
  const contactField = document.createElement('div');
  contactField.className = 'panel-field';
  contactField.innerHTML = `<div class="panel-field-label">Contact</div>`;
  const contactValue = document.createElement('div');
  contactValue.className = 'panel-field-value' + (deal.contactName ? '' : ' empty');
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
        await updateDocument('deals', deal.id, updates);
        await logFieldEdit('deals', deal.id, 'Contact', oldName, item.label);
        Object.assign(deal, updates);
        contactValue.textContent = item.label;
        contactValue.classList.remove('empty');
        contactValue.classList.add('flash-success');
        setTimeout(() => contactValue.classList.remove('flash-success'), 600);
      },
      placeholder: 'Search contacts...'
    });
    contactValue.appendChild(dropdown);
    contactValue.querySelector('input').focus();
  });

  contactField.appendChild(contactValue);
  container.appendChild(contactField);

  // Company (read-only, derived from contact)
  const companyField = document.createElement('div');
  companyField.className = 'panel-field';
  companyField.innerHTML = `
    <div class="panel-field-label">Company</div>
    <div class="panel-field-value${deal.companyName ? '' : ' empty'}">${escapeHtml(deal.companyName || 'Linked via contact')}</div>
  `;
  container.appendChild(companyField);
}

async function renderDealActivity(container, deal) {
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

    await addActivity('deals', deal.id, { type, description: desc });
    showToast('Activity logged', 'success');
    formWrapper.style.display = 'none';
    addBtn.style.display = '';
    formWrapper.querySelector('#activityDesc').value = '';

    const timeline = container.querySelector('.activity-timeline');
    if (timeline) timeline.remove();
    await appendDealTimeline(container, deal);
  });

  await appendDealTimeline(container, deal);
}

async function appendDealTimeline(container, deal) {
  const activities = await getActivity('deals', deal.id);

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

function openSettingsPanel() {
  const content = document.createElement('div');
  content.className = 'pipeline-settings';

  function renderSettings() {
    content.innerHTML = `
      <h3 style="margin-bottom:1rem;">Pipeline Stages</h3>
      <p style="font-size:0.8rem;color:var(--gray-dark);margin-bottom:1rem;">Drag to reorder. Won and Lost are locked as closed stages.</p>
      <div class="stage-list" id="stageList"></div>
      <button class="btn btn-secondary" id="addStageBtn" style="width:100%;margin-bottom:1rem;">+ Add Stage</button>
      <div style="display:flex;gap:0.5rem;">
        <button class="btn btn-primary" id="saveStages" style="flex:1;">Save</button>
        <button class="btn btn-ghost" id="cancelStages">Cancel</button>
      </div>
    `;

    const list = content.querySelector('#stageList');
    let editableStages = stages.map(s => ({ ...s }));

    function renderStageList() {
      list.innerHTML = '';
      editableStages.forEach((stage, idx) => {
        const item = document.createElement('div');
        item.className = 'stage-item';
        item.draggable = !stage.closed;

        if (stage.closed) {
          item.innerHTML = `
            <span class="drag-handle" style="visibility:hidden;">⠿</span>
            <input type="text" value="${escapeHtml(stage.label)}" data-idx="${idx}">
            <span class="stage-lock">closed</span>
          `;
        } else {
          item.innerHTML = `
            <span class="drag-handle">⠿</span>
            <input type="text" value="${escapeHtml(stage.label)}" data-idx="${idx}">
            <button class="btn-remove-stage" data-idx="${idx}" title="Remove">✕</button>
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
            alert(`Cannot delete "${stage.label}" — ${dealsInStage.length} deal(s) are in this stage. Move them first.`);
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

    content.querySelector('#cancelStages').addEventListener('click', () => panel.close());

    content.querySelector('#saveStages').addEventListener('click', async () => {
      list.querySelectorAll('input').forEach(input => {
        const idx = parseInt(input.dataset.idx);
        editableStages[idx].label = input.value.trim();
      });

      try {
        const { doc: firestoreDoc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
        await setDoc(firestoreDoc(db, 'settings', 'pipeline'), { stages: editableStages });
        stages = editableStages;
        showToast('Pipeline stages saved', 'success');
        panel.close();
        renderView();
      } catch (err) {
        console.error('Save stages failed:', err);
        showToast('Failed to save stages', 'error');
      }
    });
  }

  renderSettings();
  panel.open('Pipeline Settings', content);
}
