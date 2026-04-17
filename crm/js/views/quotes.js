import { listQuotes } from '../services/quotes.js';
import { isAdmin } from '../services/roles.js';
import { showToast, escapeHtml, formatDate, formatCurrency } from '../ui.js';

let quotes = [];
let currentPage = 'list';
let searchTerm = '';

export async function init() {}
export function destroy() { currentPage = 'list'; }

export async function render() {
  const container = document.getElementById('view-quotes');
  container.innerHTML = '<div class="loading">Loading quotes...</div>';
  try { quotes = await listQuotes(); }
  catch (err) { console.error(err); quotes = []; }
  if (currentPage === 'list') renderList();
}

function renderList() {
  const container = document.getElementById('view-quotes');
  container.innerHTML = '';

  const topbar = document.createElement('div');
  topbar.className = 'view-topbar';
  topbar.innerHTML = `
    <input type="search" class="search-input" placeholder="Search quotes..." value="${escapeHtml(searchTerm)}" style="flex:1;max-width:360px;">
    <button class="btn btn-primary" id="newQuoteBtn">+ New Quote</button>
  `;
  container.appendChild(topbar);

  topbar.querySelector('.search-input').addEventListener('input', (e) => {
    searchTerm = e.target.value.trim().toLowerCase();
    renderTable();
  });
  topbar.querySelector('#newQuoteBtn').addEventListener('click', () => {
    import('./quote-builder.js').then(m => m.openBuilder(null));
  });

  const content = document.createElement('div');
  content.id = 'quotesContent';
  content.className = 'view-content';
  container.appendChild(content);

  renderTable();
}

function renderTable() {
  const content = document.getElementById('quotesContent');
  if (!content) return;

  let filtered = quotes;
  if (searchTerm) {
    filtered = filtered.filter(q =>
      (q.quoteNumber || '').toLowerCase().includes(searchTerm) ||
      ((q.customerSnapshot?.firstName || '') + ' ' + (q.customerSnapshot?.lastName || '')).toLowerCase().includes(searchTerm) ||
      (q.customerSnapshot?.company || '').toLowerCase().includes(searchTerm) ||
      (q.customerSnapshot?.email || '').toLowerCase().includes(searchTerm)
    );
  }

  if (filtered.length === 0) {
    content.innerHTML = quotes.length === 0
      ? '<div class="empty-state"><div class="empty-title">No quotes yet</div><p class="empty-description">Click + New Quote to create your first.</p></div>'
      : '<div class="empty-state"><p class="empty-description">No quotes match your search.</p></div>';
    return;
  }

  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = '<thead><tr><th>Quote #</th><th>Customer</th><th>Company</th><th>Total</th><th>Status</th><th>Sent</th></tr></thead>';
  const tbody = document.createElement('tbody');
  filtered.forEach(q => {
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    const cs = q.customerSnapshot || {};
    const statusClass = q.status === 'provisioned' ? 'badge-success'
      : q.status === 'accepted' ? 'badge-info'
      : q.status === 'sent' ? 'badge-default'
      : q.status === 'declined' || q.status === 'expired' ? 'badge-danger'
      : 'badge-default';
    tr.innerHTML = `
      <td style="font-family:monospace;font-weight:500;">${escapeHtml(q.quoteNumber || '-')}</td>
      <td>${escapeHtml((cs.firstName || '') + ' ' + (cs.lastName || ''))}</td>
      <td>${escapeHtml(cs.company || '-')}</td>
      <td>${formatCurrency(q.total || 0)}</td>
      <td><span class="badge ${statusClass}">${escapeHtml(q.status || 'draft')}</span></td>
      <td>${formatDate(q.sentAt)}</td>
    `;
    tr.addEventListener('click', () => {
      import('./quote-builder.js').then(m => m.openBuilder(q.id));
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  content.innerHTML = '';
  content.appendChild(table);
}
