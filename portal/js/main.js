import { auth } from './config.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  loadTenantContext, getTenant, getVertical, getPackage,
  hasFeature, isReadOnly, isSuspended, getUserRole, term, applyBranding, resolveColors, THEMES
} from './tenant-context.js';

// ── Simple router (inline, no shared dependency for now) ──

const views = {};
const initialised = {};
let currentView = null;

function registerView(name, { init, render, destroy } = {}) {
  views[name] = { init: init || null, render: render || null, destroy: destroy || null };
}

function navigate(viewName) {
  if (!views[viewName]) { console.warn(`[portal-router] Unknown view: "${viewName}"`); return; }
  if (currentView && views[currentView] && views[currentView].destroy) {
    try { views[currentView].destroy(); } catch (e) { console.error(e); }
  }
  document.querySelectorAll('.view-container').forEach(el => { el.style.display = 'none'; });
  const target = document.getElementById(`view-${viewName}`);
  if (target) target.style.display = 'block';
  if (!initialised[viewName] && views[viewName].init) {
    try { views[viewName].init(); } catch (e) { console.error(e); }
    initialised[viewName] = true;
  }
  if (views[viewName].render) {
    try { views[viewName].render(); } catch (e) { console.error(e); }
  }
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });
  currentView = viewName;
  if (window.location.hash !== `#${viewName}`) window.location.hash = viewName;
}

function initRouter(defaultView = 'dashboard') {
  const hashView = window.location.hash.replace('#', '');
  const startView = (hashView && views[hashView]) ? hashView : defaultView;
  navigate(startView);
  window.addEventListener('hashchange', () => {
    const next = window.location.hash.replace('#', '');
    if (next && views[next] && next !== currentView) navigate(next);
  });
}

// ── Auth guard ──

let authHandled = false;
onAuthStateChanged(auth, async (user) => {
  if (authHandled) return;
  authHandled = true;

  if (!user) {
    window.location.replace('index.html');
    return;
  }

  // Populate user info
  const displayName = user.displayName || user.email || 'User';
  const initials = displayName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  document.getElementById('userAvatar').textContent = initials;
  document.getElementById('userName').textContent = displayName;

  // Load tenant context
  try {
    const { tenants, selected } = await loadTenantContext();
    document.getElementById('userRole').textContent = getUserRole() || 'user';

    // Hide loading
    document.getElementById('portalLoading').style.display = 'none';

    // Check status
    if (isSuspended()) {
      document.getElementById('suspendedState').style.display = 'flex';
      return;
    }

    // Show read-only banner if past due
    if (isReadOnly()) {
      const banner = document.getElementById('statusBanner');
      banner.className = 'status-banner past-due';
      banner.textContent = 'Your account is past due. Access is read-only until payment is received.';
      banner.style.display = '';
    }

    // Set brand name
    const tenant = getTenant();
    if (tenant) {
      document.getElementById('portalBrandName').textContent = tenant.companyName || 'Customer Portal';
    }

    // Build sidebar and register views
    buildSidebar();
    await registerAllViews();
    initRouter('dashboard');

  } catch (err) {
    console.error('Portal init error:', err);
    document.getElementById('portalLoading').style.display = 'none';
    if (err.message === 'NO_TENANT') {
      document.getElementById('noTenantState').style.display = 'flex';
    } else {
      const errorState = document.getElementById('noTenantState');
      errorState.innerHTML = `
        <div class="empty-state">
          <div class="empty-title">Something went wrong</div>
          <p class="empty-description">Failed to load your account. Please try refreshing the page or contact support.</p>
          <pre style="background:var(--bg);padding:0.75rem;border-radius:6px;font-size:0.8rem;margin-top:1rem;max-width:500px;overflow-x:auto;">${escapeHtml(err.message || String(err))}</pre>
        </div>
      `;
      errorState.style.display = 'flex';
    }
  }
});

// ── Logout ──

document.getElementById('logoutBtn').addEventListener('click', async () => {
  try {
    localStorage.removeItem('portal_tenant_id');
    await signOut(auth);
  } catch (err) {
    console.error('Sign out failed:', err);
  }
});

// ── Mobile menu ──

document.getElementById('menuToggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});
document.getElementById('sidebarOverlay').addEventListener('click', () => {
  document.getElementById('sidebar').classList.remove('open');
});

// ── Build sidebar dynamically based on tenant features ──

function buildSidebar() {
  const nav = document.getElementById('portalNav');
  nav.innerHTML = '';

  const vertical = getVertical();
  const tenant = getTenant();

  // Account section
  addNavSection(nav, 'Account');
  addNavItem(nav, 'dashboard', 'Dashboard', '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>');
  addNavItem(nav, 'subscription', 'Subscription', '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>');
  addNavItem(nav, 'billing', 'Billing', '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/>');
  addNavItem(nav, 'team', 'Team', '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>');
  addNavItem(nav, 'account-settings', 'Settings', '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>');

  // Workspace section — modules based on features
  addNavSection(nav, 'Workspace');

  if (hasFeature('contacts')) {
    addNavItem(nav, 'contacts', term('client') + 's', '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>');
  }

  // Vertical-specific modules
  if (vertical) {
    const vertModules = getVerticalModuleNav(vertical.id);
    vertModules.forEach(m => {
      if (hasFeature(m.feature)) {
        addNavItem(nav, m.view, m.label, m.icon);
      }
    });
  }

  // Shared modules
  if (hasFeature('invoicing')) {
    addNavItem(nav, 'invoicing', 'Invoicing', '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>');
  }
  if (hasFeature('tasks')) {
    addNavItem(nav, 'tasks', 'Tasks', '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 12l2 2 4-4"/>');
  }
  if (hasFeature('scheduling')) {
    addNavItem(nav, 'scheduling', 'Scheduling', '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>');
  }
  if (hasFeature('reporting')) {
    addNavItem(nav, 'reporting', 'Reporting', '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>');
  }

  // Wire click handlers
  nav.querySelectorAll('.nav-item[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      navigate(btn.dataset.view);
      document.getElementById('sidebar').classList.remove('open');
    });
  });
}

function addNavSection(nav, label) {
  const el = document.createElement('div');
  el.className = 'nav-section-label';
  el.textContent = label;
  nav.appendChild(el);
}

function addNavItem(nav, view, label, iconPath) {
  const btn = document.createElement('button');
  btn.className = 'nav-item';
  btn.dataset.view = view;
  btn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${iconPath}</svg>
    ${label}
  `;
  nav.appendChild(btn);
}

function getVerticalModuleNav(verticalId) {
  const modules = {
    repair: [
      { feature: 'tickets', view: 'tickets', label: 'Repair Tickets', icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><line x1="9" y1="15" x2="15" y2="15"/>' },
      { feature: 'inventory', view: 'inventory', label: 'Parts Inventory', icon: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>' },
      { feature: 'checkin', view: 'checkin', label: 'Check-in/out', icon: '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>' },
    ],
    trades: [
      { feature: 'jobs', view: 'jobs', label: 'Jobs', icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>' },
      { feature: 'dispatching', view: 'dispatching', label: 'Dispatching', icon: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>' },
      { feature: 'quoting', view: 'quoting', label: 'Quoting', icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><line x1="9" y1="13" x2="15" y2="13"/>' },
    ],
    manufacturing: [
      { feature: 'bom', view: 'bom', label: 'BOM', icon: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>' },
      { feature: 'work_orders', view: 'work-orders', label: 'Work Orders', icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 12l2 2 4-4"/>' },
      { feature: 'inventory', view: 'inventory', label: 'Inventory', icon: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>' },
    ],
    services: [
      { feature: 'projects', view: 'projects', label: 'Projects', icon: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>' },
      { feature: 'time_tracking', view: 'time-tracking', label: 'Time Tracking', icon: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>' },
      { feature: 'proposals', view: 'proposals', label: 'Proposals', icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><line x1="9" y1="13" x2="15" y2="13"/>' },
    ],
    property: [
      { feature: 'properties', view: 'properties', label: 'Properties', icon: '<path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/>' },
      { feature: 'leases', view: 'leases', label: 'Leases', icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>' },
      { feature: 'maintenance', view: 'maintenance', label: 'Maintenance', icon: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>' },
    ],
    salon: [
      { feature: 'appointments', view: 'appointments', label: 'Appointments', icon: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>' },
      { feature: 'service_menu', view: 'service-menu', label: 'Services', icon: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>' },
      { feature: 'staff_calendar', view: 'staff-calendar', label: 'Staff Calendar', icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>' },
      { feature: 'loyalty', view: 'loyalty', label: 'Client Loyalty', icon: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>' },
    ],
  };
  return modules[verticalId] || [];
}

// ── Register all views ──

async function registerAllViews() {
  // Dashboard
  registerView('dashboard', {
    render() {
      document.getElementById('headerTitle').textContent = 'Dashboard';
      renderDashboard();
    }
  });

  // Account views
  registerView('subscription', {
    render() {
      document.getElementById('headerTitle').textContent = 'Subscription';
      renderSubscription();
    }
  });

  registerView('billing', {
    render() {
      document.getElementById('headerTitle').textContent = 'Billing';
      renderBilling();
    }
  });

  registerView('team', {
    render() {
      document.getElementById('headerTitle').textContent = 'Team';
      renderTeam();
    }
  });

  registerView('account-settings', {
    render() {
      document.getElementById('headerTitle').textContent = 'Settings';
      renderAccountSettings();
    }
  });

  // ── Shared modules (real implementations) ──

  // Dynamically import shared modules
  const contactsMod = await import('./views/shared/contacts.js');
  registerView('contacts', {
    init: contactsMod.init,
    render() { document.getElementById('headerTitle').textContent = term('client') + 's'; contactsMod.render(); },
    destroy: contactsMod.destroy
  });

  const tasksMod = await import('./views/shared/tasks.js');
  registerView('tasks', {
    init: tasksMod.init,
    render() { document.getElementById('headerTitle').textContent = 'Tasks'; tasksMod.render(); },
    destroy: tasksMod.destroy
  });

  const invoicingMod = await import('./views/shared/invoicing.js');
  registerView('invoicing', {
    init: invoicingMod.init,
    render() { document.getElementById('headerTitle').textContent = 'Invoicing'; invoicingMod.render(); },
    destroy: invoicingMod.destroy
  });

  const inventoryMod = await import('./views/repair/inventory.js');
  registerView('inventory', {
    init: inventoryMod.init,
    render() { document.getElementById('headerTitle').textContent = 'Parts Inventory'; inventoryMod.render(); },
    destroy: inventoryMod.destroy
  });

  const ticketsMod = await import('./views/repair/tickets.js');
  registerView('tickets', {
    init: ticketsMod.init,
    render() { document.getElementById('headerTitle').textContent = 'Repair Tickets'; ticketsMod.render(); },
    destroy: ticketsMod.destroy
  });

  const checkinMod = await import('./views/repair/checkin.js');
  registerView('checkin', {
    init: checkinMod.init,
    render() { document.getElementById('headerTitle').textContent = 'Check In'; checkinMod.render(); },
    destroy: checkinMod.destroy
  });

  // Placeholder views for modules not yet implemented
  const placeholderViews = [
    'scheduling', 'reporting',
    'jobs', 'dispatching', 'quoting',
    'bom', 'work-orders',
    'projects', 'time-tracking', 'proposals',
    'properties', 'leases', 'maintenance',
    'appointments', 'service-menu', 'staff-calendar', 'loyalty'
  ];

  placeholderViews.forEach(name => {
    if (!document.getElementById(`view-${name}`)) {
      const div = document.createElement('div');
      div.id = `view-${name}`;
      div.className = 'view-container';
      document.getElementById('appMain').appendChild(div);
    }

    registerView(name, {
      render() {
        const title = name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        document.getElementById('headerTitle').textContent = title;
        const container = document.getElementById(`view-${name}`);
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-title">${title}</div>
            <p class="empty-description">This module is coming soon.</p>
          </div>
        `;
      }
    });
  });
}

// ── Dashboard ──

function renderDashboard() {
  const container = document.getElementById('view-dashboard');
  const tenant = getTenant();
  const pkg = getPackage();
  const vertical = getVertical();

  container.innerHTML = `
    <div style="margin-bottom:2rem;">
      <h2 style="font-family:var(--font-display);font-size:1.5rem;margin-bottom:0.25rem;">Welcome, ${escapeHtml(tenant.companyName)}</h2>
      <p style="color:var(--gray-dark);font-size:0.9rem;">${escapeHtml(vertical ? vertical.name : '')} &middot; ${escapeHtml(pkg ? pkg.name : '')}</p>
    </div>
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Plan</div>
        <div class="stat-value" style="font-size:1.1rem;">${escapeHtml(pkg ? pkg.name : '-')}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Status</div>
        <div class="stat-value" style="font-size:1.1rem;color:${tenant.status === 'active' ? '#059669' : '#DC2626'};">${escapeHtml(tenant.status || '-')}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Billing</div>
        <div class="stat-value" style="font-size:1.1rem;">${escapeHtml(tenant.billingCycle || 'monthly')}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Features</div>
        <div class="stat-value" style="font-size:1.1rem;">${(pkg ? pkg.features || [] : []).length}</div>
      </div>
    </div>
  `;
}

// ── Subscription ──

function renderSubscription() {
  const container = document.getElementById('view-subscription');
  const tenant = getTenant();
  const pkg = getPackage();
  const vertical = getVertical();

  const price = tenant.priceOverride != null ? tenant.priceOverride : (pkg ? pkg.basePrice : 0);

  container.innerHTML = `
    <div class="settings-section">
      <h2 class="section-title">Current Plan</h2>
      <div class="detail-field"><div class="detail-field-label">Package</div><div class="detail-field-value">${escapeHtml(pkg ? pkg.name : '-')}</div></div>
      <div class="detail-field"><div class="detail-field-label">Tier</div><div class="detail-field-value">${escapeHtml((tenant.tier || '-').charAt(0).toUpperCase() + (tenant.tier || '').slice(1))}</div></div>
      <div class="detail-field"><div class="detail-field-label">Vertical</div><div class="detail-field-value">${escapeHtml(vertical ? vertical.name : '-')}</div></div>
      <div class="detail-field"><div class="detail-field-label">Monthly Price</div><div class="detail-field-value">${formatCurrency(price)}/mo</div></div>
      <div class="detail-field"><div class="detail-field-label">Billing Cycle</div><div class="detail-field-value">${escapeHtml(tenant.billingCycle || 'monthly')}</div></div>
      <div class="detail-field"><div class="detail-field-label">User Limit</div><div class="detail-field-value">${tenant.userLimit === 0 ? 'Unlimited' : tenant.userLimit || '-'}</div></div>
    </div>
    <div class="settings-section" style="margin-top:1.5rem;">
      <h2 class="section-title">Included Features</h2>
      <div style="display:flex;flex-wrap:wrap;gap:0.4rem;">
        ${(pkg ? pkg.features || [] : []).map(f => `<span class="badge badge-info">${escapeHtml(f)}</span>`).join('')}
      </div>
    </div>
  `;
}

// ── Billing ──

async function renderBilling() {
  const container = document.getElementById('view-billing');
  const tenant = getTenant();

  container.innerHTML = '<div class="loading">Loading billing...</div>';

  try {
    const { collection: fbCollection, getDocs: fbGetDocs, query: fbQuery, orderBy: fbOrderBy } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const { db: fbDb } = await import('./config.js');

    const invSnap = await fbGetDocs(fbQuery(
      fbCollection(fbDb, 'tenants', tenant.id, 'invoices'),
      fbOrderBy('issuedDate', 'desc')
    ));
    const invoices = invSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const paySnap = await fbGetDocs(fbQuery(
      fbCollection(fbDb, 'tenants', tenant.id, 'payments'),
      fbOrderBy('processedAt', 'desc')
    ));
    const payments = paySnap.docs.map(d => ({ id: d.id, ...d.data() }));

    let html = '<div class="settings-section"><h2 class="section-title">Invoices</h2>';
    if (invoices.length === 0) {
      html += '<p style="color:var(--gray);font-size:0.9rem;">No invoices yet.</p>';
    } else {
      html += '<table class="data-table"><thead><tr><th>Invoice #</th><th>Amount</th><th>Status</th><th>Issued</th><th>Due</th></tr></thead><tbody>';
      invoices.forEach(inv => {
        const statusClass = inv.status === 'paid' ? 'badge-success' : inv.status === 'overdue' ? 'badge-danger' : 'badge-default';
        html += `<tr>
          <td style="font-weight:500;">${escapeHtml(inv.invoiceNumber || '-')}</td>
          <td>${formatCurrency(inv.amount)}</td>
          <td><span class="badge ${statusClass}">${escapeHtml(inv.status || 'draft')}</span></td>
          <td>${formatDate(inv.issuedDate)}</td>
          <td>${formatDate(inv.dueDate)}</td>
        </tr>`;
      });
      html += '</tbody></table>';
    }
    html += '</div>';

    html += '<div class="settings-section" style="margin-top:1.5rem;"><h2 class="section-title">Payment History</h2>';
    if (payments.length === 0) {
      html += '<p style="color:var(--gray);font-size:0.9rem;">No payments recorded.</p>';
    } else {
      html += '<table class="data-table"><thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Status</th></tr></thead><tbody>';
      payments.forEach(p => {
        html += `<tr>
          <td>${formatDate(p.processedAt)}</td>
          <td>${formatCurrency(p.amount)}</td>
          <td>${escapeHtml(p.method || '-')}</td>
          <td><span class="badge ${p.status === 'completed' ? 'badge-success' : 'badge-danger'}">${escapeHtml(p.status || '-')}</span></td>
        </tr>`;
      });
      html += '</tbody></table>';
    }
    html += '</div>';

    container.innerHTML = html;
  } catch (err) {
    console.error('Billing load error:', err);
    container.innerHTML = '<p style="color:var(--danger);padding:1rem;">Failed to load billing data.</p>';
  }
}

// ── Team ──

async function renderTeam() {
  const container = document.getElementById('view-team');
  const tenant = getTenant();

  container.innerHTML = '<div class="loading">Loading team...</div>';

  try {
    const { collection: fbCollection, getDocs: fbGetDocs, query: fbQuery, orderBy: fbOrderBy } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const { db: fbDb } = await import('./config.js');

    const snap = await fbGetDocs(fbQuery(
      fbCollection(fbDb, 'tenants', tenant.id, 'users'),
      fbOrderBy('createdAt', 'desc')
    ));
    const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    let html = '<div class="settings-section"><h2 class="section-title">Team Members</h2>';
    html += '<table class="data-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead><tbody>';
    users.forEach(u => {
      html += `<tr>
        <td style="font-weight:500;">${escapeHtml(u.displayName || '-')}</td>
        <td>${escapeHtml(u.email || '-')}</td>
        <td><span class="badge badge-info">${escapeHtml(u.role || 'user')}</span></td>
        <td><span class="badge badge-success">${escapeHtml(u.status || 'active')}</span></td>
      </tr>`;
    });
    html += '</tbody></table></div>';

    container.innerHTML = html;
  } catch (err) {
    console.error('Team load error:', err);
    container.innerHTML = '<p style="color:var(--danger);padding:1rem;">Failed to load team data.</p>';
  }
}

// ── Account Settings ──

async function renderAccountSettings() {
  const container = document.getElementById('view-account-settings');
  const tenant = getTenant();

  container.innerHTML = '<div class="loading">Loading settings...</div>';

  const { getDoc: fbGetDoc, setDoc: fbSetDoc, doc: fbDoc, serverTimestamp: fbServerTs } =
    await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
  const { db: fbDb } = await import('./config.js');

  let generalSettings = {};
  try {
    const snap = await fbGetDoc(fbDoc(fbDb, `tenants/${tenant.id}/settings/general`));
    generalSettings = snap.exists() ? snap.data() : {};
  } catch (err) { console.error('Load settings failed:', err); }

  const canEdit = !isReadOnly() && !isSuspended();

  container.innerHTML = `
    <div class="settings-section">
      <h2 class="section-title">Business Information</h2>
      <div class="detail-field"><div class="detail-field-label">Business Name</div><div class="detail-field-value">${escapeHtml(tenant.companyName || '-')}</div></div>
      <div class="detail-field"><div class="detail-field-label">Vertical</div><div class="detail-field-value">${escapeHtml(tenant.vertical || '-')}</div></div>
      <div class="detail-field"><div class="detail-field-label">Status</div><div class="detail-field-value">${escapeHtml(tenant.status || '-')}</div></div>
      <div class="detail-field"><div class="detail-field-label">Account ID</div><div class="detail-field-value" style="font-family:monospace;font-size:0.8rem;">${escapeHtml(tenant.id || '-')}</div></div>
    </div>
    <div class="settings-section" style="margin-top:1.5rem;">
      <h2 class="section-title">Billing Defaults</h2>
      <div class="modal-field">
        <label>Labor Rate (per hour)</label>
        <input type="number" id="laborRateInput" min="0" step="0.01" ${canEdit ? '' : 'disabled'} value="${generalSettings.laborRate ?? 0}">
      </div>
      ${canEdit ? '<button class="btn btn-primary btn-sm" id="saveSettingsBtn">Save</button>' : ''}
      <span id="settingsSaveStatus" style="margin-left:0.75rem;color:var(--gray);font-size:0.85rem;"></span>
    </div>
    <div class="settings-section" style="margin-top:1.5rem;">
      <h2 class="section-title">Branding</h2>
      <p style="color:var(--gray);font-size:0.85rem;margin-bottom:0.75rem;">Pick a preset theme, or choose Custom to set each color individually.</p>
      ${(() => {
        const b = generalSettings.branding || {};
        const initialTheme = b.theme || (b.primaryColor || b.sidebarBg || b.accent ? 'custom' : 'ocean_teal');
        const initColors = resolveColors(b);
        const themeOpts = Object.entries(THEMES).map(([key, t]) =>
          `<option value="${key}" ${initialTheme === key ? 'selected' : ''}>${escapeHtml(t.label)}</option>`
        ).join('') + `<option value="custom" ${initialTheme === 'custom' ? 'selected' : ''}>Custom…</option>`;
        return `
        <div class="modal-field">
          <label>Theme</label>
          <select id="portalThemeSelect" ${canEdit ? '' : 'disabled'}>${themeOpts}</select>
        </div>
        <div id="portalCustomColors" class="modal-form-grid" style="display:${initialTheme === 'custom' ? 'grid' : 'none'};">
          <div class="modal-field">
            <label>Sidebar Background</label>
            <input type="color" id="portalSidebarBg" ${canEdit ? '' : 'disabled'} value="${escapeHtml(initColors.sidebarBg || '#134e4a')}" style="width:100%;height:42px;padding:0.15rem;cursor:pointer;">
          </div>
          <div class="modal-field">
            <label>Sidebar Text</label>
            <input type="color" id="portalSidebarFg" ${canEdit ? '' : 'disabled'} value="${escapeHtml(initColors.sidebarFg || '#ccfbf1')}" style="width:100%;height:42px;padding:0.15rem;cursor:pointer;">
          </div>
          <div class="modal-field">
            <label>Accent (buttons)</label>
            <input type="color" id="portalAccent" ${canEdit ? '' : 'disabled'} value="${escapeHtml(initColors.accent || '#0d9488')}" style="width:100%;height:42px;padding:0.15rem;cursor:pointer;">
          </div>
        </div>
        `;
      })()}
      <div class="modal-field" style="margin-top:0.75rem;">
        <label>Logo URL</label>
        <input type="url" id="brandLogoInput" ${canEdit ? '' : 'disabled'} value="${escapeHtml(generalSettings.branding?.logoUrl || '')}" placeholder="https://example.com/logo.png">
      </div>
      <div style="display:flex;gap:0.5rem;align-items:center;margin-top:0.75rem;">
        ${canEdit ? '<button class="btn btn-primary btn-sm" id="saveBrandBtn">Save Branding</button>' : ''}
        ${canEdit ? '<button class="btn btn-ghost btn-sm" id="resetBrandBtn">Reset to default</button>' : ''}
        <span id="brandSaveStatus" style="color:var(--gray);font-size:0.85rem;"></span>
      </div>
    </div>
  `;

  const saveBtn = container.querySelector('#saveSettingsBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const status = container.querySelector('#settingsSaveStatus');
      const rate = Number(container.querySelector('#laborRateInput').value) || 0;
      saveBtn.disabled = true;
      status.textContent = 'Saving...';
      try {
        await fbSetDoc(
          fbDoc(fbDb, `tenants/${tenant.id}/settings/general`),
          { laborRate: rate, updatedAt: fbServerTs() },
          { merge: true }
        );
        status.textContent = 'Saved.';
        setTimeout(() => { status.textContent = ''; }, 2000);
      } catch (err) {
        status.textContent = 'Save failed: ' + err.message;
      } finally {
        saveBtn.disabled = false;
      }
    });
  }

  const brandSaveBtn = container.querySelector('#saveBrandBtn');
  const brandResetBtn = container.querySelector('#resetBrandBtn');
  const themeSel = container.querySelector('#portalThemeSelect');
  const customWrap = container.querySelector('#portalCustomColors');
  const bgEl = container.querySelector('#portalSidebarBg');
  const fgEl = container.querySelector('#portalSidebarFg');
  const accEl = container.querySelector('#portalAccent');
  const logoInput = container.querySelector('#brandLogoInput');

  function currentBrandingObj() {
    if (!themeSel) return { logoUrl: logoInput?.value.trim() || '' };
    const theme = themeSel.value;
    if (theme !== 'custom') return { theme, logoUrl: logoInput?.value.trim() || '' };
    return {
      theme: 'custom',
      sidebarBg: bgEl?.value || '',
      sidebarFg: fgEl?.value || '',
      accent: accEl?.value || '',
      logoUrl: logoInput?.value.trim() || '',
    };
  }

  function livePreview() { applyBranding(currentBrandingObj()); }

  if (themeSel) themeSel.addEventListener('change', () => {
    customWrap.style.display = themeSel.value === 'custom' ? 'grid' : 'none';
    if (themeSel.value !== 'custom' && THEMES[themeSel.value]) {
      if (bgEl) bgEl.value = THEMES[themeSel.value].sidebarBg;
      if (fgEl) fgEl.value = THEMES[themeSel.value].sidebarFg;
      if (accEl) accEl.value = THEMES[themeSel.value].accent;
    }
    livePreview();
  });
  if (bgEl) bgEl.addEventListener('input', livePreview);
  if (fgEl) fgEl.addEventListener('input', livePreview);
  if (accEl) accEl.addEventListener('input', livePreview);
  if (logoInput) logoInput.addEventListener('change', livePreview);

  if (brandSaveBtn) {
    brandSaveBtn.addEventListener('click', async () => {
      const status = container.querySelector('#brandSaveStatus');
      const branding = currentBrandingObj();
      brandSaveBtn.disabled = true;
      status.textContent = 'Saving...';
      try {
        await fbSetDoc(
          fbDoc(fbDb, `tenants/${tenant.id}/settings/general`),
          { branding, updatedAt: fbServerTs() },
          { merge: true }
        );
        applyBranding(branding);
        status.textContent = 'Saved.';
        setTimeout(() => { status.textContent = ''; }, 2000);
      } catch (err) {
        status.textContent = 'Save failed: ' + err.message;
      } finally {
        brandSaveBtn.disabled = false;
      }
    });
  }
  if (brandResetBtn) {
    brandResetBtn.addEventListener('click', async () => {
      const status = container.querySelector('#brandSaveStatus');
      brandResetBtn.disabled = true;
      status.textContent = 'Resetting...';
      try {
        const reset = { theme: 'ocean_teal', sidebarBg: '', sidebarFg: '', accent: '', logoUrl: '', primaryColor: '' };
        await fbSetDoc(
          fbDoc(fbDb, `tenants/${tenant.id}/settings/general`),
          { branding: reset, updatedAt: fbServerTs() },
          { merge: true }
        );
        if (themeSel) themeSel.value = 'ocean_teal';
        if (customWrap) customWrap.style.display = 'none';
        const t = THEMES.ocean_teal;
        if (bgEl) bgEl.value = t.sidebarBg;
        if (fgEl) fgEl.value = t.sidebarFg;
        if (accEl) accEl.value = t.accent;
        if (logoInput) logoInput.value = '';
        applyBranding({ theme: 'ocean_teal' });
        status.textContent = 'Reset.';
        setTimeout(() => { status.textContent = ''; }, 2000);
      } catch (err) {
        status.textContent = 'Reset failed: ' + err.message;
      } finally {
        brandResetBtn.disabled = false;
      }
    });
  }
}

// ── Utility (inline to avoid import issues) ──

function escapeHtml(str) {
  if (!str) return '';
  const node = document.createElement('span');
  node.appendChild(document.createTextNode(str));
  return node.innerHTML;
}

function formatCurrency(amount) {
  if (amount == null || isNaN(amount)) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function formatDate(timestamp) {
  if (!timestamp) return '\u2014';
  try {
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    if (isNaN(date.getTime())) return '\u2014';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return '\u2014'; }
}
