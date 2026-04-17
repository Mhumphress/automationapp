import { db, auth } from '../config.js';
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getTenantId } from '../tenant-context.js';

function tenantCollection(path) {
  const tid = getTenantId();
  if (!tid) throw new Error('No tenant context');
  return collection(db, `tenants/${tid}/${path}`);
}

function tenantDoc(path) {
  const tid = getTenantId();
  if (!tid) throw new Error('No tenant context');
  return doc(db, `tenants/${tid}/${path}`);
}

export async function listParts() {
  const q = query(tenantCollection('inventory'), orderBy('name', 'asc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getPart(partId) {
  const snap = await getDoc(tenantDoc(`inventory/${partId}`));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function createPart(data) {
  const user = auth.currentUser;
  return addDoc(tenantCollection('inventory'), {
    sku: (data.sku || '').trim(),
    name: (data.name || '').trim(),
    category: (data.category || '').trim(),
    quantity: Number(data.quantity) || 0,
    reorderLevel: Number(data.reorderLevel) || 0,
    unitCost: Number(data.unitCost) || 0,
    unitPrice: Number(data.unitPrice) || 0,
    supplier: (data.supplier || '').trim(),
    notes: (data.notes || '').trim(),
    createdAt: serverTimestamp(),
    createdBy: user ? user.uid : null,
    updatedAt: serverTimestamp(),
    updatedBy: user ? user.uid : null
  });
}

export async function updatePart(partId, patch) {
  const user = auth.currentUser;
  const numericFields = ['quantity', 'reorderLevel', 'unitCost', 'unitPrice'];
  const clean = { ...patch };
  numericFields.forEach(k => { if (k in clean) clean[k] = Number(clean[k]) || 0; });
  return updateDoc(tenantDoc(`inventory/${partId}`), {
    ...clean,
    updatedAt: serverTimestamp(),
    updatedBy: user ? user.uid : null
  });
}

export async function deletePart(partId) {
  return deleteDoc(tenantDoc(`inventory/${partId}`));
}
