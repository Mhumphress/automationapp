# Interactive Dashboard — Design Spec

## Overview

Transform the static dashboard into an interactive command center. Stat cards expand on click to show drill-down lists. Two charts (revenue bar + deal activity line) display live Firestore data and are clickable to drill into source records. Chart.js via CDN.

## Stat Cards — Clickable Drill-Down

Each of the 4 stat cards becomes clickable. On click, the card expands to reveal a list of up to 5 recent items.

### Card Behaviors

- **Total Contacts** — expands to show 5 most recent contacts (name + company). Click a row navigates to that contact's detail page in the contacts view.
- **Active Deals** — expands to show 5 most recent active deals, where active means stage is not "won" or "lost" (deal name + value + stage badge). Click a row navigates to that deal's detail page in the pipeline view.
- **Open Tasks** — expands to show "Task management coming in Phase 3" placeholder.
- **Revenue** — expands to show 5 most recent won deals (deal name + value + close date). Click a row navigates to that deal's detail page.

### Card UX

- Cards show `cursor: pointer` and a subtle hover state (border color shift or shadow increase) to indicate clickability.
- Clicking an expanded card collapses it.
- Only one card can be expanded at a time — expanding one collapses any other.
- Expansion animates smoothly (slide down, ~200ms ease).
- Drill-down list rows have hover highlight and cursor pointer.

## Charts Section

Two charts in a side-by-side grid below the stat cards. Both use Chart.js loaded via CDN (`https://cdn.jsdelivr.net/npm/chart.js`).

### Left: Revenue Bar Chart

- **Data:** Monthly sum of won deal values, last 6 months.
- **Type:** Chart.js bar chart.
- **Styling:** Bars use `var(--accent)` color. Clean grid lines, no outer border. Rounded bar corners.
- **Tooltips:** Hover a bar shows formatted dollar amount.
- **Click interaction:** Click a bar shows an inline drill-down list below the chart of the won deals from that month (up to 10 items). Each row: deal name + value + close date. Click a row navigates to that deal's detail page.
- **Empty state:** If no won deals exist, show a message: "Revenue data will appear as you close deals." inside the chart card.

### Right: Deal Activity Line Chart

- **Data:** Count of new deals created per month, last 6 months.
- **Type:** Chart.js line chart with gradient fill under the line.
- **Styling:** Line in `var(--accent)` color. Point markers on each data point. Gradient fill fading from `var(--accent-dim)` to transparent.
- **Tooltips:** Hover a point shows deal count for that month.
- **Click interaction:** Click a point shows an inline drill-down list below the chart of deals created that month (up to 10 items). Each row: deal name + value + stage badge. Click a row navigates to that deal's detail page.
- **Empty state:** If no deals exist, show a message: "Deal activity will appear as you add deals." inside the chart card.

### Chart Container Styling

- Each chart sits in a white card: `border-radius: 12px`, soft shadow (`0 1px 3px rgba(0,0,0,0.06)`), `padding: 1.5rem`.
- Chart title uses `.detail-section-title` style (small uppercase label).
- Two-column grid on desktop (`1fr 1fr`, `gap: 1.5rem`). Stacks to single column on mobile.
- Drill-down list appears below the chart canvas inside the same card, with a subtle top border separator.

## Data Flow

All data comes from existing Firestore queries — no new collections or documents needed.

- `queryDocuments('contacts')` — for contact count + drill-down list
- `queryDocuments('deals')` — for all deal data. Filter client-side for:
  - Active deals: `stage !== 'won' && stage !== 'lost'`
  - Won deals: `stage === 'won'`
  - Monthly grouping: by `createdAt` timestamp for activity chart, by `updatedAt` or `createdAt` for revenue chart (use the deal's timestamp)

Monthly grouping is done client-side by extracting month/year from Firestore timestamps and aggregating.

## Navigation from Dashboard to Detail Pages

When a user clicks a contact or deal row in a drill-down list:
- For contacts: set `window.location.hash = 'contacts'`, then after navigation, trigger the contact detail page. Simplest approach: navigate to contacts view and let the user find the contact there. Or store a "pending detail" ID and have the contacts view check for it on render.
- For deals: same pattern with pipeline view.

Simpler approach (recommended): clicking a drill-down row navigates to the contacts/pipeline view. The drill-down gives enough context (name, company) that the user can quickly find and click the record. This avoids cross-view state management complexity.

## Files Changed

- **Modify:** `crm/app.html` — add Chart.js CDN `<script>` tag in `<head>`, replace dashboard HTML with new interactive structure, rewrite dashboard `registerView` override with full drill-down and chart logic
- **Modify:** `crm/css/app.css` — add dashboard styles: clickable stat cards, expansion animation, drill-down lists, chart containers, responsive chart grid

## Out of Scope

- Real-time updates (data refreshes on page load / view switch)
- Date range picker for charts
- Export / download chart data
- Custom chart colors or themes
- Tasks stat (Phase 3 placeholder)
