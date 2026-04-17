import { listParts, createPart, updatePart, deletePart } from '../../services/inventory.js';
import { canWrite, gateWrite } from '../../tenant-context.js';

let parts = [];
let currentPage = 'list';

export function init() {}

export async function render() {
  try { parts = await listParts(); } catch (err) { console.error(err); parts = []; }
  if (currentPage === 'list') renderList();
}

export function destroy() { currentPage = 'list'; }

function renderList() {
  const container = document.getElementById('view-inventory');
  container.innerHTML = '';

  const topbar = document.createElement('div');
  topbar.className = 'view-topbar';
  topbar.innerHTML = `
    <input type="search" id="partsSearch" placeholder="Search parts by SKU or name..." style="flex:1;max-width:360px;padding:0.5rem 0.75rem;border:1px solid var(--border);border-radius:6px;">
    ${canWrite() ? `<button class="btn btn-primary" id="addPartBtn">+ New Part</button>` : ''}
  `;
  container.appendChild(topbar);

  const addBtn = topbar.querySelector('#addPartBtn');
  if (addBtn) addBtn.addEventListener('click', gateWrite(() => openForm(null)));

  const searchInput = topbar.querySelector('#partsSearch');
  searchInput.addEventListener('input', () => renderTable(searchInput.value.trim().toLowerCase()));

  const wrapper = document.createElement('div');
  wrapper.className = 'view-content';
  wrapper.id = 'inventoryContent';
  container.appendChild(wrapper);

  renderTable('');
}

function renderTable(filter) {
  const wrapper = document.getElementById('inventoryContent');
  const visible = filter
    ? parts.filter(p => (p.sku || '').toLowerCase().includes(filter) || (p.name || '').toLowerCase().includes(filter))
    : parts;

  if (visible.length === 0) {
    wrapper.innerHTML = parts.length === 0
      ? '<div class="empty-state"><div class="empty-title">No parts yet</div><p class="empty-description">Add your first part to start tracking inventory.</p></div>'
      : '<div class="empty-state"><p class="empty-description">No parts match your search.</p></div>';
    return;
  }

  wrapper.innerHTML = '';
  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = `
    <thead><tr>
      <th>SKU</th><th>Name</th><th>Category</th>
      <th style="text-align:right;">Qty</th>
      <th style="text-align:right;">Reorder</th>
      <th style="text-align:right;">Cost</th>
      <th style="text-align:right;">Price</th>
      <th></th>
    </tr></thead>
  `;
  const tbody = document.createElement('tbody');
  visible.forEach(p => {
    const low = (p.quantity || 0) <= (p.reorderLevel || 0);
    const qtyCell = low
      ? `<span class="badge badge-danger">${p.quantity || 0}</span>`
      : String(p.quantity || 0);
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    tr.innerHTML = `
      <td style="font-family:monospace;">${escapeHtml(p.sku || '-')}</td>
      <td style="font-weight:500;">${escapeHtml(p.name || '-')}</td>
      <td>${escapeHtml(p.category || '-')}</td>
      <td style="text-align:right;">${qtyCell}</td>
      <td style="text-align:right;">${p.reorderLevel || 0}</td>
      <td style="text-align:right;">${formatCurrency(p.unitCost)}</td>
      <td style="text-align:right;">${formatCurrency(p.unitPrice)}</td>
      <td style="text-align:right;">${canWrite() ? `<button class="btn btn-ghost btn-sm edit-part" data-id="${p.id}">Edit</button>` : ''}</td>
    `;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrapper.appendChild(table);

  wrapper.querySelectorAll('.edit-part').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const p = parts.find(x => x.id === id);
      if (p) openForm(p);
    });
  });
}

function openForm(existing) {
  currentPage = 'form';
  const container = document.getElementById('view-inventory');
  container.innerHTML = '';

  const backBtn = document.createElement('button');
  backBtn.className = 'detail-back';
  backBtn.innerHTML = '&larr; Back';
  backBtn.addEventListener('click', () => { currentPage = 'list'; renderList(); });
  container.appendChild(backBtn);

  const form = document.createElement('form');
  form.className = 'modal-form';
  form.style.maxWidth = '700px';
  form.innerHTML = `
    <h2 style="margin-bottom:1rem;">${existing ? 'Edit Part' : 'New Part'}</h2>
    <div class="modal-form-grid">
      <div class="modal-field"><label>SKU *</label><input type="text" name="sku" required value="${escapeHtml(existing?.sku || '')}"></div>
      <div class="modal-field"><label>Name *</label><input type="text" name="name" required value="${escapeHtml(existing?.name || '')}"></div>
    </div>
    <div class="modal-form-grid">
      <div class="modal-field"><label>Category</label><input type="text" name="category" value="${escapeHtml(existing?.category || '')}"></div>
      <div class="modal-field"><label>Supplier</label><input type="text" name="supplier" value="${escapeHtml(existing?.supplier || '')}"></div>
    </div>
    <div class="modal-form-grid">
      <div class="modal-field"><label>Quantity</label><input type="number" name="quantity" min="0" step="1" value="${existing?.quantity ?? 0}"></div>
      <div class="modal-field"><label>Reorder Level</label><input type="number" name="reorderLevel" min="0" step="1" value="${existing?.reorderLevel ?? 0}"></div>
    </div>
    <div class="modal-form-grid">
      <div class="modal-field"><label>Unit Cost</label><input type="number" name="unitCost" min="0" step="0.01" value="${existing?.unitCost ?? 0}"></div>
      <div class="modal-field"><label>Unit Price</label><input type="number" name="unitPrice" min="0" step="0.01" value="${existing?.unitPrice ?? 0}"></div>
    </div>
    <div class="modal-field"><label>Notes</label><textarea name="notes" rows="2">${escapeHtml(existing?.notes || '')}</textarea></div>
    <div style="display:flex;gap:0.5rem;margin-top:1rem;">
      <button type="submit" class="btn btn-primary">${existing ? 'Save Changes' : 'Create Part'}</button>
      <button type="button" class="btn btn-ghost" id="cancelForm">Cancel</button>
      ${existing ? `<button type="button" class="btn btn-ghost" id="deletePartBtn" style="margin-left:auto;color:var(--danger);">Delete</button>` : ''}
    </div>
  `;
  form.querySelector('#cancelForm').addEventListener('click', () => { currentPage = 'list'; renderList(); });

  const delBtn = form.querySelector('#deletePartBtn');
  if (delBtn) {
    delBtn.addEventListener('click', async () => {
      if (!confirm(`Delete ${existing.name}? This cannot be undone.`)) return;
      try { await deletePart(existing.id); currentPage = 'list'; await render(); }
      catch (err) { alert('Delete failed: ' + err.message); }
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const data = {
      sku: fd.get('sku'),
      name: fd.get('name'),
      category: fd.get('category'),
      supplier: fd.get('supplier'),
      quantity: fd.get('quantity'),
      reorderLevel: fd.get('reorderLevel'),
      unitCost: fd.get('unitCost'),
      unitPrice: fd.get('unitPrice'),
      notes: fd.get('notes')
    };
    try {
      if (existing) await updatePart(existing.id, data);
      else await createPart(data);
      currentPage = 'list';
      await render();
    } catch (err) {
      console.error('Save part failed:', err);
      alert('Failed to save part: ' + err.message);
    }
  });

  container.appendChild(form);
}

function escapeHtml(str) {
  if (str == null) return '';
  const node = document.createElement('span');
  node.appendChild(document.createTextNode(String(str)));
  return node.innerHTML;
}

function formatCurrency(amount) {
  if (amount == null || isNaN(amount)) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}
