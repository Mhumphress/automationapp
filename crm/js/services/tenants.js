import { db, auth } from '../config.js';
import {
  collection, doc, addDoc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, orderBy, where, serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ── Tenant CRUD ─────────────────────────

export async function getTenants() {
  const q = query(collection(db, 'tenants'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getTenantsByStatus(status) {
  const q = query(
    collection(db, 'tenants'),
    where('status', '==', status),
    orderBy('createdAt', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getTenant(tenantId) {
  const snap = await getDoc(doc(db, 'tenants', tenantId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function createTenant(data) {
  const user = auth.currentUser;
  return addDoc(collection(db, 'tenants'), {
    ...data,
    createdAt: serverTimestamp(),
    createdBy: user ? user.uid : null,
    updatedAt: serverTimestamp(),
    updatedBy: user ? user.uid : null
  });
}

export async function updateTenant(tenantId, data) {
  const user = auth.currentUser;
  return updateDoc(doc(db, 'tenants', tenantId), {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: user ? user.uid : null
  });
}

// ── Tenant Users ────────────────────────

export async function getTenantUsers(tenantId) {
  const q = query(collection(db, 'tenants', tenantId, 'users'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function addTenantUser(tenantId, userId, data) {
  return setDoc(doc(db, 'tenants', tenantId, 'users', userId), {
    ...data,
    createdAt: serverTimestamp()
  });
}

export async function updateTenantUser(tenantId, userId, data) {
  return updateDoc(doc(db, 'tenants', tenantId, 'users', userId), data);
}

export async function removeTenantUser(tenantId, userId) {
  return deleteDoc(doc(db, 'tenants', tenantId, 'users', userId));
}

// ── Tenant Activity ─────────────────────

export async function addTenantActivity(tenantId, entry) {
  const user = auth.currentUser;
  return addDoc(collection(db, 'tenants', tenantId, 'activity'), {
    ...entry,
    createdAt: serverTimestamp(),
    createdBy: user ? user.uid : null,
    createdByEmail: user ? user.email : null
  });
}

export async function getTenantActivity(tenantId) {
  const q = query(
    collection(db, 'tenants', tenantId, 'activity'),
    orderBy('createdAt', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Tenant Invoices ─────────────────────

export async function getTenantInvoices(tenantId) {
  const q = query(
    collection(db, 'tenants', tenantId, 'invoices'),
    orderBy('issuedDate', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function addTenantInvoice(tenantId, data) {
  const user = auth.currentUser;
  return addDoc(collection(db, 'tenants', tenantId, 'invoices'), {
    ...data,
    createdAt: serverTimestamp(),
    createdBy: user ? user.uid : null
  });
}

export async function updateTenantInvoice(tenantId, invoiceId, data) {
  return updateDoc(doc(db, 'tenants', tenantId, 'invoices', invoiceId), data);
}

// ── Tenant Payments ─────────────────────

export async function getTenantPayments(tenantId) {
  const q = query(
    collection(db, 'tenants', tenantId, 'payments'),
    orderBy('processedAt', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function addTenantPayment(tenantId, data) {
  const user = auth.currentUser;
  return addDoc(collection(db, 'tenants', tenantId, 'payments'), {
    ...data,
    createdAt: serverTimestamp(),
    createdBy: user ? user.uid : null
  });
}

// ── Tenant Notifications ────────────────

export async function addTenantNotification(tenantId, data) {
  return addDoc(collection(db, 'tenants', tenantId, 'notifications'), {
    ...data,
    sentAt: serverTimestamp()
  });
}

export async function getTenantNotifications(tenantId) {
  const q = query(
    collection(db, 'tenants', tenantId, 'notifications'),
    orderBy('sentAt', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Re-export for convenience
export { Timestamp, serverTimestamp };
