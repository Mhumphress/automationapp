// ─────────────────────────────────────────────────────────────────
//  lease-billing-section.js — Billing section on lease detail page.
//
//  Shows the lease's recurring charges (rent, insurance, parking, HOA,
//  etc.) plus any one-off fees and the invoices they've generated.
//  Lets the operator add a new recurring charge, apply an ad-hoc fee,
//  pause/resume, or regenerate the next invoice immediately.
// ─────────────────────────────────────────────────────────────────

import {
  listCharges, listInvoicesGeneratedFor, createCharge, updateCharge,
  deleteCharge, setChargeStatus, generateOneTimeInvoice, runRecurringSweep,
  FREQUENCIES, CHARGE_TYPES, describeSchedule,
} from '../services/recurring-billing.js';

export function renderLeaseBillingSection(lease, env, { reload }) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div style="color:var(--gray);font-size:0.85rem;">Loading billing…</div>`;
  init(wrap, lease, env, reload);
  return wrap;
}

async function init(wrap, lease, env, reload) {
  const tenantId = env.tenantId;
  const [charges, invoices] = await Promise.all([
    listCharges(tenantId, { parentType: 'lease', parentId: lease.id }),
    listInvoicesGeneratedFor(tenantId, 'lease', lease.id),
  ]);

  wrap.innerHTML = '';

  // Summary strip
  const paidTotal = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (Number(i.total) || 0), 0);
  const openTotal = invoices.filter(i => i.status === 'sent' || i.status === 'overdue' || i.status === 'partial').reduce((s, i) => s + (Number(i.total) || 0), 0);
  const activeRecurring = charges.filter(c => c.status === 'active' && c.frequency !== 'one_time');
  const monthlyRentNormalized = activeRecurring.reduce((s, c) => s + monthlyEquiv(c), 0);

  const summary = document.createElement('div');
  summary.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:0.5rem;margin-bottom:1rem;';
  summary.innerHTML = `
    ${kpi('Active recurring', activeRecurring.length.toString())}
    ${kpi('Monthly (normalized)', fmtMoney(monthlyRentNormalized))}
    ${kpi('Open balance', fmtMoney(openTotal))}
    ${kpi('Paid to date', fmtMoney(paidTotal))}
  `;
  wrap.appendChild(summary);

  // Action buttons
  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.75rem;';
  actions.innerHTML = env.canWrite ? `
    <button class="btn btn-primary btn-sm" data-action="add-charge">+ Add Recurring Charge</button>
    <button class="btn btn-ghost btn-sm" data-action="one-time-fee">+ One-Time Fee</button>
    <button class="btn btn-ghost btn-sm" data-action="seed-rent">Seed Monthly Rent</button>
    <button class="btn btn-ghost btn-sm" data-action="run-now">Generate Due Now</button>
  ` : '';
  wrap.appendChild(actions);

  actions.querySelector('[data-action="add-charge"]')?.addEventListener('click',
    () => openAddChargeModal(lease, env, reload));
  actions.querySelector('[data-action="one-time-fee"]')?.addEventListener('click',
    () => openOneTimeFeeModal(lease, env, reload));
  actions.querySelector('[data-action="seed-rent"]')?.addEventListener('click',
    () => seedRentCharge(lease, env, reload));
  actions.querySelector('[data-action="run-now"]')?.addEventListener('click',
    () => runSweepNow(lease, env, reload));

  // Recurring charges table
  const chargesBox = document.createElement('div');
  chargesBox.className = 'settings-section';
  chargesBox.innerHTML = `<h3 class="section-title">Recurring charges</h3>`;
  if (!charges.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:0.5rem 0;color:var(--gray);font-size:0.85rem;';
    empty.textContent = 'No charges yet. Click "Seed Monthly Rent" for quick setup, or "+ Add Recurring Charge" for custom.';
    chargesBox.appendChild(empty);
  } else {
    const table = document.createElement('table');
    table.className = 'data-table';
    table.innerHTML = `
      <thead><tr>
        <th>Name</th><th>Type</th><th>Amount</th><th>Frequency</th><th>Next Due</th><th>Status</th><th></th>
      </tr></thead>
      <tbody>
        ${charges.map(c => `
          <tr>
            <td>${escapeHtml(c.name)}${c.description ? `<div style="font-size:0.72rem;color:var(--gray);">${escapeHtml(c.description)}</div>` : ''}</td>
            <td>${escapeHtml(formatLabel(c.chargeType))}</td>
            <td style="font-family:var(--font-mono);">${escapeHtml(fmtMoney(c.amount))}</td>
            <td>${escapeHtml(formatLabel(c.frequency))}</td>
            <td>${escapeHtml(fmtDate(c.nextDueDate))}</td>
            <td><span class="badge ${c.status === 'active' ? 'badge-success' : c.status === 'paused' ? 'badge-warning' : 'badge-default'}">${escapeHtml(c.status)}</span></td>
            <td style="text-align:right;white-space:nowrap;">
              ${env.canWrite ? `
                <button class="btn btn-ghost btn-sm" data-charge-id="${escapeHtml(c.id)}" data-action="toggle">${c.status === 'active' ? 'Pause' : 'Resume'}</button>
                <button class="btn btn-ghost btn-sm" data-charge-id="${escapeHtml(c.id)}" data-action="remove" style="color:var(--danger,#dc2626);">Remove</button>
              ` : ''}
            </td>
          </tr>
        `).join('')}
      </tbody>
    `;
    chargesBox.appendChild(table);

    chargesBox.querySelectorAll('[data-action="toggle"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const c = charges.find(x => x.id === btn.dataset.chargeId);
        if (!c) return;
        const next = c.status === 'active' ? 'paused' : 'active';
        await setChargeStatus(tenantId, c.id, next);
        showToast(next === 'paused' ? 'Paused' : 'Resumed', 'success');
        reload();
      });
    });
    chargesBox.querySelectorAll('[data-action="remove"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Remove this recurring charge? Past invoices stay; no future invoices will generate.')) return;
        await deleteCharge(tenantId, btn.dataset.chargeId);
        showToast('Removed', 'success');
        reload();
      });
    });
  }
  wrap.appendChild(chargesBox);

  // Generated invoices
  const invoicesBox = document.createElement('div');
  invoicesBox.className = 'settings-section';
  invoicesBox.innerHTML = `<h3 class="section-title">Invoices generated</h3>`;
  if (!invoices.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:0.5rem 0;color:var(--gray);font-size:0.85rem;';
    empty.textContent = 'No invoices generated yet.';
    invoicesBox.appendChild(empty);
  } else {
    const table = document.createElement('table');
    table.className = 'data-table';
    table.innerHTML = `
      <thead><tr><th>Invoice #</th><th>Issued</th><th>Due</th><th>Amount</th><th>Status</th></tr></thead>
      <tbody>
        ${invoices.map(i => `
          <tr>
            <td style="font-family:var(--font-mono);">${escapeHtml(i.invoiceNumber || '-')}</td>
            <td>${escapeHtml(i.issueDate || '—')}</td>
            <td>${escapeHtml(i.dueDate || '—')}</td>
            <td>${escapeHtml(fmtMoney(i.total))}</td>
            <td><span class="badge ${badgeClassForStatus(i.status)}">${escapeHtml(statusLabel(i.status))}</span></td>
          </tr>
        `).join('')}
      </tbody>
    `;
    invoicesBox.appendChild(table);
  }
  wrap.appendChild(invoicesBox);
}

// ── Action handlers ─────────────────────────────────────────────

async function seedRentCharge(lease, env, reload) {
  if (!lease.monthlyRent || !(lease.monthlyRent > 0)) {
    showToast('Set Monthly Rent on the lease first.', 'error');
    return;
  }
  if (!lease.tenantName) {
    showToast('Lease must have a tenant name.', 'error');
    return;
  }
  try {
    await createCharge(env.tenantId, {
      name: `Rent — ${lease.unit || lease.property || lease.tenantName}`,
      description: 'Monthly rent',
      parentType: 'lease',
      parentId: lease.id,
      customerName: lease.tenantName,
      customerEmail: lease.tenantEmail || '',
      chargeType: 'rent',
      amount: Number(lease.monthlyRent),
      frequency: 'monthly',
      dayOfMonth: 1,
      dueInDays: 5,
      autoGenerate: true,
    });
    showToast('Rent charge seeded — generates on the 1st of each month.', 'success');
    reload();
  } catch (err) {
    console.error(err);
    showToast('Failed: ' + err.message, 'error');
  }
}

async function runSweepNow(lease, env, reload) {
  try {
    const { generated } = await runRecurringSweep(env.tenantId);
    showToast(generated > 0 ? `Generated ${generated} invoice(s)` : 'No charges due right now', 'success');
    reload();
  } catch (err) {
    console.error(err);
    showToast('Sweep failed: ' + err.message, 'error');
  }
}

function openAddChargeModal(lease, env, reload) {
  const backdrop = makeBackdrop('Add Recurring Charge');
  const body = backdrop.querySelector('.modal-body');
  const form = document.createElement('form');
  form.className = 'modal-form';
  form.innerHTML = `
    <div class="modal-field">
      <label>Name *</label>
      <input type="text" name="name" required placeholder="e.g. Rent - Apt 4B">
    </div>
    <div class="modal-form-grid">
      <div class="modal-field">
        <label>Charge Type *</label>
        <select name="chargeType" required>
          ${CHARGE_TYPES.map(t => `<option value="${t}" ${t === 'rent' ? 'selected' : ''}>${formatLabel(t)}</option>`).join('')}
        </select>
      </div>
      <div class="modal-field">
        <label>Amount *</label>
        <input type="number" name="amount" step="0.01" min="0.01" required value="${lease.monthlyRent || ''}">
      </div>
    </div>
    <div class="modal-form-grid">
      <div class="modal-field">
        <label>Frequency *</label>
        <select name="frequency" required>
          ${FREQUENCIES.map(f => `<option value="${f}" ${f === 'monthly' ? 'selected' : ''}>${formatLabel(f)}</option>`).join('')}
        </select>
      </div>
      <div class="modal-field">
        <label>Day of Month (1–31)</label>
        <input type="number" name="dayOfMonth" min="1" max="31" value="1">
      </div>
    </div>
    <div class="modal-form-grid">
      <div class="modal-field">
        <label>Start Date</label>
        <input type="date" name="startDate" value="${new Date().toISOString().slice(0,10)}">
      </div>
      <div class="modal-field">
        <label>End Date (optional)</label>
        <input type="date" name="endDate">
      </div>
    </div>
    <div class="modal-form-grid">
      <div class="modal-field">
        <label>Due in days</label>
        <input type="number" name="dueInDays" min="0" value="5">
      </div>
      <div class="modal-field">
        <label>Auto-generate invoices</label>
        <select name="autoGenerate">
          <option value="true" selected>Yes (recommended)</option>
          <option value="false">No — manual only</option>
        </select>
      </div>
    </div>
    <div class="modal-field">
      <label>Description / notes</label>
      <textarea name="description" rows="2"></textarea>
    </div>
    <div class="modal-actions">
      <button type="submit" class="btn btn-primary btn-lg">Create</button>
      <span class="modal-cancel">Cancel</span>
    </div>
  `;
  body.appendChild(form);
  wireModal(backdrop);
  form.querySelector('.modal-cancel').addEventListener('click', () => backdrop.remove());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await createCharge(env.tenantId, {
        name:          fd.get('name').toString().trim(),
        description:   (fd.get('description') || '').toString().trim(),
        parentType:    'lease',
        parentId:      lease.id,
        customerName:  lease.tenantName || 'Tenant',
        customerEmail: lease.tenantEmail || '',
        chargeType:    fd.get('chargeType').toString(),
        amount:        Number(fd.get('amount')),
        frequency:     fd.get('frequency').toString(),
        dayOfMonth:    Number(fd.get('dayOfMonth')) || null,
        startDate:     fd.get('startDate') ? new Date(fd.get('startDate').toString()) : new Date(),
        endDate:       fd.get('endDate') ? new Date(fd.get('endDate').toString()) : null,
        dueInDays:     Number(fd.get('dueInDays')) || 14,
        autoGenerate:  fd.get('autoGenerate') === 'true',
      });
      showToast('Charge added', 'success');
      backdrop.remove();
      reload();
    } catch (err) {
      console.error(err);
      showToast('Failed: ' + err.message, 'error');
      btn.disabled = false;
    }
  });
}

function openOneTimeFeeModal(lease, env, reload) {
  const backdrop = makeBackdrop('One-Time Fee');
  const body = backdrop.querySelector('.modal-body');
  const form = document.createElement('form');
  form.className = 'modal-form';
  form.innerHTML = `
    <div class="modal-form-grid">
      <div class="modal-field">
        <label>Fee Type *</label>
        <select name="chargeType" required>
          <option value="late_fee">Late Fee</option>
          <option value="policy_violation">Policy Violation</option>
          <option value="maintenance">Maintenance Due</option>
          <option value="pet_fee">Pet Fee</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div class="modal-field">
        <label>Amount *</label>
        <input type="number" name="amount" step="0.01" min="0.01" required>
      </div>
    </div>
    <div class="modal-field">
      <label>Description *</label>
      <input type="text" name="description" required placeholder="e.g. Late rent fee - October 2026">
    </div>
    <div class="modal-form-grid">
      <div class="modal-field">
        <label>Due in days</label>
        <input type="number" name="dueInDays" min="0" value="7">
      </div>
      <div class="modal-field">
        <label>Internal notes</label>
        <input type="text" name="notes">
      </div>
    </div>
    <div class="modal-actions">
      <button type="submit" class="btn btn-primary btn-lg">Create Invoice</button>
      <span class="modal-cancel">Cancel</span>
    </div>
  `;
  body.appendChild(form);
  wireModal(backdrop);
  form.querySelector('.modal-cancel').addEventListener('click', () => backdrop.remove());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const description = fd.get('description').toString().trim();
    const amount = Number(fd.get('amount'));
    const chargeType = fd.get('chargeType').toString();
    const dueInDays = Number(fd.get('dueInDays')) || 0;
    const notes = (fd.get('notes') || '').toString().trim();
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await generateOneTimeInvoice(env.tenantId, {
        customerName: lease.tenantName || 'Tenant',
        customerEmail: lease.tenantEmail || '',
        parentType: 'lease',
        parentId: lease.id,
        chargeType,
        dueInDays,
        notes,
        lineItems: [{
          description,
          quantity: 1,
          rate: amount,
          amount,
        }],
      });
      showToast('Invoice created', 'success');
      backdrop.remove();
      reload();
    } catch (err) {
      console.error(err);
      showToast('Failed: ' + err.message, 'error');
      btn.disabled = false;
    }
  });
}

// ── Tiny utility helpers (local — keep section self-contained) ──

function kpi(label, value) {
  return `
    <div style="padding:0.6rem 0.75rem;background:var(--off-white,#F1F5F9);border-radius:8px;">
      <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--gray-dark,#64748B);">${escapeHtml(label)}</div>
      <div style="font-size:1rem;font-weight:600;font-variant-numeric:tabular-nums;margin-top:0.15rem;">${escapeHtml(value)}</div>
    </div>
  `;
}

function monthlyEquiv(c) {
  const a = Number(c.amount) || 0;
  switch (c.frequency) {
    case 'monthly':  return a;
    case 'annual':   return a / 12;
    case 'quarterly':return a / 3;
    case 'weekly':   return a * 4.33;
    case 'biweekly': return a * 2.17;
    default:         return 0;
  }
}

function fmtMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function fmtDate(v) {
  if (!v) return '—';
  try {
    const d = v.toDate ? v.toDate() : new Date(v);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return '—'; }
}

function formatLabel(s) {
  if (!s) return '';
  return String(s).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function badgeClassForStatus(s) {
  return s === 'paid' ? 'badge-success'
       : s === 'overdue' ? 'badge-danger'
       : s === 'sent' ? 'badge-info'
       : s === 'partial' ? 'badge-info'
       : 'badge-default';
}

function statusLabel(s) {
  return s === 'sent' ? 'due' : (s || 'draft');
}

function escapeHtml(s) {
  if (s == null) return '';
  const n = document.createElement('span');
  n.appendChild(document.createTextNode(String(s)));
  return n.innerHTML;
}

function makeBackdrop(title) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop open';
  backdrop.innerHTML = `
    <div class="modal-dialog">
      <div class="modal-header">
        <h2 class="modal-title">${escapeHtml(title)}</h2>
        <button class="modal-close" type="button">×</button>
      </div>
      <div class="modal-body"></div>
    </div>
  `;
  document.body.appendChild(backdrop);
  return backdrop;
}

function wireModal(backdrop) {
  backdrop.querySelector('.modal-close').addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
}

function showToast(msg, type) {
  const c = document.getElementById('toastContainer');
  if (!c) { alert(msg); return; }
  const t = document.createElement('div');
  t.className = `toast toast-${type || 'info'}`;
  t.textContent = msg;
  c.appendChild(t);
  requestAnimationFrame(() => t.classList.add('toast-visible'));
  setTimeout(() => { t.classList.remove('toast-visible'); setTimeout(() => t.remove(), 400); }, 3000);
}
