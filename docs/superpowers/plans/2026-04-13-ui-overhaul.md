# UI Overhaul: Contacts & Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete visual redesign of contacts and pipeline content areas — centered modals for creation, full detail pages for editing, polished tables/cards/kanban, premium feel throughout.

**Architecture:** Replace the slide-in detail panel with two new patterns: (1) a centered modal component for create flows, (2) inline detail pages that replace the list view when clicking a record. Both contacts.js and pipeline.js are full rewrites. Major CSS additions to app.css. The router and app.html need minimal changes — detail pages render inside the existing view containers, toggling between list and detail mode internally.

**Tech Stack:** Vanilla HTML/CSS/JS, Firebase SDK via CDN, existing design system (variables.css).

---

## Task 1: Create Modal Component + CSS Foundation

**Files:**
- Create: `crm/js/components/modal.js`
- Modify: `crm/css/app.css` — replace all Phase 2 content-area CSS with new premium styles

The modal component is a centered overlay dialog used for Create Contact and Create Deal forms. The CSS overhaul replaces all the old content-area styles (tables, cards, topbar, panels, kanban, etc.) with the new premium design system.

This is the foundation task — everything else depends on it.

- [ ] **Step 1: Create `crm/js/components/modal.js`**

A reusable centered modal with backdrop blur, scale-in animation, and Escape/click-outside closing.

```javascript
/**
 * Centered modal dialog with backdrop blur.
 *
 * Usage:
 *   const modal = createModal();
 *   modal.open('Title', contentElement);
 *   modal.close();
 */
export function createModal() {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog';
  dialog.innerHTML = `
    <div class="modal-header">
      <h2 class="modal-title"></h2>
      <button class="modal-close" title="Close" type="button">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <div class="modal-body"></div>
  `;

  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  const titleEl = dialog.querySelector('.modal-title');
  const bodyEl = dialog.querySelector('.modal-body');
  const closeBtn = dialog.querySelector('.modal-close');
  let onCloseCallback = null;

  function open(title, content) {
    titleEl.textContent = title;
    bodyEl.innerHTML = '';
    if (typeof content === 'string') {
      bodyEl.innerHTML = content;
    } else {
      bodyEl.appendChild(content);
    }
    backdrop.classList.add('open');
    // Prevent body scroll
    document.body.style.overflow = 'hidden';
  }

  function close() {
    backdrop.classList.remove('open');
    document.body.style.overflow = '';
    if (onCloseCallback) onCloseCallback();
  }

  function onClose(cb) { onCloseCallback = cb; }
  function getBody() { return bodyEl; }

  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && backdrop.classList.contains('open')) close();
  });

  return { open, close, onClose, getBody };
}
```

- [ ] **Step 2: Major CSS overhaul of `crm/css/app.css`**

This is the biggest CSS change. Read the current `app.css`. All the CSS that was added in Phase 2 (everything between the SCROLLBAR section and the `@media` block) needs to be replaced with the new premium styles. The new CSS covers:

**Modal styles:** `.modal-backdrop` with backdrop-filter blur, `.modal-dialog` centered with scale animation, `.modal-header`, `.modal-body`, form layout with `.modal-form-grid` for two-column fields, `.modal-field` with tall 48px inputs, `.modal-actions` with full-width primary button and cancel link.

**Polished table:** Remove inter-row borders, add alternating row backgrounds, increase padding to `1rem 1.5rem`, name column gets inline avatar + stacked name/company, table container gets `border-radius: 12px` and soft shadow, cleaner sort chevrons.

**Polished cards:** Remove hard border, use soft multi-layer shadow, `border-radius: 12px`, `padding: 1.5rem`, hover lift with `translateY(-2px)`, larger avatar 48px, small inline icons for contact details.

**Polished top bar:** Taller search input 44px with `border-radius: 10px`, pill-shaped segmented view toggle, larger add button 44px.

**Detail page:** `.detail-header` with large avatar 64px + name in display font + back link, `.detail-layout` two-column grid (60/40), `.detail-fields` grid of editable field rows with subtle dividers, `.detail-timeline` with vertical connector line + entry cards with shadows, `.activity-composer` always-visible form.

**Polished kanban:** Shadow-based cards, cleaner column headers, dashed border drop zones, deal value in accent color.

**Polished empty states:** Larger 80px icons, gradient circle decoration behind icon, display font titles at 1.5rem.

**Updated responsive:** Mobile overrides for all new components.

The exact CSS is ~500 lines. The subagent implementing this task should write the complete CSS based on these specifications and the existing design tokens from `variables.css`.

- [ ] **Step 3: Commit**

```bash
git add crm/js/components/modal.js crm/css/app.css
git commit -m "feat(crm): add modal component and premium CSS overhaul"
```

---

## Task 2: Rewrite Contacts View

**Files:**
- Modify: `crm/js/views/contacts.js` — complete rewrite

The contacts view gets three modes: **list** (table/cards), **create** (modal), and **detail** (full page). All render inside the same `#view-contacts` container. The view tracks its own state (`currentPage`: `'list'` or `'detail'`).

Key changes from the old version:
- `import { createModal } from '../components/modal.js'` replaces `import { createDetailPanel }`
- `openCreatePanel()` → uses `createModal()` with two-column form grid
- `openDetailPanel(contact)` → replaced by `showDetailPage(contact)` which renders a full page layout inside `#view-contacts` with back button, field grid (left), activity timeline (right)
- `renderTable()` → name column now renders avatar + stacked name/company in a single cell
- `renderCards()` → uses new shadow-based card styling with small inline icons
- `openCompanyPanel()` → now renders as a detail page too (not a slide-in)
- Activity tab → always-visible composer at top, entries in card format with vertical line

The complete rewrite is ~700 lines. The subagent should write the full file preserving all existing functionality (search, sort, filter, inline edit, activity log, company panel) while applying the new UI patterns.

- [ ] **Step 1: Rewrite `crm/js/views/contacts.js`**

Key structural changes:

```javascript
import { createModal } from '../components/modal.js';
// Remove: import { createDetailPanel }

let currentPage = 'list'; // 'list' or 'detail'
let modal = null;

export function init() {
  modal = createModal();
}

export async function render() {
  try { await loadData(); } catch (err) { console.error(err); }
  if (currentPage === 'list') {
    renderListView();
  }
  // detail page is rendered by showDetailPage()
}

export function destroy() {
  currentPage = 'list'; // reset when navigating away
}
```

Create flow uses modal:
```javascript
function openCreateModal() {
  const form = document.createElement('div');
  form.innerHTML = `
    <form id="createContactForm" class="modal-form">
      <div class="modal-form-grid">
        <div class="modal-field">
          <label>First Name *</label>
          <input type="text" name="firstName" required placeholder="First name">
        </div>
        <div class="modal-field">
          <label>Last Name *</label>
          <input type="text" name="lastName" required placeholder="Last name">
        </div>
      </div>
      <!-- ... more fields in grid layout ... -->
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary btn-lg">Create Contact</button>
        <button type="button" class="modal-cancel" onclick="...">Cancel</button>
      </div>
    </form>
  `;
  modal.open('New Contact', form);
}
```

Detail page replaces list:
```javascript
function showDetailPage(contact) {
  currentPage = 'detail';
  const container = document.getElementById('view-contacts');
  container.innerHTML = '';
  
  // Back link
  const backLink = document.createElement('button');
  backLink.className = 'detail-back';
  backLink.innerHTML = '← Back to Contacts';
  backLink.addEventListener('click', () => { currentPage = 'list'; renderListView(); });
  
  // Header: large avatar + name + actions
  // Two-column layout: fields left, activity right
  // Render into container
}
```

- [ ] **Step 2: Verify in browser**

Navigate to Contacts:
- Empty state should look warmer with bigger icon
- Click "Add Contact" → centered modal with blur backdrop
- Fill form and save → contact appears in polished table
- Toggle to cards → shadow-based card with hover lift
- Click contact → full detail page with two-column layout
- Edit a field inline → green flash
- Activity timeline visible on right side
- Click "Back to Contacts" → returns to list

- [ ] **Step 3: Commit**

```bash
git add crm/js/views/contacts.js
git commit -m "feat(crm): rewrite contacts view with modal create and detail page"
```

---

## Task 3: Rewrite Pipeline View

**Files:**
- Modify: `crm/js/views/pipeline.js` — complete rewrite

Same pattern as contacts: list (kanban/table), create (modal), detail (full page). Same state management with `currentPage`.

Key changes:
- Uses `createModal` for create deal and pipeline settings
- `openDetailPanel(deal)` → `showDealDetail(deal)` full page
- Deal detail page: stage selector as pill buttons at the top, field grid left, activity right
- Kanban cards get shadow treatment, drag states improved
- Pipeline settings uses modal instead of slide-in panel

- [ ] **Step 1: Rewrite `crm/js/views/pipeline.js`**

Same structural pattern as contacts:
```javascript
import { createModal } from '../components/modal.js';
// Remove: import { createDetailPanel }

let currentPage = 'list';
let modal = null;

export function init() { modal = createModal(); }
```

Deal detail page adds stage pill selector:
```javascript
function renderStagePills(container, deal) {
  const pills = document.createElement('div');
  pills.className = 'stage-pills';
  stages.forEach(s => {
    const pill = document.createElement('button');
    pill.className = 'stage-pill' + (deal.stage === s.id ? ' active' : '');
    pill.textContent = s.label;
    pill.addEventListener('click', async () => {
      // change stage, log activity, update UI
    });
    pills.appendChild(pill);
  });
  container.appendChild(pills);
}
```

- [ ] **Step 2: Verify in browser**

Navigate to Pipeline:
- Kanban columns with shadow-based deal cards
- Drag and drop works with improved visual feedback
- Click "Add Deal" → centered modal
- Click a deal card → full detail page with stage pills
- Table view has same polish as contacts table
- Pipeline settings gear → modal with stage management

- [ ] **Step 3: Commit**

```bash
git add crm/js/views/pipeline.js
git commit -m "feat(crm): rewrite pipeline view with modal create and detail page"
```

---

## Task 4: Clean Up and Final Polish

**Files:**
- Modify: `crm/app.html` — update dashboard empty state styling
- Delete or keep: `crm/js/components/detail-panel.js` — no longer imported by any view

- [ ] **Step 1: Update dashboard empty state in `app.html`**

The dashboard "Welcome to your CRM" empty state should match the new warmer style. Update the SVG icon size to 80px, add the `empty-state-modern` class (from the new CSS), and update the button to match the new larger button style.

- [ ] **Step 2: Remove detail-panel.js import from app.html if present**

Check `app.html` script block — if `detail-panel.js` is imported directly, remove it. Views now use `modal.js` instead.

- [ ] **Step 3: Verify full flow**

Test the complete flow:
- Dashboard → polished empty state → click "Add First Contact" → modal
- Contacts list → table and cards polished → click contact → detail page
- Back to contacts → pipeline → kanban polished → add deal → modal
- Deal detail → stage pills → activity timeline → back to pipeline

- [ ] **Step 4: Commit**

```bash
git add crm/app.html
git commit -m "chore(crm): update dashboard empty state and clean up imports"
```

---

## Summary

| Task | What it delivers |
|------|-----------------|
| 1 | Modal component + complete CSS premium overhaul (foundation) |
| 2 | Contacts view rewrite: modal create, detail page, polished table/cards |
| 3 | Pipeline view rewrite: modal create, deal detail with stage pills, polished kanban |
| 4 | Dashboard cleanup + final integration verification |
