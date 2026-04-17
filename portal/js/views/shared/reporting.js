import { queryDocuments } from '../../services/firestore.js';
import { hasFeature } from '../../tenant-context.js';

let tickets = [];
let invoices = [];
let parts = [];

export function init() {}

export async function render() {
  const container = document.getElementById('view-reporting');
  container.innerHTML = '<div class="loading">Loading reports...</div>';

  try {
    const [t, i, p] = await Promise.all([
      queryDocuments('tickets', 'createdAt', 'desc').catch(() => []),
      queryDocuments('invoices_crm', 'createdAt', 'desc').catch(() => []),
      hasFeature('inventory') ? queryDocuments('inventory', 'name', 'asc').catch(() => []) : Promise.resolve([]),
    ]);
    tickets = t; invoices = i; parts = p;
  } catch (err) {
    console.error('Reports load failed:', err);
    container.innerHTML = '<p style="color:var(--danger);padding:1rem;">Failed to load report data.</p>';
    return;
  }

  renderReport();
}

export function destroy() {}

function renderReport() {
  const container = document.getElementById('view-reporting');

  // ── Compute KPIs ──
  const now = Date.now();
  const start30 = now - 30 * 86400000;
  const start7 = now - 7 * 86400000;

  const ticketTime = (t) => t.createdAt && t.createdAt.toDate ? t.createdAt.toDate().getTime() : 0;

  const tickets30 = tickets.filter(t => ticketTime(t) >= start30);
  const tickets7 = tickets.filter(t => ticketTime(t) >= start7);
  const completed30 = tickets30.filter(t => t.status === 'completed');

  // Turnaround time: createdAt → completedAt
  const turnarounds = completed30
    .filter(t => t.completedAt && t.createdAt)
    .map(t => {
      const start = t.createdAt.toDate ? t.createdAt.toDate().getTime() : 0;
      const end = t.completedAt.toDate ? t.completedAt.toDate().getTime() : 0;
      return (end - start) / 86400000;
    })
    .filter(d => d > 0);
  const avgTurnaround = turnarounds.length
    ? turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length
    : 0;

  // Revenue
  const invoiceTime = (inv) => {
    if (inv.createdAt && inv.createdAt.toDate) return inv.createdAt.toDate().getTime();
    return inv.issueDate ? new Date(inv.issueDate).getTime() : 0;
  };
  const paid30 = invoices.filter(i => i.status === 'paid' && invoiceTime(i) >= start30);
  const paid7 = invoices.filter(i => i.status === 'paid' && invoiceTime(i) >= start7);
  const revenue30 = paid30.reduce((s, i) => s + (Number(i.total) || 0), 0);
  const revenue7 = paid7.reduce((s, i) => s + (Number(i.total) || 0), 0);
  const outstanding = invoices
    .filter(i => ['draft', 'sent', 'overdue'].includes(i.status))
    .reduce((s, i) => s + (Number(i.total) || 0), 0);

  // Device type breakdown (top 5)
  const deviceCounts = {};
  tickets30.forEach(t => {
    const d = (t.deviceType || 'Unknown').trim();
    if (!d) return;
    deviceCounts[d] = (deviceCounts[d] || 0) + 1;
  });
  const topDevices = Object.entries(deviceCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Status breakdown (all open tickets)
  const openTickets = tickets.filter(t => t.status !== 'completed');
  const statusCounts = {};
  const labelMap = {
    checked_in: 'Checked In', diagnosed: 'Diagnosed',
    awaiting_parts: 'Awaiting Parts', in_repair: 'In Repair',
    qc: 'Quality Check', ready: 'Ready for Pickup'
  };
  openTickets.forEach(t => {
    const s = t.status || 'unknown';
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  });

  // Low stock alerts
  const lowStock = parts.filter(p => (p.quantity || 0) <= (p.reorderLevel || 0) && (p.reorderLevel || 0) > 0);

  // ── Render ──
  container.innerHTML = '';

  // Top KPI cards
  const kpis = document.createElement('div');
  kpis.className = 'stats-grid';
  kpis.innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Revenue (30d)</div>
      <div class="stat-value">${formatCurrency(revenue30)}</div>
      <div style="font-size:0.75rem;color:var(--gray);margin-top:0.25rem;">${formatCurrency(revenue7)} last 7 days</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Outstanding</div>
      <div class="stat-value" style="color:${outstanding > 0 ? '#d97706' : '#059669'};">${formatCurrency(outstanding)}</div>
      <div style="font-size:0.75rem;color:var(--gray);margin-top:0.25rem;">${invoices.filter(i => ['draft','sent','overdue'].includes(i.status)).length} open invoices</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Tickets (30d)</div>
      <div class="stat-value">${tickets30.length}</div>
      <div style="font-size:0.75rem;color:var(--gray);margin-top:0.25rem;">${tickets7.length} this week &middot; ${completed30.length} completed</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Avg. Turnaround</div>
      <div class="stat-value">${avgTurnaround ? avgTurnaround.toFixed(1) + 'd' : '—'}</div>
      <div style="font-size:0.75rem;color:var(--gray);margin-top:0.25rem;">on completed tickets</div>
    </div>
  `;
  container.appendChild(kpis);

  // Top devices
  const twoCol = document.createElement('div');
  twoCol.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-top:1rem;';

  const devicesSection = document.createElement('div');
  devicesSection.className = 'settings-section';
  let devHtml = '<h3 class="section-title">Top Devices (30d)</h3>';
  if (topDevices.length === 0) {
    devHtml += '<p style="color:var(--gray);font-size:0.9rem;">No tickets yet.</p>';
  } else {
    const max = topDevices[0][1];
    devHtml += '<div style="display:flex;flex-direction:column;gap:0.5rem;">';
    topDevices.forEach(([device, count]) => {
      const pct = (count / max) * 100;
      devHtml += `
        <div style="display:flex;align-items:center;gap:0.5rem;font-size:0.85rem;">
          <div style="flex:1;min-width:0;">
            <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(device)}</div>
            <div style="height:4px;background:var(--bg);border-radius:2px;overflow:hidden;margin-top:0.2rem;">
              <div style="height:100%;width:${pct}%;background:var(--accent);"></div>
            </div>
          </div>
          <div style="color:var(--gray-dark);min-width:32px;text-align:right;">${count}</div>
        </div>
      `;
    });
    devHtml += '</div>';
  }
  devicesSection.innerHTML = devHtml;
  twoCol.appendChild(devicesSection);

  // Open ticket pipeline
  const pipeSection = document.createElement('div');
  pipeSection.className = 'settings-section';
  let pipeHtml = `<h3 class="section-title">Open Pipeline (${openTickets.length})</h3>`;
  if (openTickets.length === 0) {
    pipeHtml += '<p style="color:var(--gray);font-size:0.9rem;">No open tickets.</p>';
  } else {
    const order = ['checked_in', 'diagnosed', 'awaiting_parts', 'in_repair', 'qc', 'ready'];
    pipeHtml += '<div style="display:flex;flex-direction:column;gap:0.4rem;">';
    order.forEach(s => {
      const count = statusCounts[s] || 0;
      if (count === 0) return;
      pipeHtml += `
        <div style="display:flex;justify-content:space-between;font-size:0.85rem;padding:0.35rem 0;border-bottom:1px solid var(--border);">
          <span>${escapeHtml(labelMap[s] || s)}</span>
          <strong>${count}</strong>
        </div>
      `;
    });
    pipeHtml += '</div>';
  }
  pipeSection.innerHTML = pipeHtml;
  twoCol.appendChild(pipeSection);

  container.appendChild(twoCol);

  // Low stock alerts (Pro tier with inventory)
  if (hasFeature('inventory')) {
    const stockSection = document.createElement('div');
    stockSection.className = 'settings-section';
    stockSection.style.marginTop = '1rem';
    let stockHtml = `<h3 class="section-title">Low Stock Alerts (${lowStock.length})</h3>`;
    if (lowStock.length === 0) {
      stockHtml += '<p style="color:var(--gray);font-size:0.9rem;">All parts are above their reorder levels.</p>';
    } else {
      stockHtml += '<table class="data-table"><thead><tr><th>SKU</th><th>Name</th><th style="text-align:right;">On Hand</th><th style="text-align:right;">Reorder At</th></tr></thead><tbody>';
      lowStock.forEach(p => {
        stockHtml += `<tr>
          <td style="font-family:monospace;">${escapeHtml(p.sku || '-')}</td>
          <td>${escapeHtml(p.name || '-')}</td>
          <td style="text-align:right;"><span class="badge badge-danger">${p.quantity || 0}</span></td>
          <td style="text-align:right;">${p.reorderLevel || 0}</td>
        </tr>`;
      });
      stockHtml += '</tbody></table>';
    }
    stockSection.innerHTML = stockHtml;
    container.appendChild(stockSection);
  }

  // Recent invoices
  const recentInv = invoices.slice(0, 10);
  if (recentInv.length > 0) {
    const recentSection = document.createElement('div');
    recentSection.className = 'settings-section';
    recentSection.style.marginTop = '1rem';
    let recentHtml = '<h3 class="section-title">Recent Invoices</h3>';
    recentHtml += '<table class="data-table"><thead><tr><th>Invoice #</th><th>Customer</th><th style="text-align:right;">Total</th><th>Status</th><th>Date</th></tr></thead><tbody>';
    recentInv.forEach(inv => {
      const statusClass = inv.status === 'paid' ? 'badge-success' : inv.status === 'sent' ? 'badge-info' : inv.status === 'overdue' ? 'badge-danger' : 'badge-default';
      recentHtml += `<tr>
        <td style="font-family:monospace;font-weight:500;">${escapeHtml(inv.invoiceNumber || '-')}</td>
        <td>${escapeHtml(inv.clientName || '-')}</td>
        <td style="text-align:right;">${formatCurrency(inv.total)}</td>
        <td><span class="badge ${statusClass}">${escapeHtml(inv.status || 'draft')}</span></td>
        <td>${escapeHtml(inv.issueDate || '-')}</td>
      </tr>`;
    });
    recentHtml += '</tbody></table>';
    recentSection.innerHTML = recentHtml;
    container.appendChild(recentSection);
  }
}

function escapeHtml(str) {
  if (str == null) return '';
  const node = document.createElement('span');
  node.appendChild(document.createTextNode(String(str)));
  return node.innerHTML;
}

function formatCurrency(amount) {
  if (amount == null || isNaN(amount)) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}
