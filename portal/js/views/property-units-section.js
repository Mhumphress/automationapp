// ─────────────────────────────────────────────────────────────────
//  property-units-section.js — "Units at this property" section on
//  the Property detail page. Shows each unit, occupancy, rent, + lets
//  the user add a single unit or bulk-generate N units with various
//  labeling schemes (sequential, prefixed, floor-based, custom list).
// ─────────────────────────────────────────────────────────────────

import { db, auth } from '../config.js';
import {
  collection, query, where, onSnapshot, addDoc, serverTimestamp, writeBatch, doc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { openAssignLease } from './assign-lease-modal.js';

export function renderPropertyUnitsSection(property, env, ctx) {
  const wrap = document.createElement('div');
  wrap.innerHTML = '<div style="color:var(--gray);padding:0.5rem 0;">Loading units…</div>';

  const tenantId = env.tenantId;
  let unitsCache = [];
  let unsub = null;

  function draw() {
    const occupied = unitsCache.filter(u => u.status === 'occupied').length;
    const vacant = unitsCache.filter(u => u.status === 'vacant').length;
    const totalRent = unitsCache.reduce((s, u) => s + (Number(u.baseRent) || 0), 0);
    const collectedRent = unitsCache
      .filter(u => u.status === 'occupied')
      .reduce((s, u) => s + (Number(u.baseRent) || 0), 0);
    const occupancyPct = unitsCache.length > 0
      ? Math.round((occupied / unitsCache.length) * 100)
      : 0;

    wrap.innerHTML = '';

    // KPI strip
    const kpis = document.createElement('div');
    kpis.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:0.5rem;margin-bottom:0.75rem;';
    kpis.innerHTML = `
      ${kpi('Units defined', `${unitsCache.length} / ${property.units || '—'}`)}
      ${kpi('Occupied', `${occupied} (${occupancyPct}%)`)}
      ${kpi('Vacant', String(vacant))}
      ${kpi('Rent potential', fmtMoney(totalRent))}
      ${kpi('Currently collecting', fmtMoney(collectedRent))}
    `;
    wrap.appendChild(kpis);

    // Action row
    const expectedN = Number(property.units || 0);
    const gap = Math.max(0, expectedN - unitsCache.length);
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.75rem;';
    actions.innerHTML = env.canWrite ? `
      <button class="btn btn-primary btn-sm" data-action="add-one">+ Add Unit</button>
      ${gap > 0
        ? `<button class="btn btn-primary btn-sm" data-action="bulk-generate">Generate ${gap} missing unit${gap === 1 ? '' : 's'}</button>`
        : (expectedN === 0
          ? `<button class="btn btn-ghost btn-sm" data-action="bulk-generate">Bulk generate units…</button>`
          : '')}
    ` : '';
    wrap.appendChild(actions);

    actions.querySelector('[data-action="add-one"]')?.addEventListener('click', () => openAddUnitModal(property, tenantId, unitsCache, null));
    actions.querySelector('[data-action="bulk-generate"]')?.addEventListener('click', () => openBulkGenerateModal(property, tenantId, unitsCache));

    // Units table
    if (unitsCache.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:1rem;color:var(--gray);font-size:0.85rem;background:var(--off-white);border-radius:8px;';
      empty.innerHTML = expectedN > 0
        ? `This property has <strong>${expectedN}</strong> units configured but none are defined yet. Click "Generate ${expectedN} missing units" above to bulk-create them.`
        : 'No units yet. Add individual units or bulk-generate them.';
      wrap.appendChild(empty);
      return;
    }

    const sorted = [...unitsCache].sort((a, b) => naturalCompare(a.label || '', b.label || ''));
    const table = document.createElement('table');
    table.className = 'data-table';
    table.innerHTML = `
      <thead><tr>
        <th>Unit</th><th>BR / BA</th><th>Sq Ft</th><th>Rent</th><th>Status</th><th>Tenant</th><th></th>
      </tr></thead>
      <tbody>
        ${sorted.map(u => `
          <tr class="clickable" data-unit-id="${escapeHtml(u.id)}">
            <td style="font-weight:500;">${escapeHtml(u.label || '—')}</td>
            <td>${escapeHtml((u.bedrooms || 0) + ' / ' + (u.bathrooms || 0))}</td>
            <td>${u.sqft ? escapeHtml(String(u.sqft)) : '<span style="color:var(--gray);">—</span>'}</td>
            <td style="font-variant-numeric:tabular-nums;">${u.baseRent ? fmtMoney(u.baseRent) : '<span style="color:var(--gray);">—</span>'}</td>
            <td><span class="badge ${badgeFor(u.status)}">${escapeHtml(u.status || 'vacant')}</span></td>
            <td>${escapeHtml(u.currentTenantName || '—')}</td>
            <td style="text-align:right;white-space:nowrap;">
              ${env.canWrite && (u.status === 'vacant' || !u.currentLeaseId)
                ? `<button class="btn btn-primary btn-sm" data-action="assign" data-unit-id="${escapeHtml(u.id)}">Assign Tenant</button>`
                : ''}
              ${env.canWrite ? `<button class="btn btn-ghost btn-sm" data-action="edit" data-unit-id="${escapeHtml(u.id)}">Edit</button>` : ''}
            </td>
          </tr>
        `).join('')}
      </tbody>
    `;
    wrap.appendChild(table);

    table.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const unit = unitsCache.find(u => u.id === btn.dataset.unitId);
        if (unit) openAddUnitModal(property, tenantId, unitsCache, unit);
      });
    });
    table.querySelectorAll('[data-action="assign"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const unit = unitsCache.find(u => u.id === btn.dataset.unitId);
        if (unit) openAssignLease(unit, { tenantId, canWrite: env.canWrite });
      });
    });
    table.querySelectorAll('[data-unit-id]').forEach(row => {
      if (row.tagName !== 'TR') return;
      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-action]')) return;
        const unit = unitsCache.find(u => u.id === row.dataset.unitId);
        if (unit) openAddUnitModal(property, tenantId, unitsCache, unit);
      });
    });
  }

  // Subscribe to units for this property
  try {
    const q = query(
      collection(db, 'tenants', tenantId, 'units'),
      where('propertyId', '==', property.id)
    );
    unsub = onSnapshot(q, (snap) => {
      unitsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      draw();
    }, (err) => {
      console.warn('units subscription error:', err);
      wrap.innerHTML = `<div style="color:var(--danger);padding:0.5rem;font-size:0.85rem;">Can't load units: ${escapeHtml(err.code || err.message)}</div>`;
    });
  } catch (err) {
    console.warn('units query failed:', err);
  }

  // TODO: no destroy hook — records module doesn't provide one. For now the
  // subscription cleans up when the user navigates away and the DOM drops.

  return wrap;
}

// ── Single-unit add/edit modal ──────────────────────────────────

function openAddUnitModal(property, tenantId, existingUnits, editing) {
  const isEdit = !!editing;
  const backdrop = makeBackdrop(isEdit ? `Edit ${editing.label}` : `Add Unit to ${property.name || 'Property'}`);
  const body = backdrop.querySelector('.modal-body');
  const form = document.createElement('form');
  form.className = 'modal-form';
  const u = editing || {};
  form.innerHTML = `
    <div class="modal-form-grid">
      <div class="modal-field">
        <label>Unit Label *</label>
        <input type="text" name="label" required value="${escapeAttr(u.label || '')}" placeholder="e.g. 101, Apt 4B">
      </div>
      <div class="modal-field">
        <label>Status</label>
        <select name="status">
          <option value="vacant" ${u.status === 'vacant' ? 'selected' : ''}>Vacant</option>
          <option value="occupied" ${u.status === 'occupied' ? 'selected' : ''}>Occupied</option>
          <option value="maintenance" ${u.status === 'maintenance' ? 'selected' : ''}>Maintenance</option>
          <option value="off_market" ${u.status === 'off_market' ? 'selected' : ''}>Off Market</option>
        </select>
      </div>
    </div>
    <div class="modal-form-grid">
      <div class="modal-field">
        <label>Bedrooms</label>
        <input type="number" name="bedrooms" min="0" step="1" value="${u.bedrooms || ''}">
      </div>
      <div class="modal-field">
        <label>Bathrooms</label>
        <input type="number" name="bathrooms" min="0" step="0.5" value="${u.bathrooms || ''}">
      </div>
    </div>
    <div class="modal-form-grid">
      <div class="modal-field">
        <label>Square Feet</label>
        <input type="number" name="sqft" min="0" step="1" value="${u.sqft || ''}">
      </div>
      <div class="modal-field">
        <label>Base Rent (monthly)</label>
        <input type="number" name="baseRent" min="0" step="0.01" value="${u.baseRent || ''}">
      </div>
    </div>
    <div class="modal-field">
      <label>Security Deposit</label>
      <input type="number" name="securityDeposit" min="0" step="0.01" value="${u.securityDeposit || ''}">
    </div>
    <div class="modal-field">
      <label>Notes</label>
      <textarea name="notes" rows="2">${escapeHtml(u.notes || '')}</textarea>
    </div>
    <div class="modal-actions">
      <button type="submit" class="btn btn-primary btn-lg">${isEdit ? 'Save' : 'Add Unit'}</button>
      <span class="modal-cancel">Cancel</span>
    </div>
  `;
  body.appendChild(form);
  wireModalClose(backdrop);
  form.querySelector('.modal-cancel').addEventListener('click', () => backdrop.remove());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const label = (fd.get('label') || '').toString().trim();
    if (!label) return;

    // Uniqueness check within this property
    const conflict = existingUnits.find(x => x.id !== (editing?.id) && (x.label || '').toLowerCase() === label.toLowerCase());
    if (conflict) {
      showToast(`A unit labeled "${label}" already exists at this property.`, 'error');
      return;
    }

    const data = {
      label,
      propertyId: property.id,
      propertyName: property.name || '',
      status: fd.get('status') || 'vacant',
      bedrooms: toNum(fd.get('bedrooms')),
      bathrooms: toNum(fd.get('bathrooms')),
      sqft: toNum(fd.get('sqft')),
      baseRent: toNum(fd.get('baseRent')),
      securityDeposit: toNum(fd.get('securityDeposit')),
      notes: (fd.get('notes') || '').toString().trim(),
    };

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const user = auth.currentUser;
      if (isEdit) {
        const { updateDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
        await updateDoc(doc(db, 'tenants', tenantId, 'units', editing.id), {
          ...data,
          updatedAt: serverTimestamp(),
          updatedBy: user ? user.uid : null,
        });
        showToast('Unit updated', 'success');
      } else {
        await addDoc(collection(db, 'tenants', tenantId, 'units'), {
          ...data,
          createdAt: serverTimestamp(),
          createdBy: user ? user.uid : null,
        });
        showToast('Unit added', 'success');
      }
      backdrop.remove();
    } catch (err) {
      console.error(err);
      showToast('Save failed: ' + err.message, 'error');
      btn.disabled = false;
    }
  });
}

// ── Bulk generate wizard ────────────────────────────────────────

function openBulkGenerateModal(property, tenantId, existingUnits) {
  const defaultN = Math.max(0, Number(property.units || 0) - existingUnits.length) || Number(property.units || 0) || 10;
  const existingLabels = new Set(existingUnits.map(u => (u.label || '').toLowerCase()));

  const backdrop = makeBackdrop(`Generate Units for ${property.name || 'Property'}`);
  const body = backdrop.querySelector('.modal-body');
  const form = document.createElement('form');
  form.className = 'modal-form';
  form.innerHTML = `
    <div class="modal-field">
      <label>How many units?</label>
      <input type="number" name="count" min="1" max="500" required value="${defaultN}">
    </div>
    <div class="modal-field">
      <label>Labeling scheme</label>
      <select name="scheme">
        <option value="sequential">Sequential numbers (1, 2, 3, ...)</option>
        <option value="prefixed">Prefixed (e.g. "Apt 1", "Apt 2", ...)</option>
        <option value="floor">Floor-based (101, 102, ..., 201, 202, ...)</option>
        <option value="custom">Custom list (paste labels)</option>
      </select>
    </div>
    <div class="modal-field" id="prefixField" style="display:none;">
      <label>Prefix</label>
      <input type="text" name="prefix" value="Unit " placeholder="Apt, Unit, Suite, #">
    </div>
    <div class="modal-form-grid" id="floorField" style="display:none;">
      <div class="modal-field">
        <label>Number of floors</label>
        <input type="number" name="floors" min="1" value="5">
      </div>
      <div class="modal-field">
        <label>Units per floor</label>
        <input type="number" name="unitsPerFloor" min="1" value="10">
      </div>
    </div>
    <div class="modal-field" id="customField" style="display:none;">
      <label>Custom labels (one per line, or comma-separated)</label>
      <textarea name="customList" rows="5" placeholder="101\n102\nPenthouse\n..."></textarea>
    </div>
    <div class="modal-form-grid">
      <div class="modal-field">
        <label>Default bedrooms</label>
        <input type="number" name="defaultBedrooms" min="0" value="2">
      </div>
      <div class="modal-field">
        <label>Default square feet</label>
        <input type="number" name="defaultSqft" min="0" value="">
      </div>
    </div>
    <div class="modal-field">
      <label>Default base rent (applied to all — edit per unit after)</label>
      <input type="number" name="defaultRent" min="0" step="0.01" value="">
    </div>
    <div id="previewBlock" style="padding:0.75rem;background:var(--off-white,#F1F5F9);border-radius:8px;font-size:0.85rem;margin:0.5rem 0;"></div>
    <div class="modal-actions">
      <button type="submit" class="btn btn-primary btn-lg">Generate</button>
      <span class="modal-cancel">Cancel</span>
    </div>
  `;
  body.appendChild(form);
  wireModalClose(backdrop);
  form.querySelector('.modal-cancel').addEventListener('click', () => backdrop.remove());

  const schemeSel = form.querySelector('select[name="scheme"]');
  const prefixField = form.querySelector('#prefixField');
  const floorField = form.querySelector('#floorField');
  const customField = form.querySelector('#customField');
  const countInput = form.querySelector('input[name="count"]');
  const previewBlock = form.querySelector('#previewBlock');

  function updatePreview() {
    const labels = generateLabels(form);
    if (labels.length === 0) {
      previewBlock.innerHTML = '<span style="color:var(--gray-dark);">Preview appears here…</span>';
      return;
    }
    const sample = labels.slice(0, 8).join(', ');
    const suffix = labels.length > 8 ? `… and ${labels.length - 8} more (${labels.length} total)` : ` (${labels.length} total)`;
    const conflicts = labels.filter(l => existingLabels.has(l.toLowerCase()));
    previewBlock.innerHTML = `
      <strong>Preview:</strong> ${escapeHtml(sample)}${escapeHtml(suffix)}
      ${conflicts.length > 0 ? `<div style="color:var(--danger,#dc2626);margin-top:0.3rem;">${conflicts.length} label(s) conflict with existing units — those will be skipped.</div>` : ''}
    `;
  }

  function swapSchemeFields() {
    const s = schemeSel.value;
    prefixField.style.display = s === 'prefixed' ? '' : 'none';
    floorField.style.display = s === 'floor' ? 'grid' : 'none';
    customField.style.display = s === 'custom' ? '' : 'none';
    updatePreview();
  }
  schemeSel.addEventListener('change', swapSchemeFields);
  countInput.addEventListener('input', updatePreview);
  form.querySelectorAll('input, textarea').forEach(el => el.addEventListener('input', updatePreview));
  swapSchemeFields();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const labels = generateLabels(form);
    if (labels.length === 0) {
      showToast('No labels to generate.', 'error');
      return;
    }

    const fd = new FormData(form);
    const defaultBedrooms = toNum(fd.get('defaultBedrooms'));
    const defaultSqft = toNum(fd.get('defaultSqft'));
    const defaultRent = toNum(fd.get('defaultRent'));

    // Filter out conflicts
    const toCreate = labels.filter(l => !existingLabels.has(l.toLowerCase()));
    if (toCreate.length === 0) {
      showToast('All generated labels conflict with existing units.', 'error');
      return;
    }

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = `Creating ${toCreate.length}…`;

    try {
      const user = auth.currentUser;
      // Use writeBatch in chunks of 400 (Firestore limit is 500).
      for (let i = 0; i < toCreate.length; i += 400) {
        const chunk = toCreate.slice(i, i + 400);
        const batch = writeBatch(db);
        chunk.forEach(label => {
          const ref = doc(collection(db, 'tenants', tenantId, 'units'));
          batch.set(ref, {
            label,
            propertyId: property.id,
            propertyName: property.name || '',
            bedrooms: defaultBedrooms,
            sqft: defaultSqft,
            baseRent: defaultRent,
            status: 'vacant',
            createdAt: serverTimestamp(),
            createdBy: user ? user.uid : null,
            source: { createdVia: 'bulk_generate' },
          });
        });
        await batch.commit();
      }
      showToast(`Created ${toCreate.length} unit${toCreate.length === 1 ? '' : 's'}`, 'success');
      backdrop.remove();
    } catch (err) {
      console.error(err);
      showToast('Bulk create failed: ' + err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Generate';
    }
  });
}

function generateLabels(form) {
  const fd = new FormData(form);
  const scheme = fd.get('scheme');
  const count = Number(fd.get('count')) || 0;

  if (scheme === 'sequential') {
    return Array.from({ length: count }, (_, i) => String(i + 1));
  }
  if (scheme === 'prefixed') {
    const prefix = (fd.get('prefix') || '').toString();
    return Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);
  }
  if (scheme === 'floor') {
    const floors = Number(fd.get('floors')) || 1;
    const perFloor = Number(fd.get('unitsPerFloor')) || 1;
    const labels = [];
    for (let f = 1; f <= floors; f++) {
      for (let u = 1; u <= perFloor; u++) {
        labels.push(`${f}${String(u).padStart(2, '0')}`);
      }
    }
    return labels;
  }
  if (scheme === 'custom') {
    const raw = (fd.get('customList') || '').toString();
    return raw
      .split(/[\n,]+/)
      .map(s => s.trim())
      .filter(Boolean);
  }
  return [];
}

// ── Helpers ─────────────────────────────────────────────────────

function kpi(label, value) {
  return `
    <div style="padding:0.6rem 0.75rem;background:var(--off-white,#F1F5F9);border-radius:8px;">
      <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--gray-dark,#64748B);">${escapeHtml(label)}</div>
      <div style="font-size:1rem;font-weight:600;margin-top:0.15rem;">${escapeHtml(value)}</div>
    </div>
  `;
}

function badgeFor(s) {
  return s === 'occupied' ? 'badge-success'
       : s === 'vacant' ? 'badge-info'
       : s === 'maintenance' ? 'badge-warning'
       : s === 'off_market' ? 'badge-default'
       : 'badge-default';
}

function fmtMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Compare "101" < "102" < "201" not as string — handle numeric parts naturally.
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

function escapeAttr(s) {
  return String(s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
