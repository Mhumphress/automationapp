import { db, auth } from '../config.js';
import {
  collection, doc, addDoc, getDoc, getDocs, updateDoc, deleteDoc,
  query, orderBy, where, serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

/**
 * Add a document to a collection. Auto-sets createdAt, createdBy, updatedAt, updatedBy.
 */
export async function addDocument(collectionName, data) {
  const user = auth.currentUser;
  return addDoc(collection(db, collectionName), {
    ...data,
    createdAt: serverTimestamp(),
    createdBy: user ? user.uid : null,
    updatedAt: serverTimestamp(),
    updatedBy: user ? user.uid : null
  });
}

/**
 * Update fields on a document. Auto-sets updatedAt, updatedBy.
 */
export async function updateDocument(collectionName, docId, data) {
  const user = auth.currentUser;
  return updateDoc(doc(db, collectionName, docId), {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: user ? user.uid : null
  });
}

/**
 * Delete a document.
 */
export async function deleteDocument(collectionName, docId) {
  return deleteDoc(doc(db, collectionName, docId));
}

/**
 * Get a single document by ID.
 */
export async function getDocument(collectionName, docId) {
  const snap = await getDoc(doc(db, collectionName, docId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

/**
 * Query all documents in a collection, optionally ordered.
 */
export async function queryDocuments(collectionName, orderField = 'createdAt', orderDir = 'desc') {
  const q = query(collection(db, collectionName), orderBy(orderField, orderDir));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Query documents with a where clause.
 */
export async function queryDocumentsWhere(collectionName, field, operator, value, orderField = 'createdAt', orderDir = 'desc') {
  const q = query(
    collection(db, collectionName),
    where(field, operator, value),
    orderBy(orderField, orderDir)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Re-export Timestamp for date conversions in views
export { Timestamp, serverTimestamp };
