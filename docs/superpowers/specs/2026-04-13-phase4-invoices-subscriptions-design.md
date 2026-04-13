# Phase 4: Invoices & Subscriptions — Design Spec

## Overview

Add invoice management with itemized line items, tax calculation, and PDF download. Add client subscription tracking with payment history and invoice auto-generation. Add internal subscription tracking (expenses) as a simpler list. The Subscriptions nav item shows both client and internal subscriptions via a tab toggle.

## Data Model

### Invoices Collection (`invoices/{invoiceId}`)

| Field | Type | Notes |
|-------|------|-------|
| invoiceNumber | string | Auto-generated (INV-001, INV-002, etc.) |
| contactId | string | Linked client contact |
| contactName | string | Denormalized |
| companyId | string | Linked company |
| companyName | string | Denormalized |
| status | string | "draft", "sent", "paid", "overdue" |
| issueDate | timestamp | When invoice was issued |
| dueDate | timestamp | Payment due date |
| lineItems | array | Each: `{ description, quantity, rate, amount }` |
| subtotal | number | Sum of line item amounts |
| taxRate | number | Tax percentage (e.g., 8.25) |
| taxAmount | number | Calculated tax |
| total | number | subtotal + taxAmount |
| notes | string | Freeform |
| createdAt | timestamp | Auto |
| createdBy | string | UID |
| updatedAt | timestamp | Auto |
| updatedBy | string | UID |

### Client Subscriptions Collection (`subscriptions/{subId}`)

| Field | Type | Notes |
|-------|------|-------|
| contactId | string | Linked client |
| contactName | string | Denormalized |
| companyId | string | Linked company |
| companyName | string | Denormalized |
| planName | string | Service/plan name |
| amount | number | Billing amount |
| billingCycle | string | "monthly" or "yearly" |
| startDate | timestamp | When subscription started |
| status | string | "active", "cancelled", "past_due" |
| nextRenewal | timestamp | Next billing date |
| notes | string | Freeform |
| createdAt | timestamp | Auto |
| createdBy | string | UID |
| updatedAt | timestamp | Auto |
| updatedBy | string | UID |

### Subscription Payments (subcollection: `subscriptions/{subId}/payments`)

| Field | Type | Notes |
|-------|------|-------|
| amount | number | Payment amount |
| date | timestamp | Payment date |
| method | string | "card", "bank", "cash", "other" |
| notes | string | Optional |
| createdAt | timestamp | Auto |
| createdBy | string | UID |

### Internal Subscriptions Collection (`internal_subs/{id}`)

| Field | Type | Notes |
|-------|------|-------|
| vendor | string | Who you're paying |
| serviceName | string | What service |
| cost | number | Amount per cycle |
| billingCycle | string | "monthly" or "yearly" |
| renewalDate | timestamp | Next renewal |
| category | string | Optional (e.g., "Software", "Hosting") |
| notes | string | Freeform |
| createdAt | timestamp | Auto |
| createdBy | string | UID |
| updatedAt | timestamp | Auto |
| updatedBy | string | UID |

## UI: Invoices View

### List View — Table
- Columns: Invoice #, Client, Amount, Status (badge), Issue Date, Due Date
- Sortable by all columns
- Searchable by invoice number, client name, company
- Overdue invoices: row gets subtle red tint
- Status badges: draft=gray, sent=blue, paid=green, overdue=red
- Click row → invoice detail page

### Create Invoice — Modal
- Client: searchable dropdown (contacts)
- Issue Date, Due Date: date inputs
- Line Items section:
  - Table with columns: Description, Qty, Rate, Amount (auto-calculated: qty * rate)
  - "Add Line Item" button adds a new row
  - X button removes a row
  - Subtotal displays below the table, auto-updates
- Tax Rate: number input (percentage)
- Tax Amount + Total: auto-calculated, displayed below
- Notes: textarea
- "Create Invoice" button + cancel

### Invoice Detail Page
- Back button: "← Back to Invoices"
- Header: Invoice number + client name + status badge + "Download PDF" button + delete button
- Status pills: Draft / Sent / Paid / Overdue
- Line items table (editable inline — click to edit description/qty/rate, amount recalculates)
- Totals section: subtotal, tax, total
- Invoice info fields: client, issue date, due date, notes (inline-editable)
- Activity timeline on the right

### PDF Download
- "Download PDF" button on detail page
- Opens a print-optimized view of the invoice in a new window/tab
- Clean layout: company logo area, invoice number, client info, line items table, totals, notes
- Uses `@media print` CSS for clean output
- User presses Ctrl+P or the page auto-triggers `window.print()`
- Print CSS hides everything except the invoice content

## UI: Subscriptions View

The Subscriptions nav item leads to a view with a tab toggle at the top: **Client** | **Internal**.

### Client Subscriptions Tab

**List View — Table:**
- Columns: Client, Plan, Amount, Cycle, Status (badge), Next Renewal
- Status badges: active=green, cancelled=gray, past_due=red
- Sortable, searchable
- Click row → subscription detail page

**Create — Modal:**
- Client (searchable dropdown), Plan Name, Amount, Billing Cycle (select: Monthly/Yearly), Start Date, Notes
- nextRenewal auto-calculated from startDate + cycle

**Detail Page:**
- Back button, header with plan name + client + status badge + delete
- Status pills: Active / Cancelled / Past Due
- Two-column layout: fields left, activity + payments right
- Editable fields: plan name, amount, cycle, start date, next renewal, notes, linked client
- Payment History section:
  - List of payments (date, amount, method)
  - "Log Payment" button opens inline form: amount, date, method (select), notes
- "Generate Invoice" button: visible when subscription is active. Creates a pre-filled invoice with the subscription amount as a single line item, linked to the same client, due date = next renewal.
- Activity timeline with composer

### Internal Subscriptions Tab

**List View — Table:**
- Columns: Vendor, Service, Cost, Cycle, Renewal Date
- Sortable, searchable
- Click row → simple detail page

**Create — Modal:**
- Vendor, Service Name, Cost, Billing Cycle, Renewal Date, Category (optional), Notes

**Detail Page:**
- Back button, header with service name + vendor
- Editable fields: vendor, service, cost, cycle, renewal date, category, notes
- No activity timeline (simpler view)
- Delete button

## Firestore Security Rules

Add to `crm/firestore.rules`:
```
match /invoices/{invoiceId}/activity/{activityId} {
  allow read, write: if isAuth();
}
match /subscriptions/{subId}/activity/{activityId} {
  allow read, write: if isAuth();
}
match /subscriptions/{subId}/payments/{paymentId} {
  allow read, write: if isAuth();
}
match /internal_subs/{id} {
  allow read, write: if isAuth();
}
```

## Files

- **Create:** `crm/js/views/invoices.js` — invoice list, create modal, detail page, PDF print view
- **Create:** `crm/js/views/subscriptions.js` — client + internal subs with tab toggle
- **Modify:** `crm/css/app.css` — invoice line items table, subscription styles, print CSS, tab toggle
- **Modify:** `crm/app.html` — replace placeholders, add imports, register views
- **Modify:** `crm/firestore.rules` — add new rules

## Out of Scope

- Automatic recurring invoice generation (manual "Generate Invoice" button only)
- Payment gateway integration (Stripe, etc.)
- Email invoices to clients
- Multi-currency support
- Invoice templates/customization
