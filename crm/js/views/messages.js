// ─────────────────────────────────────────────────────────────────
//  messages.js (CRM view) — Operator-side inbox.
//
//  Left column: thread list, grouped by recency, unread-first.
//  Right column: selected conversation + compose box.
//  Top bar: search + "New Message" that picks a tenant.
// ─────────────────────────────────────────────────────────────────

import {
  listThreads, subscribeToThreads, subscribeToMessages,
  sendMessage, createThread, markThreadAsRead, setThreadArchived,
} from '../services/messages.js';
import { getTenants } from '../services/tenants.js';
import { showToast, escapeHtml, timeAgo, formatDate } from '../ui.js';
import { createModal, openStackedModal } from '../components/modal.js';

let threads = [];
let tenants = [];
let tenantsById = {};
let selectedThreadId = null;
let threadsUnsub = null;
let messagesUnsub = null;
let searchTerm = '';
let filterMode = 'all'; // all | unread | archived
let modal = null;

export function init() {
  if (!modal) modal = createModal();
}

export function destroy() {
  if (threadsUnsub) { try { threadsUnsub(); } catch {} threadsUnsub = null; }
  if (messagesUnsub) { try { messagesUnsub(); } catch {} messagesUnsub = null; }
}

export async function render() {
  const container = document.getElementById('view-messages');
  container.innerHTML = `
    <div class="messages-layout">
      <aside class="messages-list-pane">
        <div class="messages-list-top">
          <button class="btn btn-primary btn-sm" id="newThreadBtn">+ New Message</button>
          <input type="search" class="search-input messages-search" placeholder="Search messages..." />
        </div>
        <div class="messages-filter-pills">
          <button class="activity-filter-pill active" data-filter="all">All</button>
          <button class="activity-filter-pill" data-filter="unread">Unread</button>
          <button class="activity-filter-pill" data-filter="archived">Archived</button>
        </div>
        <div class="messages-thread-list" id="threadList">
          <div class="loading">Loading...</div>
        </div>
      </aside>
      <section class="messages-conversation-pane" id="conversationPane">
        <div class="empty-state" style="margin:auto;">
          <div class="empty-title">Pick a conversation</div>
          <p class="empty-description">Select a thread on the left, or start a new one.</p>
        </div>
      </section>
    </div>
  `;

  // Load tenants for new-thread picker + thread labels
  try {
    tenants = await getTenants();
    tenantsById = Object.fromEntries(tenants.map(t => [t.id, t]));
  } catch (err) {
    console.warn('tenants load failed:', err);
    tenants = [];
    tenantsById = {};
  }

  // Subscribe to threads
  destroy();
  threadsUnsub = subscribeToThreads(
    {},
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
            <div style="font-weight:600;margin-bottom:0.3rem;">Can't load threads</div>
            <div style="color:var(--gray-dark,#64748B);font-size:0.78rem;">${escapeHtml(err.code || err.message || 'Unknown error')}</div>
          </div>
        `;
      }
    }
  );

  // Wire top bar
  const searchEl = container.querySelector('.messages-search');
  searchEl.addEventListener('input', () => {
    searchTerm = searchEl.value.trim().toLowerCase();
    renderThreadList();
  });
  container.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      filterMode = btn.dataset.filter;
      container.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active', b === btn));
      renderThreadList();
    });
  });
  container.querySelector('#newThreadBtn').addEventListener('click', () => openNewThreadModal());
}

// ── Thread list ─────────────────────────────────────────────────

function renderThreadList() {
  const wrap = document.getElementById('threadList');
  if (!wrap) return;

  let list = [...threads];

  if (filterMode === 'unread') list = list.filter(t => t.unreadByOperator && !t.archived);
  else if (filterMode === 'archived') list = list.filter(t => t.archived);
  else list = list.filter(t => !t.archived);

  if (searchTerm) {
    list = list.filter(t => {
      const tenantName = (tenantsById[t.tenantId]?.companyName || '').toLowerCase();
      return (t.subject || '').toLowerCase().includes(searchTerm)
          || (t.lastMessageSnippet || '').toLowerCase().includes(searchTerm)
          || tenantName.includes(searchTerm);
    });
  }

  if (!list.length) {
    wrap.innerHTML = `<div style="padding:2rem 1rem;text-align:center;color:var(--gray);font-size:0.85rem;">
      ${filterMode === 'archived' ? 'No archived conversations.' : searchTerm ? 'No matches.' : 'No conversations yet.'}
    </div>`;
    return;
  }

  wrap.innerHTML = list.map(t => {
    const tenant = tenantsById[t.tenantId];
    const tenantName = tenant?.companyName || 'Unknown';
    const unread = t.unreadByOperator && !t.archived;
    return `
      <div class="thread-row ${t.id === selectedThreadId ? 'selected' : ''} ${unread ? 'unread' : ''}" data-id="${escapeHtml(t.id)}">
        <div class="thread-row-top">
          <span class="thread-row-subject">${escapeHtml(t.subject || '(no subject)')}</span>
          <span class="thread-row-time">${escapeHtml(t.lastMessageAt ? timeAgo(t.lastMessageAt) : '')}</span>
        </div>
        <div class="thread-row-tenant">${escapeHtml(tenantName)}</div>
        <div class="thread-row-snippet">
          ${t.lastMessageBy === 'tenant' ? '' : '<span class="thread-row-mine">You:</span> '}
          ${escapeHtml((t.lastMessageSnippet || '').slice(0, 90))}
        </div>
      </div>
    `;
  }).join('');

  wrap.querySelectorAll('.thread-row').forEach(row => {
    row.addEventListener('click', () => selectThread(row.dataset.id));
  });
}

// ── Conversation pane ───────────────────────────────────────────

function selectThread(threadId) {
  selectedThreadId = threadId;
  renderThreadList();  // refresh highlight
  renderConversation();
  // Mark as read (fire-and-forget)
  markThreadAsRead(threadId, 'operator').catch(() => {});
}

function renderConversation() {
  const pane = document.getElementById('conversationPane');
  if (messagesUnsub) { try { messagesUnsub(); } catch {} messagesUnsub = null; }

  if (!selectedThreadId) {
    pane.innerHTML = `
      <div class="empty-state" style="margin:auto;">
        <div class="empty-title">Pick a conversation</div>
        <p class="empty-description">Select a thread on the left, or start a new one.</p>
      </div>
    `;
    return;
  }

  const thread = threads.find(t => t.id === selectedThreadId);
  if (!thread) return;
  const tenant = tenantsById[thread.tenantId];
  const tenantName = tenant?.companyName || 'Unknown';

  pane.innerHTML = `
    <header class="conversation-header">
      <div>
        <div class="conversation-subject">${escapeHtml(thread.subject || '(no subject)')}</div>
        <div class="conversation-sub">${escapeHtml(tenantName)}</div>
      </div>
      <div class="conversation-actions">
        <button class="btn btn-ghost btn-sm" data-action="open-tenant">Open Tenant &#x2197;</button>
        <button class="btn btn-ghost btn-sm" data-action="toggle-archive">${thread.archived ? 'Unarchive' : 'Archive'}</button>
      </div>
    </header>
    <div class="conversation-messages" id="conversationMessages">
      <div class="loading">Loading messages...</div>
    </div>
    <form class="conversation-composer" id="composerForm" autocomplete="off">
      <textarea name="text" placeholder="Type your message..." rows="2" required></textarea>
      <button type="submit" class="btn btn-primary btn-sm">Send</button>
    </form>
  `;

  pane.querySelector('[data-action="toggle-archive"]').addEventListener('click', async () => {
    await setThreadArchived(thread.id, !thread.archived);
    showToast(thread.archived ? 'Unarchived' : 'Archived', 'success');
  });
  pane.querySelector('[data-action="open-tenant"]').addEventListener('click', async () => {
    const m = await import('./tenants.js');
    m.requestTenant(thread.tenantId);
    window.location.hash = 'tenants';
  });

  const composer = pane.querySelector('#composerForm');
  composer.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ta = composer.querySelector('textarea');
    const text = ta.value.trim();
    if (!text) return;
    const btn = composer.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await sendMessage(thread.id, { text, sender: 'operator' });
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
    const mine = m.sender === 'operator';
    return `
      <div class="conv-msg ${mine ? 'mine' : 'theirs'}">
        <div class="conv-msg-meta">
          <span class="conv-msg-from">${escapeHtml(m.senderName || m.senderEmail || (mine ? 'You' : 'Customer'))}</span>
          <span class="conv-msg-time">${escapeHtml(m.createdAt ? timeAgo(m.createdAt) : '')}</span>
        </div>
        <div class="conv-msg-bubble">${escapeHtml(m.text || '').replace(/\n/g, '<br>')}</div>
      </div>
    `;
  }).join('');

  wrap.scrollTop = wrap.scrollHeight;
}

// ── New thread modal ────────────────────────────────────────────

function openNewThreadModal() {
  return openStackedModal('New Message', (bodyEl, close) => {
    const form = document.createElement('form');
    form.className = 'modal-form';

    const tenantOptions = tenants
      .filter(t => t.status !== 'cancelled')
      .map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.companyName || t.id)} · ${escapeHtml(t.status || '')}</option>`)
      .join('');

    form.innerHTML = `
      <div class="modal-field">
        <label>Tenant *</label>
        <select name="tenantId" required>
          <option value="">Select a tenant...</option>
          ${tenantOptions}
        </select>
      </div>
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
    `;

    form.querySelector('.modal-cancel').addEventListener('click', () => close(null));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const tenantId = (fd.get('tenantId') || '').toString();
      const subject = (fd.get('subject') || '').toString().trim();
      const text = (fd.get('text') || '').toString().trim();
      if (!tenantId || !subject || !text) return;

      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        const thread = await createThread({ tenantId, subject, firstMessage: text, sender: 'operator' });
        showToast('Message sent', 'success');
        close({ ok: true });
        selectedThreadId = thread.id;
        renderThreadList();
        renderConversation();
      } catch (err) {
        console.error(err);
        showToast('Failed to send: ' + err.message, 'error');
        btn.disabled = false;
      }
    });

    bodyEl.appendChild(form);
  });
}
