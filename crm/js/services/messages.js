// ─────────────────────────────────────────────────────────────────
//  messages.js — Threaded messaging between operators and tenants.
//
//  Data model:
//    message_threads/{id} — { tenantId, subject, createdAt, createdBy,
//      createdByEmail, lastMessageAt, lastMessageSnippet, lastMessageBy,
//      unreadByOperator, unreadByTenant, archived }
//    message_threads/{id}/messages/{id} — { text, sender, senderUid,
//      senderEmail, senderName, createdAt }
//
//  PORTAL MIRROR: this file is duplicated byte-identical at
//  `portal/js/services/messages.js`. Keep in sync.
// ─────────────────────────────────────────────────────────────────

import { db, auth } from '../config.js';
import {
  collection, doc, addDoc, getDoc, getDocs, updateDoc, setDoc,
  query, where, orderBy, limit as fbLimit, onSnapshot,
  serverTimestamp, runTransaction, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

function tsMs(ts) {
  if (!ts) return 0;
  if (ts.toDate) return ts.toDate().getTime();
  if (ts instanceof Date) return ts.getTime();
  return new Date(ts).getTime() || 0;
}

function sortThreadsByRecency(list) {
  return list.sort((a, b) => tsMs(b.lastMessageAt) - tsMs(a.lastMessageAt));
}

/**
 * List threads. If tenantId omitted, returns all threads (operator view).
 *
 * Tenant-scoped queries use where-only (no orderBy) to avoid needing a
 * Firestore composite index (tenantId, lastMessageAt). Sorted client-side.
 */
export async function listThreads(opts = {}) {
  const { tenantId, limit = 200, archived = false } = opts;
  try {
    let q;
    if (tenantId) {
      q = query(collection(db, 'message_threads'), where('tenantId', '==', tenantId), fbLimit(limit));
    } else {
      q = query(collection(db, 'message_threads'), orderBy('lastMessageAt', 'desc'), fbLimit(limit));
    }
    const snap = await getDocs(q);
    const list = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(t => !!archived === !!t.archived);
    return tenantId ? sortThreadsByRecency(list) : list;
  } catch (err) {
    console.error('[messages] listThreads failed:', err);
    throw err;
  }
}

/**
 * Subscribe to threads (real-time).
 * @param {object} opts
 * @param {string} [opts.tenantId]
 * @param {number} [opts.limit=200]
 * @param {Function} onUpdate  called with (threads[])
 * @param {Function} [onError] optional error handler — called with Error
 * @returns unsubscribe fn
 */
export function subscribeToThreads(opts, onUpdate, onError) {
  const { tenantId, limit = 200 } = opts || {};
  let q;
  if (tenantId) {
    q = query(collection(db, 'message_threads'), where('tenantId', '==', tenantId), fbLimit(limit));
  } else {
    q = query(collection(db, 'message_threads'), orderBy('lastMessageAt', 'desc'), fbLimit(limit));
  }
  return onSnapshot(q, (snap) => {
    let list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (tenantId) list = sortThreadsByRecency(list);
    onUpdate(list);
  }, (err) => {
    console.error('[messages] subscribeToThreads error:', err);
    if (onError) try { onError(err); } catch {}
  });
}

export async function getThread(threadId) {
  if (!threadId) return null;
  const snap = await getDoc(doc(db, 'message_threads', threadId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

/**
 * Create a new thread with an initial message.
 * @param {object} p
 * @param {string} p.tenantId
 * @param {string} p.subject
 * @param {string} p.firstMessage
 * @param {'operator'|'tenant'} p.sender
 */
export async function createThread(p) {
  if (!p || !p.tenantId || !p.subject || !p.firstMessage) {
    throw new Error('tenantId, subject, and firstMessage are required');
  }
  const user = auth.currentUser;
  const sender = p.sender === 'tenant' ? 'tenant' : 'operator';

  const threadData = {
    tenantId: p.tenantId,
    subject: p.subject.trim(),
    createdAt: serverTimestamp(),
    createdBy: user ? user.uid : null,
    createdByEmail: user ? user.email || '' : '',
    lastMessageAt: serverTimestamp(),
    lastMessageSnippet: p.firstMessage.slice(0, 200),
    lastMessageBy: sender,
    // First message is unread for the OTHER side.
    unreadByOperator: sender === 'tenant',
    unreadByTenant:   sender === 'operator',
    archived: false,
  };

  const threadRef = await addDoc(collection(db, 'message_threads'), threadData);

  // Write the first message.
  await addDoc(collection(db, 'message_threads', threadRef.id, 'messages'), {
    text:          p.firstMessage.trim(),
    sender,
    senderUid:     user ? user.uid : null,
    senderEmail:   user ? user.email || '' : '',
    senderName:    user ? (user.displayName || user.email || '') : '',
    createdAt:     serverTimestamp(),
  });

  return { id: threadRef.id, ...threadData };
}

/**
 * Send a message to an existing thread. Updates the thread's lastMessage
 * metadata and flips the opposite-side unread flag.
 */
export async function sendMessage(threadId, p) {
  if (!threadId || !p || !p.text) throw new Error('threadId and text required');
  const user = auth.currentUser;
  const sender = p.sender === 'tenant' ? 'tenant' : 'operator';

  const threadRef = doc(db, 'message_threads', threadId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(threadRef);
    if (!snap.exists()) throw new Error('Thread not found');

    // Append message.
    const msgRef = doc(collection(db, 'message_threads', threadId, 'messages'));
    tx.set(msgRef, {
      text:          p.text.trim(),
      sender,
      senderUid:     user ? user.uid : null,
      senderEmail:   user ? user.email || '' : '',
      senderName:    user ? (user.displayName || user.email || '') : '',
      createdAt:     serverTimestamp(),
    });

    // Update thread metadata.
    tx.update(threadRef, {
      lastMessageAt:      serverTimestamp(),
      lastMessageSnippet: p.text.slice(0, 200),
      lastMessageBy:      sender,
      unreadByOperator:   sender === 'tenant',
      unreadByTenant:     sender === 'operator',
    });
  });
}

/** Subscribe to a thread's messages in chronological order. */
export function subscribeToMessages(threadId, onUpdate) {
  if (!threadId) return () => {};
  const q = query(
    collection(db, 'message_threads', threadId, 'messages'),
    orderBy('createdAt', 'asc')
  );
  return onSnapshot(q, (snap) => {
    onUpdate(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }, (err) => console.warn('subscribeToMessages error:', err));
}

/**
 * Mark a thread as read from the given side.
 * @param {string} threadId
 * @param {'operator'|'tenant'} reader
 */
export async function markThreadAsRead(threadId, reader) {
  if (!threadId) return;
  const update = reader === 'tenant'
    ? { unreadByTenant: false }
    : { unreadByOperator: false };
  try {
    await updateDoc(doc(db, 'message_threads', threadId), update);
  } catch (err) {
    console.warn('markThreadAsRead failed:', err);
  }
}

/** Archive/unarchive a thread. */
export async function setThreadArchived(threadId, archived) {
  if (!threadId) return;
  try {
    await updateDoc(doc(db, 'message_threads', threadId), { archived: !!archived });
  } catch (err) {
    console.warn('setThreadArchived failed:', err);
  }
}

/** Count of threads unread by the given side. */
export function countUnread(threads, reader) {
  if (!Array.isArray(threads)) return 0;
  const key = reader === 'tenant' ? 'unreadByTenant' : 'unreadByOperator';
  return threads.filter(t => t[key] && !t.archived).length;
}
