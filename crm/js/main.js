import { auth } from './config.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { registerView, navigate, initRouter } from './router.js';
import { showToast, escapeHtml, formatDate, timeAgo, formatCurrency as fmtCurrency } from './ui.js';
import * as contactsView from './views/contacts.js';
import * as companiesView from './views/companies.js';
import * as pipelineView from './views/pipeline.js';
import * as tasksView from './views/tasks.js';
import * as invoicesView from './views/invoices.js';
import * as subscriptionsView from './views/subscriptions.js';
import * as settingsView from './views/settings.js';
import { queryDocuments } from './services/firestore.js';
import { getCurrentUserRole, clearRoleCache, bootstrapCurrentUser } from './services/roles.js';

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

  // Bootstrap user doc then fetch role (non-blocking)
  bootstrapCurrentUser()
    .then(() => getCurrentUserRole())
    .then(role => {
      document.getElementById('userRole').textContent = role || 'member';
      if (role === 'admin') {
        document.getElementById('adminNavSection').style.display = '';
        document.getElementById('settingsNavItem').style.display = '';
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
  pipeline:      'Pipeline',
  tasks:         'Tasks',
  invoices:      'Invoices',
  subscriptions: 'Subscriptions',
  messages:      'Messages',
  settings:      'Settings'
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
    ['drillContacts', 'drillDeals', 'drillTasks', 'drillRevenue', 'revenueChartDrill', 'activityChartDrill'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '';
    });

    // Collapse all cards
    document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('expanded'));

    let contactsList = [];
    let dealsList = [];

    try {
      const results = await Promise.allSettled([
        queryDocuments('contacts'),
        queryDocuments('deals')
      ]);
      contactsList = results[0].status === 'fulfilled' ? results[0].value : [];
      dealsList = results[1].status === 'fulfilled' ? results[1].value : [];
    } catch (err) {
      console.error('Dashboard data error:', err);
    }

    const activeDeals = dealsList.filter(d => d.stage !== 'won' && d.stage !== 'lost');
    const wonDeals = dealsList.filter(d => d.stage === 'won');
    const revenue = wonDeals.reduce((sum, d) => sum + (d.value || 0), 0);

    // Update stat values
    document.getElementById('statContacts').textContent = contactsList.length;
    document.getElementById('statProjects').textContent = activeDeals.length;
    const tasksList = await queryDocuments('tasks');
      const openTasks = tasksList.filter(t => t.status !== 'done');
      document.getElementById('statTasks').textContent = openTasks.length;
    document.getElementById('statRevenue').textContent = fmtCurrency(revenue);

    // Show/hide empty state vs content
    const hasData = contactsList.length > 0 || dealsList.length > 0;
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

    // --- Populate drill-down data ---
    populateDrilldown('drillContacts', contactsList.slice(0, 5).map(c => ({
      name: `${c.firstName || ''} ${c.lastName || ''}`.trim(),
      sub: c.companyName || '',
      onClick: () => navigate('contacts')
    })));

    populateDrilldown('drillDeals', activeDeals.slice(0, 5).map(d => ({
      name: d.name,
      value: d.value ? fmtCurrency(d.value) : '',
      sub: d.stage,
      onClick: () => navigate('pipeline')
    })));

    populateDrilldown('drillTasks', openTasks.slice(0, 5).map(t => ({
        name: t.title,
        sub: t.priority ? t.priority.charAt(0).toUpperCase() + t.priority.slice(1) + ' priority' : '',
        value: t.dueDate ? formatDate(t.dueDate) : '',
        onClick: () => navigate('tasks')
      })));

    populateDrilldown('drillRevenue', wonDeals.slice(0, 5).map(d => ({
      name: d.name,
      value: d.value ? fmtCurrency(d.value) : '',
      sub: formatDate(d.createdAt),
      onClick: () => navigate('pipeline')
    })));

    // --- Wire stat card click toggling ---
    document.querySelectorAll('#statsGrid .stat-card').forEach(card => {
      // Remove old listeners by cloning
      const newCard = card.cloneNode(true);
      card.parentNode.replaceChild(newCard, card);

      newCard.addEventListener('click', (e) => {
        // Don't toggle if clicking a drill-down item
        if (e.target.closest('.drilldown-item')) return;

        const wasExpanded = newCard.classList.contains('expanded');
        // Collapse all
        document.querySelectorAll('#statsGrid .stat-card').forEach(c => c.classList.remove('expanded'));
        // Toggle this one
        if (!wasExpanded) newCard.classList.add('expanded');
      });
    });

    // --- Revenue Bar Chart ---
    buildRevenueChart(wonDeals);

    // --- Deal Activity Line Chart ---
    buildActivityChart(dealsList);
  }
});

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
function buildRevenueChart(wonDeals) {
  const wrap = document.getElementById('revenueChartWrap');
  const drillContainer = document.getElementById('revenueChartDrill');
  const canvas = document.getElementById('revenueChart');

  if (wonDeals.length === 0) {
    wrap.innerHTML = '<div class="chart-empty">Revenue data will appear as you close deals.</div>';
    return;
  }

  const months = getLast6Months();
  const grouped = {};
  months.forEach(m => { grouped[m.key] = []; });
  wonDeals.forEach(d => {
    const key = getMonthKey(d.createdAt);
    if (key && grouped[key] !== undefined) grouped[key].push(d);
  });

  const data = months.map(m => grouped[m.key].reduce((sum, d) => sum + (d.value || 0), 0));

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
        const monthDeals = grouped[monthKey];
        drillContainer.innerHTML = '';
        if (monthDeals.length === 0) return;

        const drill = document.createElement('div');
        drill.className = 'chart-drilldown';
        drill.innerHTML = `<div class="chart-drilldown-title">${months[idx].label} Deals</div>`;
        monthDeals.slice(0, 10).forEach(d => {
          const row = document.createElement('div');
          row.className = 'drilldown-item';
          row.innerHTML = `
            <div class="drilldown-item-name">${escapeHtml(d.name)}</div>
            <div class="drilldown-item-value">${fmtCurrency(d.value)}</div>
          `;
          row.addEventListener('click', () => navigate('pipeline'));
          drill.appendChild(row);
        });
        drillContainer.appendChild(drill);
      }
    }
  });
}

// --- Build Deal Activity Line Chart ---
function buildActivityChart(allDeals) {
  const wrap = document.getElementById('activityChartWrap');
  const drillContainer = document.getElementById('activityChartDrill');
  const canvas = document.getElementById('activityChart');

  if (allDeals.length === 0) {
    wrap.innerHTML = '<div class="chart-empty">Deal activity will appear as you add deals.</div>';
    return;
  }

  const months = getLast6Months();
  const grouped = {};
  months.forEach(m => { grouped[m.key] = []; });
  allDeals.forEach(d => {
    const key = getMonthKey(d.createdAt);
    if (key && grouped[key] !== undefined) grouped[key].push(d);
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
        const monthDeals = grouped[monthKey];
        drillContainer.innerHTML = '';
        if (monthDeals.length === 0) return;

        const drill = document.createElement('div');
        drill.className = 'chart-drilldown';
        drill.innerHTML = `<div class="chart-drilldown-title">${months[idx].label} Deals</div>`;
        monthDeals.slice(0, 10).forEach(d => {
          const row = document.createElement('div');
          row.className = 'drilldown-item';
          row.innerHTML = `
            <div>
              <div class="drilldown-item-name">${escapeHtml(d.name)}</div>
              <div class="drilldown-item-sub">${escapeHtml(d.stage || '')}</div>
            </div>
            ${d.value ? `<div class="drilldown-item-value">${fmtCurrency(d.value)}</div>` : ''}
          `;
          row.addEventListener('click', () => navigate('pipeline'));
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
