# Interactive Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the static dashboard into an interactive hub with clickable stat cards that expand to show drill-down lists, plus a revenue bar chart and deal activity line chart powered by Chart.js with click-to-drill functionality.

**Architecture:** All dashboard logic lives in the `app.html` inline script block (dashboard `registerView` override). Chart.js loaded via CDN in the `<head>`. Dashboard HTML restructured to include chart containers. New CSS for interactive cards, chart cards, and drill-down lists appended to `app.css`.

**Tech Stack:** Chart.js (CDN), Firebase Firestore (existing), vanilla JS.

---

## Task 1: Add Dashboard CSS + Chart.js CDN

**Files:**
- Modify: `crm/app.html` — add Chart.js CDN script tag in `<head>`
- Modify: `crm/css/app.css` — add dashboard-specific styles

- [ ] **Step 1: Add Chart.js CDN to `crm/app.html` `<head>`**

Add this line before the closing `</head>` tag:
```html
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
```

- [ ] **Step 2: Add dashboard CSS to `crm/css/app.css`**

Read `crm/css/app.css`. Insert these styles before the `@media (max-width: 768px)` block:

```css
/* ═══════════════════════════════════════════════
   INTERACTIVE DASHBOARD
   ═══════════════════════════════════════════════ */

.stat-card {
  cursor: pointer;
  transition: box-shadow var(--duration) var(--ease), border-color var(--duration) var(--ease), transform var(--duration) var(--ease);
  position: relative;
}

.stat-card:hover {
  border-color: var(--accent);
  box-shadow: 0 4px 16px rgba(79,123,247,0.12);
  transform: translateY(-1px);
}

.stat-card.expanded {
  border-color: var(--accent);
  box-shadow: 0 4px 16px rgba(79,123,247,0.12);
}

.stat-drilldown {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.25s var(--ease), padding 0.25s var(--ease);
  border-top: 0px solid #E2E8F0;
  margin-top: 0;
}

.stat-card.expanded .stat-drilldown {
  max-height: 400px;
  border-top: 1px solid #E2E8F0;
  margin-top: 1rem;
  padding-top: 0.75rem;
}

.drilldown-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 0;
  border-bottom: 1px solid #F1F5F9;
  cursor: pointer;
  font-size: 0.85rem;
  transition: color var(--duration) var(--ease);
}

.drilldown-item:last-child {
  border-bottom: none;
}

.drilldown-item:hover {
  color: var(--accent);
}

.drilldown-item-name {
  font-weight: 500;
  color: var(--off-black);
}

.drilldown-item-sub {
  font-size: 0.75rem;
  color: var(--gray);
}

.drilldown-item-value {
  font-weight: 600;
  color: var(--accent);
  font-family: var(--font-display);
  font-size: 0.95rem;
}

.drilldown-placeholder {
  text-align: center;
  color: var(--gray);
  font-size: 0.85rem;
  padding: 1rem 0;
}

/* --- Chart Section --- */

.charts-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
  margin-top: 2rem;
}

.chart-card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  padding: 1.5rem;
}

.chart-card-title {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--gray-dark);
  margin-bottom: 1rem;
}

.chart-canvas-wrap {
  position: relative;
  height: 240px;
}

.chart-canvas-wrap canvas {
  width: 100% !important;
  height: 100% !important;
}

.chart-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 240px;
  color: var(--gray);
  font-size: 0.9rem;
  text-align: center;
}

.chart-drilldown {
  border-top: 1px solid #E2E8F0;
  margin-top: 1rem;
  padding-top: 0.75rem;
}

.chart-drilldown-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--gray-dark);
  margin-bottom: 0.5rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
```

Add inside the existing `@media (max-width: 768px)` block:
```css
  .charts-grid {
    grid-template-columns: 1fr;
  }
```

- [ ] **Step 3: Commit**

```bash
git add crm/app.html crm/css/app.css
git commit -m "feat(crm): add Chart.js CDN and dashboard interactive styles"
```

---

## Task 2: Rebuild Dashboard HTML + Interactive Logic

**Files:**
- Modify: `crm/app.html` — replace dashboard view HTML and rewrite the dashboard `registerView` override

This is the main task. The dashboard HTML gets restructured with drill-down containers inside each stat card and chart containers below. The `registerView('dashboard', ...)` override gets a complete rewrite with all the interactive logic.

- [ ] **Step 1: Replace dashboard HTML in `crm/app.html`**

Find the entire `<!-- Dashboard -->` view container (from `<div id="view-dashboard"` through its closing `</div>`) and replace with:

```html
      <!-- Dashboard -->
      <div id="view-dashboard" class="view-container">
        <div class="stats-grid" id="statsGrid">
          <div class="stat-card" data-stat="contacts">
            <div class="stat-label">Total Contacts</div>
            <div class="stat-value" id="statContacts">0</div>
            <div class="stat-change neutral">--</div>
            <div class="stat-drilldown" id="drillContacts"></div>
          </div>
          <div class="stat-card" data-stat="deals">
            <div class="stat-label">Active Deals</div>
            <div class="stat-value" id="statProjects">0</div>
            <div class="stat-change neutral">--</div>
            <div class="stat-drilldown" id="drillDeals"></div>
          </div>
          <div class="stat-card" data-stat="tasks">
            <div class="stat-label">Open Tasks</div>
            <div class="stat-value" id="statTasks">0</div>
            <div class="stat-change neutral">--</div>
            <div class="stat-drilldown" id="drillTasks"></div>
          </div>
          <div class="stat-card" data-stat="revenue">
            <div class="stat-label">Revenue</div>
            <div class="stat-value" id="statRevenue">$0</div>
            <div class="stat-change neutral">--</div>
            <div class="stat-drilldown" id="drillRevenue"></div>
          </div>
        </div>

        <div class="charts-grid" id="chartsGrid">
          <div class="chart-card">
            <div class="chart-card-title">Revenue by Month</div>
            <div class="chart-canvas-wrap" id="revenueChartWrap">
              <canvas id="revenueChart"></canvas>
            </div>
            <div id="revenueChartDrill"></div>
          </div>
          <div class="chart-card">
            <div class="chart-card-title">Deal Activity</div>
            <div class="chart-canvas-wrap" id="activityChartWrap">
              <canvas id="activityChart"></canvas>
            </div>
            <div id="activityChartDrill"></div>
          </div>
        </div>

        <div class="empty-state" id="dashboardEmpty" style="display:none;">
          <svg class="empty-icon" xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>
          </svg>
          <div class="empty-title">Welcome to your CRM</div>
          <p class="empty-description">Your dashboard will come alive as you add contacts and deals. Start by adding your first contact below.</p>
          <button class="btn btn-primary btn-lg" onclick="window.location.hash='contacts'" style="margin-top:0.5rem;">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add First Contact
          </button>
        </div>
      </div>
```

- [ ] **Step 2: Rewrite the dashboard `registerView` override**

Replace the entire `// Override dashboard with live stats` block (from `registerView('dashboard', {` through its closing `});`) with the complete new implementation. The new code must:

**A. Load data and populate stats:**
- Fetch contacts and deals via `queryDocuments`
- Set stat values (Total Contacts count, Active Deals count, Tasks placeholder "0", Revenue sum of won deals)
- If both contacts and deals are empty, show the empty state and hide stats+charts

**B. Populate drill-down lists:**
- `drillContacts`: 5 most recent contacts — each row shows name (left) and company (right). Click navigates to `#contacts`.
- `drillDeals`: 5 most recent active deals — each row shows deal name (left), stage badge + value (right). Click navigates to `#pipeline`.
- `drillTasks`: placeholder message "Task management coming in Phase 3."
- `drillRevenue`: 5 most recent won deals — each row shows deal name (left) and value (right). Click navigates to `#pipeline`.

**C. Wire stat card click toggling:**
- Click a stat card toggles `.expanded` class.
- If another card is already expanded, collapse it first (accordion behavior).

**D. Build Revenue Bar Chart (Chart.js):**
- Group won deals by month (last 6 months).
- If no won deals, show `.chart-empty` message instead of canvas.
- Create `new Chart(ctx, { type: 'bar', ... })` with:
  - Labels: month names (e.g., "Nov", "Dec", "Jan", "Feb", "Mar", "Apr")
  - Data: sum of deal values per month
  - Colors: `var(--accent)` → use `#4F7BF7` since Chart.js needs hex/rgb
  - Options: `borderRadius: 6`, responsive, maintainAspectRatio false, clean grid, currency tooltip
  - `onClick` handler: when a bar is clicked, show a drill-down list below the chart of the won deals from that month. Each row: deal name + value. Click navigates to `#pipeline`.

**E. Build Deal Activity Line Chart (Chart.js):**
- Group all deals by creation month (last 6 months).
- If no deals, show `.chart-empty` message instead of canvas.
- Create `new Chart(ctx, { type: 'line', ... })` with:
  - Labels: month names (same 6 months)
  - Data: count of deals created per month
  - Line color: `#4F7BF7`, point markers, gradient fill under line (`rgba(79,123,247,0.1)` to transparent)
  - Options: responsive, maintainAspectRatio false, clean grid, integer tooltip
  - `onClick` handler: when a point is clicked, show drill-down list of deals created that month. Each row: deal name + value + stage badge. Click navigates to `#pipeline`.

**F. Destroy old charts on re-render:**
- Store chart instances and call `.destroy()` before creating new ones to prevent Chart.js memory leaks.

**Helper functions needed (define inside the registerView or before it):**
- `groupByMonth(items, dateField)` — groups items by month/year from a Firestore timestamp, returns a Map
- `getLast6Months()` — returns array of `{ key: 'YYYY-MM', label: 'Mon' }` for the last 6 months
- `renderDrilldownItems(container, items)` — renders a list of `.drilldown-item` rows

The complete dashboard registration is approximately 200-250 lines of JS.

- [ ] **Step 3: Verify in browser**

Navigate to Dashboard:
- If no data: empty state shows with "Add First Contact" button
- If data exists: stat cards show counts, charts render
- Click a stat card: expands to show drill-down list, click again collapses
- Click another card while one is open: first collapses, second expands
- Revenue chart: bars show monthly revenue, hover shows tooltip, click a bar shows deal list below
- Activity chart: line shows monthly deal creation, hover shows tooltip, click a point shows deal list below
- Click a drill-down item: navigates to contacts or pipeline view
- Mobile: charts stack vertically

- [ ] **Step 4: Commit**

```bash
git add crm/app.html
git commit -m "feat(crm): add interactive dashboard with drill-down cards and Chart.js analytics"
```

---

## Summary

| Task | What it delivers |
|------|-----------------|
| 1 | Chart.js CDN + all dashboard CSS (card expansion, chart containers, drill-downs, responsive) |
| 2 | Complete dashboard rebuild: interactive stat cards, revenue bar chart, deal activity line chart, click-to-drill everywhere |
