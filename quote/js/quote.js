import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// Minimal Firebase init (reads config from the CRM config file on same origin)
const cfgModule = await import('../../crm/js/config.js');
const db = cfgModule.db;

const params = new URLSearchParams(window.location.search);
const token = params.get('t');
const wrap = document.getElementById('quoteWrap');

if (!token) {
  renderError('Invalid link.', 'No quote token in the URL.');
} else {
  loadQuote();
}

async function loadQuote() {
  try {
    const brandPromise = getDoc(doc(db, 'settings', 'branding'))
      .catch(err => { console.warn('[quote] settings/branding read failed:', err.code || err.message); return null; });
    const [viewSnap, brandSnap] = await Promise.all([
      getDoc(doc(db, 'quote_views', token)),
      brandPromise,
    ]);
    console.log('[quote] branding doc:', brandSnap && brandSnap.exists() ? brandSnap.data() : '(missing or inaccessible)');
    if (!viewSnap.exists()) {
      renderError('Quote not found.', 'This link may be invalid or the quote may have been cancelled.');
      return;
    }
    const q = viewSnap.data();
    const brand = brandSnap && brandSnap.exists() ? brandSnap.data() : {};

    // Check expiry
    if (q.validUntil) {
      const until = q.validUntil.toDate ? q.validUntil.toDate() : new Date(q.validUntil);
      if (until < new Date()) {
        renderError('Quote expired.', 'This quote is past its validity date. Please contact us for a fresh quote.');
        return;
      }
    }
    renderQuote(q, brand);
  } catch (err) {
    console.error('Load quote failed:', err);
    renderError('Something went wrong.', err.message || 'Please try again or contact us directly.');
  }
}

function renderQuote(q, brand) {
  const cs = q.customerSnapshot || {};
  const brandName = brand.businessName || 'Your Business';
  const brandLogo = brand.logoUrl;
  const accent = brand.accent || brand.primaryColor || '#4F7BF7';
  document.documentElement.style.setProperty('--q-accent', accent);

  const planMonthly = q.priceOverride ?? q.basePrice ?? 0;
  const addonsMonthly = (q.addOns || []).reduce((s, a) => s + (a.priceMonthly || 0) * (a.qty || 1), 0);
  const seatsMonthly = q.seatMonthlyTotal || ((q.extraUsers || 0) * 3);
  const isAnnual = q.billingCycle === 'annual';
  const cycle = isAnnual ? 'yr' : 'mo';
  const ANNUAL_DISCOUNT = 0.15;

  // Show each line in the chosen cycle
  const plan = isAnnual ? planMonthly * 12 * (1 - ANNUAL_DISCOUNT) : planMonthly;
  const addonsTotal = isAnnual ? addonsMonthly * 12 * (1 - ANNUAL_DISCOUNT) : addonsMonthly;
  const seatsTotal = isAnnual ? seatsMonthly * 12 * (1 - ANNUAL_DISCOUNT) : seatsMonthly;
  const recurring = q.recurring || (isAnnual
    ? (planMonthly + addonsMonthly + seatsMonthly) * 12 * (1 - ANNUAL_DISCOUNT)
    : planMonthly + addonsMonthly + seatsMonthly);
  const annualSavings = q.annualSavings || (isAnnual
    ? (planMonthly + addonsMonthly + seatsMonthly) * 12 * ANNUAL_DISCOUNT
    : 0);

  const laborTotal = (q.laborHours || 0) * (q.laborRate || 0);
  const lineTotal = (q.lineItems || []).reduce((s, l) => s + (l.amount || 0), 0);
  const fullDate = q.validUntil ? (q.validUntil.toDate ? q.validUntil.toDate() : new Date(q.validUntil)) : null;

  wrap.innerHTML = `
    <header class="q-header">
      <div class="q-brand">
        ${brandLogo ? `<img src="${escapeAttr(brandLogo)}" alt="${escapeAttr(brandName)}">` : `<div class="q-brand-placeholder">${escapeHtml(brandName.charAt(0))}</div>`}
        <h1>${escapeHtml(brandName)}</h1>
      </div>
      <div class="q-meta">
        <div class="num">${escapeHtml(q.quoteNumber || '-')}</div>
        ${fullDate ? `<div>Valid until ${escapeHtml(fullDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }))}</div>` : ''}
      </div>
    </header>

    <section class="q-section">
      <h2>Prepared for</h2>
      <div class="q-field"><span class="label">Name</span><span>${escapeHtml((cs.firstName || '') + ' ' + (cs.lastName || ''))}</span></div>
      ${cs.company ? `<div class="q-field"><span class="label">Company</span><span>${escapeHtml(cs.company)}</span></div>` : ''}
      ${cs.email ? `<div class="q-field"><span class="label">Email</span><span>${escapeHtml(cs.email)}</span></div>` : ''}
      ${cs.phone ? `<div class="q-field"><span class="label">Phone</span><span>${escapeHtml(cs.phone)}</span></div>` : ''}
    </section>

    ${plan > 0 ? `
    <section class="q-section">
      <h2>Plan${isAnnual ? ' <span style="font-size:0.75rem;color:var(--q-ok);font-weight:500;">(annual — 15% off)</span>' : ''}</h2>
      <table class="q-table">
        <tr><td>${escapeHtml(q.tier || 'Subscription')}${q.userLimit ? ` · ${q.userLimit === 0 ? 'Unlimited' : q.userLimit} users included` : ''}</td><td class="num">${money(plan)}/${cycle}</td></tr>
        ${(q.addOns || []).map(a => {
          const mo = (a.priceMonthly || 0) * (a.qty || 1);
          const display = isAnnual ? mo * 12 * (1 - ANNUAL_DISCOUNT) : mo;
          return `<tr><td style="color:var(--q-muted);padding-left:1rem;">+ ${escapeHtml(a.name)}${a.qty > 1 ? ` × ${a.qty}` : ''}</td><td class="num">${money(display)}/${cycle}</td></tr>`;
        }).join('')}
        ${seatsMonthly > 0 ? `<tr><td style="color:var(--q-muted);padding-left:1rem;">+ Extra users (${q.extraUsers || 0} × $3/mo)</td><td class="num">${money(seatsTotal)}/${cycle}</td></tr>` : ''}
      </table>
    </section>` : ''}

    ${(laborTotal > 0 || lineTotal > 0) ? `
    <section class="q-section">
      <h2>One-time work</h2>
      <table class="q-table">
        <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
        <tbody>
          ${laborTotal > 0 ? `<tr><td>${escapeHtml(q.laborDescription || 'Labor')} </td><td class="num">${q.laborHours}</td><td class="num">${money(q.laborRate)}</td><td class="num">${money(laborTotal)}</td></tr>` : ''}
          ${(q.lineItems || []).map(l => `<tr><td>${escapeHtml(l.description || '')}</td><td class="num">${l.quantity || 0}</td><td class="num">${money(l.rate || 0)}</td><td class="num">${money(l.amount || 0)}</td></tr>`).join('')}
        </tbody>
      </table>
    </section>` : ''}

    <div class="q-totals">
      <div class="row"><span>Subtotal</span><span class="num">${money(q.subtotal || 0)}</span></div>
      ${annualSavings > 0 ? `<div class="row discount"><span>Annual savings (15% off)</span><span class="num">-${money(annualSavings)}</span></div>` : ''}
      ${q.discount && q.discount.amount > 0 ? `<div class="row discount"><span>Discount — ${escapeHtml(q.discount.reason || '')}</span><span class="num">-${money(q.discount.amount)}</span></div>` : ''}
      <div class="row grand"><span>Total today</span><span class="num">${money(q.total || 0)}</span></div>
      ${recurring > 0 ? `<div class="row recurring"><span>Renews at</span><span class="num">${money(recurring)}/${cycle}</span></div>` : ''}
    </div>

    ${q.notes ? `<div class="q-notes">${escapeHtml(q.notes)}</div>` : ''}

    <div class="q-actions">
      <button class="btn btn-ghost" id="declineBtn">Decline</button>
      <button class="btn btn-primary" id="acceptBtn">Accept Quote</button>
    </div>
  `;

  wrap.querySelector('#acceptBtn').addEventListener('click', () => respond('accepted'));
  wrap.querySelector('#declineBtn').addEventListener('click', () => respond('declined'));
}

async function respond(response) {
  const btn = document.getElementById(response === 'accepted' ? 'acceptBtn' : 'declineBtn');
  btn.disabled = true;

  let signatureName = '';
  if (response === 'accepted') {
    signatureName = prompt('Please type your full name to accept this quote:') || '';
    if (!signatureName.trim()) { btn.disabled = false; return; }
  }

  try {
    await setDoc(doc(db, 'quote_responses', token), {
      token,
      response,
      signatureName: signatureName.trim(),
      respondedAt: serverTimestamp(),
      userAgent: navigator.userAgent,
    });
    renderEnd(response);
  } catch (err) {
    console.error('Respond failed:', err);
    renderError('Could not submit.', err.message || 'Please try again.');
  }
}

function renderEnd(response) {
  if (response === 'accepted') {
    wrap.innerHTML = `
      <div class="q-end ok">
        <div class="icon">✓</div>
        <h2>Quote accepted</h2>
        <p>Your account is being set up. You'll receive an email shortly with your login details. Thanks!</p>
      </div>
    `;
  } else {
    wrap.innerHTML = `
      <div class="q-end">
        <div class="icon">×</div>
        <h2>Quote declined</h2>
        <p>Thanks for your time. If you change your mind, contact us for a fresh quote.</p>
      </div>
    `;
  }
}

function renderError(title, detail) {
  wrap.innerHTML = `
    <div class="q-end err">
      <div class="icon">!</div>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(detail)}</p>
    </div>
  `;
}

function money(n) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0); }
function escapeHtml(s) { if (s == null) return ''; const d = document.createElement('span'); d.textContent = String(s); return d.innerHTML; }
function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }
