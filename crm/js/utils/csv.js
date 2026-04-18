// ─────────────────────────────────────────────────────────────────
//  csv.js — RFC-4180 CSV download helper.
// ─────────────────────────────────────────────────────────────────

function escapeField(v) {
  if (v == null) return '';
  const s = typeof v === 'string' ? v : String(v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCell(row, col) {
  const raw = typeof col.get === 'function' ? col.get(row) : row[col.key];
  if (typeof col.format === 'function') return col.format(raw, row);
  return raw == null ? '' : raw;
}

/**
 * Build and trigger a CSV download.
 *
 * @param {string} filename   e.g. "invoices-john-smith-2026-04-18.csv"
 * @param {Array<object>} rows
 * @param {Array<{ key: string, label: string, get?: function, format?: function }>} columns
 */
export function downloadCSV(filename, rows, columns) {
  const header = columns.map(c => escapeField(c.label)).join(',');
  const body = (rows || []).map(r =>
    columns.map(c => escapeField(toCell(r, c))).join(',')
  ).join('\r\n');

  const csv = header + '\r\n' + body;
  // BOM so Excel opens UTF-8 correctly
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
}

/** Convenience helpers for common shapes. */

export function formatTimestamp(ts) {
  if (!ts) return '';
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    if (isNaN(d.getTime())) return '';
    return d.toISOString();
  } catch { return ''; }
}

export function formatMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  return v.toFixed(2);
}
