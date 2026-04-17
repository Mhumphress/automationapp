import { listTickets, getTicket, createTicket, updateTicket, appendTicketHistory,
  addPartToTicket, removePartFromTicket, generateInvoiceFromTicket } from '../../services/tickets.js';
import { listParts } from '../../services/inventory.js';
import { canWrite, gateWrite, hasFeature } from '../../tenant-context.js';

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

export async function render() {
  try { tickets = await listTickets(); } catch (err) { console.error(err); tickets = []; }
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
    tr.innerHTML = `
      <td style="font-family:monospace;font-weight:500;">${escapeHtml(t.ticketNumber || '-')}</td>
      <td>${escapeHtml(t.customerName || '-')}</td>
      <td>${escapeHtml(t.deviceType || '-')}</td>
      <td><span class="badge ${statusBadgeClass(t.status)}">${escapeHtml(STATUS_LABELS[t.status] || t.status || '-')}</span></td>
      <td>${ageDays === '-' ? '-' : ageDays + 'd'}</td>
      <td>${formatDate(t.createdAt)}</td>
    `;
    tr.addEventListener('click', () => showDetail(t.id));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrapper.appendChild(table);
}

// showDetail is implemented in Task 5
function showDetail(ticketId) {
  console.log('showDetail stub — ticket', ticketId);
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
