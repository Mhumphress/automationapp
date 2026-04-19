// ─────────────────────────────────────────────────────────────────
//  record-payment-modal.js — Shared "Record Payment" modal.
//
//  Used from Customer 360 → Billing tab, Invoices list, and Invoice
//  detail page. Any caller passes a tenant + invoices to allocate
//  against; the modal handles UI, user input, and writes via the
//  payments service. On success the caller's onRecorded() fires.
// ─────────────────────────────────────────────────────────────────

import { openStackedModal } from './modal.js';
import { showToast, escapeHtml } from '../ui.js';
import { recordPayment, PAYMENT_METHODS } from '../services/payments.js';
import { invoiceEffectiveAmount, formatMoney } from '../services/money.js';

/**
 * @param {object} opts
 * @param {string} opts.tenantId                 Required.
 * @param {Array<object>} opts.invoices          Candidate open invoices.
 * @param {string} [opts.presetInvoiceId]        If set, pre-check this invoice.
 * @param {boolean} [opts.singleInvoiceMode]     When true, hides allocation
 *                                               list and applies fully to the
 *                                               preset invoice.
 * @param {string} [opts.title]                  Modal title override.
 * @returns {Promise<{recorded: boolean}>}
 */
export function openRecordPaymentModal(opts) {
  const {
    tenantId,
    invoices = [],
    presetInvoiceId = null,
    singleInvoiceMode = false,
    title = 'Record Payment',
  } = opts || {};

  if (!tenantId) {
    showToast('This customer has no linked tenant — payments require a provisioned account.', 'error');
    return Promise.resolve({ recorded: false });
  }

  const preset = presetInvoiceId ? invoices.find(i => i.id === presetInvoiceId) : null;
  const presetBalance = preset ? Math.max(0, invoiceBalance(preset)) : 0;
  const defaultAmount = preset ? presetBalance.toFixed(2) : '';

  return openStackedModal(title, (bodyEl, close) => {
    const form = document.createElement('form');
    form.className = 'modal-form';

    const invoiceRowsHTML = invoices.length === 0
      ? '<div style="color:var(--gray);font-size:0.85rem;">No open invoices — payment will be recorded unapplied.</div>'
      : invoices.map(i => {
          const bal = Math.max(0, invoiceBalance(i));
          const checked = (preset && preset.id === i.id) ? 'checked' : '';
          const disabled = bal <= 0;
          return `
            <label class="payment-apply-row">
              <input type="checkbox" data-invoice-id="${escapeHtml(i.id)}" data-balance="${bal}" ${checked} ${disabled ? 'disabled' : ''}>
              <span style="flex:1;">
                ${escapeHtml(i.invoiceNumber || '-')} — ${escapeHtml(formatMoney(bal))} open${disabled ? ' (fully paid)' : ''}
              </span>
              <input type="number" step="0.01" min="0" placeholder="${bal.toFixed(2)}"
                     class="payment-apply-amount" ${checked ? `value="${bal.toFixed(2)}"` : 'disabled'}>
            </label>
          `;
        }).join('');

    form.innerHTML = `
      <div class="modal-form-grid">
        <div class="modal-field">
          <label>Amount *</label>
          <input type="number" name="amount" step="0.01" min="0.01" required value="${escapeHtml(defaultAmount)}">
        </div>
        <div class="modal-field">
          <label>Method *</label>
          <select name="method" required>
            ${PAYMENT_METHODS.map(m => `<option value="${m}">${m.toUpperCase()}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="modal-form-grid">
        <div class="modal-field">
          <label>Received date</label>
          <input type="date" name="receivedAt" value="${new Date().toISOString().slice(0,10)}">
        </div>
        <div class="modal-field">
          <label>Reference (check #, last 4, etc.)</label>
          <input type="text" name="reference">
        </div>
      </div>
      <div class="modal-field">
        <label>Notes</label>
        <textarea name="notes" rows="2"></textarea>
      </div>
      ${singleInvoiceMode && preset ? `
        <div class="modal-field">
          <label>Applying to</label>
          <div style="padding:0.5rem 0.75rem;background:var(--off-white,#F1F5F9);border-radius:6px;font-size:0.88rem;">
            ${escapeHtml(preset.invoiceNumber || '-')} — balance ${escapeHtml(formatMoney(presetBalance))}
          </div>
        </div>
      ` : `
        <div class="modal-field">
          <label>Apply to invoice(s)</label>
          <div class="payment-apply-list">${invoiceRowsHTML}</div>
        </div>
      `}
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary btn-lg">Record Payment</button>
        <span class="modal-cancel">Cancel</span>
      </div>
    `;

    const topAmountInput = form.querySelector('input[name="amount"]');

    function syncRowAmountsFromTop() {
      const checked = [...form.querySelectorAll('.payment-apply-row input[type="checkbox"]:checked')];
      if (checked.length !== 1) return;
      const amtInput = checked[0].closest('.payment-apply-row').querySelector('.payment-apply-amount');
      if (!amtInput.disabled) amtInput.value = topAmountInput.value;
    }
    function syncTopFromRowAmounts() {
      const checked = [...form.querySelectorAll('.payment-apply-row input[type="checkbox"]:checked')];
      const total = checked.reduce((s, cb) => {
        const amt = Number(cb.closest('.payment-apply-row').querySelector('.payment-apply-amount').value) || 0;
        return s + amt;
      }, 0);
      if (total > 0) topAmountInput.value = total.toFixed(2);
    }

    // Wire allocation checkboxes
    form.querySelectorAll('.payment-apply-row input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const amt = cb.closest('.payment-apply-row').querySelector('.payment-apply-amount');
        amt.disabled = !cb.checked;
        if (cb.checked && !amt.value) amt.value = cb.dataset.balance;
        if (!cb.checked) amt.value = '';
        syncTopFromRowAmounts();
      });
    });
    form.querySelectorAll('.payment-apply-row .payment-apply-amount').forEach(amt => {
      amt.addEventListener('input', syncTopFromRowAmounts);
    });
    topAmountInput?.addEventListener('input', syncRowAmountsFromTop);

    form.querySelector('.modal-cancel').addEventListener('click', () => close({ recorded: false }));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const amount = Number(fd.get('amount'));
      const method = fd.get('method');
      const notes = (fd.get('notes') || '').toString().trim();
      const reference = (fd.get('reference') || '').toString().trim();
      const receivedRaw = fd.get('receivedAt');
      const receivedAt = receivedRaw ? new Date(receivedRaw.toString()) : new Date();

      let appliedTo = [];
      if (singleInvoiceMode && preset) {
        appliedTo = [{ invoiceId: preset.id, amount }];
      } else {
        form.querySelectorAll('.payment-apply-row input[type="checkbox"]:checked').forEach(cb => {
          const amt = Number(cb.closest('.payment-apply-row').querySelector('.payment-apply-amount').value);
          if (amt > 0) appliedTo.push({ invoiceId: cb.dataset.invoiceId, amount: amt });
        });
      }

      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        await recordPayment(tenantId, {
          amount, method, reference, receivedAt, notes, appliedTo,
        });
        showToast('Payment recorded', 'success');
        close({ recorded: true });
      } catch (err) {
        console.error(err);
        showToast(err.message || 'Failed to record payment', 'error');
        btn.disabled = false;
      }
    });

    bodyEl.appendChild(form);
  });
}

function invoiceBalance(inv) {
  const total = Math.abs(invoiceEffectiveAmount(inv));
  const paid = Number(inv.paidAmount || 0);
  return total - paid;
}
