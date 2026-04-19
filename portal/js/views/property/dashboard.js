// ─────────────────────────────────────────────────────────────────
//  property/dashboard.js — Property Management main Dashboard.
//  Replaces the repair-flavored default view. Shows occupancy,
//  rent collection, lease renewals, maintenance, recent activity.
// ─────────────────────────────────────────────────────────────────

import { db } from '../../config.js';
import { collection, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getTenant, getPackage, getTenantId } from '../../tenant-context.js';

let unsubs = [];
let store = {
  units: [], leases: [], invoicesCrm: [], payments: [], maintenance: [],
  errors: {},
};
let redrawTimer = null;

export function init() {}

export function destroy() {
  unsubs.forEach(u => { try { u(); } catch {} });
  unsubs = [];
  if (redrawTimer) { clearTimeout(redrawTimer); redrawTimer = null; }
}

export async function render() {
  destroy();
  const container = document.getElementById('view-dashboard');
  if (!container) return;
  container.innerHTML = '<div class="loading">Loading dashboard…</div>';

  const tid = getTenantId();
  if (!tid) { container.innerHTML = '<p style="color:var(--danger);padding:1rem;">No tenant context.</p>'; return; }

  store = { units: [], leases: [], invoicesCrm: [], payments: [], maintenance: [], errors: {} };

  const scheduleDraw = () => {
    if (redrawTimer) return;
    redrawTimer = setTimeout(() => { redrawTimer = null; draw(container); }, 80);
  };

  const sub = (coll, key) => {
    try {
      unsubs.push(onSnapshot(
        collection(db, 'tenants', tid, coll),
        (snap) => { store[key] = snap.docs.map(d => ({ id: d.id, ...d.data() })); delete store.errors[key]; scheduleDraw(); },
        (err) => { store.errors[key] = err.code || err.message; scheduleDraw(); }
      ));
    } catch (err) { store.errors[key] = err.message; }
  };

  sub('units', 'units');
  sub('leases', 'leases');
  sub('invoices_crm', 'invoicesCrm');
  sub('payments', 'payments');
  sub('maintenance', 'maintenance');
  scheduleDraw();
}

function draw(container) {
  const { units, leases, invoicesCrm, payments, maintenance, errors } = store;
  const tenant = getTenant();
  const pkg = getPackage();
  const today = new Date();

  // ── Occupancy ────────────────────────────────────────────
  const occupied = units.filter(u => u.status === 'occupied').length;
  const vacant = units.filter(u => u.status === 'vacant').length;
  const maintenanceUnits = units.filter(u => u.status === 'maintenance').length;
  const occupancyPct = units.length > 0 ? Math.round((occupied / units.length) * 100) : 0;

  // ── Rent ─────────────────────────────────────────────────
  const rentPotential = units.reduce((s, u) => s + (Number(u.baseRent) || 0), 0);
  const rentCollectingMonthly = units
    .filter(u => u.status === 'occupied')
    .reduce((s, u) => s + (Number(u.baseRent) || 0), 0);

  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
  const rentInvoicesThisMonth = invoicesCrm.filter(i => {
    if (i.source?.chargeType !== 'rent') return false;
    const issued = i.issueDate ? new Date(i.issueDate).getTime() : 0;
    return issued >= startOfMonth;
  });
  const paidThisMonth = rentInvoicesThisMonth
    .filter(i => i.status === 'paid')
    .reduce((s, i) => s + (Number(i.total) || 0), 0);
  const openThisMonth = rentInvoicesThisMonth
    .filter(i => ['sent', 'overdue', 'partial'].includes(i.status))
    .reduce((s, i) => {
      const total = Math.abs(Number(i.total || 0));
      const paid = Number(i.paidAmount || 0);
      return s + Math.max(0, total - paid);
    }, 0);

  // All-time open rent (all outstanding rent invoices)
  const allOpenRent = invoicesCrm
    .filter(i => i.source?.chargeType === 'rent' && ['sent', 'overdue', 'partial'].includes(i.status))
    .reduce((s, i) => s + Math.max(0, Math.abs(Number(i.total || 0)) - Number(i.paidAmount || 0)), 0);
  const overdueCount = invoicesCrm
    .filter(i => i.source?.chargeType === 'rent' && (i.status === 'overdue' || (i.status === 'sent' && i.dueDate && new Date(i.dueDate).getTime() < Date.now())))
    .length;

  // ── Lease renewals ───────────────────────────────────────
  const in60 = Date.now() + 60 * 86400000;
  const expiringSoon = leases.filter(l => {
    if (l.status !== 'active') return false;
    const end = l.endDate?.toDate?.()?.getTime?.() || (l.endDate ? new Date(l.endDate).getTime() : 0);
    return end > 0 && end <= in60 && end >= Date.now();
  }).sort((a, b) => (a.endDate?.toDate?.()?.getTime?.() || 0) - (b.endDate?.toDate?.()?.getTime?.() || 0));

  const expired = leases.filter(l => {
    if (l.status !== 'active') return false;
    const end = l.endDate?.toDate?.()?.getTime?.() || (l.endDate ? new Date(l.endDate).getTime() : 0);
    return end > 0 && end < Date.now();
  }).length;

  // ── Maintenance ──────────────────────────────────────────
  const openMaint = maintenance.filter(m => !['completed', 'cancelled'].includes(m.status));
  const emergencyMaint = openMaint.filter(m => m.priority === 'emergency').length;
  const highMaint = openMaint.filter(m => m.priority === 'high').length;

  // ── Recent activity ──────────────────────────────────────
  const events = [];
  leases.forEach(l => {
    if (l.createdAt) events.push({
      kind: 'lease',
      text: `New lease — <strong>${escapeHtml(l.tenantName || 'Tenant')}</strong> at ${escapeHtml(l.property || '')} ${escapeHtml(l.unit || '')}`,
      time: l.createdAt.toDate ? l.createdAt.toDate() : new Date(l.createdAt),
      id: l.id, tone: 'new',
    });
    if (l.endedAt) events.push({
      kind: 'lease',
      text: `Lease ended — <strong>${escapeHtml(l.tenantName || 'Tenant')}</strong>`,
      time: l.endedAt.toDate ? l.endedAt.toDate() : new Date(l.endedAt),
      id: l.id, tone: 'ended',
    });
  });
  payments.forEach(p => {
    if (p.receivedAt) events.push({
      kind: 'payment',
      text: `Payment received — <strong>${fmtMoney(p.amount)}</strong> via ${escapeHtml(p.method || 'manual')}`,
      time: p.receivedAt.toDate ? p.receivedAt.toDate() : new Date(p.receivedAt),
      id: p.id, tone: 'paid',
    });
  });
  maintenance.forEach(m => {
    if (m.createdAt) events.push({
      kind: 'maintenance',
      text: `Maintenance — <strong>${escapeHtml(m.issue || 'Request')}</strong> at ${escapeHtml(m.property || '')} ${escapeHtml(m.unit || '')}`,
      time: m.createdAt.toDate ? m.createdAt.toDate() : new Date(m.createdAt),
      id: m.id, tone: m.priority === 'emergency' ? 'urgent' : 'new',
    });
  });
  events.sort((a, b) => b.time.getTime() - a.time.getTime());
  const feed = events.slice(0, 15);

  const errorKeys = Object.keys(errors || {});
  const errorHtml = errorKeys.length > 0 ? `
    <div style="padding:0.75rem;margin-bottom:0.75rem;background:rgba(220,38,38,0.08);color:var(--danger);border-radius:8px;font-size:0.85rem;">
      <strong>Can't load some data:</strong> ${errorKeys.map(k => `${escapeHtml(k)}: ${escapeHtml(errors[k])}`).join('; ')}
    </div>` : '';

  container.innerHTML = `
    <style>${DASH_CSS}</style>
    ${errorHtml}
    <div class="dash-hero">
      <div>
        <h1>Welcome back</h1>
        <h2>${escapeHtml(tenant.companyName || 'Your business')}</h2>
        <div class="meta">${escapeHtml(today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }))} · ${escapeHtml(pkg ? pkg.name : '—')} · ${units.length} units · ${leases.filter(l => l.status === 'active').length} active leases</div>
      </div>
      <div class="hero-right">
        <div class="live-dot" title="Live — updates as data changes"></div>
        <div class="status-chip">${escapeHtml(tenant.status || 'active')}</div>
      </div>
    </div>

    <div class="kpi-grid">
      ${kpiCard('occupancy', 'Occupancy', `${occupancyPct}%`, null,
        `${occupied} occupied · ${vacant} vacant${maintenanceUnits > 0 ? ' · ' + maintenanceUnits + ' maintenance' : ''}`,
        occupancyPct >= 90 ? 'ok' : occupancyPct >= 70 ? 'neutral' : 'warn')}
      ${kpiCard('rent-collected', 'Rent Collected (MTD)', fmtMoney(paidThisMonth), null,
        `of ${fmtMoney(rentCollectingMonthly)} potential · ${rentInvoicesThisMonth.length} rent invoice${rentInvoicesThisMonth.length === 1 ? '' : 's'} issued`, 'ok')}
      ${kpiCard('open-rent', 'Open Rent', fmtMoney(allOpenRent), null,
        overdueCount > 0 ? `${overdueCount} overdue` : `${openThisMonth > 0 ? fmtMoney(openThisMonth) + ' this month' : 'None this month'}`,
        overdueCount > 0 ? 'warn' : allOpenRent > 0 ? 'neutral' : 'ok')}
      ${kpiCard('renewals', 'Renewals (60d)', String(expiringSoon.length), null,
        expired > 0 ? `${expired} already expired` : (expiringSoon.length > 0 ? 'Act now to retain' : 'No action needed'),
        expired > 0 ? 'warn' : expiringSoon.length > 0 ? 'neutral' : 'ok')}
      ${kpiCard('maintenance', 'Open Maintenance', String(openMaint.length), null,
        emergencyMaint > 0 ? `${emergencyMaint} emergency` : highMaint > 0 ? `${highMaint} high priority` : 'All under control',
        emergencyMaint > 0 ? 'warn' : openMaint.length > 0 ? 'neutral' : 'ok')}
      ${kpiCard('rent-potential', 'Monthly Potential', fmtMoney(rentPotential), null,
        `if every unit occupied · now collecting ${fmtMoney(rentCollectingMonthly)}`, 'neutral')}
    </div>

    <div class="dash-split">
      <div class="chart-card">
        <div class="chart-head"><h3>Upcoming Renewals</h3><span class="chart-hint">Next 60 days</span></div>
        ${expiringSoon.length === 0
          ? '<p style="color:var(--gray);font-size:0.9rem;padding:1rem 0;">No leases expiring in the next 60 days.</p>'
          : `<table class="data-table"><thead><tr><th>Tenant</th><th>Unit</th><th>Rent</th><th>Ends</th></tr></thead><tbody>
              ${expiringSoon.slice(0, 8).map(l => {
                const end = l.endDate?.toDate?.();
                const days = end ? Math.round((end.getTime() - Date.now()) / 86400000) : 0;
                return `<tr>
                  <td style="font-weight:500;">${escapeHtml(l.tenantName || '—')}</td>
                  <td>${escapeHtml(l.property || '')} · ${escapeHtml(l.unit || '')}</td>
                  <td>${fmtMoney(l.monthlyRent)}</td>
                  <td><span class="badge ${days <= 14 ? 'badge-danger' : days <= 30 ? 'badge-warning' : 'badge-info'}">${days}d</span></td>
                </tr>`;
              }).join('')}
            </tbody></table>`}
      </div>

      <div class="chart-card">
        <div class="chart-head"><h3>Open Maintenance</h3><span class="chart-hint">Needs attention</span></div>
        ${openMaint.length === 0
          ? '<p style="color:var(--gray);font-size:0.9rem;padding:1rem 0;">Nothing open — all clear.</p>'
          : `<table class="data-table"><thead><tr><th>Issue</th><th>Where</th><th>Priority</th><th>Status</th></tr></thead><tbody>
              ${openMaint.slice(0, 8).map(m => `
                <tr>
                  <td style="font-weight:500;">${escapeHtml(m.issue || '—')}</td>
                  <td>${escapeHtml(m.property || '')} ${escapeHtml(m.unit || '')}</td>
                  <td><span class="badge ${m.priority === 'emergency' ? 'badge-danger' : m.priority === 'high' ? 'badge-warning' : 'badge-default'}">${escapeHtml(m.priority || 'medium')}</span></td>
                  <td><span class="badge badge-info">${escapeHtml(m.status || 'open')}</span></td>
                </tr>
              `).join('')}
            </tbody></table>`}
      </div>
    </div>

    <div class="chart-card" style="margin-top:1rem;">
      <div class="chart-head"><h3>Recent Activity</h3><span class="chart-hint">Across all properties</span></div>
      <div class="activity-feed">
        ${feed.length === 0
          ? '<p style="color:var(--gray);font-size:0.9rem;padding:1rem 0;">No activity yet.</p>'
          : feed.map(e => `
              <div class="activity-row">
                <div class="activity-dot tone-${escapeHtml(e.tone)}"></div>
                <div class="activity-text">
                  <div>${e.text}</div>
                  <div class="meta">${escapeHtml(relativeTime(e.time))}</div>
                </div>
              </div>
            `).join('')}
      </div>
    </div>
  `;

  // KPI drilldowns
  container.querySelector('[data-kpi="occupancy"]')?.addEventListener('click', () => { window.location.hash = 'units'; });
  container.querySelector('[data-kpi="rent-collected"]')?.addEventListener('click', () => { window.location.hash = 'invoicing'; });
  container.querySelector('[data-kpi="open-rent"]')?.addEventListener('click', () => { window.location.hash = 'rent-roll'; });
  container.querySelector('[data-kpi="renewals"]')?.addEventListener('click', () => { window.location.hash = 'leases'; });
  container.querySelector('[data-kpi="maintenance"]')?.addEventListener('click', () => { window.location.hash = 'maintenance'; });
  container.querySelector('[data-kpi="rent-potential"]')?.addEventListener('click', () => { window.location.hash = 'rent-roll'; });
}

// ── Helpers ─────────────────────────────────────────────

function kpiCard(key, label, value, delta, sub, tone) {
  const color = tone === 'ok' ? '#059669' : tone === 'warn' ? '#d97706' : '';
  return `
    <div class="kpi" data-kpi="${escapeHtml(key)}" role="button" tabindex="0">
      <div class="kpi-label">${escapeHtml(label)}</div>
      <div class="kpi-value"${color ? ` style="color:${color};"` : ''}>${escapeHtml(value)}</div>
      <div class="kpi-sub">${escapeHtml(sub)}</div>
    </div>
  `;
}

function fmtMoney(v) { const n = Number(v); return !Number.isFinite(n) ? '$0' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n); }

function relativeTime(d) {
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function escapeHtml(s) {
  if (s == null) return '';
  const n = document.createElement('span');
  n.appendChild(document.createTextNode(String(s)));
  return n.innerHTML;
}

const DASH_CSS = `
  .dash-hero {
    background: linear-gradient(135deg, var(--accent) 0%, var(--accent-strong, #2563eb) 100%);
    color: #fff;
    border-radius: 16px;
    padding: 2rem 2.5rem;
    margin-bottom: 1.5rem;
    display: flex; justify-content: space-between; align-items: center;
    box-shadow: 0 10px 40px rgba(0,0,0,0.06);
  }
  .dash-hero h1 { font-size: 1.15rem; font-weight: 400; opacity: 0.85; margin: 0; }
  .dash-hero h2 { font-size: 2rem; font-weight: 600; margin: 0.15rem 0 0.35rem; letter-spacing: -0.01em; }
  .dash-hero .meta { font-size: 0.9rem; opacity: 0.82; }
  .dash-hero .hero-right { display: flex; align-items: center; gap: 0.75rem; }
  .dash-hero .status-chip {
    background: rgba(255,255,255,0.16);
    padding: 0.35rem 0.9rem;
    border-radius: 999px;
    font-size: 0.85rem; font-weight: 500; text-transform: capitalize;
  }
  .live-dot {
    width: 10px; height: 10px; border-radius: 50%;
    background: #34d399;
    box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.7);
    animation: livePulse 2s infinite;
  }
  @keyframes livePulse {
    0% { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.7); }
    70% { box-shadow: 0 0 0 10px rgba(52, 211, 153, 0); }
    100% { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0); }
  }
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 1rem;
    margin-bottom: 1.5rem;
  }
  .kpi {
    background: #fff;
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 14px;
    padding: 1.25rem;
    cursor: pointer;
    transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
    position: relative;
  }
  .kpi:hover { transform: translateY(-2px); box-shadow: 0 12px 30px rgba(0,0,0,0.08); border-color: var(--accent); }
  .kpi::after {
    content: "→"; position: absolute; top: 1rem; right: 1rem;
    color: var(--accent); opacity: 0; transition: opacity 0.15s ease;
    font-size: 1.1rem;
  }
  .kpi:hover::after { opacity: 0.8; }
  .kpi-label { font-size: 0.8rem; color: var(--gray-dark, #64748b); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
  .kpi-value { font-size: 2rem; font-weight: 600; margin: 0.35rem 0 0.2rem; letter-spacing: -0.01em; color: var(--black, #0f172a); font-variant-numeric: tabular-nums; }
  .kpi-sub { font-size: 0.8rem; color: var(--gray-dark, #64748b); margin-top: 0.25rem; }
  .dash-split { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  @media (max-width: 900px) { .dash-split { grid-template-columns: 1fr; } }
  .chart-card {
    background: #fff;
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 14px;
    padding: 1.25rem;
  }
  .chart-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.75rem; }
  .chart-card h3 { font-size: 1.1rem; font-weight: 600; margin: 0; letter-spacing: -0.005em; }
  .chart-hint { font-size: 0.7rem; color: var(--gray-dark, #94a3b8); text-transform: uppercase; letter-spacing: 0.05em; }
  .activity-feed { display: flex; flex-direction: column; max-height: 360px; overflow-y: auto; }
  .activity-row {
    display: flex; gap: 0.75rem; align-items: flex-start;
    padding: 0.5rem 0.35rem; border-bottom: 1px solid var(--border, #f1f5f9);
  }
  .activity-row:last-child { border-bottom: none; }
  .activity-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); margin-top: 0.45rem; flex-shrink: 0; }
  .activity-dot.tone-paid { background: #059669; }
  .activity-dot.tone-ended { background: #64748b; }
  .activity-dot.tone-urgent { background: #dc2626; }
  .activity-text { font-size: 0.85rem; line-height: 1.35; flex: 1; min-width: 0; }
  .activity-text .meta { color: var(--gray-dark, #64748b); font-size: 0.75rem; margin-top: 0.15rem; }
`;
