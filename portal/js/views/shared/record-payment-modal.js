// ─────────────────────────────────────────────────────────────────
//  record-payment-modal.js — portal-side Record Payment modal.
//
//  Used by the Invoicing page so the tenant admin can mark money
//  they've received (cash, check, etc.) against an invoice. Same
//  data shape as the CRM version.
// ─────────────────────────────────────────────────────────────────

import { recordPayment, PAYMENT_METHODS } from '../../services/payments.js';
import { invoiceEffectiveAmount, formatMoney } from '../../services/money.js';
import { getTenantId } from '../../tenant-context.js';

export function openRecordPayment(opts) {
  const {
    invoices = [],
    presetInvoiceId = null,
    singleInvoiceMode = false,
    title = 'Record Payment',
  } = opts || {};

  const tenantId = getTenantId();
  if (!tenantId) {
    alert('No tenant context.');
    return Promise.resolve({ recorded: false });
  }

  const preset = presetInvoiceId ? invoices.find(i => i.id === presetInvoiceId) : null;
  const presetBalance = preset ? Math.max(0, invoiceBalance(preset)) : 0;
  const defaultAmount = preset ? presetBalance.toFixed(2) : '';

  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop open';
    backdrop.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-header">
          <h2 class="modal-title">${escapeHtml(title)}</h2>
          <button class="modal-close" type="button">×</button>
        </div>
        <div class="modal-body"></div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const close = (result) => {
      backdrop.remove();
      resolve(result || { recorded: false });
    };
    backdrop.querySelector('.modal-close').addEventListener('click', () => close());
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

    const form = document.createElement('form');
    form.className = 'modal-form';

    const invoiceRowsHTML = invoices.length === 0
      ? '<div style="color:var(--gray);font-size:0.85rem;">No open invoices — payment will be recorded unapplied.</div>'
      : invoices.map(i => {
          const bal = Math.max(0, invoiceBalance(i));
          const checked = (preset && preset.id === i.id) ? 'checked' : '';
          const disabled = bal <= 0;
          return `
            <label class="payment-apply-row" style="display:flex;gap:0.5rem;align-items:center;padding:0.4rem;">
              <input type="checkbox" data-invoice-id="${escapeHtml(i.id)}" data-balance="${bal}" ${checked} ${disabled ? 'disabled' : ''}>
              <span style="flex:1;">
                ${escapeHtml(i.invoiceNumber || '-')} — ${escapeHtml(formatMoney(bal))} open${disabled ? ' (fully paid)' : ''}
              </span>
              <input type="number" step="0.01" min="0" placeholder="${bal.toFixed(2)}"
                     class="payment-apply-amount" ${checked ? `value="${bal.toFixed(2)}"` : 'disabled'}
                     style="width:100px;padding:0.3rem;border:1px solid var(--off-white);border-radius:6px;text-align:right;">
            </label>
          `;
        }).join('');

    form.innerHTML = `
      <div class="modal-form-grid">
        <div class="modal-field">
          <label>Amount *</label>
          <input type="number" name="amount" step="0.01" min="0.01" required value="${escapeAttr(defaultAmount)}">
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
          <label>Reference (check #, etc.)</label>
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
          <div class="payment-apply-list" style="display:flex;flex-direction:column;gap:0.3rem;max-height:260px;overflow-y:auto;padding:0.3rem;border:1px solid var(--off-white);border-radius:6px;">
            ${invoiceRowsHTML}
          </div>
        </div>
      `}
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary btn-lg">Record Payment</button>
        <span class="modal-cancel">Cancel</span>
      </div>
    `;

    const topAmountInput = form.querySelector('input[name="amount"]');

    function syncRowAmountsFromTop() {
      const checkedRows = [...form.querySelectorAll('.payment-apply-row input[type="checkbox"]:checked')];
      if (checkedRows.length !== 1) return;  // ambiguous allocation when multiple checked
      const cb = checkedRows[0];
      const amtInput = cb.closest('.payment-apply-row').querySelector('.payment-apply-amount');
      if (!amtInput.disabled) {
        amtInput.value = topAmountInput.value;
      }
    }

    function syncTopFromRowAmounts() {
      const checked = [...form.querySelectorAll('.payment-apply-row input[type="checkbox"]:checked')];
      const total = checked.reduce((s, cb) => {
        const amt = Number(cb.closest('.payment-apply-row').querySelector('.payment-apply-amount').value) || 0;
        return s + amt;
      }, 0);
      if (total > 0) topAmountInput.value = total.toFixed(2);
    }

    form.querySelectorAll('.payment-apply-row input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const amt = cb.closest('.payment-apply-row').querySelector('.payment-apply-amount');
        amt.disabled = !cb.checked;
        if (cb.checked && !amt.value) amt.value = cb.dataset.balance;
        if (!cb.checked) amt.value = '';
        syncTopFromRowAmounts();
      });
    });

    // Per-row amount edits → update top total
    form.querySelectorAll('.payment-apply-row .payment-apply-amount').forEach(amtInput => {
      amtInput.addEventListener('input', syncTopFromRowAmounts);
    });

    // Top amount edit → push to single checked row (so partial payments work
    // without the user having to edit both fields).
    topAmountInput?.addEventListener('input', syncRowAmountsFromTop);

    form.querySelector('.modal-cancel').addEventListener('click', () => close());

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
        toast('Payment recorded', 'success');
        close({ recorded: true });
      } catch (err) {
        console.error(err);
        toast(err.message || 'Failed to record payment', 'error');
        btn.disabled = false;
      }
    });

    backdrop.querySelector('.modal-body').appendChild(form);
  });
}

function invoiceBalance(inv) {
  const total = Math.abs(Number(inv.total || inv.amount || 0));
  const paid = Number(inv.paidAmount || 0);
  return total - paid;
}

function escapeHtml(s) {
  if (s == null) return '';
  const n = document.createElement('span');
  n.appendChild(document.createTextNode(String(s)));
  return n.innerHTML;
}

function escapeAttr(s) {
  return String(s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function toast(msg, type) {
  const c = document.getElementById('toastContainer');
  if (!c) { alert(msg); return; }
  const t = document.createElement('div');
  t.className = `toast toast-${type || 'info'}`;
  t.textContent = msg;
  c.appendChild(t);
  requestAnimationFrame(() => t.classList.add('toast-visible'));
  setTimeout(() => { t.classList.remove('toast-visible'); setTimeout(() => t.remove(), 400); }, 3000);
}
