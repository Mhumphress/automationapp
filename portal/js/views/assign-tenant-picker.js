// ─────────────────────────────────────────────────────────────────
//  assign-tenant-picker.js — Entry flow for the Tenants & Leases tab.
//  Step 1: pick property → Step 2: pick vacant unit → open the shared
//  assign-lease-modal pre-filled with that unit.
// ─────────────────────────────────────────────────────────────────

import { db } from '../config.js';
import { collection, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { openAssignLease } from './assign-lease-modal.js';

export async function openAssignTenantPicker({ tenantId, env, onCreated }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop open';
  backdrop.innerHTML = `
    <div class="modal-dialog">
      <div class="modal-header">
        <h2 class="modal-title">Assign Tenant to Unit</h2>
        <button class="modal-close" type="button">×</button>
      </div>
      <div class="modal-body" id="pickerBody">
        <div style="color:var(--gray);padding:0.5rem 0;">Loading…</div>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector('.modal-close').addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

  const body = backdrop.querySelector('#pickerBody');

  // Load properties + all units in parallel
  let properties = [];
  let units = [];
  try {
    const [propSnap, unitSnap] = await Promise.all([
      getDocs(collection(db, 'tenants', tenantId, 'properties')),
      getDocs(collection(db, 'tenants', tenantId, 'units')),
    ]);
    properties = propSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    units = unitSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    body.innerHTML = `<div style="color:var(--danger);padding:1rem;">Can't load data: ${escapeHtml(err.code || err.message)}</div>`;
    return;
  }

  if (properties.length === 0) {
    body.innerHTML = `
      <div style="padding:1rem;color:var(--gray-dark);line-height:1.5;">
        You don't have any properties yet. Go to the <strong>Properties</strong> tab first,
        add a property, generate its units, then come back here to assign tenants.
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-primary btn-lg" id="goToProps">Go to Properties</button>
        <span class="modal-cancel">Close</span>
      </div>
    `;
    body.querySelector('#goToProps').addEventListener('click', () => {
      window.location.hash = 'properties';
      close();
    });
    body.querySelector('.modal-cancel').addEventListener('click', close);
    return;
  }

  const unitsByProperty = {};
  units.forEach(u => { (unitsByProperty[u.propertyId] ||= []).push(u); });

  body.innerHTML = `
    <p style="color:var(--gray-dark);font-size:0.88rem;margin:0 0 0.75rem;">
      Pick the unit you're assigning a tenant to. Only vacant units show under each property.
    </p>
    <div class="modal-field">
      <label>Property</label>
      <select id="propertySel">
        <option value="">— Select a property —</option>
        ${properties.map(p => {
          const propUnits = unitsByProperty[p.id] || [];
          const vacant = propUnits.filter(u => u.status === 'vacant' || !u.currentLeaseId).length;
          return `<option value="${escapeAttr(p.id)}">${escapeHtml(p.name || '(unnamed)')} — ${vacant} vacant of ${propUnits.length}</option>`;
        }).join('')}
      </select>
    </div>
    <div class="modal-field" id="unitFieldWrap" style="display:none;">
      <label>Unit</label>
      <select id="unitSel">
        <option value="">— Select a unit —</option>
      </select>
      <div id="unitHint" style="font-size:0.78rem;color:var(--gray-dark);margin-top:0.3rem;"></div>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn btn-primary btn-lg" id="continueBtn" disabled>Continue</button>
      <span class="modal-cancel">Cancel</span>
    </div>
  `;

  const propSel = body.querySelector('#propertySel');
  const unitWrap = body.querySelector('#unitFieldWrap');
  const unitSel = body.querySelector('#unitSel');
  const unitHint = body.querySelector('#unitHint');
  const contBtn = body.querySelector('#continueBtn');
  body.querySelector('.modal-cancel').addEventListener('click', close);

  propSel.addEventListener('change', () => {
    const pid = propSel.value;
    contBtn.disabled = true;
    if (!pid) { unitWrap.style.display = 'none'; return; }

    const propUnits = (unitsByProperty[pid] || []).filter(u => u.status === 'vacant' || !u.currentLeaseId);
    propUnits.sort((a, b) => naturalCompare(a.label || '', b.label || ''));

    if (propUnits.length === 0) {
      unitWrap.style.display = 'block';
      unitSel.innerHTML = '<option value="">— No vacant units —</option>';
      unitSel.disabled = true;
      unitHint.innerHTML = 'This property has no vacant units. All units are occupied, in maintenance, or haven\'t been generated yet.';
      return;
    }

    unitSel.disabled = false;
    unitWrap.style.display = 'block';
    unitSel.innerHTML = '<option value="">— Select a unit —</option>' + propUnits.map(u => `
      <option value="${escapeAttr(u.id)}">
        ${escapeHtml(u.label || '(no label)')}${u.bedrooms ? ` · ${u.bedrooms}BR` : ''}${u.sqft ? ` · ${u.sqft} sqft` : ''}${u.baseRent ? ` · $${Number(u.baseRent).toFixed(0)}/mo` : ''}
      </option>
    `).join('');
    unitHint.innerHTML = `<strong>${propUnits.length}</strong> vacant unit${propUnits.length === 1 ? '' : 's'} available at this property.`;
  });

  unitSel.addEventListener('change', () => {
    contBtn.disabled = !unitSel.value;
  });

  contBtn.addEventListener('click', async () => {
    const unitId = unitSel.value;
    if (!unitId) return;
    const unit = units.find(u => u.id === unitId);
    if (!unit) return;
    close();
    const result = await openAssignLease(unit, { tenantId, canWrite: env.canWrite }, onCreated);
    if (result && result.created && onCreated) onCreated();
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
