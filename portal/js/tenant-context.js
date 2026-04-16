import { db, auth } from './config.js';
import {
  collection, getDocs, getDoc, doc, setDoc, updateDoc, deleteDoc, serverTimestamp
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

  // Step 1: Check if user already has a direct tenant user doc
  // (returning users who have been linked before)
  const lastTenantId = localStorage.getItem('portal_tenant_id');
  if (lastTenantId) {
    try {
      const userDoc = await getDoc(doc(db, 'tenants', lastTenantId, 'users', user.uid));
      if (userDoc.exists()) {
        const tenantDoc = await getDoc(doc(db, 'tenants', lastTenantId));
        if (tenantDoc.exists()) {
          const tenantData = { id: tenantDoc.id, ...tenantDoc.data(), userRole: userDoc.data().role };
          await selectTenant(tenantData);
          return { tenants: [tenantData], selected: tenantData };
        }
      }
    } catch (err) {
      // Permission denied or doc doesn't exist — continue to lookup
    }
  }

  // Step 2: Look up tenant by email via user_tenants mapping
  if (!user.email) throw new Error('NO_TENANT');

  const emailKey = user.email.toLowerCase().trim();
  let mapping = null;
  try {
    const mappingDoc = await getDoc(doc(db, 'user_tenants', emailKey));
    if (mappingDoc.exists()) {
      mapping = mappingDoc.data();
    }
  } catch (err) {
    console.error('Failed to read user_tenants mapping:', err);
  }

  if (!mapping || !mapping.tenantId) {
    throw new Error('NO_TENANT');
  }

  // Step 3: Create the user doc in the tenant (self-registration)
  const tenantId = mapping.tenantId;
  try {
    // Check if user doc already exists
    let userDoc = null;
    try {
      const existingDoc = await getDoc(doc(db, 'tenants', tenantId, 'users', user.uid));
      if (existingDoc.exists()) {
        userDoc = existingDoc.data();
      }
    } catch (e) {
      // Permission denied — user doc doesn't exist yet, we'll create it
    }

    if (!userDoc) {
      // Create user doc with the correct UID
      const newUserData = {
        email: user.email,
        displayName: user.displayName || user.email,
        role: mapping.role || 'user',
        status: 'active',
        createdAt: serverTimestamp(),
        linkedAt: serverTimestamp()
      };
      await setDoc(doc(db, 'tenants', tenantId, 'users', user.uid), newUserData);
      userDoc = newUserData;

      // Clean up placeholder user docs with matching email
      try {
        const usersSnap = await getDocs(collection(db, 'tenants', tenantId, 'users'));
        for (const uDoc of usersSnap.docs) {
          if (uDoc.id !== user.uid && uDoc.data().email && uDoc.data().email.toLowerCase() === emailKey) {
            await deleteDoc(doc(db, 'tenants', tenantId, 'users', uDoc.id));
          }
        }
      } catch (e) {
        // If cleanup fails, that's OK — the user is linked
      }

      // Update tenant ownerUserId if this user is the owner
      if (mapping.role === 'owner') {
        try {
          await updateDoc(doc(db, 'tenants', tenantId), { ownerUserId: user.uid });
        } catch (e) {
          // Non-critical
        }
      }
    }

    // Step 4: Load the tenant doc
    const tenantDoc = await getDoc(doc(db, 'tenants', tenantId));
    if (!tenantDoc.exists()) {
      throw new Error('NO_TENANT');
    }

    const tenantData = { id: tenantDoc.id, ...tenantDoc.data(), userRole: userDoc.role || mapping.role || 'user' };
    await selectTenant(tenantData);
    return { tenants: [tenantData], selected: tenantData };

  } catch (err) {
    if (err.message === 'NO_TENANT') throw err;
    console.error('Failed to link user to tenant:', err);
    throw new Error('NO_TENANT');
  }
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
  return currentTenant && !isSuspended() && !isReadOnly();
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
