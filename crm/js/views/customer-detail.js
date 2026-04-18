// ─────────────────────────────────────────────────────────────────
//  customer-detail.js — Tabbed Customer 360 page.
//
//  Replaces the old showDetailPage() in contacts.js. Entry point:
//    openCustomerDetail(contact, { contacts, quotes, invoices, onBack })
// ─────────────────────────────────────────────────────────────────

import { updateDocument } from '../services/firestore.js';
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { db } from '../config.js';
import { addActivity, logFieldEdit, getActivity } from '../services/activity.js';
import { makeEditable } from '../components/inline-edit.js';
import { showToast, escapeHtml, timeAgo, formatDate } from '../ui.js';
import {
  invoiceEffectiveAmount, sumOverdue,
  computeLTV, computeMRR, computeOpenAR, nextRenewalDate, daysUntil, formatTenure, formatMoney
} from '../services/money.js';
import { listEventsForTenant } from '../services/subscription-events.js';
import { listPayments } from '../services/payments.js';
import { getTenantUsers } from '../services/tenants.js';
import { renderBillingTab } from './customer-detail-billing.js';
import { renderSubscriptionTab } from './customer-detail-subscription.js';
import { renderFilesTab } from './customer-detail-files.js';
import { renderTeamTab } from './customer-detail-team.js';

const TABS = [
  { id: 'overview',      label: 'Overview'       },
  { id: 'billing',       label: 'Billing'        },
  { id: 'subscription',  label: 'Subscription'   },
  { id: 'activity',      label: 'Activity & Audit' },
  { id: 'files',         label: 'Files'          },
  { id: 'team',          label: 'Team & Portal'  },
];

let state = null;

export async function openCustomerDetail(contact, opts = {}) {
  state = {
    contact,
    contacts: opts.contacts || [],
    quotes:   opts.quotes   || [],
    invoices: opts.invoices || [],
    tenant:   null,
    events:   [],
    payments: [],
    users:    [],
    activities: [],
    activeTab: opts.tab || 'overview',
    onBack:   opts.onBack || (() => {}),
  };

  await loadLinkedData();
  render();
}

async function loadLinkedData() {
  // Find tenant linked to this contact
  try {
    const tSnap = await getDocs(collection(db, 'tenants'));
    const tenants = tSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.tenant = tenants.find(t => t.contactId === state.contact.id) || null;
  } catch (err) { console.warn('Tenant lookup failed:', err); }

  if (state.tenant) {
    try { state.events = await listEventsForTenant(state.tenant.id); } catch {}
    try { state.payments = await listPayments(state.tenant.id); } catch {}
    try { state.users = await getTenantUsers(state.tenant.id); } catch {}
  }
  try { state.activities = await getActivity('contacts', state.contact.id); } catch {}
}

function render() {
  const container = document.getElementById('view-contacts');
  if (!container) return;
  container.innerHTML = '';

  container.appendChild(renderBackButton());
  container.appendChild(renderHeader());
  container.appendChild(renderTabBar());

  const body = document.createElement('div');
  body.className = 'customer-tab-body';
  container.appendChild(body);
  renderActiveTab(body);
}

function renderBackButton() {
  const btn = document.createElement('button');
  btn.className = 'detail-back';
  btn.innerHTML = '&larr; Back to Customers';
  btn.addEventListener('click', () => state.onBack());
  return btn;
}

function renderHeader() {
  const c = state.contact;
  const customerInvoices = getCustomerInvoices();
  const ltv    = computeLTV(customerInvoices, state.payments);
  const mrr    = state.tenant ? computeMRR(state.tenant) : 0;
  const openAR = computeOpenAR(customerInvoices);
  const health = computeHealthScore(customerInvoices, state.activities, state.users);

  const tenantBadge = renderTenantBadge();
  const tenureBadge = c.createdAt
    ? `<span class="cust-badge cust-badge-neutral">Customer ${escapeHtml(formatTenure(c.createdAt))}</span>`
    : '';

  const initials = ((c.firstName || '')[0] || '') + ((c.lastName || '')[0] || '');
  const company = c.company || c.companyName || '';
  const subtitle = [c.jobTitle, company, c.email, c.phone].filter(Boolean).map(escapeHtml).join(' · ');

  const header = document.createElement('div');
  header.className = 'customer-header';
  header.innerHTML = `
    <div class="customer-header-top">
      <div class="detail-avatar" style="width:64px;height:64px;font-size:1.5rem;">${escapeHtml(initials.toUpperCase())}</div>
      <div style="flex:1;min-width:0;">
        <div class="detail-name">${escapeHtml(c.firstName || '')} ${escapeHtml(c.lastName || '')}</div>
        <div class="detail-subtitle">${subtitle || '&nbsp;'}</div>
        <div class="customer-badges">
          ${tenantBadge}
          ${tenureBadge}
          <span class="cust-badge cust-health cust-health-${health.level}">
            <span class="cust-health-dot"></span> ${escapeHtml(health.label)}
          </span>
        </div>
      </div>
      <div class="customer-quick-actions">
        <button class="btn btn-primary btn-sm" data-qa="new-quote">New Quote</button>
        ${state.tenant ? `<button class="btn btn-ghost btn-sm" data-qa="record-payment">Record Payment</button>` : ''}
        <button class="btn btn-ghost btn-sm" data-qa="log-activity">Log Activity</button>
        ${state.tenant ? `<button class="btn btn-ghost btn-sm" data-qa="open-tenant">Open Tenant &#x2197;</button>` : ''}
      </div>
    </div>
    <div class="customer-kpi-row">
      <div class="cust-kpi">
        <span class="cust-kpi-label">Lifetime value</span>
        <span class="cust-kpi-value">${escapeHtml(formatMoney(ltv))}</span>
      </div>
      <div class="cust-kpi">
        <span class="cust-kpi-label">MRR</span>
        <span class="cust-kpi-value">${escapeHtml(formatMoney(mrr))}</span>
      </div>
      <div class="cust-kpi">
        <span class="cust-kpi-label">Open A/R</span>
        <span class="cust-kpi-value ${openAR > 0 ? 'cust-kpi-warn' : ''}">${escapeHtml(formatMoney(openAR))}</span>
      </div>
      <div class="cust-kpi">
        <span class="cust-kpi-label">Next renewal</span>
        <span class="cust-kpi-value">${renderNextRenewal()}</span>
      </div>
    </div>
  `;

  // Wire quick actions
  header.querySelector('[data-qa="new-quote"]')?.addEventListener('click', async () => {
    const m = await import('./quotes.js');
    m.requestNewQuoteFor(c);
    window.location.hash = 'quotes';
  });
  header.querySelector('[data-qa="log-activity"]')?.addEventListener('click', () => {
    state.activeTab = 'activity';
    render();
  });
  header.querySelector('[data-qa="record-payment"]')?.addEventListener('click', () => {
    state.activeTab = 'billing';
    render();
    // Click the in-tab Record Payment button on the next tick once the DOM settles.
    setTimeout(() => {
      const btn = document.querySelector('[data-action="record-payment"]');
      btn?.click();
    }, 50);
  });
  header.querySelector('[data-qa="open-tenant"]')?.addEventListener('click', async () => {
    if (!state.tenant) return;
    const m = await import('./tenants.js');
    m.requestTenant(state.tenant.id);
    window.location.hash = 'tenants';
  });

  return header;
}

function renderTenantBadge() {
  if (!state.tenant) {
    return `<span class="cust-badge cust-badge-neutral">No tenant</span>`;
  }
  const s = state.tenant.status || 'active';
  const cls = s === 'active' ? 'cust-badge-success'
            : s === 'past_due' ? 'cust-badge-warn'
            : s === 'cancelled' ? 'cust-badge-danger'
            : 'cust-badge-neutral';
  const labelMap = { active: 'Active', past_due: 'Past due', cancelled: 'Cancelled', suspended: 'Suspended' };
  return `<span class="cust-badge ${cls}">${escapeHtml(labelMap[s] || s)}</span>`;
}

function renderNextRenewal() {
  if (!state.tenant) return '<span style="color:var(--gray);">—</span>';
  const d = nextRenewalDate(state.tenant);
  if (!d) return '<span style="color:var(--gray);">—</span>';
  const days = daysUntil(d);
  const dayText = days > 0 ? `in ${days}d`
                : days === 0 ? 'today'
                : `${Math.abs(days)}d ago`;
  return `${escapeHtml(formatDate(d))} <span style="color:var(--gray-dark);font-size:0.78rem;">(${escapeHtml(dayText)})</span>`;
}

function renderTabBar() {
  const bar = document.createElement('div');
  bar.className = 'customer-tab-bar';
  bar.innerHTML = TABS.map(t => `
    <button class="customer-tab ${state.activeTab === t.id ? 'active' : ''}" data-tab="${t.id}">
      ${escapeHtml(t.label)}
    </button>
  `).join('');
  bar.querySelectorAll('.customer-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeTab = btn.dataset.tab;
      render();
    });
  });
  return bar;
}

function renderActiveTab(body) {
  switch (state.activeTab) {
    case 'overview':     return renderOverviewTab(body);
    case 'billing':      return renderBillingTab(body, state, render);
    case 'subscription': return renderSubscriptionTab(body, state, render);
    case 'activity':     return renderActivityTab(body);
    case 'files':        return renderFilesTab(body, state, render);
    case 'team':         return renderTeamTab(body, state, render);
  }
}

// ── Overview tab ────────────────────────────────────────────────

function renderOverviewTab(body) {
  const c = state.contact;
  const layout = document.createElement('div');
  layout.className = 'detail-layout';

  // Left: profile fields (editable inline)
  const leftCol = document.createElement('div');
  leftCol.innerHTML = `<div class="detail-section-title">Contact Information</div>`;
  renderProfileFields(leftCol);
  renderTagsField(leftCol);
  renderInternalNotesField(leftCol);
  renderSiblingContacts(leftCol);

  // Right: stat cards + recent activity preview + recent invoices preview
  const rightCol = document.createElement('div');
  rightCol.innerHTML = `<div class="detail-section-title">Snapshot</div>`;
  renderOverviewStats(rightCol);
  renderRecentActivityPreview(rightCol);
  renderRecentInvoicesPreview(rightCol);

  layout.appendChild(leftCol);
  layout.appendChild(rightCol);
  body.appendChild(layout);
}

function renderProfileFields(container) {
  const c = state.contact;
  const fields = [
    { key: 'firstName', label: 'First Name', type: 'text' },
    { key: 'lastName',  label: 'Last Name',  type: 'text' },
    { key: 'email',     label: 'Email',      type: 'email' },
    { key: 'phone',     label: 'Phone',      type: 'tel' },
    { key: 'jobTitle',  label: 'Job Title',  type: 'text' },
    { key: 'notes',     label: 'Notes',      type: 'textarea' },
  ];

  fields.forEach(f => {
    const field = document.createElement('div');
    field.className = 'detail-field';
    field.innerHTML = `<div class="detail-field-label">${f.label}</div><div class="detail-field-value"></div>`;
    const valueEl = field.querySelector('.detail-field-value');
    makeEditable(valueEl, {
      field: f.key,
      type: f.type,
      value: c[f.key] || '',
      onSave: async (newValue, oldValue) => {
        await updateDocument('contacts', c.id, { [f.key]: newValue });
        await logFieldEdit('contacts', c.id, f.label, oldValue, newValue);
        c[f.key] = newValue;
      },
    });
    container.appendChild(field);
  });

  // Company — string field, writes both legacy companyName and new company
  const companyField = document.createElement('div');
  companyField.className = 'detail-field';
  companyField.innerHTML = `<div class="detail-field-label">Company</div><div class="detail-field-value"></div>`;
  const companyValueEl = companyField.querySelector('.detail-field-value');
  makeEditable(companyValueEl, {
    field: 'company',
    type: 'text',
    value: c.company || c.companyName || '',
    onSave: async (newValue, oldValue) => {
      await updateDocument('contacts', c.id, { company: newValue, companyName: newValue, companyId: '' });
      await logFieldEdit('contacts', c.id, 'Company', oldValue, newValue);
      c.company = newValue;
      c.companyName = newValue;
      c.companyId = '';
    },
  });
  container.appendChild(companyField);
}

function renderTagsField(container) {
  const c = state.contact;
  const wrap = document.createElement('div');
  wrap.className = 'detail-field';
  wrap.innerHTML = `<div class="detail-field-label">Tags</div>`;
  const chips = document.createElement('div');
  chips.className = 'tag-chip-row';
  const tags = Array.isArray(c.tags) ? c.tags : [];
  chips.innerHTML = tags.map(t => `
    <span class="tag-chip">${escapeHtml(t)}<span class="tag-chip-remove" data-tag="${escapeHtml(t)}">×</span></span>
  `).join('') + `
    <button class="tag-chip-add">+ Add tag</button>
  `;
  wrap.appendChild(chips);

  chips.querySelectorAll('.tag-chip-remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const tag = btn.dataset.tag;
      const next = tags.filter(t => t !== tag);
      await updateDocument('contacts', c.id, { tags: next });
      c.tags = next;
      render();
    });
  });
  chips.querySelector('.tag-chip-add').addEventListener('click', async () => {
    const value = window.prompt('Add a tag')?.trim();
    if (!value) return;
    const next = [...tags, value];
    await updateDocument('contacts', c.id, { tags: next });
    c.tags = next;
    render();
  });
  container.appendChild(wrap);
}

function renderInternalNotesField(container) {
  const c = state.contact;
  const wrap = document.createElement('div');
  wrap.className = 'detail-field';
  wrap.innerHTML = `<div class="detail-field-label">Internal notes (CRM only)</div><div class="detail-field-value"></div>`;
  const valueEl = wrap.querySelector('.detail-field-value');
  makeEditable(valueEl, {
    field: 'internalNotes',
    type: 'textarea',
    value: c.internalNotes || '',
    onSave: async (newValue) => {
      await updateDocument('contacts', c.id, { internalNotes: newValue });
      c.internalNotes = newValue;
    },
  });
  container.appendChild(wrap);
}

function renderSiblingContacts(container) {
  const c = state.contact;
  const company = (c.company || c.companyName || '').trim();
  if (!company) return;
  const target = company.toLowerCase();
  const siblings = (state.contacts || []).filter(x => {
    if (x.id === c.id) return false;
    const cc = (x.company || x.companyName || '').toLowerCase();
    return cc && cc === target;
  });
  if (!siblings.length) return;

  const section = document.createElement('div');
  section.className = 'settings-section';
  section.style.marginTop = '1rem';
  section.innerHTML = `
    <h3 class="section-title">Other contacts at ${escapeHtml(company)}</h3>
    <table class="data-table"><tbody>${siblings.map(x => `
      <tr class="clickable" data-id="${x.id}">
        <td>${escapeHtml((x.firstName || '') + ' ' + (x.lastName || ''))}</td>
        <td>${escapeHtml(x.email || x.phone || '-')}</td>
      </tr>
    `).join('')}</tbody></table>
  `;
  section.querySelectorAll('tr[data-id]').forEach(tr => {
    tr.addEventListener('click', () => {
      const sib = (state.contacts || []).find(x => x.id === tr.dataset.id);
      if (sib) {
        state.contact = sib;
        state.activeTab = 'overview';
        loadLinkedData().then(render);
      }
    });
  });
  container.appendChild(section);
}

function renderOverviewStats(container) {
  const customerInvoices = getCustomerInvoices();
  const ltv = computeLTV(customerInvoices, state.payments);
  const mrr = state.tenant ? computeMRR(state.tenant) : 0;
  const openAR = computeOpenAR(customerInvoices);
  const overdue = sumOverdue(customerInvoices);

  const card = document.createElement('div');
  card.className = 'overview-stats';
  card.innerHTML = `
    <div class="overview-stat clickable" data-tab="billing">
      <div class="overview-stat-label">Lifetime value</div>
      <div class="overview-stat-value">${escapeHtml(formatMoney(ltv))}</div>
    </div>
    <div class="overview-stat clickable" data-tab="subscription">
      <div class="overview-stat-label">MRR</div>
      <div class="overview-stat-value">${escapeHtml(formatMoney(mrr))}</div>
    </div>
    <div class="overview-stat clickable" data-tab="billing">
      <div class="overview-stat-label">Open A/R</div>
      <div class="overview-stat-value ${openAR > 0 ? 'warn' : ''}">${escapeHtml(formatMoney(openAR))}</div>
    </div>
    <div class="overview-stat clickable" data-tab="billing">
      <div class="overview-stat-label">Overdue</div>
      <div class="overview-stat-value ${overdue > 0 ? 'danger' : ''}">${escapeHtml(formatMoney(overdue))}</div>
    </div>
  `;
  card.querySelectorAll('.overview-stat').forEach(el => {
    el.addEventListener('click', () => {
      state.activeTab = el.dataset.tab;
      render();
    });
  });
  container.appendChild(card);
}

function renderRecentActivityPreview(container) {
  const section = document.createElement('div');
  section.className = 'settings-section';
  section.style.marginTop = '1rem';
  const recent = (state.activities || []).slice(0, 5);

  section.innerHTML = `
    <h3 class="section-title">Recent activity</h3>
    ${recent.length === 0
      ? '<div style="color:var(--gray);font-size:0.85rem;padding:0.5rem 0;">No activity yet.</div>'
      : recent.map(a => `
          <div class="mini-activity">
            <div class="mini-activity-desc">${escapeHtml(a.description || a.type || '')}</div>
            <div class="mini-activity-meta">${escapeHtml(a.createdByEmail || 'System')} · ${escapeHtml(timeAgo(a.createdAt))}</div>
          </div>
        `).join('')
    }
    ${state.activities.length > 5 ? `<a class="drill-cta" data-jump-tab="activity">View all →</a>` : ''}
  `;
  section.querySelector('[data-jump-tab]')?.addEventListener('click', () => {
    state.activeTab = 'activity';
    render();
  });
  container.appendChild(section);
}

function renderRecentInvoicesPreview(container) {
  const customerInvoices = getCustomerInvoices();
  if (!customerInvoices.length) return;
  const section = document.createElement('div');
  section.className = 'settings-section';
  section.style.marginTop = '1rem';
  const recent = customerInvoices.slice(0, 5);
  section.innerHTML = `
    <h3 class="section-title">Recent invoices</h3>
    <table class="data-table"><tbody>
      ${recent.map(i => `
        <tr class="clickable" data-invoice-id="${i.id}">
          <td style="font-family:var(--font-mono);">${escapeHtml(i.invoiceNumber || '-')}</td>
          <td>${escapeHtml(formatMoney(invoiceEffectiveAmount(i)))}</td>
          <td><span class="badge ${statusBadgeClass(i.status)}">${escapeHtml(i.status || 'draft')}</span></td>
        </tr>
      `).join('')}
    </tbody></table>
    ${customerInvoices.length > 5 ? `<a class="drill-cta" data-jump-tab="billing">View all →</a>` : ''}
  `;
  section.querySelectorAll('tr[data-invoice-id]').forEach(tr => {
    tr.addEventListener('click', async () => {
      const m = await import('./invoices.js');
      m.requestInvoice(tr.dataset.invoiceId);
      window.location.hash = 'invoices';
    });
  });
  section.querySelector('[data-jump-tab]')?.addEventListener('click', () => {
    state.activeTab = 'billing';
    render();
  });
  container.appendChild(section);
}

// ── Activity tab (unified feed) ─────────────────────────────────

function renderActivityTab(body) {
  const c = state.contact;

  const composer = document.createElement('div');
  composer.className = 'activity-composer';
  let selectedType = 'call';
  composer.innerHTML = `
    <div class="activity-type-pills">
      <button type="button" class="activity-type-pill active" data-type="call">Call</button>
      <button type="button" class="activity-type-pill" data-type="email">Email</button>
      <button type="button" class="activity-type-pill" data-type="meeting">Meeting</button>
      <button type="button" class="activity-type-pill" data-type="note">Note</button>
    </div>
    <textarea placeholder="Log an activity..."></textarea>
    <button class="btn btn-primary" style="align-self:flex-end;margin-top:0.5rem;">Save</button>
  `;
  composer.querySelectorAll('.activity-type-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      composer.querySelectorAll('.activity-type-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      selectedType = pill.dataset.type;
    });
  });
  const textarea = composer.querySelector('textarea');
  const saveBtn = composer.querySelector('.btn-primary');
  saveBtn.addEventListener('click', async () => {
    const desc = textarea.value.trim();
    if (!desc) return;
    try {
      await addActivity('contacts', c.id, { type: selectedType, description: desc });
      showToast('Activity logged', 'success');
      textarea.value = '';
      state.activities = await getActivity('contacts', c.id);
      render();
    } catch (err) {
      console.error(err);
      showToast('Failed to log activity', 'error');
    }
  });
  body.appendChild(composer);

  // Filter pills
  const filters = document.createElement('div');
  filters.className = 'activity-filters';
  const pills = ['All', 'Communications', 'System', 'Subscription', 'Billing'];
  let activeFilter = 'All';
  filters.innerHTML = pills.map(p => `
    <button class="activity-filter-pill ${p === activeFilter ? 'active' : ''}" data-filter="${p}">${p}</button>
  `).join('');
  body.appendChild(filters);

  const timeline = document.createElement('div');
  timeline.className = 'detail-timeline';
  body.appendChild(timeline);

  function applyFilter() {
    const feed = buildUnifiedFeed().filter(item => {
      if (activeFilter === 'All') return true;
      if (activeFilter === 'Communications') return ['call', 'email', 'meeting', 'note'].includes(item.kind);
      if (activeFilter === 'System') return item.kind === 'edit' || item.kind === 'system';
      if (activeFilter === 'Subscription') return item.kind === 'subscription_event';
      if (activeFilter === 'Billing') return item.kind === 'payment' || item.kind === 'invoice';
      return true;
    });
    timeline.innerHTML = '';
    if (!feed.length) {
      timeline.innerHTML = '<div style="text-align:center;color:var(--gray);padding:2rem 0;font-size:0.85rem;">No matching events.</div>';
      return;
    }
    feed.forEach(item => timeline.appendChild(renderFeedItem(item)));
  }

  filters.querySelectorAll('.activity-filter-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.filter;
      filters.querySelectorAll('.activity-filter-pill').forEach(b => b.classList.toggle('active', b === btn));
      applyFilter();
    });
  });

  applyFilter();
}

function buildUnifiedFeed() {
  const items = [];

  (state.activities || []).forEach(a => {
    items.push({
      kind: a.type === 'edit' ? 'edit' : (['call', 'email', 'meeting', 'note'].includes(a.type) ? a.type : 'system'),
      icon: iconFor(a.type),
      title: a.description || a.type || '',
      diff: a.type === 'edit' && a.oldValue !== undefined
        ? `"${a.oldValue || '(empty)'}" → "${a.newValue || '(empty)'}"` : '',
      actor: a.createdByEmail || 'Unknown',
      ts: a.createdAt,
    });
  });

  (state.events || []).forEach(e => {
    items.push({
      kind: 'subscription_event',
      icon: '⚡',
      title: subEventLabel(e),
      diff: renderEventDiff(e),
      actor: e.recordedByEmail || 'System',
      ts: e.effectiveAt || e.recordedAt,
    });
  });

  (state.payments || []).forEach(p => {
    items.push({
      kind: 'payment',
      icon: p.type === 'refund' ? '↩' : '💵',
      title: `${p.type === 'refund' ? 'Refund' : 'Payment'} · ${formatMoney(p.amount)} via ${p.method || 'manual'}${p.reference ? ' · ' + p.reference : ''}`,
      diff: '',
      actor: p.recordedByEmail || 'System',
      ts: p.receivedAt || p.recordedAt,
    });
  });

  items.sort((a, b) => tsMs(b.ts) - tsMs(a.ts));
  return items;
}

function renderFeedItem(item) {
  const row = document.createElement('div');
  row.className = 'activity-item';
  row.innerHTML = `
    <div class="activity-icon ${escapeHtml(item.kind)}">${item.icon || '·'}</div>
    <div class="activity-card">
      <div class="activity-desc">${escapeHtml(item.title)}</div>
      ${item.diff ? `<div class="activity-diff">${escapeHtml(item.diff)}</div>` : ''}
      <div class="activity-meta">${escapeHtml(item.actor)} · ${escapeHtml(timeAgo(item.ts))}</div>
    </div>
  `;
  return row;
}

function subEventLabel(e) {
  const map = {
    created:           'Subscription created',
    plan_changed:      'Plan changed',
    addon_added:       'Add-on added',
    addon_removed:     'Add-on removed',
    price_adjusted:    'Price adjusted',
    renewed:           'Renewed',
    cancelled:         'Subscription cancelled',
    cancel_scheduled:  'Cancellation scheduled',
    cancel_undone:     'Cancellation undone',
    paused:            'Paused',
    resumed:           'Resumed',
    reactivated:       'Reactivated',
  };
  const base = map[e.type] || e.type;
  const reason = e.reason ? ` — ${e.reason}` : '';
  const delta = e.mrrDelta ? ` (${e.mrrDelta > 0 ? '+' : ''}${formatMoney(e.mrrDelta)}/mo MRR)` : '';
  return base + reason + delta;
}

function renderEventDiff(e) {
  if (!e.fromState && !e.toState) return '';
  const parts = [];
  if (e.fromState?.packageId !== e.toState?.packageId) {
    parts.push(`plan: ${e.fromState?.packageId || '—'} → ${e.toState?.packageId || '—'}`);
  }
  const fromAddons = (e.fromState?.addOns || []).map(a => a.slug).sort().join(',');
  const toAddons = (e.toState?.addOns || []).map(a => a.slug).sort().join(',');
  if (fromAddons !== toAddons) {
    parts.push(`add-ons: [${fromAddons || '—'}] → [${toAddons || '—'}]`);
  }
  if (e.fromState?.status !== e.toState?.status) {
    parts.push(`status: ${e.fromState?.status || '—'} → ${e.toState?.status || '—'}`);
  }
  return parts.join(' · ');
}

function iconFor(type) {
  return { call: '📞', email: '✉️', meeting: '🤝', note: '📝', edit: '✏️' }[type] || '·';
}

// ── Health score ────────────────────────────────────────────────

function computeHealthScore(invoices, activities, tenantUsers) {
  const overdueAmount = sumOverdue(invoices);
  const overdueInvs = (invoices || []).filter(i => i.status === 'overdue'
    || (i.status === 'sent' && i.dueDate && tsMs(i.dueDate) < Date.now()));
  const worstOverdueMs = overdueInvs.reduce((m, i) => {
    const d = tsMs(i.dueDate);
    return d && d < m ? d : m;
  }, Date.now());
  const daysOverdue = Math.floor((Date.now() - worstOverdueMs) / 86400000);

  const lastActivity = (activities || [])[0];
  const daysSinceActivity = lastActivity ? Math.floor((Date.now() - tsMs(lastActivity.createdAt)) / 86400000) : 9999;

  if (daysOverdue > 30 || daysSinceActivity > 90) {
    return { level: 'critical', label: 'Critical' };
  }
  if (overdueAmount > 0 || daysSinceActivity > 30) {
    return { level: 'warn', label: 'At risk' };
  }
  return { level: 'healthy', label: 'Healthy' };
}

// ── Helpers ─────────────────────────────────────────────────────

export function getCustomerInvoices() {
  return (state.invoices || []).filter(i => i.clientId === state.contact.id);
}

export function statusBadgeClass(s) {
  return s === 'paid' ? 'badge-success'
       : s === 'partial' ? 'badge-info'
       : s === 'sent' ? 'badge-info'
       : s === 'draft' ? 'badge-default'
       : s === 'overdue' ? 'badge-danger'
       : s === 'refunded' ? 'badge-warning'
       : 'badge-default';
}

function tsMs(ts) {
  if (!ts) return 0;
  if (ts.toDate) return ts.toDate().getTime();
  if (ts instanceof Date) return ts.getTime();
  return new Date(ts).getTime() || 0;
}

// Let children reach state and trigger reloads
export function getState() { return state; }
export async function reloadLinked() { await loadLinkedData(); render(); }
