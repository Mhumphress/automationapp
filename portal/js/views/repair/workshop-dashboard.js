// ─────────────────────────────────────────────────────────────────
//  workshop-dashboard.js — Repair shop overview.
//  KPIs: open tickets by status, avg turnaround, low-stock parts,
//  tickets awaiting parts, ready-for-pickup.
// ─────────────────────────────────────────────────────────────────

import { db } from '../../config.js';
import { collection, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getTenantId } from '../../tenant-context.js';

let unsubs = [];
let state = { tickets: [], inventory: [], errors: {} };
let renderTimer = null;

export function init() {}
export function destroy() {
  unsubs.forEach(u => { try { u(); } catch {} });
  unsubs = [];
  if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
}

export function render() {
  const container = document.getElementById('view-workshop');
  if (!container) return;
  destroy();
  container.innerHTML = '<div class="loading">Loading workshop…</div>';
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

  sub('tickets', 'tickets');
  sub('inventory', 'inventory');
  scheduleDraw();
}

function draw(container) {
  const { tickets, inventory, errors } = state;

  const open = tickets.filter(t => !['completed', 'cancelled', 'picked_up', 'done'].includes(t.status));
  const byStatus = {};
  open.forEach(t => { const s = t.status || 'new'; byStatus[s] = (byStatus[s] || 0) + 1; });
  const awaitingParts = tickets.filter(t => t.status === 'awaiting_parts').length;
  const readyForPickup = tickets.filter(t => ['ready', 'qa_passed', 'ready_for_pickup'].includes(t.status)).length;

  // Turnaround: completed tickets with completedAt - createdAt
  const completed = tickets.filter(t => t.completedAt && t.createdAt);
  const turnaroundMs = completed.length > 0
    ? completed.reduce((s, t) => {
        const c = t.completedAt?.toDate?.()?.getTime() || 0;
        const n = t.createdAt?.toDate?.()?.getTime() || 0;
        return s + Math.max(0, c - n);
      }, 0) / completed.length
    : 0;
  const avgTurnaroundDays = (turnaroundMs / 86400000).toFixed(1);

  const lowStock = inventory.filter(i => {
    const qty = Number(i.quantity ?? i.stock ?? 0);
    const reorder = Number(i.reorderPoint ?? i.minStock ?? 0);
    return reorder > 0 && qty <= reorder;
  });
  const outOfStock = inventory.filter(i => Number(i.quantity ?? i.stock ?? 0) === 0);

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
    ${kpi('Open tickets', String(open.length))}
    ${kpi('Awaiting parts', String(awaitingParts), awaitingParts > 0 ? '#d97706' : '')}
    ${kpi('Ready for pickup', String(readyForPickup), readyForPickup > 0 ? '#059669' : '')}
    ${kpi('Avg turnaround', `${avgTurnaroundDays}d`)}
    ${kpi('Low stock', String(lowStock.length), lowStock.length > 0 ? '#d97706' : '')}
    ${kpi('Out of stock', String(outOfStock.length), outOfStock.length > 0 ? '#dc2626' : '')}
  `;
  container.appendChild(kpis);

  // Two-column: pipeline + low-stock
  const layout = document.createElement('div');
  layout.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:1rem;';
  layout.innerHTML = `
    <div class="settings-section">
      <h3 class="section-title">Ticket Pipeline</h3>
      ${Object.keys(byStatus).length === 0
        ? '<div style="color:var(--gray);padding:0.5rem 0;font-size:0.85rem;">No open tickets.</div>'
        : Object.entries(byStatus).sort((a,b) => b[1] - a[1]).map(([s, c]) => `
          <div style="display:flex;justify-content:space-between;padding:0.4rem 0;border-bottom:1px solid var(--off-white);">
            <span>${escapeHtml(formatLabel(s))}</span>
            <strong>${c}</strong>
          </div>
        `).join('')}
    </div>
    <div class="settings-section">
      <h3 class="section-title">Inventory Alerts</h3>
      ${outOfStock.length === 0 && lowStock.length === 0
        ? '<div style="color:var(--gray);padding:0.5rem 0;font-size:0.85rem;">All good — no low stock.</div>'
        : [...outOfStock, ...lowStock.filter(l => !outOfStock.includes(l))].slice(0, 10).map(i => {
            const qty = Number(i.quantity ?? i.stock ?? 0);
            const reorder = Number(i.reorderPoint ?? i.minStock ?? 0);
            const cls = qty === 0 ? 'badge-danger' : 'badge-warning';
            return `
              <div style="display:flex;justify-content:space-between;padding:0.4rem 0;border-bottom:1px solid var(--off-white);font-size:0.85rem;">
                <span>${escapeHtml(i.name || i.partName || '—')}</span>
                <span><span class="badge ${cls}">${qty} / ${reorder}</span></span>
              </div>
            `;
          }).join('')}
    </div>
  `;
  container.appendChild(layout);
}

function kpi(label, value, color) {
  return `
    <div style="padding:0.7rem 0.85rem;background:white;border:1px solid var(--off-white);border-radius:10px;">
      <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--gray-dark);">${escapeHtml(label)}</div>
      <div style="font-size:1.25rem;font-weight:600;margin-top:0.15rem;${color ? `color:${color};` : ''}">${escapeHtml(value)}</div>
    </div>
  `;
}
function formatLabel(s) { return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }
function escapeHtml(s) { if (s == null) return ''; const n = document.createElement('span'); n.appendChild(document.createTextNode(String(s))); return n.innerHTML; }
