# Money & Events Foundation + CRM Customer 360

**Date:** 2026-04-18
**Status:** Approved (roll straight into implementation)
**Author:** Michael Humphress + Claude
**Scope:** Sub-projects 1 + 2 paired (foundational money/events service, plus the first visible payoff — a deep customer profile). Sub-projects 3–6 are separate specs.

---

## Why this exists

The CRM and portal feel choppy because:
- Totals are recomputed inline in every view with subtly different formulas (`main.js:300–303`, `contacts.js:533–547`). Refund invoices (negative `total`) silently reduce revenue.
- There is no MRR/ARR anywhere. No `mrr` stored on tenant; no rollup widget.
- Customer profile is thin: basic info + sibling contacts + quote list + invoice list with two sum rows. No payment history, no subscription history, no LTV, no portal-access section, no tenant link.
- Subscription changes write free-text to `tenants/{t}/activity/` — you can't query "show me every plan change this quarter".
- Some journeys are literally impossible (e.g. "all overdue invoices for customer X").

This spec builds the foundation (money service + event collections) and uses it to rebuild the customer profile as the first visible win. Everything after this (portal parity, navigation polish, retention, pricing) stands on top.

---

## Section 1 — Money service

### New file: `crm/js/services/money.js`

Pure functions. No Firestore I/O. Takes arrays, returns numbers. This is the only place arithmetic on money lives.

**Functions exported:**

| Function | Input | Output | Notes |
|---|---|---|---|
| `invoiceEffectiveAmount(invoice)` | invoice doc | Number | Handles refunds: returns negative if `type === 'refund'`. Uses `total` field; falls back to `amount`, then to summed `lineItems[].amount`. |
| `sumPaid(invoices)` | array | Number | Sum of effective amounts for status `paid`. Refunds reduce. |
| `sumOpen(invoices)` | array | Number | Effective amounts for status in `['sent', 'draft', 'overdue']`. |
| `sumOverdue(invoices)` | array | Number | Status `overdue` OR (status `sent` AND `dueDate < now`). |
| `computeLTV(invoices, payments)` | arrays | Number | Sum of paid charges minus refunds. Payments only count if status `received`. |
| `computeOpenAR(invoices)` | array | Number | Sum of open invoices minus any unapplied credits (refund invoices not yet applied). |
| `computeMRR(tenant, pkg?)` | tenant doc, optional pkg doc | Number | Base price normalized to monthly + add-ons. If `billingCycle === 'annual'`, divides annual price by 12. Uses `priceOverride` if set; else `pkg.basePrice`; else `tenant.basePrice`. Adds `sum(addOns[].priceMonthly * qty)`. Respects seat overage ($3/mo × extraUsers). Returns 0 if status not active. |
| `computeARR(tenant, pkg?)` | same | Number | `computeMRR() × 12`. |
| `nextRenewalDate(tenant)` | tenant | Date \| null | Returns earliest of `currentPeriodEnd` and `cancelAt`. Null if neither set. |
| `tenureDays(createdAt)` | timestamp | Number | Days since created. Firestore Timestamp or ms supported. |
| `formatMoney(n)` | number | string | Uses the existing `formatCurrency` from `ui.js` — re-exported for co-location. |
| `daysUntil(timestamp)` | timestamp | Number | Days from now to target; negative if past. |

**Refactor targets — every place inline sums are computed gets replaced:**

| File:line | Change |
|---|---|
| `crm/js/main.js:300–303` | Replace `paidInvoices.reduce(...)` with `sumPaid(invoices)`. Replace `activeQuotes.reduce(...)` with a new `pipelineValue(quotes)` helper (same file adds it). |
| `crm/js/main.js:611–674` (`renderRevenueDrill`) | Use `sumPaid`, `sumOverdue` helpers. Add MRR/ARR KPI row. |
| `crm/js/views/contacts.js:533–547` | Replace Paid/Open computation with `sumPaid` / `sumOpen`. |
| `crm/js/views/invoices.js` (if it has any totals) | Switch to money.js. |
| Portal `portal/js/views/shared/invoicing.js` | Import a **portal-side clone** of money.js (`portal/js/services/money.js`, byte-identical) so both sides agree. |

**Tests (manual browser):**
- Create one paid invoice $100, one refund invoice $-20. Revenue tile shows $80, not $100 or $120.
- Create tenant with priceOverride=$99, monthly cycle, 2 add-ons ($20/mo, $15/mo), 2 extra seats. MRR tile shows $140.

---

## Section 2 — Event collections

### New root collection: `subscription_events`

Append-only structured record of everything that changed a subscription.

**Doc shape:**
```
{
  eventId: auto,
  tenantId: string,
  contactId: string | null,
  type: 'created' | 'plan_changed' | 'addon_added' | 'addon_removed'
      | 'price_adjusted' | 'renewed' | 'cancelled' | 'cancel_scheduled'
      | 'cancel_undone' | 'paused' | 'resumed' | 'reactivated',
  fromState: { packageId, tier, basePrice, priceOverride, addOns, billingCycle, status } | null,
  toState:   { packageId, tier, basePrice, priceOverride, addOns, billingCycle, status } | null,
  effectiveAt: timestamp,       // when the change took effect (may be future for scheduled)
  recordedAt: serverTimestamp,  // when we wrote it
  recordedBy: uid,              // null if system
  recordedByEmail: string,
  invoiceId: string | null,     // linked invoice if this event created one
  reason: string,               // free-text reason or description
  mrrDelta: number,             // +/- impact on MRR (computed at write time)
  arrDelta: number,             // mrrDelta × 12
  metadata: { ... }             // type-specific
}
```

**Query patterns:**
- Per-tenant timeline: `where('tenantId', '==', t).orderBy('effectiveAt', 'desc')`
- Per-customer (via tenant resolution): same pattern, indexed on tenantId.
- MRR-delta chart: `where('effectiveAt', '>=', date).orderBy('effectiveAt')` → cumulative sum.

**Firestore rules (added to `crm/firestore.rules`):**
```
match /subscription_events/{eventId} {
  allow read: if isApprovedUser();       // CRM operators
  allow create: if isApprovedUser();
  allow update, delete: if false;        // append-only
}
```

Tenant users can *not* read this collection directly (it's operator-side). Portal sub-project 3 will provide a filtered view via a mirror or on-demand read after rules permit it.

### New subcollection: `tenants/{t}/payments`

**Already has rules** in `firestore.rules:292–297` — admin-only create/update/delete; members can read. Good.

**Doc shape:**
```
{
  paymentId: auto,
  tenantId,
  amount: number,               // always positive; use `type: 'refund'` for outgoing
  currency: 'USD',
  method: 'check' | 'ach' | 'card' | 'cash' | 'wire' | 'manual',
  status: 'received' | 'pending' | 'failed' | 'refunded',
  type: 'payment' | 'refund',
  reference: string,            // check #, last 4, wire ref, etc.
  appliedTo: [{ invoiceId, amount }],  // may span multiple invoices
  receivedAt: timestamp,        // when money arrived
  recordedAt: serverTimestamp,
  recordedBy: uid,
  recordedByEmail: string,
  notes: string,
}
```

**New service file: `crm/js/services/payments.js`** — exports `recordPayment(tenantId, data)`, `listPayments(tenantId)`, `listPaymentsForContact(contactId)` (by tenantId lookup from contact). Marks applied invoices as `paid` when `appliedTo.amount === invoice.total`; partially-paid otherwise (writes `paidAmount` on the invoice, leaves `status='sent'` unless fully paid).

### Changes to `crm/js/services/subscription.js`

Every action writes a `subscription_events` doc in addition to existing activity log. Centralize via a small helper inside `subscription.js`:

```js
async function recordEvent({ tenantId, contactId, type, fromState, toState, invoiceId, reason, mrrDelta }) { ... }
```

Touch points:
- `addAddOn()` (line 80) — after invoice write, event `addon_added` with mrrDelta = +monthly add-on cost
- `removeAddOn()` (line 149) — event `addon_removed` with mrrDelta = −monthly add-on cost
- `changePlan()` (line 214) — event `plan_changed` with mrrDelta = newPrice − oldPrice
- `cancelNow()` (line 273) — event `cancelled`
- `cancelAtPeriodEnd()` (line 319) — event `cancel_scheduled`
- `enforceCancellations()` (line 342) — event `cancelled` with metadata `{ scheduled: true }`

Provisioning also emits one: `crm/js/main.js:handleQuoteAccepted` writes `subscription_events` with `type: 'created'` after tenant + first invoice are created.

### Backfill migration

On CRM admin load, one-time scan of existing `tenants/*/activity/` for subscription-relevant entries and synthesize `subscription_events` docs. Flag-gated in `settings/migrations.subscriptionEventsBackfill`.

Scan for activity types: `addon_added`, `addon_removed`, `plan_changed`, `subscription_cancelled`, `subscription_cancel_scheduled`, `quote_accepted`. For each, construct the best-effort event doc using the metadata stored on the activity. If fromState/toState can't be reconstructed, leave null — the event is still queryable.

---

## Section 3 — CRM Customer 360 (tabbed detail page)

### Location

`crm/js/views/contacts.js` — `showDetailPage(contact)` function (currently line 399–569) is replaced by a new tabbed implementation. The list view stays untouched.

### Entry points

- Click contact from Contacts list → customer 360 (unchanged from today's hash route).
- Click customer from dashboard drill → same.
- Universal search → same.
- New: direct URL `#customers/<id>` (or `#contacts/<id>`; both route to the same view).

### Header (sticky)

Above the tabs. Always visible.

```
┌──────────────────────────────────────────────────────────────────────┐
│ [Avatar] John Smith                                 [New Quote ▾]   │
│          CTO at Acme HVAC · john@acme.com · 555-1234                │
│                                                                      │
│ [Active tenant]  [Customer 2y 3mo]   LTV $4,280   MRR $99   Open AR $140 │
│                                                                      │
│ Tabs:  Overview │ Billing │ Subscription │ Activity │ Files │ Team   │
└──────────────────────────────────────────────────────────────────────┘
```

**Badges:**
- Tenant status: `Active` (green) / `Past due` (orange) / `Cancelled` (gray) / `No tenant` (neutral) — derived from tenant lookup
- Tenure: "Customer Xy Ym" — from `contact.createdAt`
- Health score (small dot + label): `Healthy` / `At risk` / `Critical` — composite of open AR + overdue count + days since last activity (see Section 5)

**Quick-action row (below badges):**
- `New Quote` — pre-fills customer from contact
- `Record Payment` — opens record-payment modal if linked tenant
- `Log Activity` — jumps to activity composer
- `Open Tenant ↗` — if linked, navigates to tenant detail
- `Export ▾` — CSV of invoices / activity / subscription events

### Tabs

**Tab 1 — Overview (default)**

Two columns.

Left column (profile + inline edits, kept from today):
- First Name, Last Name, Email, Phone, Job Title, Notes (editable)
- Company (editable, writes `company` + legacy `companyName`)
- Tags (chips with "+ Add tag" — tags collection TBD; stored as array on contact for now)
- Address (editable multi-line, new fields: `address.street/city/state/zip/country`)
- Internal notes textarea (private, `contact.internalNotes` — not shown in activity)

Right column:
- Three stat cards: LTV, MRR contribution, Open AR — each clickable to jump to relevant tab
- Next renewal card: `Feb 28 — in 18 days — $99` — or `No upcoming renewal` if no tenant
- Sibling contacts at same company (kept from today — link to each)
- Recent activity preview (last 5 from the activity feed — "View all" jumps to Activity tab)

**Tab 2 — Billing**

- **Invoices table** — full CRM-side invoice list for this customer, filterable by status + date range. Columns: Invoice #, Issued, Due, Total, Status, Balance, [open]. Rows clickable. Uses `sumPaid` / `sumOpen` / `sumOverdue` from money.js for the summary strip.
- **Summary strip above the table**: Paid / Open / Overdue / Refunds — four KPIs, all aligned with dashboard.
- **Payments ledger** (below invoices) — reads from `tenants/{t}/payments` if linked; otherwise shows "No payments recorded." Columns: Received, Method, Amount, Applied to, Reference, [view].
- **Record Payment button** — only enabled if customer has a linked tenant. Opens a modal:
  - Amount, method, reference, received date, notes
  - "Apply to" multi-select of open invoices with per-invoice amount allocation
  - Submit calls `payments.recordPayment()` and refreshes the ledger + invoices
- **Running balance ledger** — chronological debits (invoices) and credits (payments + refunds). Downloadable as CSV.
- **CSV export** button.

**Tab 3 — Subscription**

Only visible if customer has a linked tenant; otherwise shows "No subscription — [Create Quote]".

- Current plan card: package name, tier, cycle, price, billing period with days remaining. Same styling as today's tenant detail.
- Add-ons table with Remove buttons (reuses `subscription.js` actions).
- `[Change Plan]`, `[+ Add Add-on]`, `[Cancel]` buttons — all open modals with proration preview (already exist in subscription.js; we're re-rendering them here).
- **Subscription timeline** — reads from `subscription_events` filtered by tenantId, newest first. Each entry shows icon, type label, before/after diff (expandable), mrrDelta, linked invoice (clickable).
- **MRR sparkline** — last 12 months, computed from cumulative subscription_events.

**Tab 4 — Activity & Audit**

- Composer at top (kept from today) + two new types: `Task` (creates a task linked to contact) and `File` (upload or URL reference — see Files tab)
- Unified feed combining:
  - `contacts/{id}/activity/` docs (today's activity log)
  - `subscription_events` where contactId matches OR tenantId matches linked tenant
  - `tenants/{t}/activity/` where tenantId matches linked tenant
  - `tenants/{t}/payments` records (rendered as "Payment received $X")
- Filter pills: `All` / `Communications` (call/email/meeting/note) / `System` (edits, provisioning, cancellations) / `Subscription` (plan/addon changes) / `Billing` (invoices, payments, refunds)
- Each feed item shows: icon, actor (email), what, before/after diff if applicable, timestamp, [jump to source]

**Tab 5 — Files**

Firebase Storage check: if Storage is initialized in `config.js`, wire real uploads. Otherwise (and I'll verify), fall back to URL-based references (user pastes a link; we store `{ name, url, addedBy, addedAt }`).

- File list: Name, Type (icon), Size, Uploaded by, Uploaded at, [Download] / [Open]
- Drag-and-drop upload zone + `[Upload File]` button
- Stored path: if tenant linked, `tenants/{t}/files/`; else `contacts/{id}/files/`
- Firestore doc per file (metadata); Storage path references the doc ID

**If Firebase Storage is not available**, the tab shows a link-only form: paste a URL, give it a name, it's stored as a metadata doc. This is explicit, not a broken upload.

**Tab 6 — Team & Portal Access**

If customer has a linked tenant:
- List of `tenants/{t}/users` with columns: Email, Name, Role, Status, Last login, [Resend invite] / [Remove]
- `[+ Invite User]` button — reuses existing invite flow from `crm/js/services/tenants.js`
- Portal URL shown with `[Copy]` button: `https://automationapp.org/portal/`
- Shows `user_tenants` mapping state (which users resolve to this tenant on login)

If no tenant linked:
- "This customer has no portal account. Create a quote and send it to provision one. [New Quote]"

### CSS / Layout

New minimal styles in `crm/css/app.css` — the tab component is a standard segmented control we already use patterns for. Reuses existing `.detail-header`, `.detail-field`, `.stat-card`, `.settings-section`, `.activity-*`, `.data-table` classes.

---

## Section 4 — Dashboard updates

### In `crm/js/main.js`

Refactor `registerView('dashboard')` render block:

1. Import from `./services/money.js`.
2. **Add a fifth stat card** `MRR` and a sixth `ARR`. Requires loading tenants; uses `computeMRR(tenant)` summed across active tenants.
3. **Revenue stat** becomes `sumPaid(invoices)` — refunds no longer silently reduce without being accounted for. Actually: the correct behavior is that refunds DO reduce; the bug is that today refunds are mirrored into the root `invoices` collection with positive `total` in some code paths (see `invoice-sync.js`). Fix: refund invoices are stored with negative `total` consistently, and `sumPaid` handles them correctly via `invoiceEffectiveAmount`.
4. **Revenue drill** adds Net Revenue (paid − refunds), Gross Revenue (paid only), Refunds.
5. **New drill**: "Subscriptions" card showing MRR, ARR, active tenants, churn (cancelled in 30d), net new MRR (sum of mrrDelta over 30d).

### Dashboard DOM additions

`crm/app.html` adds two stat cards (MRR, ARR) and one drill panel (`drillSubscriptions`). Stats grid becomes 6 columns (responsive: collapses to 3×2 on tablets, 2×3 on phones).

---

## Section 5 — Health score

**Inputs:**
- Open AR (severity by ratio of open / LTV)
- Overdue invoice count
- Days since last activity entry
- Days since last tenant user login (if linked)

**Buckets:**
- **Healthy**: no overdue + last activity within 30d
- **At risk**: any overdue invoice OR no activity in 30–90d OR open AR > 2× MRR
- **Critical**: invoice overdue > 30d OR no activity in 90+ days OR open AR > 5× MRR

Purely derived at render time; not stored. A small colored dot + label in the customer header.

---

## Section 6 — Tags (light touch)

Tags are a free-text array on `contact.tags: string[]`. Rendered as chips with "+ Add" in the profile. Added as a filter chip option on the Contacts list. No dedicated tags collection or management UI in this pass — keep simple.

---

## Section 7 — CSV export

One helper in `crm/js/utils/csv.js`:
- `downloadCSV(filename, rows, columns)` — rows = array of objects, columns = `[{ key, label, format? }]`. Produces RFC-4180 compliant CSV with proper quoting. Triggers download via blob URL.

Used by: Billing tab (invoices, payments), Activity tab, Subscription tab (events).

---

## Section 8 — Firestore rules changes

```diff
  match /contacts/{contactId} {
    allow read, create, update: if isApprovedUser();
    allow delete: if isAdmin() || (isApprovedUser() && isOwner());

+   match /files/{fileId} {
+     allow read, create: if isApprovedUser();
+     allow update, delete: if isApprovedUser();
+   }
    match /activity/{activityId} { ... }  // unchanged
  }

+ match /subscription_events/{eventId} {
+   allow read, create: if isApprovedUser();
+   allow update, delete: if false;
+ }

  match /tenants/{tenantId} {
    ...
+   match /files/{fileId} {
+     allow read: if isAdmin() || isTenantMember(tenantId);
+     allow create, update: if isAdmin() || (isTenantAdmin(tenantId) && tenantIsActive(tenantId));
+     allow delete: if isAdmin() || (isTenantAdmin(tenantId) && tenantIsActive(tenantId));
+   }
  }
```

Deploy requires manual publish in Firebase Console (noted in memory).

---

## Section 9 — File manifest

### New
- `crm/js/services/money.js`
- `crm/js/services/subscription-events.js` (CRUD + query helpers for `subscription_events`)
- `crm/js/services/payments.js`
- `crm/js/utils/csv.js`
- `crm/js/views/customer-detail.js` (the tabbed page body; imported by `contacts.js`)
- `portal/js/services/money.js` (byte-identical mirror — portal side is separate import path)

### Modified
- `crm/js/services/subscription.js` — emit events on every action
- `crm/js/main.js` — dashboard uses money.js; MRR/ARR/Subscriptions tiles; provisioning emits `created` event; backfill migration runs alongside the existing companies migration
- `crm/js/views/contacts.js` — `showDetailPage` delegates to `customer-detail.js`
- `crm/app.html` — stat grid: 6 cells; subscriptions drill panel; customer detail container
- `crm/css/app.css` — tab bar + additional layout rules
- `crm/firestore.rules` — subscription_events, files subcollections

### Removed
- Nothing. Everything additive; list view of contacts unchanged.

---

## Section 10 — Testing (manual, browser)

1. **Refund no longer distorts revenue.** Create a paid $100 invoice and a refund $-20. Dashboard Revenue = $80.
2. **MRR tile renders.** Provision a tenant at $99/mo with two add-ons ($20 + $15) and 2 seats. Dashboard MRR = $140, ARR = $1,680.
3. **Customer 360 opens from list.** Click a contact; tabs render; all six tabs navigable.
4. **Billing tab ledger.** Open a customer with paid + open + refund invoices. KPI strip = dashboard numbers. Payments ledger shows zero if no payments. Record a $50 check against an open invoice; status flips to partial; second $50 flips it to paid.
5. **Subscription tab timeline.** Take an existing tenant. Add an add-on. Event appears on the customer's Subscription tab with mrrDelta. Change plan → another event with before/after. Cancel → cancelled event.
6. **Activity tab unified feed.** Same customer. Feed shows: profile edits (system), activity entries (communications), subscription events, payment records. Filter pills narrow correctly.
7. **Files tab.** Upload a file (or paste a URL if Storage not wired). Refresh — it persists. Download link works.
8. **Team tab.** For a linked tenant, users list renders. Invite a new user via the tab button. Email appears in pending state.
9. **CSV export.** From Billing tab, export invoices. Open in a spreadsheet; columns and amounts match the table.
10. **Health score.** Customer with a 45-day-overdue invoice shows Critical. Clear the invoice; refresh; shows Healthy.
11. **Backfill migration.** Run CRM in a clean session. Check `subscription_events` collection — entries exist for all prior subscription activity. Migration flag is set in `settings/migrations`.
12. **Portal money.js mirror.** Load portal as a tenant. Billing page totals match the CRM's customer detail exactly to the cent.

---

## Section 11 — Deferred (not in this spec)

- Portal Customer 360 (sub-project 3). Portal gets `money.js` in this spec but not the full redesign.
- Navigation cross-linking (sub-project 4): Invoices view filter-by-customer, deep links.
- Retention policy + soft delete (sub-project 5).
- Pricing uplift + new add-ons (sub-project 6).
- Stripe payment capture. Payments are manually recorded in this pass.
- Email/SMS notifications on events.
- Subscription timeline visible in portal (customer's own subscription_events filtered by rules).

---

## Section 12 — Risks

- **Firebase Storage** may not be wired. Mitigation: Files tab falls back to URL references. Verify at implementation time.
- **Backfill migration** on tenants with many activity entries could be slow on first admin load. Mitigation: runs async, doesn't block UI; flag-gated so only runs once.
- **money.js mirror** in portal risks divergence. Mitigation: the two files are identical and called out in each file's top comment. Future cleanup: move to a shared module when we adopt a build step. For now, any change must be made in both.
- **Refund invoice sign convention** may have drifted. `subscription.js` writes `total: -refund` (negative). Verify no code path coerces to positive before storing; fix inline if found.
- **Event backfill accuracy**: reconstructed `fromState`/`toState` will be null for pre-event activity. Acceptable — users see "data unavailable" for the before/after on old entries.

---

## Exit criteria (spec is done when)

All 12 manual tests pass. Commits pushed. Live at automationapp.org after Cloudflare cache clears + Firestore rules published.
