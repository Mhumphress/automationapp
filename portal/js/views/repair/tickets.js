import { listTickets, getTicket, createTicket, updateTicket, appendTicketHistory,
  addPartToTicket, removePartFromTicket, generateInvoiceFromTicket, deleteTicket } from '../../services/tickets.js';
import { deleteDocument } from '../../services/firestore.js';
import { listParts } from '../../services/inventory.js';
import { canWrite, gateWrite, hasFeature } from '../../tenant-context.js';
import { renderDevicePicker, attachDevicePickerHandlers, getDevicePickerValue } from '../../components/device-picker.js';

const STATUS_LABELS = {
  checked_in: 'Checked In',
  diagnosed: 'Diagnosed',
  awaiting_parts: 'Awaiting Parts',
  in_repair: 'In Repair',
  qc: 'Quality Check',
  ready: 'Ready for Pickup',
  completed: 'Completed'
};

const STATUS_ORDER = ['checked_in', 'diagnosed', 'awaiting_parts', 'in_repair', 'qc', 'ready', 'completed'];

let tickets = [];
let activeStatusFilter = 'all';
let activeSearch = '';
let currentPage = 'list';

export function init() {}

let pendingDeepLinkId = null;

// Called by other views (e.g., customer profile) to request that we open a
// specific ticket's detail view after navigating to #tickets.
export function requestTicket(ticketId) {
  pendingDeepLinkId = ticketId;
}

export async function render() {
  try { tickets = await listTickets(); } catch (err) { console.error(err); tickets = []; }
  if (pendingDeepLinkId) {
    const id = pendingDeepLinkId;
    pendingDeepLinkId = null;
    return showDetail(id);
  }
  if (currentPage === 'list') renderList();
}

export function destroy() { currentPage = 'list'; }

function statusBadgeClass(status) {
  if (status === 'completed') return 'badge-success';
  if (status === 'ready') return 'badge-info';
  if (status === 'awaiting_parts') return 'badge-warning';
  return 'badge-default';
}

function renderList() {
  const container = document.getElementById('view-tickets');
  container.innerHTML = '';

  const topbar = document.createElement('div');
  topbar.className = 'view-topbar';
  topbar.innerHTML = `
    <input type="search" id="ticketsSearch" placeholder="Search by ticket #, customer, device..." style="flex:1;max-width:360px;padding:0.5rem 0.75rem;border:1px solid var(--border);border-radius:6px;">
    ${canWrite() && hasFeature('checkin') ? `<a class="btn btn-primary" href="#checkin">+ Check In</a>` : ''}
  `;
  container.appendChild(topbar);

  const tabs = document.createElement('div');
  tabs.className = 'status-tabs';
  tabs.style.cssText = 'display:flex;gap:0.25rem;margin-bottom:1rem;flex-wrap:wrap;';
  ['all', ...STATUS_ORDER].forEach(status => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost btn-sm' + (activeStatusFilter === status ? ' active' : '');
    btn.style.cssText = activeStatusFilter === status ? 'background:var(--accent);color:white;' : '';
    btn.textContent = status === 'all' ? 'All' : STATUS_LABELS[status];
    btn.addEventListener('click', () => { activeStatusFilter = status; renderList(); });
    tabs.appendChild(btn);
  });
  container.appendChild(tabs);

  const wrapper = document.createElement('div');
  wrapper.className = 'view-content';
  wrapper.id = 'ticketsContent';
  container.appendChild(wrapper);

  const searchInput = topbar.querySelector('#ticketsSearch');
  searchInput.value = activeSearch;
  searchInput.addEventListener('input', () => { activeSearch = searchInput.value.trim().toLowerCase(); renderTable(); });

  renderTable();
}

function renderTable() {
  const wrapper = document.getElementById('ticketsContent');
  if (!wrapper) return;

  let visible = tickets;
  if (activeStatusFilter !== 'all') visible = visible.filter(t => t.status === activeStatusFilter);
  if (activeSearch) {
    visible = visible.filter(t =>
      (t.ticketNumber || '').toLowerCase().includes(activeSearch) ||
      (t.customerName || '').toLowerCase().includes(activeSearch) ||
      (t.deviceType || '').toLowerCase().includes(activeSearch)
    );
  }

  if (visible.length === 0) {
    wrapper.innerHTML = tickets.length === 0
      ? '<div class="empty-state"><div class="empty-title">No tickets yet</div><p class="empty-description">Start by checking in a customer.</p>'
        + (hasFeature('checkin') ? '<a class="btn btn-primary" href="#checkin" style="margin-top:1rem;">Check In a Customer</a>' : '')
        + '</div>'
      : '<div class="empty-state"><p class="empty-description">No tickets match your filters.</p></div>';
    return;
  }

  wrapper.innerHTML = '';
  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = `
    <thead><tr>
      <th>Ticket #</th><th>Customer</th><th>Device</th>
      <th>Status</th><th>Age</th><th>Created</th>
    </tr></thead>
  `;
  const tbody = document.createElement('tbody');
  visible.forEach(t => {
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    const ageDays = t.createdAt && t.createdAt.toDate
      ? Math.floor((Date.now() - t.createdAt.toDate().getTime()) / 86400000)
      : '-';
    const statusCell = canWrite()
      ? `<select class="inline-status" data-id="${t.id}" data-prev="${escapeHtml(t.status || '')}" onclick="event.stopPropagation();">
          ${STATUS_ORDER.map(s => `<option value="${s}" ${t.status === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
        </select>`
      : `<span class="badge ${statusBadgeClass(t.status)}">${escapeHtml(STATUS_LABELS[t.status] || t.status || '-')}</span>`;
    tr.innerHTML = `
      <td style="font-family:monospace;font-weight:500;">${escapeHtml(t.ticketNumber || '-')}</td>
      <td>${escapeHtml(t.customerName || '-')}</td>
      <td>${escapeHtml(t.deviceType || '-')}</td>
      <td>${statusCell}</td>
      <td>${ageDays === '-' ? '-' : ageDays + 'd'}</td>
      <td>${formatDate(t.createdAt)}</td>
    `;
    tr.addEventListener('click', (e) => {
      if (e.target.closest('.inline-status')) return;
      showDetail(t.id);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrapper.appendChild(table);

  wrapper.querySelectorAll('.inline-status').forEach(sel => {
    sel.addEventListener('change', gateWrite(async (e) => {
      const ticketId = sel.dataset.id;
      const prevStatus = sel.dataset.prev;
      const newStatus = sel.value;
      if (newStatus === prevStatus) return;
      sel.disabled = true;
      try {
        await updateTicket(ticketId, { status: newStatus });
        await appendTicketHistory(ticketId, {
          type: 'status_change',
          description: `Status changed from ${STATUS_LABELS[prevStatus] || prevStatus} to ${STATUS_LABELS[newStatus] || newStatus}`
        });
        sel.dataset.prev = newStatus;
        // Update local cache
        const idx = tickets.findIndex(t => t.id === ticketId);
        if (idx >= 0) tickets[idx] = { ...tickets[idx], status: newStatus };
      } catch (err) {
        console.error('Status change failed:', err);
        alert('Failed to update status: ' + err.message);
        sel.value = prevStatus;
      } finally {
        sel.disabled = false;
      }
    }));
  });
}

let detailState = null; // { ticket, parts }

async function showDetail(ticketId) {
  currentPage = 'detail';
  const container = document.getElementById('view-tickets');
  container.innerHTML = '<div class="loading">Loading ticket...</div>';

  try {
    const ticket = await getTicket(ticketId);
    if (!ticket) { container.innerHTML = '<p>Ticket not found.</p>'; return; }
    const parts = hasFeature('inventory') ? await listParts() : [];
    detailState = { ticket, parts };
    renderDetail();
  } catch (err) {
    console.error('Load ticket failed:', err);
    container.innerHTML = `<p style="color:var(--danger);">Failed to load ticket: ${escapeHtml(err.message)}</p>`;
  }
}

function renderDetail() {
  const container = document.getElementById('view-tickets');
  const { ticket, parts } = detailState;
  container.innerHTML = '';

  const backBtn = document.createElement('button');
  backBtn.className = 'detail-back';
  backBtn.innerHTML = '&larr; Back to tickets';
  backBtn.addEventListener('click', () => { currentPage = 'list'; renderList(); });
  container.appendChild(backBtn);

  const header = document.createElement('div');
  header.className = 'detail-header';
  header.innerHTML = `
    <div style="flex:1;">
      <div class="detail-name">${escapeHtml(ticket.ticketNumber)} &middot; ${escapeHtml(ticket.deviceType || '')}</div>
      <div class="detail-subtitle">${escapeHtml(ticket.customerName || '-')} &middot; <span class="badge ${statusBadgeClass(ticket.status)}">${escapeHtml(STATUS_LABELS[ticket.status] || ticket.status)}</span></div>
    </div>
    ${canWrite() ? '<button class="btn btn-ghost delete-ticket-btn" style="color:var(--danger);">Delete Ticket</button>' : ''}
  `;
  container.appendChild(header);

  const deleteBtn = header.querySelector('.delete-ticket-btn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', gateWrite(async () => {
      if (!confirm(`Delete ticket ${ticket.ticketNumber}?\n\nThis cannot be undone. Any parts already pulled from inventory will stay pulled.`)) return;

      // If there's a linked invoice, ask whether to also delete it
      let alsoDeleteInvoice = false;
      if (ticket.invoiceId) {
        alsoDeleteInvoice = confirm(
          `This ticket has a linked invoice. Also delete the invoice?\n\n` +
          `• OK  — delete the invoice too (use for drafts or mistakes)\n` +
          `• Cancel — keep the invoice (use if the customer was already billed/paid)`
        );
      }

      try {
        if (alsoDeleteInvoice && ticket.invoiceId) {
          try { await deleteDocument('invoices_crm', ticket.invoiceId); }
          catch (e) {
            console.warn('Linked invoice delete failed:', e.message);
            if (!confirm('Failed to delete the linked invoice. Delete the ticket anyway?')) return;
          }
        }
        await deleteTicket(ticket.id);
        currentPage = 'list';
        await render();
      } catch (err) {
        console.error('Delete ticket failed:', err);
        alert('Failed to delete ticket: ' + err.message);
      }
    }));
  }

  // ── Status + core fields ──
  const coreSection = document.createElement('div');
  coreSection.className = 'settings-section';
  coreSection.innerHTML = `
    <h3 class="section-title">Details</h3>
    <div class="modal-form-grid">
      <div class="modal-field">
        <label>Status</label>
        <select name="status" ${canWrite() ? '' : 'disabled'}>
          ${STATUS_ORDER.map(s => `<option value="${s}" ${ticket.status === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
        </select>
      </div>
      <div class="modal-field">
        <label>Estimated Completion</label>
        <input type="date" name="estimatedCompletion" ${canWrite() ? '' : 'disabled'} value="${formatDateInput(ticket.estimatedCompletion)}">
      </div>
    </div>
    ${renderDevicePicker({ idPrefix: 'ticketDevice', initialValue: ticket.deviceType || '', disabled: !canWrite(), required: false })}
    <div class="modal-field"><label>Serial / IMEI</label><input type="text" name="serial" ${canWrite() ? '' : 'disabled'} value="${escapeHtml(ticket.serial || '')}"></div>
    <div class="modal-field"><label>Issue</label><textarea name="issue" rows="2" ${canWrite() ? '' : 'disabled'}>${escapeHtml(ticket.issue || '')}</textarea></div>
    <div class="modal-field"><label>Condition Notes</label><textarea name="condition" rows="2" ${canWrite() ? '' : 'disabled'}>${escapeHtml(ticket.condition || '')}</textarea></div>
    <div class="modal-field"><label>Internal Notes</label><textarea name="notes" rows="3" ${canWrite() ? '' : 'disabled'}>${escapeHtml(ticket.notes || '')}</textarea></div>
    ${canWrite() ? '<button class="btn btn-primary btn-sm" id="saveCoreBtn">Save Changes</button>' : ''}
  `;
  container.appendChild(coreSection);

  attachDevicePickerHandlers(coreSection, 'ticketDevice');

  const saveBtn = coreSection.querySelector('#saveCoreBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', gateWrite(async () => {
      const patch = {
        status: coreSection.querySelector('[name="status"]').value,
        estimatedCompletion: coreSection.querySelector('[name="estimatedCompletion"]').value || null,
        serial: coreSection.querySelector('[name="serial"]').value,
        deviceType: getDevicePickerValue(coreSection, 'ticketDevice') || ticket.deviceType || '',
        issue: coreSection.querySelector('[name="issue"]').value,
        condition: coreSection.querySelector('[name="condition"]').value,
        notes: coreSection.querySelector('[name="notes"]').value
      };
      try {
        const statusChanged = patch.status !== ticket.status;
        await updateTicket(ticket.id, patch);
        if (statusChanged) {
          await appendTicketHistory(ticket.id, {
            type: 'status_change',
            description: `Status changed from ${STATUS_LABELS[ticket.status] || ticket.status} to ${STATUS_LABELS[patch.status] || patch.status}`
          });
        }
        const refreshed = await getTicket(ticket.id);
        detailState.ticket = refreshed;
        renderDetail();
      } catch (err) {
        alert('Save failed: ' + err.message);
      }
    }));
  }

  // ── Parts section ──
  const partsSection = document.createElement('div');
  partsSection.className = 'settings-section';
  partsSection.style.marginTop = '1rem';

  if (hasFeature('inventory')) {
    // Pro tier — inventory-linked parts picker
    let partsHtml = `<h3 class="section-title">Parts Used</h3>`;
    if ((ticket.partsUsed || []).length === 0) {
      partsHtml += `<p style="color:var(--gray);font-size:0.9rem;">No parts added yet.</p>`;
    } else {
      partsHtml += `<table class="data-table"><thead><tr><th>SKU</th><th>Name</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Unit Price</th><th style="text-align:right;">Amount</th><th></th></tr></thead><tbody>`;
      ticket.partsUsed.forEach((p, idx) => {
        const amount = (p.qty || 0) * (p.unitPrice || 0);
        partsHtml += `<tr>
          <td style="font-family:monospace;">${escapeHtml(p.sku || '-')}</td>
          <td>${escapeHtml(p.name || '-')}</td>
          <td style="text-align:right;">${p.qty || 0}</td>
          <td style="text-align:right;">${formatCurrency(p.unitPrice)}</td>
          <td style="text-align:right;">${formatCurrency(amount)}</td>
          <td style="text-align:right;">${canWrite() ? `<button class="btn btn-ghost btn-sm remove-part-btn" data-index="${idx}" style="color:var(--danger);">&times;</button>` : ''}</td>
        </tr>`;
      });
      partsHtml += `</tbody></table>`;
    }

    if (canWrite()) {
      partsHtml += `
        <div style="display:flex;gap:0.5rem;margin-top:0.75rem;align-items:flex-end;">
          <div class="modal-field" style="flex:1;margin-bottom:0;">
            <label>Add Part</label>
            <select id="addPartSelect">
              <option value="">— Select a part —</option>
              ${parts.filter(p => (p.quantity || 0) > 0).map(p => `<option value="${p.id}" data-qty="${p.quantity}">${escapeHtml(p.name)} (${p.quantity} in stock)</option>`).join('')}
            </select>
          </div>
          <div class="modal-field" style="width:100px;margin-bottom:0;">
            <label>Qty</label>
            <input type="number" id="addPartQty" min="1" step="1" value="1">
          </div>
          <button class="btn btn-primary" id="addPartBtn" style="height:38px;">Add</button>
        </div>
      `;
    }

    partsSection.innerHTML = partsHtml;
    container.appendChild(partsSection);

    partsSection.querySelectorAll('.remove-part-btn').forEach(btn => {
      btn.addEventListener('click', gateWrite(async () => {
        const idx = Number(btn.dataset.index);
        if (!confirm('Remove this part? Stock will be returned to inventory.')) return;
        try {
          await removePartFromTicket(ticket.id, idx);
          await showDetail(ticket.id);
        } catch (err) { alert('Remove failed: ' + err.message); }
      }));
    });

    const addBtn = partsSection.querySelector('#addPartBtn');
    if (addBtn) {
      addBtn.addEventListener('click', gateWrite(async () => {
        const sel = partsSection.querySelector('#addPartSelect');
        const qtyInput = partsSection.querySelector('#addPartQty');
        const partId = sel.value;
        const qty = Number(qtyInput.value) || 0;
        if (!partId || qty <= 0) { alert('Select a part and enter a positive quantity.'); return; }
        try {
          await addPartToTicket(ticket.id, partId, qty);
          await showDetail(ticket.id);
        } catch (err) { alert(err.message); }
      }));
    }
  } else {
    // Basic tier — partsNotes textarea fallback (implemented in Task 6)
    renderBasicPartsSection(partsSection, ticket);
    container.appendChild(partsSection);
  }

  // ── Labor section ──
  const laborSection = document.createElement('div');
  laborSection.className = 'settings-section';
  laborSection.style.marginTop = '1rem';
  laborSection.innerHTML = `
    <h3 class="section-title">Labor</h3>
    <div style="display:flex;gap:0.5rem;align-items:flex-end;">
      <div class="modal-field" style="width:150px;margin-bottom:0;">
        <label>Minutes</label>
        <input type="number" id="laborInput" min="0" step="1" ${canWrite() ? '' : 'disabled'} value="${ticket.laborMinutes || 0}">
      </div>
      ${canWrite() ? `
      <button class="btn btn-ghost btn-sm" data-add="15">+15</button>
      <button class="btn btn-ghost btn-sm" data-add="30">+30</button>
      <button class="btn btn-ghost btn-sm" data-add="60">+60</button>
      <button class="btn btn-primary btn-sm" id="saveLaborBtn" style="margin-left:auto;">Save Labor</button>
      ` : ''}
    </div>
  `;
  container.appendChild(laborSection);
  const laborInput = laborSection.querySelector('#laborInput');
  laborSection.querySelectorAll('[data-add]').forEach(btn => {
    btn.addEventListener('click', () => {
      laborInput.value = (Number(laborInput.value) || 0) + Number(btn.dataset.add);
    });
  });
  const saveLaborBtn = laborSection.querySelector('#saveLaborBtn');
  if (saveLaborBtn) {
    saveLaborBtn.addEventListener('click', gateWrite(async () => {
      try {
        await updateTicket(ticket.id, { laborMinutes: Number(laborInput.value) || 0 });
        const refreshed = await getTicket(ticket.id);
        detailState.ticket = refreshed;
        renderDetail();
      } catch (err) { alert('Save labor failed: ' + err.message); }
    }));
  }

  // ── Warranty indicator if set ──
  if (ticket.warrantyExpiresAt) {
    const wEl = document.createElement('div');
    wEl.className = 'settings-section';
    wEl.style.marginTop = '1rem';
    const wDate = ticket.warrantyExpiresAt.toDate ? ticket.warrantyExpiresAt.toDate() : new Date(ticket.warrantyExpiresAt);
    const daysLeft = Math.ceil((wDate.getTime() - Date.now()) / 86400000);
    const statusColor = daysLeft < 0 ? 'var(--danger)' : daysLeft < 14 ? 'var(--warning)' : '#059669';
    const statusText = daysLeft < 0 ? `Expired ${Math.abs(daysLeft)} days ago` : daysLeft === 0 ? 'Expires today' : `${daysLeft} days remaining`;
    wEl.innerHTML = `
      <h3 class="section-title">Warranty</h3>
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.9rem;">
        <span>Expires: <strong>${wDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</strong></span>
        <span style="color:${statusColor};font-weight:500;">${statusText}</span>
      </div>
    `;
    container.appendChild(wEl);
  }

  // ── Invoice generation (Task 9 implements the button handler) ──
  const invoiceSection = renderInvoiceSection(ticket);
  if (invoiceSection) container.appendChild(invoiceSection);

  // ── History ──
  const historySection = document.createElement('div');
  historySection.className = 'settings-section';
  historySection.style.marginTop = '1rem';
  let historyHtml = '<h3 class="section-title">Activity</h3>';
  if (!ticket.history || ticket.history.length === 0) {
    historyHtml += '<p style="color:var(--gray);font-size:0.9rem;">No activity yet.</p>';
  } else {
    historyHtml += '<ul style="list-style:none;padding:0;margin:0;">';
    ticket.history.forEach(h => {
      historyHtml += `<li style="padding:0.5rem 0;border-bottom:1px solid var(--border);font-size:0.85rem;">
        <strong>${escapeHtml(h.description || '')}</strong>
        <div style="color:var(--gray);font-size:0.75rem;">${formatDate(h.at)} &middot; ${escapeHtml(h.byEmail || 'system')}</div>
      </li>`;
    });
    historyHtml += '</ul>';
  }
  historySection.innerHTML = historyHtml;
  container.appendChild(historySection);
}

// renderBasicPartsSection and renderInvoiceSection are added in later tasks
function renderBasicPartsSection(section, ticket) {
  section.innerHTML = `
    <h3 class="section-title">Parts Used</h3>
    <div class="modal-field">
      <label>Free-text parts log (e.g., "2× iPhone 14 screens — $120, 1× battery — $40")</label>
      <textarea id="partsNotesInput" rows="3" ${canWrite() ? '' : 'disabled'}>${escapeHtml(ticket.partsNotes || '')}</textarea>
    </div>
    ${canWrite() ? '<button class="btn btn-primary btn-sm" id="savePartsNotesBtn">Save Notes</button>' : ''}
  `;
  const saveBtn = section.querySelector('#savePartsNotesBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', gateWrite(async () => {
      const val = section.querySelector('#partsNotesInput').value;
      try {
        await updateTicket(ticket.id, { partsNotes: val });
        await appendTicketHistory(ticket.id, { type: 'note', description: 'Parts notes updated' });
      } catch (err) { alert('Save failed: ' + err.message); }
    }));
  }
}
function renderInvoiceSection(ticket) {
  if (!canWrite()) return null;
  const section = document.createElement('div');
  section.className = 'settings-section';
  section.style.marginTop = '1rem';

  if (ticket.invoiceId) {
    section.innerHTML = `
      <h3 class="section-title">Invoice</h3>
      <p style="font-size:0.9rem;color:var(--gray);">Invoice already generated.</p>
      <a class="btn btn-ghost btn-sm" href="#invoicing">View in Invoicing</a>
    `;
    return section;
  }

  if (ticket.status !== 'completed') {
    section.innerHTML = `
      <h3 class="section-title">Invoice</h3>
      <p style="font-size:0.9rem;color:var(--gray);">Set status to Completed to generate an invoice.</p>
    `;
    return section;
  }

  const DISCOUNT_REASONS = [
    'Promotional', 'Customer Satisfaction', 'Military', 'Veteran',
    'First Responder', 'Senior', 'Student', 'Loyalty / Returning',
    'Bulk / Multiple Devices', 'Employee', 'Referral'
  ];

  section.innerHTML = `
    <h3 class="section-title">Generate Invoice</h3>
    <p style="font-size:0.9rem;color:var(--gray);margin-bottom:0.75rem;">Creates an invoice from this ticket's parts and labor. Labor rate comes from your tenant settings.</p>

    <details style="margin-bottom:0.75rem;">
      <summary style="cursor:pointer;font-weight:500;padding:0.25rem 0;">Apply discount (optional)</summary>
      <div style="padding-top:0.5rem;">
        <div class="modal-form-grid">
          <div class="modal-field">
            <label>Reason</label>
            <select id="discountReason">
              <option value="">— None —</option>
              ${DISCOUNT_REASONS.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('')}
              <option value="__OTHER__">Other…</option>
            </select>
            <input type="text" id="discountReasonOther" placeholder="Custom reason" style="margin-top:0.5rem;display:none;">
          </div>
          <div class="modal-field">
            <label>Type</label>
            <select id="discountType">
              <option value="percent">% off</option>
              <option value="amount">$ off</option>
            </select>
          </div>
          <div class="modal-field">
            <label>Amount</label>
            <input type="number" id="discountValue" min="0" step="0.01" value="0">
          </div>
        </div>
      </div>
    </details>

    <button class="btn btn-primary" id="genInvoiceBtn">Generate Invoice</button>
  `;

  const reasonSel = section.querySelector('#discountReason');
  const reasonOther = section.querySelector('#discountReasonOther');
  reasonSel.addEventListener('change', () => {
    const isOther = reasonSel.value === '__OTHER__';
    reasonOther.style.display = isOther ? 'block' : 'none';
    if (!isOther) reasonOther.value = '';
  });

  const btn = section.querySelector('#genInvoiceBtn');
  btn.addEventListener('click', gateWrite(async () => {
    btn.disabled = true;
    btn.textContent = 'Generating...';

    try {
      const opts = {};
      if (!hasFeature('inventory') && (ticket.partsNotes || '').trim()) {
        const totalStr = prompt(
          'Enter the total parts charge for this ticket (the free-text notes will be used as the line description):',
          '0'
        );
        const total = Number(totalStr);
        if (!Number.isFinite(total) || total < 0) {
          alert('Cancelled — invalid amount.');
          btn.disabled = false;
          btn.textContent = 'Generate Invoice';
          return;
        }
        opts.basicPartsTotal = total;
        opts.basicPartsLabel = 'Parts: ' + ticket.partsNotes.trim();
      }

      // Discount
      const rawReason = reasonSel.value;
      const discountType = section.querySelector('#discountType').value;
      const discountValue = Number(section.querySelector('#discountValue').value) || 0;
      if (discountValue > 0) {
        let reason = rawReason;
        if (rawReason === '__OTHER__') {
          reason = (reasonOther.value || '').trim();
          if (!reason) {
            alert('Please enter a reason for the custom discount.');
            btn.disabled = false;
            btn.textContent = 'Generate Invoice';
            return;
          }
        }
        if (!reason) {
          alert('Please select a discount reason, or clear the amount.');
          btn.disabled = false;
          btn.textContent = 'Generate Invoice';
          return;
        }
        if (discountType === 'percent' && discountValue > 100) {
          alert('Percentage discount cannot exceed 100%.');
          btn.disabled = false;
          btn.textContent = 'Generate Invoice';
          return;
        }
        opts.discount = { reason, type: discountType, value: discountValue };
      }

      const { invoiceNumber } = await generateInvoiceFromTicket(ticket.id, opts);
      alert(`Invoice ${invoiceNumber} created.`);
      await showDetail(ticket.id);
    } catch (err) {
      alert('Invoice generation failed: ' + err.message);
      btn.disabled = false;
      btn.textContent = 'Generate Invoice';
    }
  }));

  return section;
}

function formatDateInput(ts) {
  if (!ts) return '';
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().split('T')[0];
  } catch { return ''; }
}

function escapeHtml(str) {
  if (str == null) return '';
  const node = document.createElement('span');
  node.appendChild(document.createTextNode(String(str)));
  return node.innerHTML;
}

function formatCurrency(amount) {
  if (amount == null || isNaN(amount)) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function formatDate(timestamp) {
  if (!timestamp) return '\u2014';
  try {
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    if (isNaN(date.getTime())) return '\u2014';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return '\u2014'; }
}
