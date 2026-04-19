// ─────────────────────────────────────────────────────────────────
//  maintenance-create.js — Picker-based "+ New Request" for the
//  Maintenance tab. Cascading dropdowns: Property → Unit → Tenant
//  (auto-filled from the unit's active lease).
// ─────────────────────────────────────────────────────────────────

import { db, auth } from '../../config.js';
import {
  collection, getDocs, addDoc, serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

export async function openMaintenanceCreate({ tenantId, env, onCreated }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop open';
  backdrop.innerHTML = `
    <div class="modal-dialog">
      <div class="modal-header">
        <h2 class="modal-title">New Maintenance Request</h2>
        <button class="modal-close" type="button">×</button>
      </div>
      <div class="modal-body" id="mcBody">
        <div style="color:var(--gray);padding:0.5rem 0;">Loading…</div>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector('.modal-close').addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

  const body = backdrop.querySelector('#mcBody');

  // Pull everything needed upfront
  let properties = [];
  let units = [];
  let leases = [];
  try {
    const [pSnap, uSnap, lSnap] = await Promise.all([
      getDocs(collection(db, 'tenants', tenantId, 'properties')),
      getDocs(collection(db, 'tenants', tenantId, 'units')),
      getDocs(collection(db, 'tenants', tenantId, 'leases')),
    ]);
    properties = pSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    units = uSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    leases = lSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    body.innerHTML = `<div style="color:var(--danger);padding:1rem;">Can't load data: ${escapeHtml(err.code || err.message)}</div>`;
    return;
  }

  // Build picker UI
  const today = new Date().toISOString().slice(0, 10);
  body.innerHTML = `
    <form class="modal-form" id="mcForm">
      <div class="modal-field">
        <label>Issue *</label>
        <input type="text" name="issue" required placeholder="e.g. Dishwasher not draining">
      </div>
      <div class="modal-field">
        <label>Details</label>
        <textarea name="notes" rows="3" placeholder="What happened, when, any context the tech should know"></textarea>
      </div>

      <div class="modal-form-grid">
        <div class="modal-field">
          <label>Property *</label>
          <select name="propertyId" required id="mcProperty">
            <option value="">— Select property —</option>
            ${properties.sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(p =>
              `<option value="${escapeAttr(p.id)}">${escapeHtml(p.name || '(unnamed)')}</option>`
            ).join('')}
          </select>
        </div>
        <div class="modal-field">
          <label>Unit *</label>
          <select name="unitId" required id="mcUnit" disabled>
            <option value="">— Select property first —</option>
          </select>
        </div>
      </div>

      <div class="modal-form-grid">
        <div class="modal-field">
          <label>Tenant (auto-filled from unit)</label>
          <input type="text" name="tenantName" id="mcTenant" placeholder="Vacant unit — no tenant" readonly style="background:var(--off-white);">
        </div>
        <div class="modal-field">
          <label>Tenant email</label>
          <input type="email" name="tenantEmail" id="mcTenantEmail" readonly style="background:var(--off-white);">
        </div>
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

      <div class="modal-form-grid">
        <div class="modal-field">
          <label>Estimated cost</label>
          <input type="number" name="cost" step="0.01" min="0">
        </div>
        <div class="modal-field">
          <label>Status</label>
          <select name="status">
            <option value="open" selected>Open</option>
            <option value="scheduled">Scheduled</option>
            <option value="in_progress">In Progress</option>
          </select>
        </div>
      </div>

      <div class="modal-actions">
        <button type="submit" class="btn btn-primary btn-lg">Create Request</button>
        <span class="modal-cancel">Cancel</span>
      </div>
    </form>
  `;

  body.querySelector('.modal-cancel').addEventListener('click', close);

  const propSel = body.querySelector('#mcProperty');
  const unitSel = body.querySelector('#mcUnit');
  const tenantInput = body.querySelector('#mcTenant');
  const tenantEmailInput = body.querySelector('#mcTenantEmail');

  propSel.addEventListener('change', () => {
    const propId = propSel.value;
    unitSel.innerHTML = '<option value="">— Select unit —</option>';
    unitSel.disabled = !propId;
    tenantInput.value = '';
    tenantEmailInput.value = '';
    if (!propId) return;

    const propUnits = units
      .filter(u => u.propertyId === propId)
      .sort((a, b) => naturalCompare(a.label || '', b.label || ''));

    if (propUnits.length === 0) {
      unitSel.innerHTML = '<option value="">— No units defined —</option>';
      unitSel.disabled = true;
      return;
    }

    propUnits.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id;
      const tenantLabel = u.currentTenantName ? ` · ${u.currentTenantName}` : (u.status === 'vacant' ? ' · vacant' : '');
      opt.textContent = `${u.label || '(no label)'}${tenantLabel}`;
      unitSel.appendChild(opt);
    });
  });

  unitSel.addEventListener('change', () => {
    const unitId = unitSel.value;
    if (!unitId) {
      tenantInput.value = '';
      tenantEmailInput.value = '';
      return;
    }
    const unit = units.find(u => u.id === unitId);
    if (!unit) return;

    // Prefer the linked lease for tenant info; fall back to the unit's own
    // currentTenantName if the lease link is missing.
    const lease = unit.currentLeaseId ? leases.find(l => l.id === unit.currentLeaseId) : null;
    tenantInput.value = lease?.tenantName || unit.currentTenantName || '';
    tenantEmailInput.value = lease?.tenantEmail || unit.currentTenantEmail || '';
  });

  body.querySelector('#mcForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const propId = fd.get('propertyId').toString();
    const unitId = fd.get('unitId').toString();
    const property = properties.find(p => p.id === propId);
    const unit = units.find(u => u.id === unitId);
    if (!property || !unit) { alert('Pick a property and unit.'); return; }

    const data = {
      issue: (fd.get('issue') || '').toString().trim(),
      notes: (fd.get('notes') || '').toString().trim(),
      property: property.name || '',
      propertyId: property.id,
      unit: unit.label || '',
      unitId: unit.id,
      tenantName: (fd.get('tenantName') || '').toString().trim(),
      tenantEmail: (fd.get('tenantEmail') || '').toString().trim(),
      priority: fd.get('priority') || 'medium',
      billable: fd.get('billable') || 'no',
      assignedTo: (fd.get('assignedTo') || '').toString().trim(),
      cost: Number(fd.get('cost')) || null,
      status: fd.get('status') || 'open',
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser?.uid || null,
    };
    const scheduledRaw = fd.get('scheduledAt');
    if (scheduledRaw) data.scheduledAt = Timestamp.fromDate(new Date(scheduledRaw.toString()));

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await addDoc(collection(db, 'tenants', tenantId, 'maintenance'), data);
      close();
      if (onCreated) try { onCreated(); } catch {}
    } catch (err) {
      console.error(err);
      alert('Create failed: ' + err.message);
      btn.disabled = false;
    }
  });
}

function naturalCompare(a, b) {
  const ax = [], bx = [];
  a.replace(/(\d+)|(\D+)/g, (_, $1, $2) => { ax.push([$1 || 1e10, $2 || '']); });
  b.replace(/(\d+)|(\D+)/g, (_, $1, $2) => { bx.push([$1 || 1e10, $2 || '']); });
  while (ax.length && bx.length) {
    const an = ax.shift(), bn = bx.shift();
    const nn = Number(an[0]) - Number(bn[0]);
    if (nn) return nn;
    if (an[1] !== bn[1]) return an[1].localeCompare(bn[1]);
  }
  return ax.length - bx.length;
}

function escapeHtml(s) {
  if (s == null) return '';
  const n = document.createElement('span');
  n.appendChild(document.createTextNode(String(s)));
  return n.innerHTML;
}

function escapeAttr(s) { return String(s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
