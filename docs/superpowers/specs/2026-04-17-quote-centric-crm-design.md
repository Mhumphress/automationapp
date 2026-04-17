# Quote-Centric CRM Redesign

**Date:** 2026-04-17
**Status:** Approved
**Author:** Michael Humphress + Claude
**Scope:** Sub-project A of the CRM UX overhaul. Sub-project B (CRM dashboard redesign) is a separate spec.

---

## Overview

The existing CRM requires customer onboarding through a chain of separate steps: Add Contact → Add Company → Create Deal → Set Status → Pick Package → Enter Pricing → Provision Tenant. This is friction-heavy and inconsistent.

This redesign consolidates that chain into a **quote-centric flow**:
- One unified "Quote Builder" screen captures customer, plan, add-ons, labor, line items, discount, and terms.
- The quote is sent as a public URL. The customer opens it, clicks Accept, and the tenant is auto-provisioned with its first invoice.
- The customer is a single entity (no separate Companies tab).
- Subscription changes after provisioning (add-on add/remove, plan change, cancellation) auto-generate prorated invoices or credits.
- A universal header search covers customers, quotes, invoices, and tenants.

---

## Section 1: Entity model & navigation

### What stays
- `tenants/{tid}` — account record, portal access
- `contacts/{id}` — the customer (single source of truth for person-level identity)
- `subscriptions/{id}` — recurring revenue tracking
- `tenants/{tid}/invoices/{id}` — billing invoices to the tenant
- `packages`, `addons`, `features`, `verticals` — catalog

### What changes
- `companies` collection is **deprecated**. The contact carries a `company` string field. The Companies tab is removed from the sidebar.
- `deals/{id}` is reframed as `quotes/{id}` (new collection). Pipeline stages become quote statuses.

### New CRM sidebar

```
Overview
  Dashboard

Customers & Sales
  Customers       (renamed from Contacts; shows company column)
  Quotes          (renamed from Pipeline; quote-centric list)
  Invoices
  Subscriptions
  Tasks

Platform
  Tenants
  Packages
  Renewals

Admin
  Settings
```

---

## Section 2: Quote data model

### `quotes/{id}`

| Field | Type | Notes |
|---|---|---|
| quoteNumber | string | `Q-001`, auto-incremented via `counters/quotes` |
| contactId | string | Required — customer reference |
| customerSnapshot | map | `{firstName, lastName, company, email, phone}` snapshot at send time |
| vertical | string | Slug |
| packageId | string | Slug |
| tier | string | Copied from package |
| billingCycle | string | `monthly` / `annual` |
| basePrice | number | Package price at time of quote |
| priceOverride | number/null | Custom price if negotiated |
| addOns | array | `[{slug, name, qty, unitPrice}]` — snapshotted from catalog |
| laborHours | number | Setup / implementation hours |
| laborRate | number | Rate at time of quote |
| laborDescription | string | "Data migration + training", etc. |
| lineItems | array | `[{description, qty, rate, amount}]` — one-time custom work |
| discount | map | `{reason, type, value, amount}` |
| subtotal, total | number | Computed; total includes discount |
| notes | string | Terms & conditions shown to customer |
| status | string | `draft` → `sent` → `accepted` / `declined` / `expired` → `provisioned` |
| publicToken | string | Random 32-char; set when status transitions to `sent` |
| validUntil | timestamp | Default: sentAt + 30 days |
| sentAt, acceptedAt, provisionedAt | timestamps | |
| tenantId | string/null | Populated on provisioning |
| invoiceId | string/null | First invoice created on acceptance |
| audit fields | | createdAt/By, updatedAt/By |

### Public response collection

Because the customer has no Firestore auth, acceptance/decline happens via a separate collection that allows anonymous writes:

- `quote_responses/{token}` — customer writes `{response, respondedAt, signatureName, userAgent}` where `response ∈ {accepted, declined}`. Firestore rules: `create` allowed without auth if `docId === resource.data.token`; no reads, no updates, no deletes for anonymous users. Admins can read to process.

- `quote_views/{token}` — optional convenience doc mirroring read-only quote fields (`customerSnapshot`, `subtotal`, `total`, line items, business info). Firestore rules: public read. Written by the CRM when the quote is sent.

### Status transitions

```
draft → (send) → sent → (customer accepts) → accepted → (auto-provision) → provisioned
                       → (customer declines) → declined
                       → (validUntil passes) → expired
```

No reverse transitions (the old state is preserved; creating a new quote starts over).

---

## Section 3: Quote Builder UI

One-page form with a live right-side pricing panel. No wizard steps, no modal chaining.

### Entry points
- Primary button `+ New Quote` on the Quotes list view
- Dashboard "Quick actions" panel
- `Cmd/Ctrl+N` keyboard shortcut when in the CRM

### Form sections (top to bottom)

1. **Customer** — toggle between "Existing customer" (autocomplete search by name/email/phone) and "New customer" (inline fields: name, email, phone, company). Existing selection pre-fills; new customer is saved to `contacts` on Save Draft or Send.
2. **Plan** — vertical dropdown cascades to package dropdown (filtered by vertical), then tier (reads tier from package), then billing cycle toggle (monthly/annual). Optional price override text field.
3. **Add-ons** — checkbox list of add-ons applicable to the chosen package/vertical. Per-unit add-ons get a qty input inline.
4. **Labor** — hours + rate inputs (rate defaults to tenant `laborRate` setting) + description textarea.
5. **Line items** — custom one-time work. Same table component as the invoice editor already in use: description / qty / rate / amount, add/remove rows, running total.
6. **Discount** — reason dropdown + type (% / $) + value. Same component as invoice discount.
7. **Terms & notes** — large textarea with a sensible default (validity, payment terms).

### Live pricing panel (right column)

Updates on every keystroke. Shows:

- Package price (monthly)
- Add-ons (per-item with qty × unit)
- Labor (hours × rate = one-time)
- Line items (rolled up)
- Subtotal
- Discount (if any)
- **Total today** (one-time + first period)
- **Recurring** (monthly/annual)

### Actions at bottom

- `Save Draft` — writes to `quotes/{id}` with status=`draft`. Stays in Quotes list.
- `Send to Customer` — writes doc with status=`sent`, generates `publicToken`, writes `quote_views/{token}`, copies the public URL to clipboard, and flashes a confirmation.

### What this collapses

Every old step (Add Contact, Add Company, Create Deal, Set Pipeline Stage, Pick Package, Enter Pricing) disappears into this one screen. Contacts and tenants are created in the background on Save/Send and Accept respectively.

---

## Section 4: Public quote page + automatic acceptance

### URL

`https://automationapp.org/quote/<token>`

### Page structure

A standalone HTML page (not part of the CRM app). Anonymous access. Layout:

- Your business header (name, logo)
- Quote metadata: number, issue date, valid-through date
- Customer info panel (from `customerSnapshot`)
- Plan summary (package + tier + billing cycle + base price)
- Add-ons table
- Labor + line items table
- Discount line (green, if present)
- Subtotal, one-time total, recurring total
- Terms & notes
- Two action buttons at the bottom: **Accept** (primary) and **Decline** (ghost)

### Acceptance flow

1. Customer clicks **Accept** → prompt asks "Please type your name to accept."
2. Page writes `quote_responses/{token}`: `{response: 'accepted', respondedAt, signatureName, userAgent}`.
3. Page flips to "Thank you — your account is being set up. You'll receive an email shortly with your login details."
4. CRM side: a listener on `quote_responses` (set up on admin login) detects the new doc, reads the linked quote, and:
   - Creates the tenant via existing provisioning logic (`companyName` ← `customerSnapshot.company`, `packageId`, `addOns`, `priceOverride`, etc.)
   - Sets `currentPeriodStart` and `currentPeriodEnd` (now and now + 1 month/year)
   - Creates the first invoice in `tenants/{t}/invoices/`: one-time labor + one-time line items + first period's recurring charges − discount
   - Sets quote status to `provisioned`, stores `tenantId` and `invoiceId` back on the quote
   - Logs to `tenants/{t}/activity/`
5. On next CRM refresh, the quote appears as Provisioned with links to the tenant and invoice.

### Decline flow

1. Customer clicks **Decline** → confirms.
2. Writes `quote_responses/{token}` with `{response: 'declined', respondedAt}`.
3. CRM listener sees it, flips quote status to `declined`.
4. Public page shows "Quote declined. Thanks for your time."

### Security

- 32-char random `publicToken` (~190 bits entropy) — unguessable.
- Firestore rules on `quote_responses/{token}`: `allow create: if request.resource.data.token == docId;` no reads/updates/deletes by anonymous users. Admin (authenticated) can read/update/delete.
- Rules on `quote_views/{token}`: public read, admin write.
- Rules on `quotes/{id}`: admin only (authoritative quote data stays behind auth).

### Fallback (if auto-provisioning fails)

If tenant creation errors (e.g., duplicate tenant for that contact), the quote still flips to `accepted` but `provisioned: false` — the CRM surfaces a yellow banner on the quote detail with "Provisioning failed: {reason}. [Retry Provisioning]" so the admin can investigate.

---

## Section 5: Subscription management with proration

### Tenant doc additions

- `currentPeriodStart` (timestamp) — billing period start
- `currentPeriodEnd` (timestamp) — billing period end / renewal date
- `cancelAt` (timestamp/null) — if set, tenant flips to cancelled on that date

### Settings addition

- `addOnImplementationFee` (number, default 25) — applied when an add-on is added mid-cycle.

### Proration helper

```
daysRemaining = max(0, (currentPeriodEnd - now) / 86400000)
daysInPeriod  = max(1, (currentPeriodEnd - currentPeriodStart) / 86400000)
ratio         = clamp(daysRemaining / daysInPeriod, 0, 1)
```

### Tenant Detail → Subscription section UI

Replaces the current static display. Layout:

- Current plan card with name, tier, cycle, price. `[Change Plan]` button in corner.
- Billing period line: "Feb 1 – Feb 28 · 13 days remaining"
- Add-ons table: name, qty, unit price, `[Remove]` button per row.
- `[+ Add Add-on]` button below the table.
- Danger zone at the bottom: `[Cancel Subscription]` link.

### The four actions

Each opens a confirm modal that shows the proration math **before** committing.

**1. Add Add-on**
- Modal lists applicable add-ons (filtered by package + vertical)
- Preview: "SMS Pack: $25/mo × 13/28 = **$11.61** (prorated) + **$25.00** implementation fee = **$36.61**"
- Confirm → append to `tenant.addOns`, create invoice in `tenants/{t}/invoices/` with two line items (status=sent)

**2. Remove Add-on**
- Confirm: "Remove Extra User Seat? You'll receive a credit of $38/mo × 13/28 = **$17.64**"
- Confirm → remove from `tenant.addOns`, create refund invoice (`type: 'refund'`, negative total)

**3. Change Plan**
- Picker for new package. Preview both sides:
  - "Refund old plan: $99 × 13/28 = $45.96"
  - "Charge new plan: $49 × 13/28 = $22.75"
  - "Net credit: $23.21"
- Confirm → update `tenant.packageId` + `features`, create invoice with both line items netting to the difference

**4. Cancel Subscription**
- Modal offers two choices:
  - **End of period** (default, no refund): sets `tenant.cancelAt = currentPeriodEnd`. Tenant stays active until then, then flips to `cancelled`.
  - **Cancel now**: prorated refund for unused days. Tenant status → `cancelled` immediately, portal access ends.
- Confirm → apply the chosen path

Every action writes an entry to `tenants/{t}/activity/`.

### Refund invoices

- New field on invoice docs: `type: 'charge' | 'refund'` (default 'charge' for back-compat).
- Refund invoices have negative `total`. Invoicing list shows them with a green "Credit" badge. Customer profile totals subtract refunds from outstanding.
- On the portal invoicing view, refunds appear in the list alongside charges.

### Renewal automation

Beyond the scope of this spec. Currently, `currentPeriodEnd` advances manually via the Renewals view (already exists). When we eventually add Firebase Functions we can cron this.

---

## Section 6: Universal search

### Placement

CRM header replaces `#headerActions` area with a search input. `Cmd/Ctrl+K` focuses it from anywhere.

### Scope

Searches in parallel across:
- **Customers** — `firstName`, `lastName`, `email`, `phone`, `company`
- **Quotes** — `quoteNumber`, `customerSnapshot.{firstName, lastName, company, email}`
- **Invoices** — `invoiceNumber`, `clientName`, `tenantId`
- **Tenants** — `companyName`, owner email (resolved via users subcollection — cached)
- **Any Firestore document ID** — if the query is a ≥15-char alphanumeric string, also lookup across collections by exact doc ID

### Results UI

Dropdown below the search input, results grouped by type, keyboard-navigable with arrow keys + Enter:

```
Customers
  John Smith         john@acme.com     Acme HVAC
  Jane Doe           555-123-4567      Doe Construction
Quotes
  Q-042  John Smith  $1,037  Sent
Invoices
  INV-024  Jane Doe  $199    Paid
Tenants
  Acme HVAC          active  RepairApp Pro
```

Clicking a result navigates to that record's detail page.

### Implementation

- On CRM bootstrap, fetch and cache customers, quotes (recent 500), invoices (recent 500), tenants. These are already cached for dashboards.
- Filter client-side on every keystroke.
- For the ID lookup path, issue a targeted `getDoc` across the four main collections if the query matches the ID pattern.

### Per-view local search

Each list view (Customers, Quotes, Invoices, Tenants) gets a local search box at its top with the same pattern, scoped to that list. This already exists on most views; we align the UI.

---

## Section 7: File manifest, deferred items, testing

### New files

- `crm/js/services/quotes.js` — quote CRUD, counter-based numbering, `publicToken` generation, view mirror doc management, `quote_responses` listener
- `crm/js/services/subscription.js` — proration helper + `addAddOn`, `removeAddOn`, `changePlan`, `cancelNow`, `cancelAtPeriodEnd`
- `crm/js/views/quotes.js` — Quotes list + Quote Builder
- `crm/js/views/customers.js` — Customers list + detail (replaces contacts view)
- `crm/js/components/universal-search.js` — header search
- `quote.html` — public quote page shell (CRM root)
- `quote/js/quote.js` — public page logic (no auth, reads `quote_views` + writes `quote_responses`)
- `quote/css/quote.css` — minimal branded styles for the public page

### Modified files

- `crm/firestore.rules` — rules for `quotes`, `quote_responses`, `quote_views`, `counters/quotes`; invoice refund support
- `crm/app.html` — sidebar (rename + drop companies), replace header with search
- `crm/js/main.js` — register new views + search, start `quote_responses` listener
- `crm/js/views/tenants.js` — add Subscription section with the four actions
- `crm/js/services/tenants.js` — `currentPeriodStart/End`, `cancelAt` fields on create

### Removed files

- `crm/js/views/companies.js` — dropped
- `crm/js/views/pipeline.js` — superseded by `quotes.js` (if any legacy `deals/` docs exist they remain in Firestore but are no longer rendered)

### Deferred (separate specs)

- CRM dashboard redesign (Sub-project B)
- Outbound email on acceptance — needs Firebase Functions + email provider
- Payment collection on accept — needs Stripe integration
- Data migration for legacy `deals/` docs — optional cleanup

### Testing (manual, browser-based)

Each scenario runs end-to-end with a real Firestore backend.

1. **Quote Builder — new customer:** fill form, click Save Draft, verify quote appears in Quotes list and a new contact exists.
2. **Quote Builder — existing customer:** autocomplete by email, verify form pre-populates.
3. **Send quote:** click Send to Customer, verify public URL copied to clipboard, open it in incognito, verify quote renders with all sections.
4. **Accept in incognito:** click Accept, type name, confirm. Back in CRM, verify: quote status = provisioned, tenant created, first invoice created with labor + line items + first period, activity logged.
5. **Decline in incognito:** verify quote status flips to `declined`, no tenant created.
6. **Expiry:** set `validUntil` to past date, verify quote list shows as `expired` (date-based, no write needed).
7. **Add Add-on:** from tenant detail, add SMS Pack. Verify modal shows prorated + implementation fee math. Confirm. Verify invoice created with two correct line items.
8. **Remove Add-on:** click Remove. Verify modal shows prorated credit. Confirm. Verify refund invoice (negative, green "Credit" badge) exists.
9. **Change Plan:** downgrade Pro → Basic. Verify net invoice correct.
10. **Cancel Now:** verify refund invoice and status change. Verify portal access ends (log in as tenant, see suspended state).
11. **Cancel End-of-Period:** verify `cancelAt` set, no refund, portal still accessible until the date.
12. **Universal search:** `Cmd+K`, type customer phone → see customer result. Type quote number → see quote result. Type invoice number → see invoice. Type 20-char ID → see exact-match lookup.
13. **Multi-contact per company:** create two customers with same `company` value. Open one's detail, verify "Other contacts at {company}" section links to the other.
14. **Error recovery:** manually kill network during Accept, verify public page shows an error and allows retry.
15. **Token leak resistance:** try guessing a `publicToken` on the URL; verify 404-style "Quote not found" without enumerating anything.
