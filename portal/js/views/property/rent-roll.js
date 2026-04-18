// ─────────────────────────────────────────────────────────────────
//  rent-roll.js — Property-management dashboard showing every unit,
//  its occupancy, tenant, rent, and last payment. Click-through to
//  unit detail or tenant's lease.
// ─────────────────────────────────────────────────────────────────

import { db } from '../../config.js';
import {
  collection, onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getTenantId } from '../../tenant-context.js';

let unsubs = [];
let state = {
  units: [],
  leases: [],
  invoicesCrm: [],
  payments: [],
  errors: {},
};
let renderTimer = null;

export function init() {}

export function destroy() {
  unsubs.forEach(u => { try { u(); } catch {} });
  unsubs = [];
  if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
}

export function render() {
  const container = document.getElementById('view-rent-roll');
  if (!container) return;
  destroy();
  container.innerHTML = '<div class="loading">Loading rent roll…</div>';

  const tenantId = getTenantId();
  if (!tenantId) return;

  function scheduleDraw() {
    if (renderTimer) return;
    renderTimer = setTimeout(() => { renderTimer = null; draw(container, state); }, 50);
  }

  const subscribe = (collName, key) => {
    try {
      const u = onSnapshot(
        collection(db, 'tenants', tenantId, collName),
        (snap) => {
          state[key] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          delete state.errors[key];
          scheduleDraw();
        },
        (err) => {
          state.errors[key] = err.code || err.message;
          console.warn(`[rent-roll] ${key} error:`, err);
          scheduleDraw();
        }
      );
      unsubs.push(u);
    } catch (err) {
      state.errors[key] = err.message;
    }
  };

  subscribe('units', 'units');
  subscribe('leases', 'leases');
  subscribe('invoices_crm', 'invoicesCrm');
  subscribe('payments', 'payments');
  scheduleDraw();
}

function draw(container, state) {
  const { units, leases, invoicesCrm, errors } = state;
  const errorKeys = Object.keys(errors || {});
  const occupied = units.filter(u => u.status === 'occupied').length;
  const vacant = units.filter(u => u.status === 'vacant').length;
  const maintenance = units.filter(u => u.status === 'maintenance').length;
  const totalRent = units.reduce((s, u) => s + (Number(u.baseRent) || 0), 0);
  const collectingRent = units
    .filter(u => u.status === 'occupied')
    .reduce((s, u) => s + (Number(u.baseRent) || 0), 0);

  const now = Date.now();
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  // Rent invoices this month = invoices_crm with source.chargeType == 'rent' this month
  const thisMonthRentInvoices = invoicesCrm.filter(i => {
    if (i.source?.chargeType !== 'rent') return false;
    const issued = i.issueDate ? new Date(i.issueDate).getTime() : 0;
    return issued >= startOfMonth.getTime();
  });
  const paidThisMonth = thisMonthRentInvoices
    .filter(i => i.status === 'paid')
    .reduce((s, i) => s + (Number(i.total) || 0), 0);
  const openThisMonth = thisMonthRentInvoices
    .filter(i => ['sent', 'overdue', 'partial'].includes(i.status))
    .reduce((s, i) => s + Math.max(0, Math.abs(Number(i.total || 0)) - Number(i.paidAmount || 0)), 0);

  // Per-unit last-payment / next-due lookup
  const leaseByUnit = {};
  leases.forEach(l => { if (l.unitId) leaseByUnit[l.unitId] = l; });
  const invoicesByLease = {};
  invoicesCrm.forEach(i => {
    if (i.source?.parentType === 'lease' && i.source.parentId) {
      (invoicesByLease[i.source.parentId] ||= []).push(i);
    }
  });

  container.innerHTML = '';

  if (errorKeys.length > 0) {
    const banner = document.createElement('div');
    banner.style.cssText = 'padding:0.75rem 1rem;margin-bottom:0.75rem;background:rgba(220,38,38,0.08);color:var(--danger,#dc2626);border-radius:8px;font-size:0.85rem;';
    banner.innerHTML = `<strong>Can't load some data:</strong> ${errorKeys.map(k => `${escapeHtml(k)} — ${escapeHtml(errors[k])}`).join('; ')}`;
    container.appendChild(banner);
  }

  // Header summary
  const summary = document.createElement('div');
  summary.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:0.75rem;margin-bottom:1rem;';
  summary.innerHTML = `
    ${kpi('Total Units', String(units.length))}
    ${kpi('Occupied', `${occupied} (${units.length ? Math.round((occupied / units.length) * 100) : 0}%)`, '#059669')}
    ${kpi('Vacant', String(vacant), '#d97706')}
    ${kpi('Maintenance', String(maintenance))}
    ${kpi('Rent Potential', fmtMoney(totalRent))}
    ${kpi('Collecting (active)', fmtMoney(collectingRent), '#059669')}
    ${kpi('Paid this month', fmtMoney(paidThisMonth), '#059669')}
    ${kpi('Open this month', fmtMoney(openThisMonth), openThisMonth > 0 ? '#dc2626' : '')}
  `;
  container.appendChild(summary);

  // Property filter
  const properties = [...new Set(units.map(u => u.propertyName).filter(Boolean))].sort();
  const toolbar = document.createElement('div');
  toolbar.style.cssText = 'display:flex;gap:0.5rem;align-items:center;margin-bottom:0.75rem;flex-wrap:wrap;';
  toolbar.innerHTML = `
    <label style="font-size:0.85rem;display:flex;gap:0.3rem;align-items:center;">
      Property
      <select id="rentRollPropFilter" style="padding:0.35rem 0.5rem;border:1px solid var(--off-white);border-radius:6px;">
        <option value="">All</option>
        ${properties.map(p => `<option value="${escapeAttr(p)}">${escapeHtml(p)}</option>`).join('')}
      </select>
    </label>
    <label style="font-size:0.85rem;display:flex;gap:0.3rem;align-items:center;">
      Status
      <select id="rentRollStatusFilter" style="padding:0.35rem 0.5rem;border:1px solid var(--off-white);border-radius:6px;">
        <option value="">All</option>
        <option value="occupied">Occupied</option>
        <option value="vacant">Vacant</option>
        <option value="maintenance">Maintenance</option>
      </select>
    </label>
    <input type="search" id="rentRollSearch" placeholder="Search unit / tenant…" style="padding:0.35rem 0.5rem;border:1px solid var(--off-white);border-radius:6px;font-size:0.85rem;flex:1;max-width:260px;">
  `;
  container.appendChild(toolbar);

  const tableWrap = document.createElement('div');
  tableWrap.style.cssText = 'background:white;border:1px solid var(--off-white);border-radius:10px;overflow:auto;';
  container.appendChild(tableWrap);

  const propFilter = toolbar.querySelector('#rentRollPropFilter');
  const statusFilter = toolbar.querySelector('#rentRollStatusFilter');
  const searchInput = toolbar.querySelector('#rentRollSearch');

  function redrawTable() {
    const prop = propFilter.value;
    const statusF = statusFilter.value;
    const search = (searchInput.value || '').toLowerCase();

    let rows = [...units];
    if (prop) rows = rows.filter(u => u.propertyName === prop);
    if (statusF) rows = rows.filter(u => u.status === statusF);
    if (search) rows = rows.filter(u =>
      (u.label || '').toLowerCase().includes(search) ||
      (u.currentTenantName || '').toLowerCase().includes(search) ||
      (u.propertyName || '').toLowerCase().includes(search)
    );
    rows.sort((a, b) => {
      if (a.propertyName !== b.propertyName) return (a.propertyName || '').localeCompare(b.propertyName || '');
      return naturalCompare(a.label || '', b.label || '');
    });

    if (rows.length === 0) {
      tableWrap.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--gray);">No units match the filters.</div>`;
      return;
    }

    tableWrap.innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>Property</th><th>Unit</th><th>BR/BA</th><th>Sq Ft</th><th>Rent</th><th>Status</th><th>Tenant</th><th>Last Rent Paid</th><th>Next Due</th>
        </tr></thead>
        <tbody>
          ${rows.map(u => {
            const lease = leaseByUnit[u.id];
            const leaseInvoices = (lease && invoicesByLease[lease.id]) || [];
            const paidInvoices = leaseInvoices.filter(i => i.status === 'paid');
            const lastPaid = paidInvoices.sort((a, b) => new Date(b.issueDate || 0) - new Date(a.issueDate || 0))[0];
            const openInvoices = leaseInvoices.filter(i => ['sent', 'overdue', 'partial'].includes(i.status));
            const nextDue = openInvoices.sort((a, b) => new Date(a.dueDate || 0) - new Date(b.dueDate || 0))[0];
            const overdue = nextDue && nextDue.dueDate && new Date(nextDue.dueDate).getTime() < now;
            return `
              <tr>
                <td>${escapeHtml(u.propertyName || '—')}</td>
                <td style="font-weight:500;">${escapeHtml(u.label || '—')}</td>
                <td>${escapeHtml((u.bedrooms || 0) + ' / ' + (u.bathrooms || 0))}</td>
                <td>${u.sqft ? escapeHtml(String(u.sqft)) : '—'}</td>
                <td style="font-variant-numeric:tabular-nums;">${u.baseRent ? fmtMoney(u.baseRent) : '—'}</td>
                <td><span class="badge ${badgeFor(u.status)}">${escapeHtml(u.status || 'vacant')}</span></td>
                <td>${escapeHtml(u.currentTenantName || '—')}</td>
                <td style="font-size:0.85rem;">${lastPaid ? `${fmtMoney(lastPaid.total)}<div style="color:var(--gray);font-size:0.72rem;">${fmtDate(lastPaid.issueDate)}</div>` : '—'}</td>
                <td style="font-size:0.85rem;${overdue ? 'color:var(--danger,#dc2626);' : ''}">${nextDue ? `${fmtMoney(Math.max(0, Math.abs(nextDue.total || 0) - Number(nextDue.paidAmount || 0)))}<div style="font-size:0.72rem;">${overdue ? 'OVERDUE ' : 'Due '}${fmtDate(nextDue.dueDate)}</div>` : '—'}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  propFilter.addEventListener('change', redrawTable);
  statusFilter.addEventListener('change', redrawTable);
  searchInput.addEventListener('input', redrawTable);
  redrawTable();
}

// ── Helpers ─────────────────────────────────────────────────────

function kpi(label, value, color) {
  return `
    <div style="padding:0.7rem 0.85rem;background:white;border:1px solid var(--off-white);border-radius:10px;">
      <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--gray-dark);">${escapeHtml(label)}</div>
      <div style="font-size:1.25rem;font-weight:600;font-variant-numeric:tabular-nums;margin-top:0.15rem;${color ? `color:${color};` : ''}">${escapeHtml(value)}</div>
    </div>
  `;
}

function badgeFor(s) {
  return s === 'occupied' ? 'badge-success'
       : s === 'vacant' ? 'badge-info'
       : s === 'maintenance' ? 'badge-warning'
       : 'badge-default';
}

function fmtMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function fmtDate(v) {
  if (!v) return '—';
  try {
    const d = v.toDate ? v.toDate() : new Date(v);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return '—'; }
}

function escapeHtml(s) {
  if (s == null) return '';
  const n = document.createElement('span');
  n.appendChild(document.createTextNode(String(s)));
  return n.innerHTML;
}

function escapeAttr(s) {
  return String(s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function naturalCompare(a, b) {
  const ax = [], bx = [];
  a.replace(/(\d+)|(\D+)/g, (_, $1, $2) => { ax.push([$1 || 1e10, $2 || '']); });
  b.replace(/(\d+)|(\D+)/g, (_, $1, $2) => { bx.push([$1 || 1e10, $2 || '']); });
  while (ax.length && bx.length) {
    const an = ax.shift(), bn = bx.shift();
    const nn = Number(an[0]) - Number(bn[0]);
    if (nn) return nn;
    if (an[1] !== bn[1]) return an[1].localeCompare(bn[1]);
  }
  return ax.length - bx.length;
}
