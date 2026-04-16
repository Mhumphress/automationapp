import { addDocument, updateDocument, deleteDocument, queryDocuments } from '../../services/firestore.js';
import { canWrite, gateWrite } from '../../tenant-context.js';

let tasks = [];
let currentPage = 'list';

const STATUSES = ['todo', 'in_progress', 'done'];
const STATUS_LABELS = { todo: 'To Do', in_progress: 'In Progress', done: 'Done' };

export function init() {}

export async function render() {
  try { tasks = await queryDocuments('tasks', 'createdAt', 'desc'); } catch (err) { console.error(err); tasks = []; }
  if (currentPage === 'list') renderKanban();
}

export function destroy() { currentPage = 'list'; }

function renderKanban() {
  const container = document.getElementById('view-tasks');
  container.innerHTML = '';

  const topbar = document.createElement('div');
  topbar.className = 'view-topbar';
  topbar.innerHTML = `
    ${canWrite() ? `<button class="btn btn-primary" id="addTaskBtn">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Add Task
    </button>` : ''}
  `;
  container.appendChild(topbar);

  const addBtn = topbar.querySelector('#addTaskBtn');
  if (addBtn) addBtn.addEventListener('click', gateWrite(() => openCreateForm()));

  if (tasks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'view-content';
    empty.innerHTML = '<div class="empty-state"><div class="empty-title">No tasks yet</div><p class="empty-description">Create your first task to start tracking work.</p></div>';
    container.appendChild(empty);
    return;
  }

  const board = document.createElement('div');
  board.className = 'kanban-board';

  STATUSES.forEach(status => {
    const col = document.createElement('div');
    col.className = 'kanban-column';

    const header = document.createElement('div');
    header.className = 'kanban-column-header';
    const count = tasks.filter(t => (t.status || 'todo') === status).length;
    header.innerHTML = `<span>${escapeHtml(STATUS_LABELS[status])}</span><span class="kanban-count">${count}</span>`;
    col.appendChild(header);

    const cards = document.createElement('div');
    cards.className = 'kanban-cards';

    tasks.filter(t => (t.status || 'todo') === status).forEach(task => {
      const card = document.createElement('div');
      card.className = 'kanban-card';
      card.innerHTML = `
        <div style="font-weight:500;margin-bottom:0.25rem;">${escapeHtml(task.title || 'Untitled')}</div>
        ${task.description ? `<div style="font-size:0.8rem;color:var(--gray);margin-bottom:0.5rem;">${escapeHtml(task.description).slice(0, 80)}</div>` : ''}
        ${task.priority ? `<span class="badge badge-${task.priority === 'high' ? 'danger' : task.priority === 'medium' ? 'warning' : 'default'}">${escapeHtml(task.priority)}</span>` : ''}
      `;

      if (canWrite()) {
        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:0.25rem;margin-top:0.5rem;';

        if (status !== 'done') {
          const nextStatus = status === 'todo' ? 'in_progress' : 'done';
          const moveBtn = document.createElement('button');
          moveBtn.className = 'btn btn-ghost btn-sm';
          moveBtn.textContent = status === 'todo' ? 'Start' : 'Complete';
          moveBtn.addEventListener('click', gateWrite(async (e) => {
            e.stopPropagation();
            try {
              await updateDocument('tasks', task.id, { status: nextStatus });
              await render();
            } catch (err) { console.error('Task update failed:', err); }
          }));
          actions.appendChild(moveBtn);
        }

        const delBtn = document.createElement('button');
        delBtn.className = 'btn btn-ghost btn-sm';
        delBtn.style.color = 'var(--danger)';
        delBtn.textContent = 'Delete';
        delBtn.addEventListener('click', gateWrite(async (e) => {
          e.stopPropagation();
          if (confirm('Delete this task?')) {
            try {
              await deleteDocument('tasks', task.id);
              await render();
            } catch (err) { console.error('Task delete failed:', err); }
          }
        }));
        actions.appendChild(delBtn);

        card.appendChild(actions);
      }

      cards.appendChild(card);
    });

    col.appendChild(cards);
    board.appendChild(col);
  });

  container.appendChild(board);
}

function openCreateForm() {
  currentPage = 'create';
  const container = document.getElementById('view-tasks');
  container.innerHTML = '';

  const backBtn = document.createElement('button');
  backBtn.className = 'detail-back';
  backBtn.innerHTML = '&larr; Back';
  backBtn.addEventListener('click', () => { currentPage = 'list'; renderKanban(); });
  container.appendChild(backBtn);

  const form = document.createElement('form');
  form.className = 'modal-form';
  form.style.maxWidth = '600px';
  form.innerHTML = `
    <h2 style="margin-bottom:1rem;">New Task</h2>
    <div class="modal-field"><label>Title *</label><input type="text" name="title" required></div>
    <div class="modal-field"><label>Description</label><textarea name="description" rows="3"></textarea></div>
    <div class="modal-form-grid">
      <div class="modal-field">
        <label>Priority</label>
        <select name="priority"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option></select>
      </div>
      <div class="modal-field"><label>Due Date</label><input type="date" name="dueDate"></div>
    </div>
    <div style="display:flex;gap:0.5rem;margin-top:1rem;">
      <button type="submit" class="btn btn-primary">Create</button>
      <button type="button" class="btn btn-ghost" id="cancelCreate">Cancel</button>
    </div>
  `;

  form.querySelector('#cancelCreate').addEventListener('click', () => { currentPage = 'list'; renderKanban(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    try {
      await addDocument('tasks', {
        title: fd.get('title').trim(),
        description: fd.get('description').trim(),
        priority: fd.get('priority'),
        dueDate: fd.get('dueDate') || null,
        status: 'todo'
      });
      currentPage = 'list';
      await render();
    } catch (err) {
      console.error('Create task failed:', err);
      alert('Failed to create task: ' + err.message);
    }
  });

  container.appendChild(form);
}

function escapeHtml(str) {
  if (!str) return '';
  const node = document.createElement('span');
  node.appendChild(document.createTextNode(str));
  return node.innerHTML;
}
