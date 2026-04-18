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

/**
 * List threads. If tenantId omitted, returns all threads (operator view).
 * @param {object} opts
 * @param {string} [opts.tenantId]
 * @param {number} [opts.limit=200]
 * @param {boolean} [opts.archived=false]
 */
export async function listThreads(opts = {}) {
  const { tenantId, limit = 200, archived = false } = opts;
  try {
    const clauses = [orderBy('lastMessageAt', 'desc'), fbLimit(limit)];
    if (tenantId) clauses.unshift(where('tenantId', '==', tenantId));
    const q = query(collection(db, 'message_threads'), ...clauses);
    const snap = await getDocs(q);
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(t => !!archived === !!t.archived);
  } catch (err) {
    console.warn('listThreads failed:', err);
    return [];
  }
}

/** Subscribe to threads (real-time). Returns an unsubscribe fn. */
export function subscribeToThreads(opts, onUpdate) {
  const { tenantId, limit = 200 } = opts || {};
  const clauses = [orderBy('lastMessageAt', 'desc'), fbLimit(limit)];
  if (tenantId) clauses.unshift(where('tenantId', '==', tenantId));
  const q = query(collection(db, 'message_threads'), ...clauses);
  return onSnapshot(q, (snap) => {
    onUpdate(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }, (err) => console.warn('subscribeToThreads error:', err));
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
