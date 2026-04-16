import { db, auth } from './config.js';
import {
  collection, getDocs, getDoc, doc, query, where
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

let currentTenant = null;
let currentPackage = null;
let currentVertical = null;
let currentUserRole = null;
let effectiveFeatures = new Set();

// ── Load tenant context for the current user ──

export async function loadTenantContext() {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  // Find all tenants where this user is a member
  const tenantsSnap = await getDocs(collection(db, 'tenants'));
  const userTenants = [];

  for (const tenantDoc of tenantsSnap.docs) {
    const userDoc = await getDoc(doc(db, 'tenants', tenantDoc.id, 'users', user.uid));
    if (userDoc.exists()) {
      userTenants.push({
        id: tenantDoc.id,
        ...tenantDoc.data(),
        userRole: userDoc.data().role
      });
    }
  }

  if (userTenants.length === 0) {
    throw new Error('NO_TENANT');
  }

  // Check localStorage for last-used tenant
  const lastTenantId = localStorage.getItem('portal_tenant_id');
  let selected = userTenants.find(t => t.id === lastTenantId);
  if (!selected) selected = userTenants[0];

  await selectTenant(selected);

  return { tenants: userTenants, selected };
}

export async function selectTenant(tenantData) {
  currentTenant = tenantData;
  currentUserRole = tenantData.userRole || 'user';
  localStorage.setItem('portal_tenant_id', tenantData.id);

  // Load package
  if (tenantData.packageId) {
    const pkgSnap = await getDoc(doc(db, 'packages', tenantData.packageId));
    currentPackage = pkgSnap.exists() ? { id: pkgSnap.id, ...pkgSnap.data() } : null;
  }

  // Load vertical
  if (tenantData.vertical) {
    const vSnap = await getDoc(doc(db, 'verticals', tenantData.vertical));
    currentVertical = vSnap.exists() ? { id: vSnap.id, ...vSnap.data() } : null;
  }

  // Compute effective features
  effectiveFeatures.clear();
  const pkgFeatures = currentPackage ? (currentPackage.features || []) : [];
  pkgFeatures.forEach(f => effectiveFeatures.add(f));

  // Add-on features (add-ons that map to features)
  if (tenantData.addOns) {
    tenantData.addOns.forEach(ao => {
      if (ao.slug) effectiveFeatures.add(ao.slug);
    });
  }

  // Feature overrides
  if (tenantData.featureOverrides) {
    Object.entries(tenantData.featureOverrides).forEach(([slug, enabled]) => {
      if (enabled) effectiveFeatures.add(slug);
      else effectiveFeatures.delete(slug);
    });
  }
}

// ── Getters ──

export function getTenant() { return currentTenant; }
export function getPackage() { return currentPackage; }
export function getVertical() { return currentVertical; }
export function getUserRole() { return currentUserRole; }
export function getTenantId() { return currentTenant ? currentTenant.id : null; }

// ── Feature gating ──

export function hasFeature(slug) {
  return effectiveFeatures.has(slug);
}

export function getEffectiveFeatures() {
  return [...effectiveFeatures];
}

// ── Status checks ──

export function isReadOnly() {
  return currentTenant && currentTenant.status === 'past_due';
}

export function isSuspended() {
  return currentTenant && (currentTenant.status === 'suspended' || currentTenant.status === 'cancelled');
}

export function canWrite() {
  return currentTenant && currentTenant.status === 'active';
}

export function gateWrite(fn) {
  return async function (...args) {
    if (isSuspended()) {
      showStatusToast('Your account is suspended. Please contact support.');
      return;
    }
    if (isReadOnly()) {
      showStatusToast('Your account is in read-only mode. Please update your payment.');
      return;
    }
    return fn.apply(this, args);
  };
}

// ── Terminology helper ──

export function term(key) {
  if (!currentVertical || !currentVertical.terminology) return key;
  return currentVertical.terminology[key] || key;
}

// ── Status toast (needs portal toast container) ──

function showStatusToast(message) {
  const container = document.getElementById('toastContainer');
  if (!container) { alert(message); return; }

  const toast = document.createElement('div');
  toast.className = 'toast toast-error';
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-visible'));
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 400);
  }, 4000);
}
