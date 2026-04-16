import { db, auth } from '../config.js';
import {
  collection, doc, addDoc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// All queries use simple getDocs (no orderBy, no where) to avoid
// Firestore composite index requirements. Sort/filter client-side.

// ── Tenant CRUD ─────────────────────────

export async function getTenants() {
  const snap = await getDocs(collection(db, 'tenants'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => {
    const ta = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(0);
    const tb = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(0);
    return tb - ta;
  });
}

export async function getTenantsByStatus(status) {
  const all = await getTenants();
  return all.filter(t => t.status === status);
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
  const snap = await getDocs(collection(db, 'tenants', tenantId, 'users'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => {
    const ta = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(0);
    const tb = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(0);
    return tb - ta;
  });
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
  const snap = await getDocs(collection(db, 'tenants', tenantId, 'activity'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => {
    const ta = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(0);
    const tb = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(0);
    return tb - ta;
  });
}

// ── Tenant Invoices ─────────────────────

export async function getTenantInvoices(tenantId) {
  const snap = await getDocs(collection(db, 'tenants', tenantId, 'invoices'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => {
    const ta = a.issuedDate?.toDate ? a.issuedDate.toDate() : new Date(a.issuedDate || 0);
    const tb = b.issuedDate?.toDate ? b.issuedDate.toDate() : new Date(b.issuedDate || 0);
    return tb - ta;
  });
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
  const snap = await getDocs(collection(db, 'tenants', tenantId, 'payments'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => {
    const ta = a.processedAt?.toDate ? a.processedAt.toDate() : new Date(0);
    const tb = b.processedAt?.toDate ? b.processedAt.toDate() : new Date(0);
    return tb - ta;
  });
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
  const snap = await getDocs(collection(db, 'tenants', tenantId, 'notifications'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => {
    const ta = a.sentAt?.toDate ? a.sentAt.toDate() : new Date(0);
    const tb = b.sentAt?.toDate ? b.sentAt.toDate() : new Date(0);
    return tb - ta;
  });
}
