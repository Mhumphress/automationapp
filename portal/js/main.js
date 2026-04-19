import { auth } from './config.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  loadTenantContext, getTenant, getVertical, getPackage,
  hasFeature, isReadOnly, isSuspended, getUserRole, term, applyBranding, resolveColors, THEMES,
  subscribeToTenantStatus, getSupportContact
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

    // Check status — if suspended/cancelled, render lockout and stop here.
    // No sidebar, no views, no data fetch.
    if (isSuspended()) {
      await showSuspendedLockout();
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

    // Messages badge (portal-side)
    startPortalMessagesBadge(getTenant().id);

    // Billing / unpaid-invoice badge (same pattern as Messages)
    startPortalBillingBadge(getTenant().id);

    // Recurring billing sweep — generates invoices that came due while the
    // operator wasn't watching. Runs once per session; idempotent.
    try {
      const { runRecurringSweep } = await import('./services/recurring-billing.js');
      runRecurringSweep(getTenant().id).catch(err => console.warn('Recurring sweep failed:', err));
    } catch (err) { console.warn('Could not start recurring sweep:', err); }

    // Subscribe to tenant doc so status changes mid-session take effect
    // immediately (e.g., admin suspends while the customer is logged in).
    subscribeToTenantStatus(async (newStatus) => {
      if (newStatus && (newStatus === 'active' || newStatus === 'past_due')) {
        // Restored — reload to rebuild the UI cleanly.
        window.location.reload();
        return;
      }
      // Anything else = lockout.
      await showSuspendedLockout();
    });

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

// ── Messages unread badge (portal) ──

async function startPortalMessagesBadge(tenantId) {
  if (!tenantId) return;
  try {
    const { subscribeToThreads, countUnread } = await import('./services/messages.js');
    subscribeToThreads({ tenantId }, (threads) => {
      const count = countUnread(threads, 'tenant');
      const navItem = document.querySelector('.nav-item[data-view="messages"]');
      if (!navItem) return;
      let badge = navItem.querySelector('.nav-badge');
      if (count > 0) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'nav-badge';
          navItem.appendChild(badge);
        }
        badge.textContent = count > 99 ? '99+' : String(count);
      } else if (badge) {
        badge.remove();
      }
    });
  } catch (err) {
    console.warn('Messages badge subscription failed:', err);
  }
}

// ── Billing badge (portal) — count of unpaid invoices across both
// tenants/{t}/invoices and tenants/{t}/invoices_crm collections. ──

async function startPortalBillingBadge(tenantId) {
  if (!tenantId) return;
  try {
    const { collection: fbCol, onSnapshot: fbOnSnap } =
      await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const { db: fbDb } = await import('./config.js');

    const counts = { invoices: 0, invoices_crm: 0 };
    const openStatuses = new Set(['sent', 'overdue', 'partial', 'draft', 'issued']);

    function updateBadge() {
      const total = counts.invoices + counts.invoices_crm;
      const navItem = document.querySelector('.nav-item[data-view="billing"]');
      if (!navItem) return;
      let badge = navItem.querySelector('.nav-badge');
      if (total > 0) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'nav-badge';
          navItem.appendChild(badge);
        }
        badge.textContent = total > 99 ? '99+' : String(total);
      } else if (badge) {
        badge.remove();
      }
    }

    function subscribeTo(coll) {
      fbOnSnap(
        fbCol(fbDb, 'tenants', tenantId, coll),
        (snap) => {
          counts[coll] = snap.docs.filter(d => {
            const data = d.data();
            if (!openStatuses.has(data.status)) return false;
            if (data.type === 'refund') return false;
            const total = Math.abs(Number(data.total || data.amount || 0));
            const paid = Number(data.paidAmount || 0);
            return (total - paid) > 0.0049;
          }).length;
          updateBadge();
        },
        (err) => {
          console.warn(`[billing badge] ${coll} subscription error:`, err);
        }
      );
    }

    subscribeTo('invoices');
    subscribeTo('invoices_crm');
  } catch (err) {
    console.warn('Billing badge subscription failed:', err);
  }
}

// ── Suspended lockout ──
//
// Hides sidebar, header, and every other view. Fills the lockout card with
// contact info from settings/branding. Wires the Call / Email / Sign-out
// buttons. Once this runs, the user can only contact support or sign out.

async function showSuspendedLockout() {
  document.body.classList.add('suspended-mode');
  document.getElementById('portalLoading').style.display = 'none';
  document.getElementById('noTenantState').style.display = 'none';
  document.getElementById('statusBanner').style.display = 'none';
  const lockout = document.getElementById('suspendedState');
  lockout.style.display = 'flex';

  const contact = await getSupportContact();
  const tenant = getTenant();
  const who = contact.businessName || 'our support team';

  const callBtn = lockout.querySelector('#suspendedCallBtn');
  const emailBtn = lockout.querySelector('#suspendedEmailBtn');
  const contactBlock = lockout.querySelector('#suspendedContact');

  // Call button — only show if we actually have a phone number.
  if (contact.phone) {
    const telHref = `tel:${contact.phone.replace(/[^\d+]/g, '')}`;
    callBtn.href = telHref;
    callBtn.style.display = '';
  } else {
    callBtn.style.display = 'none';
  }

  // Email button — always present; we have a fallback.
  const subject = encodeURIComponent(`Account access — ${tenant?.companyName || tenant?.id || ''}`);
  emailBtn.href = `mailto:${contact.email}?subject=${subject}`;

  // Contact block rows
  const rows = [];
  if (contact.phone) {
    rows.push(`
      <div class="suspended-contact-row">
        <span class="suspended-contact-label">Phone</span>
        <a href="tel:${escapeAttr(contact.phone.replace(/[^\d+]/g, ''))}">${escapeHtml(contact.phone)}</a>
      </div>
    `);
  }
  rows.push(`
    <div class="suspended-contact-row">
      <span class="suspended-contact-label">Email</span>
      <a href="mailto:${escapeAttr(contact.email)}">${escapeHtml(contact.email)}</a>
    </div>
  `);
  contactBlock.innerHTML = rows.join('');

  // Sign out button
  const signOutBtn = lockout.querySelector('#suspendedSignOutBtn');
  if (signOutBtn && !signOutBtn.dataset.wired) {
    signOutBtn.dataset.wired = '1';
    signOutBtn.addEventListener('click', async () => {
      try {
        localStorage.removeItem('portal_tenant_id');
        await signOut(auth);
      } catch {}
      window.location.replace('index.html');
    });
  }
}

function escapeAttr(s) {
  return String(s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Logout ──

document.getElementById('logoutBtn').addEventListener('click', async () => {
  try {
    localStorage.removeItem('portal_tenant_id');
    await signOut(auth);
  } catch (err) {
    console.error('Sign out failed:', err);
  } finally {
    // Always redirect — the onAuthStateChanged guard (authHandled=true) prevents
    // the listener from re-firing, so we must navigate explicitly.
    window.location.replace('index.html');
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

  // ── Workspace section first — the daily-driver views ──
  addNavSection(nav, 'Workspace');

  addNavItem(nav, 'dashboard', 'Dashboard', '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>');

  // Property vertical has its own tenant directory in Tenants & Leases,
  // so we skip the generic Contacts nav item — otherwise users see two
  // confusingly similar entries ("Owner/Tenants" vs "Tenants & Leases").
  if (hasFeature('contacts') && vertical?.id !== 'property') {
    addNavItem(nav, 'contacts', term('client') + 's', '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>');
  }

  // Messages — always available (support channel)
  addNavItem(nav, 'messages', 'Messages', '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>');

  // Vertical-specific modules
  if (vertical) {
    const vertModules = getVerticalModuleNav(vertical.id);
    vertModules.forEach(m => {
      if (hasFeature(m.feature)) {
        addNavItem(nav, m.view, m.label, m.icon);
      }
    });
  }

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

  // ── Account section at the bottom ──
  addNavSection(nav, 'Account');
  addNavItem(nav, 'subscription', 'Subscription', '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>');
  addNavItem(nav, 'billing', 'Billing', '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/>');
  addNavItem(nav, 'team', 'Team', '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>');
  addNavItem(nav, 'account-settings', 'Settings', '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>');

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
      { feature: 'tickets', view: 'workshop', label: 'Workshop Dashboard', icon: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>' },
      { feature: 'tickets', view: 'tickets', label: 'Repair Tickets', icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><line x1="9" y1="15" x2="15" y2="15"/>' },
      { feature: 'inventory', view: 'inventory', label: 'Parts Inventory', icon: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>' },
      { feature: 'checkin', view: 'checkin', label: 'Check-in/out', icon: '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>' },
    ],
    trades: [
      { feature: 'jobs', view: 'dispatch', label: 'Dispatch Board', icon: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>' },
      { feature: 'jobs', view: 'jobs', label: 'Jobs', icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>' },
      { feature: 'dispatching', view: 'dispatching', label: 'Scheduling', icon: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>' },
      { feature: 'quoting', view: 'quoting', label: 'Quoting', icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><line x1="9" y1="13" x2="15" y2="13"/>' },
    ],
    manufacturing: [
      { feature: 'work_orders', view: 'production', label: 'Production', icon: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>' },
      { feature: 'work_orders', view: 'work-orders', label: 'Work Orders', icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 12l2 2 4-4"/>' },
      { feature: 'bom', view: 'bom', label: 'BOM', icon: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>' },
      { feature: 'inventory', view: 'inventory', label: 'Inventory', icon: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>' },
    ],
    services: [
      { feature: 'projects', view: 'project-pulse', label: 'Project Pulse', icon: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>' },
      { feature: 'projects', view: 'projects', label: 'Projects', icon: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>' },
      { feature: 'time_tracking', view: 'time-tracking', label: 'Time Tracking', icon: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>' },
      { feature: 'proposals', view: 'proposals', label: 'Proposals', icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><line x1="9" y1="13" x2="15" y2="13"/>' },
    ],
    property: [
      { feature: 'properties', view: 'properties', label: 'Properties', icon: '<path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/>' },
      { feature: 'properties', view: 'units', label: 'Units', icon: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>' },
      { feature: 'leases', view: 'leases', label: 'Tenants', icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
      { feature: 'rent_collection', view: 'rent-roll', label: 'Rent Roll', icon: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>' },
      { feature: 'maintenance', view: 'maintenance', label: 'Maintenance', icon: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>' },
    ],
    salon: [
      { feature: 'appointments', view: 'salon-today', label: 'Today', icon: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>' },
      { feature: 'appointments', view: 'appointments', label: 'Appointments', icon: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>' },
      { feature: 'service_menu', view: 'service-menu', label: 'Services', icon: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>' },
      { feature: 'staff_calendar', view: 'staff-calendar', label: 'Staff Calendar', icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>' },
      { feature: 'loyalty', view: 'memberships', label: 'Memberships', icon: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>' },
      { feature: 'loyalty', view: 'loyalty', label: 'Client Loyalty', icon: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>' },
    ],
  };
  return modules[verticalId] || [];
}

// ── Register all views ──

async function registerAllViews() {
  // Dashboard
  const dashboardMod = await import('./views/shared/dashboard.js');
  registerView('dashboard', {
    init: dashboardMod.init,
    render() { document.getElementById('headerTitle').textContent = 'Dashboard'; dashboardMod.render(); },
    destroy: dashboardMod.destroy
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
    },
    destroy: destroyBilling,
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

  const reportingMod = await import('./views/shared/reporting.js');
  registerView('reporting', {
    init: reportingMod.init,
    render() { document.getElementById('headerTitle').textContent = 'Reporting'; reportingMod.render(); },
    destroy: reportingMod.destroy
  });

  const messagesMod = await import('./views/shared/messages.js');
  registerView('messages', {
    init: messagesMod.init,
    render() { document.getElementById('headerTitle').textContent = 'Messages'; messagesMod.render(); },
    destroy: messagesMod.destroy
  });

  // Property vertical — Rent Roll
  if (!document.getElementById('view-rent-roll')) {
    const div = document.createElement('div');
    div.id = 'view-rent-roll';
    div.className = 'view-container';
    document.getElementById('appMain').appendChild(div);
  }
  const rentRollMod = await import('./views/property/rent-roll.js');
  registerView('rent-roll', {
    init: rentRollMod.init,
    render() { document.getElementById('headerTitle').textContent = 'Rent Roll'; rentRollMod.render(); },
    destroy: rentRollMod.destroy,
  });

  // Vertical-specific dashboards — registered unconditionally; nav items
  // are feature-gated so they only appear for matching verticals.
  const verticalDashboards = [
    { view: 'workshop',       title: 'Workshop',        path: './views/repair/workshop-dashboard.js' },
    { view: 'salon-today',    title: 'Today at the Shop', path: './views/salon/today-dashboard.js' },
    { view: 'dispatch',       title: 'Dispatch Board',  path: './views/trades/dispatch-board.js' },
    { view: 'production',     title: 'Production',      path: './views/manufacturing/production-dashboard.js' },
    { view: 'project-pulse',  title: 'Project Pulse',   path: './views/services/project-pulse.js' },
  ];
  for (const d of verticalDashboards) {
    const containerId = `view-${d.view}`;
    if (!document.getElementById(containerId)) {
      const div = document.createElement('div');
      div.id = containerId;
      div.className = 'view-container';
      document.getElementById('appMain').appendChild(div);
    }
    try {
      const mod = await import(d.path);
      registerView(d.view, {
        init: mod.init,
        render() { document.getElementById('headerTitle').textContent = d.title; mod.render(); },
        destroy: mod.destroy,
      });
    } catch (err) {
      console.warn(`Failed to load vertical dashboard ${d.view}:`, err);
    }
  }

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

  // Vertical modules — all driven by the generic records component
  // plus per-vertical configuration.
  const { VIEW_CONFIG } = await import('./views/record-configs.js');
  const { mountRecords } = await import('./components/records.js');
  const { isReadOnly: isRO, isSuspended: isSus } = await import('./tenant-context.js');

  const recordViews = Object.keys(VIEW_CONFIG);

  recordViews.forEach(name => {
    if (!document.getElementById(`view-${name}`)) {
      const div = document.createElement('div');
      div.id = `view-${name}`;
      div.className = 'view-container';
      document.getElementById('appMain').appendChild(div);
    }

    let instance = null;

    registerView(name, {
      destroy() { if (instance) { try { instance.destroy(); } catch {} instance = null; } },
      render() {
        const cfg = VIEW_CONFIG[name];
        document.getElementById('headerTitle').textContent = cfg.title;
        const container = document.getElementById(`view-${name}`);
        container.innerHTML = '';
        const tenant = getTenant();
        if (!tenant) return;
        if (instance) { try { instance.destroy(); } catch {} }
        instance = mountRecords(container, cfg, {
          tenantId: tenant.id,
          canWrite: !isRO() && !isSus(),
        });
      },
    });
  });
}

// ── Dashboard ──

// renderDashboard moved to portal/js/views/shared/dashboard.js

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
//
// Live-updates: subscribes to the four tenant subcollections that feed the
// page (invoices, invoices_crm, payments, payment_intents). Any newly
// generated invoice — whether from CRM provisioning, an add-on change,
// or the recurring-billing sweep — flows in without a page refresh.

let billingUnsubs = [];
let billingRenderTimer = null;

function destroyBilling() {
  billingUnsubs.forEach(u => { try { u(); } catch {} });
  billingUnsubs = [];
  if (billingRenderTimer) { clearTimeout(billingRenderTimer); billingRenderTimer = null; }
}

async function renderBilling() {
  const container = document.getElementById('view-billing');
  const tenant = getTenant();

  destroyBilling();
  container.innerHTML = '<div class="loading">Loading billing...</div>';

  const { collection: fbCollection, onSnapshot: fbOnSnapshot } =
    await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
  const { db: fbDb } = await import('./config.js');
  const { openPayBill } = await import('./views/shared/pay-bill.js');

  // Live buckets — four independent streams, re-render whenever any change.
  const store = {
    invoices: [],
    invoicesCrm: [],
    payments: [],
    intents: [],
    errors: {},
  };

  // Debounce re-renders so a single multi-collection change fires once.
  function scheduleRender() {
    if (billingRenderTimer) return;
    billingRenderTimer = setTimeout(() => {
      billingRenderTimer = null;
      try { draw(); } catch (err) { console.error('Billing draw error:', err); }
    }, 50);
  }

  function subscribe(path, key) {
    try {
      const unsub = fbOnSnapshot(
        fbCollection(fbDb, ...path),
        (snap) => {
          store[key] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          delete store.errors[key];
          scheduleRender();
        },
        (err) => {
          console.error(`[billing] ${key} subscription error:`, err);
          store.errors[key] = err.code || err.message;
          scheduleRender();
        }
      );
      billingUnsubs.push(unsub);
    } catch (err) {
      console.error(`[billing] could not subscribe to ${key}:`, err);
      store.errors[key] = err.message;
    }
  }

  subscribe(['tenants', tenant.id, 'invoices'],       'invoices');
  subscribe(['tenants', tenant.id, 'invoices_crm'],   'invoicesCrm');
  subscribe(['tenants', tenant.id, 'payments'],       'payments');
  subscribe(['tenants', tenant.id, 'payment_intents'],'intents');

  // Always draw immediately so the page replaces "Loading..." with the
  // empty-state UI even before the first snapshot arrives.
  scheduleRender();

  function draw() {
    const invoices = [...store.invoices, ...store.invoicesCrm].sort((a, b) => {
      const ta = dateMs(a.issuedDate || a.issueDate || a.createdAt);
      const tb = dateMs(b.issuedDate || b.issueDate || b.createdAt);
      return tb - ta;
    });
    const payments = [...store.payments].sort((a, b) =>
      dateMs(b.receivedAt || b.processedAt || b.recordedAt)
    - dateMs(a.receivedAt || a.processedAt || a.recordedAt));
    const intents = [...store.intents].sort((a, b) => dateMs(b.submittedAt) - dateMs(a.submittedAt));

    drawBillingMarkup({ container, invoices, payments, intents, errors: store.errors, openPayBill });
  }
}

function drawBillingMarkup({ container, invoices, payments, intents, errors, openPayBill }) {
    // Derived numbers
    const openInvoices = invoices.filter(i => ['sent', 'overdue', 'partial', 'issued', 'draft'].includes(i.status));
    const totalBalance = openInvoices.reduce((s, i) => s + balanceOfInvoice(i), 0);
    const pendingIntentsByInvoice = {};
    intents.filter(i => i.status === 'pending').forEach(i => {
      if (i.invoiceId) (pendingIntentsByInvoice[i.invoiceId] ||= []).push(i);
    });

    // ── HTML ──
    const errorKeys = Object.keys(errors || {});
    const errorBanner = errorKeys.length > 0 ? `
      <div style="padding:0.75rem 1rem;margin-bottom:0.75rem;background:rgba(220,38,38,0.08);color:var(--danger,#dc2626);border-radius:8px;font-size:0.85rem;">
        <strong>Can't load some data:</strong>
        ${errorKeys.map(k => `<div style="margin-top:0.2rem;">· ${escapeHtml(k)} — ${escapeHtml(errors[k])}</div>`).join('')}
        <div style="margin-top:0.3rem;color:var(--gray-dark);font-size:0.78rem;">If the code is 'permission-denied', Firestore rules may not be published yet.</div>
      </div>` : '';

    // Banner always visible. When balance > 0, primary "Pay Balance" button.
    // When balance = 0, a secondary "Make a Payment" option so the user can
    // still prepay or test the payment flow.
    const bannerHTML = totalBalance > 0
      ? `
        <div class="billing-banner">
          <div>
            <div class="billing-banner-label">Balance due</div>
            <div class="billing-banner-amount">${formatCurrency(totalBalance)}</div>
          </div>
          <button class="btn btn-primary btn-lg" id="payBalanceBtn">Pay Bill</button>
        </div>`
      : `
        <div class="billing-banner billing-banner-clear">
          <div>
            <div class="billing-banner-label">All caught up</div>
            <div class="billing-banner-amount" style="color:var(--success,#059669);">${formatCurrency(0)}</div>
          </div>
          <button class="btn btn-ghost btn-lg" id="payBalanceBtn" style="border:1px solid var(--off-white);">Make a Payment</button>
        </div>`;

    let html = errorBanner + bannerHTML;

    // Invoices section
    html += '<div class="settings-section" style="margin-top:1rem;"><h2 class="section-title">Invoices</h2>';
    if (invoices.length === 0) {
      html += '<p style="color:var(--gray);font-size:0.9rem;">No invoices yet.</p>';
    } else {
      html += `
        <table class="data-table">
          <thead><tr>
            <th>Invoice #</th><th>Amount</th><th>Balance</th><th>Status</th><th>Issued</th><th>Due</th><th></th>
          </tr></thead>
          <tbody>`;
      invoices.forEach(inv => {
        const s = inv.status || 'draft';
        const dueInfo = dueStatusInfo(inv);
        const amount = inv.total != null ? inv.total : inv.amount;
        const balance = balanceOfInvoice(inv);
        const pending = pendingIntentsByInvoice[inv.id]?.length > 0;
        const canPay = balance > 0 && s !== 'paid' && !pending;
        html += `
          <tr class="clickable" data-view-invoice="${escapeHtml(inv.id)}">
            <td style="font-weight:500;">${escapeHtml(inv.invoiceNumber || '-')}</td>
            <td>${formatCurrency(amount)}</td>
            <td>${balance > 0 ? formatCurrency(balance) : '<span style="color:var(--gray);">—</span>'}</td>
            <td>
              <span class="badge ${dueInfo.cls}" style="font-weight:600;letter-spacing:0.02em;">${escapeHtml(dueInfo.label)}</span>
              ${dueInfo.detail ? `<div style="font-size:0.72rem;color:var(--gray-dark);margin-top:0.15rem;">${escapeHtml(dueInfo.detail)}</div>` : ''}
              ${pending ? '<div style="margin-top:0.2rem;"><span class="badge badge-warning">pending payment</span></div>' : ''}
            </td>
            <td>${formatDate(inv.issuedDate || inv.issueDate)}</td>
            <td>${formatDate(inv.dueDate)}</td>
            <td style="text-align:right;white-space:nowrap;">
              ${canPay ? `<button class="btn btn-primary btn-sm" data-pay-invoice="${escapeHtml(inv.id)}">Pay Bill</button>` : ''}
            </td>
          </tr>`;
      });
      html += '</tbody></table>';
    }
    html += '</div>';

    // Pending payment intents section
    const pendingList = intents.filter(i => i.status === 'pending');
    if (pendingList.length > 0) {
      html += `<div class="settings-section" style="margin-top:1.5rem;"><h2 class="section-title">Pending payments</h2>
        <p style="color:var(--gray-dark);font-size:0.85rem;margin-top:-0.3rem;margin-bottom:0.6rem;">
          These have been submitted but aren't cleared yet.
        </p>
        <table class="data-table"><thead><tr><th>Submitted</th><th>Method</th><th>Amount</th><th>Invoice</th><th>Status</th></tr></thead><tbody>`;
      pendingList.forEach(p => {
        const methodLabel = describePaymentIntentMethod(p);
        html += `<tr>
          <td>${formatDate(p.submittedAt)}</td>
          <td>${escapeHtml(methodLabel)}</td>
          <td>${formatCurrency(p.amount)}</td>
          <td style="font-family:var(--font-mono);">${escapeHtml(p.invoiceNumber || '-')}</td>
          <td><span class="badge badge-warning">${escapeHtml(p.status)}</span></td>
        </tr>`;
      });
      html += '</tbody></table></div>';
    }

    // Payment history (cleared payments)
    html += '<div class="settings-section" style="margin-top:1.5rem;"><h2 class="section-title">Payment History</h2>';
    if (payments.length === 0) {
      html += '<p style="color:var(--gray);font-size:0.9rem;">No payments recorded.</p>';
    } else {
      html += '<table class="data-table"><thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th><th>Status</th></tr></thead><tbody>';
      payments.forEach(p => {
        const when = p.receivedAt || p.processedAt || p.recordedAt;
        const s = p.status || 'received';
        const badgeClass =
          (s === 'received' || s === 'completed') ? 'badge-success' :
          s === 'refunded' ? 'badge-warning' :
          s === 'pending' ? 'badge-info' :
          s === 'failed' ? 'badge-danger' :
          'badge-default';
        html += `<tr>
          <td>${formatDate(when)}</td>
          <td>${formatCurrency(p.amount)}</td>
          <td>${escapeHtml(p.method || '-')}</td>
          <td>${escapeHtml(p.reference || '-')}</td>
          <td><span class="badge ${badgeClass}">${escapeHtml(s)}</span></td>
        </tr>`;
      });
      html += '</tbody></table>';
    }
    html += '</div>';

    container.innerHTML = html;

    // Wire Pay Balance banner. onSnapshot will re-render automatically when
    // payment_intents change, so no manual re-render is needed.
    const payBalanceBtn = container.querySelector('#payBalanceBtn');
    if (payBalanceBtn) {
      payBalanceBtn.addEventListener('click', async () => {
        await openPayBill({ allInvoices: openInvoices });
      });
    }

    // Wire per-row Pay Bill
    container.querySelectorAll('[data-pay-invoice]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();  // don't also trigger the row-click modal
        const inv = invoices.find(i => i.id === btn.dataset.payInvoice);
        if (!inv) return;
        await openPayBill({ invoice: inv });
      });
    });

    // Wire row-click → open invoice detail modal
    container.querySelectorAll('[data-view-invoice]').forEach(row => {
      row.addEventListener('click', async (e) => {
        if (e.target.closest('[data-pay-invoice]')) return;
        const inv = invoices.find(i => i.id === row.dataset.viewInvoice);
        if (!inv) return;
        const { openInvoiceModal } = await import('./views/shared/invoice-modal.js');
        openInvoiceModal(inv);
      });
    });
}

function balanceOfInvoice(inv) {
  const total = Math.abs(Number(inv.total || inv.amount || 0));
  const paid = Number(inv.paidAmount || 0);
  return Math.max(0, total - paid);
}

/**
 * Produces a human-readable status for an invoice row.
 * - PAID (green) for fully paid
 * - PARTIAL (blue) for partial
 * - OVERDUE by Nd (red) for anything past its dueDate and unpaid
 * - DUE <date> (blue) for sent/issued with dueDate
 * - DUE (blue) for sent/issued without a due date
 * - DRAFT / REFUNDED / etc. (gray) for everything else
 */
function dueStatusInfo(inv) {
  const s = inv.status || 'draft';
  if (s === 'paid') return { label: 'PAID', cls: 'badge-success', detail: '' };
  if (s === 'partial') return { label: 'PARTIAL', cls: 'badge-info', detail: 'Partially paid — balance remains' };
  if (s === 'refunded') return { label: 'REFUNDED', cls: 'badge-warning', detail: '' };
  if (s === 'void' || s === 'cancelled') return { label: s.toUpperCase(), cls: 'badge-default', detail: '' };

  // For sent / overdue / issued / draft: compute due-date info.
  const dueMs = dateMs(inv.dueDate);
  const now = Date.now();

  if (s === 'overdue' || (dueMs && dueMs < now && (s === 'sent' || s === 'issued'))) {
    const daysOver = dueMs ? Math.floor((now - dueMs) / 86400000) : null;
    return {
      label: 'OVERDUE',
      cls: 'badge-danger',
      detail: daysOver != null ? (daysOver === 0 ? 'Due today' : `${daysOver}d past due`) : '',
    };
  }

  if (s === 'sent' || s === 'issued') {
    if (dueMs) {
      const d = new Date(dueMs);
      const formatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      return {
        label: `DUE ${formatted}`,
        cls: 'badge-info',
        detail: daysUntilLabel(dueMs, now),
      };
    }
    return { label: 'DUE', cls: 'badge-info', detail: '' };
  }

  return { label: s.toUpperCase(), cls: 'badge-default', detail: '' };
}

function daysUntilLabel(dueMs, now) {
  const days = Math.round((dueMs - now) / 86400000);
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days > 0 && days < 14) return `Due in ${days} days`;
  return '';
}

function dateMs(ts) {
  if (!ts) return 0;
  if (ts.toDate) return ts.toDate().getTime();
  if (ts instanceof Date) return ts.getTime();
  const d = new Date(ts);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function describePaymentIntentMethod(p) {
  if (p.method === 'card') {
    const brand = (p.cardBrand || 'card').toUpperCase();
    return p.cardLast4 ? `${brand} ending in ${p.cardLast4}` : brand;
  }
  if (p.method === 'apple_pay') return 'Apple Pay';
  if (p.method === 'google_pay') return 'Google Pay';
  if (p.method === 'ach') return p.achAccountLast4 ? `ACH ending in ${p.achAccountLast4}` : 'ACH';
  return p.method || '—';
}

// ── Team ──

async function renderTeam() {
  const container = document.getElementById('view-team');
  const tenant = getTenant();

  container.innerHTML = '<div class="loading">Loading team...</div>';

  try {
    const { collection: fbCollection, getDocs: fbGetDocs, addDoc: fbAddDoc,
            query: fbQuery, orderBy: fbOrderBy, doc: fbDoc, setDoc: fbSetDoc,
            serverTimestamp: fbServerTs, Timestamp: fbTimestamp }
      = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const { db: fbDb } = await import('./config.js');

    const snap = await fbGetDocs(fbQuery(
      fbCollection(fbDb, 'tenants', tenant.id, 'users'),
      fbOrderBy('createdAt', 'desc')
    ));
    const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    const includedUsers = tenant.userLimit || 0;  // 0 means unlimited
    const billedUsers = users.length;
    const seatsUsed = includedUsers === 0 ? 0 : Math.max(0, billedUsers - includedUsers);

    // Proration for showing cost preview on the invite form
    const SEAT_PRICE = 3;
    const ANNUAL_DISCOUNT = 0.15;
    const isAnnual = tenant.billingCycle === 'annual';
    const periodStart = tenant.currentPeriodStart?.toDate ? tenant.currentPeriodStart.toDate() : null;
    const periodEnd = tenant.currentPeriodEnd?.toDate ? tenant.currentPeriodEnd.toDate() : null;
    let prorationRatio = 1;
    if (periodStart && periodEnd && periodEnd > periodStart) {
      const daysInPeriod = Math.max(1, (periodEnd.getTime() - periodStart.getTime()) / 86400000);
      const daysRemaining = Math.max(0, (periodEnd.getTime() - Date.now()) / 86400000);
      prorationRatio = Math.min(1, Math.max(0, daysRemaining / daysInPeriod));
    }
    // Seat cost shown per-cycle (monthly or annual)
    const seatCostThisPeriodMonthly = SEAT_PRICE * prorationRatio;
    const seatCostThisPeriodAnnual = SEAT_PRICE * 12 * (1 - ANNUAL_DISCOUNT) * prorationRatio;
    const seatProrated = isAnnual ? seatCostThisPeriodAnnual : seatCostThisPeriodMonthly;
    const seatRecurring = isAnnual ? SEAT_PRICE * 12 * (1 - ANNUAL_DISCOUNT) : SEAT_PRICE;

    const role = getUserRole();
    const canInvite = (role === 'owner' || role === 'admin') && !isReadOnly() && !isSuspended();

    let html = `
      <div class="settings-section">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:1rem;">
          <div>
            <h2 class="section-title" style="margin-bottom:0.25rem;">Team Members</h2>
            <p style="color:var(--gray-dark);font-size:0.85rem;margin:0;">
              ${billedUsers} of ${includedUsers === 0 ? '∞ (unlimited)' : includedUsers + ' included'}${seatsUsed > 0 ? ` · <strong>${seatsUsed} paid seat${seatsUsed === 1 ? '' : 's'}</strong>` : ''}
            </p>
          </div>
          ${canInvite ? `<button class="btn btn-primary" id="inviteUserBtn">+ Invite User</button>` : ''}
        </div>
      </div>

      <div class="settings-section" style="margin-top:1rem;">
        <table class="data-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead><tbody>
    `;
    users.forEach(u => {
      html += `<tr>
        <td style="font-weight:500;">${escapeHtml(u.displayName || '-')}</td>
        <td>${escapeHtml(u.email || '-')}</td>
        <td><span class="badge badge-info">${escapeHtml(u.role || 'user')}</span></td>
        <td><span class="badge ${u.status === 'pending' ? 'badge-warning' : 'badge-success'}">${escapeHtml(u.status || 'active')}</span></td>
      </tr>`;
    });
    html += '</tbody></table></div>';

    if (canInvite) {
      html += `
        <div class="settings-section" style="margin-top:1rem;display:none;" id="inviteForm">
          <h2 class="section-title">Invite a User</h2>
          <p style="color:var(--gray-dark);font-size:0.85rem;margin-bottom:0.75rem;">
            The invited person creates their own Firebase account with the email below and will automatically land in your tenant on first login.
          </p>
          <div class="modal-form-grid">
            <div class="modal-field"><label>First Name *</label><input type="text" name="inviteFirst" required></div>
            <div class="modal-field"><label>Last Name</label><input type="text" name="inviteLast"></div>
          </div>
          <div class="modal-form-grid">
            <div class="modal-field"><label>Email *</label><input type="email" name="inviteEmail" required placeholder="person@company.com"></div>
            <div class="modal-field">
              <label>Role</label>
              <select name="inviteRole">
                <option value="user">User</option>
                <option value="admin">Admin</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>
          </div>
          <div id="inviteCostNote" style="margin-top:0.5rem;"></div>
          <div style="display:flex;gap:0.5rem;margin-top:1rem;">
            <button class="btn btn-primary" id="inviteSubmitBtn">Send Invitation</button>
            <button class="btn btn-ghost" id="inviteCancelBtn">Cancel</button>
            <span id="inviteStatus" style="color:var(--gray);font-size:0.85rem;margin-left:0.5rem;align-self:center;"></span>
          </div>
        </div>
      `;
    }

    container.innerHTML = html;

    if (canInvite) {
      const inviteBtn = container.querySelector('#inviteUserBtn');
      const form = container.querySelector('#inviteForm');
      const costNote = container.querySelector('#inviteCostNote');
      const cycleLabel = isAnnual ? 'year' : 'month';

      function updateCostNote() {
        const willExceed = includedUsers > 0 && (billedUsers + 1) > includedUsers;
        if (willExceed) {
          costNote.innerHTML = `
            <div style="background:var(--accent-dim);padding:0.75rem;border-radius:8px;font-size:0.85rem;">
              <strong>Cost:</strong> This invite exceeds your plan's included ${includedUsers} users, so a seat at <strong>$${SEAT_PRICE}/mo</strong> will be added.
              An invoice for <strong>${formatCurrency(seatProrated)}</strong> (prorated for the rest of this billing period) will be created now.
              Going forward, your ${cycleLabel === 'year' ? 'annual' : 'monthly'} bill increases by <strong>${formatCurrency(seatRecurring)}/${cycleLabel}</strong>.
            </div>`;
        } else {
          costNote.innerHTML = `<div style="color:var(--gray-dark);font-size:0.85rem;">Free — included in your current plan (${billedUsers + 1} of ${includedUsers === 0 ? 'unlimited' : includedUsers}).</div>`;
        }
      }

      inviteBtn.addEventListener('click', () => {
        form.style.display = 'block';
        inviteBtn.style.display = 'none';
        updateCostNote();
        form.querySelector('[name="inviteFirst"]').focus();
      });

      form.querySelector('#inviteCancelBtn').addEventListener('click', () => {
        form.style.display = 'none';
        inviteBtn.style.display = '';
        form.querySelector('[name="inviteFirst"]').value = '';
        form.querySelector('[name="inviteLast"]').value = '';
        form.querySelector('[name="inviteEmail"]').value = '';
      });

      form.querySelector('#inviteSubmitBtn').addEventListener('click', async () => {
        const status = container.querySelector('#inviteStatus');
        const first = form.querySelector('[name="inviteFirst"]').value.trim();
        const last = form.querySelector('[name="inviteLast"]').value.trim();
        const email = form.querySelector('[name="inviteEmail"]').value.trim();
        const role = form.querySelector('[name="inviteRole"]').value;
        if (!first || !email) { status.textContent = 'First name and email are required.'; return; }
        const emailKey = email.toLowerCase();

        const submitBtn = form.querySelector('#inviteSubmitBtn');
        submitBtn.disabled = true;
        status.textContent = 'Inviting...';

        try {
          // 1. Create placeholder user doc in tenant/users (so they show in the team list)
          const displayName = `${first} ${last}`.trim();
          const pendingId = `pending_${Date.now()}`;
          await fbSetDoc(fbDoc(fbDb, `tenants/${tenant.id}/users/${pendingId}`), {
            email: emailKey, displayName, role, status: 'pending',
            invitedBy: 'portal', createdAt: fbServerTs(),
          });

          // 2. Create user_tenants mapping so portal finds them on first login
          await fbSetDoc(fbDoc(fbDb, `user_tenants/${emailKey}`), {
            tenantId: tenant.id, email: emailKey, role,
            companyName: tenant.companyName || '',
            createdAt: fbServerTs(),
          });

          // 3. If this user exceeds the plan's included limit, charge a prorated seat
          const willExceed = includedUsers > 0 && (billedUsers + 1) > includedUsers;
          if (willExceed) {
            const lineItems = [{
              description: `Additional user seat for ${displayName} (prorated for current period)`,
              quantity: 1, rate: seatProrated, amount: seatProrated,
            }];
            const invoiceRef = await fbAddDoc(fbCollection(fbDb, `tenants/${tenant.id}/invoices`), {
              invoiceNumber: `INV-T-${Date.now().toString().slice(-6)}`,
              type: 'charge',
              amount: seatProrated, total: seatProrated,
              status: 'sent',
              issuedDate: fbServerTs(),
              dueDate: fbTimestamp.fromDate(new Date(Date.now() + 14 * 86400000)),
              lineItems,
              reason: `User added: ${email}`,
              createdAt: fbServerTs(),
              createdBy: null,
            });
            // 4. Log tenant activity
            await fbAddDoc(fbCollection(fbDb, `tenants/${tenant.id}/activity`), {
              type: 'user_invited',
              description: `Invited ${email} — ${formatCurrency(seatProrated)} prorated seat invoice created`,
              metadata: { email, invoiceId: invoiceRef.id },
              createdAt: fbServerTs(),
            });
          } else {
            await fbAddDoc(fbCollection(fbDb, `tenants/${tenant.id}/activity`), {
              type: 'user_invited',
              description: `Invited ${email} (included in plan — no charge)`,
              metadata: { email },
              createdAt: fbServerTs(),
            });
          }

          status.textContent = 'Invitation sent.';
          setTimeout(() => renderTeam(), 1000);
        } catch (err) {
          console.error('Invite failed:', err);
          status.textContent = 'Failed: ' + err.message;
          submitBtn.disabled = false;
        }
      });
    }
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
      <div class="modal-form-grid">
        <div class="modal-field">
          <label>Labor Rate (per hour)</label>
          <input type="number" id="laborRateInput" min="0" step="0.01" ${canEdit ? '' : 'disabled'} value="${generalSettings.laborRate ?? 0}">
        </div>
        <div class="modal-field">
          <label>Sales Tax (%)</label>
          <input type="number" id="taxRateInput" min="0" max="100" step="0.001" ${canEdit ? '' : 'disabled'} value="${generalSettings.taxRate ?? 0}">
        </div>
        <div class="modal-field">
          <label>Default Warranty (days)</label>
          <input type="number" id="warrantyDaysInput" min="0" step="1" ${canEdit ? '' : 'disabled'} value="${generalSettings.warrantyDays ?? 90}">
        </div>
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
      const taxRate = Number(container.querySelector('#taxRateInput').value) || 0;
      const warrantyDays = Number(container.querySelector('#warrantyDaysInput').value) || 0;
      saveBtn.disabled = true;
      status.textContent = 'Saving...';
      try {
        await fbSetDoc(
          fbDoc(fbDb, `tenants/${tenant.id}/settings/general`),
          { laborRate: rate, taxRate, warrantyDays, updatedAt: fbServerTs() },
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
