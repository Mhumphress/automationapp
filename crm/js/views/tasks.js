import { auth } from '../config.js';
import { queryDocuments, addDocument, updateDocument, deleteDocument, queryDocumentsWhere } from '../services/firestore.js';
import { addActivity, logFieldEdit, getActivity } from '../services/activity.js';
import { createModal } from '../components/modal.js';
import { makeEditable } from '../components/inline-edit.js';
import { createDropdown } from '../components/dropdown.js';
import { showToast, escapeHtml, timeAgo, formatDate } from '../ui.js';
import { createContactFromDropdown } from '../utils/entity-create.js';
import { canDelete } from '../services/roles.js';

let tasks = [];
let contacts = [];
let deals = [];
let searchTerm = '';
let currentPage = 'list'; // 'list' or 'detail'
let modal = null;

const STATUSES = [
  { id: 'todo', label: 'To Do' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'done', label: 'Done' }
];

export function init() {
  modal = createModal();
}

export async function render() {
  try {
    await loadData();
  } catch (err) {
    console.error('Tasks render error:', err);
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
      queryDocuments('tasks', 'createdAt', 'desc'),
      queryDocuments('contacts', 'lastName', 'asc'),
      queryDocuments('deals', 'createdAt', 'desc')
    ]);
    tasks = results[0].status === 'fulfilled' ? results[0].value : [];
    contacts = results[1].status === 'fulfilled' ? results[1].value : [];
    deals = results[2].status === 'fulfilled' ? results[2].value : [];
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

function isOverdue(task) {
  if (!task.dueDate || task.status === 'done') return false;
  try {
    const d = task.dueDate.toDate ? task.dueDate.toDate() : new Date(task.dueDate);
    return d < new Date();
  } catch { return false; }
}

function formatDueDate(task) {
  if (!task.dueDate) return '';
  try {
    const d = task.dueDate.toDate ? task.dueDate.toDate() : new Date(task.dueDate);
    if (isNaN(d.getTime())) return '';

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dueDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffMs = dueDay - today;
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (task.status !== 'done' && diffDays < 0) {
      return 'Overdue: ' + formatDate(task.dueDate);
    }
    if (diffDays === 0) return 'Due today';
    if (diffDays === 1) return 'Due tomorrow';
    return formatDate(task.dueDate);
  } catch { return ''; }
}

function getFilteredTasks() {
  let list = [...tasks];
  if (searchTerm) {
    const lower = searchTerm.toLowerCase();
    list = list.filter(t =>
      (t.title || '').toLowerCase().includes(lower) ||
      (t.description || '').toLowerCase().includes(lower) ||
      (t.assignee || '').toLowerCase().includes(lower) ||
      (t.contactName || '').toLowerCase().includes(lower) ||
      (t.dealName || '').toLowerCase().includes(lower)
    );
  }
  return list;
}

// ---------------------------------------------------------------------------
// List View
// ---------------------------------------------------------------------------

function renderListView() {
  const container = document.getElementById('view-tasks');
  container.innerHTML = '';

  const topbar = document.createElement('div');
  topbar.className = 'view-topbar';
  topbar.innerHTML = `
    <input type="text" class="search-input" placeholder="Search tasks..." value="${escapeHtml(searchTerm)}">
    <button class="btn btn-primary" id="addTaskBtn">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Add Task
    </button>
  `;
  container.appendChild(topbar);

  topbar.querySelector('.search-input').addEventListener('input', (e) => {
    searchTerm = e.target.value.trim();
    renderContent(container);
  });

  topbar.querySelector('#addTaskBtn').addEventListener('click', () => openCreateModal());

  renderContent(container);
}

function renderContent(container) {
  const existing = container.querySelector('.view-content');
  if (existing) existing.remove();

  const wrapper = document.createElement('div');
  wrapper.className = 'view-content';

  const filtered = getFilteredTasks();

  if (filtered.length === 0 && tasks.length === 0) {
    wrapper.innerHTML = `
      <div class="empty-state">
        <svg class="empty-icon" xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 12l2 2 4-4"/>
        </svg>
        <div class="empty-title">No tasks yet</div>
        <p class="empty-description">Create your first task to start tracking work.</p>
        <button class="btn btn-primary empty-state-add">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add First Task
        </button>
      </div>
    `;
  } else if (filtered.length === 0) {
    wrapper.innerHTML = `
      <div class="empty-state">
        <div class="empty-title">No matches</div>
        <p class="empty-description">No tasks match your search.</p>
      </div>
    `;
  } else {
    wrapper.appendChild(renderKanban(filtered));
  }

  container.appendChild(wrapper);
  const emptyAddBtn = wrapper.querySelector('.empty-state-add');
  if (emptyAddBtn) emptyAddBtn.addEventListener('click', () => openCreateModal());
}

// ---------------------------------------------------------------------------
// Kanban Board
// ---------------------------------------------------------------------------

function renderKanban(list) {
  const board = document.createElement('div');
  board.className = 'kanban-board';

  STATUSES.forEach(status => {
    const statusTasks = list.filter(t => t.status === status.id);

    const col = document.createElement('div');
    col.className = 'kanban-column';
    col.dataset.status = status.id;

    col.innerHTML = `
      <div class="kanban-column-header">
        <div class="kanban-column-title">${escapeHtml(status.label)}</div>
        <div class="kanban-column-meta">${statusTasks.length} task${statusTasks.length !== 1 ? 's' : ''}</div>
      </div>
    `;

    const body = document.createElement('div');
    body.className = 'kanban-column-body';
    body.dataset.status = status.id;

    body.addEventListener('dragover', (e) => {
      e.preventDefault();
      body.classList.add('drag-over');
    });
    body.addEventListener('dragleave', () => body.classList.remove('drag-over'));
    body.addEventListener('drop', async (e) => {
      e.preventDefault();
      body.classList.remove('drag-over');
      const taskId = e.dataTransfer.getData('text/plain');
      const task = tasks.find(t => t.id === taskId);
      if (task && task.status !== status.id) {
        const oldStatus = STATUSES.find(s => s.id === task.status);
        try {
          await updateDocument('tasks', taskId, { status: status.id });
          await logFieldEdit('tasks', taskId, 'Status', oldStatus ? oldStatus.label : task.status, status.label);

          // Cross-reference activity logging
          if (task.contactId) {
            try {
              await addActivity('contacts', task.contactId, {
                type: 'note',
                description: `Task "${task.title}" moved to ${status.label}`
              });
            } catch (err) { console.error('Cross-ref contact activity failed:', err); }
          }
          if (task.dealId) {
            try {
              await addActivity('deals', task.dealId, {
                type: 'note',
                description: `Task "${task.title}" moved to ${status.label}`
              });
            } catch (err) { console.error('Cross-ref deal activity failed:', err); }
          }

          task.status = status.id;
          renderListView();
          showToast(`Moved to ${status.label}`, 'success');
        } catch (err) {
          console.error('Drag status change failed:', err);
          showToast('Failed to move task', 'error');
        }
      }
    });

    statusTasks.forEach(task => {
      const card = document.createElement('div');
      card.className = 'task-card' + (isOverdue(task) ? ' overdue' : '');
      card.draggable = true;
      card.dataset.taskId = task.id;

      const dueDateStr = formatDueDate(task);
      const contact = task.contactId ? contacts.find(c => c.id === task.contactId) : null;
      const contactName = task.contactName || (contact ? `${contact.firstName} ${contact.lastName}` : '');
      const dealName = task.dealName || '';
      const assigneeInitial = task.assignee ? task.assignee.charAt(0).toUpperCase() : '';

      card.innerHTML = `
        <div class="task-card-title">${escapeHtml(task.title)}</div>
        <div class="task-card-meta">
          ${task.priority ? `<span class="priority-dot ${task.priority}"></span>` : ''}
          ${dueDateStr ? `<span class="task-card-due${isOverdue(task) ? ' overdue' : ''}">${escapeHtml(dueDateStr)}</span>` : ''}
          ${assigneeInitial ? `<span class="task-card-assignee">${escapeHtml(assigneeInitial)}</span>` : ''}
          ${contactName ? `<span class="task-card-link">${escapeHtml(contactName)}</span>` : ''}
          ${dealName ? `<span class="task-card-link">${escapeHtml(dealName)}</span>` : ''}
        </div>
      `;

      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', task.id);
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      card.addEventListener('click', () => showDetailPage(task));

      body.appendChild(card);
    });

    col.appendChild(body);
    board.appendChild(col);
  });

  return board;
}

// ---------------------------------------------------------------------------
// Create Task Modal
// ---------------------------------------------------------------------------

function openCreateModal() {
  const form = document.createElement('form');
  form.className = 'modal-form';

  const currentUserEmail = auth.currentUser ? auth.currentUser.email : '';

  form.innerHTML = `
    <div class="modal-field">
      <label>Title *</label>
      <input type="text" name="title" required placeholder="Task title">
    </div>
    <div class="modal-field">
      <label>Description</label>
      <textarea name="description" rows="3" placeholder="Describe the task..."></textarea>
    </div>
    <div class="modal-form-grid">
      <div class="modal-field">
        <label>Priority</label>
        <select name="priority">
          <option value="high">High</option>
          <option value="medium" selected>Medium</option>
          <option value="low">Low</option>
        </select>
      </div>
      <div class="modal-field">
        <label>Due Date</label>
        <input type="date" name="dueDate">
      </div>
    </div>
    <div class="modal-field">
      <label>Assignee</label>
      <input type="text" name="assignee" placeholder="Assignee email" value="${escapeHtml(currentUserEmail)}">
    </div>
    <div class="modal-field">
      <label>Contact</label>
      <div id="contactSlot"></div>
    </div>
    <div class="modal-field">
      <label>Deal</label>
      <div id="dealSlot"></div>
    </div>
    <div class="modal-actions">
      <button type="submit" class="btn btn-primary btn-lg" style="width:100%;">Create Task</button>
      <span class="modal-cancel">Cancel</span>
    </div>
  `;

  let selectedContact = null;
  const contactDropdown = createDropdown({
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
        contactDropdown.setSelected(result);
      }
    },
    placeholder: 'Search contacts...'
  });
  form.querySelector('#contactSlot').appendChild(contactDropdown);

  let selectedDeal = null;
  const dealDropdown = createDropdown({
    fetchItems: async () => deals.map(d => ({
      id: d.id,
      label: d.name,
      sublabel: d.stage || ''
    })),
    onSelect: (item) => { selectedDeal = item; },
    placeholder: 'Search deals...'
  });
  form.querySelector('#dealSlot').appendChild(dealDropdown);

  modal.open('New Task', form);

  form.querySelector('.modal-cancel').addEventListener('click', () => modal.close());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);

    const data = {
      title: fd.get('title').trim(),
      description: fd.get('description').trim(),
      priority: fd.get('priority'),
      dueDate: fd.get('dueDate') || '',
      assignee: fd.get('assignee').trim(),
      status: 'todo',
      contactId: selectedContact ? selectedContact.id : '',
      contactName: selectedContact ? selectedContact.label : '',
      dealId: selectedDeal ? selectedDeal.id : '',
      dealName: selectedDeal ? selectedDeal.label : ''
    };

    try {
      await addDocument('tasks', data);

      // Cross-reference activity logging
      if (data.contactId) {
        try {
          await addActivity('contacts', data.contactId, {
            type: 'note',
            description: `Task created: ${data.title}`
          });
        } catch (err) { console.error('Cross-ref contact activity failed:', err); }
      }
      if (data.dealId) {
        try {
          await addActivity('deals', data.dealId, {
            type: 'note',
            description: `Task created: ${data.title}`
          });
        } catch (err) { console.error('Cross-ref deal activity failed:', err); }
      }

      showToast('Task created', 'success');
      modal.close();
      await loadData();
      renderListView();
    } catch (err) {
      console.error('Create task failed:', err);
      showToast('Failed to create task', 'error');
    }
  });
}

// ---------------------------------------------------------------------------
// Detail Page
// ---------------------------------------------------------------------------

async function showDetailPage(task) {
  currentPage = 'detail';
  const container = document.getElementById('view-tasks');
  container.innerHTML = '';

  // Back button
  const backBtn = document.createElement('button');
  backBtn.className = 'detail-back';
  backBtn.innerHTML = '&larr; Back to Tasks';
  backBtn.addEventListener('click', () => goBackToList());
  container.appendChild(backBtn);

  // Header
  const allowDelete = await canDelete(task);
  const header = document.createElement('div');
  header.className = 'detail-header';
  header.innerHTML = `
    <div style="flex:1;">
      <div class="detail-name">${escapeHtml(task.title)}</div>
      ${task.priority ? `<span class="priority-badge ${task.priority}">${task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}</span>` : ''}
    </div>
    ${allowDelete ? '<button class="btn btn-ghost detail-delete-btn" style="color:var(--danger);">Delete</button>' : ''}
  `;
  container.appendChild(header);

  // Delete handler
  const deleteBtn = header.querySelector('.detail-delete-btn');
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    if (!confirm(`Delete "${task.title}"? This cannot be undone.`)) return;
    try {
      await deleteDocument('tasks', task.id);
      showToast('Task deleted', 'success');
      await loadData();
      goBackToList();
    } catch (err) {
      console.error('Delete failed:', err);
      showToast('Failed to delete task', 'error');
    }
  });

  // Status pills
  const pillsContainer = document.createElement('div');
  pillsContainer.className = 'status-pills';
  renderStatusPills(pillsContainer, task, container);
  container.appendChild(pillsContainer);

  // Two-column layout
  const layout = document.createElement('div');
  layout.className = 'detail-layout';

  // Left column — Task Information
  const leftCol = document.createElement('div');
  const leftTitle = document.createElement('div');
  leftTitle.className = 'detail-section-title';
  leftTitle.textContent = 'Task Information';
  leftCol.appendChild(leftTitle);
  renderDetailFields(leftCol, task);

  // Right column — Activity
  const rightCol = document.createElement('div');
  const rightTitle = document.createElement('div');
  rightTitle.className = 'detail-section-title';
  rightTitle.textContent = 'Activity';
  rightCol.appendChild(rightTitle);
  renderActivitySection(rightCol, task);

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

function renderStatusPills(pillsContainer, task, pageContainer) {
  pillsContainer.innerHTML = '';

  STATUSES.forEach(status => {
    const pill = document.createElement('button');
    pill.className = 'status-pill' + (task.status === status.id ? ' active' : '');
    pill.textContent = status.label;

    pill.addEventListener('click', async () => {
      if (task.status === status.id) return;
      const oldStatus = STATUSES.find(s => s.id === task.status);
      try {
        await updateDocument('tasks', task.id, { status: status.id });
        await logFieldEdit('tasks', task.id, 'Status', oldStatus?.label || task.status, status.label);

        // Cross-reference activity logging
        if (task.contactId) {
          try {
            await addActivity('contacts', task.contactId, {
              type: 'note',
              description: `Task "${task.title}" moved to ${status.label}`
            });
          } catch (err) { console.error('Cross-ref contact activity failed:', err); }
        }
        if (task.dealId) {
          try {
            await addActivity('deals', task.dealId, {
              type: 'note',
              description: `Task "${task.title}" moved to ${status.label}`
            });
          } catch (err) { console.error('Cross-ref deal activity failed:', err); }
        }

        task.status = status.id;
        renderStatusPills(pillsContainer, task, pageContainer);
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

function renderDetailFields(container, task) {
  const textFields = [
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'priority', label: 'Priority', type: 'text' },
    { key: 'dueDate', label: 'Due Date', type: 'date' },
    { key: 'assignee', label: 'Assignee', type: 'text' }
  ];

  textFields.forEach(f => {
    const field = document.createElement('div');
    field.className = 'detail-field';
    field.innerHTML = `<div class="detail-field-label">${f.label}</div><div class="detail-field-value"></div>`;
    const valueEl = field.querySelector('.detail-field-value');

    makeEditable(valueEl, {
      field: f.key,
      type: f.type,
      value: task[f.key] || '',
      onSave: async (newValue, oldValue) => {
        await updateDocument('tasks', task.id, { [f.key]: newValue });
        await logFieldEdit('tasks', task.id, f.label, oldValue, newValue);
        task[f.key] = newValue;
        const idx = tasks.findIndex(t => t.id === task.id);
        if (idx !== -1) tasks[idx] = { ...tasks[idx], [f.key]: newValue };
      }
    });

    container.appendChild(field);
  });

  // Contact field (dropdown on click)
  const contactField = document.createElement('div');
  contactField.className = 'detail-field';
  contactField.innerHTML = `<div class="detail-field-label">Contact</div>`;

  const contactValue = document.createElement('div');
  contactValue.className = 'detail-field-value' + (task.contactName ? '' : ' empty');
  contactValue.textContent = task.contactName || 'Click to add...';
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
        const oldName = task.contactName || '';
        const updates = {
          contactId: item.id,
          contactName: item.label
        };
        try {
          await updateDocument('tasks', task.id, updates);
          await logFieldEdit('tasks', task.id, 'Contact', oldName, item.label);
          Object.assign(task, updates);
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
          const oldName = task.contactName || '';
          const updates = { contactId: result.id, contactName: result.label };
          await updateDocument('tasks', task.id, updates);
          await logFieldEdit('tasks', task.id, 'Contact', oldName, result.label);
          Object.assign(task, updates);
          contactValue.textContent = result.label;
          contactValue.classList.remove('empty');
          contactValue.classList.add('flash-success');
          setTimeout(() => contactValue.classList.remove('flash-success'), 600);
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

  // Deal field (dropdown on click)
  const dealField = document.createElement('div');
  dealField.className = 'detail-field';
  dealField.innerHTML = `<div class="detail-field-label">Deal</div>`;

  const dealValue = document.createElement('div');
  dealValue.className = 'detail-field-value' + (task.dealName ? '' : ' empty');
  dealValue.textContent = task.dealName || 'Click to add...';
  dealValue.style.cursor = 'pointer';

  dealValue.addEventListener('click', () => {
    dealValue.innerHTML = '';
    const dropdown = createDropdown({
      fetchItems: async () => deals.map(d => ({
        id: d.id,
        label: d.name,
        sublabel: d.stage || ''
      })),
      onSelect: async (item) => {
        const oldName = task.dealName || '';
        const updates = {
          dealId: item.id,
          dealName: item.label
        };
        try {
          await updateDocument('tasks', task.id, updates);
          await logFieldEdit('tasks', task.id, 'Deal', oldName, item.label);
          Object.assign(task, updates);
          dealValue.textContent = item.label;
          dealValue.classList.remove('empty');
          dealValue.classList.add('flash-success');
          setTimeout(() => dealValue.classList.remove('flash-success'), 600);
        } catch (err) {
          console.error('Deal update failed:', err);
          showToast('Failed to update deal', 'error');
        }
      },
      placeholder: 'Search deals...'
    });
    dealValue.appendChild(dropdown);
    const input = dealValue.querySelector('input');
    if (input) input.focus();
  });

  dealField.appendChild(dealValue);
  container.appendChild(dealField);
}

// ---------------------------------------------------------------------------
// Activity Section (composer + timeline)
// ---------------------------------------------------------------------------

function renderActivitySection(container, task) {
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
      await addActivity('tasks', task.id, { type: selectedType, description: desc });
      showToast('Activity logged', 'success');
      textarea.value = '';

      // Refresh timeline
      const timeline = container.querySelector('.detail-timeline');
      if (timeline) timeline.remove();
      await loadTimeline(container, task);
    } catch (err) {
      console.error('Failed to log activity:', err);
      showToast('Failed to log activity', 'error');
    }
  });

  container.appendChild(composer);

  // Timeline
  loadTimeline(container, task);
}

async function loadTimeline(container, task) {
  let activities = [];
  try {
    activities = await getActivity('tasks', task.id);
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
