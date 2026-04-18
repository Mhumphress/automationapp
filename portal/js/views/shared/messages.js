// ─────────────────────────────────────────────────────────────────
//  messages.js (portal view) — Tenant-side inbox.
//  Same pattern as CRM, scoped to the tenant's own threads.
// ─────────────────────────────────────────────────────────────────

import {
  subscribeToThreads, subscribeToMessages, sendMessage,
  createThread, markThreadAsRead,
} from '../../services/messages.js';
import { getTenant } from '../../tenant-context.js';

let threads = [];
let selectedThreadId = null;
let threadsUnsub = null;
let messagesUnsub = null;
let searchTerm = '';

export function init() {}

export function destroy() {
  if (threadsUnsub) { try { threadsUnsub(); } catch {} threadsUnsub = null; }
  if (messagesUnsub) { try { messagesUnsub(); } catch {} messagesUnsub = null; }
}

export async function render() {
  const container = document.getElementById('view-messages');
  const tenant = getTenant();
  if (!tenant) {
    container.innerHTML = '<div class="empty-state"><div class="empty-title">No tenant</div></div>';
    return;
  }

  container.innerHTML = `
    <div class="messages-layout">
      <aside class="messages-list-pane">
        <div class="messages-list-top">
          <button class="btn btn-primary btn-sm" id="newThreadBtn">+ New Message</button>
          <input type="search" class="search-input messages-search" placeholder="Search..." />
        </div>
        <div class="messages-thread-list" id="threadList">
          <div class="loading">Loading...</div>
        </div>
      </aside>
      <section class="messages-conversation-pane" id="conversationPane">
        <div class="empty-state" style="margin:auto;">
          <div class="empty-title">No conversation selected</div>
          <p class="empty-description">Pick a thread or start a new one.</p>
        </div>
      </section>
    </div>
  `;

  destroy();
  threadsUnsub = subscribeToThreads(
    { tenantId: tenant.id },
    (list) => {
      threads = list;
      renderThreadList();
      if (selectedThreadId && !threads.find(t => t.id === selectedThreadId)) {
        selectedThreadId = null;
        renderConversation();
      }
    },
    (err) => {
      const wrap = document.getElementById('threadList');
      if (wrap) {
        wrap.innerHTML = `
          <div style="padding:1rem;color:var(--danger,#dc2626);font-size:0.85rem;line-height:1.5;">
            <div style="font-weight:600;margin-bottom:0.3rem;">Can't load messages</div>
            <div style="color:var(--gray-dark,#64748B);font-size:0.78rem;">${escapeHtml(err.code || err.message || 'Unknown error')}</div>
            ${err.code === 'permission-denied'
              ? '<div style="margin-top:0.4rem;">Firestore rules may not be published yet. Ask your administrator.</div>'
              : ''}
          </div>
        `;
      }
    }
  );

  container.querySelector('.messages-search').addEventListener('input', (e) => {
    searchTerm = e.target.value.trim().toLowerCase();
    renderThreadList();
  });
  container.querySelector('#newThreadBtn').addEventListener('click', () => openNewThreadModal());
}

function renderThreadList() {
  const wrap = document.getElementById('threadList');
  if (!wrap) return;
  let list = threads.filter(t => !t.archived);
  if (searchTerm) {
    list = list.filter(t =>
      (t.subject || '').toLowerCase().includes(searchTerm) ||
      (t.lastMessageSnippet || '').toLowerCase().includes(searchTerm));
  }

  if (!list.length) {
    wrap.innerHTML = `<div style="padding:2rem 1rem;text-align:center;color:var(--gray);font-size:0.85rem;">
      ${searchTerm ? 'No matches.' : 'No conversations yet. Start one with the button above.'}
    </div>`;
    return;
  }

  wrap.innerHTML = list.map(t => {
    const unread = t.unreadByTenant;
    return `
      <div class="thread-row ${t.id === selectedThreadId ? 'selected' : ''} ${unread ? 'unread' : ''}" data-id="${escapeHtml(t.id)}">
        <div class="thread-row-top">
          <span class="thread-row-subject">${escapeHtml(t.subject || '(no subject)')}</span>
          <span class="thread-row-time">${escapeHtml(t.lastMessageAt ? timeAgo(t.lastMessageAt) : '')}</span>
        </div>
        <div class="thread-row-snippet">
          ${t.lastMessageBy === 'tenant' ? '<span class="thread-row-mine">You:</span> ' : ''}
          ${escapeHtml((t.lastMessageSnippet || '').slice(0, 90))}
        </div>
      </div>
    `;
  }).join('');
  wrap.querySelectorAll('.thread-row').forEach(row => {
    row.addEventListener('click', () => selectThread(row.dataset.id));
  });
}

function selectThread(threadId) {
  selectedThreadId = threadId;
  renderThreadList();
  renderConversation();
  markThreadAsRead(threadId, 'tenant').catch(() => {});
}

function renderConversation() {
  const pane = document.getElementById('conversationPane');
  if (messagesUnsub) { try { messagesUnsub(); } catch {} messagesUnsub = null; }

  if (!selectedThreadId) {
    pane.innerHTML = `
      <div class="empty-state" style="margin:auto;">
        <div class="empty-title">No conversation selected</div>
        <p class="empty-description">Pick a thread or start a new one.</p>
      </div>
    `;
    return;
  }

  const thread = threads.find(t => t.id === selectedThreadId);
  if (!thread) return;

  pane.innerHTML = `
    <header class="conversation-header">
      <div>
        <div class="conversation-subject">${escapeHtml(thread.subject || '(no subject)')}</div>
        <div class="conversation-sub">Started ${escapeHtml(thread.createdAt ? formatDate(thread.createdAt) : '')}</div>
      </div>
    </header>
    <div class="conversation-messages" id="conversationMessages">
      <div class="loading">Loading messages...</div>
    </div>
    <form class="conversation-composer" id="composerForm">
      <textarea name="text" placeholder="Type your message..." rows="2" required></textarea>
      <button type="submit" class="btn btn-primary btn-sm">Send</button>
    </form>
  `;

  const composer = pane.querySelector('#composerForm');
  composer.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ta = composer.querySelector('textarea');
    const text = ta.value.trim();
    if (!text) return;
    const btn = composer.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await sendMessage(thread.id, { text, sender: 'tenant' });
      ta.value = '';
    } catch (err) {
      console.error(err);
      showToast('Failed to send', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  messagesUnsub = subscribeToMessages(selectedThreadId, (list) => renderMessages(list));
}

function renderMessages(messages) {
  const wrap = document.getElementById('conversationMessages');
  if (!wrap) return;
  if (!messages.length) {
    wrap.innerHTML = '<div style="text-align:center;color:var(--gray);padding:2rem 0;">No messages yet.</div>';
    return;
  }
  wrap.innerHTML = messages.map(m => {
    const mine = m.sender === 'tenant';
    const who = mine ? 'You' : (m.senderName || m.senderEmail || 'Support');
    return `
      <div class="conv-msg ${mine ? 'mine' : 'theirs'}">
        <div class="conv-msg-meta">
          <span class="conv-msg-from">${escapeHtml(who)}</span>
          <span class="conv-msg-time">${escapeHtml(m.createdAt ? timeAgo(m.createdAt) : '')}</span>
        </div>
        <div class="conv-msg-bubble">${escapeHtml(m.text || '').replace(/\n/g, '<br>')}</div>
      </div>
    `;
  }).join('');
  wrap.scrollTop = wrap.scrollHeight;
}

function openNewThreadModal() {
  const tenant = getTenant();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop open';
  backdrop.innerHTML = `
    <div class="modal-dialog">
      <div class="modal-header">
        <h2 class="modal-title">New Message</h2>
        <button class="modal-close" type="button">×</button>
      </div>
      <div class="modal-body">
        <form class="modal-form" id="portalNewThreadForm">
          <div class="modal-field">
            <label>Subject *</label>
            <input type="text" name="subject" required maxlength="160" placeholder="Short subject">
          </div>
          <div class="modal-field">
            <label>Message *</label>
            <textarea name="text" rows="5" required></textarea>
          </div>
          <div class="modal-actions">
            <button type="submit" class="btn btn-primary btn-lg">Send</button>
            <span class="modal-cancel">Cancel</span>
          </div>
        </form>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => { backdrop.remove(); };
  backdrop.querySelector('.modal-close').addEventListener('click', close);
  backdrop.querySelector('.modal-cancel').addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

  backdrop.querySelector('#portalNewThreadForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const subject = (fd.get('subject') || '').toString().trim();
    const text = (fd.get('text') || '').toString().trim();
    if (!subject || !text) return;
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const thread = await createThread({ tenantId: tenant.id, subject, firstMessage: text, sender: 'tenant' });
      showToast('Message sent', 'success');
      close();
      selectedThreadId = thread.id;
      renderThreadList();
      renderConversation();
    } catch (err) {
      console.error(err);
      showToast('Failed to send: ' + err.message, 'error');
      btn.disabled = false;
    }
  });
}

// ── Utils (inline to match other portal views' pattern) ──

function escapeHtml(s) {
  if (!s) return '';
  const n = document.createElement('span');
  n.appendChild(document.createTextNode(s));
  return n.innerHTML;
}

function formatDate(ts) {
  if (!ts) return '';
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return ''; }
}

function timeAgo(ts) {
  if (!ts) return '';
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    if (isNaN(d.getTime())) return '';
    const diff = Date.now() - d.getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const dd = Math.floor(h / 24);
    if (dd < 30) return `${dd}d`;
    return formatDate(ts);
  } catch { return ''; }
}

function showToast(msg, type) {
  const c = document.getElementById('toastContainer');
  if (!c) { alert(msg); return; }
  const t = document.createElement('div');
  t.className = `toast toast-${type || 'info'}`;
  t.textContent = msg;
  c.appendChild(t);
  requestAnimationFrame(() => t.classList.add('toast-visible'));
  setTimeout(() => { t.classList.remove('toast-visible'); setTimeout(() => t.remove(), 400); }, 3000);
}
