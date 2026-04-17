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

  // Branding — load from settings/general if present and apply to the DOM
  try {
    const settingsSnap = await getDoc(doc(db, `tenants/${tenantData.id}/settings/general`));
    const branding = settingsSnap.exists() ? (settingsSnap.data().branding || {}) : {};
    applyBranding(branding);
  } catch (err) {
    console.warn('Load branding failed:', err);
  }
}

export const THEMES = {
  ocean_teal:      { label: 'Ocean Teal (default)',   sidebarBg: '#134e4a', sidebarFg: '#ccfbf1', accent: '#0d9488' },
  classic_dark:    { label: 'Classic Dark',           sidebarBg: '#0B0F1A', sidebarFg: '#CBD5E1', accent: '#4F7BF7' },
  red_black:       { label: 'Red / Black',            sidebarBg: '#0a0a0a', sidebarFg: '#e5e5e5', accent: '#dc2626' },
  red_white_black: { label: 'Red / White / Black',    sidebarBg: '#1a1a1a', sidebarFg: '#f5f5f5', accent: '#ef4444' },
  blue_white_grey: { label: 'Blue / White / Grey',    sidebarBg: '#475569', sidebarFg: '#f1f5f9', accent: '#3b82f6' },
  white_blue:      { label: 'White / Blue (light)',   sidebarBg: '#f8fafc', sidebarFg: '#334155', accent: '#2563eb' },
  forest:          { label: 'Forest Green',           sidebarBg: '#14532d', sidebarFg: '#dcfce7', accent: '#16a34a' },
  sunset:          { label: 'Sunset Orange',          sidebarBg: '#7c2d12', sidebarFg: '#fed7aa', accent: '#f97316' },
  purple:          { label: 'Royal Purple',           sidebarBg: '#4c1d95', sidebarFg: '#ede9fe', accent: '#8b5cf6' },
  monochrome:      { label: 'Monochrome',             sidebarBg: '#262626', sidebarFg: '#d4d4d4', accent: '#737373' },
};

export function resolveColors(branding) {
  const b = branding || {};
  if (b.theme && b.theme !== 'custom' && THEMES[b.theme]) {
    const t = THEMES[b.theme];
    return { sidebarBg: t.sidebarBg, sidebarFg: t.sidebarFg, accent: t.accent };
  }
  return {
    sidebarBg: b.sidebarBg || b.primaryColor || '',
    sidebarFg: b.sidebarFg || '',
    accent: b.accent || '',
  };
}

export function applyBranding(branding) {
  const root = document.documentElement;
  const { sidebarBg, sidebarFg, accent } = resolveColors(branding);

  setOrClear(root, '--portal-sidebar-bg', sidebarBg);
  setOrClear(root, '--portal-sidebar-fg', sidebarFg);
  setOrClear(root, '--portal-sidebar-tint', accent ? hexToRgba(accent, 0.12) : '');

  if (accent) {
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-dim', hexToRgba(accent, 0.15));
    root.style.setProperty('--accent-light', lighten(accent, 0.18));
    root.style.setProperty('--accent-strong', darken(accent, 0.15));
    root.style.setProperty('--portal-accent', accent);
    root.style.setProperty('--portal-accent-dim', hexToRgba(accent, 0.1));
    root.style.setProperty('--portal-accent-dark', darken(accent, 0.15));
  } else {
    ['--accent', '--accent-dim', '--accent-light', '--accent-strong',
     '--portal-accent', '--portal-accent-dim', '--portal-accent-dark'
    ].forEach(v => root.style.removeProperty(v));
  }

  // Logo
  const logoUrl = (branding && branding.logoUrl) || '';
  const logoContainer = document.querySelector('.portal-sidebar .sidebar-logo');
  if (logoContainer) {
    const existingImg = logoContainer.querySelector('.branded-logo');
    const existingSvg = logoContainer.querySelector('svg');
    if (logoUrl) {
      if (existingImg) existingImg.src = logoUrl;
      else {
        const img = document.createElement('img');
        img.className = 'branded-logo';
        img.alt = 'Logo';
        img.src = logoUrl;
        img.style.cssText = 'width:32px;height:32px;object-fit:contain;flex-shrink:0;border-radius:4px;';
        if (existingSvg) existingSvg.style.display = 'none';
        logoContainer.insertBefore(img, logoContainer.firstChild);
      }
    } else {
      if (existingImg) existingImg.remove();
      if (existingSvg) existingSvg.style.display = '';
    }
  }
}

function setOrClear(root, varName, value) {
  if (value) root.style.setProperty(varName, value);
  else root.style.removeProperty(varName);
}

function hexToRgb(hex) {
  const h = (hex || '').trim().replace(/^#/, '');
  if (!(h.length === 3 || h.length === 6)) return { r: 0, g: 0, b: 0 };
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function rgbToHex(r, g, b) {
  const cl = v => Math.max(0, Math.min(255, Math.round(v)));
  return '#' + [cl(r), cl(g), cl(b)].map(v => v.toString(16).padStart(2, '0')).join('');
}

function hexToRgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function lighten(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}

function darken(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
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
