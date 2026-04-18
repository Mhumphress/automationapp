// ─────────────────────────────────────────────────────────────────
//  customer-detail-subscription.js — Subscription tab.
//  Current plan, add-ons, full timeline from subscription_events,
//  MRR sparkline. Re-uses subscription.js for actions.
// ─────────────────────────────────────────────────────────────────

import { escapeHtml, formatDate, timeAgo } from '../ui.js';
import { formatMoney, computeMRR, computeARR, nextRenewalDate, daysUntil } from '../services/money.js';
import { listEventsForTenant } from '../services/subscription-events.js';
import { downloadCSV, formatTimestamp, formatMoney as csvMoney } from '../utils/csv.js';

export function renderSubscriptionTab(body, state, rerender) {
  if (!state.tenant) {
    body.innerHTML = `
      <div class="empty-state">
        <div class="empty-title">No subscription</div>
        <p class="empty-description">This customer doesn't have a linked tenant yet. Create a quote to provision one.</p>
      </div>
    `;
    return;
  }

  // Top strip — current plan summary
  const planCard = document.createElement('div');
  planCard.className = 'settings-section';
  planCard.innerHTML = renderPlanCardHTML(state.tenant);
  body.appendChild(planCard);

  // Add-ons table
  const addonsWrap = document.createElement('div');
  addonsWrap.className = 'settings-section';
  addonsWrap.innerHTML = renderAddOnsHTML(state.tenant);
  body.appendChild(addonsWrap);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'subscription-actions';
  actions.innerHTML = `
    <button class="btn btn-primary btn-sm" data-action="change-plan">Change Plan</button>
    <button class="btn btn-ghost btn-sm" data-action="add-addon">+ Add Add-on</button>
    <button class="btn btn-ghost btn-sm" data-action="cancel">Cancel Subscription</button>
    <button class="btn btn-ghost btn-sm" data-action="export-events">Export timeline</button>
  `;
  body.appendChild(actions);

  actions.querySelector('[data-action="change-plan"]').addEventListener('click', () => notImplementedYet('Change Plan — use the Tenants page for now'));
  actions.querySelector('[data-action="add-addon"]').addEventListener('click', () => notImplementedYet('Add-on — use the Tenants page for now'));
  actions.querySelector('[data-action="cancel"]').addEventListener('click', () => notImplementedYet('Cancel — use the Tenants page for now'));
  actions.querySelector('[data-action="export-events"]').addEventListener('click', () => exportEvents(state));

  // Timeline
  const timelineWrap = document.createElement('div');
  timelineWrap.className = 'settings-section';
  timelineWrap.innerHTML = `<h3 class="section-title">Subscription timeline</h3>`;
  const timeline = document.createElement('div');
  timeline.className = 'detail-timeline';
  timelineWrap.appendChild(timeline);
  body.appendChild(timelineWrap);
  renderTimeline(timeline, state.events);
}

function renderPlanCardHTML(tenant) {
  const mrr = computeMRR(tenant);
  const arr = computeARR(tenant);
  const renewal = nextRenewalDate(tenant);
  const days = renewal ? daysUntil(renewal) : null;
  const renewalText = renewal
    ? `${formatDate(renewal)} (${days > 0 ? `in ${days}d` : days === 0 ? 'today' : `${Math.abs(days)}d ago`})`
    : '—';
  return `
    <h3 class="section-title">Current plan</h3>
    <div class="sub-plan-grid">
      <div class="sub-plan-field">
        <span class="sub-plan-label">Package</span>
        <span class="sub-plan-value">${escapeHtml(tenant.packageId || '—')}</span>
      </div>
      <div class="sub-plan-field">
        <span class="sub-plan-label">Tier</span>
        <span class="sub-plan-value">${escapeHtml(tenant.tier || '—')}</span>
      </div>
      <div class="sub-plan-field">
        <span class="sub-plan-label">Billing cycle</span>
        <span class="sub-plan-value">${escapeHtml(tenant.billingCycle || 'monthly')}</span>
      </div>
      <div class="sub-plan-field">
        <span class="sub-plan-label">MRR</span>
        <span class="sub-plan-value">${escapeHtml(formatMoney(mrr))}</span>
      </div>
      <div class="sub-plan-field">
        <span class="sub-plan-label">ARR</span>
        <span class="sub-plan-value">${escapeHtml(formatMoney(arr))}</span>
      </div>
      <div class="sub-plan-field">
        <span class="sub-plan-label">Next renewal</span>
        <span class="sub-plan-value">${renewalText}</span>
      </div>
    </div>
  `;
}

function renderAddOnsHTML(tenant) {
  const addOns = Array.isArray(tenant.addOns) ? tenant.addOns : [];
  if (!addOns.length) {
    return `<h3 class="section-title">Add-ons</h3>
      <div style="color:var(--gray);font-size:0.85rem;padding:0.5rem 0;">None.</div>`;
  }
  return `
    <h3 class="section-title">Add-ons (${addOns.length})</h3>
    <table class="data-table">
      <thead><tr><th>Name</th><th>Qty</th><th>Monthly price</th></tr></thead>
      <tbody>
        ${addOns.map(a => `
          <tr>
            <td>${escapeHtml(a.name || a.slug || '—')}</td>
            <td>${escapeHtml(String(a.qty || 1))}</td>
            <td>${escapeHtml(formatMoney((a.priceMonthly || 0) * (a.qty || 1)))}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderTimeline(container, events) {
  if (!events || !events.length) {
    container.innerHTML = '<div style="text-align:center;color:var(--gray);padding:2rem 0;font-size:0.85rem;">No subscription events yet.</div>';
    return;
  }

  const typeLabels = {
    created: 'Subscription created',
    plan_changed: 'Plan changed',
    addon_added: 'Add-on added',
    addon_removed: 'Add-on removed',
    price_adjusted: 'Price adjusted',
    renewed: 'Renewed',
    cancelled: 'Subscription cancelled',
    cancel_scheduled: 'Cancellation scheduled',
    cancel_undone: 'Cancellation undone',
    paused: 'Paused',
    resumed: 'Resumed',
    reactivated: 'Reactivated',
  };

  container.innerHTML = events.map(e => {
    const label = typeLabels[e.type] || e.type;
    const mrr = e.mrrDelta ? ` (${e.mrrDelta > 0 ? '+' : ''}${formatMoney(e.mrrDelta)}/mo)` : '';
    const diff = renderEventDiff(e);
    return `
      <div class="activity-item">
        <div class="activity-icon subscription_event">⚡</div>
        <div class="activity-card">
          <div class="activity-desc"><strong>${escapeHtml(label)}</strong>${escapeHtml(mrr)}</div>
          ${e.reason ? `<div class="activity-diff">${escapeHtml(e.reason)}</div>` : ''}
          ${diff ? `<div class="activity-diff">${escapeHtml(diff)}</div>` : ''}
          <div class="activity-meta">${escapeHtml(e.recordedByEmail || 'System')} · ${escapeHtml(timeAgo(e.effectiveAt || e.recordedAt))}</div>
        </div>
      </div>
    `;
  }).join('');
}

function renderEventDiff(e) {
  if (!e.fromState && !e.toState) return '';
  const parts = [];
  if ((e.fromState?.packageId) !== (e.toState?.packageId)) {
    parts.push(`plan: ${e.fromState?.packageId || '—'} → ${e.toState?.packageId || '—'}`);
  }
  const from = (e.fromState?.addOns || []).map(a => a.slug).sort().join(',');
  const to = (e.toState?.addOns || []).map(a => a.slug).sort().join(',');
  if (from !== to) parts.push(`add-ons: [${from || '—'}] → [${to || '—'}]`);
  if ((e.fromState?.status) !== (e.toState?.status)) {
    parts.push(`status: ${e.fromState?.status || '—'} → ${e.toState?.status || '—'}`);
  }
  return parts.join(' · ');
}

function notImplementedYet(msg) {
  import('../ui.js').then(m => m.showToast(msg, 'info'));
}

function exportEvents(state) {
  const tenant = state.tenant;
  const events = state.events || [];
  const filename = `subscription-events-${tenant.companyName || tenant.id}-${new Date().toISOString().slice(0,10)}.csv`;
  downloadCSV(filename, events, [
    { key: 'type',           label: 'Type' },
    { key: 'effectiveAt',    label: 'Effective at', format: formatTimestamp },
    { key: 'mrrDelta',       label: 'MRR delta',    format: csvMoney },
    { key: 'arrDelta',       label: 'ARR delta',    format: csvMoney },
    { key: 'reason',         label: 'Reason' },
    { key: 'invoiceId',      label: 'Invoice' },
    { key: 'recordedByEmail', label: 'Recorded by' },
  ]);
}
