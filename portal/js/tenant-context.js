import { db, auth } from './config.js';
import {
  collection, getDocs, getDoc, doc, setDoc, updateDoc, deleteDoc
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

  // Find all tenants where this user is a member (by UID)
  const tenantsSnap = await getDocs(collection(db, 'tenants'));
  const userTenants = [];

  for (const tenantDoc of tenantsSnap.docs) {
    try {
      const userDoc = await getDoc(doc(db, 'tenants', tenantDoc.id, 'users', user.uid));
      if (userDoc.exists()) {
        userTenants.push({
          id: tenantDoc.id,
          ...tenantDoc.data(),
          userRole: userDoc.data().role
        });
      }
    } catch (err) {
      // Permission denied for this tenant — skip it
    }
  }

  // If no UID match, search by email and auto-link
  if (userTenants.length === 0 && user.email) {
    for (const tenantDoc of tenantsSnap.docs) {
      try {
        const usersSnap = await getDocs(collection(db, 'tenants', tenantDoc.id, 'users'));
        for (const userSnapDoc of usersSnap.docs) {
          const userData = userSnapDoc.data();
          if (userData.email && userData.email.toLowerCase() === user.email.toLowerCase() && userSnapDoc.id !== user.uid) {
            // Found a match by email — create a new user doc with the correct UID
            await setDoc(doc(db, 'tenants', tenantDoc.id, 'users', user.uid), {
              ...userData,
              email: user.email,
              displayName: user.displayName || user.email
            });
            // Delete the old placeholder user doc
            try {
              await deleteDoc(doc(db, 'tenants', tenantDoc.id, 'users', userSnapDoc.id));
            } catch (e) {
              console.warn('Could not delete old placeholder user doc:', e);
            }
            // Update the tenant's ownerUserId if this was the owner
            if (userData.role === 'owner') {
              try {
                await updateDoc(doc(db, 'tenants', tenantDoc.id), { ownerUserId: user.uid });
              } catch (e) {
                console.warn('Could not update ownerUserId:', e);
              }
            }
            userTenants.push({
              id: tenantDoc.id,
              ...tenantDoc.data(),
              userRole: userData.role
            });
            break;
          }
        }
      } catch (err) {
        // Permission denied for this tenant — skip it
      }
      if (userTenants.length > 0) break;
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
  currentPackage = null;
  if (tenantData.packageId) {
    try {
      const pkgSnap = await getDoc(doc(db, 'packages', tenantData.packageId));
      currentPackage = pkgSnap.exists() ? { id: pkgSnap.id, ...pkgSnap.data() } : null;
    } catch (err) {
      console.error('Failed to load package:', err);
    }
  }

  // Load vertical
  currentVertical = null;
  if (tenantData.vertical) {
    try {
      const vSnap = await getDoc(doc(db, 'verticals', tenantData.vertical));
      currentVertical = vSnap.exists() ? { id: vSnap.id, ...vSnap.data() } : null;
    } catch (err) {
      console.error('Failed to load vertical:', err);
    }
  }

  // Compute effective features
  effectiveFeatures.clear();
  const pkgFeatures = currentPackage ? (currentPackage.features || []) : [];
  pkgFeatures.forEach(f => effectiveFeatures.add(f));

  // Add-on features — handle both string arrays and object arrays
  if (tenantData.addOns) {
    tenantData.addOns.forEach(ao => {
      if (typeof ao === 'string') effectiveFeatures.add(ao);
      else if (ao && ao.slug) effectiveFeatures.add(ao.slug);
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

// ── Status toast ──

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
