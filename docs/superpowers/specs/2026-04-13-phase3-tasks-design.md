# Phase 3: Task Management — Design Spec

## Overview

Add a task management system with a kanban board (To Do / In Progress / Done), drag-and-drop, priority levels, due dates with browser push notifications, and optional linking to contacts and deals. Tasks follow the same UI patterns established in Phase 2: centered modal for creation, full detail page for viewing/editing, activity logging, and audit trails.

## Data Model

### Tasks Collection (`tasks/{taskId}`)

| Field | Type | Notes |
|-------|------|-------|
| title | string | Required |
| description | string | Freeform details |
| status | string | "todo", "in_progress", "done" |
| priority | string | "high", "medium", "low" |
| dueDate | timestamp | Optional |
| assigneeId | string | Firebase Auth UID |
| assigneeEmail | string | Denormalized for display |
| contactId | string | Optional link to contact |
| contactName | string | Denormalized |
| dealId | string | Optional link to deal |
| dealName | string | Denormalized |
| createdAt | timestamp | Auto-set on create |
| createdBy | string | Firebase Auth UID |
| updatedAt | timestamp | Auto-set on every edit |
| updatedBy | string | Firebase Auth UID |

### Activity Log (subcollection: `tasks/{taskId}/activity`)

Same schema as contacts/deals activity: type, description, field, oldValue, newValue, createdAt, createdBy, createdByEmail.

## Task View — Kanban Board

**Top Bar:**
- Search input (filters by title, assignee, linked contact/deal)
- "Add Task" button

**Kanban Columns:**
- Three fixed columns: To Do, In Progress, Done
- Column header shows: column name, task count
- Drag and drop task cards between columns to change status (auto-logs status change in activity)

**Task Cards:**
- Title (bold)
- Priority badge: colored dot — red for high, amber for medium, blue for low
- Due date (if set) — shows relative date. Overdue dates shown in red text with a red left-border on the card
- Assignee: small avatar circle with initials (or email initial)
- Linked contact/deal name in muted text if present
- Click card opens task detail page

## Create Task — Centered Modal

Same modal pattern as contacts/deals.

**Fields:**
- Title (required, text input)
- Description (textarea)
- Priority (select: High / Medium / Low, default Medium)
- Due Date (date input)
- Assignee (dropdown — for now, pre-fills with current logged-in user; future: list of team users)
- Contact (searchable dropdown from existing contacts, optional)
- Deal (searchable dropdown from existing deals, optional)

**Actions:**
- Full-width "Create Task" button
- Cancel link below

## Task Detail — Full Page

Same pattern as contact/deal detail pages.

**Header:**
- Back button: "← Back to Tasks"
- Task title in display font
- Priority badge next to title
- Delete button aligned right

**Status Pills:**
- Row of pill buttons: To Do / In Progress / Done
- Active status highlighted (like deal stage pills)
- Click to change status (logs activity)

**Two-Column Layout:**
- **Left:** Editable fields — title, description, priority (dropdown), due date, assignee, linked contact (dropdown), linked deal (dropdown). All inline-editable with activity logging.
- **Right:** Activity timeline with composer (same pattern as contacts/deals)

## Browser Push Notifications

**Permission Request:**
- On first dashboard render, if `Notification.permission === 'default'`, show an in-app prompt (not the raw browser prompt): a subtle banner at the top of the dashboard saying "Enable notifications to get reminders about upcoming tasks" with an "Enable" button
- Clicking "Enable" triggers `Notification.requestPermission()`
- If already granted or denied, don't show the banner

**Notification Triggers:**
- On dashboard render, check all open tasks (status !== "done")
- Tasks overdue (dueDate < now): show notification "Task overdue: [title]"
- Tasks due within 24 hours: show notification "Due soon: [title]"
- Track which task IDs have been notified this session in a Set to avoid repeats

**Notification Format:**
- Title: "Automation App CRM"
- Body: "Task overdue: [task title]" or "Due soon: [task title]"
- Icon: use the app logo if available

## Activity Logging

- Task status changes → activity entry on the task
- Task field edits → activity entry on the task (same logFieldEdit pattern)
- Manual entries (call, email, meeting, note) → activity entry on the task
- When a task is linked to a contact: task creation and status changes also write an activity entry to that contact's activity subcollection (cross-reference)
- When a task is linked to a deal: same cross-reference activity logging

## Dashboard Integration

- "Open Tasks" stat card: count of tasks where `status !== 'done'`
- Drill-down: 5 most recent open tasks (title + priority badge + due date). Click navigates to `#tasks`.
- Wire the notification check into the dashboard render function

## Firestore Security Rules

Add to `crm/firestore.rules`:
```
match /tasks/{taskId}/activity/{activityId} {
  allow read, write: if isAuth();
}
```

## Files

- **Create:** `crm/js/views/tasks.js` — task view (kanban, create modal, detail page, activity)
- **Modify:** `crm/css/app.css` — task-specific styles (priority dots, overdue highlighting, notification banner)
- **Modify:** `crm/app.html` — replace tasks placeholder, add import, register view, update dashboard to include tasks stat + notifications
- **Modify:** `crm/firestore.rules` — add tasks activity subcollection rule

## Out of Scope

- Recurring/repeating tasks
- Task templates
- Subtasks/checklists within a task
- Calendar view
- Email notifications (browser only)
- Multi-user assignee dropdown (uses current user for now)
