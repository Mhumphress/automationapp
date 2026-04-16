import { getTenants } from '../services/tenants.js';
import { getPackages, getVerticals } from '../services/catalog.js';
import { showToast, escapeHtml, formatCurrency, formatDate } from '../ui.js';
import { navigate } from '../router.js';

let tenants = [];
let packages = [];
let verticals = [];

export function init() {}

export async function render() {
  await loadData();
  renderView();
}

export function destroy() {}

async function loadData() {
  try {
    const results = await Promise.allSettled([
      getTenants(), getPackages(), getVerticals()
    ]);
    tenants = results[0].status === 'fulfilled' ? results[0].value : [];
    packages = results[1].status === 'fulfilled' ? results[1].value : [];
    verticals = results[2].status === 'fulfilled' ? results[2].value : [];
  } catch (err) {
    console.error('Failed to load renewals data:', err);
  }
}

function renderView() {
  const container = document.getElementById('view-renewals');
  container.innerHTML = '';

  if (tenants.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg class="empty-icon" xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>
        <div class="empty-title">No renewals to track</div>
        <p class="empty-description">Renewals will appear here once you have active tenants.</p>
      </div>
    `;
    return;
  }

  // Revenue Summary
  const summarySection = document.createElement('div');
  summarySection.className = 'settings-section';
  const activeTenants = tenants.filter(t => t.status === 'active' || t.status === 'past_due');
  const mrr = activeTenants.reduce((sum, t) => {
    const pkg = packages.find(p => p.id === t.packageId);
    const price = t.priceOverride != null ? t.priceOverride : (pkg ? pkg.basePrice : 0);
    return sum + price;
  }, 0);

  const byVertical = {};
  activeTenants.forEach(t => {
    const v = verticals.find(v2 => v2.id === t.vertical);
    const label = v ? v.name : t.vertical;
    const pkg = packages.find(p => p.id === t.packageId);
    const price = t.priceOverride != null ? t.priceOverride : (pkg ? pkg.basePrice : 0);
    byVertical[label] = (byVertical[label] || 0) + price;
  });

  summarySection.innerHTML = `
    <h2 class="section-title">Revenue Summary</h2>
    <div class="stats-grid" style="margin-bottom:1.5rem;">
      <div class="stat-card">
        <div class="stat-label">Monthly Recurring Revenue</div>
        <div class="stat-value">${formatCurrency(mrr)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Annual Run Rate</div>
        <div class="stat-value">${formatCurrency(mrr * 12)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Active Tenants</div>
        <div class="stat-value">${activeTenants.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Overdue Accounts</div>
        <div class="stat-value" style="color:${tenants.filter(t => t.status === 'past_due' || t.status === 'suspended').length > 0 ? 'var(--danger)' : 'inherit'};">${tenants.filter(t => t.status === 'past_due' || t.status === 'suspended').length}</div>
      </div>
    </div>
    ${Object.keys(byVertical).length > 0 ? `
      <div style="margin-bottom:1.5rem;">
        <div style="font-weight:500;margin-bottom:0.5rem;font-size:0.9rem;">MRR by Vertical</div>
        ${Object.entries(byVertical).map(([label, amount]) => `
          <div style="display:flex;justify-content:space-between;padding:0.3rem 0;font-size:0.85rem;">
            <span>${escapeHtml(label)}</span>
            <span style="font-weight:500;">${formatCurrency(amount)}</span>
          </div>
        `).join('')}
      </div>
    ` : ''}
  `;
  container.appendChild(summarySection);

  // Upcoming Renewals
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const upcoming = tenants.filter(t => {
    if (t.status !== 'active') return false;
    if (!t.nextRenewalDate) return false;
    const renewal = t.nextRenewalDate.toDate ? t.nextRenewalDate.toDate() : new Date(t.nextRenewalDate);
    return renewal <= in30Days;
  }).sort((a, b) => {
    const da = a.nextRenewalDate?.toDate ? a.nextRenewalDate.toDate() : new Date(a.nextRenewalDate);
    const db2 = b.nextRenewalDate?.toDate ? b.nextRenewalDate.toDate() : new Date(b.nextRenewalDate);
    return da - db2;
  });

  const upcomingSection = document.createElement('div');
  upcomingSection.className = 'settings-section';
  upcomingSection.style.marginTop = '1.5rem';

  if (upcoming.length === 0) {
    upcomingSection.innerHTML = '<h2 class="section-title">Upcoming Renewals (30 days)</h2><p style="color:var(--gray);padding:0.5rem 0;font-size:0.9rem;">No renewals due in the next 30 days.</p>';
  } else {
    let html = '<h2 class="section-title">Upcoming Renewals (30 days)</h2>';
    html += '<table class="data-table"><thead><tr><th>Company</th><th>Package</th><th>Amount</th><th>Renewal Date</th><th>Days Until</th></tr></thead><tbody>';
    upcoming.forEach(t => {
      const pkg = packages.find(p => p.id === t.packageId);
      const price = t.priceOverride != null ? t.priceOverride : (pkg ? pkg.basePrice : 0);
      const renewal = t.nextRenewalDate?.toDate ? t.nextRenewalDate.toDate() : new Date(t.nextRenewalDate);
      const daysUntil = Math.ceil((renewal - now) / (1000 * 60 * 60 * 24));
      html += `<tr class="clickable" data-tenant-id="${t.id}">
        <td style="font-weight:500;">${escapeHtml(t.companyName)}</td>
        <td>${escapeHtml(pkg ? pkg.name : '-')}</td>
        <td>${formatCurrency(price)}</td>
        <td>${formatDate(t.nextRenewalDate)}</td>
        <td><span class="badge ${daysUntil <= 7 ? 'badge-warning' : 'badge-info'}">${daysUntil} days</span></td>
      </tr>`;
    });
    html += '</tbody></table>';
    upcomingSection.innerHTML = html;

    upcomingSection.querySelectorAll('tr.clickable').forEach(row => {
      row.addEventListener('click', () => navigate('tenants'));
    });
  }
  container.appendChild(upcomingSection);

  // Overdue Accounts
  const overdue = tenants.filter(t => t.status === 'past_due' || t.status === 'suspended');

  const overdueSection = document.createElement('div');
  overdueSection.className = 'settings-section';
  overdueSection.style.marginTop = '1.5rem';

  if (overdue.length === 0) {
    overdueSection.innerHTML = '<h2 class="section-title">Overdue Accounts</h2><p style="color:var(--gray);padding:0.5rem 0;font-size:0.9rem;">No overdue accounts.</p>';
  } else {
    let html = '<h2 class="section-title">Overdue Accounts</h2>';
    html += '<table class="data-table"><thead><tr><th>Company</th><th>Status</th><th>Grace Period</th></tr></thead><tbody>';
    overdue.forEach(t => {
      const graceEnd = t.gracePeriodEnd?.toDate ? t.gracePeriodEnd.toDate() : (t.gracePeriodEnd ? new Date(t.gracePeriodEnd) : null);
      const daysLeft = graceEnd ? Math.ceil((graceEnd - now) / (1000 * 60 * 60 * 24)) : '-';
      html += `<tr class="clickable" data-tenant-id="${t.id}">
        <td style="font-weight:500;">${escapeHtml(t.companyName)}</td>
        <td><span class="badge ${t.status === 'past_due' ? 'badge-warning' : 'badge-danger'}">${escapeHtml(t.status)}</span></td>
        <td>${typeof daysLeft === 'number' ? (daysLeft > 0 ? `${daysLeft} days left` : 'Expired') : '-'}</td>
      </tr>`;
    });
    html += '</tbody></table>';
    overdueSection.innerHTML = html;

    overdueSection.querySelectorAll('tr.clickable').forEach(row => {
      row.addEventListener('click', () => navigate('tenants'));
    });
  }
  container.appendChild(overdueSection);
}
