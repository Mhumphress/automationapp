// ─────────────────────────────────────────────────────────────────
//  tenant-profile-header.js — "At-a-glance" header on each Lease /
//  Tenant detail page. Avatar + contact info + quick actions (call,
//  email, message, record payment, end lease, renew), plus a live
//  KPI strip showing unit, rent, payment status.
// ─────────────────────────────────────────────────────────────────

import { db, auth } from '../config.js';
import {
  collection, onSnapshot, updateDoc, doc, addDoc, getDoc, query, where, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getTenant, getTenantId } from '../tenant-context.js';
import { openRecordPayment } from './shared/record-payment-modal.js';

export function renderTenantProfileHeader(lease, env, ctx) {
  const wrap = document.createElement('div');
  wrap.innerHTML = '<div style="color:var(--gray);padding:0.5rem 0;">Loading tenant profile…</div>';
  init(wrap, lease, env, ctx);
  return wrap;
}

async function init(wrap, lease, env, { reload }) {
  const tenantId = env.tenantId;

  // Subscribe to invoices + payments for this lease so status stays fresh.
  let invoices = [];
  let payments = [];
  let unit = null;

  // Load unit info once for bedrooms/sqft display
  if (lease.unitId) {
    try {
      const snap = await getDoc(doc(db, 'tenants', tenantId, 'units', lease.unitId));
      if (snap.exists()) unit = { id: snap.id, ...snap.data() };
    } catch {}
  }

  const draw = () => {
    renderHeader(wrap, lease, unit, invoices, payments, env, reload);
  };

  // Live subscriptions
  try {
    onSnapshot(
      query(collection(db, 'tenants', tenantId, 'invoices_crm'), where('source.parentId', '==', lease.id)),
      (snap) => { invoices = snap.docs.map(d => ({ id: d.id, ...d.data() })); draw(); },
      (err) => { console.warn('tenant invoices sub error:', err); draw(); }
    );
  } catch (err) {
    // Fallback — filter client-side if the query fails (e.g. no index)
    try {
      onSnapshot(
        collection(db, 'tenants', tenantId, 'invoices_crm'),
        (snap) => {
          invoices = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(i => i.source?.parentId === lease.id);
          draw();
        },
        (err) => console.warn('tenant invoices fallback sub error:', err)
      );
    } catch {}
  }
  try {
    onSnapshot(
      collection(db, 'tenants', tenantId, 'payments'),
      (snap) => {
        payments = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(p => (p.appliedTo || []).some(a => invoices.some(inv => inv.id === a.invoiceId)));
        draw();
      },
      (err) => console.warn('tenant payments sub error:', err)
    );
  } catch {}

  draw();
}

function renderHeader(wrap, lease, unit, invoices, payments, env, reload) {
  const openInvoices = invoices.filter(i => ['sent', 'overdue', 'partial', 'issued'].includes(i.status));
  const openBalance = openInvoices.reduce((s, i) => {
    const total = Math.abs(Number(i.total || i.amount || 0));
    const paid = Number(i.paidAmount || 0);
    return s + Math.max(0, total - paid);
  }, 0);
  const overdue = invoices.some(i => i.status === 'overdue' || (i.status === 'sent' && i.dueDate && new Date(i.dueDate).getTime() < Date.now()));

  const totalPaid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (Number(i.total) || 0), 0);
  const last = invoices
    .filter(i => i.status === 'paid')
    .sort((a, b) => new Date(b.issueDate || 0) - new Date(a.issueDate || 0))[0];

  const initials = (lease.tenantName || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0] || '').join('').toUpperCase();
  const leaseEnd = fmtDate(lease.endDate);
  const daysLeft = lease.endDate ? Math.round((new Date(lease.endDate).getTime() - Date.now()) / 86400000) : null;
  const expiringSoon = daysLeft != null && daysLeft < 60 && daysLeft > 0;
  const expired = daysLeft != null && daysLeft <= 0;

  wrap.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'tenant-profile-header';
  header.innerHTML = `
    <div class="tph-top">
      <div class="tph-avatar">${escapeHtml(initials || '?')}</div>
      <div class="tph-id">
        <div class="tph-name">${escapeHtml(lease.tenantName || '(unnamed)')}</div>
        <div class="tph-contact">
          ${lease.tenantEmail ? `<a href="mailto:${escapeAttr(lease.tenantEmail)}">${escapeHtml(lease.tenantEmail)}</a>` : ''}
          ${lease.tenantEmail && lease.tenantPhone ? ' · ' : ''}
          ${lease.tenantPhone ? `<a href="tel:${escapeAttr(lease.tenantPhone.replace(/[^\d+]/g, ''))}">${escapeHtml(lease.tenantPhone)}</a>` : ''}
        </div>
        <div class="tph-badges">
          <span class="badge ${badgeForStatus(lease.status)}">${escapeHtml((lease.status || 'pending').toUpperCase())}</span>
          ${expired ? `<span class="badge badge-danger">LEASE EXPIRED</span>` :
            expiringSoon ? `<span class="badge badge-warning">Ends in ${daysLeft}d</span>` : ''}
          ${overdue ? `<span class="badge badge-danger">OVERDUE BALANCE</span>` : ''}
        </div>
      </div>
      <div class="tph-actions">
        ${lease.tenantPhone ? `<a href="tel:${escapeAttr(lease.tenantPhone.replace(/[^\d+]/g, ''))}" class="btn btn-ghost btn-sm">Call</a>` : ''}
        ${lease.tenantEmail ? `<a href="mailto:${escapeAttr(lease.tenantEmail)}" class="btn btn-ghost btn-sm">Email</a>` : ''}
        ${openBalance > 0 && env.canWrite ? `<button class="btn btn-primary btn-sm" data-action="record-pay">Record Payment</button>` : ''}
        ${env.canWrite && lease.status === 'active' ? `<button class="btn btn-ghost btn-sm" data-action="renew">Renew</button>` : ''}
        ${env.canWrite && lease.status !== 'terminated' ? `<button class="btn btn-ghost btn-sm" data-action="end-lease" style="color:var(--danger,#dc2626);">End Lease</button>` : ''}
      </div>
    </div>
    <div class="tph-kpis">
      ${kpi('Property / Unit', `${escapeHtml(lease.property || '—')} · ${escapeHtml(lease.unit || '—')}`)}
      ${kpi('Monthly Rent', fmtMoney(lease.monthlyRent))}
      ${kpi('Lease Ends', leaseEnd + (daysLeft != null && daysLeft >= 0 ? ` <span style="font-size:0.72rem;color:var(--gray-dark);">(${daysLeft}d)</span>` : ''))}
      ${kpi('Open Balance', fmtMoney(openBalance), openBalance > 0 ? (overdue ? '#dc2626' : '#d97706') : '')}
      ${kpi('Paid to date', fmtMoney(totalPaid), '#059669')}
      ${kpi('Last Payment', last ? `${fmtMoney(last.total)} · ${fmtDate(last.issueDate)}` : '—')}
      ${unit && unit.sqft ? kpi('Unit Sq Ft', String(unit.sqft)) : ''}
      ${unit && (unit.bedrooms || unit.bathrooms) ? kpi('BR / BA', `${unit.bedrooms || 0} / ${unit.bathrooms || 0}`) : ''}
    </div>
  `;
  wrap.appendChild(header);

  header.querySelector('[data-action="record-pay"]')?.addEventListener('click', async () => {
    const result = await openRecordPayment({
      invoices: openInvoices,
      presetInvoiceId: openInvoices[0]?.id || null,
      title: `Record Payment from ${lease.tenantName}`,
    });
    if (result?.recorded && reload) reload();
  });

  header.querySelector('[data-action="end-lease"]')?.addEventListener('click', async () => {
    if (!confirm(`End lease for ${lease.tenantName}? The unit will flip to vacant. Recurring rent stops billing automatically.`)) return;
    try {
      await updateDoc(doc(db, 'tenants', env.tenantId, 'leases', lease.id), {
        status: 'terminated',
        endedAt: serverTimestamp(),
      });
      if (lease.unitId) {
        try {
          await updateDoc(doc(db, 'tenants', env.tenantId, 'units', lease.unitId), {
            status: 'vacant',
            currentLeaseId: null,
            currentTenantName: '',
            currentTenantEmail: '',
            currentTenantPhone: '',
            updatedAt: serverTimestamp(),
          });
        } catch (err) { console.warn('Unit occupancy update failed:', err); }
      }
      // Pause any active recurring rent charges for this lease
      try {
        const chargesSnap = await (await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js')).getDocs(
          query(collection(db, 'tenants', env.tenantId, 'recurring_charges'), where('parentId', '==', lease.id))
        );
        for (const c of chargesSnap.docs) {
          if (c.data().status === 'active') {
            try { await updateDoc(c.ref, { status: 'cancelled' }); } catch {}
          }
        }
      } catch (err) { console.warn('Could not cancel rent charges:', err); }
      toast('Lease ended · unit vacant · rent charges cancelled', 'success');
      if (reload) reload();
    } catch (err) {
      console.error(err);
      toast('Failed: ' + err.message, 'error');
    }
  });

  header.querySelector('[data-action="renew"]')?.addEventListener('click', () => {
    openRenewModal(lease, env, reload);
  });
}

function openRenewModal(lease, env, reload) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop open';
  const currentEnd = lease.endDate ? new Date(lease.endDate) : new Date();
  const newEnd = new Date(currentEnd.getTime() + 365 * 86400000);
  backdrop.innerHTML = `
    <div class="modal-dialog">
      <div class="modal-header">
        <h2 class="modal-title">Renew Lease — ${escapeHtml(lease.tenantName)}</h2>
        <button class="modal-close" type="button">×</button>
      </div>
      <div class="modal-body">
        <form class="modal-form">
          <div class="modal-form-grid">
            <div class="modal-field">
              <label>New end date</label>
              <input type="date" name="endDate" required value="${newEnd.toISOString().slice(0,10)}">
            </div>
            <div class="modal-field">
              <label>New monthly rent</label>
              <input type="number" name="monthlyRent" step="0.01" min="0" required value="${lease.monthlyRent || ''}">
            </div>
          </div>
          <div class="modal-actions">
            <button type="submit" class="btn btn-primary btn-lg">Renew</button>
            <span class="modal-cancel">Cancel</span>
          </div>
        </form>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector('.modal-close').addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector('.modal-cancel').addEventListener('click', close);

  backdrop.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const newEndDate = new Date(fd.get('endDate').toString());
    const newRent = Number(fd.get('monthlyRent')) || 0;
    try {
      const { Timestamp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
      await updateDoc(doc(db, 'tenants', env.tenantId, 'leases', lease.id), {
        endDate: Timestamp.fromDate(newEndDate),
        monthlyRent: newRent,
        renewedAt: serverTimestamp(),
      });
      // Update recurring charge amount if it changed
      if (newRent !== lease.monthlyRent) {
        try {
          const chargesSnap = await (await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js')).getDocs(
            query(collection(db, 'tenants', env.tenantId, 'recurring_charges'), where('parentId', '==', lease.id))
          );
          for (const c of chargesSnap.docs) {
            if (c.data().status === 'active' && c.data().chargeType === 'rent') {
              await updateDoc(c.ref, { amount: newRent, endDate: Timestamp.fromDate(newEndDate) });
            }
          }
        } catch {}
      }
      toast('Lease renewed', 'success');
      close();
      if (reload) reload();
    } catch (err) {
      console.error(err);
      toast('Failed: ' + err.message, 'error');
    }
  });
}

function kpi(label, value, color) {
  return `
    <div class="tph-kpi">
      <div class="tph-kpi-label">${label}</div>
      <div class="tph-kpi-value"${color ? ` style="color:${color};"` : ''}>${value}</div>
    </div>
  `;
}

function badgeForStatus(s) {
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

function escapeAttr(s) { return String(s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

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
