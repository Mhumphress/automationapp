// ─────────────────────────────────────────────────────────────────
//  money.js — Canonical money math for the CRM and customer portal.
//
//  Single source of truth for every dollar figure the UI renders.
//  No Firestore I/O; pure functions operating on in-memory docs.
//
//  PORTAL MIRROR: This file is duplicated byte-identical at
//  `portal/js/services/money.js`. Any change must be made in both.
//  The mirror exists because there is no build step to share code;
//  a future refactor can unify once a bundler lands.
// ─────────────────────────────────────────────────────────────────

const SEAT_PRICE = 3;              // $/mo per extra user seat
const ANNUAL_DISCOUNT = 0.15;      // 15% off annual billing (matches provisioning)

// ── Coercion helpers ─────────────────────────────────────────────

function n(v) { const x = Number(v); return Number.isFinite(x) ? x : 0; }

function toMs(ts) {
  if (!ts) return 0;
  if (ts.toDate) return ts.toDate().getTime();
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'string') { const t = Date.parse(ts); return Number.isFinite(t) ? t : 0; }
  return Number(ts) || 0;
}

// ── Invoice math ─────────────────────────────────────────────────

/**
 * The effective signed amount of an invoice.
 * - Uses `total` if present, else `amount`, else summed `lineItems[].amount`.
 * - Refund invoices (type === 'refund') are always negative. If storage
 *   accidentally stored a positive total on a refund, we coerce the sign.
 */
export function invoiceEffectiveAmount(inv) {
  if (!inv) return 0;
  let raw = inv.total != null ? n(inv.total)
          : inv.amount != null ? n(inv.amount)
          : Array.isArray(inv.lineItems) ? inv.lineItems.reduce((s, li) => s + n(li.amount), 0)
          : 0;
  if (inv.type === 'refund') raw = -Math.abs(raw);
  return raw;
}

/** Sum of effective amounts for invoices with status === 'paid'. Refunds reduce. */
export function sumPaid(invoices) {
  return (invoices || [])
    .filter(i => i.status === 'paid')
    .reduce((s, i) => s + invoiceEffectiveAmount(i), 0);
}

/** Sum of open invoices: status in {sent, draft, overdue, issued, partial}. */
export function sumOpen(invoices) {
  const open = new Set(['sent', 'draft', 'overdue', 'issued', 'partial']);
  return (invoices || [])
    .filter(i => open.has(i.status))
    .reduce((s, i) => s + invoiceEffectiveAmount(i), 0);
}

/** Overdue: explicit status === 'overdue' OR status === 'sent' with dueDate past. */
export function sumOverdue(invoices, now = Date.now()) {
  return (invoices || [])
    .filter(i => {
      if (i.status === 'overdue') return true;
      if (i.status !== 'sent') return false;
      const due = toMs(i.dueDate);
      return due && due < now;
    })
    .reduce((s, i) => s + invoiceEffectiveAmount(i), 0);
}

/** Sum of refund invoices (negative values). */
export function sumRefunds(invoices) {
  return (invoices || [])
    .filter(i => i.type === 'refund' || invoiceEffectiveAmount(i) < 0)
    .reduce((s, i) => s + invoiceEffectiveAmount(i), 0);
}

/** Gross paid revenue (positive charges only), ignoring refunds. */
export function sumGrossPaid(invoices) {
  return (invoices || [])
    .filter(i => i.status === 'paid' && i.type !== 'refund')
    .reduce((s, i) => s + Math.max(0, invoiceEffectiveAmount(i)), 0);
}

// ── Customer aggregates ──────────────────────────────────────────

/**
 * Lifetime Value: paid charges minus refunds, plus any payments marked received
 * that are not linked to an invoice (e.g. standalone deposits).
 */
export function computeLTV(invoices, payments) {
  const fromInvoices = sumPaid(invoices);
  const orphanPayments = (payments || [])
    .filter(p => p.status === 'received' && (!p.appliedTo || p.appliedTo.length === 0))
    .reduce((s, p) => s + (p.type === 'refund' ? -n(p.amount) : n(p.amount)), 0);
  return fromInvoices + orphanPayments;
}

/** Open accounts-receivable: open invoices minus any unapplied credit balance. */
export function computeOpenAR(invoices) {
  return Math.max(0, sumOpen(invoices));
}

/** Current account balance: open minus credits (overpayments or unapplied refunds). */
export function computeBalance(invoices, payments) {
  const open = sumOpen(invoices);
  const credits = (payments || [])
    .filter(p => p.status === 'received')
    .reduce((s, p) => {
      const applied = (p.appliedTo || []).reduce((a, x) => a + n(x.amount), 0);
      const overpaid = Math.max(0, n(p.amount) - applied);
      return s + overpaid;
    }, 0);
  return open - credits;
}

// ── Subscription math ────────────────────────────────────────────

/**
 * Compute MRR for a single tenant. Optional package doc provides fallback
 * basePrice if tenant doesn't carry it directly.
 *
 * - `priceOverride` wins over `basePrice`.
 * - If `billingCycle === 'annual'`, the stored base price is treated as
 *   the ANNUAL price (includes the 15% discount already). To get monthly
 *   we undo the discount and divide by 12. Callers who store an annual
 *   price as monthly × 12 × 0.85 should document that.
 *   Our provisioning code (main.js:1080) uses monthly × 12 × 0.85 for the
 *   first invoice line item; the tenant `basePrice` field itself is kept
 *   in monthly terms, so we treat it as monthly and skip cycle conversion.
 * - Add-ons: sum of (priceMonthly × qty).
 * - Extra seats: extraUsers × $3.
 * - Inactive tenants contribute 0.
 */
export function computeMRR(tenant, pkg) {
  if (!tenant) return 0;
  if (tenant.status && tenant.status !== 'active') return 0;

  const base = tenant.priceOverride != null
    ? n(tenant.priceOverride)
    : (pkg && pkg.basePrice != null ? n(pkg.basePrice) : n(tenant.basePrice));

  const addons = Array.isArray(tenant.addOns)
    ? tenant.addOns.reduce((s, a) => s + n(a.priceMonthly) * (n(a.qty) || 1), 0)
    : 0;

  const seats = n(tenant.extraUsers) * SEAT_PRICE;

  return base + addons + seats;
}

export function computeARR(tenant, pkg) {
  return computeMRR(tenant, pkg) * 12;
}

/** Sum MRR across a list of tenants. */
export function totalMRR(tenants, packagesById) {
  return (tenants || []).reduce((s, t) => {
    const pkg = packagesById && t.packageId ? packagesById[t.packageId] : null;
    return s + computeMRR(t, pkg);
  }, 0);
}

export function totalARR(tenants, packagesById) {
  return totalMRR(tenants, packagesById) * 12;
}

// ── Dates ────────────────────────────────────────────────────────

/** Earliest of currentPeriodEnd and cancelAt. Null if neither set. */
export function nextRenewalDate(tenant) {
  const periodEnd = toMs(tenant && tenant.currentPeriodEnd);
  const cancelAt = toMs(tenant && tenant.cancelAt);
  const candidates = [periodEnd, cancelAt].filter(Boolean);
  if (!candidates.length) return null;
  return new Date(Math.min(...candidates));
}

/** Days from now to target timestamp. Negative if past. */
export function daysUntil(ts, now = Date.now()) {
  const t = toMs(ts);
  if (!t) return NaN;
  return Math.round((t - now) / 86400000);
}

/** Days elapsed since the given timestamp. */
export function tenureDays(createdAt, now = Date.now()) {
  const t = toMs(createdAt);
  if (!t) return 0;
  return Math.max(0, Math.floor((now - t) / 86400000));
}

/** Format tenure as "Xy Ym" (or "Xm"/"Xd" for shorter spans). */
export function formatTenure(createdAt) {
  const days = tenureDays(createdAt);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  return remMonths ? `${years}y ${remMonths}mo` : `${years}y`;
}

// ── Pipeline (quotes) ────────────────────────────────────────────

/** Sum of open-quote totals (active sales pipeline value). */
export function pipelineValue(quotes) {
  const active = new Set(['draft', 'sent', 'accepted']);
  return (quotes || [])
    .filter(q => active.has(q.status))
    .reduce((s, q) => s + n(q.total), 0);
}

// ── Formatting (re-export for co-location) ──────────────────────

export function formatMoney(amount) {
  if (amount == null || !Number.isFinite(Number(amount))) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
  }).format(Number(amount));
}

// ── Constants (exported for other services to keep in sync) ──────

export const MONEY_CONSTANTS = Object.freeze({
  SEAT_PRICE,
  ANNUAL_DISCOUNT,
});
