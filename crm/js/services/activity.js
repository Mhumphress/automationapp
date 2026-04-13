import { db, auth } from '../config.js';
import {
  collection, addDoc, getDocs, query, orderBy, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

/**
 * Add an activity entry to a document's activity subcollection.
 * @param {string} parentCollection - "contacts" or "deals"
 * @param {string} parentId - document ID
 * @param {object} entry - { type, description, field?, oldValue?, newValue? }
 */
export async function addActivity(parentCollection, parentId, entry) {
  const user = auth.currentUser;
  const ref = collection(db, parentCollection, parentId, 'activity');
  return addDoc(ref, {
    ...entry,
    createdAt: serverTimestamp(),
    createdBy: user ? user.uid : null,
    createdByEmail: user ? user.email : null
  });
}

/**
 * Log a field edit as an activity entry.
 */
export async function logFieldEdit(parentCollection, parentId, field, oldValue, newValue) {
  return addActivity(parentCollection, parentId, {
    type: 'edit',
    description: `Changed ${field}`,
    field,
    oldValue: oldValue != null ? String(oldValue) : '',
    newValue: newValue != null ? String(newValue) : ''
  });
}

/**
 * Get all activity entries for a document, newest first.
 */
export async function getActivity(parentCollection, parentId) {
  const ref = collection(db, parentCollection, parentId, 'activity');
  const q = query(ref, orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
