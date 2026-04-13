# Phase 2: Contacts & Pipeline — Design Spec

## Overview

Add contact management (people + companies) and a deal pipeline to the CRM. Both features share inline editing, activity logging, audit trails, and dual view modes (table/cards for contacts, kanban/table for deals).

## Data Model

### Companies Collection (`companies/{companyId}`)

| Field | Type | Notes |
|-------|------|-------|
| name | string | Required |
| phone | string | Main company phone |
| email | string | General company email |
| address | object | `{ street, city, state, zip, country }` |
| website | string | Optional |
| industry | string | Optional |
| notes | string | Freeform |
| createdAt | timestamp | Auto-set on create |
| createdBy | string | Firebase Auth UID |
| updatedAt | timestamp | Auto-set on every edit |
| updatedBy | string | Firebase Auth UID |

### Contacts Collection (`contacts/{contactId}`)

| Field | Type | Notes |
|-------|------|-------|
| firstName | string | Required |
| lastName | string | Required |
| email | string | Personal or work email |
| phone | string | Personal phone |
| companyId | string | Optional reference to a company doc |
| companyName | string | Denormalized for display (avoids extra Firestore reads) |
| jobTitle | string | Optional |
| notes | string | Freeform |
| createdAt | timestamp | Auto-set on create |
| createdBy | string | Firebase Auth UID |
| updatedAt | timestamp | Auto-set on every edit |
| updatedBy | string | Firebase Auth UID |

### Deals Collection (`deals/{dealId}`)

| Field | Type | Notes |
|-------|------|-------|
| name | string | Required. e.g. "Enterprise onboarding" |
| value | number | Dollar amount |
| stage | string | One of the pipeline stage IDs |
| contactId | string | Linked contact |
| contactName | string | Denormalized |
| companyId | string | Linked company (via contact or direct) |
| companyName | string | Denormalized |
| expectedClose | timestamp | Expected close date |
| notes | string | Freeform |
| createdAt | timestamp | Auto-set on create |
| createdBy | string | Firebase Auth UID |
| updatedAt | timestamp | Auto-set on every edit |
| updatedBy | string | Firebase Auth UID |

### Activity Log (subcollection: `contacts/{id}/activity` and `deals/{id}/activity`)

| Field | Type | Notes |
|-------|------|-------|
| type | string | "call", "email", "meeting", "note", "edit" |
| description | string | What happened (user-entered for manual entries) |
| field | string | For "edit" type: which field changed |
| oldValue | string | Previous value |
| newValue | string | New value |
| createdAt | timestamp | When it happened |
| createdBy | string | Firebase Auth UID |

### Pipeline Stages (`settings/pipeline`)

Stored as a Firestore document so stages are editable at runtime.

```json
{
  "stages": [
    { "id": "lead", "label": "Lead", "order": 0 },
    { "id": "qualified", "label": "Qualified", "order": 1 },
    { "id": "proposal", "label": "Proposal", "order": 2 },
    { "id": "won", "label": "Won", "order": 3, "closed": true },
    { "id": "lost", "label": "Lost", "order": 4, "closed": true }
  ]
}
```

Won and Lost are special "closed" stages that always appear at the end.

## UI: Contacts View

### Top Bar
- Search input (filters by name, email, company)
- "Add Contact" button
- View toggle: table (default) / cards

### Table Mode
- Columns: Name (first + last), Company, Email, Phone, Job Title
- Sortable by clicking column headers
- Click a row to open the contact detail panel

### Card Mode
- Grid of cards showing: initials avatar, name, company, job title, phone, email
- Click a card to open the contact detail panel

### Add Contact Flow
- "Add Contact" button opens the detail panel in create mode
- Required fields: first name, last name
- Optional fields pre-displayed but empty: email, phone, company, job title, notes
- Save button creates the doc and switches panel to view/edit mode

### Contact Detail Panel
- Slides in from the right side of the screen
- All fields displayed and inline-editable (click value to edit, Enter or blur to save)
- "Company" field is a searchable dropdown: pick existing company or create new inline
- Two tabs at the bottom:
  - **Details** — the contact fields
  - **Activity** — chronological log (newest first) of calls, emails, meetings, notes, and field edit history
- "Add Activity" button: type dropdown (call/email/meeting/note) + description textarea
- Delete button with confirmation dialog

### Company Management
- Companies are managed through contacts, not a separate top-level view
- Creating/editing a contact's company opens a small inline form
- Clicking a company name anywhere opens a company detail panel showing:
  - Company info (inline-editable)
  - All linked contacts
  - All linked deals
- Company detail panel uses the same slide-in pattern

## UI: Pipeline/Deals View

### Top Bar
- Search input (filters by deal name, contact, company)
- "Add Deal" button
- View toggle: kanban (default) / table
- Gear icon for pipeline settings

### Kanban Mode
- One column per stage: Lead, Qualified, Proposal, Won, Lost
- Column header shows: stage name, deal count, total value
- Deal cards show: deal name, value, contact name, company, expected close date
- Drag and drop cards between columns to change stage (auto-logs stage change in activity)
- Click a card to open deal detail panel

### Table Mode
- Columns: Deal Name, Value, Stage (colored badge), Contact, Company, Expected Close
- Sortable columns
- Click a row to open deal detail panel

### Add Deal Flow
- "Add Deal" button opens the deal detail panel in create mode
- Required fields: deal name
- Optional fields pre-displayed: value, stage (defaults to "Lead"), contact, company, expected close, notes
- Save button creates the doc and switches panel to view/edit mode

### Deal Detail Panel
- Same slide-in pattern as contacts
- All fields inline-editable
- Contact and Company fields are searchable dropdowns (pick from existing)
- Two tabs: **Details** | **Activity**
  - Activity log shows stage changes, field edits, calls, emails, meetings, notes — all with who/when
- "Add Activity" button (same pattern as contacts)
- Delete button with confirmation

### Pipeline Settings
- Accessed via gear icon in kanban top bar
- Simple list of stages: drag to reorder, inline rename, add new, delete
- Delete warns if deals exist in that stage
- Won and Lost are locked as "closed" stages at the end

## Shared Patterns

### Inline Editing
- Click any field value to convert it to an input
- Enter or blur to save; Escape to cancel
- On save: update Firestore doc, set `updatedAt`/`updatedBy`, write activity log entry with old → new value and who changed it
- Visual feedback: brief green flash on success, red flash + revert on error

### Activity Log
- Firestore subcollections on contacts and deals
- "edit" entries are auto-generated on any field change
- Manual entries (call, email, meeting, note) created by user via Add Activity form
- Displayed as a timeline, newest first, showing type icon, description, who, when

### Audit Trail
- Every Firestore write updates `updatedAt` and `updatedBy` on the document
- Every field change writes an activity log entry with the diff
- Provides at-a-glance "last modified by" plus full history in the activity tab

## File Structure

New files to create:

```
crm/js/
  services/
    firestore.js      — shared CRUD helpers (add, update, delete, query, subcollection writes)
    activity.js        — activity log read/write functions
  views/
    contacts.js        — contacts view logic (list, cards, detail panel, search, sort)
    pipeline.js        — pipeline view logic (kanban, table, detail panel, drag-drop)
  components/
    inline-edit.js     — reusable inline-edit behavior
    detail-panel.js    — slide-in panel shell (used by contacts + deals)
    dropdown.js        — searchable dropdown for company/contact pickers
```

## Firestore Security Rules

Extend existing rules to add:

- `companies/{companyId}` — read/write if authenticated
- `contacts/{contactId}/activity/{activityId}` — read/write if authenticated
- `deals/{dealId}/activity/{activityId}` — read/write if authenticated

Same pattern as existing collections.

## Out of Scope

- Bulk import/export
- Email integration (sending emails from CRM)
- File attachments on contacts or deals
- Advanced filtering/saved views
- Permissions per-contact or per-deal (all authenticated users see everything)
