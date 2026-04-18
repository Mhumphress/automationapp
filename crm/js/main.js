import { auth, db } from './config.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { registerView, navigate, initRouter } from './router.js';
import { showToast, escapeHtml, formatDate, timeAgo, formatCurrency as fmtCurrency } from './ui.js';
import * as contactsView from './views/contacts.js';
import * as messagesView from './views/messages.js';
import * as companiesView from './views/companies.js';
import * as quotesView from './views/quotes.js';
import { mountUniversalSearch } from './components/universal-search.js';
import * as pipelineView from './views/pipeline.js';
import * as tasksView from './views/tasks.js';
import * as invoicesView from './views/invoices.js';
import * as subscriptionsView from './views/subscriptions.js';
import * as settingsView from './views/settings.js';
import * as tenantsView from './views/tenants.js';
import * as packagesView from './views/packages.js';
import * as renewalsView from './views/renewals.js';
import { queryDocuments } from './services/firestore.js';
import { getCurrentUserRole, clearRoleCache, bootstrapCurrentUser } from './services/roles.js';
import { loadBranding, applyBranding } from './services/branding.js';
import { subscribeToResponses, getQuote } from './services/quotes.js';
import { enforceCancellations } from './services/subscription.js';
import { recordEvent as recordSubEvent, EVENT_TYPES as SUB_EVENTS, backfillSubscriptionEvents } from './services/subscription-events.js';
import * as money from './services/money.js';
import { subscribeToThreads, countUnread } from './services/messages.js';
import { createTenant, addTenantActivity, addTenantInvoice, addTenantUser } from './services/tenants.js';
import { doc, getDoc, updateDoc, setDoc, deleteDoc, serverTimestamp, runTransaction, Timestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ── Auth guard ──────────────────────────
// Wait for Firebase Auth to restore session before deciding.
// onAuthStateChanged may fire with null before persistence loads.
let authHandled = false;
onAuthStateChanged(auth, (user) => {
  if (authHandled) return;          // only act on first resolution
  authHandled = true;

  if (!user) {
    window.location.replace('login.html');
    return;
  }

  // Populate sidebar user info
  const displayName = user.displayName || user.email || 'User';
  const initials = displayName
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  document.getElementById('userAvatar').textContent = initials;
  document.getElementById('userName').textContent = displayName;

  // Check if user is an approved CRM user (no auto-create)
  bootstrapCurrentUser()
    .then(approved => {
      if (!approved) {
        // Not an approved CRM user — deny access
        document.querySelector('.app-main').innerHTML = `
          <div class="empty-state" style="margin-top:4rem;">
            <div class="empty-title">Access Denied</div>
            <p class="empty-description">Your account does not have access to the CRM. Contact an administrator.</p>
          </div>
        `;
        return;
      }
      // Load and apply branding (fire-and-forget — non-blocking)
      loadBranding().then(applyBranding).catch(() => {});
      return getCurrentUserRole();
    })
    .then(role => {
      if (!role) return; // Access denied, already handled above
      document.getElementById('userRole').textContent = role || 'member';
      if (role === 'admin') {
        document.getElementById('adminNavSection').style.display = '';
        document.getElementById('settingsNavItem').style.display = '';
        document.getElementById('platformNavSection').style.display = '';
        document.getElementById('tenantsNavItem').style.display = '';
        document.getElementById('packagesNavItem').style.display = '';
        document.getElementById('renewalsNavItem').style.display = '';
        // Start listening for quote responses + enforce scheduled cancellations
        subscribeToResponses(handleQuoteAccepted, handleQuoteDeclined);
        runCompaniesMigration().catch(err => console.error('Migration failed:', err));
        backfillSubscriptionEvents().catch(err => console.error('Events backfill failed:', err));
        enforceCancellations().catch(err => console.error('Cancellation sweep failed:', err));
        mountUniversalSearch();
        startMessagesBadge();
      }
    })
    .catch(err => console.error('Role setup error:', err));
});

// ── Logout ──────────────────────────────
document.getElementById('logoutBtn').addEventListener('click', async () => {
  try {
    clearRoleCache();
    await signOut(auth);
  } catch (err) {
    showToast('Sign out failed. Please try again.', 'error');
  } finally {
    // Always redirect — onAuthStateChanged is guarded by authHandled and
    // won't re-fire, so we must navigate explicitly.
    window.location.replace('login.html');
  }
});

// ── Inactivity timeout (30 min) ────────
let inactivityTimer = null;
const TIMEOUT_MS = 30 * 60 * 1000;

function resetInactivityTimer() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(async () => {
    try {
      clearRoleCache();
      await signOut(auth);
    } catch (e) {
      console.error('Auto-logout failed:', e);
    } finally {
      window.location.replace('login.html');
    }
  }, TIMEOUT_MS);
}

['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evt => {
  document.addEventListener(evt, resetInactivityTimer, { passive: true });
});
resetInactivityTimer();

// ── View title map ──────────────────────
const viewTitles = {
  dashboard:     'Dashboard',
  contacts:      'Contacts',
  companies:     'Companies',
  quotes:        'Quotes',
  pipeline:      'Pipeline',
  tasks:         'Tasks',
  invoices:      'Invoices',
  subscriptions: 'Subscriptions',
  messages:      'Messages',
  settings:      'Settings',
  tenants:       'Tenants',
  packages:      'Packages',
  renewals:      'Renewals'
};

// ── Register views ──────────────────────
Object.keys(viewTitles).forEach(name => {
  registerView(name, {
    render() {
      document.getElementById('headerTitle').textContent = viewTitles[name];
    }
  });
});

// Override contacts with full view logic
registerView('contacts', {
  init: contactsView.init,
  render() {
    document.getElementById('headerTitle').textContent = 'Contacts';
    contactsView.render();
  },
  destroy: contactsView.destroy
});

// Override companies with full view logic
registerView('companies', {
  init: companiesView.init,
  render() {
    document.getElementById('headerTitle').textContent = 'Companies';
    companiesView.render();
  },
  destroy: companiesView.destroy
});

// Override quotes with full view logic
registerView('quotes', {
  init: quotesView.init,
  render() {
    document.getElementById('headerTitle').textContent = 'Quotes';
    quotesView.render();
  },
  destroy: quotesView.destroy,
});

// Override pipeline with full view logic
registerView('pipeline', {
  init: pipelineView.init,
  render() {
    document.getElementById('headerTitle').textContent = 'Pipeline';
    pipelineView.render();
  },
  destroy: pipelineView.destroy
});

// Override tasks with full view logic
registerView('tasks', {
  init: tasksView.init,
  render() {
    document.getElementById('headerTitle').textContent = 'Tasks';
    tasksView.render();
  },
  destroy: tasksView.destroy
});

// Override invoices with full view logic
registerView('invoices', {
  init: invoicesView.init,
  render() {
    document.getElementById('headerTitle').textContent = 'Invoices';
    invoicesView.render();
  },
  destroy: invoicesView.destroy
});

// Override subscriptions with full view logic
registerView('subscriptions', {
  init: subscriptionsView.init,
  render() {
    document.getElementById('headerTitle').textContent = 'Subscriptions';
    subscriptionsView.render();
  },
  destroy: subscriptionsView.destroy
});

// Override settings with full view logic
registerView('settings', {
  init: settingsView.init,
  render() {
    document.getElementById('headerTitle').textContent = 'Settings';
    settingsView.render();
  },
  destroy: settingsView.destroy
});

// Override platform views with full view logic
registerView('tenants', {
  init: tenantsView.init,
  render() {
    document.getElementById('headerTitle').textContent = 'Tenants';
    tenantsView.render();
  },
  destroy: tenantsView.destroy
});

registerView('packages', {
  init: packagesView.init,
  render() {
    document.getElementById('headerTitle').textContent = 'Packages';
    packagesView.render();
  },
  destroy: packagesView.destroy
});

registerView('renewals', {
  init: renewalsView.init,
  render() {
    document.getElementById('headerTitle').textContent = 'Renewals';
    renewalsView.render();
  },
  destroy: renewalsView.destroy
});

registerView('messages', {
  init: messagesView.init,
  render() {
    document.getElementById('headerTitle').textContent = 'Messages';
    messagesView.render();
  },
  destroy: messagesView.destroy
});

// ── Dashboard ───────────────────────────
let revenueChartInstance = null;
let activityChartInstance = null;

registerView('dashboard', {
  async render() {
    document.getElementById('headerTitle').textContent = 'Dashboard';

    // Destroy old chart instances
    if (revenueChartInstance) { revenueChartInstance.destroy(); revenueChartInstance = null; }
    if (activityChartInstance) { activityChartInstance.destroy(); activityChartInstance = null; }

    // Clear drill-downs
    ['drillContacts', 'drillDeals', 'drillTasks', 'drillRevenue', 'drillSubscriptions', 'drillARR', 'revenueChartDrill', 'activityChartDrill'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '';
    });

    // Collapse all cards
    document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('expanded'));

    let contactsList = [];
    let quotesList = [];
    let invoicesList = [];
    let tenantsList = [];

    try {
      const results = await Promise.allSettled([
        queryDocuments('contacts'),
        queryDocuments('quotes').catch(() => []),
        queryDocuments('invoices').catch(() => []),
        queryDocuments('tenants').catch(() => []),
      ]);
      contactsList = results[0].status === 'fulfilled' ? results[0].value : [];
      quotesList = results[1].status === 'fulfilled' ? results[1].value : [];
      invoicesList = results[2].status === 'fulfilled' ? results[2].value : [];
      tenantsList = results[3].status === 'fulfilled' ? results[3].value : [];
    } catch (err) {
      console.error('Dashboard data error:', err);
    }

    // Active = draft, sent, accepted (in-flight quotes)
    const activeQuotes = quotesList.filter(q => ['draft', 'sent', 'accepted'].includes(q.status));
    // Paid invoices (authoritative revenue source) — all money math via money.js
    const paidInvoices = invoicesList.filter(i => i.status === 'paid');
    const revenue = money.sumPaid(invoicesList);          // net paid (refunds subtract)
    const mrr = money.totalMRR(tenantsList);
    const arr = money.totalARR(tenantsList);

    // Update stat values — map to the existing DOM ids
    document.getElementById('statContacts').textContent = contactsList.length;
    document.getElementById('statProjects').textContent = activeQuotes.length;
    let tasksList = [];
    let openTasks = [];
    try {
      tasksList = await queryDocuments('tasks');
      openTasks = tasksList.filter(t => t.status !== 'done');
    } catch (err) { console.error('Tasks load error:', err); }
    document.getElementById('statTasks').textContent = openTasks.length;
    document.getElementById('statRevenue').textContent = fmtCurrency(revenue);
    const mrrEl = document.getElementById('statMRR');
    const arrEl = document.getElementById('statARR');
    if (mrrEl) mrrEl.textContent = fmtCurrency(mrr);
    if (arrEl) arrEl.textContent = fmtCurrency(arr);

    // Show/hide empty state vs content
    const hasData = contactsList.length > 0 || quotesList.length > 0 || invoicesList.length > 0;
    document.getElementById('dashboardEmpty').style.display = hasData ? 'none' : 'flex';
    document.getElementById('statsGrid').style.display = hasData ? '' : 'none';
    document.getElementById('chartsGrid').style.display = hasData ? '' : 'none';

    // Notification banner (clean up any existing one first)
    document.querySelectorAll('.notification-banner').forEach(el => el.remove());
    if ('Notification' in window && Notification.permission === 'default') {
      const banner = document.createElement('div');
      banner.className = 'notification-banner';
      banner.innerHTML = '<span>Enable notifications to get reminders about upcoming tasks</span><button id="enableNotifs">Enable</button>';
      document.getElementById('statsGrid').before(banner);
      banner.querySelector('#enableNotifs').addEventListener('click', async () => {
        await Notification.requestPermission();
        banner.remove();
        checkTaskNotifications();
      });
    } else {
      checkTaskNotifications();
    }

    if (!hasData) return;

    // --- Wire stat card click toggling FIRST so subsequent listeners on drill
    // content aren't destroyed by a later cloneNode. Cards are cloned to drop
    // any handlers from a previous render; everything downstream attaches to
    // the stable DOM. Any click inside the drilldown content (.drill-*) does
    // NOT collapse the card.
    document.querySelectorAll('#statsGrid .stat-card').forEach(card => {
      const newCard = card.cloneNode(true);
      card.parentNode.replaceChild(newCard, card);

      newCard.addEventListener('click', (e) => {
        if (e.target.closest('.drill-rich') || e.target.closest('.drilldown-item')) return;
        const wasExpanded = newCard.classList.contains('expanded');
        document.querySelectorAll('#statsGrid .stat-card').forEach(c => c.classList.remove('expanded'));
        if (!wasExpanded) newCard.classList.add('expanded');
      });
    });

    // --- Populate rich drill-down data AFTER cloning. Listeners attached to
    // drill rows and CTAs now survive because the cloneNode has already run. ---
    renderCustomersDrill(contactsList, quotesList, invoicesList);
    renderQuotesDrill(quotesList);
    renderTasksDrill(openTasks);
    renderRevenueDrill(invoicesList);
    renderSubscriptionsDrill(tenantsList);
    renderARRDrill(tenantsList);

    // --- Revenue Bar Chart --- (now driven by paid invoices)
    buildRevenueChart(paidInvoices);

    // --- Pipeline Activity Line Chart --- (quotes created over time)
    buildActivityChart(quotesList);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Rich dashboard drill-downs — each one is an insight panel, not just a list
// ─────────────────────────────────────────────────────────────────────────

const DASH_DRILL_CSS_ID = 'dashDrillCSS';

function ensureDrillStyles() {
  if (document.getElementById(DASH_DRILL_CSS_ID)) return;
  const style = document.createElement('style');
  style.id = DASH_DRILL_CSS_ID;
  style.textContent = `
    .drill-rich { padding:0.5rem 0.25rem; }
    .drill-kpis { display:flex; gap:1rem; flex-wrap:wrap; margin-bottom:0.75rem; padding:0.5rem 0.75rem; background:var(--off-white,#F8FAFC); border-radius:8px; }
    .drill-kpi { font-size:0.8rem; }
    .drill-kpi .label { color:var(--gray-dark,#64748B); display:block; text-transform:uppercase; font-size:0.65rem; letter-spacing:0.05em; }
    .drill-kpi .val { font-weight:600; color:var(--black,#0F172A); font-size:1.05rem; }
    .drill-kpi .delta { margin-left:0.25rem; font-size:0.7rem; font-weight:500; padding:0.05rem 0.4rem; border-radius:999px; }
    .drill-kpi .delta.up { background:rgba(5,150,105,0.1); color:#059669; }
    .drill-kpi .delta.down { background:rgba(220,38,38,0.1); color:#dc2626; }
    .drill-kpi .delta.flat { background:rgba(100,116,139,0.1); color:#64748b; }
    .drill-section { margin-top:0.75rem; }
    .drill-section h5 { font-size:0.7rem; text-transform:uppercase; letter-spacing:0.05em; color:var(--gray-dark,#64748B); margin:0 0 0.4rem; font-weight:600; }
    .drill-bars { display:flex; flex-direction:column; gap:0.35rem; }
    .drill-bar { display:grid; grid-template-columns:90px 1fr 50px; align-items:center; gap:0.5rem; font-size:0.8rem; }
    .drill-bar .name { color:var(--black,#0F172A); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .drill-bar .track { height:6px; background:var(--off-white,#F1F5F9); border-radius:3px; overflow:hidden; }
    .drill-bar .fill { height:100%; background:var(--accent,#4F7BF7); border-radius:3px; }
    .drill-bar .val { text-align:right; font-variant-numeric:tabular-nums; color:var(--gray-dark,#64748B); font-size:0.75rem; }
    .drill-top-list { display:flex; flex-direction:column; }
    .drill-top-row { display:flex; justify-content:space-between; gap:0.5rem; padding:0.35rem 0; border-bottom:1px solid var(--off-white,#F1F5F9); font-size:0.82rem; cursor:pointer; }
    .drill-top-row:last-child { border-bottom:none; }
    .drill-top-row:hover { background:var(--accent-dim,rgba(79,123,247,0.08)); }
    .drill-top-row .sub { color:var(--gray-dark,#64748B); font-size:0.72rem; }
    .drill-top-row .value { font-weight:500; font-variant-numeric:tabular-nums; white-space:nowrap; }
    .drill-cta { display:inline-block; margin-top:0.6rem; font-size:0.78rem; color:var(--accent,#4F7BF7); cursor:pointer; font-weight:500; }
    .drill-cta:hover { text-decoration:underline; }
  `;
  document.head.appendChild(style);
}

function pct(n) { if (!isFinite(n)) return '—'; return (n >= 0 ? '+' : '') + n.toFixed(1) + '%'; }
function deltaClass(n) { return n > 1 ? 'up' : n < -1 ? 'down' : 'flat'; }
function sum(arr, key) { return arr.reduce((s, x) => s + (Number(x[key]) || 0), 0); }

function renderKpiStrip(kpis) {
  return `<div class="drill-kpis">${kpis.map(k => `
    <div class="drill-kpi">
      <span class="label">${escapeHtml(k.label)}</span>
      <span class="val">${escapeHtml(k.value)}${k.delta != null ? `<span class="delta ${deltaClass(k.delta)}">${pct(k.delta)}</span>` : ''}</span>
    </div>
  `).join('')}</div>`;
}
function renderBars(items, { max } = {}) {
  const m = max != null ? max : Math.max(1, ...items.map(i => i.value));
  return `<div class="drill-bars">${items.map(i => `
    <div class="drill-bar" title="${escapeHtml(i.name)} — ${escapeHtml(i.displayValue || String(i.value))}">
      <div class="name">${escapeHtml(i.name)}</div>
      <div class="track"><div class="fill" style="width:${Math.min(100, (i.value / m) * 100)}%;"></div></div>
      <div class="val">${escapeHtml(i.displayValue || String(i.value))}</div>
    </div>
  `).join('')}</div>`;
}
function renderTopList(items) {
  return `<div class="drill-top-list">${items.map((i, idx) => `
    <div class="drill-top-row" data-idx="${idx}">
      <div><div>${escapeHtml(i.name)}</div>${i.sub ? `<div class="sub">${escapeHtml(i.sub)}</div>` : ''}</div>
      <div class="value">${escapeHtml(i.value || '')}</div>
    </div>
  `).join('')}</div>`;
}

// ── Customers drilldown ──
function renderCustomersDrill(contacts, quotes, invoices) {
  ensureDrillStyles();
  const el = document.getElementById('drillContacts');
  if (!el) return;
  const now = Date.now();
  const start30 = now - 30 * 86400000;
  const start60 = now - 60 * 86400000;
  const toMs = d => d && d.toDate ? d.toDate().getTime() : (d ? new Date(d).getTime() : 0);
  const new30 = contacts.filter(c => toMs(c.createdAt) >= start30).length;
  const newPrev30 = contacts.filter(c => { const t = toMs(c.createdAt); return t >= start60 && t < start30; }).length;
  const delta = newPrev30 > 0 ? ((new30 - newPrev30) / newPrev30) * 100 : (new30 > 0 ? 100 : 0);

  // Customers with quotes
  const quotedSet = new Set(quotes.map(q => q.contactId).filter(Boolean));
  const activeSet = new Set(invoices.filter(i => i.status === 'paid').map(i => i.clientId).filter(Boolean));

  // Top 5 by lifetime invoice revenue
  const revByContact = {};
  invoices.filter(i => i.status === 'paid').forEach(i => {
    const id = i.clientId || '_unknown';
    revByContact[id] = (revByContact[id] || 0) + (Number(i.total) || 0);
  });
  const topCustomers = Object.entries(revByContact)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, total]) => {
      const c = contacts.find(x => x.id === id);
      const name = c ? (`${c.firstName || ''} ${c.lastName || ''}`.trim() || c.name || 'Unknown') : 'Unknown';
      const company = c ? (c.company || c.companyName || '') : '';
      return { id, name, company, total };
    });

  el.innerHTML = `
    <div class="drill-rich">
      ${renderKpiStrip([
        { label: 'Total', value: contacts.length.toString() },
        { label: 'New (30d)', value: new30.toString(), delta },
        { label: 'Quoted', value: quotedSet.size.toString() },
        { label: 'Paid', value: activeSet.size.toString() },
      ])}
      ${topCustomers.length > 0 ? `
        <div class="drill-section">
          <h5>Top by lifetime revenue</h5>
          ${renderTopList(topCustomers.map(t => ({
            name: t.name,
            sub: t.company,
            value: fmtCurrency(t.total),
          })))}
        </div>
      ` : ''}
      <a class="drill-cta" data-action="all-customers">View all customers →</a>
    </div>
  `;
  el.querySelectorAll('.drill-top-row').forEach((row, idx) => {
    row.addEventListener('click', async () => {
      const c = topCustomers[idx];
      if (!c) return;
      const m = await import('./views/contacts.js');
      m.requestContact(c.id);
      navigate('contacts');
    });
  });
  el.querySelector('[data-action="all-customers"]').addEventListener('click', () => navigate('contacts'));
}

// ── Open Quotes drilldown ──
function renderQuotesDrill(quotes) {
  ensureDrillStyles();
  const el = document.getElementById('drillDeals');
  if (!el) return;
  const open = quotes.filter(q => ['draft', 'sent', 'accepted'].includes(q.status));
  const pipelineValue = sum(open, 'total');
  const sent = quotes.filter(q => q.status === 'sent');
  const accepted = quotes.filter(q => q.status === 'accepted' || q.status === 'provisioned');
  const conversion = sent.length + accepted.length > 0
    ? (accepted.length / (sent.length + accepted.length)) * 100
    : 0;

  // Breakdown by status
  const byStatus = ['draft', 'sent', 'accepted'].map(s => ({
    name: s.charAt(0).toUpperCase() + s.slice(1),
    value: open.filter(q => q.status === s).length,
    displayValue: open.filter(q => q.status === s).length.toString(),
  }));

  // Top 5 open quotes by value
  const top = [...open].sort((a, b) => (b.total || 0) - (a.total || 0)).slice(0, 5);

  el.innerHTML = `
    <div class="drill-rich">
      ${renderKpiStrip([
        { label: 'Open', value: open.length.toString() },
        { label: 'Pipeline $', value: fmtCurrency(pipelineValue) },
        { label: 'Conversion', value: conversion.toFixed(0) + '%' },
      ])}
      <div class="drill-section">
        <h5>By status</h5>
        ${renderBars(byStatus)}
      </div>
      ${top.length > 0 ? `
        <div class="drill-section">
          <h5>Highest-value open quotes</h5>
          ${renderTopList(top.map(q => ({
            name: `${q.quoteNumber || '-'} · ${(q.customerSnapshot?.firstName || '') + ' ' + (q.customerSnapshot?.lastName || '')}`.trim(),
            sub: `${q.customerSnapshot?.company || ''}${q.status ? ' · ' + q.status : ''}`,
            value: fmtCurrency(q.total || 0),
          })))}
        </div>
      ` : ''}
      <a class="drill-cta" data-action="pipeline">Open Pipeline →</a>
    </div>
  `;
  el.querySelectorAll('.drill-top-row').forEach((row, idx) => {
    row.addEventListener('click', async () => {
      const q = top[idx];
      const m = await import('./views/quote-builder.js');
      m.openBuilder(q.id);
    });
  });
  el.querySelector('[data-action="pipeline"]').addEventListener('click', () => navigate('pipeline'));
}

// ── Tasks drilldown ──
function renderTasksDrill(openTasks) {
  ensureDrillStyles();
  const el = document.getElementById('drillTasks');
  if (!el) return;
  const now = Date.now();
  const overdue = openTasks.filter(t => t.dueDate && new Date(t.dueDate).getTime() < now);
  const dueSoon = openTasks
    .filter(t => t.dueDate)
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
    .slice(0, 5);
  const byPriority = ['high', 'medium', 'low'].map(p => ({
    name: p.charAt(0).toUpperCase() + p.slice(1),
    value: openTasks.filter(t => (t.priority || 'low') === p).length,
    displayValue: openTasks.filter(t => (t.priority || 'low') === p).length.toString(),
  }));

  el.innerHTML = `
    <div class="drill-rich">
      ${renderKpiStrip([
        { label: 'Open', value: openTasks.length.toString() },
        { label: 'Overdue', value: overdue.length.toString() },
      ])}
      <div class="drill-section">
        <h5>By priority</h5>
        ${renderBars(byPriority)}
      </div>
      ${dueSoon.length > 0 ? `
        <div class="drill-section">
          <h5>Due soon</h5>
          ${renderTopList(dueSoon.map(t => ({
            name: t.title || 'Task',
            sub: (t.priority || 'low') + ' priority',
            value: formatDate(t.dueDate) || '',
          })))}
        </div>
      ` : ''}
      <a class="drill-cta" data-action="tasks">Open Tasks →</a>
    </div>
  `;
  el.querySelector('[data-action="tasks"]').addEventListener('click', () => navigate('tasks'));
}

// ── Revenue drilldown ──
function renderRevenueDrill(allInvoices) {
  ensureDrillStyles();
  const el = document.getElementById('drillRevenue');
  if (!el) return;
  const paidInvoices = allInvoices.filter(i => i.status === 'paid');
  const now = Date.now();
  const start30 = now - 30 * 86400000;
  const start60 = now - 60 * 86400000;
  const toMs = i => i.createdAt && i.createdAt.toDate ? i.createdAt.toDate().getTime() : (i.issueDate ? new Date(i.issueDate).getTime() : 0);
  const r30 = paidInvoices.filter(i => toMs(i) >= start30);
  const rPrev30 = paidInvoices.filter(i => { const t = toMs(i); return t >= start60 && t < start30; });
  const rev30 = money.sumPaid(r30);
  const revPrev30 = money.sumPaid(rPrev30);
  const delta = revPrev30 > 0 ? ((rev30 - revPrev30) / revPrev30) * 100 : (rev30 > 0 ? 100 : 0);
  const gross30 = money.sumGrossPaid(r30);
  const refunds30 = Math.abs(money.sumRefunds(r30));
  const avg = paidInvoices.length > 0 ? money.sumGrossPaid(paidInvoices) / paidInvoices.length : 0;

  // By customer (top 5 last 30d)
  const byCust = {};
  r30.forEach(i => {
    const name = i.clientName || 'Unknown';
    byCust[name] = (byCust[name] || 0) + (Number(i.total) || 0);
  });
  const topCust = Object.entries(byCust).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxCust = topCust.length ? topCust[0][1] : 1;

  // Recent 5 paid
  const recent = [...paidInvoices].sort((a, b) => toMs(b) - toMs(a)).slice(0, 5);

  el.innerHTML = `
    <div class="drill-rich">
      ${renderKpiStrip([
        { label: 'Net revenue (30d)', value: fmtCurrency(rev30), delta },
        { label: 'Gross (30d)', value: fmtCurrency(gross30) },
        { label: 'Refunds (30d)', value: fmtCurrency(refunds30) },
        { label: 'Avg invoice', value: fmtCurrency(avg) },
      ])}
      ${topCust.length > 0 ? `
        <div class="drill-section">
          <h5>Top customers (30d)</h5>
          ${renderBars(topCust.map(([n, v]) => ({ name: n, value: v, displayValue: fmtCurrency(v) })), { max: maxCust })}
        </div>
      ` : ''}
      ${recent.length > 0 ? `
        <div class="drill-section">
          <h5>Recent paid invoices</h5>
          ${renderTopList(recent.map(i => ({
            name: `${i.invoiceNumber || '-'} · ${i.clientName || ''}`,
            sub: formatDate(i.createdAt || i.issueDate) || '',
            value: fmtCurrency(i.total || 0),
          })))}
        </div>
      ` : ''}
      <a class="drill-cta" data-action="invoices">Open Invoices →</a>
    </div>
  `;
  el.querySelectorAll('.drill-top-row').forEach((row, idx) => {
    row.addEventListener('click', async () => {
      const i = recent[idx];
      if (!i) return;
      const m = await import('./views/invoices.js');
      m.requestInvoice(i.id);
      navigate('invoices');
    });
  });
  el.querySelector('[data-action="invoices"]').addEventListener('click', () => navigate('invoices'));
}

// ── Subscriptions drilldown (MRR) ──
function renderSubscriptionsDrill(tenants) {
  ensureDrillStyles();
  const el = document.getElementById('drillSubscriptions');
  if (!el) return;
  const active = tenants.filter(t => t.status === 'active');
  const pastDue = tenants.filter(t => t.status === 'past_due');
  const cancelled = tenants.filter(t => t.status === 'cancelled');
  const mrr = money.totalMRR(active);

  // Churn and net new MRR in the last 30d require subscription_events;
  // for initial render we show what we can derive from tenants directly.
  const tsMs = t => t && t.toDate ? t.toDate().getTime() : (t ? new Date(t).getTime() : 0);
  const now = Date.now();
  const cancelledIn30 = tenants.filter(t => {
    const c = tsMs(t.cancelAt);
    return c && c >= now - 30 * 86400000 && c <= now;
  });

  const topTenants = [...active]
    .map(t => ({ t, mrr: money.computeMRR(t) }))
    .sort((a, b) => b.mrr - a.mrr)
    .slice(0, 5);

  el.innerHTML = `
    <div class="drill-rich">
      ${renderKpiStrip([
        { label: 'MRR', value: fmtCurrency(mrr) },
        { label: 'Active', value: active.length.toString() },
        { label: 'Past due', value: pastDue.length.toString() },
        { label: 'Churn (30d)', value: cancelledIn30.length.toString() },
      ])}
      ${topTenants.length > 0 ? `
        <div class="drill-section">
          <h5>Top tenants by MRR</h5>
          ${renderTopList(topTenants.map(x => ({
            name: x.t.companyName || x.t.id,
            sub: `${x.t.tier || ''}${x.t.billingCycle ? ' · ' + x.t.billingCycle : ''}`,
            value: fmtCurrency(x.mrr),
          })))}
        </div>
      ` : ''}
      <a class="drill-cta" data-action="tenants">Open Tenants →</a>
    </div>
  `;
  el.querySelector('[data-action="tenants"]').addEventListener('click', () => navigate('tenants'));
}

// ── ARR drilldown ──
function renderARRDrill(tenants) {
  ensureDrillStyles();
  const el = document.getElementById('drillARR');
  if (!el) return;
  const active = tenants.filter(t => t.status === 'active');
  const arr = money.totalARR(active);
  const annualTenants = active.filter(t => t.billingCycle === 'annual');
  const monthlyTenants = active.filter(t => t.billingCycle !== 'annual');
  const arrFromAnnual = money.totalARR(annualTenants);
  const arrFromMonthly = money.totalARR(monthlyTenants);

  el.innerHTML = `
    <div class="drill-rich">
      ${renderKpiStrip([
        { label: 'ARR', value: fmtCurrency(arr) },
        { label: 'From annual', value: fmtCurrency(arrFromAnnual) },
        { label: 'From monthly', value: fmtCurrency(arrFromMonthly) },
      ])}
      <div class="drill-section">
        <h5>Cycle breakdown</h5>
        ${renderBars([
          { name: 'Annual', value: annualTenants.length, displayValue: annualTenants.length.toString() },
          { name: 'Monthly', value: monthlyTenants.length, displayValue: monthlyTenants.length.toString() },
        ])}
      </div>
      <a class="drill-cta" data-action="tenants">Open Tenants →</a>
    </div>
  `;
  el.querySelector('[data-action="tenants"]').addEventListener('click', () => navigate('tenants'));
}

// --- Helper: populate drill-down list ---
function populateDrilldown(containerId, items) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  if (items.length === 0) {
    container.innerHTML = '<div class="drilldown-placeholder">No data yet</div>';
    return;
  }
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'drilldown-item';
    row.innerHTML = `
      <div>
        <div class="drilldown-item-name">${escapeHtml(item.name)}</div>
        ${item.sub ? `<div class="drilldown-item-sub">${escapeHtml(item.sub)}</div>` : ''}
      </div>
      ${item.value ? `<div class="drilldown-item-value">${item.value}</div>` : ''}
    `;
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      if (item.onClick) item.onClick();
    });
    container.appendChild(row);
  });
}

// --- Helper: get last 6 months ---
function getLast6Months() {
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-US', { month: 'short' }),
      month: d.getMonth(),
      year: d.getFullYear()
    });
  }
  return months;
}

// --- Helper: get month key from Firestore timestamp ---
function getMonthKey(timestamp) {
  if (!timestamp) return null;
  try {
    const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    if (isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  } catch { return null; }
}

// --- Build Revenue Bar Chart ---
function buildRevenueChart(paidItems) {
  const wrap = document.getElementById('revenueChartWrap');
  const drillContainer = document.getElementById('revenueChartDrill');
  const canvas = document.getElementById('revenueChart');

  if (!paidItems || paidItems.length === 0) {
    wrap.innerHTML = '<div class="chart-empty">Revenue data will appear as customers pay their invoices.</div>';
    return;
  }

  const months = getLast6Months();
  const grouped = {};
  months.forEach(m => { grouped[m.key] = []; });
  paidItems.forEach(item => {
    const key = getMonthKey(item.createdAt || item.issueDate);
    if (key && grouped[key] !== undefined) grouped[key].push(item);
  });

  // Each item is a paid invoice (preferred) or legacy deal — sum total || value
  const data = months.map(m => grouped[m.key].reduce((sum, item) => sum + (Number(item.total) || Number(item.value) || 0), 0));

  revenueChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: months.map(m => m.label),
      datasets: [{
        label: 'Revenue',
        data: data,
        backgroundColor: 'rgba(79,123,247,0.8)',
        hoverBackgroundColor: '#4F7BF7',
        borderRadius: 6,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => fmtCurrency(ctx.raw)
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: '#F1F5F9' },
          ticks: {
            callback: (v) => '$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v),
            font: { size: 11 }
          }
        },
        x: {
          grid: { display: false },
          ticks: { font: { size: 11 } }
        }
      },
      onClick: (evt, elements) => {
        if (elements.length === 0) return;
        const idx = elements[0].index;
        const monthKey = months[idx].key;
        const monthItems = grouped[monthKey];
        drillContainer.innerHTML = '';
        if (!monthItems || monthItems.length === 0) return;

        const drill = document.createElement('div');
        drill.className = 'chart-drilldown';
        drill.innerHTML = `<div class="chart-drilldown-title">${months[idx].label} — paid invoices</div>`;
        monthItems.slice(0, 10).forEach(item => {
          const row = document.createElement('div');
          row.className = 'drilldown-item';
          const label = item.invoiceNumber
            ? `${item.invoiceNumber} · ${item.clientName || ''}`
            : (item.name || 'Item');
          row.innerHTML = `
            <div class="drilldown-item-name">${escapeHtml(label)}</div>
            <div class="drilldown-item-value">${fmtCurrency(item.total || item.value || 0)}</div>
          `;
          row.addEventListener('click', async () => {
            const m = await import('./views/invoices.js');
            m.requestInvoice(item.id);
            navigate('invoices');
          });
          drill.appendChild(row);
        });
        drillContainer.appendChild(drill);
      }
    }
  });
}

// --- Build Deal Activity Line Chart ---
function buildActivityChart(items) {
  const wrap = document.getElementById('activityChartWrap');
  const drillContainer = document.getElementById('activityChartDrill');
  const canvas = document.getElementById('activityChart');

  if (!items || items.length === 0) {
    wrap.innerHTML = '<div class="chart-empty">Pipeline activity will appear as you build quotes.</div>';
    return;
  }

  const months = getLast6Months();
  const grouped = {};
  months.forEach(m => { grouped[m.key] = []; });
  items.forEach(item => {
    const key = getMonthKey(item.createdAt);
    if (key && grouped[key] !== undefined) grouped[key].push(item);
  });

  const data = months.map(m => grouped[m.key].length);

  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 240);
  gradient.addColorStop(0, 'rgba(79,123,247,0.15)');
  gradient.addColorStop(1, 'rgba(79,123,247,0)');

  activityChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: months.map(m => m.label),
      datasets: [{
        label: 'Deals Created',
        data: data,
        borderColor: '#4F7BF7',
        backgroundColor: gradient,
        fill: true,
        tension: 0.3,
        pointBackgroundColor: '#4F7BF7',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointRadius: 5,
        pointHoverRadius: 7
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.raw} deal${ctx.raw !== 1 ? 's' : ''}`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: '#F1F5F9' },
          ticks: {
            stepSize: 1,
            font: { size: 11 }
          }
        },
        x: {
          grid: { display: false },
          ticks: { font: { size: 11 } }
        }
      },
      onClick: (evt, elements) => {
        if (elements.length === 0) return;
        const idx = elements[0].index;
        const monthKey = months[idx].key;
        const monthItems = grouped[monthKey];
        drillContainer.innerHTML = '';
        if (!monthItems || monthItems.length === 0) return;

        const drill = document.createElement('div');
        drill.className = 'chart-drilldown';
        drill.innerHTML = `<div class="chart-drilldown-title">${months[idx].label} — quotes created</div>`;
        monthItems.slice(0, 10).forEach(q => {
          const row = document.createElement('div');
          row.className = 'drilldown-item';
          const cust = `${q.customerSnapshot?.firstName || ''} ${q.customerSnapshot?.lastName || ''}`.trim() || (q.customerSnapshot?.company || '');
          row.innerHTML = `
            <div>
              <div class="drilldown-item-name">${escapeHtml(q.quoteNumber || '-')} · ${escapeHtml(cust)}</div>
              <div class="drilldown-item-sub">${escapeHtml(q.status || '')}</div>
            </div>
            ${q.total ? `<div class="drilldown-item-value">${fmtCurrency(q.total)}</div>` : ''}
          `;
          row.addEventListener('click', async () => {
            const m = await import('./views/quote-builder.js');
            m.openBuilder(q.id);
          });
          drill.appendChild(row);
        });
        drillContainer.appendChild(drill);
      }
    }
  });
}

// ── Task Notifications ──────────────────
async function checkTaskNotifications() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    // Show banner (handled in dashboard render)
    return;
  }
  if (Notification.permission !== 'granted') return;

  try {
    const allTasks = await queryDocuments('tasks');
    const now = new Date();
    const notified = new Set();

    allTasks.forEach(t => {
      if (t.status === 'done' || !t.dueDate || notified.has(t.id)) return;
      try {
        const due = t.dueDate.toDate ? t.dueDate.toDate() : new Date(t.dueDate);
        const hoursUntil = (due - now) / (1000 * 60 * 60);
        if (hoursUntil < 0) {
          new Notification('Automation App CRM', { body: `Task overdue: ${t.title}` });
          notified.add(t.id);
        } else if (hoursUntil < 24) {
          new Notification('Automation App CRM', { body: `Due soon: ${t.title}` });
          notified.add(t.id);
        }
      } catch {}
    });
  } catch (err) {
    console.error('Notification check error:', err);
  }
}

// ── Messages unread badge in sidebar ──────────────────

function startMessagesBadge() {
  let unsub = null;
  try { unsub && unsub(); } catch {}
  unsub = subscribeToThreads({}, (threads) => {
    const count = countUnread(threads, 'operator');
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
}

// ── Nav click handlers ──────────────────
document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    navigate(btn.dataset.view);
    // Close mobile sidebar if open
    document.getElementById('sidebar').classList.remove('open');
  });
});

// ── Mobile menu toggle ──────────────────
document.getElementById('menuToggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});

document.getElementById('sidebarOverlay').addEventListener('click', () => {
  document.getElementById('sidebar').classList.remove('open');
});

// ── Init router ─────────────────────────
initRouter('dashboard');

// ── Dashboard empty-state button ────────
const dashboardAddBtn = document.getElementById('dashboardAddBtn');
if (dashboardAddBtn) dashboardAddBtn.addEventListener('click', () => { window.location.hash = 'contacts'; });

// ── Quote response handlers ─────────────
async function handleQuoteAccepted(responseId, responseData) {
  const responseRef = doc(db, 'quote_responses', responseId);
  // Claim the response atomically — prevents double-processing across tabs
  const claimed = await runTransaction(db, async (tx) => {
    const snap = await tx.get(responseRef);
    if (!snap.exists()) return false;
    const data = snap.data();
    if (data.processedAt) return false;
    tx.update(responseRef, { processedAt: serverTimestamp() });
    return true;
  });
  if (!claimed) return;

  // Find the matching quote
  const { collection: col, query: q, where: w, getDocs: gd } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
  const quoteSnap = await gd(q(col(db, 'quotes'), w('publicToken', '==', responseData.token)));
  if (quoteSnap.empty) { console.warn('No quote found for token', responseData.token); return; }
  const quoteDoc = quoteSnap.docs[0];
  const quote = quoteDoc.data();
  if (quote.status === 'provisioned') return; // already done

  try {
    // Flip quote status so the CRM shows "Accepted — provisioning..."
    await updateDoc(quoteDoc.ref, {
      status: 'accepted', acceptedAt: serverTimestamp(), signatureName: responseData.signatureName || '',
    });

    // Compute current period
    const now = new Date();
    const end = new Date(now);
    if (quote.billingCycle === 'annual') end.setFullYear(end.getFullYear() + 1);
    else end.setMonth(end.getMonth() + 1);

    const { getPackage } = await import('./services/catalog.js');
    const pkg = quote.packageId ? await getPackage(quote.packageId) : null;

    // Create the tenant
    const tenantRef = await createTenant({
      companyName: quote.customerSnapshot?.company || `${quote.customerSnapshot?.firstName || ''} ${quote.customerSnapshot?.lastName || ''}`.trim() || 'New Tenant',
      vertical: quote.vertical,
      packageId: quote.packageId,
      tier: quote.tier,
      addOns: quote.addOns || [],
      priceOverride: quote.priceOverride,
      billingCycle: quote.billingCycle,
      status: 'active',
      gracePeriodEnd: null,
      features: pkg?.features || [],
      featureOverrides: {},
      userLimit: pkg?.userLimit || 0,
      ownerUserId: '',
      contactId: quote.contactId || '',
      companyId: '',
      dealId: null,
      quoteId: quoteDoc.id,
      currentPeriodStart: Timestamp.fromDate(now),
      currentPeriodEnd: Timestamp.fromDate(end),
      cancelAt: null,
      scheduledChange: null,
      trialEndsAt: null,
      onboardingStep: 'pending',
      dataExportRequested: false,
      dataExportGeneratedAt: null,
    });
    const tenantId = tenantRef.id;

    // Seed settings (laborRate, taxRate, warrantyDays, currency, timezone)
    const { setDoc: sd, doc: dc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    await sd(dc(db, `tenants/${tenantId}/settings/general`), {
      laborRate: quote.laborRate || 0, taxRate: 0, warrantyDays: 90, currency: 'USD', timezone: 'America/Chicago',
      createdAt: serverTimestamp(),
    });

    // Create owner user placeholder + user_tenants mapping (so portal finds them)
    const ownerEmail = quote.customerSnapshot?.email || '';
    if (ownerEmail) {
      await addTenantUser(tenantId, `pending_${Date.now()}`, {
        email: ownerEmail,
        displayName: `${quote.customerSnapshot?.firstName || ''} ${quote.customerSnapshot?.lastName || ''}`.trim(),
        role: 'owner', status: 'pending', invitedBy: 'system',
      });
      const emailKey = ownerEmail.toLowerCase().trim();
      await sd(dc(db, 'user_tenants', emailKey), {
        tenantId, email: ownerEmail, role: 'owner',
        companyName: quote.customerSnapshot?.company || '',
        createdAt: serverTimestamp(),
      });
    }

    // Build first invoice line items: labor + line items + first recurring period + discount
    // Respects seat overage ($3/mo × extraUsers) and the 15% annual discount.
    const SEAT_PRICE = 3;
    const ANNUAL_DISCOUNT = 0.15;
    const isAnnual = quote.billingCycle === 'annual';
    const periodLabel = isAnnual ? 'year' : 'month';
    const cycleMultiplier = isAnnual ? 12 * (1 - ANNUAL_DISCOUNT) : 1;

    const lineItems = [];

    // One-time: labor + custom line items (NOT discounted by annual)
    const laborAmount = (quote.laborHours || 0) * (quote.laborRate || 0);
    if (laborAmount > 0) lineItems.push({
      description: quote.laborDescription || 'Setup / implementation',
      quantity: quote.laborHours, rate: quote.laborRate, amount: laborAmount,
    });
    (quote.lineItems || []).forEach(li => lineItems.push(li));

    // Recurring for first period (with annual discount if applicable)
    const planMonthly = quote.priceOverride ?? quote.basePrice ?? 0;
    const planPeriod = Math.round(planMonthly * cycleMultiplier * 100) / 100;
    if (planPeriod > 0) lineItems.push({
      description: `${pkg?.name || 'Subscription'} — first ${periodLabel}${isAnnual ? ' (15% annual discount)' : ''}`,
      quantity: 1, rate: planPeriod, amount: planPeriod,
    });

    (quote.addOns || []).forEach(a => {
      const mo = (a.priceMonthly || 0) * (a.qty || 1);
      const period = Math.round(mo * cycleMultiplier * 100) / 100;
      if (period > 0) lineItems.push({
        description: `Add-on: ${a.name}${a.qty > 1 ? ` × ${a.qty}` : ''} — first ${periodLabel}`,
        quantity: 1, rate: period, amount: period,
      });
    });

    // Extra-user seats
    const extraUsers = Number(quote.extraUsers) || 0;
    if (extraUsers > 0) {
      const seatsMonthly = extraUsers * SEAT_PRICE;
      const seatsPeriod = Math.round(seatsMonthly * cycleMultiplier * 100) / 100;
      lineItems.push({
        description: `${extraUsers} extra user seat${extraUsers === 1 ? '' : 's'} × $${SEAT_PRICE}/mo — first ${periodLabel}`,
        quantity: 1, rate: seatsPeriod, amount: seatsPeriod,
      });
    }

    if (quote.discount && quote.discount.amount > 0) {
      lineItems.push({
        description: `Discount — ${quote.discount.reason || ''}`,
        quantity: 1, rate: -quote.discount.amount, amount: -quote.discount.amount, isDiscount: true,
      });
    }
    const total = lineItems.reduce((s, l) => s + (l.amount || 0), 0);

    const invoiceNumber = `INV-T-${Date.now().toString().slice(-6)}`;
    const invoiceRef = await addTenantInvoice(tenantId, {
      invoiceNumber,
      type: 'charge',
      amount: total, total,
      status: 'sent',
      issuedDate: serverTimestamp(),
      dueDate: Timestamp.fromDate(new Date(Date.now() + 14 * 86400000)),
      lineItems,
      reason: `First invoice from quote ${quote.quoteNumber}`,
    });

    // Mirror to root /invoices so it shows in the CRM's revenue view.
    // (tenants/{t}/invoices is the tenant's billing statement; the root
    // invoices collection is how the CRM tracks revenue across customers.)
    const todayIso = new Date().toISOString().split('T')[0];
    const dueIso = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];
    const customerName = `${quote.customerSnapshot?.firstName || ''} ${quote.customerSnapshot?.lastName || ''}`.trim() || (quote.customerSnapshot?.company || '');
    const crmInvoiceData = {
      invoiceNumber,
      clientId: quote.contactId || '',
      clientName: quote.customerSnapshot?.company || customerName || 'Unknown',
      customerName,
      tenantId,
      tenantInvoiceId: invoiceRef.id,
      quoteId: quoteDoc.id,
      quoteNumber: quote.quoteNumber,
      issueDate: todayIso,
      dueDate: dueIso,
      lineItems,
      subtotal: total,
      taxRate: 0,
      taxAmount: 0,
      total,
      status: 'sent',
      notes: `Auto-generated from quote ${quote.quoteNumber}`,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    let crmInvoiceId = null;
    try {
      const { addDocument } = await import('./services/firestore.js');
      const crmInvRef = await addDocument('invoices', crmInvoiceData);
      crmInvoiceId = crmInvRef.id;
    } catch (err) {
      console.warn('Root invoice mirror write failed (tenant invoice still created):', err);
    }

    await addTenantActivity(tenantId, {
      type: 'quote_accepted',
      description: `Provisioned from quote ${quote.quoteNumber}`,
      metadata: { quoteId: quoteDoc.id, invoiceId: invoiceRef.id, crmInvoiceId, signatureName: responseData.signatureName || '' },
    });

    // Update quote as provisioned
    await updateDoc(quoteDoc.ref, {
      status: 'provisioned',
      provisionedAt: serverTimestamp(),
      tenantId,
      invoiceId: invoiceRef.id,
      crmInvoiceId,
    });

    // Record structured subscription_events doc so the customer timeline
    // has a first entry to hang everything else from.
    try {
      const basePrice = quote.priceOverride ?? quote.basePrice ?? 0;
      const toState = {
        packageId:     quote.packageId || null,
        tier:          quote.tier || null,
        basePrice:     Number(basePrice) || 0,
        priceOverride: quote.priceOverride != null ? Number(quote.priceOverride) : null,
        addOns:        Array.isArray(quote.addOns) ? quote.addOns.map(a => ({ ...a })) : [],
        billingCycle:  quote.billingCycle || 'monthly',
        status:        'active',
        extraUsers:    Number(quote.extraUsers) || 0,
      };
      await recordSubEvent({
        tenantId,
        contactId: quote.contactId || null,
        type: SUB_EVENTS.CREATED,
        fromState: null,
        toState,
        invoiceId: invoiceRef.id,
        reason: `Provisioned from quote ${quote.quoteNumber}`,
        metadata: { quoteId: quoteDoc.id, crmInvoiceId },
      });
    } catch (err) {
      console.warn('subscription_events created write failed:', err);
    }

    // Delete the public view so the URL stops exposing pricing
    try { await deleteDoc(doc(db, 'quote_views', responseData.token)); } catch {}

    showToast(`Tenant provisioned from quote ${quote.quoteNumber}`, 'success');
  } catch (err) {
    console.error('Provisioning failed:', err);
    // Flip quote so admin can retry
    await updateDoc(quoteDoc.ref, {
      status: 'accepted', // stays accepted but not provisioned
      provisioningError: err.message || String(err),
    });
    showToast('Provisioning failed — see Quotes list', 'error');
  }
}

async function runCompaniesMigration() {
  const { getDoc: gd, setDoc: sd, doc: dc, updateDoc: ud, collection: col, getDocs: gds, serverTimestamp: ts } =
    await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
  const flagRef = dc(db, 'settings', 'migrations');
  const flagSnap = await gd(flagRef);
  const flags = flagSnap.exists() ? flagSnap.data() : {};
  if (flags.companiesToContactStrings) return;

  console.log('[migration] Starting companies→contact.company …');
  const contactsSnap = await gds(col(db, 'contacts'));
  const companiesSnap = await gds(col(db, 'companies')).catch(() => ({ docs: [] }));
  const companyMap = {};
  companiesSnap.docs.forEach(d => { companyMap[d.id] = d.data().name || ''; });

  let migrated = 0;
  for (const c of contactsSnap.docs) {
    const data = c.data();
    if (data.company) continue; // already has string
    if (!data.companyId) continue;
    const name = companyMap[data.companyId];
    if (!name) continue;
    await ud(dc(db, 'contacts', c.id), { company: name });
    migrated += 1;
  }
  await sd(flagRef, { companiesToContactStrings: { ranAt: ts(), migrated } }, { merge: true });
  console.log(`[migration] Done (${migrated} contacts updated).`);
}

async function handleQuoteDeclined(responseId, responseData) {
  const responseRef = doc(db, 'quote_responses', responseId);
  const claimed = await runTransaction(db, async (tx) => {
    const snap = await tx.get(responseRef);
    if (!snap.exists()) return false;
    if (snap.data().processedAt) return false;
    tx.update(responseRef, { processedAt: serverTimestamp() });
    return true;
  });
  if (!claimed) return;

  const { collection: col, query: q, where: w, getDocs: gd } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
  const quoteSnap = await gd(q(col(db, 'quotes'), w('publicToken', '==', responseData.token)));
  if (quoteSnap.empty) return;
  await updateDoc(quoteSnap.docs[0].ref, { status: 'declined', declinedAt: serverTimestamp() });
  try { await deleteDoc(doc(db, 'quote_views', responseData.token)); } catch {}
  showToast(`Quote declined`, 'info');
}
