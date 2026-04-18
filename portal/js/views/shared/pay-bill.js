// ─────────────────────────────────────────────────────────────────
//  pay-bill.js — "Pay Bill" modal for the portal Billing page.
//
//  Supports card (Visa / Mastercard / Amex / Discover auto-detected),
//  Apple Pay, Google Pay, and ACH. For now submissions write a
//  payment_intent doc to Firestore — no real charge is processed.
//  When Stripe is wired, this file swaps out the local `submit` for
//  a Stripe Elements confirmPayment() call; the rest of the UX stays.
//
//  SECURITY: full card numbers and CVCs are NEVER persisted. We store
//  only brand + last 4 + cardholder name + expiry + billing ZIP, the
//  same shape Stripe exposes on a PaymentMethod.
// ─────────────────────────────────────────────────────────────────

import { db, auth } from '../../config.js';
import {
  collection, addDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getTenant } from '../../tenant-context.js';

/**
 * Open the Pay Bill modal.
 *
 * @param {object} opts
 * @param {object|null} opts.invoice   The invoice to pay. If null, the user
 *                                     picks from the "pay balance" screen.
 * @param {Array}  [opts.allInvoices]  Used when no specific invoice is set —
 *                                     user can pay against multiple.
 * @returns {Promise<{ submitted: boolean, intentId?: string }>}
 */
export function openPayBill(opts) {
  const tenant = getTenant();
  if (!tenant) {
    alert('No tenant context loaded.');
    return Promise.resolve({ submitted: false });
  }

  const { invoice = null, allInvoices = [] } = opts || {};
  const amount = invoice ? balanceOf(invoice) : (allInvoices.reduce((s, i) => s + balanceOf(i), 0) || 0);

  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop open';
    backdrop.innerHTML = `
      <div class="modal-dialog pay-bill-dialog">
        <div class="modal-header">
          <h2 class="modal-title">Pay Bill</h2>
          <button class="modal-close" type="button">×</button>
        </div>
        <div class="modal-body" id="payBillBody"></div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const body = backdrop.querySelector('#payBillBody');
    const close = (result) => {
      backdrop.remove();
      resolve(result || { submitted: false });
    };
    backdrop.querySelector('.modal-close').addEventListener('click', () => close());
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

    renderStep1({ body, invoice, allInvoices, amount, tenant, close });
  });
}

// ── Step 1: amount + method selection + method-specific inputs ───

function renderStep1({ body, invoice, allInvoices, amount, tenant, close }) {
  let currentMethod = 'card';

  body.innerHTML = `
    <div class="pay-amount-block">
      <div class="pay-amount-label">Amount</div>
      <input type="number" step="0.01" min="0.01" class="pay-amount-input" value="${amount.toFixed(2)}">
      ${invoice ? `<div class="pay-invoice-label">Invoice ${escapeHtml(invoice.invoiceNumber || '-')}</div>` : ''}
    </div>

    <div class="pay-method-tabs">
      <button type="button" class="pay-method-tab active" data-method="card">
        ${cardGroupSVG()}
        <span>Card</span>
      </button>
      <button type="button" class="pay-method-tab" data-method="apple_pay">
        ${applePaySVG()}
        <span>Apple Pay</span>
      </button>
      <button type="button" class="pay-method-tab" data-method="google_pay">
        ${googlePaySVG()}
        <span>Google Pay</span>
      </button>
      <button type="button" class="pay-method-tab" data-method="ach">
        ${bankSVG()}
        <span>Bank (ACH)</span>
      </button>
    </div>

    <div class="pay-method-body" id="payMethodBody"></div>

    <div class="pay-security-row">
      <span class="pay-lock">🔒</span>
      <span>Your payment is transmitted over a secure connection. We never store your full card number or CVC.</span>
    </div>

    <div class="modal-actions" style="margin-top:0.75rem;">
      <button type="button" class="btn btn-primary btn-lg" id="paySubmitBtn">Pay ${fmtMoney(amount)}</button>
      <span class="modal-cancel">Cancel</span>
    </div>
  `;

  const amountInput = body.querySelector('.pay-amount-input');
  const submitBtn = body.querySelector('#paySubmitBtn');
  amountInput.addEventListener('input', () => {
    const v = Number(amountInput.value) || 0;
    submitBtn.textContent = `Pay ${fmtMoney(v)}`;
  });
  body.querySelector('.modal-cancel').addEventListener('click', () => close());

  // Method tabs
  body.querySelectorAll('.pay-method-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      body.querySelectorAll('.pay-method-tab').forEach(t => t.classList.toggle('active', t === tab));
      currentMethod = tab.dataset.method;
      renderMethodBody();
    });
  });

  function renderMethodBody() {
    const slot = body.querySelector('#payMethodBody');
    switch (currentMethod) {
      case 'card':       slot.innerHTML = cardFormHTML(); wireCardForm(slot); break;
      case 'apple_pay':  slot.innerHTML = walletBlockHTML('Apple Pay',
                           'Apple Pay available on supported devices. Tap the button below to authorize with Touch ID or Face ID.'); break;
      case 'google_pay': slot.innerHTML = walletBlockHTML('Google Pay',
                           'Google Pay available on supported devices. Tap the button below to authorize with your Google account.'); break;
      case 'ach':        slot.innerHTML = achFormHTML(); break;
    }
  }
  renderMethodBody();

  submitBtn.addEventListener('click', async () => {
    const payAmount = Number(amountInput.value) || 0;
    if (!(payAmount > 0)) { flash(body, 'Enter an amount greater than 0.'); return; }

    const payload = gatherPayload(currentMethod, body);
    if (!payload.ok) { flash(body, payload.error); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Processing...';
    try {
      const intentId = await writePaymentIntent({
        tenantId: tenant.id,
        invoice,
        amount: payAmount,
        method: currentMethod,
        info: payload.info,
      });
      renderStep2({ body, intentId, amount: payAmount, method: currentMethod, invoice, close });
    } catch (err) {
      console.error(err);
      submitBtn.disabled = false;
      submitBtn.textContent = `Pay ${fmtMoney(payAmount)}`;
      flash(body, 'Submission failed: ' + (err.message || 'Unknown error'));
    }
  });
}

// ── Step 2: confirmation ────────────────────────────────────────

function renderStep2({ body, intentId, amount, method, invoice, close }) {
  body.innerHTML = `
    <div class="pay-confirm">
      <div class="pay-confirm-icon">✓</div>
      <div class="pay-confirm-title">Payment submitted</div>
      <div class="pay-confirm-body">
        Thanks — your ${methodLabel(method)} payment of <strong>${fmtMoney(amount)}</strong>${invoice ? ` for <strong>${escapeHtml(invoice.invoiceNumber || 'invoice')}</strong>` : ''} is being processed.
        You'll see the status update on your Billing page once it clears.
      </div>
      <div class="pay-confirm-ref">Reference ID<br><code>${escapeHtml(intentId)}</code></div>
      <button type="button" class="btn btn-primary btn-lg" id="payCloseBtn">Done</button>
    </div>
  `;
  body.querySelector('#payCloseBtn').addEventListener('click', () => close({ submitted: true, intentId }));
}

// ── Card form ────────────────────────────────────────────────────

function cardFormHTML() {
  return `
    <div class="pay-card-form">
      <div class="pay-field">
        <label>Cardholder name</label>
        <input type="text" id="cardHolder" autocomplete="cc-name" placeholder="Name on card" required>
      </div>
      <div class="pay-field">
        <label>Card number</label>
        <div class="pay-card-number-wrap">
          <input type="text" id="cardNumber" inputmode="numeric" autocomplete="cc-number" placeholder="1234 1234 1234 1234" maxlength="23" required>
          <span class="pay-card-brand" id="cardBrandIndicator"></span>
        </div>
        <div class="pay-card-error" id="cardNumberError"></div>
      </div>
      <div class="pay-row-2">
        <div class="pay-field">
          <label>Expiry (MM/YY)</label>
          <input type="text" id="cardExpiry" inputmode="numeric" autocomplete="cc-exp" placeholder="MM/YY" maxlength="5" required>
          <div class="pay-card-error" id="cardExpiryError"></div>
        </div>
        <div class="pay-field">
          <label>CVC</label>
          <input type="text" id="cardCvc" inputmode="numeric" autocomplete="cc-csc" placeholder="CVC" maxlength="4" required>
          <div class="pay-card-error" id="cardCvcError"></div>
        </div>
      </div>
      <div class="pay-field">
        <label>Billing ZIP / Postal code</label>
        <input type="text" id="cardZip" autocomplete="postal-code" placeholder="10001" maxlength="10" required>
      </div>
      <div class="pay-accepted-row">
        We accept
        <span class="pay-brand-logos">
          ${visaSVG()}${mastercardSVG()}${amexSVG()}${discoverSVG()}
        </span>
      </div>
    </div>
  `;
}

function wireCardForm(root) {
  const numberInput = root.querySelector('#cardNumber');
  const expiryInput = root.querySelector('#cardExpiry');
  const cvcInput = root.querySelector('#cardCvc');
  const brandEl = root.querySelector('#cardBrandIndicator');
  const errNum = root.querySelector('#cardNumberError');
  const errExp = root.querySelector('#cardExpiryError');
  const errCvc = root.querySelector('#cardCvcError');

  // Auto-format card number: spaces every 4 (Amex: 4-6-5 pattern)
  numberInput.addEventListener('input', () => {
    const raw = numberInput.value.replace(/\D/g, '').slice(0, 19);
    const brand = detectCardBrand(raw);
    let formatted = raw;
    if (brand === 'amex') {
      formatted = raw.replace(/^(\d{0,4})(\d{0,6})(\d{0,5}).*$/, (_, a, b, c) => [a, b, c].filter(Boolean).join(' '));
    } else {
      formatted = raw.replace(/(\d{4})(?=\d)/g, '$1 ');
    }
    numberInput.value = formatted;
    brandEl.innerHTML = brand ? brandSvgFor(brand) : '';
    errNum.textContent = '';
  });
  numberInput.addEventListener('blur', () => {
    const raw = numberInput.value.replace(/\D/g, '');
    if (raw && !luhnValid(raw)) errNum.textContent = 'Card number looks invalid';
  });

  // Expiry MM/YY
  expiryInput.addEventListener('input', () => {
    let v = expiryInput.value.replace(/\D/g, '').slice(0, 4);
    if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2);
    expiryInput.value = v;
    errExp.textContent = '';
  });
  expiryInput.addEventListener('blur', () => {
    const match = expiryInput.value.match(/^(\d{2})\/(\d{2})$/);
    if (!match) { if (expiryInput.value) errExp.textContent = 'Use MM/YY format'; return; }
    const m = Number(match[1]), y = 2000 + Number(match[2]);
    if (m < 1 || m > 12) errExp.textContent = 'Month must be 01–12';
    else if (y < new Date().getFullYear() || (y === new Date().getFullYear() && m < new Date().getMonth() + 1)) {
      errExp.textContent = 'Card has expired';
    }
  });

  cvcInput.addEventListener('input', () => {
    cvcInput.value = cvcInput.value.replace(/\D/g, '').slice(0, 4);
    errCvc.textContent = '';
  });
  cvcInput.addEventListener('blur', () => {
    const raw = numberInput.value.replace(/\D/g, '');
    const brand = detectCardBrand(raw);
    const expectedLen = brand === 'amex' ? 4 : 3;
    if (cvcInput.value && cvcInput.value.length < expectedLen) {
      errCvc.textContent = brand === 'amex' ? '4-digit code for Amex' : '3-digit code';
    }
  });
}

// ── Apple Pay / Google Pay placeholder block ────────────────────

function walletBlockHTML(label, desc) {
  return `
    <div class="pay-wallet-block">
      <p>${escapeHtml(desc)}</p>
      <button type="button" class="pay-wallet-btn ${label === 'Apple Pay' ? 'apple' : 'google'}">
        ${label === 'Apple Pay' ? applePaySVG(22, 'white') : googlePaySVG(22, 'white')}
        <span>${label === 'Apple Pay' ? 'Pay with  Pay' : 'Buy with G Pay'}</span>
      </button>
      <div class="pay-wallet-note">Demo mode — tap "Pay" below to submit a pending payment intent.</div>
    </div>
  `;
}

// ── ACH form ────────────────────────────────────────────────────

function achFormHTML() {
  return `
    <div class="pay-card-form">
      <div class="pay-field">
        <label>Account holder name</label>
        <input type="text" id="achHolder" placeholder="Name on account" required>
      </div>
      <div class="pay-row-2">
        <div class="pay-field">
          <label>Routing number</label>
          <input type="text" id="achRouting" inputmode="numeric" placeholder="9-digit routing" maxlength="9" required>
        </div>
        <div class="pay-field">
          <label>Account number</label>
          <input type="text" id="achAccount" inputmode="numeric" placeholder="Account number" maxlength="17" required>
        </div>
      </div>
      <div class="pay-field">
        <label>Account type</label>
        <select id="achType">
          <option value="checking">Checking</option>
          <option value="savings">Savings</option>
        </select>
      </div>
      <div class="pay-security-row" style="margin-top:0.5rem;">
        <span>ACH transfers take 3–5 business days to clear.</span>
      </div>
    </div>
  `;
}

// ── Gather + validate method payload ────────────────────────────

function gatherPayload(method, body) {
  if (method === 'card') {
    const holder = body.querySelector('#cardHolder').value.trim();
    const numberRaw = body.querySelector('#cardNumber').value.replace(/\D/g, '');
    const expiry = body.querySelector('#cardExpiry').value.trim();
    const cvc = body.querySelector('#cardCvc').value.trim();
    const zip = body.querySelector('#cardZip').value.trim();
    if (!holder) return { ok: false, error: 'Enter the cardholder name.' };
    if (!luhnValid(numberRaw)) return { ok: false, error: 'Card number is invalid.' };
    const expMatch = expiry.match(/^(\d{2})\/(\d{2})$/);
    if (!expMatch) return { ok: false, error: 'Expiry must be MM/YY.' };
    const brand = detectCardBrand(numberRaw);
    const expectedCvcLen = brand === 'amex' ? 4 : 3;
    if (cvc.length < expectedCvcLen) return { ok: false, error: `CVC must be ${expectedCvcLen} digits.` };
    if (!zip) return { ok: false, error: 'Enter your billing ZIP.' };
    return {
      ok: true,
      info: {
        brand,
        last4: numberRaw.slice(-4),
        cardHolderName: holder,
        expMonth: Number(expMatch[1]),
        expYear: 2000 + Number(expMatch[2]),
        billingZip: zip,
      },
    };
  }
  if (method === 'ach') {
    const holder = body.querySelector('#achHolder').value.trim();
    const routing = body.querySelector('#achRouting').value.replace(/\D/g, '');
    const account = body.querySelector('#achAccount').value.replace(/\D/g, '');
    const accType = body.querySelector('#achType').value;
    if (!holder) return { ok: false, error: 'Enter the account holder name.' };
    if (routing.length !== 9) return { ok: false, error: 'Routing number must be 9 digits.' };
    if (account.length < 4) return { ok: false, error: 'Enter a valid account number.' };
    return {
      ok: true,
      info: {
        accountHolderName: holder,
        routingLast4: routing.slice(-4),
        accountLast4: account.slice(-4),
        accountType: accType,
      },
    };
  }
  // Wallet methods — no input needed from the user (real integration
  // would invoke the PaymentRequest API / Apple Pay JS here).
  return { ok: true, info: {} };
}

async function writePaymentIntent({ tenantId, invoice, amount, method, info }) {
  const user = auth.currentUser;
  const data = {
    invoiceId: invoice?.id || null,
    invoiceNumber: invoice?.invoiceNumber || null,
    amount: Number(amount),
    currency: 'USD',
    method,
    status: 'pending',
    statusMessage: 'Awaiting processor (demo mode — connect Stripe to process).',
    ...methodSpecificFields(method, info),
    customerName: user?.displayName || user?.email || '',
    customerEmail: user?.email || '',
    submittedAt: serverTimestamp(),
    submittedByUid: user?.uid || null,
    submittedByEmail: user?.email || '',
    stripePaymentIntentId: null,
    stripeChargeId: null,
    paymentRecordId: null,
  };
  const ref = await addDoc(collection(db, 'tenants', tenantId, 'payment_intents'), data);
  return ref.id;
}

function methodSpecificFields(method, info) {
  if (method === 'card') {
    return {
      cardBrand:       info.brand || null,
      cardLast4:       info.last4 || null,
      cardHolderName:  info.cardHolderName || null,
      cardExpMonth:    info.expMonth || null,
      cardExpYear:     info.expYear || null,
      billingZip:      info.billingZip || null,
    };
  }
  if (method === 'ach') {
    return {
      achAccountHolder: info.accountHolderName || null,
      achRoutingLast4:  info.routingLast4 || null,
      achAccountLast4:  info.accountLast4 || null,
      achAccountType:   info.accountType || null,
    };
  }
  // wallet — nothing extra to store; the processor hands back a token in real integration
  return {};
}

// ── Utilities ───────────────────────────────────────────────────

function balanceOf(inv) {
  const total = Math.abs(Number(inv.total || inv.amount || 0));
  const paid = Number(inv.paidAmount || 0);
  return Math.max(0, total - paid);
}

function fmtMoney(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0);
}

function detectCardBrand(num) {
  if (/^4/.test(num))                          return 'visa';
  if (/^(5[1-5]|2[2-7])/.test(num))            return 'mastercard';
  if (/^3[47]/.test(num))                      return 'amex';
  if (/^(6011|65|64[4-9]|622)/.test(num))      return 'discover';
  return null;
}

function luhnValid(num) {
  if (!num || num.length < 13) return false;
  const digits = num.split('').map(Number);
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits[digits.length - 1 - i];
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

function methodLabel(m) {
  return m === 'card' ? 'card' : m === 'apple_pay' ? 'Apple Pay' : m === 'google_pay' ? 'Google Pay' : m === 'ach' ? 'ACH bank' : m;
}

function flash(body, msg) {
  let bar = body.querySelector('.pay-flash');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'pay-flash';
    body.insertBefore(bar, body.firstChild);
  }
  bar.textContent = msg;
  bar.classList.remove('visible');
  void bar.offsetWidth;
  bar.classList.add('visible');
  setTimeout(() => bar.classList.remove('visible'), 4000);
}

function escapeHtml(s) {
  if (s == null) return '';
  const n = document.createElement('span');
  n.appendChild(document.createTextNode(String(s)));
  return n.innerHTML;
}

// ── Card brand SVGs (simple, monochrome-friendly) ───────────────

function brandSvgFor(brand) {
  switch (brand) {
    case 'visa':       return visaSVG(28);
    case 'mastercard': return mastercardSVG(28);
    case 'amex':       return amexSVG(28);
    case 'discover':   return discoverSVG(28);
    default:           return '';
  }
}

function visaSVG(h = 18) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 30" width="${h * 1.6}" height="${h}" aria-label="Visa">
    <rect width="48" height="30" rx="4" fill="#1A1F71"/>
    <path fill="#fff" d="M20.5 10l-2.3 10h-2.5l2.3-10h2.5zm9.8 6.5l1.3-3.6.7 3.6h-2zm3.6 3.5h2.3l-2-10h-2.1c-.5 0-.9.3-1 .7l-3.7 9.3h2.6l.5-1.4h3.1l.3 1.4zm-6.5-3.3c0-2.5-3.5-2.7-3.5-3.8 0-.3.3-.7 1-.8.9-.1 2 .1 2.9.5l.4-2c-.8-.3-1.8-.6-3-.6-3 0-5.1 1.5-5.1 3.7 0 1.6 1.5 2.5 2.7 3 1.2.5 1.6.9 1.6 1.4 0 .7-.9 1.1-1.7 1.1-1.4 0-2.3-.4-3-.7l-.5 2c.6.3 1.9.7 3.2.7 3.2.1 5.3-1.4 5.3-3.8"/>
    <path fill="#fff" d="M13 10L9 20H6.2L4.5 12c-.1-.4-.3-.6-.6-.8-.6-.3-1.5-.7-2.3-.9l.1-.3h5.3c.5 0 .9.3 1 .8l1.2 6.2 2.6-6.9h2.2z"/>
  </svg>`;
}
function mastercardSVG(h = 18) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 30" width="${h * 1.6}" height="${h}" aria-label="Mastercard">
    <rect width="48" height="30" rx="4" fill="#fff" stroke="#ddd"/>
    <circle cx="20" cy="15" r="8" fill="#EB001B"/>
    <circle cx="28" cy="15" r="8" fill="#F79E1B"/>
    <path fill="#FF5F00" d="M24 9.3a7.95 7.95 0 010 11.4 7.95 7.95 0 010-11.4z"/>
  </svg>`;
}
function amexSVG(h = 18) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 30" width="${h * 1.6}" height="${h}" aria-label="American Express">
    <rect width="48" height="30" rx="4" fill="#2E77BC"/>
    <text x="24" y="18" font-family="Arial, sans-serif" font-size="7" font-weight="900" fill="#fff" text-anchor="middle" letter-spacing="1">AMEX</text>
  </svg>`;
}
function discoverSVG(h = 18) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 30" width="${h * 1.6}" height="${h}" aria-label="Discover">
    <rect width="48" height="30" rx="4" fill="#fff" stroke="#ddd"/>
    <rect y="17" width="48" height="13" rx="0 0 4 4" fill="#FF6000"/>
    <text x="24" y="13" font-family="Arial, sans-serif" font-size="6" font-weight="700" fill="#111" text-anchor="middle">DISCOVER</text>
  </svg>`;
}
function cardGroupSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="14" viewBox="0 0 24 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="1" y="2" width="22" height="12" rx="2"/><line x1="1" y1="6" x2="23" y2="6"/>
  </svg>`;
}
function applePaySVG(h = 14, fill = 'currentColor') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${h}" height="${h}" fill="${fill}"><path d="M17.7 13.1c-.3 4.3 3.5 5.6 3.5 5.7-.1.1-.6 2-1.9 4-.9 1.3-1.8 2.6-3.2 2.6-1.4 0-1.9-.9-3.5-.9-1.7 0-2.2.9-3.5 1-1.4 0-2.5-1.4-3.4-2.7C3.8 20 2.4 15 4.3 11.6c1-1.7 2.7-2.8 4.5-2.8 1.4 0 2.7.9 3.5.9.8 0 2.4-1.1 4-1 .7 0 2.6.3 3.8 2-.1.1-2.3 1.3-2.4 4.4M14.9 6.6c.7-.9 1.2-2.1 1.1-3.3-1 0-2.3.7-3 1.6-.7.7-1.3 2-1.1 3.1 1.2.1 2.3-.6 3-1.4"/></svg>`;
}
function googlePaySVG(h = 14, fill = 'currentColor') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${h}" height="${h}" fill="${fill}"><path d="M12.5 11v2.5h3.8c-.2 1-1.3 2.8-3.8 2.8-2.3 0-4.1-1.9-4.1-4.2 0-2.3 1.8-4.2 4.1-4.2 1.3 0 2.2.6 2.7 1l1.8-1.7C15.7 5.9 14.3 5 12.5 5 9 5 6.2 7.8 6.2 12.1s2.8 7.1 6.3 7.1c3.6 0 6-2.5 6-6 0-.4 0-.7-.1-1.1h-5.9z"/></svg>`;
}
function bankSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <line x1="3" y1="21" x2="21" y2="21"/><line x1="3" y1="10" x2="21" y2="10"/><polyline points="5 6 12 3 19 6"/><line x1="4" y1="10" x2="4" y2="21"/><line x1="20" y1="10" x2="20" y2="21"/><line x1="8" y1="14" x2="8" y2="17"/><line x1="12" y1="14" x2="12" y2="17"/><line x1="16" y1="14" x2="16" y2="17"/>
  </svg>`;
}
