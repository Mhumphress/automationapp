# Repair Vertical Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first shippable vertical (Repair, Basic + Pro tiers) on top of the existing multi-tenant portal — three new modules (Tickets, Parts Inventory, Check-in) plus supporting data and invoice generation.

**Architecture:** Vanilla JS ES modules following the established pattern in `portal/js/views/shared/invoicing.js`. Tenant-scoped Firestore collections at `tenants/{tenantId}/tickets`, `tenants/{tenantId}/inventory`, `tenants/{tenantId}/counters/tickets`. Atomic multi-doc writes (ticket number minting, part-to-ticket adds with inventory decrements) use Firestore `runTransaction`.

**Tech Stack:** Firebase Firestore (10.12.0 via CDN), vanilla ES modules, Cloudflare Pages static hosting.

**Spec:** `docs/superpowers/specs/2026-04-16-repair-vertical-design.md`

**Pattern reference:** Always compare new code against `portal/js/views/shared/invoicing.js` — same module shape (`init`, `render`, `destroy` exports; list → create → detail page flow inside one container), same `canWrite()` / `gateWrite()` gating, same inline `escapeHtml` / `formatCurrency` / `formatDate` helpers duplicated per file (do not try to centralize — matches existing convention).

**Testing model:** No automated test framework exists in this codebase. Verification is manual browser testing against a provisioned tenant. Each task ends with a specific manual check and a commit.

---

### Task 1: Tickets Data Service

**Files:**
- Create: `portal/js/services/tickets.js`

Provides all ticket CRUD plus the two transactional helpers: minting ticket numbers and adding a part from inventory (which decrements stock atomically).

- [ ] **Step 1: Create `portal/js/services/tickets.js`**

```javascript
import { db, auth } from '../config.js';
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, setDoc,
  query, orderBy, where, serverTimestamp, runTransaction, arrayUnion, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getTenantId } from '../tenant-context.js';

const HISTORY_CAP = 50;

function tenantDoc(path) {
  const tid = getTenantId();
  if (!tid) throw new Error('No tenant context');
  return doc(db, `tenants/${tid}/${path}`);
}

function tenantCollection(path) {
  const tid = getTenantId();
  if (!tid) throw new Error('No tenant context');
  return collection(db, `tenants/${tid}/${path}`);
}

// ── Queries ─────────────────────────────

export async function listTickets() {
  const q = query(tenantCollection('tickets'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getTicket(ticketId) {
  const snap = await getDoc(tenantDoc(`tickets/${ticketId}`));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

// ── Create with atomic number minting ──

export async function createTicket(data) {
  const tid = getTenantId();
  if (!tid) throw new Error('No tenant context');
  const user = auth.currentUser;
  const counterRef = doc(db, `tenants/${tid}/counters/tickets`);
  const ticketsCol = collection(db, `tenants/${tid}/tickets`);

  return runTransaction(db, async (tx) => {
    const counterSnap = await tx.get(counterRef);
    const last = counterSnap.exists() ? (counterSnap.data().lastNumber || 0) : 0;
    const next = last + 1;
    const ticketNumber = `T-${String(next).padStart(3, '0')}`;

    // Use addDoc-equivalent: make a new doc ref manually
    const newRef = doc(ticketsCol);

    const now = serverTimestamp();
    const history = [{
      type: 'status_change',
      description: `Ticket created with status ${data.status || 'checked_in'}`,
      at: Timestamp.now(),
      byUid: user ? user.uid : null,
      byEmail: user ? user.email : null
    }];

    tx.set(newRef, {
      ticketNumber,
      contactId: data.contactId || null,
      customerName: data.customerName || '',
      deviceType: data.deviceType || '',
      serial: data.serial || '',
      issue: data.issue || '',
      condition: data.condition || '',
      status: data.status || 'checked_in',
      estimatedCompletion: data.estimatedCompletion || null,
      assignedTechId: data.assignedTechId || null,
      partsUsed: [],
      partsNotes: data.partsNotes || '',
      laborMinutes: 0,
      notes: data.notes || '',
      history,
      invoiceId: null,
      completedAt: null,
      createdAt: now,
      createdBy: user ? user.uid : null,
      updatedAt: now,
      updatedBy: user ? user.uid : null
    });

    tx.set(counterRef, { lastNumber: next }, { merge: true });

    return { id: newRef.id, ticketNumber };
  });
}

// ── Update basic fields (no inventory-touching changes) ──

export async function updateTicket(ticketId, patch) {
  const user = auth.currentUser;
  const ref = tenantDoc(`tickets/${ticketId}`);

  // If status is changing to 'completed', set completedAt
  const updates = {
    ...patch,
    updatedAt: serverTimestamp(),
    updatedBy: user ? user.uid : null
  };
  if (patch.status === 'completed') {
    updates.completedAt = serverTimestamp();
  }
  return updateDoc(ref, updates);
}

// ── Append history (capped at 50 entries) ──

export async function appendTicketHistory(ticketId, entry) {
  const user = auth.currentUser;
  const ref = tenantDoc(`tickets/${ticketId}`);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Ticket not found');
  const existing = snap.data().history || [];
  const next = [
    {
      ...entry,
      at: Timestamp.now(),
      byUid: user ? user.uid : null,
      byEmail: user ? user.email : null
    },
    ...existing
  ].slice(0, HISTORY_CAP);
  return updateDoc(ref, {
    history: next,
    updatedAt: serverTimestamp(),
    updatedBy: user ? user.uid : null
  });
}

// ── Add part to ticket (transactional with inventory) ──

export async function addPartToTicket(ticketId, partId, qty) {
  const tid = getTenantId();
  if (!tid) throw new Error('No tenant context');
  const user = auth.currentUser;
  const ticketRef = doc(db, `tenants/${tid}/tickets/${ticketId}`);
  const partRef = doc(db, `tenants/${tid}/inventory/${partId}`);

  return runTransaction(db, async (tx) => {
    const [ticketSnap, partSnap] = await Promise.all([tx.get(ticketRef), tx.get(partRef)]);
    if (!ticketSnap.exists()) throw new Error('Ticket not found');
    if (!partSnap.exists()) throw new Error('Part not found');

    const ticket = ticketSnap.data();
    const part = partSnap.data();

    if ((part.quantity || 0) < qty) {
      throw new Error(`Not enough stock: ${part.name} has ${part.quantity || 0} available`);
    }

    const partsUsed = Array.isArray(ticket.partsUsed) ? [...ticket.partsUsed] : [];
    partsUsed.push({
      partId,
      sku: part.sku || '',
      name: part.name || '',
      qty,
      unitCost: part.unitCost || 0,
      unitPrice: part.unitPrice || 0
    });

    const historyEntry = {
      type: 'part_added',
      description: `Added ${qty}× ${part.name || part.sku}`,
      at: Timestamp.now(),
      byUid: user ? user.uid : null,
      byEmail: user ? user.email : null
    };
    const history = [historyEntry, ...(ticket.history || [])].slice(0, HISTORY_CAP);

    tx.update(ticketRef, {
      partsUsed,
      history,
      updatedAt: serverTimestamp(),
      updatedBy: user ? user.uid : null
    });
    tx.update(partRef, {
      quantity: (part.quantity || 0) - qty,
      updatedAt: serverTimestamp(),
      updatedBy: user ? user.uid : null
    });
  });
}

// ── Remove part from ticket (transactional — returns stock) ──

export async function removePartFromTicket(ticketId, partIndex) {
  const tid = getTenantId();
  if (!tid) throw new Error('No tenant context');
  const user = auth.currentUser;
  const ticketRef = doc(db, `tenants/${tid}/tickets/${ticketId}`);

  return runTransaction(db, async (tx) => {
    const ticketSnap = await tx.get(ticketRef);
    if (!ticketSnap.exists()) throw new Error('Ticket not found');
    const ticket = ticketSnap.data();
    const partsUsed = Array.isArray(ticket.partsUsed) ? [...ticket.partsUsed] : [];
    if (partIndex < 0 || partIndex >= partsUsed.length) throw new Error('Invalid part index');

    const removed = partsUsed.splice(partIndex, 1)[0];
    const partRef = removed.partId ? doc(db, `tenants/${tid}/inventory/${removed.partId}`) : null;

    let historyEntry = {
      type: 'part_removed',
      description: `Removed ${removed.qty}× ${removed.name || removed.sku}`,
      at: Timestamp.now(),
      byUid: user ? user.uid : null,
      byEmail: user ? user.email : null
    };
    const history = [historyEntry, ...(ticket.history || [])].slice(0, HISTORY_CAP);

    tx.update(ticketRef, {
      partsUsed,
      history,
      updatedAt: serverTimestamp(),
      updatedBy: user ? user.uid : null
    });

    // Return stock if the part still exists in inventory
    if (partRef) {
      const partSnap = await tx.get(partRef);
      if (partSnap.exists()) {
        tx.update(partRef, {
          quantity: (partSnap.data().quantity || 0) + removed.qty,
          updatedAt: serverTimestamp(),
          updatedBy: user ? user.uid : null
        });
      }
    }
  });
}

// ── Generate invoice from a completed ticket ──
// Creates the invoice at tenants/{t}/invoices_crm, links ticket.invoiceId, logs activity.
// For Basic tier (no partsUsed), caller passes basicPartsTotal and basicPartsLabel.

export async function generateInvoiceFromTicket(ticketId, opts = {}) {
  const tid = getTenantId();
  if (!tid) throw new Error('No tenant context');
  const user = auth.currentUser;

  const ticket = await getTicket(ticketId);
  if (!ticket) throw new Error('Ticket not found');
  if (ticket.invoiceId) throw new Error('Ticket already has an invoice');
  if (ticket.status !== 'completed') throw new Error('Ticket must be completed to generate an invoice');

  // Fetch tenant labor rate
  const settingsSnap = await getDoc(doc(db, `tenants/${tid}/settings/general`));
  const laborRate = settingsSnap.exists() ? (settingsSnap.data().laborRate || 0) : 0;

  const lineItems = [];
  let subtotal = 0;

  const hasInventoryParts = Array.isArray(ticket.partsUsed) && ticket.partsUsed.length > 0;
  if (hasInventoryParts) {
    ticket.partsUsed.forEach(p => {
      const amount = (p.qty || 0) * (p.unitPrice || 0);
      lineItems.push({
        description: p.name || p.sku || 'Part',
        quantity: p.qty || 0,
        rate: p.unitPrice || 0,
        amount
      });
      subtotal += amount;
    });
  } else if (opts.basicPartsTotal && opts.basicPartsTotal > 0) {
    const amount = opts.basicPartsTotal;
    lineItems.push({
      description: opts.basicPartsLabel || 'Parts',
      quantity: 1,
      rate: amount,
      amount
    });
    subtotal += amount;
  }

  // Labor line (if any labor logged)
  if ((ticket.laborMinutes || 0) > 0) {
    const hours = Math.round(((ticket.laborMinutes || 0) / 60) * 4) / 4; // round to 0.25
    const labor = hours * laborRate;
    lineItems.push({
      description: 'Labor',
      quantity: hours,
      rate: laborRate,
      amount: labor
    });
    subtotal += labor;
  }

  const invoiceNumber = `INV-${ticket.ticketNumber}`;
  const invoiceData = {
    invoiceNumber,
    clientName: ticket.customerName || '',
    contactId: ticket.contactId || null,
    ticketId: ticket.id,
    ticketNumber: ticket.ticketNumber,
    issueDate: new Date().toISOString().split('T')[0],
    dueDate: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
    lineItems,
    subtotal,
    taxRate: 0,
    taxAmount: 0,
    total: subtotal,
    status: 'draft',
    notes: `Auto-generated from ticket ${ticket.ticketNumber}`,
    createdAt: serverTimestamp(),
    createdBy: user ? user.uid : null,
    updatedAt: serverTimestamp(),
    updatedBy: user ? user.uid : null
  };

  const invoiceRef = await addDoc(collection(db, `tenants/${tid}/invoices_crm`), invoiceData);

  // Link ticket → invoice + history + tenant activity
  await updateDoc(tenantDoc(`tickets/${ticketId}`), {
    invoiceId: invoiceRef.id,
    history: [
      {
        type: 'invoice_generated',
        description: `Invoice ${invoiceNumber} generated (${lineItems.length} line items)`,
        at: Timestamp.now(),
        byUid: user ? user.uid : null,
        byEmail: user ? user.email : null
      },
      ...(ticket.history || [])
    ].slice(0, HISTORY_CAP),
    updatedAt: serverTimestamp(),
    updatedBy: user ? user.uid : null
  });

  await addDoc(collection(db, `tenants/${tid}/activity`), {
    type: 'ticket_completed',
    description: `Ticket ${ticket.ticketNumber} completed and invoice ${invoiceNumber} generated`,
    metadata: { ticketId: ticket.id, invoiceId: invoiceRef.id },
    createdAt: serverTimestamp(),
    createdBy: user ? user.uid : null,
    createdByEmail: user ? user.email : null
  });

  return { invoiceId: invoiceRef.id, invoiceNumber };
}

export { Timestamp };
```

- [ ] **Step 2: Manual check — no syntax errors**

Load `portal/js/services/tickets.js` in a browser (open `portal/app.html` after logging in) and check the console for import errors. No output yet; just confirm nothing breaks on import.

- [ ] **Step 3: Commit**

```bash
git add portal/js/services/tickets.js
git commit -m "feat(portal): add tickets data service with transactional helpers"
```

---

### Task 2: Inventory Data Service

**Files:**
- Create: `portal/js/services/inventory.js`

- [ ] **Step 1: Create `portal/js/services/inventory.js`**

```javascript
import { db, auth } from '../config.js';
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getTenantId } from '../tenant-context.js';

function tenantCollection(path) {
  const tid = getTenantId();
  if (!tid) throw new Error('No tenant context');
  return collection(db, `tenants/${tid}/${path}`);
}

function tenantDoc(path) {
  const tid = getTenantId();
  if (!tid) throw new Error('No tenant context');
  return doc(db, `tenants/${tid}/${path}`);
}

export async function listParts() {
  const q = query(tenantCollection('inventory'), orderBy('name', 'asc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getPart(partId) {
  const snap = await getDoc(tenantDoc(`inventory/${partId}`));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function createPart(data) {
  const user = auth.currentUser;
  return addDoc(tenantCollection('inventory'), {
    sku: (data.sku || '').trim(),
    name: (data.name || '').trim(),
    category: (data.category || '').trim(),
    quantity: Number(data.quantity) || 0,
    reorderLevel: Number(data.reorderLevel) || 0,
    unitCost: Number(data.unitCost) || 0,
    unitPrice: Number(data.unitPrice) || 0,
    supplier: (data.supplier || '').trim(),
    notes: (data.notes || '').trim(),
    createdAt: serverTimestamp(),
    createdBy: user ? user.uid : null,
    updatedAt: serverTimestamp(),
    updatedBy: user ? user.uid : null
  });
}

export async function updatePart(partId, patch) {
  const user = auth.currentUser;
  const numericFields = ['quantity', 'reorderLevel', 'unitCost', 'unitPrice'];
  const clean = { ...patch };
  numericFields.forEach(k => { if (k in clean) clean[k] = Number(clean[k]) || 0; });
  return updateDoc(tenantDoc(`inventory/${partId}`), {
    ...clean,
    updatedAt: serverTimestamp(),
    updatedBy: user ? user.uid : null
  });
}

export async function deletePart(partId) {
  return deleteDoc(tenantDoc(`inventory/${partId}`));
}
```

- [ ] **Step 2: Commit**

```bash
git add portal/js/services/inventory.js
git commit -m "feat(portal): add inventory data service for parts CRUD"
```

---

### Task 3: Parts Inventory View

**Files:**
- Create: `portal/js/views/repair/inventory.js`
- Modify: `portal/js/main.js` (replace placeholder registration)

The list view with inline-edit on qty/prices, low-stock red badge, and a create/edit modal.

- [ ] **Step 1: Create `portal/js/views/repair/inventory.js`**

Follow the exact structural pattern of `portal/js/views/shared/invoicing.js`: `init`/`render`/`destroy` exports, page-state variable, list → create form flow in one container.

```javascript
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
```

- [ ] **Step 2: Register the view in `portal/js/main.js`**

Find the block in `main.js` that registers placeholder views (around line 316–348, starts with `const placeholderViews = [`). Remove `'inventory'` from that array. Above that block, add a dynamic import and `registerView` call, matching the shared-module pattern:

```javascript
  const inventoryMod = await import('./views/repair/inventory.js');
  registerView('inventory', {
    init: inventoryMod.init,
    render() { document.getElementById('headerTitle').textContent = 'Parts Inventory'; inventoryMod.render(); },
    destroy: inventoryMod.destroy
  });
```

Place this right after the `invoicingMod` registration (currently around line 309). The placeholder div creation in the loop still runs for views that remain in the array; removing `'inventory'` from the array prevents it from being registered as a placeholder.

- [ ] **Step 3: Manual check**

Deploy locally or to Cloudflare Pages. Log in as a `repair_pro` tenant. Click the "Parts Inventory" sidebar link. You should see the empty state "No parts yet". Click "+ New Part", fill in SKU "SCR-IP14", name "iPhone 14 screen", qty 5, reorder 2, cost 40, price 120. Save. Verify the row shows in the table. Click Edit, change qty to 1, save. Verify the qty cell shows a red badge (low stock because 1 ≤ 2). Search for "screen" — verify filter works.

- [ ] **Step 4: Commit**

```bash
git add portal/js/views/repair/inventory.js portal/js/main.js
git commit -m "feat(portal): add Parts Inventory view for Repair vertical"
```

---

### Task 4: Tickets List View (skeleton + list)

**Files:**
- Create: `portal/js/views/repair/tickets.js`
- Modify: `portal/js/main.js` (replace placeholder)

This task builds only the list view (not the detail drawer). Detail comes in Task 5 so each commit ships something testable.

- [ ] **Step 1: Create `portal/js/views/repair/tickets.js` with list only**

```javascript
import { listTickets, getTicket, createTicket, updateTicket, appendTicketHistory,
  addPartToTicket, removePartFromTicket, generateInvoiceFromTicket } from '../../services/tickets.js';
import { listParts } from '../../services/inventory.js';
import { canWrite, gateWrite, hasFeature } from '../../tenant-context.js';

const STATUS_LABELS = {
  checked_in: 'Checked In',
  diagnosed: 'Diagnosed',
  awaiting_parts: 'Awaiting Parts',
  in_repair: 'In Repair',
  qc: 'Quality Check',
  ready: 'Ready for Pickup',
  completed: 'Completed'
};

const STATUS_ORDER = ['checked_in', 'diagnosed', 'awaiting_parts', 'in_repair', 'qc', 'ready', 'completed'];

let tickets = [];
let activeStatusFilter = 'all';
let activeSearch = '';
let currentPage = 'list';

export function init() {}

export async function render() {
  try { tickets = await listTickets(); } catch (err) { console.error(err); tickets = []; }
  if (currentPage === 'list') renderList();
}

export function destroy() { currentPage = 'list'; }

function statusBadgeClass(status) {
  if (status === 'completed') return 'badge-success';
  if (status === 'ready') return 'badge-info';
  if (status === 'awaiting_parts') return 'badge-warning';
  return 'badge-default';
}

function renderList() {
  const container = document.getElementById('view-tickets');
  container.innerHTML = '';

  const topbar = document.createElement('div');
  topbar.className = 'view-topbar';
  topbar.innerHTML = `
    <input type="search" id="ticketsSearch" placeholder="Search by ticket #, customer, device..." style="flex:1;max-width:360px;padding:0.5rem 0.75rem;border:1px solid var(--border);border-radius:6px;">
    ${canWrite() && hasFeature('checkin') ? `<a class="btn btn-primary" href="#checkin">+ Check In</a>` : ''}
  `;
  container.appendChild(topbar);

  const tabs = document.createElement('div');
  tabs.className = 'status-tabs';
  tabs.style.cssText = 'display:flex;gap:0.25rem;margin-bottom:1rem;flex-wrap:wrap;';
  ['all', ...STATUS_ORDER].forEach(status => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost btn-sm' + (activeStatusFilter === status ? ' active' : '');
    btn.style.cssText = activeStatusFilter === status ? 'background:var(--accent);color:white;' : '';
    btn.textContent = status === 'all' ? 'All' : STATUS_LABELS[status];
    btn.addEventListener('click', () => { activeStatusFilter = status; renderList(); });
    tabs.appendChild(btn);
  });
  container.appendChild(tabs);

  const wrapper = document.createElement('div');
  wrapper.className = 'view-content';
  wrapper.id = 'ticketsContent';
  container.appendChild(wrapper);

  const searchInput = topbar.querySelector('#ticketsSearch');
  searchInput.value = activeSearch;
  searchInput.addEventListener('input', () => { activeSearch = searchInput.value.trim().toLowerCase(); renderTable(); });

  renderTable();
}

function renderTable() {
  const wrapper = document.getElementById('ticketsContent');
  if (!wrapper) return;

  let visible = tickets;
  if (activeStatusFilter !== 'all') visible = visible.filter(t => t.status === activeStatusFilter);
  if (activeSearch) {
    visible = visible.filter(t =>
      (t.ticketNumber || '').toLowerCase().includes(activeSearch) ||
      (t.customerName || '').toLowerCase().includes(activeSearch) ||
      (t.deviceType || '').toLowerCase().includes(activeSearch)
    );
  }

  if (visible.length === 0) {
    wrapper.innerHTML = tickets.length === 0
      ? '<div class="empty-state"><div class="empty-title">No tickets yet</div><p class="empty-description">Start by checking in a customer.</p>'
        + (hasFeature('checkin') ? '<a class="btn btn-primary" href="#checkin" style="margin-top:1rem;">Check In a Customer</a>' : '')
        + '</div>'
      : '<div class="empty-state"><p class="empty-description">No tickets match your filters.</p></div>';
    return;
  }

  wrapper.innerHTML = '';
  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = `
    <thead><tr>
      <th>Ticket #</th><th>Customer</th><th>Device</th>
      <th>Status</th><th>Age</th><th>Created</th>
    </tr></thead>
  `;
  const tbody = document.createElement('tbody');
  visible.forEach(t => {
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    const ageDays = t.createdAt && t.createdAt.toDate
      ? Math.floor((Date.now() - t.createdAt.toDate().getTime()) / 86400000)
      : '-';
    tr.innerHTML = `
      <td style="font-family:monospace;font-weight:500;">${escapeHtml(t.ticketNumber || '-')}</td>
      <td>${escapeHtml(t.customerName || '-')}</td>
      <td>${escapeHtml(t.deviceType || '-')}</td>
      <td><span class="badge ${statusBadgeClass(t.status)}">${escapeHtml(STATUS_LABELS[t.status] || t.status || '-')}</span></td>
      <td>${ageDays === '-' ? '-' : ageDays + 'd'}</td>
      <td>${formatDate(t.createdAt)}</td>
    `;
    tr.addEventListener('click', () => showDetail(t.id));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrapper.appendChild(table);
}

// showDetail is implemented in Task 5
function showDetail(ticketId) {
  console.log('showDetail stub — ticket', ticketId);
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

function formatDate(timestamp) {
  if (!timestamp) return '\u2014';
  try {
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    if (isNaN(date.getTime())) return '\u2014';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return '\u2014'; }
}
```

- [ ] **Step 2: Register in `portal/js/main.js`**

Same pattern as Task 3. Remove `'tickets'` from the `placeholderViews` array. Add above the placeholder loop:

```javascript
  const ticketsMod = await import('./views/repair/tickets.js');
  registerView('tickets', {
    init: ticketsMod.init,
    render() { document.getElementById('headerTitle').textContent = 'Repair Tickets'; ticketsMod.render(); },
    destroy: ticketsMod.destroy
  });
```

- [ ] **Step 3: Seed one ticket manually for verification**

Open the Firebase Console → Firestore → find your test tenant's `tickets` subcollection. Manually add one document with `ticketNumber: "T-001"`, `customerName: "Test Customer"`, `deviceType: "iPhone 14"`, `status: "checked_in"`, `createdAt: (now)`. (A cleaner version gets created via Task 6's check-in flow; this just verifies the list renders.)

- [ ] **Step 4: Manual check**

Reload the portal. Click "Repair Tickets" sidebar link. Verify the seeded ticket appears. Click a status tab (e.g., "Completed") — the ticket should disappear. Click "All" — it reappears. Type in the search box — verify filter works. Empty state shows when filters match nothing.

- [ ] **Step 5: Commit**

```bash
git add portal/js/views/repair/tickets.js portal/js/main.js
git commit -m "feat(portal): add Repair tickets list view with status tabs and search"
```

---

### Task 5: Ticket Detail View (Pro tier — inventory-linked)

**Files:**
- Modify: `portal/js/views/repair/tickets.js`

Builds out the `showDetail` function with the full drawer: editable fields, status dropdown, inventory-linked parts table, labor input with quick-add, notes, history.

- [ ] **Step 1: Replace the `showDetail` stub in `tickets.js` with the full implementation**

Delete the stub and paste this block in its place (before the `escapeHtml` function at the bottom):

```javascript
let detailState = null; // { ticket, parts }

async function showDetail(ticketId) {
  currentPage = 'detail';
  const container = document.getElementById('view-tickets');
  container.innerHTML = '<div class="loading">Loading ticket...</div>';

  try {
    const ticket = await getTicket(ticketId);
    if (!ticket) { container.innerHTML = '<p>Ticket not found.</p>'; return; }
    const parts = hasFeature('inventory') ? await listParts() : [];
    detailState = { ticket, parts };
    renderDetail();
  } catch (err) {
    console.error('Load ticket failed:', err);
    container.innerHTML = `<p style="color:var(--danger);">Failed to load ticket: ${escapeHtml(err.message)}</p>`;
  }
}

function renderDetail() {
  const container = document.getElementById('view-tickets');
  const { ticket, parts } = detailState;
  container.innerHTML = '';

  const backBtn = document.createElement('button');
  backBtn.className = 'detail-back';
  backBtn.innerHTML = '&larr; Back to tickets';
  backBtn.addEventListener('click', () => { currentPage = 'list'; renderList(); });
  container.appendChild(backBtn);

  const header = document.createElement('div');
  header.className = 'detail-header';
  header.innerHTML = `
    <div style="flex:1;">
      <div class="detail-name">${escapeHtml(ticket.ticketNumber)} &middot; ${escapeHtml(ticket.deviceType || '')}</div>
      <div class="detail-subtitle">${escapeHtml(ticket.customerName || '-')} &middot; <span class="badge ${statusBadgeClass(ticket.status)}">${escapeHtml(STATUS_LABELS[ticket.status] || ticket.status)}</span></div>
    </div>
  `;
  container.appendChild(header);

  // ── Status + core fields ──
  const coreSection = document.createElement('div');
  coreSection.className = 'settings-section';
  coreSection.innerHTML = `
    <h3 class="section-title">Details</h3>
    <div class="modal-form-grid">
      <div class="modal-field">
        <label>Status</label>
        <select name="status" ${canWrite() ? '' : 'disabled'}>
          ${STATUS_ORDER.map(s => `<option value="${s}" ${ticket.status === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
        </select>
      </div>
      <div class="modal-field">
        <label>Estimated Completion</label>
        <input type="date" name="estimatedCompletion" ${canWrite() ? '' : 'disabled'} value="${formatDateInput(ticket.estimatedCompletion)}">
      </div>
    </div>
    <div class="modal-form-grid">
      <div class="modal-field"><label>Serial / IMEI</label><input type="text" name="serial" ${canWrite() ? '' : 'disabled'} value="${escapeHtml(ticket.serial || '')}"></div>
      <div class="modal-field"><label>Device Type</label><input type="text" name="deviceType" ${canWrite() ? '' : 'disabled'} value="${escapeHtml(ticket.deviceType || '')}"></div>
    </div>
    <div class="modal-field"><label>Issue</label><textarea name="issue" rows="2" ${canWrite() ? '' : 'disabled'}>${escapeHtml(ticket.issue || '')}</textarea></div>
    <div class="modal-field"><label>Condition Notes</label><textarea name="condition" rows="2" ${canWrite() ? '' : 'disabled'}>${escapeHtml(ticket.condition || '')}</textarea></div>
    <div class="modal-field"><label>Internal Notes</label><textarea name="notes" rows="3" ${canWrite() ? '' : 'disabled'}>${escapeHtml(ticket.notes || '')}</textarea></div>
    ${canWrite() ? '<button class="btn btn-primary btn-sm" id="saveCoreBtn">Save Changes</button>' : ''}
  `;
  container.appendChild(coreSection);

  const saveBtn = coreSection.querySelector('#saveCoreBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', gateWrite(async () => {
      const patch = {
        status: coreSection.querySelector('[name="status"]').value,
        estimatedCompletion: coreSection.querySelector('[name="estimatedCompletion"]').value || null,
        serial: coreSection.querySelector('[name="serial"]').value,
        deviceType: coreSection.querySelector('[name="deviceType"]').value,
        issue: coreSection.querySelector('[name="issue"]').value,
        condition: coreSection.querySelector('[name="condition"]').value,
        notes: coreSection.querySelector('[name="notes"]').value
      };
      try {
        const statusChanged = patch.status !== ticket.status;
        await updateTicket(ticket.id, patch);
        if (statusChanged) {
          await appendTicketHistory(ticket.id, {
            type: 'status_change',
            description: `Status changed from ${STATUS_LABELS[ticket.status] || ticket.status} to ${STATUS_LABELS[patch.status] || patch.status}`
          });
        }
        const refreshed = await getTicket(ticket.id);
        detailState.ticket = refreshed;
        renderDetail();
      } catch (err) {
        alert('Save failed: ' + err.message);
      }
    }));
  }

  // ── Parts section ──
  const partsSection = document.createElement('div');
  partsSection.className = 'settings-section';
  partsSection.style.marginTop = '1rem';

  if (hasFeature('inventory')) {
    // Pro tier — inventory-linked parts picker
    let partsHtml = `<h3 class="section-title">Parts Used</h3>`;
    if ((ticket.partsUsed || []).length === 0) {
      partsHtml += `<p style="color:var(--gray);font-size:0.9rem;">No parts added yet.</p>`;
    } else {
      partsHtml += `<table class="data-table"><thead><tr><th>SKU</th><th>Name</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Unit Price</th><th style="text-align:right;">Amount</th><th></th></tr></thead><tbody>`;
      ticket.partsUsed.forEach((p, idx) => {
        const amount = (p.qty || 0) * (p.unitPrice || 0);
        partsHtml += `<tr>
          <td style="font-family:monospace;">${escapeHtml(p.sku || '-')}</td>
          <td>${escapeHtml(p.name || '-')}</td>
          <td style="text-align:right;">${p.qty || 0}</td>
          <td style="text-align:right;">${formatCurrency(p.unitPrice)}</td>
          <td style="text-align:right;">${formatCurrency(amount)}</td>
          <td style="text-align:right;">${canWrite() ? `<button class="btn btn-ghost btn-sm remove-part-btn" data-index="${idx}" style="color:var(--danger);">&times;</button>` : ''}</td>
        </tr>`;
      });
      partsHtml += `</tbody></table>`;
    }

    if (canWrite()) {
      partsHtml += `
        <div style="display:flex;gap:0.5rem;margin-top:0.75rem;align-items:flex-end;">
          <div class="modal-field" style="flex:1;margin-bottom:0;">
            <label>Add Part</label>
            <select id="addPartSelect">
              <option value="">— Select a part —</option>
              ${parts.filter(p => (p.quantity || 0) > 0).map(p => `<option value="${p.id}" data-qty="${p.quantity}">${escapeHtml(p.name)} (${p.quantity} in stock)</option>`).join('')}
            </select>
          </div>
          <div class="modal-field" style="width:100px;margin-bottom:0;">
            <label>Qty</label>
            <input type="number" id="addPartQty" min="1" step="1" value="1">
          </div>
          <button class="btn btn-primary" id="addPartBtn" style="height:38px;">Add</button>
        </div>
      `;
    }

    partsSection.innerHTML = partsHtml;
    container.appendChild(partsSection);

    partsSection.querySelectorAll('.remove-part-btn').forEach(btn => {
      btn.addEventListener('click', gateWrite(async () => {
        const idx = Number(btn.dataset.index);
        if (!confirm('Remove this part? Stock will be returned to inventory.')) return;
        try {
          await removePartFromTicket(ticket.id, idx);
          await showDetail(ticket.id);
        } catch (err) { alert('Remove failed: ' + err.message); }
      }));
    });

    const addBtn = partsSection.querySelector('#addPartBtn');
    if (addBtn) {
      addBtn.addEventListener('click', gateWrite(async () => {
        const sel = partsSection.querySelector('#addPartSelect');
        const qtyInput = partsSection.querySelector('#addPartQty');
        const partId = sel.value;
        const qty = Number(qtyInput.value) || 0;
        if (!partId || qty <= 0) { alert('Select a part and enter a positive quantity.'); return; }
        try {
          await addPartToTicket(ticket.id, partId, qty);
          await showDetail(ticket.id);
        } catch (err) { alert(err.message); }
      }));
    }
  } else {
    // Basic tier — partsNotes textarea fallback (implemented in Task 6)
    renderBasicPartsSection(partsSection, ticket);
    container.appendChild(partsSection);
  }

  // ── Labor section ──
  const laborSection = document.createElement('div');
  laborSection.className = 'settings-section';
  laborSection.style.marginTop = '1rem';
  laborSection.innerHTML = `
    <h3 class="section-title">Labor</h3>
    <div style="display:flex;gap:0.5rem;align-items:flex-end;">
      <div class="modal-field" style="width:150px;margin-bottom:0;">
        <label>Minutes</label>
        <input type="number" id="laborInput" min="0" step="1" ${canWrite() ? '' : 'disabled'} value="${ticket.laborMinutes || 0}">
      </div>
      ${canWrite() ? `
      <button class="btn btn-ghost btn-sm" data-add="15">+15</button>
      <button class="btn btn-ghost btn-sm" data-add="30">+30</button>
      <button class="btn btn-ghost btn-sm" data-add="60">+60</button>
      <button class="btn btn-primary btn-sm" id="saveLaborBtn" style="margin-left:auto;">Save Labor</button>
      ` : ''}
    </div>
  `;
  container.appendChild(laborSection);
  const laborInput = laborSection.querySelector('#laborInput');
  laborSection.querySelectorAll('[data-add]').forEach(btn => {
    btn.addEventListener('click', () => {
      laborInput.value = (Number(laborInput.value) || 0) + Number(btn.dataset.add);
    });
  });
  const saveLaborBtn = laborSection.querySelector('#saveLaborBtn');
  if (saveLaborBtn) {
    saveLaborBtn.addEventListener('click', gateWrite(async () => {
      try {
        await updateTicket(ticket.id, { laborMinutes: Number(laborInput.value) || 0 });
        const refreshed = await getTicket(ticket.id);
        detailState.ticket = refreshed;
        renderDetail();
      } catch (err) { alert('Save labor failed: ' + err.message); }
    }));
  }

  // ── Invoice generation (Task 9 implements the button handler) ──
  const invoiceSection = renderInvoiceSection(ticket);
  if (invoiceSection) container.appendChild(invoiceSection);

  // ── History ──
  const historySection = document.createElement('div');
  historySection.className = 'settings-section';
  historySection.style.marginTop = '1rem';
  let historyHtml = '<h3 class="section-title">Activity</h3>';
  if (!ticket.history || ticket.history.length === 0) {
    historyHtml += '<p style="color:var(--gray);font-size:0.9rem;">No activity yet.</p>';
  } else {
    historyHtml += '<ul style="list-style:none;padding:0;margin:0;">';
    ticket.history.forEach(h => {
      historyHtml += `<li style="padding:0.5rem 0;border-bottom:1px solid var(--border);font-size:0.85rem;">
        <strong>${escapeHtml(h.description || '')}</strong>
        <div style="color:var(--gray);font-size:0.75rem;">${formatDate(h.at)} &middot; ${escapeHtml(h.byEmail || 'system')}</div>
      </li>`;
    });
    historyHtml += '</ul>';
  }
  historySection.innerHTML = historyHtml;
  container.appendChild(historySection);
}

// renderBasicPartsSection and renderInvoiceSection are added in later tasks
function renderBasicPartsSection(section, ticket) {
  section.innerHTML = '<h3 class="section-title">Parts Used</h3><p style="color:var(--gray);">Basic tier — implemented in Task 6.</p>';
}
function renderInvoiceSection(ticket) { return null; }

function formatDateInput(ts) {
  if (!ts) return '';
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().split('T')[0];
  } catch { return ''; }
}
```

- [ ] **Step 2: Manual check**

Reload the portal. Click your existing ticket. Verify:
- Core fields render with current values
- Status dropdown works — change it to "In Repair", click Save Changes, verify it persists on page refresh, verify History section shows the status change
- Parts section: dropdown lists the inventory items you seeded with in-stock qty. Add 2 screens to the ticket. Verify it appears in the parts table. Go to Parts Inventory — verify the screen qty decremented by 2. Click the × to remove — verify inventory qty returns.
- Labor: click +15 three times, verify it shows 45. Click Save Labor. Refresh, verify 45 persists.
- Activity log at bottom shows all the history entries you just created.

- [ ] **Step 3: Commit**

```bash
git add portal/js/views/repair/tickets.js
git commit -m "feat(portal): add ticket detail with parts, labor, history"
```

---

### Task 6: Basic Tier Fallback for Parts

**Files:**
- Modify: `portal/js/views/repair/tickets.js`

Basic tier tenants don't have `inventory` — they need a plain textarea to record parts.

- [ ] **Step 1: Replace the stub `renderBasicPartsSection` function in `tickets.js`**

```javascript
function renderBasicPartsSection(section, ticket) {
  section.innerHTML = `
    <h3 class="section-title">Parts Used</h3>
    <div class="modal-field">
      <label>Free-text parts log (e.g., "2× iPhone 14 screens — $120, 1× battery — $40")</label>
      <textarea id="partsNotesInput" rows="3" ${canWrite() ? '' : 'disabled'}>${escapeHtml(ticket.partsNotes || '')}</textarea>
    </div>
    ${canWrite() ? '<button class="btn btn-primary btn-sm" id="savePartsNotesBtn">Save Notes</button>' : ''}
  `;
  const saveBtn = section.querySelector('#savePartsNotesBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', gateWrite(async () => {
      const val = section.querySelector('#partsNotesInput').value;
      try {
        await updateTicket(ticket.id, { partsNotes: val });
        await appendTicketHistory(ticket.id, { type: 'note', description: 'Parts notes updated' });
      } catch (err) { alert('Save failed: ' + err.message); }
    }));
  }
}
```

- [ ] **Step 2: Manual check**

To test Basic: temporarily change your test tenant's `packageId` in Firebase Console to `repair_basic` (or provision a second tenant on `repair_basic`). Reload the portal. Open a ticket. Verify the Parts section shows a textarea with the free-text instructions, not the inventory picker. Type notes, save, refresh, confirm persisted. Check that Inventory and Check-in sidebar links are hidden.

Revert your tenant's `packageId` to `repair_pro` afterward.

- [ ] **Step 3: Commit**

```bash
git add portal/js/views/repair/tickets.js
git commit -m "feat(portal): add Basic-tier free-text parts notes fallback"
```

---

### Task 7: Check-in View

**Files:**
- Create: `portal/js/views/repair/checkin.js`
- Modify: `portal/js/main.js`

A streamlined intake form that creates a contact (or picks existing) and a ticket in one flow.

- [ ] **Step 1: Create `portal/js/views/repair/checkin.js`**

```javascript
import { addDocument, queryDocuments } from '../../services/firestore.js';
import { createTicket } from '../../services/tickets.js';
import { db } from '../../config.js';
import { addDoc, collection, serverTimestamp, Timestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { canWrite, gateWrite, getTenantId, hasFeature } from '../../tenant-context.js';

let contacts = [];
let currentPage = 'form';
let lastTicket = null;

export function init() {}

export async function render() {
  if (!hasFeature('checkin')) {
    document.getElementById('view-checkin').innerHTML =
      '<div class="empty-state"><div class="empty-title">Not included in your plan</div><p class="empty-description">Upgrade to Pro to unlock streamlined check-in.</p></div>';
    return;
  }
  try { contacts = await queryDocuments('contacts', 'name', 'asc'); } catch { contacts = []; }
  if (currentPage === 'form') renderForm();
  else if (currentPage === 'confirmation') renderConfirmation();
}

export function destroy() { currentPage = 'form'; lastTicket = null; }

function renderForm() {
  const container = document.getElementById('view-checkin');
  container.innerHTML = '';

  const form = document.createElement('form');
  form.className = 'modal-form';
  form.style.cssText = 'max-width:640px;margin:0 auto;';

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 3);
  const defaultEta = tomorrow.toISOString().split('T')[0];

  form.innerHTML = `
    <h2 style="margin-bottom:1rem;">Check In</h2>

    <div class="modal-field">
      <label>Customer</label>
      <select id="customerSelect">
        <option value="">— Select a customer —</option>
        <option value="__new__">+ New customer</option>
        ${contacts.map(c => `<option value="${c.id}">${escapeHtml(c.name || c.email || 'Unnamed')}</option>`).join('')}
      </select>
    </div>

    <div id="newCustomerBlock" style="display:none;">
      <div class="modal-form-grid">
        <div class="modal-field"><label>Name *</label><input type="text" name="newName"></div>
        <div class="modal-field"><label>Phone</label><input type="tel" name="newPhone"></div>
      </div>
      <div class="modal-field"><label>Email</label><input type="email" name="newEmail"></div>
    </div>

    <div class="modal-form-grid">
      <div class="modal-field"><label>Device Type *</label><input type="text" name="deviceType" required placeholder="e.g., iPhone 14 Pro"></div>
      <div class="modal-field"><label>Serial / IMEI</label><input type="text" name="serial"></div>
    </div>

    <div class="modal-field"><label>Issue *</label><textarea name="issue" rows="3" required placeholder="What's wrong with the device?"></textarea></div>
    <div class="modal-field"><label>Condition Notes</label><textarea name="condition" rows="2" placeholder="Scratches, dents, missing parts..."></textarea></div>
    <div class="modal-field"><label>Estimated Completion</label><input type="date" name="estimatedCompletion" value="${defaultEta}"></div>

    <div style="margin-top:1rem;">
      <button type="submit" class="btn btn-primary" ${canWrite() ? '' : 'disabled'}>Check In &amp; Create Ticket</button>
    </div>
  `;
  container.appendChild(form);

  const selectEl = form.querySelector('#customerSelect');
  const newBlock = form.querySelector('#newCustomerBlock');
  selectEl.addEventListener('change', () => {
    newBlock.style.display = selectEl.value === '__new__' ? 'block' : 'none';
  });

  form.addEventListener('submit', gateWrite(async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating...';

    try {
      let contactId = selectEl.value;
      let customerName = '';

      if (contactId === '__new__') {
        const newName = form.querySelector('[name="newName"]').value.trim();
        if (!newName) throw new Error('Please enter the new customer name.');
        const newPhone = form.querySelector('[name="newPhone"]').value.trim();
        const newEmail = form.querySelector('[name="newEmail"]').value.trim();
        const ref = await addDocument('contacts', {
          name: newName,
          phone: newPhone,
          email: newEmail
        });
        contactId = ref.id;
        customerName = newName;
      } else if (contactId) {
        const c = contacts.find(x => x.id === contactId);
        customerName = c ? (c.name || c.email || '') : '';
      } else {
        throw new Error('Please select a customer or add a new one.');
      }

      const etaStr = form.querySelector('[name="estimatedCompletion"]').value;
      const etaTs = etaStr ? Timestamp.fromDate(new Date(etaStr)) : null;

      const result = await createTicket({
        contactId,
        customerName,
        deviceType: form.querySelector('[name="deviceType"]').value.trim(),
        serial: form.querySelector('[name="serial"]').value.trim(),
        issue: form.querySelector('[name="issue"]').value.trim(),
        condition: form.querySelector('[name="condition"]').value.trim(),
        estimatedCompletion: etaTs,
        status: 'checked_in'
      });

      // Log to tenant activity
      const tid = getTenantId();
      await addDoc(collection(db, `tenants/${tid}/activity`), {
        type: 'ticket_created',
        description: `Ticket ${result.ticketNumber} — ${form.querySelector('[name="deviceType"]').value.trim()} for ${customerName}`,
        metadata: { ticketId: result.id, ticketNumber: result.ticketNumber },
        createdAt: serverTimestamp()
      });

      lastTicket = {
        id: result.id,
        ticketNumber: result.ticketNumber,
        customerName,
        deviceType: form.querySelector('[name="deviceType"]').value.trim(),
        serial: form.querySelector('[name="serial"]').value.trim(),
        issue: form.querySelector('[name="issue"]').value.trim(),
        condition: form.querySelector('[name="condition"]').value.trim(),
        estimatedCompletion: etaStr,
        checkedInAt: new Date()
      };
      currentPage = 'confirmation';
      renderConfirmation();
    } catch (err) {
      console.error('Check-in failed:', err);
      alert('Check-in failed: ' + err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Check In & Create Ticket';
    }
  }));
}

function renderConfirmation() {
  if (!lastTicket) { currentPage = 'form'; return renderForm(); }
  const container = document.getElementById('view-checkin');
  container.innerHTML = `
    <div style="max-width:640px;margin:0 auto;text-align:center;padding:2rem;">
      <div style="font-size:3rem;">✓</div>
      <h2 style="margin:0.5rem 0;">Checked in as ${escapeHtml(lastTicket.ticketNumber)}</h2>
      <p style="color:var(--gray);">${escapeHtml(lastTicket.customerName)} &middot; ${escapeHtml(lastTicket.deviceType)}</p>
      <div style="display:flex;gap:0.5rem;justify-content:center;margin-top:1.5rem;flex-wrap:wrap;">
        <button class="btn btn-primary" id="printClaimBtn">Print Claim Tag</button>
        <button class="btn btn-ghost" id="anotherCheckinBtn">Check In Another</button>
        <a class="btn btn-ghost" href="#tickets">View All Tickets</a>
      </div>
    </div>

    <!-- Claim tag print target — hidden on screen, shown on print -->
    <div class="claim-tag-print-only" id="claimTagPrint">
      <div class="claim-tag">
        <div class="claim-tag-header">
          <div class="claim-tag-title">CLAIM TAG</div>
          <div class="claim-tag-number">${escapeHtml(lastTicket.ticketNumber)}</div>
        </div>
        <div class="claim-tag-row"><span>Customer:</span> ${escapeHtml(lastTicket.customerName)}</div>
        <div class="claim-tag-row"><span>Device:</span> ${escapeHtml(lastTicket.deviceType)}</div>
        <div class="claim-tag-row"><span>Serial:</span> ${escapeHtml(lastTicket.serial || '—')}</div>
        <div class="claim-tag-row"><span>Condition:</span> ${escapeHtml(lastTicket.condition || '—')}</div>
        <div class="claim-tag-row"><span>Issue:</span> ${escapeHtml(lastTicket.issue)}</div>
        <div class="claim-tag-row"><span>Checked in:</span> ${lastTicket.checkedInAt.toLocaleString()}</div>
        <div class="claim-tag-row"><span>Est. ready:</span> ${escapeHtml(lastTicket.estimatedCompletion || '—')}</div>
      </div>
    </div>
  `;
  document.getElementById('printClaimBtn').addEventListener('click', () => window.print());
  document.getElementById('anotherCheckinBtn').addEventListener('click', () => {
    lastTicket = null;
    currentPage = 'form';
    render();
  });
}

function escapeHtml(str) {
  if (str == null) return '';
  const node = document.createElement('span');
  node.appendChild(document.createTextNode(String(str)));
  return node.innerHTML;
}
```

- [ ] **Step 2: Register in `portal/js/main.js`**

Remove `'checkin'` from the `placeholderViews` array. Add above the placeholder loop:

```javascript
  const checkinMod = await import('./views/repair/checkin.js');
  registerView('checkin', {
    init: checkinMod.init,
    render() { document.getElementById('headerTitle').textContent = 'Check In'; checkinMod.render(); },
    destroy: checkinMod.destroy
  });
```

- [ ] **Step 3: Manual check**

Reload the portal. Click Check-In nav. Verify the form renders. Select "+ New customer", fill in name "Bob Smith", phone, email. Fill device "iPhone 14", issue "Screen cracked", click submit. Verify you land on the confirmation screen with a ticket number (T-002 or similar). Verify Firebase has a new contact doc in `contacts` and a new ticket in `tickets` with status=`checked_in`. Go to Tickets view and confirm the new ticket appears. Check `tenants/{t}/activity/` — there should be a `ticket_created` entry.

- [ ] **Step 4: Commit**

```bash
git add portal/js/views/repair/checkin.js portal/js/main.js
git commit -m "feat(portal): add Check-In view for Repair vertical"
```

---

### Task 8: Claim Tag Print Stylesheet

**Files:**
- Modify: `portal/css/portal.css`

Adds the `@media print` rules that hide the UI and render the compact claim tag.

- [ ] **Step 1: Append to the end of `portal/css/portal.css`**

```css
/* ── Claim tag print ───────────────────── */

.claim-tag-print-only {
  display: none;
}

@media print {
  body * { visibility: hidden; }
  .claim-tag-print-only, .claim-tag-print-only * { visibility: visible; }
  .claim-tag-print-only {
    display: block;
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
  }
  .claim-tag {
    width: 4in;
    padding: 0.25in;
    font-family: 'Courier New', monospace;
    font-size: 11pt;
    color: #000;
  }
  .claim-tag-header {
    text-align: center;
    border-bottom: 2px solid #000;
    padding-bottom: 0.1in;
    margin-bottom: 0.2in;
  }
  .claim-tag-title {
    font-size: 14pt;
    font-weight: bold;
    letter-spacing: 2px;
  }
  .claim-tag-number {
    font-size: 20pt;
    font-weight: bold;
    margin-top: 0.1in;
  }
  .claim-tag-row {
    padding: 0.05in 0;
    border-bottom: 1px dashed #666;
  }
  .claim-tag-row span {
    display: inline-block;
    min-width: 1in;
    font-weight: bold;
  }
  @page { size: 4in 6in; margin: 0; }
}
```

- [ ] **Step 2: Manual check**

After checking in a customer, click "Print Claim Tag" on the confirmation screen. The browser print preview should show a compact tag with ticket number, customer, device, issue, etc. Cancel the print dialog.

- [ ] **Step 3: Commit**

```bash
git add portal/css/portal.css
git commit -m "feat(portal): add claim tag print stylesheet"
```

---

### Task 9: Ticket → Invoice Generation (UI)

**Files:**
- Modify: `portal/js/views/repair/tickets.js`

Wires the "Generate Invoice" button that calls `generateInvoiceFromTicket()` from the tickets service. Service is already implemented in Task 1.

- [ ] **Step 1: Replace the stub `renderInvoiceSection` function in `tickets.js`**

```javascript
function renderInvoiceSection(ticket) {
  if (!canWrite()) return null;
  const section = document.createElement('div');
  section.className = 'settings-section';
  section.style.marginTop = '1rem';

  if (ticket.invoiceId) {
    section.innerHTML = `
      <h3 class="section-title">Invoice</h3>
      <p style="font-size:0.9rem;color:var(--gray);">Invoice already generated.</p>
      <a class="btn btn-ghost btn-sm" href="#invoicing">View in Invoicing</a>
    `;
    return section;
  }

  if (ticket.status !== 'completed') {
    section.innerHTML = `
      <h3 class="section-title">Invoice</h3>
      <p style="font-size:0.9rem;color:var(--gray);">Set status to Completed to generate an invoice.</p>
    `;
    return section;
  }

  section.innerHTML = `
    <h3 class="section-title">Generate Invoice</h3>
    <p style="font-size:0.9rem;color:var(--gray);margin-bottom:0.75rem;">Creates an invoice from this ticket's parts and labor. Labor rate comes from your tenant settings.</p>
    <button class="btn btn-primary" id="genInvoiceBtn">Generate Invoice</button>
  `;

  const btn = section.querySelector('#genInvoiceBtn');
  btn.addEventListener('click', gateWrite(async () => {
    btn.disabled = true;
    btn.textContent = 'Generating...';

    try {
      const opts = {};
      if (!hasFeature('inventory') && (ticket.partsNotes || '').trim()) {
        const totalStr = prompt(
          'Enter the total parts charge for this ticket (the free-text notes will be used as the line description):',
          '0'
        );
        const total = Number(totalStr);
        if (!Number.isFinite(total) || total < 0) {
          alert('Cancelled — invalid amount.');
          btn.disabled = false;
          btn.textContent = 'Generate Invoice';
          return;
        }
        opts.basicPartsTotal = total;
        opts.basicPartsLabel = 'Parts: ' + ticket.partsNotes.trim();
      }

      const { invoiceNumber } = await generateInvoiceFromTicket(ticket.id, opts);
      alert(`Invoice ${invoiceNumber} created.`);
      await showDetail(ticket.id);
    } catch (err) {
      alert('Invoice generation failed: ' + err.message);
      btn.disabled = false;
      btn.textContent = 'Generate Invoice';
    }
  }));

  return section;
}
```

- [ ] **Step 2: Manual check**

Open a ticket. Change status to "Completed" and save. The invoice section should show the Generate Invoice button. Click it. Verify:
- Alert says "Invoice INV-T-00X created"
- Page refreshes, section now says "Invoice already generated"
- Go to Invoicing view — the new invoice appears with line items (one per part used + one labor line)
- `tenants/{t}/activity` has a `ticket_completed` entry
- Ticket's history shows "Invoice INV-T-00X generated"

For Basic tier testing: temporarily switch to `repair_basic`, complete a ticket with `partsNotes` set, generate invoice, enter a parts total in the prompt, verify the invoice has a single "Parts: {notes}" line plus labor.

- [ ] **Step 3: Commit**

```bash
git add portal/js/views/repair/tickets.js
git commit -m "feat(portal): wire ticket-to-invoice generation"
```

---

### Task 10: Labor Rate Tenant Setting

**Files:**
- Modify: `portal/js/main.js` (the `renderAccountSettings` function)
- Modify: CRM provisioning code to seed `laborRate: 0`

The invoice generator reads labor rate from `tenants/{tenantId}/settings/general`. Tenants need a way to edit it from the portal. Provisioning should seed it to 0 for all new tenants.

- [ ] **Step 1: Add the laborRate editor to `renderAccountSettings` in `portal/js/main.js`**

Find the `renderAccountSettings` function (currently around line 520). Replace its body with this expanded version:

```javascript
async function renderAccountSettings() {
  const container = document.getElementById('view-account-settings');
  const tenant = getTenant();

  container.innerHTML = '<div class="loading">Loading settings...</div>';

  const { getDoc: fbGetDoc, setDoc: fbSetDoc, doc: fbDoc, serverTimestamp: fbServerTs } =
    await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
  const { db: fbDb } = await import('./config.js');

  let generalSettings = {};
  try {
    const snap = await fbGetDoc(fbDoc(fbDb, `tenants/${tenant.id}/settings/general`));
    generalSettings = snap.exists() ? snap.data() : {};
  } catch (err) { console.error('Load settings failed:', err); }

  const canEdit = !isReadOnly() && !isSuspended();

  container.innerHTML = `
    <div class="settings-section">
      <h2 class="section-title">Business Information</h2>
      <div class="detail-field"><div class="detail-field-label">Business Name</div><div class="detail-field-value">${escapeHtml(tenant.companyName || '-')}</div></div>
      <div class="detail-field"><div class="detail-field-label">Vertical</div><div class="detail-field-value">${escapeHtml(tenant.vertical || '-')}</div></div>
      <div class="detail-field"><div class="detail-field-label">Status</div><div class="detail-field-value">${escapeHtml(tenant.status || '-')}</div></div>
      <div class="detail-field"><div class="detail-field-label">Account ID</div><div class="detail-field-value" style="font-family:monospace;font-size:0.8rem;">${escapeHtml(tenant.id || '-')}</div></div>
    </div>
    <div class="settings-section" style="margin-top:1.5rem;">
      <h2 class="section-title">Billing Defaults</h2>
      <div class="modal-field">
        <label>Labor Rate (per hour)</label>
        <input type="number" id="laborRateInput" min="0" step="0.01" ${canEdit ? '' : 'disabled'} value="${generalSettings.laborRate ?? 0}">
      </div>
      ${canEdit ? '<button class="btn btn-primary btn-sm" id="saveSettingsBtn">Save</button>' : ''}
      <span id="settingsSaveStatus" style="margin-left:0.75rem;color:var(--gray);font-size:0.85rem;"></span>
    </div>
  `;

  const saveBtn = container.querySelector('#saveSettingsBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const status = container.querySelector('#settingsSaveStatus');
      const rate = Number(container.querySelector('#laborRateInput').value) || 0;
      saveBtn.disabled = true;
      status.textContent = 'Saving...';
      try {
        await fbSetDoc(
          fbDoc(fbDb, `tenants/${tenant.id}/settings/general`),
          { laborRate: rate, updatedAt: fbServerTs() },
          { merge: true }
        );
        status.textContent = 'Saved.';
        setTimeout(() => { status.textContent = ''; }, 2000);
      } catch (err) {
        status.textContent = 'Save failed: ' + err.message;
      } finally {
        saveBtn.disabled = false;
      }
    });
  }
}
```

Note: `renderAccountSettings` was synchronous before; now it's async. Its call site (in `registerView('account-settings', { render() { ... } })` around line 285) is already an arrow function that doesn't await. Change that to:

```javascript
  registerView('account-settings', {
    render() {
      document.getElementById('headerTitle').textContent = 'Settings';
      renderAccountSettings();  // fire-and-forget is fine; the function manages its own loading state
    }
  });
```

(No change needed if it already looks like this — just don't prepend `await`.)

- [ ] **Step 2: Seed `laborRate: 0` on tenant provisioning**

The provisioning code lives in `crm/js/views/pipeline.js`. The tenant is created around line 1167 (`createTenant(...)`) and the first tenant activity is logged around line 1222 (`addTenantActivity(...)`). Insert the settings seed between these — immediately after the `const tenantId = tenantRef.id;` line (currently line 1192), before the owner-user placeholder creation.

Add this block after `const tenantId = tenantRef.id;`:

```javascript
    // Seed default tenant settings (labor rate, currency, timezone)
    {
      const { doc: fbDoc2, setDoc: fbSetDoc2, serverTimestamp: fbServerTs2 } =
        await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
      const { db: fbDb2 } = await import('../config.js');
      await fbSetDoc2(fbDoc2(fbDb2, `tenants/${tenantId}/settings/general`), {
        laborRate: 0,
        currency: 'USD',
        timezone: 'America/Chicago',
        createdAt: fbServerTs2()
      });
    }
```

The block is self-contained (its own scope + fresh imports) to avoid name collisions with existing `fbDoc` / `fbSetDoc` / `fbDb` bindings used later in the same function.

- [ ] **Step 3: Manual check**

Portal → Settings. Verify the Labor Rate input shows 0 (or whatever you previously set). Change to 75, click Save, verify "Saved." appears. Refresh page, verify 75 is still there. Check Firebase Console: `tenants/{t}/settings/general` has `laborRate: 75`.

Then complete a ticket with 60 labor minutes and 1 part at $120, generate invoice. Verify the invoice's labor line shows `1.00 hours × $75 = $75` and parts line shows `1 × $120 = $120`, total $195.

For the provisioning seed: provision a fresh tenant from the CRM (create a new deal, mark Won, Provision Tenant). Open Firebase Console → verify the new tenant has `settings/general` with `laborRate: 0`.

- [ ] **Step 4: Commit**

```bash
git add portal/js/main.js crm/js
git commit -m "feat: add laborRate tenant setting and seed default on provisioning"
```

---

### Task 11: End-to-End Verification

No code in this task — just the full testing matrix from the spec. This is the gate before deployment.

- [ ] **Step 1: Deploy to Cloudflare Pages**

```bash
git push origin master
```

Wait for the Pages build to complete (usually 1–2 minutes). Confirm at `https://automationapp.org/portal/` that the latest commit is live.

- [ ] **Step 2: Full test matrix against production**

Run each of these. Mark each `[ ]` as you complete it; do not proceed if any fails.

- [ ] 1. Provision a fresh `repair_pro` tenant via the admin CRM.
- [ ] 2. Log into the portal. Check-In flow creates a new customer + ticket; claim tag prints correctly.
- [ ] 3. Add 3 parts to inventory. Low-stock red badge appears for parts where qty ≤ reorder level.
- [ ] 4. Walk a ticket through every status (checked_in → diagnosed → awaiting_parts → in_repair → qc → ready → completed). Add 2 parts from inventory during the process; verify stock decrements. Add labor via quick-add buttons. Generate invoice; verify line items match and ticket.invoiceId is set; verify `tenants/{t}/activity` has both `ticket_created` and `ticket_completed` entries.
- [ ] 5. Concurrency spot-check: open the same ticket in two browser windows. Add different parts in each. Refresh both — both parts should be present and inventory should show the correct final quantity (both decrements applied).
- [ ] 6. Tier gating: provision a second tenant on `repair_basic`. Verify Inventory and Check-in nav links are hidden. Verify direct URL (`#inventory`) loads an empty view; `#checkin` shows "Not included in your plan." Verify a ticket's Parts section is a textarea (not a picker). Verify Basic invoice generation prompts for a parts total and produces the expected line items.
- [ ] 7. Read-only mode: in the admin CRM, flip the Pro tenant's `status` to `past_due`. Reload the portal for that tenant. All Save buttons disabled; Add Part, Generate Invoice, Save Labor, Status dropdown disabled; view-only still works. Flip back to `active` and verify writes resume.
- [ ] 8. Cross-tenant isolation: from tenant A's portal, grab a ticket ID from tenant B (via Firebase Console) and try loading it directly (e.g., call `getTicket("some-other-tenant-ticket-id")` from the browser console). Should throw a permission error.

- [ ] **Step 3: If any step fails, fix and commit**

Bug fixes go in their own commits with `fix:` prefix, then redeploy and re-run the failing step.

- [ ] **Step 4: Record completion**

Once all 8 tests pass, commit a short marker file so the next session knows this plan is done:

```bash
echo "Repair vertical (Basic + Pro) shipped and verified $(date -u +%Y-%m-%d)" >> docs/superpowers/plans/2026-04-16-repair-vertical.md
git add docs/superpowers/plans/2026-04-16-repair-vertical.md
git commit -m "docs: mark Repair vertical plan complete"
git push origin master
```

---

## Plan Complete

**What was delivered:**
- `portal/js/services/tickets.js` — ticket CRUD + `runTransaction`-based number minting, part-add/remove, invoice generation
- `portal/js/services/inventory.js` — parts CRUD
- `portal/js/views/repair/tickets.js` — list with status tabs + search, detail view with status/fields/parts/labor/invoice/history
- `portal/js/views/repair/inventory.js` — parts list with low-stock badge and inline-editable form
- `portal/js/views/repair/checkin.js` — streamlined intake with contact picker and print claim tag
- `portal/css/portal.css` — print stylesheet for claim tag
- `portal/js/main.js` — replaced placeholder registrations; added labor rate editor in account settings
- CRM provisioning — seeds `tenants/{t}/settings/general` with `laborRate: 0`

**What's next:** Trades vertical (Basic + Pro). Reuse the tickets/tickets-service pattern for jobs; build dispatching board (new UI pattern); build quoting as a pre-sale document that converts to a job on acceptance.
