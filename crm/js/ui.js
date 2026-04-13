// ─────────────────────────────────────────────
//  ui.js — Shared UI utilities
// ─────────────────────────────────────────────

/**
 * Show a toast notification.
 * @param {string} message
 * @param {'info'|'success'|'error'} type
 */
export function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  // Trigger entrance animation on next frame
  requestAnimationFrame(() => {
    toast.classList.add('toast-visible');
  });

  // Auto-remove after 3s
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    // Fallback removal if transitionend doesn't fire
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 400);
  }, 3000);
}

/**
 * Format a Firestore timestamp or Date into "Mon DD, YYYY".
 * @param {*} timestamp
 * @returns {string}
 */
export function formatDate(timestamp) {
  if (!timestamp) return '\u2014';

  try {
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    if (isNaN(date.getTime())) return '\u2014';

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  } catch {
    return '\u2014';
  }
}

/**
 * Format a number as US currency.
 * @param {number|null} amount
 * @returns {string}
 */
export function formatCurrency(amount) {
  if (amount == null || isNaN(amount)) return '$0.00';

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(amount);
}

/**
 * Return a relative time string ("just now", "Xm ago", "Xh ago", "Xd ago").
 * Falls back to formatDate for older timestamps.
 * @param {*} timestamp
 * @returns {string}
 */
export function timeAgo(timestamp) {
  if (!timestamp) return '\u2014';

  try {
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    if (isNaN(date.getTime())) return '\u2014';

    const now = Date.now();
    const diffMs = now - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);

    if (diffSec < 60) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay < 30) return `${diffDay}d ago`;

    return formatDate(timestamp);
  } catch {
    return '\u2014';
  }
}

/**
 * Safely escape HTML by creating a text node.
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  if (!str) return '';
  const node = document.createElement('span');
  node.appendChild(document.createTextNode(str));
  return node.innerHTML;
}
