// ─────────────────────────────────────────────────────────────────
//  records.js — Reusable list + detail + calendar for tenant-scoped
//  record collections. Drives most vertical-specific modules (jobs,
//  work_orders, bom, projects, properties, leases, maintenance,
//  services_menu, staff-calendar, loyalty, time_entries, proposals,
//  dispatching, quoting, appointments) via per-vertical config files.
//
//  Usage:
//    mountRecords(container, config, { tenantId, canWrite });
//  Config shape — see `field` types below. `config.collection` is a
//  tenant subcollection at tenants/{tenantId}/{collection}.
// ─────────────────────────────────────────────────────────────────

import { db, auth } from '../config.js';
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, query,
  orderBy, where, onSnapshot, serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { mountCalendar } from './calendar.js';

export function mountRecords(container, config, env) {
  const state = {
    container,
    config,
    env,
    records: [],
    view: config.showCalendar ? 'list' : 'list',  // 'list' | 'calendar' | 'detail'
    selectedId: null,
    filters: { status: 'all', search: '' },
    unsub: null,
    calInstance: null,
  };

  render(state);
  subscribe(state);
  return { destroy: () => destroy(state) };
}

function destroy(state) {
  if (state.unsub) { try { state.unsub(); } catch {} state.unsub = null; }
  if (state.calInstance) { try { state.calInstance.destroy(); } catch {} state.calInstance = null; }
}

function subscribe(state) {
  if (state.unsub) { try { state.unsub(); } catch {} }
  const path = `tenants/${state.env.tenantId}/${state.config.collection}`;
  const orderField = state.config.orderField || 'createdAt';
  try {
    const q = query(collection(db, path), orderBy(orderField, 'desc'));
    state.unsub = onSnapshot(q, (snap) => {
      state.records = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (state.view !== 'detail') render(state);
    }, (err) => console.warn(`${state.config.collection} subscription error:`, err));
  } catch (err) {
    console.warn(`Subscribe to ${path} failed:`, err);
    // Fallback: one-shot load
    getDocs(collection(db, path)).then(snap => {
      state.records = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      render(state);
    }).catch(e => console.warn('fallback load failed:', e));
  }
}

function render(state) {
  if (state.calInstance) { try { state.calInstance.destroy(); } catch {} state.calInstance = null; }
  state.container.innerHTML = '';

  if (state.view === 'detail' && state.selectedId) {
    renderDetail(state);
    return;
  }

  state.container.appendChild(renderTopbar(state));

  if (state.view === 'calendar' && state.config.showCalendar) {
    const calWrap = document.createElement('div');
    calWrap.style.marginTop = '0.5rem';
    state.container.appendChild(calWrap);
    state.calInstance = mountCalendar(calWrap, {
      collection: state.config.collection,
      tenantId: state.env.tenantId,
      titleField: state.config.calendarTitle || 'name',
      startField: state.config.calendarStart || 'startAt',
      endField:   state.config.calendarEnd || 'endAt',
      colorField: state.config.colorField || 'status',
      initialView: 'week',
      onOpenEvent: (evt) => { state.view = 'detail'; state.selectedId = evt.id; render(state); },
      onCreateAt: (date) => {
        if (!state.env.canWrite) return;
        openCreateModal(state, { [state.config.calendarStart || 'startAt']: date });
      },
    });
  } else {
    state.container.appendChild(renderList(state));
  }
}

function renderTopbar(state) {
  const bar = document.createElement('div');
  bar.className = 'records-topbar';
  bar.innerHTML = `
    <div class="records-filters">
      <input type="search" class="search-input" placeholder="Search..." value="${escapeHtml(state.filters.search)}" style="max-width:240px;">
      ${state.config.statuses?.length ? `
        <select class="filter-select" data-filter="status">
          <option value="all">All statuses</option>
          ${state.config.statuses.map(s =>
            `<option value="${escapeHtml(s)}" ${state.filters.status === s ? 'selected' : ''}>${escapeHtml(formatLabel(s))}</option>`
          ).join('')}
        </select>
      ` : ''}
    </div>
    <div style="display:flex;gap:0.4rem;">
      ${state.config.showCalendar ? `
        <button class="btn btn-ghost btn-sm ${state.view === 'list' ? 'active' : ''}" data-view="list">List</button>
        <button class="btn btn-ghost btn-sm ${state.view === 'calendar' ? 'active' : ''}" data-view="calendar">Calendar</button>
      ` : ''}
      ${state.env.canWrite ? `<button class="btn btn-primary btn-sm" data-action="new">+ New ${escapeHtml(state.config.singular || 'Record')}</button>` : ''}
    </div>
  `;
  bar.querySelector('.search-input').addEventListener('input', (e) => {
    state.filters.search = e.target.value.trim().toLowerCase();
    render(state);
  });
  const statusSel = bar.querySelector('[data-filter="status"]');
  if (statusSel) statusSel.addEventListener('change', () => {
    state.filters.status = statusSel.value;
    render(state);
  });
  bar.querySelectorAll('[data-view]').forEach(btn => btn.addEventListener('click', () => {
    state.view = btn.dataset.view;
    render(state);
  }));
  bar.querySelector('[data-action="new"]')?.addEventListener('click', () => {
    // Config can override the default "+ New" behavior with its own flow.
    if (typeof state.config.createOverride === 'function') {
      state.config.createOverride({
        tenantId: state.env.tenantId,
        env: state.env,
        onCreated: () => render(state),
      });
    } else {
      openCreateModal(state, {});
    }
  });
  return bar;
}

function renderList(state) {
  const wrap = document.createElement('div');
  wrap.className = 'records-list';

  const columns = state.config.listColumns || state.config.fields.filter(f => f.primary || f.key === 'status').map(f => f.key);

  let records = [...state.records];
  if (state.filters.status !== 'all') {
    records = records.filter(r => r.status === state.filters.status);
  }
  if (state.filters.search) {
    const s = state.filters.search;
    records = records.filter(r => JSON.stringify(r).toLowerCase().includes(s));
  }

  if (!records.length) {
    wrap.innerHTML = `<div class="records-empty">
      ${state.records.length === 0 ? `No ${escapeHtml((state.config.singular || 'records').toLowerCase())}s yet.` : 'No matches.'}
    </div>`;
    return wrap;
  }

  const table = document.createElement('table');
  table.className = 'data-table';
  const fieldsByKey = Object.fromEntries(state.config.fields.map(f => [f.key, f]));
  const headers = columns.map(k => {
    const f = fieldsByKey[k];
    return `<th>${escapeHtml(f?.label || formatLabel(k))}</th>`;
  }).join('');
  table.innerHTML = `
    <thead><tr>${headers}</tr></thead>
    <tbody>
      ${records.map(r => `
        <tr class="clickable" data-id="${escapeHtml(r.id)}">
          ${columns.map(k => `<td>${renderCell(r[k], fieldsByKey[k])}</td>`).join('')}
        </tr>
      `).join('')}
    </tbody>
  `;
  table.querySelectorAll('tr[data-id]').forEach(tr => {
    tr.addEventListener('click', () => {
      state.view = 'detail';
      state.selectedId = tr.dataset.id;
      render(state);
    });
  });
  wrap.appendChild(table);
  return wrap;
}

function renderDetail(state) {
  const rec = state.records.find(r => r.id === state.selectedId);
  if (!rec) {
    state.container.innerHTML = '<div class="records-empty">Record not found.</div>';
    return;
  }

  const back = document.createElement('a');
  back.className = 'record-detail-back';
  back.textContent = `← Back to ${state.config.title || 'list'}`;
  back.addEventListener('click', () => { state.view = 'list'; state.selectedId = null; render(state); });
  state.container.appendChild(back);

  const box = document.createElement('div');
  box.className = 'record-detail';
  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1rem;">
      <h2 style="margin:0;">${escapeHtml(rec[primaryKey(state.config)] || `(${state.config.singular || 'Record'})`)}</h2>
      ${state.env.canWrite ? `
        <div style="display:flex;gap:0.4rem;">
          <button class="btn btn-ghost btn-sm" data-action="edit">Edit</button>
          <button class="btn btn-ghost btn-sm" data-action="delete" style="color:var(--danger, #dc2626);">Delete</button>
        </div>
      ` : ''}
    </div>
    ${state.config.fields.map(f => {
      if (f.key === primaryKey(state.config)) return '';
      const val = rec[f.key];
      if (val == null || val === '') return '';
      return `
        <div class="detail-field">
          <div class="detail-field-label">${escapeHtml(f.label)}</div>
          <div class="detail-field-value">${renderCell(val, f)}</div>
        </div>
      `;
    }).join('')}
  `;
  state.container.appendChild(box);

  box.querySelector('[data-action="edit"]')?.addEventListener('click', () => openEditModal(state, rec));

  // Config may declare extra sections to render below the standard fields.
  // Each section is { title, render(record, env, { reload }) => HTMLElement | Promise<HTMLElement> }.
  const extensions = Array.isArray(state.config.detailSections) ? state.config.detailSections : [];
  if (extensions.length) {
    const reload = () => render(state);
    extensions.forEach(async (section) => {
      try {
        const wrap = document.createElement('div');
        wrap.className = 'record-detail-section';
        wrap.innerHTML = section.title ? `<h3 class="section-title" style="margin-top:1.25rem;">${escapeHtml(section.title)}</h3>` : '';
        state.container.appendChild(wrap);
        const content = await section.render(rec, state.env, { reload });
        if (content instanceof HTMLElement) wrap.appendChild(content);
        else if (typeof content === 'string') {
          const div = document.createElement('div');
          div.innerHTML = content;
          wrap.appendChild(div);
        }
      } catch (err) {
        console.warn('detailSection render failed:', err);
      }
    });
  }

  box.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
    if (!confirm('Delete this record? This cannot be undone.')) return;
    try {
      await deleteDoc(doc(db, `tenants/${state.env.tenantId}/${state.config.collection}/${rec.id}`));
      showToast('Deleted', 'success');
      state.view = 'list'; state.selectedId = null; render(state);
    } catch (err) {
      console.error(err);
      showToast('Delete failed', 'error');
    }
  });
}

function openCreateModal(state, defaults) {
  openRecordModal(state, null, defaults || {});
}

function openEditModal(state, rec) {
  openRecordModal(state, rec, {});
}

function openRecordModal(state, existing, defaults) {
  const isEdit = !!existing;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop open';
  backdrop.innerHTML = `
    <div class="modal-dialog">
      <div class="modal-header">
        <h2 class="modal-title">${isEdit ? 'Edit' : 'New'} ${escapeHtml(state.config.singular || 'Record')}</h2>
        <button class="modal-close" type="button">×</button>
      </div>
      <div class="modal-body">
        <form class="modal-form" id="recordForm">
          ${state.config.fields.map(f => renderField(f, existing ? existing[f.key] : (defaults[f.key] ?? f.default))).join('')}
          <div class="modal-actions">
            <button type="submit" class="btn btn-primary btn-lg">${isEdit ? 'Save' : 'Create'}</button>
            <span class="modal-cancel">Cancel</span>
          </div>
        </form>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector('.modal-close').addEventListener('click', close);
  backdrop.querySelector('.modal-cancel').addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

  backdrop.querySelector('#recordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {};
    state.config.fields.forEach(f => {
      const raw = fd.get(f.key);
      data[f.key] = coerce(raw, f);
    });

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const path = `tenants/${state.env.tenantId}/${state.config.collection}`;
      const user = auth.currentUser;
      if (isEdit) {
        await updateDoc(doc(db, path, existing.id), {
          ...data,
          updatedAt: serverTimestamp(),
          updatedBy: user ? user.uid : null,
        });
        showToast('Saved', 'success');
      } else {
        await addDoc(collection(db, path), {
          ...data,
          createdAt: serverTimestamp(),
          createdBy: user ? user.uid : null,
          createdByEmail: user ? user.email || '' : '',
        });
        showToast('Created', 'success');
      }
      close();
    } catch (err) {
      console.error(err);
      showToast('Save failed: ' + err.message, 'error');
      btn.disabled = false;
    }
  });
}

function renderField(f, value) {
  const val = value ?? '';
  const req = f.required ? 'required' : '';
  const label = `<label>${escapeHtml(f.label)}${f.required ? ' *' : ''}</label>`;
  switch (f.type) {
    case 'textarea':
      return `<div class="modal-field">${label}<textarea name="${escapeAttr(f.key)}" rows="3" ${req}>${escapeHtml(val)}</textarea></div>`;
    case 'select':
      return `<div class="modal-field">${label}<select name="${escapeAttr(f.key)}" ${req}>
        <option value="">—</option>
        ${(f.options || []).map(o => `<option value="${escapeAttr(o)}" ${o === val ? 'selected' : ''}>${escapeHtml(formatLabel(o))}</option>`).join('')}
      </select></div>`;
    case 'number':
    case 'money':
      return `<div class="modal-field">${label}<input type="number" name="${escapeAttr(f.key)}" step="${f.type === 'money' ? '0.01' : (f.step || '1')}" ${req} value="${escapeAttr(val)}"></div>`;
    case 'datetime':
      return `<div class="modal-field">${label}<input type="datetime-local" name="${escapeAttr(f.key)}" ${req} value="${escapeAttr(toLocalDateTime(val))}"></div>`;
    case 'date':
      return `<div class="modal-field">${label}<input type="date" name="${escapeAttr(f.key)}" ${req} value="${escapeAttr(toLocalDate(val))}"></div>`;
    case 'email':
      return `<div class="modal-field">${label}<input type="email" name="${escapeAttr(f.key)}" ${req} value="${escapeAttr(val)}"></div>`;
    case 'tel':
      return `<div class="modal-field">${label}<input type="tel" name="${escapeAttr(f.key)}" ${req} value="${escapeAttr(val)}"></div>`;
    case 'url':
      return `<div class="modal-field">${label}<input type="url" name="${escapeAttr(f.key)}" ${req} value="${escapeAttr(val)}"></div>`;
    default:
      return `<div class="modal-field">${label}<input type="text" name="${escapeAttr(f.key)}" ${req} value="${escapeAttr(val)}"></div>`;
  }
}

function coerce(raw, f) {
  if (raw == null || raw === '') return null;
  const v = raw.toString();
  switch (f.type) {
    case 'number':
    case 'money':
      return Number(v) || 0;
    case 'datetime':
    case 'date':
      return Timestamp.fromDate(new Date(v));
    default:
      return v.trim();
  }
}

function renderCell(v, field) {
  if (v == null || v === '') return '<span style="color:var(--gray);">—</span>';
  if (!field) return escapeHtml(String(v));
  switch (field.type) {
    case 'money':
      return formatMoney(v);
    case 'datetime':
      return escapeHtml(formatDateTime(v));
    case 'date':
      return escapeHtml(formatDate(v));
    case 'select':
      return `<span class="badge ${badgeClassFor(v)}">${escapeHtml(formatLabel(v))}</span>`;
    default:
      return escapeHtml(String(v));
  }
}

// ── Utility helpers ───────────────────────────────────────

function primaryKey(config) {
  const primary = config.fields.find(f => f.primary);
  return primary ? primary.key : (config.fields[0]?.key || 'name');
}

function formatLabel(s) {
  if (!s) return '';
  return String(s).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function badgeClassFor(v) {
  const s = String(v || '').toLowerCase();
  if (['completed', 'confirmed', 'active', 'paid', 'done'].includes(s)) return 'badge-success';
  if (['cancelled', 'canceled', 'overdue', 'closed', 'lost'].includes(s)) return 'badge-danger';
  if (['scheduled', 'in_progress', 'sent', 'pending'].includes(s)) return 'badge-info';
  if (['past_due', 'no_show', 'on_hold'].includes(s)) return 'badge-warning';
  return 'badge-default';
}

function toLocalDateTime(v) {
  if (!v) return '';
  try {
    const d = v.toDate ? v.toDate() : new Date(v);
    if (isNaN(d.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return ''; }
}

function toLocalDate(v) {
  if (!v) return '';
  try {
    const d = v.toDate ? v.toDate() : new Date(v);
    if (isNaN(d.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  } catch { return ''; }
}

function formatDate(v) {
  if (!v) return '';
  try {
    const d = v.toDate ? v.toDate() : new Date(v);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return ''; }
}

function formatDateTime(v) {
  if (!v) return '';
  try {
    const d = v.toDate ? v.toDate() : new Date(v);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch { return ''; }
}

function formatMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function escapeHtml(s) {
  if (s == null) return '';
  const n = document.createElement('span');
  n.appendChild(document.createTextNode(String(s)));
  return n.innerHTML;
}

function escapeAttr(s) {
  if (s == null) return '';
  return String(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function showToast(msg, type) {
  const c = document.getElementById('toastContainer');
  if (!c) { alert(msg); return; }
  const t = document.createElement('div');
  t.className = `toast toast-${type || 'info'}`;
  t.textContent = msg;
  c.appendChild(t);
  requestAnimationFrame(() => t.classList.add('toast-visible'));
  setTimeout(() => { t.classList.remove('toast-visible'); setTimeout(() => t.remove(), 400); }, 3000);
}
