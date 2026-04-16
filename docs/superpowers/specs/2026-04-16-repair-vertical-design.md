# Repair Vertical — Basic + Pro Design

**Date:** 2026-04-16
**Status:** Approved
**Author:** Michael Humphress + Claude
**Parent spec:** `docs/superpowers/specs/2026-04-16-customer-portal-platform-design.md`

---

## Overview

First shippable vertical for the customer portal. Delivers a complete, sellable product for electronics/device repair shops at Basic and Pro tiers. Enterprise features (purchase orders, low-stock alerts, multi-location, API, custom fields) are explicitly deferred.

**Sequencing:** Repair ships first and gets validated end-to-end in production. Trades follows in a subsequent plan using patterns proven here.

### Scope

**Built in this plan:**
- `tickets` module (Basic)
- `inventory` module (Pro)
- `checkin` module (Pro)
- Supporting data: per-tenant ticket counter, tenant `laborRate` setting
- Sidebar nav wiring for the three new features

**Explicitly deferred:**
- Shared `scheduling` module — Repair ships without it; sidebar hides the nav link. Tickets' `estimatedCompletion` field covers the immediate need.
- Shared `reporting` module — same treatment. Deferred until a customer asks.
- Enterprise features: `purchase_orders`, `low_stock_alerts` (notifications, not the badge), `multi_location`, `api_access`, `custom_fields`.
- Check-in photos, customer signatures, warranty tracking, per-technician labor rates, formal status history.

---

## Section 1: Data Model

All collections are tenant-scoped under `tenants/{tenantId}/...`. Firestore rules from Plan 1 already permit these paths.

### `tickets/{ticketId}`

| Field | Type | Notes |
|---|---|---|
| ticketNumber | string | Auto-generated `T-001`, increments per tenant via transaction |
| contactId | string | Link to `tenants/{t}/contacts/` |
| customerName | string | Denormalized for fast list rendering |
| deviceType | string | Free text, e.g. "iPhone 14", "Dell XPS 15" |
| serial | string | Serial / IMEI |
| issue | string | Customer-reported problem |
| condition | string | Check-in condition notes |
| status | string | `checked_in`, `diagnosed`, `awaiting_parts`, `in_repair`, `qc`, `ready`, `completed` |
| estimatedCompletion | timestamp | |
| assignedTechId | string/null | Tenant user UID |
| partsUsed | array | Pro only. `[{partId, sku, name, qty, unitCost, unitPrice}]` — denormalized snapshot so historical invoices don't drift when part prices change |
| partsNotes | string | Basic only. Free-text substitute for `partsUsed` |
| laborMinutes | number | Integer, entered via number input + quick-add (+15/+30/+60) |
| notes | string | Free-form internal notes |
| history | array | Capped at 50. `[{type, description, at, byUid, byEmail}]`. Types: `status_change`, `part_added`, `part_removed`, `note`, `invoice_generated` |
| invoiceId | string/null | Set when status = completed and invoice is generated |
| completedAt | timestamp/null | Set when status transitions to `completed`; distinct from `updatedAt` so turnaround time is reportable |
| createdAt, createdBy, updatedAt, updatedBy | audit | Standard portal pattern |

### `inventory/{partId}` (Parts — Pro tier only)

| Field | Type | Notes |
|---|---|---|
| sku | string | User-entered; must be unique per tenant (enforced client-side on create) |
| name | string | "iPhone 14 screen" |
| category | string | Free text, e.g. "Screens", "Batteries" |
| quantity | number | Current stock; decremented by ticket parts adds |
| reorderLevel | number | Qty threshold for the red low-stock badge (notification alerts are Enterprise, deferred) |
| unitCost | number | What the shop pays |
| unitPrice | number | What the shop charges |
| supplier | string | Free text; no separate supplier entity for MVP |
| notes | string | |
| audit fields | | |

### `counters/tickets` (singleton per tenant)

Single document at `tenants/{t}/counters/tickets` with shape `{ lastNumber: number }`. Minting a new ticket number uses `runTransaction` to read + increment + write atomically.

### `settings/general` (addition to existing tenant settings)

Adds `laborRate` field (number, dollars per hour). Invoice generation computes labor cost as `(laborMinutes / 60) × laborRate`. Editable from the portal Settings view; seeded to `0` when the tenant is provisioned — Repair tenants need to set this before generating their first invoice.

### No separate `stock_movements` collection

MVP does not audit stock changes. Decrements happen inline with ticket writes. Can be added later without breaking existing data.

### No separate check-in/out collection

Check-in is a UX flow that creates a ticket with status `checked_in`. Check-out is the "Generate Invoice" action inside the ticket drawer when status is `completed`.

---

## Section 2: UX & Flows

All three views follow the existing portal pattern: single ES-module file in `portal/js/views/repair/`, exports a `render()` function, uses `portal/js/services/firestore.js` for tenant-scoped CRUD, respects `canWrite()` and `hasFeature()` from `tenant-context.js`.

### Tickets view — `portal/js/views/repair/tickets.js`

**Route:** `/portal/app.html#/repair/tickets`

**List:** Table columns — Ticket#, Customer, Device, Status (pill), Age (days since created), Assigned Tech. Status filter tabs across the top: All / Checked In / In Repair / Awaiting Parts / Ready / Completed. Search box filters by ticket number, customer name, or device. Empty state: "No tickets yet — start by checking in a customer" with CTA to `/repair/checkin`.

**Detail drawer:** Right-side slide-in (matches existing contacts/invoicing drawer pattern). Contains:
- Editable header: device type, serial, customer (link to contact)
- Status dropdown with the 7 states
- Issue + condition + internal notes (inline edit)
- Assigned tech dropdown (tenant users)
- Estimated completion date picker
- **Parts section** — Pro tier: table with "Add Part" button opening an inventory dropdown; each row shows name/sku/qty/unit price/line total, remove button. Basic tier: single `partsNotes` textarea with placeholder "2× iPhone 14 screens — $120"
- **Labor section** — number input (minutes) + three quick-add buttons `+15 +30 +60`
- "Generate Invoice" button — enabled only when status = `completed` and `invoiceId` is null
- Activity history list at bottom — reverse-chronological `history` array entries

All write actions gated on `canWrite()`.

### Parts Inventory view — `portal/js/views/repair/inventory.js`

**Route:** `/portal/app.html#/repair/inventory`

**Access:** `hasFeature('inventory')` — Pro+ only. Direct URL access on Basic shows "Not included in your plan."

**List:** Table columns — SKU, Name, Category, Qty (red badge if `qty ≤ reorderLevel`), Reorder Level, Unit Cost, Unit Price. Inline-edit on quantity and prices (click-to-edit, matches invoicing line-item pattern). Search by SKU or name. "+ New Part" button opens a modal.

### Check-in view — `portal/js/views/repair/checkin.js`

**Route:** `/portal/app.html#/repair/checkin`

**Access:** `hasFeature('checkin')` — Pro+ only.

**Form:** Single-column layout, large inputs, designed for a front-counter tablet or desktop. Fields:
- **Customer** — typeahead against existing contacts; "+ New Customer" expands inline fields (name, phone, email) that create a contact on submit
- **Device Type** — free text
- **Serial / IMEI** — free text
- **Issue** — textarea
- **Condition** — textarea
- **Estimated Completion** — date input, defaults to today + 3 days

**Submit:**
1. Create contact if user chose "+ New Customer"
2. Mint next ticket number via `runTransaction` on `counters/tickets`
3. Create ticket with status = `checked_in`
4. Append `tenants/{t}/activity/` entry: `{ type: 'ticket_created', description: 'Ticket T-042 — iPhone 14 for Bob Smith' }`
5. Land on confirmation screen with the ticket number, a "Print Claim Tag" button, and two CTAs: "Check In Another" and "View Ticket"

**Claim tag print layout** — dedicated print stylesheet (`@media print`) renders a compact tag with ticket number, customer name, phone, device, condition summary, check-in date, estimated completion, and a torn-off customer copy. Uses `window.print()`.

### Ticket → Invoice mapping (check-out)

Triggered by "Generate Invoice" in the ticket drawer. Creates a new invoice in `tenants/{t}/invoices_crm/`:

- **Pro tier:** one line item per entry in `partsUsed` (description = part name, qty = qty, unitPrice = snapshot unitPrice). Plus one labor line: description = "Labor", qty = `laborMinutes / 60` (rounded to 0.25), unitPrice = `settings.laborRate`.
- **Basic tier:** single line item: description = `"Parts: " + partsNotes` (or just "Parts" if notes empty), qty = 1, unitPrice = manually entered by user in a prompt before generation. Plus the same labor line as Pro.
- Ticket's `invoiceId` set to the new invoice ID
- Ticket's `history` gets an `invoice_generated` entry
- `tenants/{t}/activity/` gets a `ticket_completed` entry

Invoice line items honor the Invoice UX preference (Hours / Qty labeling, 0.5 increments).

### Concurrency & transactions

These writes MUST use `runTransaction`:

1. **Minting ticket numbers** — read `counters/tickets`, increment `lastNumber`, write ticket in the same transaction
2. **Adding a part to a ticket** — read ticket + read inventory part, append to `partsUsed`, decrement `inventory.quantity`, write both
3. **Removing a part from a ticket** — same pattern, increment inventory back

Failing transactions (e.g., inventory went to zero in another window) surface a clear error toast.

### Sidebar integration

`tenant-context.js` already builds the nav from the tenant's `features` array. Add nav config for the three new feature slugs so they render in the sidebar when present:

- `tickets` — label "Tickets", icon "clipboard-list", route `/repair/tickets`
- `inventory` — label "Parts Inventory", icon "package", route `/repair/inventory`
- `checkin` — label "Check-In", icon "log-in", route `/repair/checkin`

---

## Section 3: File Manifest

**New files:**
- `portal/js/views/repair/tickets.js`
- `portal/js/views/repair/inventory.js`
- `portal/js/views/repair/checkin.js`
- `portal/css/print-claim-tag.css` (or inline `@media print` block in `portal.css`)

**Modified files:**
- `portal/js/main.js` — register routes for the three views
- `portal/js/tenant-context.js` — add sidebar nav entries for `tickets`, `inventory`, `checkin`
- `portal/js/views/shared/invoicing.js` — may need a `createInvoiceFromTicket(ticket)` helper exported
- `portal/js/views/settings.js` (or equivalent) — add `laborRate` field editor
- `crm/js/views/platform/tenant-provisioning.js` (or wherever provisioning lives) — seed `settings/general` with `laborRate: 0` when provisioning any tenant

---

## Section 4: Testing Strategy

Manual browser-based testing. No automated framework. Same pattern as Plans 5–6.

1. **Seed test tenant (Pro)** — admin CRM → create contact+company+deal with `vertical=repair`, `packageId=repair_pro`, provision. Log into portal as the tenant owner.
2. **Check-in flow** — create a new customer inline, check in a device, verify ticket number increments (T-001, T-002), verify claim tag prints correctly.
3. **Inventory** — add 3 parts; verify the red low-stock badge appears when qty ≤ reorderLevel; inline-edit prices and qty.
4. **Ticket lifecycle** — walk a ticket through every status; add 2 parts from inventory; verify inventory quantities decrement; add labor via quick-add buttons; generate invoice; verify invoice has the expected line items (parts + labor) and ticket.invoiceId is set; verify `tenants/{t}/activity/` has both `ticket_created` and `ticket_completed` entries.
5. **Concurrency spot-check** — open the same ticket in two windows, add different parts in each; verify both additions persist and inventory shows the correct final quantity.
6. **Tier gating (Basic)** — provision a second tenant on `repair_basic`; verify Inventory and Check-in nav links hidden; verify direct URL access shows "Not included in your plan"; verify ticket detail shows `partsNotes` textarea instead of parts picker; verify Basic invoice generation prompts for parts total and produces a single Parts line + labor line.
7. **Read-only mode** — admin CRM → flip the Pro tenant's status to `past_due`; verify all write buttons disabled across all three views; verify reads still work.
8. **Cross-tenant isolation** — from tenant A, attempt to open tenant B's ticket URL; verify Firestore rules block the read.

Testing order is linear (1 → 8). A failure at any step blocks later steps.

---

## What's next

After this plan is implemented and verified in production, the next plan is **Trades Vertical — Basic + Pro**, which will reuse patterns from this work:

- Jobs module (analogous to Tickets)
- Dispatching view (board grouped by tech)
- Quoting module (pre-sale document that converts to a Job)

Shared `scheduling` and `reporting` modules remain deferred and may be revisited in a later plan if customer demand surfaces.
