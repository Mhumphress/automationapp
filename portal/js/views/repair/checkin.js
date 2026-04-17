import { addDocument, queryDocuments } from '../../services/firestore.js';
import { createTicket } from '../../services/tickets.js';
import { db } from '../../config.js';
import { addDoc, collection, serverTimestamp, Timestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { canWrite, gateWrite, getTenantId, hasFeature } from '../../tenant-context.js';
import { renderDevicePicker, attachDevicePickerHandlers, getDevicePickerValue } from '../../components/device-picker.js';

let contacts = [];
let currentPage = 'form';
let lastTicket = null;

export function init() {}

export async function render() {
  if (!hasFeature('checkin')) {
    document.getElementById('view-checkin').innerHTML =
      '<div class="empty-state"><div class="empty-title">Not included in your plan</div><p class="empty-description">Upgrade to Pro to unlock streamlined check-in.</p></div>';
    return;
  }
  try { contacts = await queryDocuments('contacts', 'name', 'asc'); } catch { contacts = []; }
  if (currentPage === 'form') renderForm();
  else if (currentPage === 'confirmation') renderConfirmation();
}

export function destroy() { currentPage = 'form'; lastTicket = null; }

function renderForm() {
  const container = document.getElementById('view-checkin');
  container.innerHTML = '';

  const form = document.createElement('form');
  form.className = 'modal-form';
  form.style.cssText = 'max-width:640px;margin:0 auto;';

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 3);
  const defaultEta = tomorrow.toISOString().split('T')[0];

  form.innerHTML = `
    <h2 style="margin-bottom:1rem;">Check In</h2>

    <div class="modal-field">
      <label>Customer</label>
      <select id="customerSelect">
        <option value="">— Select a customer —</option>
        <option value="__new__">+ New customer</option>
        ${contacts.map(c => `<option value="${c.id}">${escapeHtml(c.name || c.email || 'Unnamed')}</option>`).join('')}
      </select>
    </div>

    <div id="newCustomerBlock" style="display:none;">
      <div class="modal-form-grid">
        <div class="modal-field"><label>Name *</label><input type="text" name="newName"></div>
        <div class="modal-field"><label>Phone</label><input type="tel" name="newPhone"></div>
      </div>
      <div class="modal-field"><label>Email</label><input type="email" name="newEmail"></div>
    </div>

    ${renderDevicePicker({ idPrefix: 'checkinDevice', initialValue: '', required: true })}

    <div class="modal-field"><label>Serial / IMEI</label><input type="text" name="serial"></div>

    <div class="modal-field"><label>Issue *</label><textarea name="issue" rows="3" required placeholder="What's wrong with the device?"></textarea></div>
    <div class="modal-field"><label>Condition Notes</label><textarea name="condition" rows="2" placeholder="Scratches, dents, missing parts..."></textarea></div>
    <div class="modal-field"><label>Estimated Completion</label><input type="date" name="estimatedCompletion" value="${defaultEta}"></div>

    <div style="margin-top:1rem;">
      <button type="submit" class="btn btn-primary" ${canWrite() ? '' : 'disabled'}>Check In &amp; Create Ticket</button>
    </div>
  `;
  container.appendChild(form);

  const selectEl = form.querySelector('#customerSelect');
  const newBlock = form.querySelector('#newCustomerBlock');
  selectEl.addEventListener('change', () => {
    newBlock.style.display = selectEl.value === '__new__' ? 'block' : 'none';
  });

  attachDevicePickerHandlers(form, 'checkinDevice');

  form.addEventListener('submit', gateWrite(async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating...';

    try {
      let contactId = selectEl.value;
      let customerName = '';

      if (contactId === '__new__') {
        const newName = form.querySelector('[name="newName"]').value.trim();
        if (!newName) throw new Error('Please enter the new customer name.');
        const newPhone = form.querySelector('[name="newPhone"]').value.trim();
        const newEmail = form.querySelector('[name="newEmail"]').value.trim();
        const ref = await addDocument('contacts', {
          name: newName,
          phone: newPhone,
          email: newEmail
        });
        contactId = ref.id;
        customerName = newName;
      } else if (contactId) {
        const c = contacts.find(x => x.id === contactId);
        customerName = c ? (c.name || c.email || '') : '';
      } else {
        throw new Error('Please select a customer or add a new one.');
      }

      const etaStr = form.querySelector('[name="estimatedCompletion"]').value;
      const etaTs = etaStr ? Timestamp.fromDate(new Date(etaStr)) : null;

      const deviceType = getDevicePickerValue(form, 'checkinDevice');
      if (!deviceType) throw new Error('Please select a device (Manufacturer, Product Line, and Model).');

      const result = await createTicket({
        contactId,
        customerName,
        deviceType,
        serial: form.querySelector('[name="serial"]').value.trim(),
        issue: form.querySelector('[name="issue"]').value.trim(),
        condition: form.querySelector('[name="condition"]').value.trim(),
        estimatedCompletion: etaTs,
        status: 'checked_in'
      });

      // Log to tenant activity
      const tid = getTenantId();
      await addDoc(collection(db, `tenants/${tid}/activity`), {
        type: 'ticket_created',
        description: `Ticket ${result.ticketNumber} — ${deviceType} for ${customerName}`,
        metadata: { ticketId: result.id, ticketNumber: result.ticketNumber },
        createdAt: serverTimestamp()
      });

      lastTicket = {
        id: result.id,
        ticketNumber: result.ticketNumber,
        customerName,
        deviceType,
        serial: form.querySelector('[name="serial"]').value.trim(),
        issue: form.querySelector('[name="issue"]').value.trim(),
        condition: form.querySelector('[name="condition"]').value.trim(),
        estimatedCompletion: etaStr,
        checkedInAt: new Date()
      };
      currentPage = 'confirmation';
      renderConfirmation();
    } catch (err) {
      console.error('Check-in failed:', err);
      alert('Check-in failed: ' + err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Check In & Create Ticket';
    }
  }));
}

function renderConfirmation() {
  if (!lastTicket) { currentPage = 'form'; return renderForm(); }
  const container = document.getElementById('view-checkin');
  container.innerHTML = `
    <div style="max-width:640px;margin:0 auto;text-align:center;padding:2rem;">
      <div style="font-size:3rem;">✓</div>
      <h2 style="margin:0.5rem 0;">Checked in as ${escapeHtml(lastTicket.ticketNumber)}</h2>
      <p style="color:var(--gray);">${escapeHtml(lastTicket.customerName)} &middot; ${escapeHtml(lastTicket.deviceType)}</p>
      <div style="display:flex;gap:0.5rem;justify-content:center;margin-top:1.5rem;flex-wrap:wrap;">
        <button class="btn btn-primary" id="printClaimBtn">Print Claim Tag</button>
        <button class="btn btn-ghost" id="anotherCheckinBtn">Check In Another</button>
        <a class="btn btn-ghost" href="#tickets">View All Tickets</a>
      </div>
    </div>

    <!-- Claim tag print target — hidden on screen, shown on print -->
    <div class="claim-tag-print-only" id="claimTagPrint">
      <div class="claim-tag">
        <div class="claim-tag-header">
          <div class="claim-tag-title">CLAIM TAG</div>
          <div class="claim-tag-number">${escapeHtml(lastTicket.ticketNumber)}</div>
        </div>
        <div class="claim-tag-row"><span>Customer:</span> ${escapeHtml(lastTicket.customerName)}</div>
        <div class="claim-tag-row"><span>Device:</span> ${escapeHtml(lastTicket.deviceType)}</div>
        <div class="claim-tag-row"><span>Serial:</span> ${escapeHtml(lastTicket.serial || '—')}</div>
        <div class="claim-tag-row"><span>Condition:</span> ${escapeHtml(lastTicket.condition || '—')}</div>
        <div class="claim-tag-row"><span>Issue:</span> ${escapeHtml(lastTicket.issue)}</div>
        <div class="claim-tag-row"><span>Checked in:</span> ${lastTicket.checkedInAt.toLocaleString()}</div>
        <div class="claim-tag-row"><span>Est. ready:</span> ${escapeHtml(lastTicket.estimatedCompletion || '—')}</div>
      </div>
    </div>
  `;
  document.getElementById('printClaimBtn').addEventListener('click', () => window.print());
  document.getElementById('anotherCheckinBtn').addEventListener('click', () => {
    lastTicket = null;
    currentPage = 'form';
    render();
  });
}

function escapeHtml(str) {
  if (str == null) return '';
  const node = document.createElement('span');
  node.appendChild(document.createTextNode(String(str)));
  return node.innerHTML;
}
