import { queryDocuments } from '../../services/firestore.js';
import { getTenant, getPackage, getVertical, hasFeature } from '../../tenant-context.js';

let chartModule = null;       // dynamically loaded Chart.js
let activeCharts = [];

async function ensureChart() {
  if (chartModule) return chartModule;
  chartModule = await import('https://cdn.jsdelivr.net/npm/chart.js@4.4.6/auto/+esm');
  return chartModule;
}

function destroyCharts() {
  activeCharts.forEach(c => { try { c.destroy(); } catch {} });
  activeCharts = [];
}

export function init() {}

export function destroy() { destroyCharts(); }

export async function render() {
  destroyCharts();
  const container = document.getElementById('view-dashboard');
  container.innerHTML = '<div class="loading">Loading dashboard...</div>';

  const [tickets, invoices, contacts] = await Promise.all([
    queryDocuments('tickets', 'createdAt', 'desc').catch(() => []),
    queryDocuments('invoices_crm', 'createdAt', 'desc').catch(() => []),
    queryDocuments('contacts', 'createdAt', 'desc').catch(() => []),
  ]);

  // ── Metrics ──
  const now = Date.now();
  const DAY = 86400000;
  const start30 = now - 30 * DAY;
  const start60 = now - 60 * DAY;
  const start7 = now - 7 * DAY;
  const start14 = now - 14 * DAY;

  const ticketTime = t => t.createdAt && t.createdAt.toDate ? t.createdAt.toDate().getTime() : 0;
  const invoiceTime = i => {
    if (i.createdAt && i.createdAt.toDate) return i.createdAt.toDate().getTime();
    return i.issueDate ? new Date(i.issueDate).getTime() : 0;
  };

  const paidInvoices = invoices.filter(i => i.status === 'paid');
  const revenue30 = paidInvoices.filter(i => invoiceTime(i) >= start30).reduce((s, i) => s + (Number(i.total) || 0), 0);
  const revenuePrev30 = paidInvoices.filter(i => invoiceTime(i) >= start60 && invoiceTime(i) < start30).reduce((s, i) => s + (Number(i.total) || 0), 0);
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

  container.innerHTML = `
    <style>
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
      .dash-hero .status-chip {
        background: rgba(255,255,255,0.16);
        backdrop-filter: blur(10px);
        padding: 0.35rem 0.9rem;
        border-radius: 999px;
        font-size: 0.85rem;
        font-weight: 500;
        text-transform: capitalize;
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
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }
      .kpi:hover { transform: translateY(-2px); box-shadow: 0 12px 30px rgba(0,0,0,0.06); }
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
      .chart-card h3 { font-family: var(--font-display); font-size: 1.1rem; font-weight: 600; margin: 0 0 0.75rem; letter-spacing: -0.005em; }
      .chart-canvas-wrap { position: relative; height: 240px; }
      .chart-canvas-wrap.tall { height: 280px; }
      .activity-feed { display: flex; flex-direction: column; gap: 0.5rem; max-height: 280px; overflow-y: auto; }
      .activity-row {
        display: flex; gap: 0.75rem; align-items: flex-start;
        padding: 0.5rem 0; border-bottom: 1px solid var(--border, #f1f5f9);
      }
      .activity-row:last-child { border-bottom: none; }
      .activity-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); margin-top: 0.45rem; flex-shrink: 0; }
      .activity-dot.completed { background: #059669; }
      .activity-text { font-size: 0.85rem; line-height: 1.35; flex: 1; min-width: 0; }
      .activity-text .meta { color: var(--gray-dark, #64748b); font-size: 0.75rem; margin-top: 0.15rem; }
    </style>

    <div class="dash-hero">
      <div>
        <h1>Welcome back</h1>
        <h2>${escapeHtml(tenant.companyName || 'Your business')}</h2>
        <div class="meta">${escapeHtml(today)} · ${escapeHtml(pkg ? pkg.name : '—')}${vertical ? ' · ' + escapeHtml(vertical.name) : ''} · ${openTicketCount} open ticket${openTicketCount === 1 ? '' : 's'}</div>
      </div>
      <div class="status-chip">${escapeHtml(tenant.status || 'active')}</div>
    </div>

    <div class="kpi-grid">
      ${kpiCard('Revenue (30d)', formatCurrency(revenue30), revenueDelta, `${formatCurrency(revenue30 / 30)}/day avg`)}
      ${kpiCard('Tickets (30d)', tickets30.length.toString(), ticketDelta, `${openTicketCount} still open`)}
      ${kpiCard('Active Customers', activeCustomers.toString(), customerDelta, `${contacts.length} total`)}
      ${kpiCard('Outstanding', formatCurrency(outstanding), null, `${outstandingCount} open invoice${outstandingCount === 1 ? '' : 's'}`, outstanding > 0 ? 'warn' : 'ok')}
    </div>

    <div class="chart-row">
      <div class="chart-card">
        <h3>Revenue (last 30 days)</h3>
        <div class="chart-canvas-wrap"><canvas id="revenueChart"></canvas></div>
      </div>
      <div class="chart-card">
        <h3>Tickets by Status</h3>
        <div class="chart-canvas-wrap"><canvas id="statusChart"></canvas></div>
      </div>
    </div>

    <div class="chart-row">
      <div class="chart-card">
        <h3>Top Devices (30d)</h3>
        <div class="chart-canvas-wrap tall"><canvas id="devicesChart"></canvas></div>
      </div>
      <div class="chart-card">
        <h3>Recent Activity</h3>
        <div class="activity-feed" id="activityFeed"></div>
      </div>
    </div>
  `;

  // Populate activity feed
  renderActivityFeed(tickets, invoices);

  // Draw charts
  try {
    await ensureChart();
    drawRevenueChart(paidInvoices, invoiceTime, start30);
    drawStatusChart(tickets);
    drawDevicesChart(tickets30);
  } catch (err) {
    console.error('Chart render failed:', err);
  }
}

function kpiCard(label, value, delta, sub, tone) {
  let deltaHtml = '';
  if (delta != null) {
    const cls = delta > 1 ? 'up' : delta < -1 ? 'down' : 'flat';
    const arrow = delta > 1 ? '↑' : delta < -1 ? '↓' : '→';
    const num = Math.abs(delta) >= 100 ? Math.round(delta) : delta.toFixed(1);
    deltaHtml = `<span class="kpi-delta ${cls}">${arrow} ${num}%</span>`;
  }
  const valueColor = tone === 'warn' ? 'style="color:#d97706;"' : '';
  return `
    <div class="kpi">
      <div class="kpi-label">${escapeHtml(label)}</div>
      <div class="kpi-value" ${valueColor}>${escapeHtml(value)}</div>
      ${deltaHtml}
      <div class="kpi-sub">${escapeHtml(sub)}</div>
    </div>
  `;
}

function drawRevenueChart(paidInvoices, invoiceTime, start30) {
  const canvas = document.getElementById('revenueChart');
  if (!canvas) return;

  // Bucket by day
  const DAY = 86400000;
  const buckets = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY);
    d.setHours(0, 0, 0, 0);
    buckets.push({ ts: d.getTime(), label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), total: 0 });
  }
  paidInvoices.forEach(inv => {
    const t = invoiceTime(inv);
    if (t < start30) return;
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    const bucket = buckets.find(b => b.ts === d.getTime());
    if (bucket) bucket.total += Number(inv.total) || 0;
  });

  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4F7BF7';
  const accentDim = hexToRgba(accent, 0.15);

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
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0f172a',
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            label: (ctx) => ' ' + formatCurrency(ctx.parsed.y),
          }
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { size: 10 }, color: '#94a3b8' } },
        y: { grid: { color: 'rgba(148,163,184,0.12)' }, ticks: { font: { size: 10 }, color: '#94a3b8', callback: (v) => '$' + v } }
      },
    }
  });
  activeCharts.push(chart);
}

function drawStatusChart(tickets) {
  const canvas = document.getElementById('statusChart');
  if (!canvas) return;

  const labelMap = {
    checked_in: 'Checked In', diagnosed: 'Diagnosed',
    awaiting_parts: 'Awaiting Parts', in_repair: 'In Repair',
    qc: 'Quality Check', ready: 'Ready', completed: 'Completed'
  };
  const counts = {};
  tickets.forEach(t => {
    const s = t.status || 'unknown';
    counts[s] = (counts[s] || 0) + 1;
  });
  const entries = Object.entries(counts).filter(([, v]) => v > 0);

  if (entries.length === 0) {
    canvas.parentElement.innerHTML = '<p style="color:var(--gray);font-size:0.9rem;text-align:center;padding:3rem 0;">No tickets yet.</p>';
    return;
  }

  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4F7BF7';
  const palette = [
    accent, lighten(accent, 0.2), lighten(accent, 0.4),
    '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2'
  ];

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
        tooltip: { backgroundColor: '#0f172a', padding: 10, cornerRadius: 8 },
      },
    }
  });
  activeCharts.push(chart);
}

function drawDevicesChart(tickets30) {
  const canvas = document.getElementById('devicesChart');
  if (!canvas) return;

  const counts = {};
  tickets30.forEach(t => {
    const d = (t.deviceType || 'Unknown').trim();
    if (!d) return;
    counts[d] = (counts[d] || 0) + 1;
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 7);
  if (sorted.length === 0) {
    canvas.parentElement.innerHTML = '<p style="color:var(--gray);font-size:0.9rem;text-align:center;padding:3rem 0;">No tickets in the last 30 days.</p>';
    return;
  }

  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4F7BF7';

  const chart = new chartModule.default(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: sorted.map(([d]) => d),
      datasets: [{
        data: sorted.map(([, v]) => v),
        backgroundColor: accent,
        borderRadius: 6,
        barThickness: 20,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: '#0f172a', padding: 10, cornerRadius: 8 },
      },
      scales: {
        x: { grid: { color: 'rgba(148,163,184,0.12)' }, ticks: { font: { size: 10 }, color: '#94a3b8', stepSize: 1 } },
        y: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#475569' } }
      }
    }
  });
  activeCharts.push(chart);
}

function renderActivityFeed(tickets, invoices) {
  const feed = document.getElementById('activityFeed');
  if (!feed) return;

  // Combine ticket + invoice events, sort by time desc
  const events = [];
  tickets.forEach(t => {
    if (t.createdAt) events.push({
      type: 'ticket_created',
      text: `<strong>${escapeHtml(t.ticketNumber || '')}</strong> checked in — ${escapeHtml(t.deviceType || 'device')} for ${escapeHtml(t.customerName || 'customer')}`,
      time: t.createdAt.toDate ? t.createdAt.toDate() : new Date(t.createdAt),
      status: 'new'
    });
    if (t.completedAt) events.push({
      type: 'ticket_completed',
      text: `<strong>${escapeHtml(t.ticketNumber || '')}</strong> completed — ${escapeHtml(t.deviceType || 'device')}`,
      time: t.completedAt.toDate ? t.completedAt.toDate() : new Date(t.completedAt),
      status: 'completed'
    });
  });
  invoices.forEach(i => {
    if (i.createdAt && i.createdAt.toDate) {
      events.push({
        type: 'invoice',
        text: `Invoice <strong>${escapeHtml(i.invoiceNumber || '')}</strong> created — ${formatCurrency(i.total)}`,
        time: i.createdAt.toDate(),
        status: i.status === 'paid' ? 'completed' : 'new'
      });
    }
  });

  events.sort((a, b) => b.time.getTime() - a.time.getTime());
  const top = events.slice(0, 12);

  if (top.length === 0) {
    feed.innerHTML = '<p style="color:var(--gray);font-size:0.9rem;">No activity yet.</p>';
    return;
  }

  feed.innerHTML = top.map(e => `
    <div class="activity-row">
      <div class="activity-dot ${e.status === 'completed' ? 'completed' : ''}"></div>
      <div class="activity-text">
        <div>${e.text}</div>
        <div class="meta">${relativeTime(e.time)}</div>
      </div>
    </div>
  `).join('');
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
