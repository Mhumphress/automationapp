// ─────────────────────────────────────────────────────────────────
//  production-dashboard.js — Manufacturing WIP + output + alerts.
// ─────────────────────────────────────────────────────────────────

import { db } from '../../config.js';
import { collection, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getTenantId } from '../../tenant-context.js';

let unsubs = [];
let state = { workOrders: [], inventory: [], bom: [], errors: {} };
let renderTimer = null;

export function init() {}
export function destroy() {
  unsubs.forEach(u => { try { u(); } catch {} });
  unsubs = [];
  if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
}

export function render() {
  const container = document.getElementById('view-production');
  if (!container) return;
  destroy();
  container.innerHTML = '<div class="loading">Loading production…</div>';
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
  sub('work_orders', 'workOrders');
  sub('inventory', 'inventory');
  sub('bom', 'bom');
  scheduleDraw();
}

function draw(container) {
  const { workOrders, inventory, bom, errors } = state;

  const queued = workOrders.filter(w => w.status === 'queued');
  const inProgress = workOrders.filter(w => w.status === 'in_progress');
  const qa = workOrders.filter(w => w.status === 'qa');
  const completed = workOrders.filter(w => w.status === 'completed');
  const onHold = workOrders.filter(w => w.status === 'on_hold');

  // Units produced this month (completed WOs × quantity)
  const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0,0,0,0);
  const thisMonthCompleted = workOrders.filter(w => {
    if (w.status !== 'completed') return false;
    const t = w.completedAt?.toDate?.()?.getTime() || w.updatedAt?.toDate?.()?.getTime() || 0;
    return t >= startOfMonth.getTime();
  });
  const unitsProducedThisMonth = thisMonthCompleted.reduce((s, w) => s + (Number(w.quantity) || 0), 0);

  // Overdue WOs
  const now = Date.now();
  const overdue = workOrders.filter(w => {
    if (['completed', 'cancelled'].includes(w.status)) return false;
    const due = w.dueDate ? new Date(w.dueDate).getTime() : 0;
    return due && due < now;
  });

  const lowStock = inventory.filter(i => {
    const qty = Number(i.quantity ?? i.stock ?? 0);
    const reorder = Number(i.reorderPoint ?? i.minStock ?? 0);
    return reorder > 0 && qty <= reorder;
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
    ${kpi('Queued', String(queued.length))}
    ${kpi('In Progress', String(inProgress.length), '#0d9488')}
    ${kpi('QA', String(qa.length), '#d97706')}
    ${kpi('Overdue', String(overdue.length), overdue.length > 0 ? '#dc2626' : '')}
    ${kpi('On Hold', String(onHold.length))}
    ${kpi('Units (this month)', String(unitsProducedThisMonth), '#059669')}
    ${kpi('Active BOMs', String(bom.filter(b => b.active === 'active').length))}
    ${kpi('Low stock parts', String(lowStock.length), lowStock.length > 0 ? '#d97706' : '')}
  `;
  container.appendChild(kpis);

  const layout = document.createElement('div');
  layout.style.cssText = 'display:grid;grid-template-columns:2fr 1fr;gap:1rem;';
  layout.innerHTML = `
    <div class="settings-section">
      <h3 class="section-title">WIP Pipeline</h3>
      <div style="display:grid;grid-template-columns:repeat(5, 1fr);gap:0.5rem;margin-top:0.5rem;">
        ${['queued', 'in_progress', 'qa', 'completed', 'on_hold'].map(s => {
          const count = workOrders.filter(w => w.status === s).length;
          const fill = Math.min(100, count * 10);
          const bgMap = { queued: '#dbeafe', in_progress: '#99f6e4', qa: '#fde68a', completed: '#d1fae5', on_hold: '#f1f5f9' };
          return `
            <div style="text-align:center;padding:0.75rem;background:${bgMap[s]};border-radius:8px;">
              <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--gray-dark);">${formatLabel(s)}</div>
              <div style="font-size:1.5rem;font-weight:700;margin:0.2rem 0;">${count}</div>
              <div style="height:4px;background:rgba(0,0,0,0.05);border-radius:2px;overflow:hidden;">
                <div style="width:${fill}%;height:100%;background:rgba(0,0,0,0.2);"></div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
      ${overdue.length > 0 ? `
        <h4 style="margin:1rem 0 0.5rem;font-size:0.85rem;color:var(--danger);">Overdue Work Orders (${overdue.length})</h4>
        ${overdue.slice(0, 5).map(w => `
          <div style="padding:0.4rem 0;border-bottom:1px solid var(--off-white);font-size:0.85rem;display:flex;justify-content:space-between;">
            <span>${escapeHtml(w.orderNumber || '')} · ${escapeHtml(w.product || '')}</span>
            <span style="color:var(--danger);">Due ${fmtDate(w.dueDate)}</span>
          </div>
        `).join('')}
      ` : ''}
    </div>
    <div class="settings-section">
      <h3 class="section-title">Low Stock Parts</h3>
      ${lowStock.length === 0
        ? '<div style="color:var(--gray);padding:0.5rem 0;font-size:0.85rem;">All inventory healthy.</div>'
        : lowStock.slice(0, 10).map(i => {
            const qty = Number(i.quantity ?? i.stock ?? 0);
            const reorder = Number(i.reorderPoint ?? i.minStock ?? 0);
            return `
              <div style="padding:0.4rem 0;border-bottom:1px solid var(--off-white);font-size:0.85rem;display:flex;justify-content:space-between;">
                <span>${escapeHtml(i.name || i.partName || '—')}</span>
                <span><span class="badge ${qty === 0 ? 'badge-danger' : 'badge-warning'}">${qty} / ${reorder}</span></span>
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
function fmtDate(v) { if (!v) return '—'; try { const d = v.toDate ? v.toDate() : new Date(v); if (isNaN(d.getTime())) return '—'; return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { return '—'; } }
function formatLabel(s) { return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }
function escapeHtml(s) { if (s == null) return ''; const n = document.createElement('span'); n.appendChild(document.createTextNode(String(s))); return n.innerHTML; }
