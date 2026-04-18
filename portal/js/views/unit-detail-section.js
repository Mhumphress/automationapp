// ─────────────────────────────────────────────────────────────────
//  unit-detail-section.js — "Current lease" section on a Unit detail.
//  Shows the active lease (if any), a link to the property, and an
//  "Assign New Lease" action that creates a lease + auto-starts the
//  monthly rent recurring charge.
// ─────────────────────────────────────────────────────────────────

import { db, auth } from '../config.js';
import {
  doc, getDoc, updateDoc, addDoc, collection, serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { createCharge } from '../services/recurring-billing.js';

export function renderUnitDetailSection(unit, env, ctx) {
  const wrap = document.createElement('div');
  wrap.innerHTML = '<div style="color:var(--gray);padding:0.5rem 0;">Loading…</div>';
  init(wrap, unit, env, ctx);
  return wrap;
}

async function init(wrap, unit, env, { reload }) {
  const tenantId = env.tenantId;
  let currentLease = null;

  if (unit.currentLeaseId) {
    try {
      const snap = await getDoc(doc(db, 'tenants', tenantId, 'leases', unit.currentLeaseId));
      if (snap.exists()) currentLease = { id: snap.id, ...snap.data() };
    } catch {}
  }

  wrap.innerHTML = '';

  // Property link
  if (unit.propertyName) {
    const propLink = document.createElement('div');
    propLink.style.cssText = 'margin-bottom:0.75rem;';
    propLink.innerHTML = `<div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--gray-dark);">Property</div>
      <div style="font-size:0.95rem;font-weight:500;">${escapeHtml(unit.propertyName)}</div>`;
    wrap.appendChild(propLink);
  }

  if (currentLease) {
    const leaseCard = document.createElement('div');
    leaseCard.style.cssText = 'padding:1rem;background:var(--off-white,#F1F5F9);border-radius:10px;';
    leaseCard.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap;">
        <div>
          <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--gray-dark);">Tenant</div>
          <div style="font-size:1.05rem;font-weight:600;">${escapeHtml(currentLease.tenantName || '—')}</div>
          ${currentLease.tenantEmail ? `<div style="font-size:0.85rem;color:var(--gray-dark);">${escapeHtml(currentLease.tenantEmail)}</div>` : ''}
          ${currentLease.tenantPhone ? `<div style="font-size:0.85rem;color:var(--gray-dark);">${escapeHtml(currentLease.tenantPhone)}</div>` : ''}
        </div>
        <div style="text-align:right;">
          <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--gray-dark);">Monthly rent</div>
          <div style="font-size:1.2rem;font-weight:600;font-variant-numeric:tabular-nums;">${fmtMoney(currentLease.monthlyRent)}</div>
        </div>
      </div>
      <div style="display:flex;gap:1.5rem;margin-top:0.75rem;font-size:0.85rem;">
        <div><span style="color:var(--gray-dark);">Starts</span> ${fmtDate(currentLease.startDate)}</div>
        <div><span style="color:var(--gray-dark);">Ends</span> ${fmtDate(currentLease.endDate)}</div>
        <div><span style="color:var(--gray-dark);">Status</span> <span class="badge ${badgeFor(currentLease.status)}">${escapeHtml(currentLease.status || 'pending')}</span></div>
      </div>
      ${env.canWrite ? `
        <div style="display:flex;gap:0.5rem;margin-top:0.75rem;">
          <button class="btn btn-ghost btn-sm" data-action="end-lease" style="color:var(--danger,#dc2626);">End Lease</button>
        </div>
      ` : ''}
    `;
    wrap.appendChild(leaseCard);

    leaseCard.querySelector('[data-action="end-lease"]')?.addEventListener('click', async () => {
      if (!confirm(`End this lease? The unit will become vacant. Recurring rent billing stays in place — you can pause it from Leases → Billing.`)) return;
      try {
        await updateDoc(doc(db, 'tenants', tenantId, 'leases', currentLease.id), {
          status: 'terminated',
          endedAt: serverTimestamp(),
        });
        await updateDoc(doc(db, 'tenants', tenantId, 'units', unit.id), {
          status: 'vacant',
          currentLeaseId: null,
          currentTenantName: '',
          updatedAt: serverTimestamp(),
        });
        toast('Lease ended — unit marked vacant', 'success');
        if (reload) reload();
      } catch (err) {
        console.error(err);
        toast('Failed: ' + err.message, 'error');
      }
    });
  } else {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:1rem;background:var(--off-white,#F1F5F9);border-radius:10px;color:var(--gray-dark);font-size:0.9rem;';
    empty.textContent = unit.status === 'occupied'
      ? 'This unit is marked Occupied but has no linked lease. Assign one below.'
      : 'Vacant — no active lease.';
    wrap.appendChild(empty);

    if (env.canWrite) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-primary btn-sm';
      btn.style.marginTop = '0.75rem';
      btn.textContent = 'Assign New Lease';
      btn.addEventListener('click', () => openAssignLeaseModal(unit, env, reload));
      wrap.appendChild(btn);
    }
  }
}

function openAssignLeaseModal(unit, env, reload) {
  const backdrop = makeBackdrop(`Assign Lease — ${unit.label || 'Unit'}`);
  const body = backdrop.querySelector('.modal-body');
  const form = document.createElement('form');
  form.className = 'modal-form';
  const today = new Date().toISOString().slice(0, 10);
  const oneYear = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
  form.innerHTML = `
    <div class="modal-form-grid">
      <div class="modal-field">
        <label>Tenant Name *</label>
        <input type="text" name="tenantName" required>
      </div>
      <div class="modal-field">
        <label>Tenant Email</label>
        <input type="email" name="tenantEmail">
      </div>
    </div>
    <div class="modal-form-grid">
      <div class="modal-field">
        <label>Tenant Phone</label>
        <input type="tel" name="tenantPhone">
      </div>
      <div class="modal-field">
        <label>Monthly Rent *</label>
        <input type="number" name="monthlyRent" step="0.01" min="0" required value="${unit.baseRent || ''}">
      </div>
    </div>
    <div class="modal-form-grid">
      <div class="modal-field">
        <label>Start Date *</label>
        <input type="date" name="startDate" required value="${today}">
      </div>
      <div class="modal-field">
        <label>End Date *</label>
        <input type="date" name="endDate" required value="${oneYear}">
      </div>
    </div>
    <div class="modal-form-grid">
      <div class="modal-field">
        <label>Security Deposit</label>
        <input type="number" name="deposit" step="0.01" min="0" value="${unit.securityDeposit || ''}">
      </div>
      <div class="modal-field">
        <label>Auto-bill monthly rent?</label>
        <select name="autoBill">
          <option value="yes" selected>Yes — billed on the 1st of each month</option>
          <option value="no">No — bill manually</option>
        </select>
      </div>
    </div>
    <div class="modal-field">
      <label>Notes</label>
      <textarea name="notes" rows="2"></textarea>
    </div>
    <div class="modal-actions">
      <button type="submit" class="btn btn-primary btn-lg">Create Lease</button>
      <span class="modal-cancel">Cancel</span>
    </div>
  `;
  body.appendChild(form);
  wireModalClose(backdrop);
  form.querySelector('.modal-cancel').addEventListener('click', () => backdrop.remove());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const tenantName = fd.get('tenantName').toString().trim();
    const tenantEmail = (fd.get('tenantEmail') || '').toString().trim();
    const tenantPhone = (fd.get('tenantPhone') || '').toString().trim();
    const monthlyRent = Number(fd.get('monthlyRent')) || 0;
    const startDate = fd.get('startDate') ? new Date(fd.get('startDate').toString()) : new Date();
    const endDate = fd.get('endDate') ? new Date(fd.get('endDate').toString()) : null;
    const deposit = Number(fd.get('deposit')) || 0;
    const autoBill = fd.get('autoBill') === 'yes';
    const notes = (fd.get('notes') || '').toString().trim();

    if (!tenantName || !(monthlyRent > 0)) {
      toast('Name and rent amount are required.', 'error');
      return;
    }

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;

    try {
      const user = auth.currentUser;
      // 1. Create lease
      const leaseRef = await addDoc(collection(db, 'tenants', env.tenantId, 'leases'), {
        tenantName,
        tenantEmail,
        tenantPhone,
        property: unit.propertyName,
        propertyId: unit.propertyId,
        unit: unit.label,
        unitId: unit.id,
        startDate: Timestamp.fromDate(startDate),
        endDate: endDate ? Timestamp.fromDate(endDate) : null,
        monthlyRent,
        deposit,
        status: 'active',
        notes,
        autoBill,
        createdAt: serverTimestamp(),
        createdBy: user ? user.uid : null,
        createdByEmail: user ? user.email || '' : '',
      });

      // 2. Update unit occupancy
      await updateDoc(doc(db, 'tenants', env.tenantId, 'units', unit.id), {
        status: 'occupied',
        currentLeaseId: leaseRef.id,
        currentTenantName: tenantName,
        updatedAt: serverTimestamp(),
      });

      // 3. If auto-bill, create the recurring charge
      if (autoBill) {
        try {
          await createCharge(env.tenantId, {
            name: `Rent — ${unit.label}`,
            description: `Monthly rent for ${unit.propertyName} ${unit.label}`,
            parentType: 'lease',
            parentId: leaseRef.id,
            customerName: tenantName,
            customerEmail: tenantEmail,
            chargeType: 'rent',
            amount: monthlyRent,
            frequency: 'monthly',
            dayOfMonth: 1,
            dueInDays: 5,
            startDate,
            endDate,
            autoGenerate: true,
          });
        } catch (err) {
          console.warn('Auto-create rent charge failed (lease still saved):', err);
        }
      }

      toast(autoBill ? 'Lease created — monthly rent billing scheduled' : 'Lease created', 'success');
      backdrop.remove();
      if (reload) reload();
    } catch (err) {
      console.error(err);
      toast('Failed: ' + err.message, 'error');
      btn.disabled = false;
    }
  });
}

// ── Utilities ───────────────────────────────────────────────────

function badgeFor(s) {
  return s === 'active' ? 'badge-success'
       : s === 'pending' ? 'badge-info'
       : s === 'expired' ? 'badge-warning'
       : s === 'terminated' ? 'badge-danger'
       : 'badge-default';
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

function wireModalClose(backdrop) {
  backdrop.querySelector('.modal-close').addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
}

function toast(msg, type) {
  const c = document.getElementById('toastContainer');
  if (!c) { alert(msg); return; }
  const t = document.createElement('div');
  t.className = `toast toast-${type || 'info'}`;
  t.textContent = msg;
  c.appendChild(t);
  requestAnimationFrame(() => t.classList.add('toast-visible'));
  setTimeout(() => { t.classList.remove('toast-visible'); setTimeout(() => t.remove(), 400); }, 3000);
}
