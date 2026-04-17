import { db } from '../config.js';
import { doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const BRANDING_DOC = 'settings/branding';

export const THEMES = {
  classic_dark:    { label: 'Classic Dark (default)', sidebarBg: '#0B0F1A', sidebarFg: '#CBD5E1', accent: '#4F7BF7' },
  red_black:       { label: 'Red / Black',            sidebarBg: '#0a0a0a', sidebarFg: '#e5e5e5', accent: '#dc2626' },
  red_white_black: { label: 'Red / White / Black',    sidebarBg: '#1a1a1a', sidebarFg: '#f5f5f5', accent: '#ef4444' },
  blue_white_grey: { label: 'Blue / White / Grey',    sidebarBg: '#475569', sidebarFg: '#f1f5f9', accent: '#3b82f6' },
  white_blue:      { label: 'White / Blue (light)',   sidebarBg: '#f8fafc', sidebarFg: '#334155', accent: '#2563eb' },
  ocean_teal:      { label: 'Ocean Teal',             sidebarBg: '#134e4a', sidebarFg: '#ccfbf1', accent: '#0d9488' },
  forest:          { label: 'Forest Green',           sidebarBg: '#14532d', sidebarFg: '#dcfce7', accent: '#16a34a' },
  sunset:          { label: 'Sunset Orange',          sidebarBg: '#7c2d12', sidebarFg: '#fed7aa', accent: '#f97316' },
  purple:          { label: 'Royal Purple',           sidebarBg: '#4c1d95', sidebarFg: '#ede9fe', accent: '#8b5cf6' },
  monochrome:      { label: 'Monochrome',             sidebarBg: '#262626', sidebarFg: '#d4d4d4', accent: '#737373' },
};

export async function loadBranding() {
  try {
    const snap = await getDoc(doc(db, BRANDING_DOC));
    return snap.exists() ? snap.data() : {};
  } catch (err) {
    console.warn('Load CRM branding failed:', err);
    return {};
  }
}

export async function saveBranding(data) {
  return setDoc(
    doc(db, BRANDING_DOC),
    { ...data, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

// Resolve a branding doc into the three concrete colors, honoring theme presets.
export function resolveColors(branding) {
  const b = branding || {};
  if (b.theme && b.theme !== 'custom' && THEMES[b.theme]) {
    const t = THEMES[b.theme];
    return { sidebarBg: t.sidebarBg, sidebarFg: t.sidebarFg, accent: t.accent };
  }
  // Custom (or unspecified): fall back to individually-saved values.
  return {
    sidebarBg: b.sidebarBg || b.primaryColor || '',
    sidebarFg: b.sidebarFg || '',
    accent: b.accent || '',
  };
}

export function applyBranding(branding) {
  const root = document.documentElement;
  const { sidebarBg, sidebarFg, accent } = resolveColors(branding);

  setOrClear(root, '--crm-sidebar-bg', sidebarBg);
  setOrClear(root, '--crm-sidebar-fg', sidebarFg);

  if (accent) {
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-dim', hexToRgba(accent, 0.15));
    root.style.setProperty('--accent-light', lighten(accent, 0.18));
    root.style.setProperty('--accent-strong', darken(accent, 0.15));
  } else {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-dim');
    root.style.removeProperty('--accent-light');
    root.style.removeProperty('--accent-strong');
  }

  // Logo
  const logoUrl = (branding && branding.logoUrl) || '';
  const logoContainer = document.querySelector('.sidebar-logo');
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

function hexToRgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
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

function lighten(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}

function darken(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}
