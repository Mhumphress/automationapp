# Phase 2: Contacts & Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add contact management (people + companies) and a deal pipeline with inline editing, activity logging, and audit trails to the CRM.

**Architecture:** Vanilla HTML/CSS/JS with Firebase SDK via CDN. New JS modules under `crm/js/services/`, `crm/js/views/`, and `crm/js/components/`. Views are registered with the existing hash-based router and rendered inside `app.html`. All Firestore operations go through a shared service layer. Shared UI components (inline edit, detail panel, dropdown) are built once and reused by both contacts and pipeline views.

**Tech Stack:** Firebase Auth + Firestore (CDN v10.12.0), vanilla ES6 modules, CSS custom properties from existing design system (`variables.css`).

**Testing:** No automated test runner (no Node.js). Each task includes manual verification steps to confirm in the browser via the deployed Cloudflare Pages URL. Open browser DevTools console to check for errors after each deploy.

---

## Task 1: Firestore Service Layer

**Files:**
- Create: `crm/js/services/firestore.js`

This module wraps Firestore SDK calls so views don't import Firebase directly. Every write sets `createdAt`/`createdBy` or `updatedAt`/`updatedBy` automatically.

- [ ] **Step 1: Create `crm/js/services/firestore.js`**

```javascript
import { db, auth } from '../config.js';
import {
  collection, doc, addDoc, getDoc, getDocs, updateDoc, deleteDoc,
  query, orderBy, where, serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

/**
 * Add a document to a collection. Auto-sets createdAt, createdBy, updatedAt, updatedBy.
 */
export async function addDocument(collectionName, data) {
  const user = auth.currentUser;
  return addDoc(collection(db, collectionName), {
    ...data,
    createdAt: serverTimestamp(),
    createdBy: user ? user.uid : null,
    updatedAt: serverTimestamp(),
    updatedBy: user ? user.uid : null
  });
}

/**
 * Update fields on a document. Auto-sets updatedAt, updatedBy.
 */
export async function updateDocument(collectionName, docId, data) {
  const user = auth.currentUser;
  return updateDoc(doc(db, collectionName, docId), {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: user ? user.uid : null
  });
}

/**
 * Delete a document.
 */
export async function deleteDocument(collectionName, docId) {
  return deleteDoc(doc(db, collectionName, docId));
}

/**
 * Get a single document by ID.
 */
export async function getDocument(collectionName, docId) {
  const snap = await getDoc(doc(db, collectionName, docId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

/**
 * Query all documents in a collection, optionally ordered.
 */
export async function queryDocuments(collectionName, orderField = 'createdAt', orderDir = 'desc') {
  const q = query(collection(db, collectionName), orderBy(orderField, orderDir));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Query documents with a where clause.
 */
export async function queryDocumentsWhere(collectionName, field, operator, value, orderField = 'createdAt', orderDir = 'desc') {
  const q = query(
    collection(db, collectionName),
    where(field, operator, value),
    orderBy(orderField, orderDir)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Re-export Timestamp for date conversions in views
export { Timestamp, serverTimestamp };
```

- [ ] **Step 2: Verify module loads**

Open browser DevTools console on the CRM app page. Temporarily add to `app.html` script block:
```javascript
import { addDocument } from './js/services/firestore.js';
console.log('firestore service loaded', typeof addDocument);
```
Expected: Console shows `firestore service loaded function` with no errors.

- [ ] **Step 3: Remove test import and commit**

Remove the test import from `app.html`. Commit:
```bash
git add crm/js/services/firestore.js
git commit -m "feat(crm): add Firestore service layer with CRUD helpers"
```

---

## Task 2: Activity Service

**Files:**
- Create: `crm/js/services/activity.js`

Handles reading/writing activity log entries in subcollections. Used by both contacts and deals.

- [ ] **Step 1: Create `crm/js/services/activity.js`**

```javascript
import { db, auth } from '../config.js';
import {
  collection, addDoc, getDocs, query, orderBy, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

/**
 * Add an activity entry to a document's activity subcollection.
 * @param {string} parentCollection - "contacts" or "deals"
 * @param {string} parentId - document ID
 * @param {object} entry - { type, description, field?, oldValue?, newValue? }
 */
export async function addActivity(parentCollection, parentId, entry) {
  const user = auth.currentUser;
  const ref = collection(db, parentCollection, parentId, 'activity');
  return addDoc(ref, {
    ...entry,
    createdAt: serverTimestamp(),
    createdBy: user ? user.uid : null,
    createdByEmail: user ? user.email : null
  });
}

/**
 * Log a field edit as an activity entry.
 */
export async function logFieldEdit(parentCollection, parentId, field, oldValue, newValue) {
  return addActivity(parentCollection, parentId, {
    type: 'edit',
    description: `Changed ${field}`,
    field,
    oldValue: oldValue != null ? String(oldValue) : '',
    newValue: newValue != null ? String(newValue) : ''
  });
}

/**
 * Get all activity entries for a document, newest first.
 */
export async function getActivity(parentCollection, parentId) {
  const ref = collection(db, parentCollection, parentId, 'activity');
  const q = query(ref, orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
```

- [ ] **Step 2: Commit**

```bash
git add crm/js/services/activity.js
git commit -m "feat(crm): add activity log service for contacts and deals"
```

---

## Task 3: Update Firestore Security Rules

**Files:**
- Modify: `crm/firestore.rules`

Add rules for `companies` collection and `activity` subcollections on contacts and deals.

- [ ] **Step 1: Update `crm/firestore.rules`**

Add these rules inside the existing `match /databases/{database}/documents` block, after the existing `contacts` rule:

```
    match /companies/{companyId} {
      allow read, write: if isAuth();
    }

    match /contacts/{contactId}/activity/{activityId} {
      allow read, write: if isAuth();
    }

    match /deals/{dealId}/activity/{activityId} {
      allow read, write: if isAuth();
    }
```

- [ ] **Step 2: Deploy rules to Firebase**

Go to Firebase Console > Firestore > Rules tab. Paste the updated rules and click Publish. Alternatively, if `firebase-tools` is available:
```bash
firebase deploy --only firestore:rules
```

- [ ] **Step 3: Commit**

```bash
git add crm/firestore.rules
git commit -m "feat(crm): add Firestore rules for companies and activity subcollections"
```

---

## Task 4: Detail Panel Component

**Files:**
- Create: `crm/js/components/detail-panel.js`
- Modify: `crm/css/app.css` (append panel styles)

A reusable slide-in panel from the right side of the screen. Used by contacts, companies, and deals.

- [ ] **Step 1: Create `crm/js/components/detail-panel.js`**

```javascript
/**
 * Creates and manages a slide-in detail panel on the right side of .app-main.
 *
 * Usage:
 *   const panel = createDetailPanel();
 *   panel.open('Contact Details', htmlContent);
 *   panel.close();
 *   panel.onClose(() => { ... });
 */
export function createDetailPanel() {
  // Create DOM structure once
  const overlay = document.createElement('div');
  overlay.className = 'panel-overlay';

  const panel = document.createElement('div');
  panel.className = 'detail-panel';
  panel.innerHTML = `
    <div class="panel-header">
      <h2 class="panel-title"></h2>
      <button class="panel-close" title="Close">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <div class="panel-body"></div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(panel);

  const titleEl = panel.querySelector('.panel-title');
  const bodyEl = panel.querySelector('.panel-body');
  const closeBtn = panel.querySelector('.panel-close');
  let closeCallback = null;

  function open(title, contentHtml) {
    titleEl.textContent = title;
    if (typeof contentHtml === 'string') {
      bodyEl.innerHTML = contentHtml;
    } else {
      bodyEl.innerHTML = '';
      bodyEl.appendChild(contentHtml);
    }
    panel.classList.add('open');
    overlay.classList.add('open');
  }

  function close() {
    panel.classList.remove('open');
    overlay.classList.remove('open');
    if (closeCallback) closeCallback();
  }

  function setBody(contentHtml) {
    if (typeof contentHtml === 'string') {
      bodyEl.innerHTML = contentHtml;
    } else {
      bodyEl.innerHTML = '';
      bodyEl.appendChild(contentHtml);
    }
  }

  function onClose(cb) {
    closeCallback = cb;
  }

  function getBodyEl() {
    return bodyEl;
  }

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', close);

  return { open, close, setBody, onClose, getBodyEl };
}
```

- [ ] **Step 2: Add panel CSS to `crm/css/app.css`**

Append the following at the end of `app.css`, before the `@media` responsive block:

```css
/* ═══════════════════════════════════════════════
   DETAIL PANEL (slide-in from right)
   ═══════════════════════════════════════════════ */

.panel-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.3);
  z-index: 30;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.25s var(--ease);
}

.panel-overlay.open {
  opacity: 1;
  pointer-events: auto;
}

.detail-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(520px, 90vw);
  background: #fff;
  z-index: 31;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg);
  transform: translateX(100%);
  transition: transform 0.3s var(--ease);
}

.detail-panel.open {
  transform: translateX(0);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid #E2E8F0;
  flex-shrink: 0;
}

.panel-title {
  font-family: var(--font-display);
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--black);
}

.panel-close {
  padding: 0.35rem;
  color: var(--gray-dark);
  border-radius: var(--radius-sm);
  transition: color var(--duration) var(--ease), background var(--duration) var(--ease);
}

.panel-close:hover {
  color: var(--black);
  background: #F1F5F9;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem;
}

/* --- Panel Tabs --- */

.panel-tabs {
  display: flex;
  border-bottom: 1px solid #E2E8F0;
  margin: 0 -1.5rem;
  padding: 0 1.5rem;
  flex-shrink: 0;
}

.panel-tab {
  padding: 0.75rem 1rem;
  font-size: 0.825rem;
  font-weight: 500;
  color: var(--gray-dark);
  border-bottom: 2px solid transparent;
  transition: color var(--duration) var(--ease), border-color var(--duration) var(--ease);
  margin-bottom: -1px;
}

.panel-tab:hover {
  color: var(--black);
}

.panel-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

/* --- Panel Form Fields --- */

.panel-field {
  margin-bottom: 1.25rem;
}

.panel-field-label {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--gray-dark);
  margin-bottom: 0.35rem;
}

.panel-field-value {
  font-size: 0.9rem;
  color: var(--off-black);
  padding: 0.4rem 0.5rem;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  min-height: 2.25rem;
  cursor: pointer;
  transition: border-color var(--duration) var(--ease), background var(--duration) var(--ease);
}

.panel-field-value:hover {
  border-color: #E2E8F0;
  background: #FAFBFC;
}

.panel-field-value.empty {
  color: var(--gray);
  font-style: italic;
}

/* --- Inline Edit Active State --- */

.panel-field-value.editing {
  border-color: var(--accent);
  background: #fff;
  cursor: text;
  box-shadow: 0 0 0 3px rgba(79,123,247,0.1);
}

.panel-field input,
.panel-field textarea,
.panel-field select {
  width: 100%;
  padding: 0.4rem 0.5rem;
  font-size: 0.9rem;
  color: var(--off-black);
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  outline: none;
  box-shadow: 0 0 0 3px rgba(79,123,247,0.1);
  background: #fff;
}

.panel-field textarea {
  resize: vertical;
  min-height: 4rem;
}

/* --- Save Flash --- */

.flash-success {
  animation: flashGreen 0.6s var(--ease);
}

.flash-error {
  animation: flashRed 0.6s var(--ease);
}

@keyframes flashGreen {
  0%   { background: rgba(52,211,153,0.2); }
  100% { background: transparent; }
}

@keyframes flashRed {
  0%   { background: rgba(248,113,113,0.2); }
  100% { background: transparent; }
}

/* --- Activity Timeline --- */

.activity-timeline {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.activity-item {
  display: flex;
  gap: 0.75rem;
  padding: 0.875rem 0;
  border-bottom: 1px solid #F1F5F9;
}

.activity-item:last-child {
  border-bottom: none;
}

.activity-icon {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 0.75rem;
}

.activity-icon.call     { background: var(--success-dim); color: #059669; }
.activity-icon.email    { background: var(--info-dim); color: var(--info); }
.activity-icon.meeting  { background: var(--warning-dim); color: #D97706; }
.activity-icon.note     { background: var(--accent-dim); color: var(--accent); }
.activity-icon.edit     { background: #F1F5F9; color: var(--gray-dark); }

.activity-body {
  flex: 1;
  min-width: 0;
}

.activity-desc {
  font-size: 0.85rem;
  color: var(--off-black);
  line-height: 1.5;
}

.activity-meta {
  font-size: 0.75rem;
  color: var(--gray);
  margin-top: 0.2rem;
}

.activity-diff {
  font-size: 0.8rem;
  color: var(--gray-dark);
  margin-top: 0.25rem;
  font-family: var(--font-mono);
}

/* --- Add Activity Form --- */

.add-activity-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  background: #FAFBFC;
  border: 1px solid #E2E8F0;
  border-radius: var(--radius-md);
  margin-bottom: 1rem;
}

.add-activity-form select,
.add-activity-form textarea {
  padding: 0.5rem 0.75rem;
  font-size: 0.85rem;
  border: 1px solid #E2E8F0;
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--off-black);
  outline: none;
}

.add-activity-form select:focus,
.add-activity-form textarea:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(79,123,247,0.1);
}

.add-activity-form textarea {
  resize: vertical;
  min-height: 3rem;
}

.add-activity-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}
```

- [ ] **Step 3: Verify panel opens and closes**

Temporarily in `app.html` script block, after imports:
```javascript
import { createDetailPanel } from './js/components/detail-panel.js';
const panel = createDetailPanel();
window._testPanel = panel; // expose for console testing
```
In browser console: `_testPanel.open('Test', '<p>Hello</p>')` — panel should slide in from right. Click overlay or X to close.

- [ ] **Step 4: Remove test code and commit**

Remove the test import. Commit:
```bash
git add crm/js/components/detail-panel.js crm/css/app.css
git commit -m "feat(crm): add reusable detail panel component with inline edit styles"
```

---

## Task 5: Inline Edit Component

**Files:**
- Create: `crm/js/components/inline-edit.js`

Turns a static field value into an editable input on click. Saves on Enter/blur, cancels on Escape.

- [ ] **Step 1: Create `crm/js/components/inline-edit.js`**

```javascript
/**
 * Make a .panel-field-value element inline-editable.
 *
 * @param {HTMLElement} el - the .panel-field-value element
 * @param {object} opts
 * @param {string} opts.field - field name (for activity log)
 * @param {string} opts.type - "text", "email", "tel", "textarea", "date", "number"
 * @param {string} opts.value - current value
 * @param {function} opts.onSave - async (newValue, oldValue) => void — called on save
 */
export function makeEditable(el, { field, type = 'text', value = '', onSave }) {
  if (el.dataset.editBound) return;
  el.dataset.editBound = 'true';

  // Display the current value
  setDisplay(el, value, type);

  el.addEventListener('click', () => {
    if (el.classList.contains('editing')) return;
    startEdit(el, { field, type, value: el.dataset.currentValue || value, onSave });
  });
}

function setDisplay(el, value, type) {
  el.dataset.currentValue = value || '';
  if (!value && value !== 0) {
    el.textContent = 'Click to add...';
    el.classList.add('empty');
  } else {
    if (type === 'number') {
      el.textContent = formatNumber(value);
    } else if (type === 'date') {
      el.textContent = formatDateDisplay(value);
    } else {
      el.textContent = value;
    }
    el.classList.remove('empty');
  }
}

function startEdit(el, { field, type, value, onSave }) {
  const oldValue = value;
  el.classList.add('editing');
  el.innerHTML = '';

  let input;
  if (type === 'textarea') {
    input = document.createElement('textarea');
    input.rows = 3;
  } else {
    input = document.createElement('input');
    input.type = type === 'date' ? 'date' : type === 'number' ? 'number' : type;
    if (type === 'number') input.step = '0.01';
  }

  if (type === 'date' && value) {
    // Convert to YYYY-MM-DD for date input
    try {
      const d = value.toDate ? value.toDate() : new Date(value);
      input.value = d.toISOString().split('T')[0];
    } catch {
      input.value = '';
    }
  } else {
    input.value = value || '';
  }

  el.appendChild(input);
  input.focus();
  input.select();

  async function save() {
    const newValue = type === 'number' ? parseFloat(input.value) || 0 : input.value.trim();
    el.classList.remove('editing');
    el.innerHTML = '';

    if (String(newValue) !== String(oldValue)) {
      try {
        await onSave(newValue, oldValue);
        el.dataset.currentValue = newValue;
        setDisplay(el, newValue, type);
        el.classList.add('flash-success');
        setTimeout(() => el.classList.remove('flash-success'), 600);
      } catch (err) {
        console.error('Inline edit save failed:', err);
        setDisplay(el, oldValue, type);
        el.classList.add('flash-error');
        setTimeout(() => el.classList.remove('flash-error'), 600);
      }
    } else {
      setDisplay(el, oldValue, type);
    }
  }

  function cancel() {
    el.classList.remove('editing');
    el.innerHTML = '';
    setDisplay(el, oldValue, type);
  }

  input.addEventListener('blur', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && type !== 'textarea') {
      e.preventDefault();
      input.removeEventListener('blur', save);
      save();
    }
    if (e.key === 'Escape') {
      input.removeEventListener('blur', save);
      cancel();
    }
  });
}

function formatNumber(val) {
  const num = parseFloat(val);
  if (isNaN(num)) return val;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
}

function formatDateDisplay(val) {
  if (!val) return '';
  try {
    const d = val.toDate ? val.toDate() : new Date(val);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add crm/js/components/inline-edit.js
git commit -m "feat(crm): add inline edit component with save/cancel/flash feedback"
```

---

## Task 6: Searchable Dropdown Component

**Files:**
- Create: `crm/js/components/dropdown.js`
- Modify: `crm/css/app.css` (append dropdown styles)

A dropdown that searches existing companies or contacts. Used when linking a contact to a company or a deal to a contact.

- [ ] **Step 1: Create `crm/js/components/dropdown.js`**

```javascript
/**
 * Create a searchable dropdown for picking from a list.
 *
 * @param {object} opts
 * @param {function} opts.fetchItems - async () => [{ id, label, sublabel? }]
 * @param {function} opts.onSelect - (item) => void
 * @param {function} opts.onCreate - (searchText) => void — called when "Create new" is clicked
 * @param {string} opts.placeholder - input placeholder text
 * @returns {HTMLElement} the dropdown container element
 */
export function createDropdown({ fetchItems, onSelect, onCreate, placeholder = 'Search...' }) {
  const container = document.createElement('div');
  container.className = 'dropdown-search';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'dropdown-input';
  input.placeholder = placeholder;

  const list = document.createElement('div');
  list.className = 'dropdown-list';
  list.style.display = 'none';

  container.appendChild(input);
  container.appendChild(list);

  let items = [];
  let isOpen = false;

  async function loadItems() {
    items = await fetchItems();
    renderList('');
  }

  function renderList(filter) {
    const lower = filter.toLowerCase();
    const filtered = items.filter(item =>
      item.label.toLowerCase().includes(lower) ||
      (item.sublabel && item.sublabel.toLowerCase().includes(lower))
    );

    list.innerHTML = '';

    filtered.forEach(item => {
      const row = document.createElement('div');
      row.className = 'dropdown-item';
      row.innerHTML = `
        <div class="dropdown-item-label">${escapeHtml(item.label)}</div>
        ${item.sublabel ? `<div class="dropdown-item-sub">${escapeHtml(item.sublabel)}</div>` : ''}
      `;
      row.addEventListener('click', () => {
        onSelect(item);
        close();
      });
      list.appendChild(row);
    });

    if (onCreate && filter.trim()) {
      const createRow = document.createElement('div');
      createRow.className = 'dropdown-item dropdown-create';
      createRow.innerHTML = `<div class="dropdown-item-label">+ Create "${escapeHtml(filter.trim())}"</div>`;
      createRow.addEventListener('click', () => {
        onCreate(filter.trim());
        close();
      });
      list.appendChild(createRow);
    }

    if (filtered.length === 0 && !filter.trim()) {
      const empty = document.createElement('div');
      empty.className = 'dropdown-empty';
      empty.textContent = 'No items found';
      list.appendChild(empty);
    }
  }

  function open() {
    list.style.display = 'block';
    isOpen = true;
    loadItems();
  }

  function close() {
    list.style.display = 'none';
    isOpen = false;
    input.value = '';
  }

  input.addEventListener('focus', open);
  input.addEventListener('input', () => renderList(input.value));

  // Close on click outside
  document.addEventListener('click', (e) => {
    if (isOpen && !container.contains(e.target)) {
      close();
    }
  });

  return container;
}

function escapeHtml(str) {
  if (!str) return '';
  const node = document.createElement('span');
  node.appendChild(document.createTextNode(str));
  return node.innerHTML;
}
```

- [ ] **Step 2: Add dropdown CSS to `crm/css/app.css`**

Append before the responsive `@media` block:

```css
/* ═══════════════════════════════════════════════
   SEARCHABLE DROPDOWN
   ═══════════════════════════════════════════════ */

.dropdown-search {
  position: relative;
}

.dropdown-input {
  width: 100%;
  padding: 0.5rem 0.75rem;
  font-size: 0.85rem;
  border: 1px solid #E2E8F0;
  border-radius: var(--radius-sm);
  outline: none;
  background: #fff;
  color: var(--off-black);
}

.dropdown-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(79,123,247,0.1);
}

.dropdown-list {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  max-height: 200px;
  overflow-y: auto;
  background: #fff;
  border: 1px solid #E2E8F0;
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-md);
  z-index: 40;
  margin-top: 0.25rem;
}

.dropdown-item {
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  transition: background var(--duration) var(--ease);
}

.dropdown-item:hover {
  background: #F1F5F9;
}

.dropdown-item-label {
  font-size: 0.85rem;
  color: var(--off-black);
}

.dropdown-item-sub {
  font-size: 0.75rem;
  color: var(--gray);
}

.dropdown-create .dropdown-item-label {
  color: var(--accent);
  font-weight: 500;
}

.dropdown-empty {
  padding: 0.75rem;
  text-align: center;
  font-size: 0.8rem;
  color: var(--gray);
}
```

- [ ] **Step 3: Commit**

```bash
git add crm/js/components/dropdown.js crm/css/app.css
git commit -m "feat(crm): add searchable dropdown component for entity linking"
```

---

## Task 7: Contacts View — Table & Card Modes

**Files:**
- Create: `crm/js/views/contacts.js`
- Modify: `crm/app.html` (replace contacts placeholder, register view)
- Modify: `crm/css/app.css` (append contacts-specific styles)

This is the main contacts view: top bar with search/toggle/add, table mode, card mode.

- [ ] **Step 1: Add contacts view CSS to `crm/css/app.css`**

Append before the responsive `@media` block:

```css
/* ═══════════════════════════════════════════════
   VIEW TOP BAR
   ═══════════════════════════════════════════════ */

.view-topbar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
}

.view-topbar .search-input {
  flex: 1;
  min-width: 200px;
  padding: 0.55rem 1rem;
  padding-left: 2.25rem;
  font-size: 0.85rem;
  border: 1px solid #E2E8F0;
  border-radius: var(--radius-sm);
  outline: none;
  background: #fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'/%3E%3C/svg%3E") no-repeat 0.75rem center;
  color: var(--off-black);
}

.view-topbar .search-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(79,123,247,0.1);
}

.view-toggle {
  display: inline-flex;
  border: 1px solid #E2E8F0;
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.view-toggle button {
  padding: 0.45rem 0.75rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--gray-dark);
  background: #fff;
  border: none;
  border-right: 1px solid #E2E8F0;
  transition: background var(--duration) var(--ease), color var(--duration) var(--ease);
}

.view-toggle button:last-child {
  border-right: none;
}

.view-toggle button:hover {
  background: #F8FAFC;
}

.view-toggle button.active {
  background: var(--accent);
  color: #fff;
}

/* ═══════════════════════════════════════════════
   CARD GRID
   ═══════════════════════════════════════════════ */

.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1rem;
}

.contact-card {
  background: #fff;
  border: 1px solid #E2E8F0;
  border-radius: var(--radius-md);
  padding: 1.25rem;
  cursor: pointer;
  transition: box-shadow var(--duration) var(--ease), border-color var(--duration) var(--ease);
}

.contact-card:hover {
  box-shadow: var(--shadow-md);
  border-color: #CBD5E1;
}

.contact-card-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.contact-card-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--accent-dim);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  font-weight: 600;
  flex-shrink: 0;
}

.contact-card-name {
  font-size: 0.95rem;
  font-weight: 500;
  color: var(--black);
}

.contact-card-title {
  font-size: 0.8rem;
  color: var(--gray-dark);
}

.contact-card-detail {
  font-size: 0.8rem;
  color: var(--gray-dark);
  padding: 0.15rem 0;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ═══════════════════════════════════════════════
   TABLE CLICKABLE ROWS
   ═══════════════════════════════════════════════ */

.data-table tbody tr.clickable {
  cursor: pointer;
}

.data-table thead th.sortable {
  cursor: pointer;
  user-select: none;
}

.data-table thead th.sortable:hover {
  color: var(--accent);
}

.data-table thead th .sort-icon {
  display: inline-block;
  margin-left: 0.25rem;
  font-size: 0.6rem;
  opacity: 0.5;
}

.data-table thead th.sort-active .sort-icon {
  opacity: 1;
  color: var(--accent);
}
```

- [ ] **Step 2: Create `crm/js/views/contacts.js`**

```javascript
import { queryDocuments, addDocument, updateDocument, deleteDocument, queryDocumentsWhere } from '../services/firestore.js';
import { addActivity, logFieldEdit, getActivity } from '../services/activity.js';
import { createDetailPanel } from '../components/detail-panel.js';
import { makeEditable } from '../components/inline-edit.js';
import { createDropdown } from '../components/dropdown.js';
import { showToast, escapeHtml, timeAgo, formatCurrency } from '../ui.js';

let contacts = [];
let companies = [];
let currentMode = 'table'; // 'table' or 'cards'
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

// ── Data ─────────────────────────────────────

async function loadData() {
  [contacts, companies] = await Promise.all([
    queryDocuments('contacts', 'lastName', 'asc'),
    queryDocuments('companies', 'name', 'asc')
  ]);
}

// ── Top-level render ─────────────────────────

function renderView() {
  const container = document.getElementById('view-contacts');
  container.innerHTML = '';

  // Top bar
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

  // Search handler
  const searchInput = topbar.querySelector('.search-input');
  searchInput.addEventListener('input', (e) => {
    searchTerm = e.target.value.trim();
    renderContent(container);
  });

  // Toggle handler
  topbar.querySelectorAll('.view-toggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      currentMode = btn.dataset.mode;
      topbar.querySelectorAll('.view-toggle button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderContent(container);
    });
  });

  // Add contact handler
  topbar.querySelector('#addContactBtn').addEventListener('click', () => openCreatePanel());

  // Content area
  renderContent(container);
}

function renderContent(container) {
  // Remove previous content (but not topbar)
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

// ── Filtering & Sorting ──────────────────────

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

// ── Table mode ───────────────────────────────

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

  // Header
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

  // Body
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
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  return table;
}

// ── Card mode ────────────────────────────────

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

// ── Create Panel ─────────────────────────────

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

  // Company dropdown
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

// ── Detail Panel ─────────────────────────────

async function openDetailPanel(contact) {
  const content = document.createElement('div');
  let activeTab = 'details';

  function renderPanelContent() {
    content.innerHTML = '';

    // Tabs
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

    // Delete button
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
        // Update local contacts array
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
  // Add activity button + form
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

    // Re-render activity list
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
```

Note: The contacts view also includes a `openCompanyPanel(companyId)` function. When a company name is clicked in the table or card, it opens a company detail panel showing the company info (inline-editable), linked contacts, and linked deals. Add this function at the bottom of `contacts.js`:

```javascript
// ── Company Detail Panel ─────────────────────

async function openCompanyPanel(company) {
  const content = document.createElement('div');

  // Editable company fields
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
        // If name changed, update denormalized names on linked contacts and deals
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

  // Address (simplified as single text field for now)
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
      // Parse simple comma-separated address
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

  // Linked deals (query by companyId)
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
```

Also update `renderTable` and `renderCards` so that clicking a company name in the table/card opens the company panel instead of the contact detail. In the table, make the company cell a clickable link:

In `renderTable`, change the company `<td>` to:
```javascript
const companyTd = tr.querySelectorAll('td')[1];
if (contact.companyId) {
  companyTd.style.cssText = 'color:var(--accent);cursor:pointer;';
  companyTd.addEventListener('click', (e) => {
    e.stopPropagation();
    const company = companies.find(c => c.id === contact.companyId);
    if (company) openCompanyPanel(company);
  });
}
```

In `renderCards`, similarly make the company name clickable with `e.stopPropagation()`.

- [ ] **Step 3: Update `crm/app.html` — replace contacts placeholder and register view**

Replace the contacts view container in `app.html`:

Find this block:
```html
      <!-- Contacts -->
      <div id="view-contacts" class="view-container">
        <div class="empty-state">
          ...Phase 2 placeholder...
        </div>
      </div>
```

Replace with:
```html
      <!-- Contacts -->
      <div id="view-contacts" class="view-container"></div>
```

Then in the `<script type="module">` block, add the import and update the view registration:

Add import at top:
```javascript
import * as contactsView from './js/views/contacts.js';
```

Replace the contacts entry inside the `Object.keys(viewTitles).forEach` loop by registering it separately AFTER the loop:

```javascript
registerView('contacts', {
  init: contactsView.init,
  render: contactsView.render,
  destroy: contactsView.destroy
});
```

And remove `'contacts'` from the `viewTitles` object (keep the rest). Instead, set the header title inside the contacts view render. Actually, simpler: keep contacts in viewTitles for the header title, but override the registration:

After the existing `Object.keys(viewTitles).forEach(...)` block, add:
```javascript
// Override contacts with full view logic
registerView('contacts', {
  init: contactsView.init,
  render() {
    document.getElementById('headerTitle').textContent = 'Contacts';
    contactsView.render();
  },
  destroy: contactsView.destroy
});
```

- [ ] **Step 4: Verify in browser**

Deploy to Cloudflare. Navigate to Contacts view:
- Should see "No contacts yet" empty state
- Click "Add Contact" — panel should slide in with form
- Fill in first/last name, save — contact should appear in table
- Toggle to card view — same contact appears as a card
- Click contact — detail panel opens with editable fields
- Click a field value, change it, press Enter — green flash, value saved
- Switch to Activity tab — should show the edit entry

- [ ] **Step 5: Commit**

```bash
git add crm/js/views/contacts.js crm/app.html crm/css/app.css
git commit -m "feat(crm): add contacts view with table, cards, detail panel, and activity log"
```

---

## Task 8: Pipeline View — Kanban & Table Modes

**Files:**
- Create: `crm/js/views/pipeline.js`
- Modify: `crm/app.html` (replace pipeline placeholder, register view)
- Modify: `crm/css/app.css` (append kanban styles)

- [ ] **Step 1: Add kanban and pipeline CSS to `crm/css/app.css`**

Append before the responsive `@media` block:

```css
/* ═══════════════════════════════════════════════
   KANBAN BOARD
   ═══════════════════════════════════════════════ */

.kanban-board {
  display: flex;
  gap: 1rem;
  overflow-x: auto;
  padding-bottom: 1rem;
  min-height: 400px;
}

.kanban-column {
  flex: 0 0 280px;
  background: #F8FAFC;
  border: 1px solid #E2E8F0;
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 200px);
}

.kanban-column-header {
  padding: 1rem;
  border-bottom: 1px solid #E2E8F0;
  flex-shrink: 0;
}

.kanban-column-title {
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--off-black);
  margin-bottom: 0.25rem;
}

.kanban-column-meta {
  font-size: 0.75rem;
  color: var(--gray);
}

.kanban-column-body {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.kanban-column-body.drag-over {
  background: var(--accent-dim);
}

/* --- Deal Cards in Kanban --- */

.deal-card {
  background: #fff;
  border: 1px solid #E2E8F0;
  border-radius: var(--radius-sm);
  padding: 0.875rem;
  cursor: grab;
  transition: box-shadow var(--duration) var(--ease), border-color var(--duration) var(--ease);
}

.deal-card:hover {
  box-shadow: var(--shadow-sm);
  border-color: #CBD5E1;
}

.deal-card.dragging {
  opacity: 0.5;
  box-shadow: var(--shadow-md);
}

.deal-card-name {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--black);
  margin-bottom: 0.35rem;
}

.deal-card-value {
  font-family: var(--font-display);
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--accent);
  margin-bottom: 0.35rem;
}

.deal-card-meta {
  font-size: 0.75rem;
  color: var(--gray);
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

/* --- Pipeline stage badges (extend existing) --- */

.badge-status.qualified {
  background: rgba(79,123,247,0.12);
  color: var(--accent);
}

.badge-status.won {
  background: var(--success-dim);
  color: #059669;
}

/* --- Pipeline Settings Modal --- */

.pipeline-settings {
  background: #fff;
  border: 1px solid #E2E8F0;
  border-radius: var(--radius-md);
  padding: 1.5rem;
  max-width: 400px;
}

.stage-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.stage-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: #FAFBFC;
  border: 1px solid #E2E8F0;
  border-radius: var(--radius-sm);
}

.stage-item .drag-handle {
  cursor: grab;
  color: var(--gray-light);
  font-size: 1rem;
}

.stage-item input {
  flex: 1;
  border: none;
  background: transparent;
  font-size: 0.85rem;
  color: var(--off-black);
  outline: none;
  padding: 0.2rem;
}

.stage-item input:focus {
  background: #fff;
  border-radius: var(--radius-sm);
  box-shadow: 0 0 0 2px rgba(79,123,247,0.15);
}

.stage-item .stage-lock {
  font-size: 0.7rem;
  color: var(--gray);
  font-style: italic;
}

.stage-item .btn-remove-stage {
  color: var(--gray-light);
  padding: 0.2rem;
  border-radius: var(--radius-sm);
  transition: color var(--duration) var(--ease);
}

.stage-item .btn-remove-stage:hover {
  color: var(--danger);
}
```

- [ ] **Step 2: Create `crm/js/views/pipeline.js`**

```javascript
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
  await loadData();
  renderView();
}

export function destroy() {}

// ── Data ─────────────────────────────────────

async function loadData() {
  const [dealsData, contactsData, companiesData, stagesDoc] = await Promise.all([
    queryDocuments('deals', 'createdAt', 'desc'),
    queryDocuments('contacts', 'lastName', 'asc'),
    queryDocuments('companies', 'name', 'asc'),
    getDocument('settings', 'pipeline')
  ]);
  deals = dealsData;
  contacts = contactsData;
  companies = companiesData;
  if (stagesDoc && stagesDoc.stages) {
    stages = stagesDoc.stages;
  }
}

// ── Top-level render ─────────────────────────

function renderView() {
  const container = document.getElementById('view-pipeline');
  container.innerHTML = '';

  // Top bar
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

  // Event handlers
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

// ── Filtering ────────────────────────────────

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

// ── Kanban mode ──────────────────────────────

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

    // Drag and drop
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

// ── Table mode ───────────────────────────────

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

// ── Create Panel ─────────────────────────────

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

    // Find the contact's company
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

// ── Detail Panel ─────────────────────────────

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

    // Delete
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
  // Simple editable fields
  const textFields = [
    { key: 'name', label: 'Deal Name', type: 'text' },
    { key: 'value', label: 'Value', type: 'number' },
    { key: 'expectedClose', label: 'Expected Close', type: 'date' },
    { key: 'notes', label: 'Notes', type: 'textarea' }
  ];

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

// ── Pipeline Settings ────────────────────────

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

        // Drag reorder
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

      // Remove handlers
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

      // Rename handlers
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
      // Read final labels from inputs
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

// Note: db is imported at the top of file via config.js
```

- [ ] **Step 3: Update `crm/app.html` — replace pipeline placeholder and register view**

Replace the pipeline view container:

Find:
```html
      <!-- Pipeline -->
      <div id="view-pipeline" class="view-container">
        <div class="empty-state">
          ...Phase 2 placeholder...
        </div>
      </div>
```

Replace with:
```html
      <!-- Pipeline -->
      <div id="view-pipeline" class="view-container"></div>
```

In the `<script type="module">` block, add the import:
```javascript
import * as pipelineView from './js/views/pipeline.js';
```

After the existing contacts override, add:
```javascript
// Override pipeline with full view logic
registerView('pipeline', {
  init: pipelineView.init,
  render() {
    document.getElementById('headerTitle').textContent = 'Pipeline';
    pipelineView.render();
  },
  destroy: pipelineView.destroy
});
```

- [ ] **Step 4: Verify in browser**

Deploy to Cloudflare. Navigate to Pipeline view:
- Should see "No deals yet" empty state
- Click "Add Deal" — form appears with stage dropdown defaulting to Lead
- Create a deal — appears in kanban Lead column
- Drag deal card to Qualified column — stage updates, toast shows
- Toggle to table view — same deal in table with stage badge
- Click deal — detail panel opens, fields are editable
- Click gear icon — pipeline settings panel shows stages
- Change stage order, save — kanban columns reorder

- [ ] **Step 5: Commit**

```bash
git add crm/js/views/pipeline.js crm/app.html crm/css/app.css
git commit -m "feat(crm): add pipeline view with kanban, table, deal detail, and stage settings"
```

---

## Task 9: Wire Up Dashboard Stats

**Files:**
- Modify: `crm/app.html` (update dashboard to show real counts)

Connect the dashboard stat cards to actual Firestore data.

- [ ] **Step 1: Update the dashboard view registration in `app.html`**

Add import at top of script block:
```javascript
import { queryDocuments } from './js/services/firestore.js';
import { formatCurrency as fmtCurrency } from './js/ui.js';
```

Replace the dashboard registration (add it after the loop, before the contacts override):
```javascript
// Override dashboard with live stats
registerView('dashboard', {
  async render() {
    document.getElementById('headerTitle').textContent = 'Dashboard';
    try {
      const [contactsList, dealsList] = await Promise.all([
        queryDocuments('contacts'),
        queryDocuments('deals')
      ]);
      document.getElementById('statContacts').textContent = contactsList.length;

      const activeDeals = dealsList.filter(d => d.stage !== 'won' && d.stage !== 'lost');
      document.getElementById('statProjects').textContent = activeDeals.length;

      // Open tasks placeholder — will be wired in Phase 3
      document.getElementById('statTasks').textContent = '0';

      const wonDeals = dealsList.filter(d => d.stage === 'won');
      const revenue = wonDeals.reduce((sum, d) => sum + (d.value || 0), 0);
      document.getElementById('statRevenue').textContent = fmtCurrency(revenue);
    } catch (err) {
      console.error('Dashboard stats error:', err);
    }
  }
});
```

- [ ] **Step 2: Verify in browser**

Navigate to Dashboard:
- "Total Contacts" should show the count of contacts you've added
- "Active Projects" should show deals that aren't Won/Lost
- "Revenue MTD" should show the sum of Won deal values

- [ ] **Step 3: Commit**

```bash
git add crm/app.html
git commit -m "feat(crm): wire dashboard stats to live Firestore data"
```

---

## Task 10: Add `.gitignore` Entry and Final Cleanup

**Files:**
- Modify: `.gitignore` (add `.superpowers/`)
- Modify: `crm/css/app.css` (add responsive styles for new components)

- [ ] **Step 1: Add `.superpowers/` to `.gitignore`**

Append to the project's `.gitignore`:
```
.superpowers/
```

- [ ] **Step 2: Add responsive CSS for new components**

Add inside the existing `@media (max-width: 768px)` block in `app.css`:

```css
  .view-topbar {
    flex-direction: column;
    align-items: stretch;
  }

  .view-topbar .search-input {
    min-width: 100%;
  }

  .view-topbar .view-toggle {
    align-self: flex-start;
  }

  .kanban-board {
    flex-direction: column;
  }

  .kanban-column {
    flex: none;
    width: 100%;
    max-height: none;
  }

  .detail-panel {
    width: 100vw;
  }

  .card-grid {
    grid-template-columns: 1fr;
  }
```

- [ ] **Step 3: Commit**

```bash
git add .gitignore crm/css/app.css
git commit -m "chore: add responsive styles for Phase 2 and gitignore .superpowers"
```

---

## Summary

| Task | What it delivers |
|------|-----------------|
| 1 | Firestore CRUD service layer with auto audit fields |
| 2 | Activity log service (subcollection read/write) |
| 3 | Updated Firestore security rules |
| 4 | Reusable slide-in detail panel + all panel CSS |
| 5 | Inline edit component with save/cancel/flash |
| 6 | Searchable dropdown for entity linking |
| 7 | Contacts view: table, cards, create, detail, activity, company panel |
| 8 | Pipeline view: kanban, table, drag-drop, deal detail, stage settings |
| 9 | Dashboard wired to live Firestore stats |
| 10 | Responsive styles + gitignore cleanup |
