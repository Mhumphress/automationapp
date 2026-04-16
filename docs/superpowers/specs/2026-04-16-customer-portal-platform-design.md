# Customer Portal & Multi-Tenant Platform Design

**Date:** 2026-04-16
**Status:** Approved
**Author:** Michael Humphress + Claude

---

## Overview

Build a full multi-tenant SaaS platform on top of the existing Automation App CRM. The platform sells hosted, industry-specific CRM/ERP solutions to customers across six verticals, managed entirely from the internal CRM with a customer-facing portal for self-service access.

### Key Decisions

- **Architecture:** Single Firestore project, multi-tenant (Approach A)
- **Verticals:** All 6 at launch (repair, trades, manufacturing, services, property, salon)
- **Payments:** Stripe-ready architecture, manual payments for now
- **Portal URL:** `portal.automationapp.org` (single portal, tenant login)
- **Missed payment:** Soft lock (read-only) → hard lock after grace period
- **Vertical approach:** Shared core CRM + vertical-specific modules (Approach B)
- **Pricing:** Published base prices with per-tenant override ability

---

## Section 1: Data Model

Everything builds on the existing Firestore project (`automation-app-crm`). New collections are added at the root level alongside existing CRM data.

### New Collections

#### `packages/{packageId}` — Product Catalog

| Field | Type | Description |
|-------|------|-------------|
| name | string | "RepairApp Pro" |
| vertical | string | repair, trades, manufacturing, services, property, salon |
| tier | string | basic, pro, enterprise |
| description | string | Plan description |
| basePrice | number | Monthly default in dollars |
| annualPrice | number | Annual default (approx 17% discount) |
| userLimit | number | Included users, 0 = unlimited |
| features | array | Feature slugs included in this package |
| addOns | array | Add-on slugs available for this package |
| sortOrder | number | Display ordering |
| active | boolean | Whether assignable to new tenants |

#### `addons/{addonId}` — Purchasable Extras

| Field | Type | Description |
|-------|------|-------------|
| name | string | "Additional User Seat" |
| slug | string | "extra_users" |
| priceMonthly | number | Monthly price |
| priceAnnual | number | Annual price |
| pricingModel | string | per_unit, flat, usage |
| description | string | Add-on description |
| applicableVerticals | array | ["all"] or specific verticals |
| active | boolean | Whether purchasable |

#### `features/{slug}` — Feature Registry

| Field | Type | Description |
|-------|------|-------------|
| name | string | "Parts Inventory" |
| slug | string | "inventory" |
| description | string | What this feature does |
| module | string | Maps to which UI module to load |
| verticals | array | Which verticals this feature applies to |
| gateType | string | "module" (show/hide view) or "capability" (enable/disable action) |

#### `verticals/{slug}` — Vertical Definitions

| Field | Type | Description |
|-------|------|-------------|
| name | string | "Field Service / Trades" |
| slug | string | "trades" |
| icon | string | Icon identifier |
| modules | array | Module slugs this vertical uses |
| terminology | map | {"ticket": "Job", "client": "Customer", ...} |
| defaultFeatures | array | What Basic tier always includes |
| description | string | Vertical description |

#### `tenants/{tenantId}` — Customer Businesses

| Field | Type | Description |
|-------|------|-------------|
| companyName | string | "Bob's HVAC" |
| vertical | string | Vertical slug |
| packageId | string | Package document ID |
| tier | string | basic, pro, enterprise |
| addOns | array | [{slug, qty}] |
| priceOverride | number/null | null = use package default |
| billingCycle | string | monthly, annual |
| status | string | active, past_due, suspended, cancelled |
| gracePeriodEnd | timestamp/null | Set when status goes to past_due |
| features | array | Computed from package + addons + overrides |
| featureOverrides | map | {feature_slug: true/false} for per-tenant overrides |
| userLimit | number | Computed: package base + extra_users addon |
| ownerUserId | string | Firebase UID of tenant owner |
| contactId | string | Link to internal CRM contact |
| companyId | string | Link to internal CRM company |
| dealId | string | Link to the won deal |
| scheduledChange | map/null | {packageId, tier, effectiveDate, reason} |
| trialEndsAt | timestamp/null | Trial expiration |
| onboardingStep | string | pending, setup, complete |
| dataExportRequested | boolean | Whether data export has been requested |
| dataExportGeneratedAt | timestamp/null | When export was generated |
| createdAt, createdBy, updatedAt, updatedBy | timestamps/strings | Standard audit fields |

#### `tenants/{tenantId}/users/{userId}` — Tenant Team Members

| Field | Type | Description |
|-------|------|-------------|
| email | string | User email |
| displayName | string | Display name |
| role | string | owner, admin, user, viewer |
| status | string | active, inactive |
| createdAt, invitedBy | timestamp/string | Audit fields |

#### `tenants/{tenantId}/invitations/{id}` — Pending Invites

| Field | Type | Description |
|-------|------|-------------|
| email | string | Invited email |
| role | string | Role to assign |
| status | string | pending, accepted, expired |
| invitedBy | string | Who sent the invite |
| createdAt, expiresAt | timestamps | Timing |

#### `tenants/{tenantId}/invoices/{invoiceId}` — Tenant Billing

| Field | Type | Description |
|-------|------|-------------|
| invoiceNumber | string | "INV-T-001" |
| amount | number | Total amount |
| status | string | draft, sent, paid, overdue |
| dueDate, issuedDate, paidDate | timestamps | Dates |
| lineItems | array | Invoice line items |
| linkedCrmInvoiceId | string | Links to internal CRM invoice |
| createdAt | timestamp | Created date |

#### `tenants/{tenantId}/payments/{id}` — Payment Records

| Field | Type | Description |
|-------|------|-------------|
| invoiceId | string | Linked invoice |
| amount | number | Payment amount |
| method | string | card, bank, check, cash, other |
| status | string | completed, failed, refunded |
| reference | string | External reference (check number, etc.) |
| processedAt, createdBy | timestamp/string | Audit fields |

#### `tenants/{tenantId}/activity/{id}` — Tenant Event Log

| Field | Type | Description |
|-------|------|-------------|
| type | string | plan_change, payment, status_change, user_invited, etc. |
| description | string | Human-readable description |
| metadata | map | Contextual data (old/new values, etc.) |
| createdAt, createdBy | timestamp/string | Audit fields |

#### `tenants/{tenantId}/notifications/{id}` — Communication Log

| Field | Type | Description |
|-------|------|-------------|
| type | string | payment_reminder, overdue_warning, suspension_notice, welcome |
| channel | string | email |
| recipientEmail | string | Who received it |
| subject | string | Notification subject |
| status | string | sent, failed |
| sentAt | timestamp | When sent |

#### `tenants/{tenantId}/settings/general` — Tenant Config

| Field | Type | Description |
|-------|------|-------------|
| timezone | string | "America/Chicago" |
| currency | string | "USD" |
| businessName | string | Display name |
| businessHours | map | {mon: "8-5", tue: "8-5", ...} |
| branding | map | {primaryColor: "#4F7BF7", logo: null} |

#### `settings/billing` — Global System Config

| Field | Type | Description |
|-------|------|-------------|
| gracePeriodDays | number | Default 30 |
| trialDays | number | Default 14 |
| defaultCurrency | string | "USD" |
| pastDueReminderDays | array | [3, 7, 14, 28] |

#### Tenant CRM Data Collections

Each vertical's data lives under the tenant:

```
tenants/{tenantId}/contacts/{id}
tenants/{tenantId}/tickets/{id}         — repair
tenants/{tenantId}/jobs/{id}            — trades
tenants/{tenantId}/work_orders/{id}     — manufacturing
tenants/{tenantId}/projects/{id}        — services
tenants/{tenantId}/properties/{id}      — property
tenants/{tenantId}/appointments/{id}    — salon
tenants/{tenantId}/inventory/{id}       — shared
tenants/{tenantId}/invoices_crm/{id}    — tenant's invoices to their clients
tenants/{tenantId}/scheduling/{id}      — shared scheduling
```

### Existing Collections (unchanged)

Internal CRM collections (`contacts`, `companies`, `deals`, `tasks`, `invoices`, `subscriptions`, `users`) remain as-is. The `tenants` collection bridges to internal CRM via `contactId`, `companyId`, `dealId`.

---

## Section 2: Pipeline Flow

### Stage 1: Lead Capture

Prospect creates a Contact + Company + Deal in the internal CRM. Deal gets new fields:

- `vertical` — which industry
- `packageId` — which package they want
- `addOns` — selected add-ons
- `billingCycle` — monthly or annual
- `priceOverride` — custom price or null for default

### Stage 2: Deal Won → Auto-Provision

When a deal moves to "Won" stage and admin clicks "Provision Tenant":

1. **Creates tenant** — from deal's vertical, package, add-ons, pricing
2. **Creates first invoice** — based on package price (or override), status: draft. Mirrored in internal CRM invoices.
3. **Creates tenant owner user** — from contact's email, status: pending
4. **Sends welcome notification** — logged in tenant notifications
5. **Creates internal subscription** — in CRM subscriptions collection for revenue tracking
6. **Logs activity** — on deal, tenant, and contact

### Stage 3: Billing Cycle

1. Admin CRM Renewals view shows upcoming renewals
2. Admin generates invoice for the tenant
3. Invoice appears in tenant portal and internal CRM
4. Payment received → mark paid → advance next renewal date

### Stage 4: Missed Payment → Soft Lock

1. Invoice status → overdue
2. Tenant status → `past_due`
3. `gracePeriodEnd` set (now + gracePeriodDays from settings)
4. Notification created
5. **Portal enters read-only mode** — Firestore rules block all writes

### Stage 5: Grace Period Expires → Hard Lock

1. Tenant status → `suspended`
2. Notification created
3. **Portal shows payment-required screen only** — no data access
4. Data preserved, never auto-deleted

### Stage 6: Payment Restored

1. Payment logged, invoice marked paid
2. Tenant status → `active`
3. `gracePeriodEnd` cleared
4. Full access restored immediately
5. Activity logged

### Stage 7: Cancellation

1. `scheduledChange` set with cancellation at end of current billing cycle
2. Full access until effective date
3. On effective date, status → `cancelled`
4. Read-only for 30 days (data export window)
5. Hard lock after 30 days
6. Data retained 90 days, then eligible for deletion

---

## Section 3: Customer Portal

### Location

`portal.automationapp.org` — served from `/portal/` in Cloudflare Pages deploy.

### Authentication

Same Firebase Auth as internal CRM. After login, checks if user exists in any `tenants/{tenantId}/users` collection. Multi-tenant users see a tenant picker.

### Portal Structure

**Layer 1: Account Management** (all tenants)
- **Dashboard** — account status, plan, next billing, quick stats
- **Subscription** — plan details, tier comparison, upgrade/downgrade request, add-on management
- **Billing** — invoice history, payment history, PDF download, outstanding balance
- **Team** — invite users, manage roles, remove users, pending invitations
- **Settings** — business name, timezone, currency, hours, branding
- **Help** — docs link, contact support form, changelog

**Layer 2: Tenant CRM** (vertical-specific)
- Modules load based on vertical + tier
- Sidebar built dynamically from tenant's feature set
- Gated features show upgrade prompt

### File Structure

```
shared/
  js/
    router.js
    ui.js
    config.js
    components/
      modal.js
      dropdown.js
      inline-edit.js
portal/
  index.html
  app.html
  css/
    portal.css
  js/
    main.js
    auth.js
    tenant-context.js
    services/
      firestore.js       — tenant-scoped CRUD wrapper
      roles.js            — tenant role checks
    views/
      dashboard.js
      subscription.js
      billing.js
      team.js
      settings.js
      shared/
        contacts.js
        invoicing.js
        tasks.js
        scheduling.js
        reporting.js
      repair/
        tickets.js
        inventory.js
      trades/
        dispatching.js
        jobs.js
        quoting.js
      manufacturing/
        bom.js
        work-orders.js
        production.js
      services/
        projects.js
        time-tracking.js
        proposals.js
      property/
        properties.js
        leases.js
        maintenance.js
      salon/
        appointments.js
        service-menu.js
        staff-calendar.js
        client-loyalty.js
```

### Tenant Context (`tenant-context.js`)

The gatekeeper module. On portal load:

1. Fetches tenant doc
2. Fetches package doc
3. Computes effective feature set: `package.features` + `addon features` + `featureOverrides`
4. Checks tenant status and enforces access mode
5. Exposes: `hasFeature(slug)`, `isReadOnly()`, `isSuspended()`, `canWrite()`, `gateWrite(fn)`

### Visual Distinction

Portal uses a different accent color from the internal CRM (teal/green vs blue). Sidebar shows tenant business name and "Customer Portal" badge.

### Onboarding Flow

New tenant's first login triggers a setup wizard:
1. Confirm business name, timezone, currency
2. Invite team members (or skip)
3. Quick tour of vertical's modules
4. Mark complete, land on dashboard

### Firestore Rules for Tenants

```
match /tenants/{tenantId} {
  allow read: if isTenantMember(tenantId);
  allow write: if isAdmin();

  match /users/{userId} {
    allow read: if isTenantMember(tenantId);
    allow create, update: if isTenantAdmin(tenantId);
    allow delete: if isTenantOwner(tenantId);
  }

  match /{collection}/{docId} {
    allow read: if isTenantMember(tenantId);
    allow create, update: if isTenantMember(tenantId) && tenantIsActive(tenantId);
    allow delete: if isTenantAdmin(tenantId) && tenantIsActive(tenantId);
  }
}
```

Rule helper functions:
- `isTenantMember(tenantId)` — user exists in `tenants/{tenantId}/users`
- `isTenantAdmin(tenantId)` — member with role admin or owner
- `isTenantOwner(tenantId)` — member with role owner
- `tenantIsActive(tenantId)` — status is active (blocks writes for past_due/suspended/cancelled)

Soft lock enforced at Firestore level — UI disabling is a UX convenience, not the security boundary.

---

## Section 4: Industry Vertical Modules

### Shared Modules (All Verticals)

| Module | Description |
|--------|-------------|
| Contacts | Customer/client management |
| Invoicing | Billing, line items, PDF export |
| Tasks | Work items, assignments, kanban |
| Scheduling | Calendar with staff columns, drag-and-drop, entity linking |
| Reporting | Dashboard stats, charts, data export |

Scheduling is a shared module used across all verticals. The calendar view is the same everywhere — event labels, entity links, and staff terminology come from the vertical config.

### Tier Gating Pattern

All verticals follow the same pattern:
- **Basic:** Contacts + core vertical module + Invoicing + Tasks
- **Pro:** + remaining vertical modules + Scheduling + Reporting + Multi-user
- **Enterprise:** + advanced features + API + Custom fields + unlimited users/locations

---

### 1. Electronics / Device Repair ("RepairApp")

**Terminology:** Client→Customer, Ticket→Repair Ticket, Item→Device, Inventory→Parts

**Unique Modules:**

**Tickets** — Core workflow
- Check-in form: customer, device type, issue, serial/IMEI, condition, estimated completion
- Status pipeline: Checked In → Diagnosed → Awaiting Parts → In Repair → Quality Check → Ready for Pickup → Completed
- Parts used linked from inventory, labor time tracking
- Print ticket receipt / claim tag

**Parts Inventory**
- Parts list with SKU, quantity, reorder level, cost, sell price, supplier
- Low-stock alerts
- Parts usage linked to tickets (stock decrements)
- Basic purchase orders

**Check-in / Check-out**
- Quick-entry streamlined form for front-counter intake
- Auto-generates ticket, prints claim tag
- Check-out: mark complete, generate invoice from ticket

| Tier | Modules |
|------|---------|
| Basic | Contacts, Tickets, Invoicing, Tasks |
| Pro | + Parts Inventory, Check-in/Check-out, Scheduling, Reporting, Multi-user |
| Enterprise | + Low-stock alerts, Purchase Orders, API, Custom fields |

---

### 2. Field Service / Trades ("TradesApp")

**Terminology:** Client→Customer, Ticket→Job, Item→Service Call, Inventory→Materials

**Unique Modules:**

**Dispatching**
- Today's dispatch board grouped by technician
- Status: Scheduled → En Route → On Site → Completed
- Quick-reassign, job notes, materials used

**Jobs**
- Job detail: customer, address, service type, technician, schedule
- Materials used, labor clock in/out
- Quote → Job conversion, Job → Invoice generation

**Quoting**
- Line items with services + materials
- Status: Draft → Sent → Accepted → Declined
- Accepted quote auto-creates job, PDF export

| Tier | Modules |
|------|---------|
| Basic | Contacts, Jobs, Invoicing, Tasks |
| Pro | + Scheduling, Dispatching, Quoting, Reporting, Multi-user |
| Enterprise | + Recurring jobs, Online booking, Inventory/Materials, API, Custom fields |

---

### 3. Small-Scale Manufacturing ("MfgApp")

**Terminology:** Client→Customer, Ticket→Work Order, Item→Product, Inventory→Raw Materials & Finished Goods

**Unique Modules:**

**BOM Management**
- Product list with BOM: raw materials/components with quantities
- Multi-level BOM (subassemblies), cost rollup

**Work Orders**
- Select product, quantity, due date
- Auto-calculates required materials from BOM
- Status: Planned → In Production → Quality Check → Completed
- Material consumption on completion, finished goods stock update

**Production Planning** (Enterprise)
- Calendar view of upcoming work orders
- Material availability check, shortfall alerts
- Capacity view: hours planned vs available

| Tier | Modules |
|------|---------|
| Basic | Contacts, Inventory (basic), Invoicing, Tasks |
| Pro | + BOM Management, Work Orders, Scheduling, Reporting, Multi-user |
| Enterprise | + Production Planning, Multi-level BOM, Purchase Orders, API, Custom fields |

---

### 4. Professional Services / Consulting ("ServicesApp")

**Terminology:** Client→Client, Ticket→Task, Item→Deliverable

**Unique Modules:**

**Projects**
- Project list: name, client, status, budget, dates
- Status: Proposal → Active → On Hold → Completed → Archived
- Budget tracking (budget vs hours × rate), linked tasks/time/invoices

**Time Tracking**
- Start/stop timer, manual entry
- Weekly timesheet grid, billable vs non-billable toggle

**Proposals**
- Scope, deliverables, timeline, pricing with line items
- Status: Draft → Sent → Accepted → Declined
- Accepted proposal auto-creates project, PDF export

**Resource Scheduling** (Enterprise)
- Team availability, utilization dashboard, project allocation

| Tier | Modules |
|------|---------|
| Basic | Contacts, Tasks, Invoicing, Time Tracking (manual only) |
| Pro | + Projects, Proposals, Timer, Scheduling, Reporting, Multi-user |
| Enterprise | + Resource Scheduling, Utilization dashboard, Budget tracking, API, Custom fields |

---

### 5. Property Management ("PropertyApp")

**Terminology:** Client→Owner/Tenant, Ticket→Maintenance Request, Item→Unit

**Unique Modules:**

**Properties & Units**
- Property list: address, type, units, owner
- Unit detail: number, beds/baths, sqft, status (vacant/occupied/maintenance), current tenant, rent
- Vacancy tracking

**Leases**
- Lease list: tenant, unit, dates, rent, status
- Status: Draft → Active → Expiring → Expired → Terminated
- Auto-flag expiring within 60 days
- Lease → recurring invoice generation

**Maintenance Requests**
- Status: Submitted → Assigned → In Progress → Completed
- Tenant-submitted requests from portal
- Vendor assignment, cost tracking

**Rent Collection** (built on shared invoicing)
- Dashboard: due, collected, outstanding
- Bulk invoice generation for all active leases

| Tier | Modules |
|------|---------|
| Basic | Contacts, Properties & Units (up to 25 units), Invoicing, Tasks |
| Pro | + Leases, Maintenance Requests, Rent Collection, Scheduling, Reporting (up to 100 units), Multi-user |
| Enterprise | + Bulk invoicing, Vacancy analytics, Vendor management, API, Unlimited units, Custom fields |

---

### 6. Salon / Spa / Appointments ("SalonApp")

**Terminology:** Client→Client, Ticket→Appointment, Item→Service, Inventory→Products

**Unique Modules:**

**Appointments** (extends shared Scheduling)
- Salon-specific additions: service menu integration, walk-in mode, online booking link
- Status: Booked → Confirmed → In Progress → Completed → No Show

**Service Menu**
- Services with category, duration, price
- Staff assignment per service
- Package/bundle creation

**Staff Calendar**
- Per-staff working hours, days off, vacations
- Availability view, utilization tracking

**Client Loyalty** (Pro+)
- Visit tracking, points system
- Client preferences, birthday flags

| Tier | Modules |
|------|---------|
| Basic | Contacts, Appointments (1 staff), Service Menu, Invoicing, Tasks |
| Pro | + Staff Calendar, Client Loyalty, Online booking, Scheduling, Reporting (up to 5 staff), Multi-user |
| Enterprise | + Commission tracking, Multi-location, Product Inventory, API, Unlimited staff, Custom fields |

---

### Module Summary

| Module | Shared | Repair | Trades | Mfg | Services | Property | Salon |
|--------|--------|--------|--------|-----|----------|----------|-------|
| Contacts | X | | | | | | |
| Invoicing | X | | | | | | |
| Tasks | X | | | | | | |
| Scheduling | X | | | | | | |
| Reporting | X | | | | | | |
| Tickets | | X | | | | | |
| Parts Inventory | | X | | | | | |
| Check-in/out | | X | | | | | |
| Dispatching | | | X | | | | |
| Jobs | | | X | | | | |
| Quoting | | | X | | | | |
| BOM | | | | X | | | |
| Work Orders | | | | X | | | |
| Production | | | | X | | | |
| Projects | | | | | X | | |
| Time Tracking | | | | | X | | |
| Proposals | | | | | X | | |
| Properties | | | | | | X | |
| Leases | | | | | | X | |
| Maintenance | | | | | | X | |
| Appointments | | | | | | | X |
| Service Menu | | | | | | | X |
| Staff Calendar | | | | | | | X |
| Client Loyalty | | | | | | | X |

5 shared + 19 vertical-specific = 24 module view files in the portal.

---

## Section 5: Admin CRM Enhancements

### New Sidebar Section: "Platform"

```
Overview
  Dashboard (existing, enhanced)

Manage
  Contacts (existing)
  Companies (existing)
  Pipeline (existing, enhanced)
  Tasks (existing)
  Invoices (existing)
  Subscriptions (existing)

Platform                    <- NEW
  Tenants
  Packages
  Renewals

Admin
  Settings (existing)
```

### Tenants View

**List View:** Table with Company Name, Vertical (badge), Package/Tier, Status (pill), MRR, Next Renewal, Owner Contact. Filters by vertical, tier, status. Search across company name, owner email.

**Tenant Detail Page:**
- *Account Section:* Company name, vertical, status, linked CRM records, onboarding status
- *Subscription Section:* Package/tier (editable), billing cycle, pricing (base + override), add-ons, renewal date, scheduled changes, "Change Plan" button
- *Billing Section:* Invoice history, "Generate Invoice" button, payment history, outstanding balance, grace period status
- *Access Control Section:* Suspend/Restore/Toggle Read-Only buttons, feature overrides, user limit override
- *Users Section:* Tenant users table, invite/remove/change role
- *Activity Log:* Full tenant event timeline

### Packages View

**List View:** Grouped by vertical, tier cards within each. Active/inactive toggle.

**Package Detail:** Name, vertical, tier, pricing, user limit, feature checklist, add-ons checklist, sort order, active toggle, "Duplicate Package" button.

**Sub-sections:** Features Management, Add-ons Management, Verticals Management.

### Renewals View

- **Upcoming Renewals:** Tenants renewing in next 30 days with "Generate Invoice" quick action
- **Overdue Accounts:** Past due/suspended tenants with "Send Reminder", "Suspend", "Restore" actions
- **Revenue Summary:** MRR, ARR, breakdown by vertical (bar chart), breakdown by tier (pie chart), churn metrics

### Pipeline Enhancement

Existing deals view gets new fields: Vertical, Package, Add-ons, Billing Cycle, Price Override. When deal moves to "Won", a "Provision Tenant" button appears with confirmation modal.

### Dashboard Enhancement

New "Platform" stats row: Active Tenants, MRR, Renewals This Week, Overdue Accounts (red if > 0).

---

## Section 6: Testing Strategy

### Layer 1: Data Model & Firestore Rules

Test every collection CRUD. Test rules for every role combination (admin, tenant owner/admin/user/viewer, unauthenticated). Verify cross-tenant isolation. Verify soft lock (past_due: read yes, write no) and hard lock (suspended: no access). Dedicated test page (`/crm/test-rules.html`).

### Layer 2: Admin CRM — Packages & Verticals

Create all 6 verticals, 18 packages, all add-ons, all features. Verify CRUD, deactivation, duplication. Manual browser walkthrough — doubles as production data seeding.

### Layer 3: Admin CRM — Tenant Provisioning

End-to-end: contact → company → deal (with vertical/package) → won → "Provision Tenant" → verify tenant doc, invoice, owner user, subscription, activity logs. Test with two different verticals.

### Layer 4: Customer Portal — Auth & Tenant Context

Login as provisioned tenant owner. Verify auth guard, tenant context loading, feature gating, sidebar modules, onboarding flow. Test multi-tenant user with tenant picker.

### Layer 5: Customer Portal — Shared Modules

For each shared module (Contacts, Invoicing, Tasks, Scheduling, Reporting): CRUD, tenant isolation, search/sort, inline editing, activity logging, PDF export. Verify Tenant A data invisible to Tenant B.

### Layer 6: Customer Portal — Vertical Modules

| Vertical | Key Workflow |
|----------|-------------|
| Repair | Ticket → add parts → complete → generate invoice |
| Trades | Quote → accept → job → dispatch → complete → invoice |
| Manufacturing | Product + BOM → work order → materials deducted → finished goods |
| Services | Proposal → accept → project → log time → invoice |
| Property | Property + units → lease → rent invoice → maintenance request |
| Salon | Services → appointment → complete → invoice → loyalty points |

### Layer 7: Access Control & Billing States

Test active (full access), past_due (read-only, UI + Firestore enforcement), suspended (payment screen only), restored (full access, no data loss), plan upgrade (new modules appear), plan downgrade (modules hidden, data preserved). Two browser windows: admin CRM + customer portal.

### Layer 8: Renewals & Billing Cycle

Upcoming renewals display, invoice generation, payment marking, renewal date advancement, overdue auto-status-change, grace period countdown, revenue summary accuracy.

### Testing Order

```
Layer 1 → Layer 2 → Layer 3 → Layer 4 → Layer 5 → Layer 6 → Layer 7 → Layer 8
```

Each layer depends on the previous. Testing is manual browser-based with real Firestore operations — no test framework. The rules test page is the one semi-automated piece.
