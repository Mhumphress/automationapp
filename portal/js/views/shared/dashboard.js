import { db } from '../../config.js';
import {
  collection, query, orderBy, onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getTenant, getPackage, getVertical, getTenantId, hasFeature } from '../../tenant-context.js';
import { requestTicketFilter } from '../repair/tickets.js';
import { requestInvoice, requestInvoiceFilter } from './invoicing.js';

// Vertical routing — each vertical gets its own Dashboard builder. If
// no specific module is registered, fall through to the default
// repair-flavored dashboard below. Add entries here as new verticals
// get their own custom dashboards.
let activeVerticalDelegate = null;
async function routeByVertical() {
  const v = getVertical();
  const id = v?.id;
  try {
    if (id === 'property') {
      const mod = await import('../property/dashboard.js');
      return mod;
    }
  } catch (err) {
    console.warn(`Vertical dashboard for ${id} failed to load, falling back:`, err);
  }
  return null;
}

// ── State ─────────────────────────────────
let chartModule = null;
let activeCharts = [];
let unsubs = [];
let tickets = [];
let invoices = [];
let contacts = [];
let redrawTimer = null;
let ready = { tickets: false, invoices: false, contacts: false };

async function ensureChart() {
  if (chartModule) return chartModule;
  chartModule = await import('https://cdn.jsdelivr.net/npm/chart.js@4.4.6/auto/+esm');
  return chartModule;
}

function cleanup() {
  unsubs.forEach(u => { try { u(); } catch {} });
  unsubs = [];
  destroyCharts();
  if (redrawTimer) { clearTimeout(redrawTimer); redrawTimer = null; }
}

function destroyCharts() {
  activeCharts.forEach(c => { try { c.destroy(); } catch {} });
  activeCharts = [];
}

export function init() {}
export function destroy() {
  if (activeVerticalDelegate?.destroy) {
    try { activeVerticalDelegate.destroy(); } catch {}
    activeVerticalDelegate = null;
    return;
  }
  cleanup();
  ready = { tickets: false, invoices: false, contacts: false };
}

// ── Date helpers ──────────────────────────
const DAY = 86400000;

function isoDate(d) {
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function ticketTime(t) { return t.createdAt && t.createdAt.toDate ? t.createdAt.toDate().getTime() : 0; }
function invoiceTime(i) {
  if (i.createdAt && i.createdAt.toDate) return i.createdAt.toDate().getTime();
  return i.issueDate ? new Date(i.issueDate).getTime() : 0;
}

// ── Public entry ──────────────────────────
export async function render() {
  const container = document.getElementById('view-dashboard');
  container.innerHTML = '<div class="loading">Loading dashboard...</div>';

  cleanup();
  if (activeVerticalDelegate?.destroy) { try { activeVerticalDelegate.destroy(); } catch {} activeVerticalDelegate = null; }

  // If this vertical has a dedicated dashboard module, hand off to it.
  const delegate = await routeByVertical();
  if (delegate) {
    activeVerticalDelegate = delegate;
    try { if (delegate.init) delegate.init(); } catch {}
    return delegate.render();
  }

  const tid = getTenantId();
  if (!tid) { container.innerHTML = '<p style="color:var(--danger);padding:1rem;">No tenant context.</p>'; return; }

  // Ensure Chart.js is loaded before the first live snapshot fires.
  try { await ensureChart(); } catch (err) { console.error('Chart load failed:', err); }

  // Live listeners: Firestore pushes updates as data changes.
  const onTickets = (snap) => { tickets = snap.docs.map(d => ({ id: d.id, ...d.data() })); ready.tickets = true; scheduleRedraw(); };
  const onInvoices = (snap) => { invoices = snap.docs.map(d => ({ id: d.id, ...d.data() })); ready.invoices = true; scheduleRedraw(); };
  const onContacts = (snap) => { contacts = snap.docs.map(d => ({ id: d.id, ...d.data() })); ready.contacts = true; scheduleRedraw(); };

  try {
    unsubs.push(onSnapshot(query(collection(db, `tenants/${tid}/tickets`), orderBy('createdAt', 'desc')), onTickets, (e) => console.error('tickets snap:', e)));
    unsubs.push(onSnapshot(query(collection(db, `tenants/${tid}/invoices_crm`), orderBy('createdAt', 'desc')), onInvoices, (e) => console.error('invoices snap:', e)));
    unsubs.push(onSnapshot(query(collection(db, `tenants/${tid}/contacts`), orderBy('createdAt', 'desc')), onContacts, (e) => console.error('contacts snap:', e)));
  } catch (err) {
    console.error('Dashboard listeners failed:', err);
    container.innerHTML = '<p style="color:var(--danger);padding:1rem;">Failed to load live data.</p>';
  }
}

// Debounce: snapshots often fire in bursts — wait 80ms then redraw once.
function scheduleRedraw() {
  if (!ready.tickets || !ready.invoices || !ready.contacts) {
    // Render early with whatever is ready — the next update completes the picture.
    if (redrawTimer) return;
    redrawTimer = setTimeout(() => { redrawTimer = null; redraw(); }, 250);
    return;
  }
  if (redrawTimer) clearTimeout(redrawTimer);
  redrawTimer = setTimeout(() => { redrawTimer = null; redraw(); }, 80);
}

// ── Main render ───────────────────────────
function redraw() {
  const container = document.getElementById('view-dashboard');
  if (!container) return;

  const now = Date.now();
  const start30 = now - 30 * DAY;
  const start60 = now - 60 * DAY;
  const start7 = now - 7 * DAY;

  const paidInvoices = invoices.filter(i => i.status === 'paid');
  const paid30 = paidInvoices.filter(i => invoiceTime(i) >= start30);
  const paidPrev30 = paidInvoices.filter(i => invoiceTime(i) >= start60 && invoiceTime(i) < start30);
  const revenue30 = paid30.reduce((s, i) => s + (Number(i.total) || 0), 0);
  const revenuePrev30 = paidPrev30.reduce((s, i) => s + (Number(i.total) || 0), 0);
  const revenueDelta = revenuePrev30 > 0 ? ((revenue30 - revenuePrev30) / revenuePrev30) * 100 : (revenue30 > 0 ? 100 : 0);

  const outstanding = invoices
    .filter(i => ['draft', 'sent', 'overdue'].includes(i.status))
    .reduce((s, i) => s + (Number(i.total) || 0), 0);
  const outstandingCount = invoices.filter(i => ['draft', 'sent', 'overdue'].includes(i.status)).length;

  const tickets30 = tickets.filter(t => ticketTime(t) >= start30);
  const ticketsPrev30 = tickets.filter(t => ticketTime(t) >= start60 && ticketTime(t) < start30);
  const ticketDelta = ticketsPrev30.length > 0 ? ((tickets30.length - ticketsPrev30.length) / ticketsPrev30.length) * 100 : (tickets30.length > 0 ? 100 : 0);
  const openTicketCount = tickets.filter(t => t.status !== 'completed').length;

  const activeCustomers = new Set(tickets30.map(t => t.contactId).filter(Boolean)).size;
  const activeCustomersPrev = new Set(ticketsPrev30.map(t => t.contactId).filter(Boolean)).size;
  const customerDelta = activeCustomersPrev > 0 ? ((activeCustomers - activeCustomersPrev) / activeCustomersPrev) * 100 : (activeCustomers > 0 ? 100 : 0);

  const tenant = getTenant();
  const pkg = getPackage();
  const vertical = getVertical();
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  // 30-day bucketing for revenue chart
  const buckets = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * DAY);
    d.setHours(0, 0, 0, 0);
    buckets.push({ ts: d.getTime(), iso: isoDate(d), label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), total: 0, count: 0 });
  }
  paid30.forEach(inv => {
    const t = invoiceTime(inv);
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    const bucket = buckets.find(b => b.ts === d.getTime());
    if (bucket) { bucket.total += Number(inv.total) || 0; bucket.count += 1; }
  });

  // Status breakdown (open tickets)
  const labelMap = {
    checked_in: 'Checked In', diagnosed: 'Diagnosed',
    awaiting_parts: 'Awaiting Parts', in_repair: 'In Repair',
    qc: 'Quality Check', ready: 'Ready', completed: 'Completed'
  };
  const statusCounts = {};
  tickets.forEach(t => {
    const s = t.status || 'unknown';
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  });
  const statusEntries = Object.entries(statusCounts).filter(([, v]) => v > 0);

  // Top devices (30d)
  const deviceCounts = {};
  tickets30.forEach(t => {
    const d = (t.deviceType || 'Unknown').trim();
    if (!d) return;
    deviceCounts[d] = (deviceCounts[d] || 0) + 1;
  });
  const topDevices = Object.entries(deviceCounts).sort((a, b) => b[1] - a[1]).slice(0, 7);

  // Build HTML
  container.innerHTML = `
    <style>${DASH_CSS}</style>
    <div class="dash-hero">
      <div>
        <h1>Welcome back</h1>
        <h2>${escapeHtml(tenant.companyName || 'Your business')}</h2>
        <div class="meta">${escapeHtml(today)} · ${escapeHtml(pkg ? pkg.name : '—')}${vertical ? ' · ' + escapeHtml(vertical.name) : ''} · ${openTicketCount} open ticket${openTicketCount === 1 ? '' : 's'}</div>
      </div>
      <div class="hero-right">
        <div class="live-dot" title="Live — updates as data changes"></div>
        <div class="status-chip">${escapeHtml(tenant.status || 'active')}</div>
      </div>
    </div>

    <div class="kpi-grid">
      ${kpiCard('revenue', 'Revenue (30d)', formatCurrency(revenue30), revenueDelta, `${paid30.length} paid invoice${paid30.length === 1 ? '' : 's'}`)}
      ${kpiCard('tickets', 'Tickets (30d)', tickets30.length.toString(), ticketDelta, `${openTicketCount} still open`)}
      ${kpiCard('customers', 'Active Customers', activeCustomers.toString(), customerDelta, `${contacts.length} total`)}
      ${kpiCard('outstanding', 'Outstanding', formatCurrency(outstanding), null, `${outstandingCount} open invoice${outstandingCount === 1 ? '' : 's'}`, outstanding > 0 ? 'warn' : 'ok')}
    </div>

    <div class="chart-row">
      <div class="chart-card">
        <div class="chart-head">
          <h3>Revenue (last 30 days)</h3>
          <span class="chart-hint">Click a point to view invoices from that day</span>
        </div>
        <div class="chart-canvas-wrap"><canvas id="revenueChart"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-head">
          <h3>Tickets by Status</h3>
          <span class="chart-hint">Click a slice to filter tickets</span>
        </div>
        <div class="chart-canvas-wrap"><canvas id="statusChart"></canvas></div>
      </div>
    </div>

    <div class="chart-row">
      <div class="chart-card">
        <div class="chart-head">
          <h3>Top Devices (30d)</h3>
          <span class="chart-hint">Click a bar to see those tickets</span>
        </div>
        <div class="chart-canvas-wrap tall"><canvas id="devicesChart"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-head">
          <h3>Recent Activity</h3>
          <span class="chart-hint">Click any row to open</span>
        </div>
        <div class="activity-feed" id="activityFeed"></div>
      </div>
    </div>

    <div id="dashTooltip" class="dash-tooltip" style="display:none;"></div>
  `;

  // KPI click handlers — drill down to filtered view
  container.querySelector('[data-kpi="revenue"]')?.addEventListener('click', () => {
    requestInvoiceFilter({ status: 'paid', from: isoDate(start30), to: isoDate(now) });
    window.location.hash = 'invoicing';
  });
  container.querySelector('[data-kpi="tickets"]')?.addEventListener('click', () => {
    requestTicketFilter({ from: isoDate(start30), to: isoDate(now) });
    window.location.hash = 'tickets';
  });
  container.querySelector('[data-kpi="customers"]')?.addEventListener('click', () => {
    window.location.hash = 'contacts';
  });
  container.querySelector('[data-kpi="outstanding"]')?.addEventListener('click', () => {
    requestInvoiceFilter({ status: 'outstanding' });
    window.location.hash = 'invoicing';
  });

  renderActivityFeed(tickets, invoices);

  destroyCharts();
  if (chartModule) {
    drawRevenueChart(buckets);
    drawStatusChart(statusEntries, labelMap);
    drawDevicesChart(topDevices);
  }
}

// ── KPI card ──────────────────────────────
function kpiCard(key, label, value, delta, sub, tone) {
  let deltaHtml = '';
  if (delta != null) {
    const cls = delta > 1 ? 'up' : delta < -1 ? 'down' : 'flat';
    const arrow = delta > 1 ? '↑' : delta < -1 ? '↓' : '→';
    const num = Math.abs(delta) >= 100 ? Math.round(delta) : delta.toFixed(1);
    deltaHtml = `<span class="kpi-delta ${cls}">${arrow} ${num}%</span>`;
  }
  const valueColor = tone === 'warn' ? 'style="color:#d97706;"' : '';
  return `
    <div class="kpi" data-kpi="${escapeHtml(key)}" role="button" tabindex="0">
      <div class="kpi-label">${escapeHtml(label)}</div>
      <div class="kpi-value" ${valueColor}>${escapeHtml(value)}</div>
      ${deltaHtml}
      <div class="kpi-sub">${escapeHtml(sub)}</div>
    </div>
  `;
}

// ── Charts ────────────────────────────────
function drawRevenueChart(buckets) {
  const canvas = document.getElementById('revenueChart');
  if (!canvas) return;

  const accent = currentAccent();
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 240);
  gradient.addColorStop(0, hexToRgba(accent, 0.3));
  gradient.addColorStop(1, hexToRgba(accent, 0));

  const chart = new chartModule.default(ctx, {
    type: 'line',
    data: {
      labels: buckets.map(b => b.label),
      datasets: [{
        label: 'Revenue',
        data: buckets.map(b => b.total),
        borderColor: accent,
        backgroundColor: gradient,
        borderWidth: 2,
        fill: true,
        tension: 0.35,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: accent,
        pointHoverBorderColor: '#fff',
        pointHoverBorderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          external: (ctx) => externalTooltip(ctx, (dataIndex) => {
            const b = buckets[dataIndex];
            if (!b) return null;
            return {
              title: b.label,
              rows: [
                { label: 'Revenue', value: formatCurrency(b.total), bold: true },
                { label: 'Invoices', value: b.count.toString() },
              ],
              hint: b.count > 0 ? 'Click to open invoices from this day' : '',
            };
          }),
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { size: 10 }, color: '#94a3b8' } },
        y: { grid: { color: 'rgba(148,163,184,0.12)' }, ticks: { font: { size: 10 }, color: '#94a3b8', callback: (v) => '$' + v } }
      },
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const idx = elements[0].index;
        const b = buckets[idx];
        if (!b || b.count === 0) return;
        requestInvoiceFilter({ status: 'paid', from: b.iso, to: b.iso });
        window.location.hash = 'invoicing';
      },
      onHover: (evt, elements) => {
        evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
      },
    }
  });
  activeCharts.push(chart);
}

function drawStatusChart(entries, labelMap) {
  const canvas = document.getElementById('statusChart');
  if (!canvas) return;

  if (entries.length === 0) {
    canvas.parentElement.innerHTML = '<p style="color:var(--gray);font-size:0.9rem;text-align:center;padding:3rem 0;">No tickets yet.</p>';
    return;
  }

  const total = entries.reduce((s, [, v]) => s + v, 0);
  const accent = currentAccent();
  const palette = [accent, lighten(accent, 0.2), lighten(accent, 0.4), '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2'];

  const chart = new chartModule.default(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: entries.map(([s]) => labelMap[s] || s),
      datasets: [{
        data: entries.map(([, v]) => v),
        backgroundColor: entries.map((_, i) => palette[i % palette.length]),
        borderWidth: 0,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 10, padding: 10, font: { size: 11 } } },
        tooltip: {
          enabled: false,
          external: (ctx) => externalTooltip(ctx, (dataIndex) => {
            const [status, count] = entries[dataIndex];
            const pct = total > 0 ? ((count / total) * 100).toFixed(1) : 0;
            return {
              title: labelMap[status] || status,
              rows: [
                { label: 'Tickets', value: count.toString(), bold: true },
                { label: 'Share', value: `${pct}%` },
              ],
              hint: 'Click to view tickets',
            };
          }),
        },
      },
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const [status] = entries[elements[0].index];
        requestTicketFilter({ status });
        window.location.hash = 'tickets';
      },
      onHover: (evt, elements) => {
        evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
      },
    }
  });
  activeCharts.push(chart);
}

function drawDevicesChart(topDevices) {
  const canvas = document.getElementById('devicesChart');
  if (!canvas) return;

  if (topDevices.length === 0) {
    canvas.parentElement.innerHTML = '<p style="color:var(--gray);font-size:0.9rem;text-align:center;padding:3rem 0;">No tickets in the last 30 days.</p>';
    return;
  }

  const accent = currentAccent();

  const chart = new chartModule.default(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: topDevices.map(([d]) => d),
      datasets: [{
        data: topDevices.map(([, v]) => v),
        backgroundColor: accent,
        borderRadius: 6,
        barThickness: 20,
        hoverBackgroundColor: lighten(accent, 0.15),
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          external: (ctx) => externalTooltip(ctx, (dataIndex) => {
            const [device, count] = topDevices[dataIndex];
            return {
              title: device,
              rows: [
                { label: 'Tickets (30d)', value: count.toString(), bold: true },
              ],
              hint: 'Click to filter tickets by this device',
            };
          }),
        },
      },
      scales: {
        x: { grid: { color: 'rgba(148,163,184,0.12)' }, ticks: { font: { size: 10 }, color: '#94a3b8', stepSize: 1 } },
        y: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#475569' } }
      },
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const [device] = topDevices[elements[0].index];
        requestTicketFilter({ deviceType: device });
        window.location.hash = 'tickets';
      },
      onHover: (evt, elements) => {
        evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
      },
    }
  });
  activeCharts.push(chart);
}

// ── External rich tooltip ─────────────────
function externalTooltip(context, getContent) {
  const tipEl = document.getElementById('dashTooltip');
  if (!tipEl) return;
  const tip = context.tooltip;
  if (tip.opacity === 0) { tipEl.style.display = 'none'; return; }

  const dataIndex = tip.dataPoints && tip.dataPoints[0] ? tip.dataPoints[0].dataIndex : 0;
  const content = getContent(dataIndex);
  if (!content) { tipEl.style.display = 'none'; return; }

  const rows = content.rows.map(r =>
    `<div class="dash-tip-row"><span>${escapeHtml(r.label)}</span><strong style="${r.bold ? 'font-size:1.05rem;' : ''}">${escapeHtml(r.value)}</strong></div>`
  ).join('');
  const hint = content.hint ? `<div class="dash-tip-hint">${escapeHtml(content.hint)}</div>` : '';
  tipEl.innerHTML = `<div class="dash-tip-title">${escapeHtml(content.title)}</div>${rows}${hint}`;

  const canvas = context.chart.canvas;
  const rect = canvas.getBoundingClientRect();
  tipEl.style.display = 'block';

  // Position: centered above the point, clamped to viewport edges.
  const tipRect = tipEl.getBoundingClientRect();
  let left = rect.left + window.scrollX + tip.caretX - (tipRect.width / 2);
  let top = rect.top + window.scrollY + tip.caretY - tipRect.height - 12;
  if (top < window.scrollY + 8) top = rect.top + window.scrollY + tip.caretY + 14;
  left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));
  tipEl.style.left = left + 'px';
  tipEl.style.top = top + 'px';
}

// ── Activity feed ─────────────────────────
function renderActivityFeed(tickets, invoices) {
  const feed = document.getElementById('activityFeed');
  if (!feed) return;

  const events = [];
  tickets.forEach(t => {
    if (t.createdAt) events.push({
      kind: 'ticket', id: t.id,
      text: `<strong>${escapeHtml(t.ticketNumber || '')}</strong> checked in — ${escapeHtml(t.deviceType || 'device')} for ${escapeHtml(t.customerName || 'customer')}`,
      time: t.createdAt.toDate ? t.createdAt.toDate() : new Date(t.createdAt),
      tone: 'new'
    });
    if (t.completedAt) events.push({
      kind: 'ticket', id: t.id,
      text: `<strong>${escapeHtml(t.ticketNumber || '')}</strong> completed — ${escapeHtml(t.deviceType || 'device')}`,
      time: t.completedAt.toDate ? t.completedAt.toDate() : new Date(t.completedAt),
      tone: 'completed'
    });
  });
  invoices.forEach(i => {
    if (i.createdAt && i.createdAt.toDate) {
      events.push({
        kind: 'invoice', id: i.id,
        text: `Invoice <strong>${escapeHtml(i.invoiceNumber || '')}</strong> ${i.status === 'paid' ? 'paid' : 'created'} — ${formatCurrency(i.total)}`,
        time: i.createdAt.toDate(),
        tone: i.status === 'paid' ? 'completed' : 'new'
      });
    }
  });

  events.sort((a, b) => b.time.getTime() - a.time.getTime());
  const top = events.slice(0, 12);

  if (top.length === 0) {
    feed.innerHTML = '<p style="color:var(--gray);font-size:0.9rem;">No activity yet.</p>';
    return;
  }

  feed.innerHTML = top.map((e, i) => `
    <div class="activity-row" data-idx="${i}">
      <div class="activity-dot ${e.tone === 'completed' ? 'completed' : ''}"></div>
      <div class="activity-text">
        <div>${e.text}</div>
        <div class="meta">${relativeTime(e.time)}</div>
      </div>
    </div>
  `).join('');

  feed.querySelectorAll('.activity-row').forEach((row) => {
    row.addEventListener('click', () => {
      const idx = Number(row.dataset.idx);
      const ev = top[idx];
      if (!ev) return;
      if (ev.kind === 'ticket') {
        // Navigate to tickets and let the user find it via normal list (or wire requestTicket)
        import('../repair/tickets.js').then(m => m.requestTicket(ev.id));
        window.location.hash = 'tickets';
      } else if (ev.kind === 'invoice') {
        requestInvoice(ev.id);
        window.location.hash = 'invoicing';
      }
    });
  });
}

// ── Utility ───────────────────────────────
function currentAccent() {
  return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4F7BF7';
}

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

function escapeHtml(str) {
  if (str == null) return '';
  const node = document.createElement('span');
  node.appendChild(document.createTextNode(String(str)));
  return node.innerHTML;
}

function formatCurrency(amount) {
  if (amount == null || isNaN(amount)) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
}

function hexToRgba(hex, alpha) {
  const h = (hex || '').trim().replace(/^#/, '');
  if (!(h.length === 3 || h.length === 6)) return `rgba(79,123,247,${alpha})`;
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function lighten(hex, amount) {
  const h = (hex || '').trim().replace(/^#/, '');
  if (!(h.length === 3 || h.length === 6)) return hex;
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const nr = Math.round(r + (255 - r) * amount);
  const ng = Math.round(g + (255 - g) * amount);
  const nb = Math.round(b + (255 - b) * amount);
  return '#' + [nr, ng, nb].map(v => v.toString(16).padStart(2, '0')).join('');
}

// ── Styles ────────────────────────────────
const DASH_CSS = `
  .dash-hero {
    background: linear-gradient(135deg, var(--accent) 0%, var(--accent-strong, #2563eb) 100%);
    color: #fff;
    border-radius: 16px;
    padding: 2rem 2.5rem;
    margin-bottom: 1.5rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    box-shadow: 0 10px 40px rgba(0,0,0,0.06);
  }
  .dash-hero h1 { font-family: var(--font-display); font-size: 1.15rem; font-weight: 400; opacity: 0.85; margin: 0; }
  .dash-hero h2 { font-family: var(--font-display); font-size: 2rem; font-weight: 600; margin: 0.15rem 0 0.35rem; letter-spacing: -0.01em; }
  .dash-hero .meta { font-size: 0.9rem; opacity: 0.82; }
  .dash-hero .hero-right { display: flex; align-items: center; gap: 0.75rem; }
  .dash-hero .status-chip {
    background: rgba(255,255,255,0.16);
    backdrop-filter: blur(10px);
    padding: 0.35rem 0.9rem;
    border-radius: 999px;
    font-size: 0.85rem;
    font-weight: 500;
    text-transform: capitalize;
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
  .kpi:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .kpi-label { font-size: 0.8rem; color: var(--gray-dark, #64748b); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
  .kpi-value { font-family: var(--font-display); font-size: 2rem; font-weight: 600; margin: 0.35rem 0 0.2rem; letter-spacing: -0.01em; color: var(--black, #0f172a); }
  .kpi-delta { font-size: 0.8rem; display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.15rem 0.5rem; border-radius: 999px; font-weight: 500; }
  .kpi-delta.up { background: rgba(5, 150, 105, 0.1); color: #059669; }
  .kpi-delta.down { background: rgba(220, 38, 38, 0.08); color: #dc2626; }
  .kpi-delta.flat { background: rgba(100, 116, 139, 0.1); color: #64748b; }
  .kpi-sub { font-size: 0.8rem; color: var(--gray-dark, #64748b); margin-top: 0.25rem; }
  .chart-row {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }
  @media (max-width: 900px) { .chart-row { grid-template-columns: 1fr; } }
  .chart-card {
    background: #fff;
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 14px;
    padding: 1.25rem;
  }
  .chart-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.5rem; }
  .chart-card h3 { font-family: var(--font-display); font-size: 1.1rem; font-weight: 600; margin: 0; letter-spacing: -0.005em; }
  .chart-hint { font-size: 0.7rem; color: var(--gray-dark, #94a3b8); text-transform: uppercase; letter-spacing: 0.05em; }
  .chart-canvas-wrap { position: relative; height: 240px; }
  .chart-canvas-wrap.tall { height: 280px; }
  .activity-feed { display: flex; flex-direction: column; max-height: 280px; overflow-y: auto; }
  .activity-row {
    display: flex; gap: 0.75rem; align-items: flex-start;
    padding: 0.5rem 0.35rem; border-bottom: 1px solid var(--border, #f1f5f9);
    cursor: pointer; border-radius: 6px; transition: background 0.1s ease;
  }
  .activity-row:hover { background: var(--accent-dim, rgba(79,123,247,0.05)); }
  .activity-row:last-child { border-bottom: none; }
  .activity-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); margin-top: 0.45rem; flex-shrink: 0; }
  .activity-dot.completed { background: #059669; }
  .activity-text { font-size: 0.85rem; line-height: 1.35; flex: 1; min-width: 0; }
  .activity-text .meta { color: var(--gray-dark, #64748b); font-size: 0.75rem; margin-top: 0.15rem; }
  .dash-tooltip {
    position: absolute;
    background: #0f172a;
    color: #fff;
    padding: 0.75rem 0.9rem;
    border-radius: 10px;
    font-size: 0.85rem;
    min-width: 180px;
    max-width: 260px;
    box-shadow: 0 16px 40px rgba(15,23,42,0.25);
    pointer-events: none;
    z-index: 1000;
    transition: opacity 0.1s ease;
  }
  .dash-tip-title { font-weight: 600; margin-bottom: 0.4rem; font-size: 0.9rem; color: #fff; }
  .dash-tip-row { display: flex; justify-content: space-between; gap: 1rem; padding: 0.2rem 0; border-top: 1px solid rgba(255,255,255,0.08); }
  .dash-tip-row:first-of-type { border-top: none; padding-top: 0; }
  .dash-tip-row span { color: rgba(255,255,255,0.7); }
  .dash-tip-row strong { color: #fff; }
  .dash-tip-hint { margin-top: 0.5rem; padding-top: 0.4rem; border-top: 1px solid rgba(255,255,255,0.1); font-size: 0.75rem; color: rgba(255,255,255,0.7); font-style: italic; }
`;
