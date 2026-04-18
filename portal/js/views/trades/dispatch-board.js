// ─────────────────────────────────────────────────────────────────
//  dispatch-board.js — Trades dispatch view.
//  Left: unassigned queue. Right: columns per technician with their
//  jobs for today. Click a job to assign/reassign.
// ─────────────────────────────────────────────────────────────────

import { db, auth } from '../../config.js';
import {
  collection, onSnapshot, updateDoc, doc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getTenantId } from '../../tenant-context.js';

let unsubs = [];
let state = { jobs: [], errors: {} };
let renderTimer = null;
let selectedDate = todayIso();

export function init() {}
export function destroy() {
  unsubs.forEach(u => { try { u(); } catch {} });
  unsubs = [];
  if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
}

export function render() {
  const container = document.getElementById('view-dispatch');
  if (!container) return;
  destroy();
  container.innerHTML = '<div class="loading">Loading dispatch…</div>';
  const tenantId = getTenantId();
  if (!tenantId) return;

  const scheduleDraw = () => {
    if (renderTimer) return;
    renderTimer = setTimeout(() => { renderTimer = null; draw(container, tenantId); }, 50);
  };
  try {
    unsubs.push(onSnapshot(
      collection(db, 'tenants', tenantId, 'jobs'),
      (snap) => { state.jobs = snap.docs.map(d => ({ id: d.id, ...d.data() })); delete state.errors.jobs; scheduleDraw(); },
      (err) => { state.errors.jobs = err.code || err.message; scheduleDraw(); }
    ));
  } catch (err) { state.errors.jobs = err.message; }
  scheduleDraw();
}

function draw(container, tenantId) {
  const { jobs, errors } = state;
  const day = new Date(selectedDate + 'T00:00:00').getTime();
  const dayEnd = day + 86400000;

  // Jobs scheduled for this day
  const dayJobs = jobs.filter(j => {
    const t = j.scheduledAt?.toDate?.()?.getTime() || 0;
    return t >= day && t < dayEnd;
  });
  const unassigned = dayJobs.filter(j => !j.assignedTo || j.assignedTo === 'Unassigned').filter(j => j.status !== 'completed' && j.status !== 'cancelled');

  // Tech columns
  const byTech = {};
  dayJobs.forEach(j => {
    const tech = j.assignedTo || '';
    if (!tech) return;
    (byTech[tech] ||= []).push(j);
  });

  const techs = Object.keys(byTech).sort();

  const errorKeys = Object.keys(errors || {});
  container.innerHTML = '';
  if (errorKeys.length > 0) {
    const banner = document.createElement('div');
    banner.style.cssText = 'padding:0.75rem;margin-bottom:0.75rem;background:rgba(220,38,38,0.08);color:var(--danger);border-radius:8px;font-size:0.85rem;';
    banner.innerHTML = `<strong>Can't load jobs:</strong> ${errorKeys.map(k => `${k} — ${errors[k]}`).join('; ')}`;
    container.appendChild(banner);
  }

  // Toolbar
  const toolbar = document.createElement('div');
  toolbar.style.cssText = 'display:flex;gap:0.5rem;align-items:center;margin-bottom:1rem;flex-wrap:wrap;';
  toolbar.innerHTML = `
    <label style="font-size:0.85rem;display:flex;gap:0.3rem;align-items:center;">
      Date
      <input type="date" id="dispatchDate" value="${selectedDate}" style="padding:0.35rem 0.5rem;border:1px solid var(--off-white);border-radius:6px;">
    </label>
    <button class="btn btn-ghost btn-sm" id="dispatchToday">Today</button>
    <div style="margin-left:auto;font-size:0.85rem;color:var(--gray-dark);">
      ${dayJobs.length} job${dayJobs.length === 1 ? '' : 's'} · ${unassigned.length} unassigned · ${techs.length} tech${techs.length === 1 ? '' : 's'}
    </div>
  `;
  container.appendChild(toolbar);
  toolbar.querySelector('#dispatchDate').addEventListener('change', (e) => { selectedDate = e.target.value; draw(container, tenantId); });
  toolbar.querySelector('#dispatchToday').addEventListener('click', () => { selectedDate = todayIso(); draw(container, tenantId); });

  // Board layout: unassigned column + one column per tech
  const board = document.createElement('div');
  board.style.cssText = 'display:grid;grid-template-columns:minmax(240px, 280px) 1fr;gap:1rem;align-items:flex-start;';

  // Unassigned
  const unassignedCol = document.createElement('div');
  unassignedCol.style.cssText = 'background:#fffbea;border:1px solid #f59e0b40;border-radius:10px;padding:0.75rem;';
  unassignedCol.innerHTML = `
    <h3 style="margin:0 0 0.75rem;font-size:0.95rem;display:flex;justify-content:space-between;">
      <span>Unassigned</span>
      <span style="font-size:0.75rem;color:var(--gray-dark);">${unassigned.length}</span>
    </h3>
    ${unassigned.length === 0
      ? '<div style="color:var(--gray);font-size:0.85rem;padding:0.5rem 0;">All assigned ✓</div>'
      : unassigned.map(j => jobCardHTML(j, techs)).join('')}
  `;
  board.appendChild(unassignedCol);

  // Tech columns (single grid, rows per tech)
  const techsGrid = document.createElement('div');
  techsGrid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill, minmax(280px, 1fr));gap:0.75rem;';
  if (techs.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:2rem;color:var(--gray);text-align:center;background:white;border:1px solid var(--off-white);border-radius:10px;';
    empty.textContent = 'No technicians assigned for this day. Assign jobs from the Unassigned column.';
    techsGrid.appendChild(empty);
  } else {
    techs.forEach(tech => {
      const techJobs = byTech[tech].sort((a, b) => (a.scheduledAt?.toDate?.()?.getTime() || 0) - (b.scheduledAt?.toDate?.()?.getTime() || 0));
      const col = document.createElement('div');
      col.style.cssText = 'background:white;border:1px solid var(--off-white);border-radius:10px;padding:0.75rem;';
      col.innerHTML = `
        <h3 style="margin:0 0 0.75rem;font-size:0.95rem;display:flex;justify-content:space-between;">
          <span>${escapeHtml(tech)}</span>
          <span style="font-size:0.75rem;color:var(--gray-dark);">${techJobs.length}</span>
        </h3>
        ${techJobs.map(j => jobCardHTML(j, techs, tech)).join('')}
      `;
      techsGrid.appendChild(col);
    });
  }
  board.appendChild(techsGrid);
  container.appendChild(board);

  // Wire reassign buttons
  container.querySelectorAll('[data-reassign]').forEach(sel => {
    sel.addEventListener('change', async (e) => {
      const jobId = sel.dataset.reassign;
      const to = sel.value;
      try {
        await updateDoc(doc(db, 'tenants', tenantId, 'jobs', jobId), {
          assignedTo: to || null,
          updatedAt: serverTimestamp(),
          updatedBy: auth.currentUser?.uid || null,
        });
      } catch (err) { console.error('Reassign failed:', err); alert('Reassign failed: ' + err.message); }
    });
  });
  container.querySelectorAll('[data-status-change]').forEach(sel => {
    sel.addEventListener('change', async (e) => {
      const jobId = sel.dataset.statusChange;
      try {
        const update = { status: sel.value, updatedAt: serverTimestamp() };
        if (sel.value === 'completed') update.completedAt = serverTimestamp();
        await updateDoc(doc(db, 'tenants', tenantId, 'jobs', jobId), update);
      } catch (err) { console.error('Status change failed:', err); alert('Status change failed: ' + err.message); }
    });
  });
}

function jobCardHTML(job, techs, currentTech) {
  const start = job.scheduledAt?.toDate?.();
  const time = start ? start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
  const statusColor = {
    new: '#64748b', scheduled: '#4f7bf7', in_progress: '#0d9488',
    completed: '#059669', cancelled: '#dc2626', on_hold: '#d97706',
  }[job.status] || '#64748b';
  return `
    <div style="background:#fafbfc;border:1px solid var(--off-white);border-radius:8px;padding:0.65rem;margin-bottom:0.5rem;">
      <div style="display:flex;justify-content:space-between;gap:0.5rem;">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(job.name || 'Job')}</div>
          <div style="font-size:0.78rem;color:var(--gray-dark);">${escapeHtml(job.customerName || '')}${time ? ' · ' + escapeHtml(time) : ''}</div>
          ${job.address ? `<div style="font-size:0.72rem;color:var(--gray-dark);">${escapeHtml(job.address)}</div>` : ''}
        </div>
        <div style="width:4px;background:${statusColor};border-radius:2px;flex-shrink:0;"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.3rem;margin-top:0.5rem;">
        <select data-reassign="${escapeHtml(job.id)}" style="font-size:0.72rem;padding:0.2rem 0.35rem;border:1px solid var(--off-white);border-radius:4px;">
          <option value="">Unassigned</option>
          ${techs.map(t => `<option value="${escapeAttr(t)}" ${t === currentTech ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
          ${currentTech && !techs.includes(currentTech) ? `<option value="${escapeAttr(currentTech)}" selected>${escapeHtml(currentTech)}</option>` : ''}
        </select>
        <select data-status-change="${escapeHtml(job.id)}" style="font-size:0.72rem;padding:0.2rem 0.35rem;border:1px solid var(--off-white);border-radius:4px;">
          ${['new', 'scheduled', 'in_progress', 'completed', 'cancelled', 'on_hold'].map(s =>
            `<option value="${s}" ${s === (job.status || 'new') ? 'selected' : ''}>${formatLabel(s)}</option>`
          ).join('')}
        </select>
      </div>
    </div>
  `;
}

function todayIso() { return new Date().toISOString().slice(0, 10); }
function formatLabel(s) { return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }
function escapeHtml(s) { if (s == null) return ''; const n = document.createElement('span'); n.appendChild(document.createTextNode(String(s))); return n.innerHTML; }
function escapeAttr(s) { return String(s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
