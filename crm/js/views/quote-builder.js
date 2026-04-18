import { db } from '../config.js';
import { collection, getDocs, addDoc, serverTimestamp, query, orderBy } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { createDraft, updateDraft, sendQuote, getQuote } from '../services/quotes.js';
import { getVerticals, getPackagesByVertical, getAddons } from '../services/catalog.js';
import { showToast, escapeHtml, formatCurrency } from '../ui.js';

const ADDON_PRICE_MONTHLY = 'priceMonthly';

// State for the form
let formState = null;

export async function openBuilder(existingQuoteId, opts = {}) {
  // Make sure the quotes view is visible — the builder renders into #view-quotes.
  // Calling from any other screen would render into a hidden container otherwise.
  if (window.location.hash !== '#quotes') {
    window.location.hash = 'quotes';
  }
  const container = document.getElementById('view-quotes');
  container.innerHTML = '<div class="loading">Loading builder...</div>';

  const [verticals, addons, contactsSnap] = await Promise.all([
    getVerticals(),
    getAddons(),
    getDocs(query(collection(db, 'contacts'), orderBy('lastName', 'asc'))),
  ]);
  const contacts = contactsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  let existing = null;
  if (existingQuoteId) existing = await getQuote(existingQuoteId);

  // Pre-fill from opts.contact when starting a new quote from the customer page.
  const prefillContact = !existing && opts.contact ? opts.contact : null;
  const prefillSnapshot = prefillContact ? {
    firstName: prefillContact.firstName || '',
    lastName:  prefillContact.lastName  || '',
    email:     prefillContact.email     || '',
    phone:     prefillContact.phone     || '',
    company:   prefillContact.company   || prefillContact.companyName || '',
  } : null;

  formState = {
    id: existing?.id || null,
    contactId: existing?.contactId || (prefillContact ? prefillContact.id : ''),
    customerSnapshot: existing?.customerSnapshot || prefillSnapshot || { firstName: '', lastName: '', email: '', phone: '', company: '' },
    vertical: existing?.vertical || (verticals[0]?.id || ''),
    packageId: existing?.packageId || '',
    tier: existing?.tier || '',
    billingCycle: existing?.billingCycle || 'monthly',
    basePrice: existing?.basePrice || 0,
    priceOverride: existing?.priceOverride || null,
    userLimit: existing?.userLimit || 0,
    extraUsers: existing?.extraUsers || 0,
    addOns: existing?.addOns || [],
    laborHours: existing?.laborHours || 0,
    laborRate: existing?.laborRate || 125,
    laborDescription: existing?.laborDescription || '',
    lineItems: existing?.lineItems || [],
    discount: existing?.discount || { reason: '', type: 'percent', value: 0 },
    notes: existing?.notes || 'This quote is valid for 30 days. Payment due within 14 days of invoice.',
    status: existing?.status || 'draft',
    revision: existing?.revision || 0,
    dirty: false, // flips to true on first user edit after open
  };

  let packages = formState.vertical ? await getPackagesByVertical(formState.vertical) : [];

  container.innerHTML = '';
  container.appendChild(renderShell(existing, verticals, packages, addons, contacts));
  attachBuilderHandlers(verticals, packages, addons, contacts);
  recalc();
  // Track dirty AFTER initial render so programmatic input fills don't mark dirty
  setTimeout(() => wireDirtyTracker(), 0);
}

function renderShell(existing, verticals, packages, addons, contacts) {
  const wrap = document.createElement('div');
  wrap.className = 'builder-root';
  wrap.style.cssText = 'display:grid;grid-template-columns:1fr 320px;gap:1.5rem;align-items:flex-start;';

  wrap.innerHTML = `
    <div>
      <button class="detail-back" id="builderBack">&larr; Back to Quotes</button>
      <h2 style="font-family:var(--font-display);font-size:1.4rem;margin-bottom:1rem;">
        ${existing ? escapeHtml(existing.quoteNumber) : 'New Quote'}
      </h2>

      <!-- Customer -->
      <div class="settings-section">
        <h3 class="section-title">Customer</h3>
        <div class="modal-field">
          <label>Existing customer (autocomplete by name/email/phone)</label>
          <input type="text" id="customerSearch" placeholder="Start typing or leave blank for new customer" autocomplete="off">
          <div id="customerResults" style="position:relative;"></div>
        </div>
        <div class="modal-form-grid">
          <div class="modal-field"><label>First Name</label><input type="text" name="firstName" value="${escapeHtml(formState.customerSnapshot.firstName)}"></div>
          <div class="modal-field"><label>Last Name</label><input type="text" name="lastName" value="${escapeHtml(formState.customerSnapshot.lastName)}"></div>
        </div>
        <div class="modal-form-grid">
          <div class="modal-field"><label>Email</label><input type="email" name="email" value="${escapeHtml(formState.customerSnapshot.email)}"></div>
          <div class="modal-field"><label>Phone</label><input type="tel" name="phone" value="${escapeHtml(formState.customerSnapshot.phone)}"></div>
        </div>
        <div class="modal-field"><label>Company</label><input type="text" name="company" value="${escapeHtml(formState.customerSnapshot.company)}"></div>
      </div>

      <!-- Plan -->
      <div class="settings-section" style="margin-top:1rem;">
        <h3 class="section-title">Plan</h3>
        <div class="modal-form-grid">
          <div class="modal-field">
            <label>Vertical</label>
            <select id="verticalSel">
              ${verticals.map(v => `<option value="${escapeHtml(v.id)}" ${v.id === formState.vertical ? 'selected' : ''}>${escapeHtml(v.name)}</option>`).join('')}
            </select>
          </div>
          <div class="modal-field">
            <label>Package</label>
            <select id="packageSel">
              <option value="">— Select —</option>
              ${packages.map(p => `<option value="${escapeHtml(p.id)}" ${p.id === formState.packageId ? 'selected' : ''}>${escapeHtml(p.name)} · ${escapeHtml(p.tier)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="modal-form-grid">
          <div class="modal-field">
            <label>Billing Cycle</label>
            <select name="billingCycle">
              <option value="monthly" ${formState.billingCycle === 'monthly' ? 'selected' : ''}>Monthly</option>
              <option value="annual" ${formState.billingCycle === 'annual' ? 'selected' : ''}>Annual — 15% off</option>
            </select>
          </div>
          <div class="modal-field">
            <label>Price Override (optional)</label>
            <input type="number" name="priceOverride" min="0" step="0.01" value="${formState.priceOverride ?? ''}" placeholder="Leave blank to use package default">
          </div>
        </div>
        <div class="modal-form-grid">
          <div class="modal-field">
            <label>Included Users <span id="includedUsersLabel" style="color:var(--gray-dark);font-weight:400;">—</span></label>
            <input type="text" value="${formState.userLimit === 0 ? 'Unlimited' : formState.userLimit}" readonly style="background:var(--off-white);">
          </div>
          <div class="modal-field">
            <label>Extra Users <span style="color:var(--gray-dark);font-weight:400;">($3/mo each)</span></label>
            <input type="number" name="extraUsers" min="0" step="1" value="${formState.extraUsers || 0}">
          </div>
        </div>
      </div>

      <!-- Add-ons -->
      <div class="settings-section" style="margin-top:1rem;">
        <h3 class="section-title">Add-ons</h3>
        <div id="addonsList"></div>
      </div>

      <!-- Labor -->
      <div class="settings-section" style="margin-top:1rem;">
        <h3 class="section-title">Labor (setup / implementation)</h3>
        <div class="modal-form-grid">
          <div class="modal-field"><label>Hours</label><input type="number" name="laborHours" min="0" step="0.5" value="${formState.laborHours}"></div>
          <div class="modal-field"><label>Rate (per hour)</label><input type="number" name="laborRate" min="0" step="0.01" value="${formState.laborRate}"></div>
        </div>
        <div class="modal-field"><label>Description</label><textarea name="laborDescription" rows="2" placeholder="e.g., Data migration + 2-hour training">${escapeHtml(formState.laborDescription)}</textarea></div>
      </div>

      <!-- Line items -->
      <div class="settings-section" style="margin-top:1rem;">
        <h3 class="section-title">Line items (one-time custom work)</h3>
        <table class="data-table" id="lineItemsTable">
          <thead><tr><th>Description</th><th style="width:80px;">Qty</th><th style="width:100px;">Rate</th><th style="width:100px;">Amount</th><th style="width:40px;"></th></tr></thead>
          <tbody id="lineItemsBody"></tbody>
        </table>
        <button type="button" class="btn btn-ghost btn-sm" id="addLineBtn">+ Add Line</button>
      </div>

      <!-- Discount -->
      <div class="settings-section" style="margin-top:1rem;">
        <h3 class="section-title">Discount</h3>
        <div class="modal-form-grid">
          <div class="modal-field">
            <label>Reason</label>
            <input type="text" name="discountReason" value="${escapeHtml(formState.discount.reason)}" placeholder="e.g., Intro offer">
          </div>
          <div class="modal-field">
            <label>Type</label>
            <select name="discountType">
              <option value="percent" ${formState.discount.type === 'percent' ? 'selected' : ''}>% off</option>
              <option value="amount" ${formState.discount.type === 'amount' ? 'selected' : ''}>$ off</option>
            </select>
          </div>
          <div class="modal-field">
            <label>Value</label>
            <input type="number" name="discountValue" min="0" step="0.01" value="${formState.discount.value || 0}">
          </div>
        </div>
      </div>

      <!-- Terms -->
      <div class="settings-section" style="margin-top:1rem;">
        <h3 class="section-title">Terms & Notes</h3>
        <textarea name="notes" rows="4" style="width:100%;">${escapeHtml(formState.notes)}</textarea>
      </div>
    </div>

    <aside id="livePanel" style="position:sticky;top:1rem;background:#fff;border:1px solid var(--off-white);border-radius:12px;padding:1.25rem;"></aside>
  `;
  return wrap;
}

function attachBuilderHandlers(verticals, packages, addons, contacts) {
  const root = document.getElementById('view-quotes');

  root.querySelector('#builderBack').addEventListener('click', () => {
    import('./quotes.js').then(m => m.render());
  });

  // Customer autocomplete
  const searchInput = root.querySelector('#customerSearch');
  const resultsEl = root.querySelector('#customerResults');
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) { resultsEl.innerHTML = ''; return; }
    const normPhone = q.replace(/\D/g, '');
    const hits = contacts.filter(c =>
      ((c.firstName || '') + ' ' + (c.lastName || '')).toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.company || '').toLowerCase().includes(q) ||
      (normPhone && (c.phone || '').replace(/\D/g, '').includes(normPhone))
    ).slice(0, 5);
    resultsEl.innerHTML = hits.map(c => `
      <div class="autocomplete-row" data-id="${c.id}" style="padding:0.5rem;border:1px solid var(--off-white);border-top:none;cursor:pointer;background:#fff;">
        ${escapeHtml((c.firstName || '') + ' ' + (c.lastName || ''))} · ${escapeHtml(c.email || c.phone || '')} ${c.company ? '· ' + escapeHtml(c.company) : ''}
      </div>
    `).join('');
    resultsEl.querySelectorAll('.autocomplete-row').forEach(row => {
      row.addEventListener('click', () => {
        const c = contacts.find(x => x.id === row.dataset.id);
        if (!c) return;
        formState.contactId = c.id;
        formState.customerSnapshot = {
          firstName: c.firstName || '',
          lastName: c.lastName || '',
          email: c.email || '',
          phone: c.phone || '',
          // Contacts may have either the new `company` field or the legacy
          // `companyName` field (or both). Read whichever is populated so
          // the quote always carries the customer's business name.
          company: c.company || c.companyName || '',
        };
        root.querySelector('[name="firstName"]').value = formState.customerSnapshot.firstName;
        root.querySelector('[name="lastName"]').value = formState.customerSnapshot.lastName;
        root.querySelector('[name="email"]').value = formState.customerSnapshot.email;
        root.querySelector('[name="phone"]').value = formState.customerSnapshot.phone;
        root.querySelector('[name="company"]').value = formState.customerSnapshot.company;
        searchInput.value = `${formState.customerSnapshot.firstName} ${formState.customerSnapshot.lastName}`.trim();
        resultsEl.innerHTML = '';
      });
    });
  });

  // Customer fields overwrite snapshot (if user types directly)
  ['firstName', 'lastName', 'email', 'phone', 'company'].forEach(field => {
    root.querySelector(`[name="${field}"]`).addEventListener('input', (e) => {
      formState.customerSnapshot[field] = e.target.value;
      formState.contactId = null; // typing overrides selection — we'll create/find on save
    });
  });

  // Plan
  root.querySelector('#verticalSel').addEventListener('change', async (e) => {
    formState.vertical = e.target.value;
    const newPackages = await getPackagesByVertical(formState.vertical);
    const pkgSel = root.querySelector('#packageSel');
    pkgSel.innerHTML = '<option value="">— Select —</option>' +
      newPackages.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} · ${escapeHtml(p.tier)}</option>`).join('');
    formState.packageId = '';
    formState.basePrice = 0;
    formState.tier = '';
    renderAddons(addons);
    recalc();
  });
  root.querySelector('#packageSel').addEventListener('change', async (e) => {
    formState.packageId = e.target.value;
    if (formState.packageId) {
      const { getPackage } = await import('../services/catalog.js');
      const pkg = await getPackage(formState.packageId);
      if (pkg) {
        formState.basePrice = Number(pkg.basePrice) || 0;
        formState.tier = pkg.tier || '';
        formState.userLimit = Number(pkg.userLimit) || 0;
        // Reflect in the read-only included-users input
        const readOnlyInput = root.querySelector('.modal-field input[readonly]');
        if (readOnlyInput) readOnlyInput.value = formState.userLimit === 0 ? 'Unlimited' : formState.userLimit;
      }
    } else {
      formState.basePrice = 0; formState.tier = ''; formState.userLimit = 0;
    }
    renderAddons(addons);
    recalc();
  });
  root.querySelector('[name="billingCycle"]').addEventListener('change', (e) => { formState.billingCycle = e.target.value; recalc(); });
  root.querySelector('[name="priceOverride"]').addEventListener('input', (e) => { formState.priceOverride = e.target.value ? Number(e.target.value) : null; recalc(); });
  root.querySelector('[name="extraUsers"]').addEventListener('input', (e) => { formState.extraUsers = Math.max(0, Number(e.target.value) || 0); recalc(); });

  // Labor
  root.querySelector('[name="laborHours"]').addEventListener('input', (e) => { formState.laborHours = Number(e.target.value) || 0; recalc(); });
  root.querySelector('[name="laborRate"]').addEventListener('input', (e) => { formState.laborRate = Number(e.target.value) || 0; recalc(); });
  root.querySelector('[name="laborDescription"]').addEventListener('input', (e) => { formState.laborDescription = e.target.value; });

  // Line items
  renderLineItems();
  root.querySelector('#addLineBtn').addEventListener('click', () => {
    formState.lineItems.push({ description: '', quantity: 1, rate: 0, amount: 0 });
    renderLineItems();
  });

  // Discount
  root.querySelector('[name="discountReason"]').addEventListener('input', (e) => { formState.discount.reason = e.target.value; recalc(); });
  root.querySelector('[name="discountType"]').addEventListener('change', (e) => { formState.discount.type = e.target.value; recalc(); });
  root.querySelector('[name="discountValue"]').addEventListener('input', (e) => { formState.discount.value = Number(e.target.value) || 0; recalc(); });

  // Notes
  root.querySelector('[name="notes"]').addEventListener('input', (e) => { formState.notes = e.target.value; });

  renderAddons(addons);
  renderLivePanel();
}

function renderAddons(addons) {
  const list = document.getElementById('addonsList');
  if (!list) return;
  const applicable = addons.filter(a =>
    a.active !== false &&
    (!a.applicableVerticals || a.applicableVerticals.includes('all') || a.applicableVerticals.includes(formState.vertical))
  );
  if (applicable.length === 0) {
    list.innerHTML = '<p style="color:var(--gray);font-size:0.9rem;">Select a vertical to see applicable add-ons.</p>';
    return;
  }
  // Firestore addon docs were seeded with slug as the doc ID but not as a field
  // inside the doc. Use a.id when a.slug is missing so the rest of the flow
  // (state, handlers, dataset lookups) has a consistent identifier.
  const slugOf = (a) => a.slug || a.id;

  list.innerHTML = applicable.map(a => {
    const slug = slugOf(a);
    const selected = formState.addOns.find(x => x.slug === slug);
    const qty = selected?.qty || 1;
    return `
      <label style="display:flex;gap:0.75rem;align-items:center;padding:0.4rem 0;cursor:pointer;">
        <input type="checkbox" class="addon-check" data-slug="${escapeHtml(slug)}" ${selected ? 'checked' : ''}>
        <div style="flex:1;">${escapeHtml(a.name || slug)} <span style="color:var(--gray-dark);font-size:0.85rem;">${formatCurrency(a.priceMonthly || 0)}/mo</span></div>
        ${a.pricingModel === 'per_unit' ? `<input type="number" class="addon-qty" data-slug="${escapeHtml(slug)}" min="1" value="${qty}" style="width:70px;" ${selected ? '' : 'disabled'} onclick="event.stopPropagation();">` : ''}
      </label>
    `;
  }).join('');

  // Event delegation on the list element so handlers survive any re-render.
  list.onchange = (e) => {
    const target = e.target;
    if (target.classList.contains('addon-check')) {
      const slug = target.dataset.slug;
      const a = addons.find(x => slugOf(x) === slug);
      if (!a) { console.warn('addon not found for slug', slug); return; }
      if (target.checked) {
        formState.addOns.push({
          slug,
          name: a.name || slug,
          qty: 1,
          priceMonthly: Number(a.priceMonthly) || 0,
        });
        const qtyInput = list.querySelector(`.addon-qty[data-slug="${CSS.escape(slug)}"]`);
        if (qtyInput) qtyInput.disabled = false;
      } else {
        formState.addOns = formState.addOns.filter(x => x.slug !== slug);
        const qtyInput = list.querySelector(`.addon-qty[data-slug="${CSS.escape(slug)}"]`);
        if (qtyInput) qtyInput.disabled = true;
      }
      recalc();
    }
  };

  list.oninput = (e) => {
    const target = e.target;
    if (target.classList.contains('addon-qty')) {
      const slug = target.dataset.slug;
      const item = formState.addOns.find(x => x.slug === slug);
      if (item) item.qty = Math.max(1, Number(target.value) || 1);
      recalc();
    }
  };
}

function renderLineItems() {
  const tbody = document.getElementById('lineItemsBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  formState.lineItems.forEach((li, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" class="li-desc" data-i="${i}" value="${escapeHtml(li.description)}" style="width:100%;border:none;outline:none;"></td>
      <td><input type="number" class="li-qty" data-i="${i}" min="0" step="0.5" value="${li.quantity || 0}" style="width:100%;border:none;outline:none;text-align:right;"></td>
      <td><input type="number" class="li-rate" data-i="${i}" min="0" step="0.01" value="${li.rate || 0}" style="width:100%;border:none;outline:none;text-align:right;"></td>
      <td style="text-align:right;">${formatCurrency(li.amount || 0)}</td>
      <td><button type="button" class="btn btn-ghost btn-sm li-remove" data-i="${i}" style="color:var(--danger);">&times;</button></td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('.li-desc').forEach(el => el.addEventListener('input', e => { formState.lineItems[Number(e.target.dataset.i)].description = e.target.value; }));
  tbody.querySelectorAll('.li-qty').forEach(el => el.addEventListener('input', e => { const i = Number(e.target.dataset.i); formState.lineItems[i].quantity = Number(e.target.value) || 0; recalcLineItem(i); recalc(); }));
  tbody.querySelectorAll('.li-rate').forEach(el => el.addEventListener('input', e => { const i = Number(e.target.dataset.i); formState.lineItems[i].rate = Number(e.target.value) || 0; recalcLineItem(i); recalc(); }));
  tbody.querySelectorAll('.li-remove').forEach(el => el.addEventListener('click', e => { formState.lineItems.splice(Number(e.target.dataset.i), 1); renderLineItems(); recalc(); }));
}

function recalcLineItem(i) {
  const li = formState.lineItems[i];
  li.amount = (li.quantity || 0) * (li.rate || 0);
}

function recalc() {
  renderLineItems(); // refresh amount cells
  renderLivePanel();
}

const SEAT_PRICE_MONTHLY = 3;          // per extra user, per month
const ANNUAL_DISCOUNT = 0.15;          // 15% off when billed annually

function renderLivePanel() {
  const panel = document.getElementById('livePanel');
  if (!panel) return;

  const isAnnual = formState.billingCycle === 'annual';
  const cycleLabel = isAnnual ? 'yr' : 'mo';

  // All per-month values
  const planMonthly = formState.priceOverride ?? formState.basePrice ?? 0;
  const addonsMonthly = (formState.addOns || []).reduce((s, a) => s + (a.priceMonthly || 0) * (a.qty || 1), 0);
  const seatsMonthly = (formState.extraUsers || 0) * SEAT_PRICE_MONTHLY;
  const recurringMonthly = planMonthly + addonsMonthly + seatsMonthly;

  // Recurring in the chosen cycle (annual = 12× monthly × 0.85)
  const recurringFullYear = recurringMonthly * 12;
  const recurring = isAnnual
    ? Math.round(recurringFullYear * (1 - ANNUAL_DISCOUNT) * 100) / 100
    : recurringMonthly;
  const annualSavings = isAnnual ? Math.round((recurringFullYear - recurring) * 100) / 100 : 0;

  // Display values (each category in the chosen cycle)
  const planCycle = isAnnual ? planMonthly * 12 * (1 - ANNUAL_DISCOUNT) : planMonthly;
  const addonsCycle = isAnnual ? addonsMonthly * 12 * (1 - ANNUAL_DISCOUNT) : addonsMonthly;
  const seatsCycle = isAnnual ? seatsMonthly * 12 * (1 - ANNUAL_DISCOUNT) : seatsMonthly;

  // One-time items (labor + custom line items) are not discounted by annual billing
  const laborTotal = (formState.laborHours || 0) * (formState.laborRate || 0);
  const lineItemsTotal = (formState.lineItems || []).reduce((s, l) => s + (l.amount || 0), 0);
  const oneTime = laborTotal + lineItemsTotal;

  // Gross subtotal = one-time + full-recurring (pre annual-discount). This makes
  // the math readable in the totals block: subtotal − savings − discount = total.
  const grossRecurring = isAnnual ? recurringFullYear : recurringMonthly;
  const grossSubtotal = oneTime + grossRecurring;
  const subtotalAfterAnnual = grossSubtotal - annualSavings;

  // Customer discount (% or $) applies after annual savings
  let discount = 0;
  if (formState.discount.value > 0) {
    discount = formState.discount.type === 'percent'
      ? Math.round(subtotalAfterAnnual * (Math.min(formState.discount.value, 100) / 100) * 100) / 100
      : Math.min(formState.discount.value, subtotalAfterAnnual);
  }
  const totalToday = Math.max(0, subtotalAfterAnnual - discount);
  // Store the gross subtotal so the public page displays the same breakdown
  const subtotal = grossSubtotal;

  formState.subtotal = subtotal;
  formState.total = totalToday;
  formState.discountAmount = discount;
  formState.recurring = recurring;
  formState.recurringMonthly = recurringMonthly;
  formState.annualSavings = annualSavings;
  formState.seatMonthlyTotal = seatsMonthly;

  panel.innerHTML = `
    <h3 style="font-family:var(--font-display);font-size:1.1rem;margin:0 0 0.75rem;">Live Quote</h3>
    ${planCycle > 0 ? `<div class="tip-row"><span>${escapeHtml(formState.tier || 'Plan')}</span><strong>${formatCurrency(planCycle)}/${cycleLabel}</strong></div>` : ''}
    ${addonsCycle > 0 ? `<div class="tip-row"><span>Add-ons</span><strong>${formatCurrency(addonsCycle)}/${cycleLabel}</strong></div>` : ''}
    ${seatsCycle > 0 ? `<div class="tip-row"><span>Extra users (${formState.extraUsers || 0} × $3/mo)</span><strong>${formatCurrency(seatsCycle)}/${cycleLabel}</strong></div>` : ''}
    ${laborTotal > 0 ? `<div class="tip-row"><span>Labor (${formState.laborHours}h)</span><strong>${formatCurrency(laborTotal)}</strong></div>` : ''}
    ${lineItemsTotal > 0 ? `<div class="tip-row"><span>Custom work</span><strong>${formatCurrency(lineItemsTotal)}</strong></div>` : ''}
    <hr style="margin:0.5rem 0;border:none;border-top:1px solid var(--off-white);">
    <div class="tip-row"><span>Subtotal</span><strong>${formatCurrency(subtotal)}</strong></div>
    ${annualSavings > 0 ? `<div class="tip-row" style="color:#059669;font-size:0.85rem;"><span>Annual savings (15%)</span><strong>-${formatCurrency(annualSavings)}</strong></div>` : ''}
    ${discount > 0 ? `<div class="tip-row" style="color:#059669;"><span>Discount</span><strong>-${formatCurrency(discount)}</strong></div>` : ''}
    <div class="tip-row" style="font-size:1.15rem;padding-top:0.5rem;"><span>Total today</span><strong>${formatCurrency(totalToday)}</strong></div>
    <div class="tip-row" style="color:var(--gray-dark);font-size:0.85rem;"><span>Recurring</span><strong>${formatCurrency(recurring)}/${cycleLabel}</strong></div>
    <div style="display:flex;flex-direction:column;gap:0.5rem;margin-top:1rem;" id="sendActions">
      <!-- buttons rendered by updateSendButtons() -->
    </div>
    <style>
      .tip-row { display:flex; justify-content:space-between; padding:0.3rem 0; font-size:0.9rem; }
    </style>
  `;

  updateSendButtons();
}

function updateSendButtons() {
  const actions = document.getElementById('sendActions');
  if (!actions) return;

  const st = formState.status || 'draft';
  const isDraft = st === 'draft';
  const isSent = st === 'sent';
  const isTerminal = ['accepted', 'provisioned', 'declined', 'expired'].includes(st);
  const dirty = !!formState.dirty;
  const revision = Number(formState.revision) || 0;

  // Determine primary action
  let primary;
  if (isDraft) {
    primary = { label: 'Send to Customer →', disabled: false, action: 'send' };
  } else if (isSent && !dirty) {
    primary = { label: revision > 0 ? `Sent (revision ${revision})` : 'Sent', disabled: true, action: null };
  } else if (isSent && dirty) {
    primary = { label: `Send Revised Quote (#${revision + 1}) →`, disabled: false, action: 'revise' };
  } else if (isTerminal && !dirty) {
    const labelMap = { accepted: 'Accepted', provisioned: 'Provisioned', declined: 'Declined', expired: 'Expired' };
    primary = { label: labelMap[st] || st, disabled: true, action: null };
  } else if (isTerminal && dirty) {
    // Allow revising declined/expired quotes — forbid revising accepted/provisioned
    if (st === 'declined' || st === 'expired') {
      primary = { label: `Send Revised Quote (#${revision + 1}) →`, disabled: false, action: 'revise' };
    } else {
      primary = { label: st === 'accepted' ? 'Accepted (locked)' : 'Provisioned (locked)', disabled: true, action: null };
    }
  } else {
    primary = { label: 'Send to Customer →', disabled: false, action: 'send' };
  }

  const canEditDraft = isDraft || dirty; // can save changes to draft if this is draft OR edits pending

  actions.innerHTML = `
    <button type="button" class="btn btn-ghost" id="saveDraftBtn" ${canEditDraft ? '' : 'disabled'}>Save Draft</button>
    <button type="button" class="btn btn-primary" id="sendBtn" ${primary.disabled ? 'disabled' : ''} ${primary.disabled ? 'style="opacity:0.55;cursor:not-allowed;"' : ''}>${primary.label}</button>
  `;

  const saveBtn = actions.querySelector('#saveDraftBtn');
  if (saveBtn && !saveBtn.disabled) saveBtn.addEventListener('click', () => saveQuote(false));
  const sendBtn = actions.querySelector('#sendBtn');
  if (sendBtn && !sendBtn.disabled) {
    sendBtn.addEventListener('click', () => saveQuote(true, primary.action === 'revise'));
  }
}

// Mark form as dirty on any user input inside the builder root.
// Called once after the first paint.
function wireDirtyTracker() {
  const root = document.getElementById('view-quotes');
  if (!root || root._dirtyTracked) return;
  root._dirtyTracked = true;
  const handler = () => {
    if (!formState.dirty) {
      formState.dirty = true;
      updateSendButtons();
    }
  };
  root.addEventListener('input', handler, true);
  root.addEventListener('change', handler, true);
}

async function saveQuote(send, isRevision = false) {
  const btn = document.getElementById(send ? 'sendBtn' : 'saveDraftBtn');
  btn.disabled = true;
  btn.textContent = send ? (isRevision ? 'Sending revision…' : 'Sending…') : 'Saving…';

  try {
    // Ensure contact exists or create one
    let contactId = formState.contactId;
    if (!contactId) {
      if (!formState.customerSnapshot.firstName && !formState.customerSnapshot.lastName) {
        throw new Error('Please enter a customer name or pick an existing customer.');
      }
      const { addDocument } = await import('../services/firestore.js');
      // Write both company and companyName so legacy list views also see it
      const ref = await addDocument('contacts', {
        firstName: formState.customerSnapshot.firstName || '',
        lastName: formState.customerSnapshot.lastName || '',
        email: formState.customerSnapshot.email || '',
        phone: formState.customerSnapshot.phone || '',
        company: formState.customerSnapshot.company || '',
        companyName: formState.customerSnapshot.company || '',
      });
      contactId = ref.id;
    }

    const payload = {
      contactId,
      customerSnapshot: formState.customerSnapshot,
      vertical: formState.vertical,
      packageId: formState.packageId || null,
      tier: formState.tier,
      billingCycle: formState.billingCycle,
      basePrice: formState.basePrice,
      priceOverride: formState.priceOverride,
      userLimit: formState.userLimit || 0,
      extraUsers: formState.extraUsers || 0,
      seatMonthlyTotal: formState.seatMonthlyTotal || 0,
      recurringMonthly: formState.recurringMonthly || 0,
      recurring: formState.recurring || 0,
      annualSavings: formState.annualSavings || 0,
      addOns: formState.addOns,
      laborHours: formState.laborHours,
      laborRate: formState.laborRate,
      laborDescription: formState.laborDescription,
      lineItems: formState.lineItems,
      discount: { ...formState.discount, amount: formState.discountAmount || 0 },
      subtotal: formState.subtotal,
      total: formState.total,
      notes: formState.notes,
    };

    // If sending a revision, bump the revision number that gets persisted.
    if (send && isRevision) {
      payload.revision = (Number(formState.revision) || 0) + 1;
    } else if (send) {
      // First send — normalize to revision 1 so future edits know they're a v2
      payload.revision = Math.max(1, Number(formState.revision) || 1);
    } else {
      payload.revision = Number(formState.revision) || 0;
    }

    if (formState.id) {
      await updateDraft(formState.id, payload);
    } else {
      const { id } = await createDraft(payload);
      formState.id = id;
    }

    if (send) {
      const { url } = await sendQuote(formState.id);
      try { await navigator.clipboard.writeText(url); } catch {}
      const msg = isRevision
        ? `Revised quote (revision ${payload.revision}) sent — URL copied`
        : 'Quote sent — URL copied to clipboard';
      showToast(msg, 'success');
      // Reflect the new state in-place so the button greys out right away
      formState.revision = payload.revision;
      formState.status = 'sent';
      formState.dirty = false;
      updateSendButtons();
    } else {
      showToast('Draft saved', 'success');
      formState.revision = payload.revision;
      formState.dirty = false;
      updateSendButtons();
    }
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Save failed', 'error');
    updateSendButtons();
  }
}
