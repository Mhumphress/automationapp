// ─────────────────────────────────────────────────────────────────
//  calendar.js — Reusable day/week calendar for appointment-style data.
//
//  Usage:
//    mountCalendar(containerEl, {
//      collection: 'appointments',
//      tenantId: 't_abc',
//      titleField: 'title',
//      startField: 'startAt',
//      endField:   'endAt',
//      colorField: 'status',          // optional; maps to CSS colors
//      onOpenEvent: (evt) => {...},   // clicking an existing event
//      onCreateAt:  (date) => {...},  // clicking an empty slot
//      startHour: 8, endHour: 20,     // default 8am–8pm
//      initialView: 'week' | 'day',
//    });
//
//  Subscribes via onSnapshot to tenants/{tenantId}/{collection}; re-renders
//  on every change. Call the returned destroy() to unsubscribe.
// ─────────────────────────────────────────────────────────────────

import { db } from '../config.js';
import {
  collection, query, where, orderBy, onSnapshot, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const DAY_MS = 86400000;
const HOUR_MS = 3600000;

export function mountCalendar(containerEl, opts) {
  const cfg = {
    startHour: 8,
    endHour: 20,
    initialView: 'week',
    ...opts,
  };

  let view = cfg.initialView;
  let anchor = startOfWeek(new Date());
  let events = [];
  let unsub = null;

  render();

  function render() {
    containerEl.innerHTML = '';
    containerEl.appendChild(renderToolbar());
    containerEl.appendChild(renderGrid());
    subscribe();
  }

  function renderToolbar() {
    const bar = document.createElement('div');
    bar.className = 'cal-toolbar';
    bar.innerHTML = `
      <div class="cal-nav">
        <button class="btn btn-ghost btn-sm" data-nav="prev">&larr;</button>
        <button class="btn btn-ghost btn-sm" data-nav="today">Today</button>
        <button class="btn btn-ghost btn-sm" data-nav="next">&rarr;</button>
        <span class="cal-range">${escapeHtml(formatRange())}</span>
      </div>
      <div class="cal-views">
        <button class="btn btn-ghost btn-sm ${view === 'day' ? 'active' : ''}" data-view="day">Day</button>
        <button class="btn btn-ghost btn-sm ${view === 'week' ? 'active' : ''}" data-view="week">Week</button>
      </div>
    `;
    bar.querySelector('[data-nav="prev"]').addEventListener('click', () => { shift(-1); });
    bar.querySelector('[data-nav="next"]').addEventListener('click', () => { shift(1); });
    bar.querySelector('[data-nav="today"]').addEventListener('click', () => {
      anchor = view === 'day' ? startOfDay(new Date()) : startOfWeek(new Date());
      render();
    });
    bar.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
      view = b.dataset.view;
      anchor = view === 'day' ? startOfDay(anchor) : startOfWeek(anchor);
      render();
    }));
    return bar;
  }

  function shift(dir) {
    if (view === 'day') anchor = new Date(anchor.getTime() + dir * DAY_MS);
    else anchor = new Date(anchor.getTime() + dir * 7 * DAY_MS);
    render();
  }

  function renderGrid() {
    const days = view === 'day' ? 1 : 7;
    const hours = cfg.endHour - cfg.startHour;
    const grid = document.createElement('div');
    grid.className = `cal-grid cal-grid-${view}`;
    grid.style.setProperty('--cal-days', days);
    grid.style.setProperty('--cal-hours', hours);

    // Header row: day labels
    grid.appendChild(cell('cal-corner', ''));
    for (let d = 0; d < days; d++) {
      const day = new Date(anchor.getTime() + d * DAY_MS);
      const dayEl = cell('cal-day-header', `
        <div class="cal-day-name">${day.toLocaleDateString('en-US', { weekday: 'short' })}</div>
        <div class="cal-day-num ${isSameDay(day, new Date()) ? 'today' : ''}">${day.getDate()}</div>
      `);
      grid.appendChild(dayEl);
    }

    // Hour rows
    for (let h = 0; h < hours; h++) {
      const hour = cfg.startHour + h;
      const label = formatHour(hour);
      grid.appendChild(cell('cal-hour-label', label));
      for (let d = 0; d < days; d++) {
        const slot = document.createElement('div');
        slot.className = 'cal-slot';
        slot.dataset.day = d;
        slot.dataset.hour = hour;
        slot.addEventListener('click', (e) => {
          if (e.target.closest('.cal-event')) return;
          const slotDate = new Date(anchor.getTime() + d * DAY_MS);
          slotDate.setHours(hour, 0, 0, 0);
          cfg.onCreateAt && cfg.onCreateAt(slotDate);
        });
        grid.appendChild(slot);
      }
    }

    renderEvents(grid);
    return grid;
  }

  function renderEvents(grid) {
    const days = view === 'day' ? 1 : 7;
    const startMs = anchor.getTime();
    const endMs = startMs + days * DAY_MS;

    events.forEach(evt => {
      const startDate = toDate(evt[cfg.startField || 'startAt']);
      const endDate   = toDate(evt[cfg.endField   || 'endAt']) || (startDate && new Date(startDate.getTime() + HOUR_MS));
      if (!startDate) return;
      const evtStartMs = startDate.getTime();
      const evtEndMs   = endDate.getTime();
      if (evtEndMs <= startMs || evtStartMs >= endMs) return;  // outside range

      // Pin within visible range
      const s = Math.max(evtStartMs, startMs);
      const e = Math.min(evtEndMs, endMs);

      const dayIdx = Math.floor((s - startMs) / DAY_MS);
      const dayStart = startMs + dayIdx * DAY_MS;

      const minutesFromStartOfDay = (s - dayStart) / 60000;
      const visibleMinutes = (e - s) / 60000;

      const minutesFromCalStart = Math.max(0, minutesFromStartOfDay - cfg.startHour * 60);
      const minutesClamped = Math.min(visibleMinutes, (cfg.endHour - cfg.startHour) * 60 - minutesFromCalStart);
      if (minutesClamped <= 0) return;

      const topPct = (minutesFromCalStart / ((cfg.endHour - cfg.startHour) * 60)) * 100;
      const heightPct = (minutesClamped / ((cfg.endHour - cfg.startHour) * 60)) * 100;

      const color = colorFor(evt[cfg.colorField || 'status']);

      // Find the column — position absolutely inside the events overlay per day
      const slotCell = grid.querySelector(`.cal-slot[data-day="${dayIdx}"][data-hour="${cfg.startHour}"]`);
      if (!slotCell) return;
      // Create or reuse an overlay per day
      let overlay = grid.querySelector(`.cal-events-overlay[data-day="${dayIdx}"]`);
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'cal-events-overlay';
        overlay.dataset.day = dayIdx;
        // Position overlay over the full column from first slot
        slotCell.appendChild(overlay);
      }

      const box = document.createElement('div');
      box.className = 'cal-event';
      box.style.top = `${topPct}%`;
      box.style.height = `${Math.max(3, heightPct)}%`;
      box.style.background = color.bg;
      box.style.color = color.fg;
      box.style.borderLeft = `3px solid ${color.accent}`;
      box.innerHTML = `
        <div class="cal-event-time">${formatTimeShort(startDate)}</div>
        <div class="cal-event-title">${escapeHtml(evt[cfg.titleField || 'title'] || '(no title)')}</div>
      `;
      box.addEventListener('click', (e) => {
        e.stopPropagation();
        cfg.onOpenEvent && cfg.onOpenEvent(evt);
      });
      overlay.appendChild(box);
    });
  }

  function subscribe() {
    if (unsub) { try { unsub(); } catch {} unsub = null; }
    const days = view === 'day' ? 1 : 7;
    const start = Timestamp.fromDate(anchor);
    const end = Timestamp.fromDate(new Date(anchor.getTime() + days * DAY_MS));
    const startField = cfg.startField || 'startAt';

    const path = `tenants/${cfg.tenantId}/${cfg.collection}`;
    try {
      let clauses = [];
      if (cfg.filters) cfg.filters.forEach(f => clauses.push(where(f.field, f.op, f.value)));
      clauses.push(where(startField, '>=', start));
      clauses.push(where(startField, '<', end));
      clauses.push(orderBy(startField, 'asc'));
      const q = query(collection(db, path), ...clauses);
      unsub = onSnapshot(q, (snap) => {
        events = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        // Re-render grid contents without destroying the toolbar
        const oldGrid = containerEl.querySelector('.cal-grid');
        if (oldGrid) oldGrid.replaceWith(renderGrid());
      }, (err) => {
        console.warn('Calendar subscription error:', err);
      });
    } catch (err) {
      console.warn('Calendar query failed (index may be missing):', err);
    }
  }

  function destroy() { if (unsub) { try { unsub(); } catch {} unsub = null; } }

  function formatRange() {
    if (view === 'day') return anchor.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
    const end = new Date(anchor.getTime() + 6 * DAY_MS);
    return `${anchor.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }

  return { destroy, refresh: render };
}

// ── Helpers ───────────────────────────────────────────────

function cell(className, html) {
  const el = document.createElement('div');
  el.className = className;
  el.innerHTML = html;
  return el;
}

function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function startOfWeek(d) {
  const x = startOfDay(d);
  const day = x.getDay();  // 0=Sun
  x.setDate(x.getDate() - day);
  return x;
}
function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function toDate(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  if (ts instanceof Date) return ts;
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}
function formatHour(h) {
  const period = h >= 12 ? 'pm' : 'am';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${period}`;
}
function formatTimeShort(d) {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function escapeHtml(s) {
  if (!s) return '';
  const n = document.createElement('span');
  n.appendChild(document.createTextNode(String(s)));
  return n.innerHTML;
}

const STATUS_COLORS = {
  scheduled: { bg: 'rgba(79,123,247,0.12)',  fg: '#1e40af', accent: '#4F7BF7' },
  confirmed: { bg: 'rgba(5,150,105,0.12)',   fg: '#065f46', accent: '#059669' },
  completed: { bg: 'rgba(100,116,139,0.15)', fg: '#334155', accent: '#64748B' },
  canceled:  { bg: 'rgba(220,38,38,0.1)',    fg: '#991b1b', accent: '#dc2626' },
  cancelled: { bg: 'rgba(220,38,38,0.1)',    fg: '#991b1b', accent: '#dc2626' },
  no_show:   { bg: 'rgba(217,119,6,0.12)',   fg: '#92400e', accent: '#d97706' },
  default:   { bg: 'rgba(79,123,247,0.12)',  fg: '#1e40af', accent: '#4F7BF7' },
};

function colorFor(status) {
  if (!status) return STATUS_COLORS.default;
  return STATUS_COLORS[status] || STATUS_COLORS.default;
}
