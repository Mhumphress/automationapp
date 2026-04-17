import { db } from '../config.js';
import { doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const BRANDING_DOC = 'settings/branding';

export async function loadBranding() {
  try {
    const snap = await getDoc(doc(db, BRANDING_DOC));
    return snap.exists() ? snap.data() : {};
  } catch (err) {
    console.warn('Load CRM branding failed:', err);
    return {};
  }
}

export async function saveBranding({ primaryColor, logoUrl }) {
  return setDoc(
    doc(db, BRANDING_DOC),
    { primaryColor: primaryColor || '', logoUrl: logoUrl || '', updatedAt: serverTimestamp() },
    { merge: true }
  );
}

export function applyBranding(branding) {
  const root = document.documentElement;
  const color = (branding && branding.primaryColor) || '';
  const logoUrl = (branding && branding.logoUrl) || '';

  if (color) root.style.setProperty('--crm-sidebar-bg', color);
  else root.style.removeProperty('--crm-sidebar-bg');

  // Replace sidebar SVG with img if logoUrl is provided
  const logoContainer = document.querySelector('.sidebar-logo');
  if (!logoContainer) return;
  const existingImg = logoContainer.querySelector('.branded-logo');
  const existingSvg = logoContainer.querySelector('svg');
  if (logoUrl) {
    if (existingImg) {
      existingImg.src = logoUrl;
    } else {
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
