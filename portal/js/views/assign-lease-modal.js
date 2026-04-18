// ─────────────────────────────────────────────────────────────────
//  assign-lease-modal.js — Shared modal for assigning a tenant (renter)
//  to a specific unit. Creates lease, flips unit occupancy, and (optionally)
//  starts automatic monthly rent billing.
//  Called from the Units table on the property detail page AND from the
//  unit detail page.
// ─────────────────────────────────────────────────────────────────

import { db, auth } from '../config.js';
import {
  doc, addDoc, updateDoc, collection, serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { createCharge } from '../services/recurring-billing.js';

/**
 * Open the Assign Tenant modal for a unit.
 *
 * @param {object} unit     unit record (must have id, label, propertyId, propertyName)
 * @param {object} env      { tenantId, canWrite }
 * @param {Function} [onDone] called after the lease is created
 * @returns {Promise<{created: boolean, leaseId?: string}>}
 */
export function openAssignLease(unit, env, onDone) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop open';
    backdrop.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-header">
          <h2 class="modal-title">Assign Tenant — ${escapeHtml(unit.label || 'Unit')}${unit.propertyName ? ` · ${escapeHtml(unit.propertyName)}` : ''}</h2>
          <button class="modal-close" type="button">×</button>
        </div>
        <div class="modal-body"></div>
      </div>
    `;
    document.body.appendChild(backdrop);
    const close = (result) => { backdrop.remove(); resolve(result || { created: false }); };
    backdrop.querySelector('.modal-close').addEventListener('click', () => close());
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

    const body = backdrop.querySelector('.modal-body');
    const form = document.createElement('form');
    form.className = 'modal-form';
    const today = new Date().toISOString().slice(0, 10);
    const oneYear = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);

    form.innerHTML = `
      <div class="modal-form-grid">
        <div class="modal-field">
          <label>Tenant Name *</label>
          <input type="text" name="tenantName" required placeholder="Full name on the lease">
        </div>
        <div class="modal-field">
          <label>Tenant Email</label>
          <input type="email" name="tenantEmail" placeholder="For rent invoice delivery">
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
          <label>Lease Start *</label>
          <input type="date" name="startDate" required value="${today}">
        </div>
        <div class="modal-field">
          <label>Lease End *</label>
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
        <textarea name="notes" rows="2" placeholder="Move-in details, special terms, etc."></textarea>
      </div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary btn-lg">Create Lease &amp; Assign</button>
        <span class="modal-cancel">Cancel</span>
      </div>
    `;
    body.appendChild(form);
    form.querySelector('.modal-cancel').addEventListener('click', () => close());

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const tenantName = (fd.get('tenantName') || '').toString().trim();
      const tenantEmail = (fd.get('tenantEmail') || '').toString().trim();
      const tenantPhone = (fd.get('tenantPhone') || '').toString().trim();
      const monthlyRent = Number(fd.get('monthlyRent')) || 0;
      const startDate = new Date(fd.get('startDate').toString());
      const endDate = fd.get('endDate') ? new Date(fd.get('endDate').toString()) : null;
      const deposit = Number(fd.get('deposit')) || 0;
      const autoBill = fd.get('autoBill') === 'yes';
      const notes = (fd.get('notes') || '').toString().trim();

      if (!tenantName || !(monthlyRent > 0)) {
        toast('Tenant name and rent amount are required.', 'error');
        return;
      }

      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Creating...';

      try {
        const user = auth.currentUser;

        const leaseRef = await addDoc(collection(db, 'tenants', env.tenantId, 'leases'), {
          tenantName, tenantEmail, tenantPhone,
          property: unit.propertyName || '',
          propertyId: unit.propertyId,
          unit: unit.label,
          unitId: unit.id,
          startDate: Timestamp.fromDate(startDate),
          endDate: endDate ? Timestamp.fromDate(endDate) : null,
          monthlyRent, deposit,
          status: 'active',
          notes, autoBill,
          createdAt: serverTimestamp(),
          createdBy: user ? user.uid : null,
          createdByEmail: user ? user.email || '' : '',
        });

        await updateDoc(doc(db, 'tenants', env.tenantId, 'units', unit.id), {
          status: 'occupied',
          currentLeaseId: leaseRef.id,
          currentTenantName: tenantName,
          currentTenantEmail: tenantEmail,
          currentTenantPhone: tenantPhone,
          updatedAt: serverTimestamp(),
        });

        if (autoBill) {
          try {
            await createCharge(env.tenantId, {
              name: `Rent — ${unit.propertyName || ''} ${unit.label}`.trim(),
              description: `Monthly rent for ${unit.propertyName || ''} ${unit.label}`.trim(),
              parentType: 'lease',
              parentId: leaseRef.id,
              customerName: tenantName,
              customerEmail: tenantEmail,
              chargeType: 'rent',
              amount: monthlyRent,
              frequency: 'monthly',
              dayOfMonth: 1,
              dueInDays: 5,
              startDate, endDate,
              autoGenerate: true,
            });
          } catch (err) {
            console.warn('Auto-create rent charge failed (lease still saved):', err);
          }
        }

        toast(autoBill ? 'Tenant assigned — monthly rent billing scheduled' : 'Tenant assigned', 'success');
        if (onDone) try { onDone(); } catch {}
        close({ created: true, leaseId: leaseRef.id });
      } catch (err) {
        console.error(err);
        toast('Failed: ' + err.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Create Lease & Assign';
      }
    });
  });
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
