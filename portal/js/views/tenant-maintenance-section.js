// ─────────────────────────────────────────────────────────────────
//  tenant-maintenance-section.js — maintenance requests linked to
//  this tenant's unit. Live-subscribed; lets the operator create
//  a new maintenance request pre-filled with this tenant's property,
//  unit, and contact info.
// ─────────────────────────────────────────────────────────────────

import { db, auth } from '../config.js';
import {
  collection, onSnapshot, addDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

export function renderTenantMaintenanceSection(lease, env, ctx) {
  const wrap = document.createElement('div');
  wrap.innerHTML = '<div style="color:var(--gray);padding:0.5rem 0;">Loading maintenance…</div>';
  init(wrap, lease, env, ctx);
  return wrap;
}

function init(wrap, lease, env, { reload }) {
  const tenantId = env.tenantId;
  let maintenanceCache = [];

  try {
    onSnapshot(
      collection(db, 'tenants', tenantId, 'maintenance'),
      (snap) => {
        maintenanceCache = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(m => {
            // Match by unitId (most reliable) or by property + unit label
            if (lease.unitId && m.unit === lease.unit && m.property === lease.property) return true;
            if (m.property === lease.property && m.unit === lease.unit) return true;
            if (m.tenantName && lease.tenantName && m.tenantName === lease.tenantName) return true;
            return false;
          });
        draw();
      },
      (err) => {
        wrap.innerHTML = `<div style="color:var(--danger);padding:0.5rem;">Can't load maintenance: ${escapeHtml(err.code || err.message)}</div>`;
      }
    );
  } catch (err) {
    wrap.innerHTML = `<div style="color:var(--danger);padding:0.5rem;">Error: ${escapeHtml(err.message)}</div>`;
  }

  function draw() {
    wrap.innerHTML = '';
    const open = maintenanceCache.filter(m => !['completed', 'cancelled'].includes(m.status));
    const completed = maintenanceCache.filter(m => m.status === 'completed');

    if (env.canWrite) {
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:0.5rem;margin-bottom:0.75rem;';
      actions.innerHTML = `<button class="btn btn-primary btn-sm" data-action="new-maintenance">+ New Maintenance Request</button>`;
      actions.querySelector('[data-action="new-maintenance"]').addEventListener('click', () => openNewMaintenance(lease, env, reload));
      wrap.appendChild(actions);
    }

    if (maintenanceCache.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:var(--gray);padding:0.5rem 0;font-size:0.85rem;';
      empty.textContent = 'No maintenance requests for this unit.';
      wrap.appendChild(empty);
      return;
    }

    const section = document.createElement('div');
    section.innerHTML = `
      <div style="display:flex;gap:1rem;margin-bottom:0.5rem;font-size:0.85rem;">
        <span><strong>${open.length}</strong> open</span>
        <span><strong>${completed.length}</strong> completed</span>
      </div>
      <table class="data-table">
        <thead><tr><th>Issue</th><th>Priority</th><th>Scheduled</th><th>Cost</th><th>Status</th></tr></thead>
        <tbody>
          ${maintenanceCache.slice(0, 20).map(m => `
            <tr>
              <td style="font-weight:500;">${escapeHtml(m.issue || '—')}</td>
              <td><span class="badge ${priorityBadge(m.priority)}">${escapeHtml(m.priority || 'medium')}</span></td>
              <td>${fmtDate(m.scheduledAt)}</td>
              <td>${m.cost ? fmtMoney(m.cost) : '<span style="color:var(--gray);">—</span>'}</td>
              <td><span class="badge ${statusBadge(m.status)}">${escapeHtml(m.status || 'open')}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    wrap.appendChild(section);
  }
}

function openNewMaintenance(lease, env, reload) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop open';
  backdrop.innerHTML = `
    <div class="modal-dialog">
      <div class="modal-header">
        <h2 class="modal-title">New Maintenance Request</h2>
        <button class="modal-close" type="button">×</button>
      </div>
      <div class="modal-body">
        <form class="modal-form">
          <div class="modal-field">
            <label>Issue *</label>
            <input type="text" name="issue" required placeholder="Brief description of the problem">
          </div>
          <div class="modal-field">
            <label>Details</label>
            <textarea name="notes" rows="3"></textarea>
          </div>
          <div class="modal-form-grid">
            <div class="modal-field">
              <label>Priority</label>
              <select name="priority">
                <option value="low">Low</option>
                <option value="medium" selected>Medium</option>
                <option value="high">High</option>
                <option value="emergency">Emergency</option>
              </select>
            </div>
            <div class="modal-field">
              <label>Billable to tenant?</label>
              <select name="billable">
                <option value="no" selected>No</option>
                <option value="yes">Yes</option>
              </select>
            </div>
          </div>
          <div class="modal-form-grid">
            <div class="modal-field">
              <label>Assigned to</label>
              <input type="text" name="assignedTo" placeholder="Vendor or tech name">
            </div>
            <div class="modal-field">
              <label>Scheduled</label>
              <input type="datetime-local" name="scheduledAt">
            </div>
          </div>
          <div style="padding:0.5rem;background:var(--off-white);border-radius:6px;font-size:0.8rem;color:var(--gray-dark);margin-bottom:0.5rem;">
            Auto-linked to <strong>${escapeHtml(lease.property || '')} · ${escapeHtml(lease.unit || '')}</strong> and <strong>${escapeHtml(lease.tenantName || '')}</strong>.
          </div>
          <div class="modal-actions">
            <button type="submit" class="btn btn-primary btn-lg">Create</button>
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
    const data = {
      issue: (fd.get('issue') || '').toString().trim(),
      notes: (fd.get('notes') || '').toString().trim(),
      priority: fd.get('priority') || 'medium',
      billable: fd.get('billable') || 'no',
      assignedTo: (fd.get('assignedTo') || '').toString().trim(),
      property: lease.property || '',
      unit: lease.unit || '',
      tenantName: lease.tenantName || '',
      tenantEmail: lease.tenantEmail || '',
      status: 'open',
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser?.uid || null,
    };
    const scheduledRaw = fd.get('scheduledAt');
    if (scheduledRaw) {
      const { Timestamp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
      data.scheduledAt = Timestamp.fromDate(new Date(scheduledRaw.toString()));
    }
    try {
      await addDoc(collection(db, 'tenants', env.tenantId, 'maintenance'), data);
      toast('Maintenance request created', 'success');
      close();
    } catch (err) {
      console.error(err);
      toast('Failed: ' + err.message, 'error');
    }
  });
}

function priorityBadge(p) {
  return p === 'emergency' ? 'badge-danger' : p === 'high' ? 'badge-warning' : 'badge-default';
}
function statusBadge(s) {
  return s === 'completed' ? 'badge-success'
       : s === 'in_progress' ? 'badge-info'
       : s === 'scheduled' ? 'badge-info'
       : s === 'cancelled' ? 'badge-default'
       : 'badge-warning';
}
function fmtMoney(v) { const n = Number(v); return !Number.isFinite(n) ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n); }
function fmtDate(v) { if (!v) return '—'; try { const d = v.toDate ? v.toDate() : new Date(v); if (isNaN(d.getTime())) return '—'; return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return '—'; } }
function escapeHtml(s) { if (s == null) return ''; const n = document.createElement('span'); n.appendChild(document.createTextNode(String(s))); return n.innerHTML; }
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
