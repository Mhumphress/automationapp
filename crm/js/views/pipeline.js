// Pipeline view — kanban visualization of the quotes collection. Same data
// as the Quotes list, just grouped by status into columns so you can see
// customers moving through the lifecycle at a glance. Clicking a card opens
// the quote builder for that quote.

import { listQuotes } from '../services/quotes.js';
import { escapeHtml, formatCurrency, formatDate } from '../ui.js';

let quotes = [];

const COLUMNS = [
  { id: 'draft',       label: 'Draft',       hint: 'Not yet sent' },
  { id: 'sent',        label: 'Sent',        hint: 'Awaiting customer' },
  { id: 'accepted',    label: 'Accepted',    hint: 'Provisioning…' },
  { id: 'provisioned', label: 'Provisioned', hint: 'Active customer' },
  { id: 'declined',    label: 'Declined',    hint: '' },
  { id: 'expired',     label: 'Expired',     hint: '' },
];

export async function init() {}
export function destroy() {}

export async function render() {
  const container = document.getElementById('view-pipeline');
  container.innerHTML = '<div class="loading">Loading pipeline…</div>';
  try { quotes = await listQuotes(); }
  catch (err) { console.error(err); quotes = []; }
  renderBoard();
}

function renderBoard() {
  const container = document.getElementById('view-pipeline');

  const openQuotes = quotes.filter(q => ['draft', 'sent', 'accepted'].includes(q.status));
  const openValue = openQuotes.reduce((s, q) => s + (Number(q.total) || 0), 0);
  const provisionedCount = quotes.filter(q => q.status === 'provisioned').length;
  const wonValue = quotes.filter(q => q.status === 'provisioned').reduce((s, q) => s + (Number(q.total) || 0), 0);

  const topbar = `
    <div class="view-topbar" style="flex-wrap:wrap;gap:1.5rem;">
      <div style="display:flex;gap:1.5rem;font-size:0.9rem;color:var(--gray-dark);flex-wrap:wrap;">
        <span><strong style="color:var(--black);">${openQuotes.length}</strong> open quotes · <strong style="color:var(--black);">${formatCurrency(openValue)}</strong> pipeline value</span>
        <span><strong style="color:var(--black);">${provisionedCount}</strong> provisioned · <strong style="color:var(--black);">${formatCurrency(wonValue)}</strong> closed-won</span>
      </div>
      <a class="btn btn-primary" href="#quotes" style="margin-left:auto;">+ New Quote</a>
    </div>
  `;

  const columnsHtml = COLUMNS.map(col => {
    const items = quotes.filter(q => (q.status || 'draft') === col.id);
    const colValue = items.reduce((s, q) => s + (Number(q.total) || 0), 0);
    return `
      <div class="kanban-col" data-col="${col.id}" style="flex:1;min-width:240px;background:var(--off-white);border-radius:10px;padding:0.75rem;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:0.5rem;">
          <div>
            <div style="font-weight:600;font-size:0.85rem;text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(col.label)}</div>
            <div style="font-size:0.7rem;color:var(--gray-dark);">${escapeHtml(col.hint)}</div>
          </div>
          <div style="text-align:right;font-size:0.8rem;color:var(--gray-dark);">
            <div><strong style="color:var(--black);">${items.length}</strong></div>
            <div>${formatCurrency(colValue)}</div>
          </div>
        </div>
        <div class="kanban-cards" style="display:flex;flex-direction:column;gap:0.5rem;min-height:80px;">
          ${items.length === 0
            ? `<div style="color:var(--gray);font-size:0.8rem;padding:0.5rem 0.25rem;">No quotes in this stage.</div>`
            : items.map(q => renderCard(q)).join('')}
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    ${topbar}
    <div style="display:flex;gap:0.75rem;overflow-x:auto;padding-bottom:0.5rem;">
      ${columnsHtml}
    </div>
  `;

  container.querySelectorAll('.kanban-card').forEach(card => {
    card.addEventListener('click', async () => {
      const id = card.dataset.id;
      const m = await import('./quote-builder.js');
      m.openBuilder(id);
    });
  });
}

function renderCard(q) {
  const cs = q.customerSnapshot || {};
  const name = `${cs.firstName || ''} ${cs.lastName || ''}`.trim() || '—';
  const company = cs.company || '';
  const sentStr = q.sentAt ? formatDate(q.sentAt) : null;
  const validUntil = q.validUntil ? formatDate(q.validUntil) : null;

  return `
    <div class="kanban-card" data-id="${escapeHtml(q.id)}"
         style="background:#fff;border:1px solid var(--off-white);border-radius:8px;padding:0.65rem 0.75rem;cursor:pointer;transition:transform 0.12s ease, box-shadow 0.12s ease;"
         onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 4px 14px rgba(15,23,42,0.06)';"
         onmouseout="this.style.transform='';this.style.boxShadow='';">
      <div style="display:flex;justify-content:space-between;gap:0.5rem;align-items:baseline;">
        <span style="font-family:var(--font-mono);font-size:0.75rem;color:var(--gray-dark);">${escapeHtml(q.quoteNumber || '-')}</span>
        <strong style="font-family:var(--font-display);">${formatCurrency(q.total || 0)}</strong>
      </div>
      <div style="font-weight:500;margin-top:0.25rem;">${escapeHtml(name)}</div>
      ${company ? `<div style="font-size:0.8rem;color:var(--gray-dark);">${escapeHtml(company)}</div>` : ''}
      <div style="font-size:0.7rem;color:var(--gray);margin-top:0.35rem;display:flex;justify-content:space-between;gap:0.25rem;">
        <span>${sentStr ? `Sent ${escapeHtml(sentStr)}` : 'Not sent'}</span>
        ${validUntil && q.status === 'sent' ? `<span>Exp. ${escapeHtml(validUntil)}</span>` : ''}
      </div>
    </div>
  `;
}
