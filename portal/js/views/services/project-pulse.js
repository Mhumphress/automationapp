// ─────────────────────────────────────────────────────────────────
//  project-pulse.js — Services-vertical dashboard.
//  Budget vs actual across active projects, unbilled hours,
//  retainer balance, profitability signals.
// ─────────────────────────────────────────────────────────────────

import { db } from '../../config.js';
import { collection, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getTenantId } from '../../tenant-context.js';

let unsubs = [];
let state = { projects: [], timeEntries: [], invoicesCrm: [], recurringCharges: [], errors: {} };
let renderTimer = null;

export function init() {}
export function destroy() {
  unsubs.forEach(u => { try { u(); } catch {} });
  unsubs = [];
  if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
}

export function render() {
  const container = document.getElementById('view-project-pulse');
  if (!container) return;
  destroy();
  container.innerHTML = '<div class="loading">Loading project pulse…</div>';
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
  sub('projects', 'projects');
  sub('time_entries', 'timeEntries');
  sub('invoices_crm', 'invoicesCrm');
  sub('recurring_charges', 'recurringCharges');
  scheduleDraw();
}

function draw(container) {
  const { projects, timeEntries, invoicesCrm, recurringCharges, errors } = state;

  const active = projects.filter(p => p.status === 'active');
  const planning = projects.filter(p => p.status === 'planning');
  const onHold = projects.filter(p => p.status === 'on_hold');

  const totalBudget = active.reduce((s, p) => s + (Number(p.budget) || 0), 0);

  // Per-project rollup
  const rollups = active.map(p => {
    const entries = timeEntries.filter(e => e.project === p.name);
    const hours = entries.reduce((s, e) => s + (Number(e.hours) || 0), 0);
    const billable = entries.filter(e => e.billable === 'billable' || e.billable === true);
    const billableHours = billable.reduce((s, e) => s + (Number(e.hours) || 0), 0);
    const billableRevenue = billable.reduce((s, e) => s + (Number(e.hours) || 0) * (Number(e.rate) || 0), 0);
    const invoiced = invoicesCrm
      .filter(i => i.source?.parentType === 'project' && i.source.parentId === p.id)
      .reduce((s, i) => s + (Number(i.total) || 0), 0);
    const paid = invoicesCrm
      .filter(i => i.source?.parentType === 'project' && i.source.parentId === p.id && i.status === 'paid')
      .reduce((s, i) => s + (Number(i.total) || 0), 0);
    const budget = Number(p.budget) || 0;
    const budgetUsedPct = budget > 0 ? Math.round((billableRevenue / budget) * 100) : 0;
    const unbilledRevenue = Math.max(0, billableRevenue - invoiced);
    return { p, hours, billableHours, billableRevenue, invoiced, paid, budget, budgetUsedPct, unbilledRevenue };
  }).sort((a, b) => b.unbilledRevenue - a.unbilledRevenue);

  const totalBillableHours = rollups.reduce((s, r) => s + r.billableHours, 0);
  const totalUnbilled = rollups.reduce((s, r) => s + r.unbilledRevenue, 0);
  const totalInvoiced = rollups.reduce((s, r) => s + r.invoiced, 0);
  const totalPaid = rollups.reduce((s, r) => s + r.paid, 0);

  const retainerCharges = recurringCharges.filter(c => c.chargeType === 'retainer' && c.status === 'active');
  const monthlyRetainerRevenue = retainerCharges
    .filter(c => c.frequency === 'monthly')
    .reduce((s, c) => s + (Number(c.amount) || 0), 0);

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
    ${kpi('Active projects', String(active.length))}
    ${kpi('Planning', String(planning.length))}
    ${kpi('On hold', String(onHold.length), onHold.length > 0 ? '#d97706' : '')}
    ${kpi('Total budget', fmtMoney(totalBudget))}
    ${kpi('Billable hours', `${totalBillableHours.toFixed(1)}h`)}
    ${kpi('Unbilled', fmtMoney(totalUnbilled), totalUnbilled > 0 ? '#d97706' : '')}
    ${kpi('Invoiced', fmtMoney(totalInvoiced))}
    ${kpi('Paid', fmtMoney(totalPaid), '#059669')}
    ${kpi('Retainer MRR', fmtMoney(monthlyRetainerRevenue), '#059669')}
  `;
  container.appendChild(kpis);

  const table = document.createElement('div');
  table.className = 'settings-section';
  table.innerHTML = `<h3 class="section-title">Active projects — budget vs actual</h3>`;
  if (rollups.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'color:var(--gray);padding:0.5rem 0;font-size:0.85rem;';
    empty.textContent = 'No active projects.';
    table.appendChild(empty);
  } else {
    const t = document.createElement('table');
    t.className = 'data-table';
    t.innerHTML = `
      <thead><tr>
        <th>Project</th><th>Client</th><th>Budget</th><th>Billable</th><th>Used</th><th>Invoiced</th><th>Paid</th><th>Unbilled</th>
      </tr></thead>
      <tbody>
        ${rollups.map(r => {
          const usedClass = r.budgetUsedPct > 100 ? 'badge-danger' : r.budgetUsedPct > 80 ? 'badge-warning' : 'badge-info';
          return `
            <tr>
              <td style="font-weight:500;">${escapeHtml(r.p.name || '')}</td>
              <td>${escapeHtml(r.p.clientName || '—')}</td>
              <td>${fmtMoney(r.budget)}</td>
              <td>${fmtMoney(r.billableRevenue)}<div style="font-size:0.72rem;color:var(--gray-dark);">${r.billableHours.toFixed(1)}h</div></td>
              <td><span class="badge ${usedClass}">${r.budgetUsedPct}%</span></td>
              <td>${fmtMoney(r.invoiced)}</td>
              <td style="color:#059669;">${fmtMoney(r.paid)}</td>
              <td style="${r.unbilledRevenue > 0 ? 'color:#d97706;font-weight:500;' : ''}">${fmtMoney(r.unbilledRevenue)}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    `;
    table.appendChild(t);
  }
  container.appendChild(table);
}

function kpi(label, value, color) {
  return `
    <div style="padding:0.7rem 0.85rem;background:white;border:1px solid var(--off-white);border-radius:10px;">
      <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--gray-dark);">${escapeHtml(label)}</div>
      <div style="font-size:1.15rem;font-weight:600;margin-top:0.15rem;${color ? `color:${color};` : ''}">${escapeHtml(value)}</div>
    </div>
  `;
}
function fmtMoney(v) { const n = Number(v); return !Number.isFinite(n) ? '$0.00' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n); }
function escapeHtml(s) { if (s == null) return ''; const n = document.createElement('span'); n.appendChild(document.createTextNode(String(s))); return n.innerHTML; }
