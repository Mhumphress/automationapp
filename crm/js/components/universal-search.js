// crm/js/components/universal-search.js
import { universalSearch, primeSearchCache } from '../services/search.js';
import { navigate } from '../router.js';
import { escapeHtml, formatCurrency } from '../ui.js';

let panelOpen = false;
let flatResults = [];
let activeIdx = -1;

export function mountUniversalSearch() {
  const host = document.getElementById('headerActions');
  if (!host) return;

  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;flex:1;max-width:520px;';
  wrap.innerHTML = `
    <input type="search" id="usSearchInput" placeholder="Search — customers, quotes, invoices, tenants…  ( / )" style="width:100%;padding:0.55rem 0.9rem;border:1px solid var(--off-white);border-radius:8px;font-size:0.9rem;background:#fff;">
    <div id="usPanel" style="display:none;position:absolute;top:110%;left:0;right:0;background:#fff;border:1px solid var(--off-white);border-radius:10px;box-shadow:0 16px 40px rgba(15,23,42,0.08);z-index:500;max-height:400px;overflow-y:auto;"></div>
  `;
  host.appendChild(wrap);

  const input = wrap.querySelector('#usSearchInput');
  const panel = wrap.querySelector('#usPanel');

  primeSearchCache();

  input.addEventListener('input', async () => {
    const q = input.value.trim();
    if (!q) { panel.style.display = 'none'; panelOpen = false; return; }
    const results = await universalSearch(q);
    renderResults(panel, results);
    panel.style.display = 'block';
    panelOpen = true;
    activeIdx = -1;
  });

  input.addEventListener('keydown', (e) => {
    if (!panelOpen) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(flatResults.length - 1, activeIdx + 1); updateActive(panel); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(0, activeIdx - 1); updateActive(panel); }
    else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); selectResult(flatResults[activeIdx]); }
    else if (e.key === 'Escape') { panel.style.display = 'none'; panelOpen = false; input.blur(); }
  });

  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) { panel.style.display = 'none'; panelOpen = false; }
  });

  // Global keybindings: "/" and Cmd/Ctrl+K
  document.addEventListener('keydown', (e) => {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if ((e.key === '/' && !inField) || ((e.metaKey || e.ctrlKey) && e.key === 'k')) {
      e.preventDefault();
      input.focus(); input.select();
    }
  });
}

function renderResults(panel, results) {
  flatResults = [];
  let html = '';
  const sections = [
    { key: 'contacts', label: 'Customers', items: results.contacts, render: c => `${escapeHtml((c.firstName || '') + ' ' + (c.lastName || ''))} · ${escapeHtml(c.email || c.phone || '—')}${c.company ? ' · ' + escapeHtml(c.company) : ''}` },
    { key: 'quotes', label: 'Quotes', items: results.quotes, render: q => `${escapeHtml(q.quoteNumber)} · ${escapeHtml((q.customerSnapshot?.firstName || '') + ' ' + (q.customerSnapshot?.lastName || ''))} · ${formatCurrency(q.total)} · ${escapeHtml(q.status || 'draft')}` },
    { key: 'invoices', label: 'Invoices', items: results.invoices, render: i => `${escapeHtml(i.invoiceNumber || '-')} · ${escapeHtml(i.clientName || '-')} · ${formatCurrency(i.total)} · ${escapeHtml(i.status || 'draft')}` },
    { key: 'tenants', label: 'Tenants', items: results.tenants, render: t => `${escapeHtml(t.companyName || '-')} · ${escapeHtml(t.status || '-')}` },
  ];
  for (const sec of sections) {
    if (sec.items.length === 0) continue;
    html += `<div style="padding:0.35rem 0.9rem;font-size:0.7rem;color:var(--gray-dark);text-transform:uppercase;letter-spacing:0.05em;font-weight:600;background:#fafafa;border-bottom:1px solid var(--off-white);">${sec.label}</div>`;
    sec.items.forEach(item => {
      const idx = flatResults.length;
      flatResults.push({ kind: sec.key, item });
      html += `<div class="us-row" data-idx="${idx}" style="padding:0.55rem 0.9rem;cursor:pointer;border-bottom:1px solid var(--off-white);font-size:0.9rem;">${sec.render(item)}</div>`;
    });
  }
  if (flatResults.length === 0) {
    html = '<div style="padding:1rem;color:var(--gray-dark);font-size:0.9rem;">No results.</div>';
  }
  panel.innerHTML = html;
  panel.querySelectorAll('.us-row').forEach(row => {
    row.addEventListener('mouseenter', () => { activeIdx = Number(row.dataset.idx); updateActive(panel); });
    row.addEventListener('click', () => selectResult(flatResults[Number(row.dataset.idx)]));
  });
}

function updateActive(panel) {
  panel.querySelectorAll('.us-row').forEach((row, i) => {
    row.style.background = i === activeIdx ? 'var(--off-white)' : '';
  });
}

function selectResult({ kind, item }) {
  const input = document.getElementById('usSearchInput');
  const panel = document.getElementById('usPanel');
  input.value = '';
  panel.style.display = 'none';
  panelOpen = false;

  // Navigate using the router + deep-link state
  if (kind === 'contacts') {
    navigate('contacts');
    // Best-effort scroll/select via location hash + timeout
    setTimeout(() => {
      const row = document.querySelector(`[data-contact-id="${item.id}"]`);
      if (row) row.click();
    }, 200);
  } else if (kind === 'quotes') {
    navigate('quotes');
    setTimeout(() => {
      import('../views/quote-builder.js').then(m => m.openBuilder(item.id));
    }, 100);
  } else if (kind === 'invoices') {
    navigate('invoices');
  } else if (kind === 'tenants') {
    navigate('tenants');
  }
}
