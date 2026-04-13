# UI Overhaul: Contacts & Pipeline — Design Spec

## Overview

Full visual redesign of the contacts and pipeline content areas. The dark sidebar and header shell stay as-is. Everything inside the main content area gets rebuilt with a premium, modern feel: generous whitespace, smooth animations, centered modals for creation, full detail pages for editing, and polished tables/cards.

## Guiding Principles

- **Breathing room everywhere.** Generous padding, tall rows, spacious fields. Nothing should feel cramped.
- **User-friendly first.** Every interaction should feel obvious. Labels are clear, buttons are prominent, empty states are helpful.
- **Smooth and alive.** Subtle transitions on every interaction — hover lifts, focus glows, fade-in entrances. The app should feel responsive and fluid.
- **Premium, not flashy.** Soft shadows instead of hard borders. Muted secondary text. Clean typography hierarchy. No clutter.

## Modals: Create Contact / Create Deal

Centered overlay modal replaces the current slide-in panel for creating new contacts and deals.

**Structure:**
- Full-screen backdrop with `rgba(0,0,0,0.4)` + `backdrop-filter: blur(4px)`
- Centered white card: `max-width: 560px`, `border-radius: 16px`, `padding: 2.5rem`
- Entrance animation: fade in backdrop, modal scales from 0.95 to 1.0 with opacity 0 to 1 (200ms ease-out)
- Exit: reverse animation

**Form layout:**
- Two-column grid for short fields on desktop (first name / last name side by side, email / phone side by side). Single column on mobile.
- Each input: tall (48px height), `border-radius: 8px`, light border `#E2E8F0`, generous padding `0.75rem 1rem`
- Labels above inputs, `font-size: 0.75rem`, `font-weight: 600`, uppercase, `letter-spacing: 0.06em`, `color: var(--gray-dark)`, `margin-bottom: 0.5rem`
- Focus state: border transitions to `var(--accent)`, soft `box-shadow: 0 0 0 3px rgba(79,123,247,0.12)`
- Company/contact dropdown fields styled to match (same height, border, radius)
- Notes textarea: 3 rows default, same styling
- Primary button: full width, 48px tall, `border-radius: 8px`, `var(--accent)` background, bold white text, hover darkens + adds shadow
- Cancel: text-only link below the button, centered, `color: var(--gray-dark)`, hover underlines. Not a button.
- Modal header: title (`font-family: var(--font-display)`, `1.5rem`, `font-weight: 600`) + close X button top-right

**Close behavior:** Click backdrop, click X, or press Escape.

## Tables

Polish the existing table structure with more space and cleaner visuals.

**Changes:**
- Row height increased: padding `1rem 1.5rem` (from `0.875rem 1.25rem`)
- Remove all visible borders between rows. Use alternating subtle background instead: odd rows `#fff`, even rows `#FAFBFC`
- Header row: slightly darker background `#F1F5F9`, bottom border `1px solid #E2E8F0`
- Contact name column: render inline avatar circle (initials, 32px, `var(--accent-dim)` bg) + name in `font-weight: 500` + company underneath in smaller muted text — both in the same cell, stacked
- Other columns: `color: var(--gray-dark)`, `font-size: 0.85rem`
- Row hover: background shifts to `#F0F4FF` (very subtle blue tint)
- Table container: `border-radius: 12px`, `overflow: hidden`, soft `box-shadow: 0 1px 3px rgba(0,0,0,0.04)`, white background
- Sort indicators: cleaner chevron icons instead of text arrows

## Cards

Elevate the existing card grid with shadow-first design.

**Changes:**
- Remove hard border. Use `box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)` instead
- `border-radius: 12px`, `padding: 1.5rem`
- Hover: `transform: translateY(-2px)`, shadow increases to `0 8px 25px rgba(0,0,0,0.08)`
- Avatar circle: 48px, slightly larger, `font-size: 1rem`
- Name: `font-size: 1.05rem`, `font-weight: 600`
- Detail lines (email, phone, company): `font-size: 0.825rem`, `color: var(--gray-dark)`, small icons inline (phone icon, mail icon, building icon) for visual recognition
- Card min-width bumped to 300px for more breathing room

## Detail Page (View/Edit Contact or Deal)

Replaces the slide-in panel entirely. Clicking a contact or deal navigates to a full detail page.

**Layout:**
- Back button in the app header area: `< Back to Contacts` or `< Back to Pipeline` — clicking returns to the list view
- Header section at top of detail page: large avatar (64px) + name (display font, 1.75rem) + job title/company underneath + quick action buttons (edit, delete) aligned right
- Two-column layout below the header (desktop):
  - **Left column (60%):** Field grid with all editable fields
  - **Right column (40%):** Activity timeline
- Single column on mobile: fields first, activity below

**Field Grid:**
- Fields displayed in a clean 2-column sub-grid (label on left, value on right) or stacked label-above-value
- Each field: `padding: 1rem 0`, separated by subtle `1px solid #F1F5F9` dividers
- Values are inline-editable: click to edit, same interaction as before (input replaces text, Enter to save, Escape to cancel)
- Editable values show a subtle pencil icon on hover to indicate editability
- Flash feedback on save (green) and error (red) — same as before but smoother
- Company field: clickable link styled in accent color, opens company detail page
- For deals: stage shown as a styled dropdown/pill selector at the top of the field grid

**Activity Timeline:**
- Clean vertical timeline with a thin line connecting entries
- Each entry: type icon (circle, 36px) on the left of the line, content card on the right
- Content card: white bg, subtle shadow, `border-radius: 8px`, `padding: 1rem`
- Type icons use semantic colors: call=green, email=blue, meeting=amber, note=accent, edit=gray
- Timestamp and author on a single line below the description, muted
- Edit entries show the diff inline: `old → new` in mono font

**Add Activity Composer:**
- Always visible at the top of the timeline (not hidden behind a button)
- Compact form: type selector as a row of pill buttons (Call, Email, Meeting, Note), textarea below, Send button
- Textarea placeholder: "Log an activity..."
- Collapses to a single-line clickable prompt when not focused: "Log a call, email, meeting, or note..."
- Expands smoothly on focus

**Deal-specific detail page extras:**
- Stage selector at the top: row of pill/chip buttons for each stage, active stage highlighted. Click to change stage (with confirmation toast).
- Value displayed prominently below the deal name in accent color, display font

## Top Bar

Polish the view top bar.

**Changes:**
- Height increase: `padding: 0.875rem 0` (more vertical space)
- Search input: 44px tall, `border-radius: 10px`, larger font `0.9rem`, clean magnifying glass icon inside, placeholder text lighter
- View toggle: pill-shaped segmented control. Active segment has `var(--accent)` background with white text, inactive segments are transparent with `var(--gray-dark)` text. Smooth sliding background indicator on switch.
- Add button: 44px tall, `border-radius: 10px`, slightly larger text, prominent icon + label

## Empty States

Warmer, more inviting empty states.

**Changes:**
- Icon size: 80px (from 64px), use a softer stroke weight
- Title: display font, `1.5rem`
- Description: `1rem`, `line-height: 1.7`, max-width 400px, warmer copy
- CTA button: same prominent styling as the top bar add button
- Add a subtle decorative element — a soft gradient circle behind the icon

## Kanban Board

Polish the pipeline kanban.

**Changes:**
- Column cards: remove hard border, use shadow like contact cards
- Column header: larger padding, bolder stage name
- Deal cards inside columns: same shadow treatment as contact cards, `border-radius: 10px`
- Deal value: accent color, display font, prominent
- Drag states: card lifts with stronger shadow while dragging, drop zone shows a dashed border + light accent background
- Column body: subtle `border-radius` on the inner area

## Pipeline Settings Modal

Same centered modal pattern as create forms.

- Stages listed with drag handles, inline-editable names, delete buttons
- Clean styling matching the new modal design system
- Closed stages (Won/Lost) visually distinct with a lock icon and muted color

## File Changes

**Modify:**
- `crm/css/app.css` — major CSS additions/overrides for all new styles
- `crm/js/views/contacts.js` — replace slide-in panel with modal (create) and detail page (view/edit)
- `crm/js/views/pipeline.js` — same: modal for create, detail page for view/edit
- `crm/js/components/detail-panel.js` — repurpose or replace with modal component
- `crm/app.html` — add detail page view containers for contact-detail and deal-detail

**Create:**
- `crm/js/components/modal.js` — new centered modal component (replaces detail-panel for create flows)

## Out of Scope

- Sidebar or header redesign
- New features or data model changes
- Mobile-first redesign (responsive adjustments only)
