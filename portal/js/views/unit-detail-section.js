// ─────────────────────────────────────────────────────────────────
//  unit-detail-section.js — "Current lease" section on a Unit detail.
//  Shows the active lease (if any), a link to the property, and an
//  "Assign New Lease" action that delegates to the shared modal.
// ─────────────────────────────────────────────────────────────────

import { db } from '../config.js';
import {
  doc, getDoc, updateDoc, collection, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { openAssignLease } from './assign-lease-modal.js';

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
      if (!confirm(`End this lease? The unit will become vacant. Recurring rent billing stays in place — you can pause it from Tenants → Billing.`)) return;
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
      btn.addEventListener('click', () => openAssignLease(unit, env, reload));
      wrap.appendChild(btn);
    }
  }
}

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
