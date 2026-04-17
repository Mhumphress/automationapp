import { db, auth } from '../config.js';
import {
  collection, doc, addDoc, getDoc, getDocs, updateDoc, deleteDoc,
  query, orderBy, where, serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getTenantId } from '../tenant-context.js';

function tenantPath(collectionName) {
  const tid = getTenantId();
  if (!tid) throw new Error('No tenant context');
  return `tenants/${tid}/${collectionName}`;
}

export async function addDocument(collectionName, data) {
  const user = auth.currentUser;
  const path = tenantPath(collectionName);
  return addDoc(collection(db, path), {
    ...data,
    createdAt: serverTimestamp(),
    createdBy: user ? user.uid : null,
    updatedAt: serverTimestamp(),
    updatedBy: user ? user.uid : null
  });
}

export async function updateDocument(collectionName, docId, data) {
  const user = auth.currentUser;
  const path = tenantPath(collectionName);
  return updateDoc(doc(db, path, docId), {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: user ? user.uid : null
  });
}

export async function deleteDocument(collectionName, docId) {
  const path = tenantPath(collectionName);
  return deleteDoc(doc(db, path, docId));
}

export async function getDocument(collectionName, docId) {
  const path = tenantPath(collectionName);
  const snap = await getDoc(doc(db, path, docId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function queryDocuments(collectionName, orderField = 'createdAt', orderDir = 'desc') {
  const path = tenantPath(collectionName);
  const q = query(collection(db, path), orderBy(orderField, orderDir));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function queryDocumentsWhere(collectionName, field, operator, value, orderField = 'createdAt', orderDir = 'desc') {
  const path = tenantPath(collectionName);
  // Filter-only query (no orderBy) — avoids needing a composite Firestore index
  // for every (field, orderField) pair. We sort client-side.
  const q = query(collection(db, path), where(field, operator, value));
  const snap = await getDocs(q);
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  rows.sort((a, b) => {
    const av = a[orderField];
    const bv = b[orderField];
    const aTime = av && av.toDate ? av.toDate().getTime() : (av instanceof Date ? av.getTime() : (typeof av === 'number' ? av : 0));
    const bTime = bv && bv.toDate ? bv.toDate().getTime() : (bv instanceof Date ? bv.getTime() : (typeof bv === 'number' ? bv : 0));
    return orderDir === 'asc' ? aTime - bTime : bTime - aTime;
  });
  return rows;
}

export { Timestamp, serverTimestamp };
