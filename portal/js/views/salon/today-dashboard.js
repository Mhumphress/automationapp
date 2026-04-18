// ─────────────────────────────────────────────────────────────────
//  today-dashboard.js — Salon "Today at the Shop" view.
//  Shows today's appointments by stylist, revenue so far, upcoming,
//  no-shows, cancellations.
// ─────────────────────────────────────────────────────────────────

import { db } from '../../config.js';
import { collection, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getTenantId } from '../../tenant-context.js';

let unsubs = [];
let state = { appointments: [], services: [], errors: {} };
let renderTimer = null;

export function init() {}
export function destroy() {
  unsubs.forEach(u => { try { u(); } catch {} });
  unsubs = [];
  if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
}

export function render() {
  const container = document.getElementById('view-salon-today');
  if (!container) return;
  destroy();
  container.innerHTML = '<div class="loading">Loading today…</div>';
  const tenantId = getTenantId();
  if (!tenantId) return;

  const scheduleDraw = () => {
    if (renderTimer) return;
    renderTimer = setTimeout(() => { renderTimer = null; draw(container); }, 50);
  };
  const sub = (coll, key) => {
    try {
      unsubs.push(onSnapshot(
        collection(db, 'tenants', tenantId, coll),
        (snap) => { state[key] = snap.docs.map(d => ({ id: d.id, ...d.data() })); delete state.errors[key]; scheduleDraw(); },
        (err) => { state.errors[key] = err.code || err.message; scheduleDraw(); }
      ));
    } catch (err) { state.errors[key] = err.message; }
  };
  sub('appointments', 'appointments');
  sub('services_menu', 'services');
  scheduleDraw();
}

function draw(container) {
  const { appointments, errors } = state;
  const now = Date.now();
  const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
  const endOfDay = new Date(); endOfDay.setHours(23,59,59,999);

  const today = appointments.filter(a => {
    const t = a.startAt?.toDate?.()?.getTime() || 0;
    return t >= startOfDay.getTime() && t <= endOfDay.getTime();
  });

  const completed = today.filter(a => a.status === 'completed');
  const upcoming = today.filter(a => ['scheduled', 'confirmed'].includes(a.status) && (a.startAt?.toDate?.()?.getTime() || 0) > now);
  const inProgress = today.filter(a => ['scheduled', 'confirmed'].includes(a.status) && (a.startAt?.toDate?.()?.getTime() || 0) <= now && (a.endAt?.toDate?.()?.getTime() || 0) > now);
  const noShows = today.filter(a => a.status === 'no_show').length;
  const canceled = today.filter(a => a.status === 'cancelled' || a.status === 'canceled').length;

  const revenueToday = completed.reduce((s, a) => s + (Number(a.price) || 0), 0);
  const revenuePotential = today.reduce((s, a) => s + (Number(a.price) || 0), 0);

  // Group by staff
  const byStaff = {};
  today.forEach(a => {
    const staff = a.staff || 'Unassigned';
    (byStaff[staff] ||= []).push(a);
  });

  const errorKeys = Object.keys(errors || {});
  container.innerHTML = '';
  if (errorKeys.length > 0) {
    const banner = document.createElement('div');
    banner.style.cssText = 'padding:0.75rem;margin-bottom:0.75rem;background:rgba(220,38,38,0.08);color:var(--danger);border-radius:8px;font-size:0.85rem;';
    banner.innerHTML = `<strong>Can't load some data:</strong> ${errorKeys.map(k => `${k} — ${errors[k]}`).join('; ')}`;
    container.appendChild(banner);
  }

  const kpis = document.createElement('div');
  kpis.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:0.75rem;margin-bottom:1rem;';
  kpis.innerHTML = `
    ${kpi('Appointments today', String(today.length))}
    ${kpi('Completed', String(completed.length), '#059669')}
    ${kpi('In progress', String(inProgress.length), '#2563eb')}
    ${kpi('Upcoming', String(upcoming.length))}
    ${kpi('No-shows', String(noShows), noShows > 0 ? '#dc2626' : '')}
    ${kpi('Cancellations', String(canceled), canceled > 0 ? '#d97706' : '')}
    ${kpi('Revenue (complete)', fmtMoney(revenueToday), '#059669')}
    ${kpi('Revenue potential', fmtMoney(revenuePotential))}
  `;
  container.appendChild(kpis);

  const staffBlock = document.createElement('div');
  staffBlock.className = 'settings-section';
  staffBlock.innerHTML = `<h3 class="section-title">By Staff — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</h3>`;
  if (Object.keys(byStaff).length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'color:var(--gray);padding:0.5rem 0;font-size:0.85rem;';
    empty.textContent = 'No appointments today.';
    staffBlock.appendChild(empty);
  } else {
    Object.entries(byStaff).forEach(([staff, appts]) => {
      appts.sort((a, b) => (a.startAt?.toDate?.()?.getTime() || 0) - (b.startAt?.toDate?.()?.getTime() || 0));
      const revenue = appts.filter(a => a.status === 'completed').reduce((s, a) => s + (Number(a.price) || 0), 0);
      const block = document.createElement('div');
      block.style.cssText = 'padding:0.6rem 0;border-bottom:1px solid var(--off-white);';
      block.innerHTML = `
        <div style="display:flex;justify-content:space-between;font-weight:500;margin-bottom:0.35rem;">
          <span>${escapeHtml(staff)}</span>
          <span style="color:var(--gray-dark);font-size:0.85rem;">${appts.length} appt${appts.length === 1 ? '' : 's'} · ${fmtMoney(revenue)} complete</span>
        </div>
        <div style="display:flex;gap:0.3rem;flex-wrap:wrap;">
          ${appts.map(a => {
            const start = a.startAt?.toDate?.();
            const time = start ? start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
            const bgMap = { scheduled: '#dbeafe', confirmed: '#c7f9cc', completed: '#d1fae5', cancelled: '#fee2e2', no_show: '#fef3c7' };
            const fgMap = { scheduled: '#1e40af', confirmed: '#065f46', completed: '#065f46', cancelled: '#991b1b', no_show: '#92400e' };
            return `<span style="padding:0.25rem 0.55rem;background:${bgMap[a.status] || '#f1f5f9'};color:${fgMap[a.status] || '#334155'};border-radius:6px;font-size:0.78rem;">
              ${escapeHtml(time)} · ${escapeHtml(a.customerName || 'Walk-in')}
            </span>`;
          }).join('')}
        </div>
      `;
      staffBlock.appendChild(block);
    });
  }
  container.appendChild(staffBlock);
}

function kpi(label, value, color) {
  return `
    <div style="padding:0.7rem 0.85rem;background:white;border:1px solid var(--off-white);border-radius:10px;">
      <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--gray-dark);">${escapeHtml(label)}</div>
      <div style="font-size:1.25rem;font-weight:600;margin-top:0.15rem;${color ? `color:${color};` : ''}">${escapeHtml(value)}</div>
    </div>
  `;
}
function fmtMoney(v) { const n = Number(v); return !Number.isFinite(n) ? '$0.00' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n); }
function escapeHtml(s) { if (s == null) return ''; const n = document.createElement('span'); n.appendChild(document.createTextNode(String(s))); return n.innerHTML; }
