import { getTenants, getTenant, updateTenant, getTenantUsers, getTenantActivity, getTenantInvoices, getTenantPayments, addTenantActivity } from '../services/tenants.js';
import { getPackages, getVerticals } from '../services/catalog.js';
import { createModal } from '../components/modal.js';
import { showToast, escapeHtml, formatCurrency, formatDate } from '../ui.js';

let tenants = [];
let packages = [];
let verticals = [];
let modal = null;
let searchTerm = '';
let filterStatus = 'all';
let filterVertical = 'all';
let currentPage = 'list';

export function init() {
  modal = createModal();
}

export async function render() {
  await loadData();
  if (currentPage === 'list') renderListView();
}

export function destroy() {
  currentPage = 'list';
}

async function loadData() {
  try {
    const results = await Promise.allSettled([
      getTenants(), getPackages(), getVerticals()
    ]);
    tenants = results[0].status === 'fulfilled' ? results[0].value : [];
    packages = results[1].status === 'fulfilled' ? results[1].value : [];
    verticals = results[2].status === 'fulfilled' ? results[2].value : [];
  } catch (err) {
    console.error('Failed to load tenant data:', err);
  }
}

// ── List View ──

function renderListView() {
  const container = document.getElementById('view-tenants');
  container.innerHTML = '';

  const topbar = document.createElement('div');
  topbar.className = 'view-topbar';
  topbar.innerHTML = `
    <input type="text" class="search-input" placeholder="Search tenants..." value="${escapeHtml(searchTerm)}">
    <select class="filter-select" id="filterVertical" style="padding:0.5rem;border-radius:6px;border:1px solid var(--border);">
      <option value="all">All Verticals</option>
      ${verticals.map(v => `<option value="${v.id}" ${filterVertical === v.id ? 'selected' : ''}>${escapeHtml(v.name)}</option>`).join('')}
    </select>
    <select class="filter-select" id="filterStatus" style="padding:0.5rem;border-radius:6px;border:1px solid var(--border);">
      <option value="all" ${filterStatus === 'all' ? 'selected' : ''}>All Status</option>
      <option value="active" ${filterStatus === 'active' ? 'selected' : ''}>Active</option>
      <option value="past_due" ${filterStatus === 'past_due' ? 'selected' : ''}>Past Due</option>
      <option value="suspended" ${filterStatus === 'suspended' ? 'selected' : ''}>Suspended</option>
      <option value="cancelled" ${filterStatus === 'cancelled' ? 'selected' : ''}>Cancelled</option>
    </select>
  `;
  container.appendChild(topbar);

  topbar.querySelector('.search-input').addEventListener('input', (e) => {
    searchTerm = e.target.value.trim();
    renderContent(container);
  });
  topbar.querySelector('#filterVertical').addEventListener('change', (e) => {
    filterVertical = e.target.value;
    renderContent(container);
  });
  topbar.querySelector('#filterStatus').addEventListener('change', (e) => {
    filterStatus = e.target.value;
    renderContent(container);
  });

  renderContent(container);
}

function renderContent(container) {
  const existing = container.querySelector('.view-content');
  if (existing) existing.remove();

  const wrapper = document.createElement('div');
  wrapper.className = 'view-content';

  let filtered = [...tenants];

  if (filterVertical !== 'all') {
    filtered = filtered.filter(t => t.vertical === filterVertical);
  }
  if (filterStatus !== 'all') {
    filtered = filtered.filter(t => t.status === filterStatus);
  }
  if (searchTerm) {
    const lower = searchTerm.toLowerCase();
    filtered = filtered.filter(t =>
      (t.companyName || '').toLowerCase().includes(lower) ||
      (t.vertical || '').toLowerCase().includes(lower) ||
      (t.tier || '').toLowerCase().includes(lower)
    );
  }

  if (filtered.length === 0 && tenants.length === 0) {
    wrapper.innerHTML = `
      <div class="empty-state">
        <svg class="empty-icon" xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v3"/>
        </svg>
        <div class="empty-title">No tenants yet</div>
        <p class="empty-description">Tenants are created when you win a deal in the Pipeline and provision it.</p>
      </div>
    `;
  } else if (filtered.length === 0) {
    wrapper.innerHTML = `
      <div class="empty-state">
        <div class="empty-title">No matches</div>
        <p class="empty-description">No tenants match your filters.</p>
      </div>
    `;
  } else {
    const table = document.createElement('table');
    table.className = 'data-table';

    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Company</th><th>Vertical</th><th>Package</th><th>Status</th><th>MRR</th><th>Next Renewal</th></tr>';
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    filtered.forEach(t => {
      const pkg = packages.find(p => p.id === t.packageId);
      const vertical = verticals.find(v => v.id === t.vertical);
      const statusColors = { active: 'badge-success', past_due: 'badge-warning', suspended: 'badge-danger', cancelled: 'badge-default' };
      const mrr = t.priceOverride != null ? t.priceOverride : (pkg ? pkg.basePrice : 0);

      const tr = document.createElement('tr');
      tr.className = 'clickable';
      tr.innerHTML = `
        <td style="font-weight:500;">${escapeHtml(t.companyName || 'Unnamed')}</td>
        <td><span class="badge badge-info">${escapeHtml(vertical ? vertical.name : t.vertical)}</span></td>
        <td>${escapeHtml(pkg ? pkg.name : t.packageId || '-')}<br><span style="font-size:0.75rem;color:var(--gray);text-transform:uppercase;">${escapeHtml(t.tier || '')}</span></td>
        <td><span class="badge ${statusColors[t.status] || 'badge-default'}">${escapeHtml(t.status || 'unknown')}</span></td>
        <td>${formatCurrency(mrr)}</td>
        <td>${t.nextRenewalDate ? formatDate(t.nextRenewalDate) : '\u2014'}</td>
      `;
      tr.addEventListener('click', () => showDetailPage(t));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrapper.appendChild(table);
  }

  container.appendChild(wrapper);
}

// ── Detail Page ──

async function showDetailPage(tenant) {
  currentPage = 'detail';
  const container = document.getElementById('view-tenants');
  container.innerHTML = '';

  // Reload tenant data
  const freshTenant = await getTenant(tenant.id) || tenant;
  const pkg = packages.find(p => p.id === freshTenant.packageId);
  const vertical = verticals.find(v => v.id === freshTenant.vertical);

  // Back button
  const backBtn = document.createElement('button');
  backBtn.className = 'detail-back';
  backBtn.innerHTML = '&larr; Back to Tenants';
  backBtn.addEventListener('click', () => {
    currentPage = 'list';
    renderListView();
  });
  container.appendChild(backBtn);

  // Header
  const statusColors = { active: '#4ade80', past_due: '#fbbf24', suspended: '#f87171', cancelled: '#94a3b8' };
  const header = document.createElement('div');
  header.className = 'detail-header';
  header.innerHTML = `
    <div class="detail-avatar" style="width:64px;height:64px;font-size:1.5rem;background:${statusColors[freshTenant.status] || '#94a3b8'}20;color:${statusColors[freshTenant.status] || '#94a3b8'};">${escapeHtml((freshTenant.companyName || '?')[0].toUpperCase())}</div>
    <div style="flex:1;">
      <div class="detail-name">${escapeHtml(freshTenant.companyName)}</div>
      <div class="detail-subtitle">${escapeHtml(vertical ? vertical.name : freshTenant.vertical)} &middot; <span class="badge ${freshTenant.status === 'active' ? 'badge-success' : freshTenant.status === 'past_due' ? 'badge-warning' : 'badge-danger'}">${escapeHtml(freshTenant.status)}</span></div>
    </div>
  `;
  container.appendChild(header);

  // Two-column layout
  const layout = document.createElement('div');
  layout.className = 'detail-layout';

  // Left column — Subscription & Access
  const leftCol = document.createElement('div');

  // Subscription info
  const subSection = document.createElement('div');
  subSection.className = 'detail-section-title';
  subSection.textContent = 'Subscription';
  leftCol.appendChild(subSection);

  const fields = [
    { label: 'Package', value: pkg ? pkg.name : freshTenant.packageId || '-' },
    { label: 'Tier', value: (freshTenant.tier || '-').charAt(0).toUpperCase() + (freshTenant.tier || '-').slice(1) },
    { label: 'Billing Cycle', value: freshTenant.billingCycle || 'monthly' },
    { label: 'Base Price', value: pkg ? formatCurrency(pkg.basePrice) + '/mo' : '-' },
    { label: 'Price Override', value: freshTenant.priceOverride != null ? formatCurrency(freshTenant.priceOverride) + '/mo' : 'None (using default)' },
    { label: 'User Limit', value: freshTenant.userLimit === 0 ? 'Unlimited' : String(freshTenant.userLimit || '-') },
    { label: 'Next Renewal', value: freshTenant.nextRenewalDate ? formatDate(freshTenant.nextRenewalDate) : '-' },
    { label: 'Onboarding', value: freshTenant.onboardingStep || 'pending' },
  ];

  fields.forEach(f => {
    const field = document.createElement('div');
    field.className = 'detail-field';
    field.innerHTML = `<div class="detail-field-label">${f.label}</div><div class="detail-field-value">${escapeHtml(String(f.value))}</div>`;
    leftCol.appendChild(field);
  });

  // Access control buttons
  const accessSection = document.createElement('div');
  accessSection.style.marginTop = '1.5rem';
  accessSection.innerHTML = `<div class="detail-section-title">Access Control</div>`;

  const btnGroup = document.createElement('div');
  btnGroup.style.cssText = 'display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.5rem;';

  if (freshTenant.status !== 'active') {
    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'btn btn-primary btn-sm';
    restoreBtn.textContent = 'Restore Access';
    restoreBtn.addEventListener('click', async () => {
      try {
        await updateTenant(freshTenant.id, { status: 'active', gracePeriodEnd: null });
        await addTenantActivity(freshTenant.id, { type: 'status_change', description: 'Account restored to active', metadata: { oldStatus: freshTenant.status, newStatus: 'active' } });
        showToast('Access restored', 'success');
        freshTenant.status = 'active';
        showDetailPage(freshTenant);
      } catch (err) {
        showToast('Failed to restore access', 'error');
        console.error(err);
      }
    });
    btnGroup.appendChild(restoreBtn);
  }

  if (freshTenant.status === 'active') {
    const suspendBtn = document.createElement('button');
    suspendBtn.className = 'btn btn-ghost btn-sm';
    suspendBtn.style.color = 'var(--danger)';
    suspendBtn.textContent = 'Suspend Access';
    suspendBtn.addEventListener('click', async () => {
      if (!confirm(`Suspend ${freshTenant.companyName}? They will lose all access.`)) return;
      try {
        await updateTenant(freshTenant.id, { status: 'suspended' });
        await addTenantActivity(freshTenant.id, { type: 'status_change', description: 'Account suspended', metadata: { oldStatus: 'active', newStatus: 'suspended' } });
        showToast('Access suspended', 'success');
        freshTenant.status = 'suspended';
        showDetailPage(freshTenant);
      } catch (err) {
        showToast('Failed to suspend', 'error');
        console.error(err);
      }
    });
    btnGroup.appendChild(suspendBtn);

    const readOnlyBtn = document.createElement('button');
    readOnlyBtn.className = 'btn btn-ghost btn-sm';
    readOnlyBtn.style.color = 'var(--warning)';
    readOnlyBtn.textContent = 'Set Read-Only';
    readOnlyBtn.addEventListener('click', async () => {
      try {
        const gracePeriodEnd = new Date();
        gracePeriodEnd.setDate(gracePeriodEnd.getDate() + 30);
        await updateTenant(freshTenant.id, { status: 'past_due', gracePeriodEnd });
        await addTenantActivity(freshTenant.id, { type: 'status_change', description: 'Account set to read-only (past due)', metadata: { oldStatus: 'active', newStatus: 'past_due' } });
        showToast('Set to read-only', 'success');
        freshTenant.status = 'past_due';
        showDetailPage(freshTenant);
      } catch (err) {
        showToast('Failed to update status', 'error');
        console.error(err);
      }
    });
    btnGroup.appendChild(readOnlyBtn);
  }

  accessSection.appendChild(btnGroup);
  leftCol.appendChild(accessSection);

  // Right column — Users & Activity
  const rightCol = document.createElement('div');

  // Users
  const usersTitle = document.createElement('div');
  usersTitle.className = 'detail-section-title';
  usersTitle.textContent = 'Users';
  rightCol.appendChild(usersTitle);

  try {
    const users = await getTenantUsers(freshTenant.id);
    if (users.length === 0) {
      const noUsers = document.createElement('div');
      noUsers.style.cssText = 'font-size:0.85rem;color:var(--gray);margin-bottom:1.5rem;';
      noUsers.textContent = 'No users yet.';
      rightCol.appendChild(noUsers);
    } else {
      users.forEach(u => {
        const row = document.createElement('div');
        row.style.cssText = 'padding:0.4rem 0;font-size:0.85rem;display:flex;justify-content:space-between;align-items:center;';
        row.innerHTML = `
          <div>
            <span style="font-weight:500;">${escapeHtml(u.displayName || u.email)}</span>
            <span style="color:var(--gray);margin-left:0.5rem;">${escapeHtml(u.email)}</span>
          </div>
          <span class="badge badge-info">${escapeHtml(u.role)}</span>
        `;
        rightCol.appendChild(row);
      });
    }
  } catch (err) {
    console.error('Failed to load tenant users:', err);
  }

  // Activity
  const actTitle = document.createElement('div');
  actTitle.className = 'detail-section-title';
  actTitle.style.marginTop = '1.5rem';
  actTitle.textContent = 'Activity';
  rightCol.appendChild(actTitle);

  try {
    const activity = await getTenantActivity(freshTenant.id);
    if (activity.length === 0) {
      const noAct = document.createElement('div');
      noAct.style.cssText = 'font-size:0.85rem;color:var(--gray);';
      noAct.textContent = 'No activity yet.';
      rightCol.appendChild(noAct);
    } else {
      const timeline = document.createElement('div');
      timeline.className = 'detail-timeline';
      activity.slice(0, 20).forEach(act => {
        const item = document.createElement('div');
        item.className = 'activity-item';
        item.innerHTML = `
          <div class="activity-icon ${act.type || ''}">&#8226;</div>
          <div class="activity-card">
            <div class="activity-desc">${escapeHtml(act.description || act.type || '-')}</div>
            <div class="activity-meta">${escapeHtml(act.createdByEmail || 'System')} &middot; ${formatDate(act.createdAt)}</div>
          </div>
        `;
        timeline.appendChild(item);
      });
      rightCol.appendChild(timeline);
    }
  } catch (err) {
    console.error('Failed to load tenant activity:', err);
  }

  layout.appendChild(leftCol);
  layout.appendChild(rightCol);
  container.appendChild(layout);
}
