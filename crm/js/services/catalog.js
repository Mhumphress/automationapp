import { db } from '../config.js';
import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// All queries use simple getDocs (no orderBy, no where) to avoid
// needing Firestore composite indexes. Sorting and filtering is
// done client-side since catalog data is small.

// ── Verticals ───────────────────────────

export async function getVerticals() {
  const snap = await getDocs(collection(db, 'verticals'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

export async function getVertical(slug) {
  const snap = await getDoc(doc(db, 'verticals', slug));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function setVertical(slug, data) {
  return setDoc(doc(db, 'verticals', slug), { ...data, updatedAt: serverTimestamp() }, { merge: true });
}

// ── Features ────────────────────────────

export async function getFeatures() {
  const snap = await getDocs(collection(db, 'features'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

export async function getFeaturesByVertical(verticalSlug) {
  const all = await getFeatures();
  return all.filter(f => f.verticals && f.verticals.includes(verticalSlug));
}

export async function setFeature(slug, data) {
  return setDoc(doc(db, 'features', slug), { ...data, updatedAt: serverTimestamp() }, { merge: true });
}

export async function deleteFeature(slug) {
  return deleteDoc(doc(db, 'features', slug));
}

// ── Packages ────────────────────────────

export async function getPackages() {
  const snap = await getDocs(collection(db, 'packages'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
}

export async function getPackagesByVertical(verticalSlug) {
  const all = await getPackages();
  return all.filter(p => p.vertical === verticalSlug);
}

export async function getPackage(packageId) {
  const snap = await getDoc(doc(db, 'packages', packageId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function setPackage(packageId, data) {
  return setDoc(doc(db, 'packages', packageId), { ...data, updatedAt: serverTimestamp() }, { merge: true });
}

export async function deletePackage(packageId) {
  return deleteDoc(doc(db, 'packages', packageId));
}

// ── Add-ons ─────────────────────────────

export async function getAddons() {
  const snap = await getDocs(collection(db, 'addons'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

export async function setAddon(slug, data) {
  return setDoc(doc(db, 'addons', slug), { ...data, updatedAt: serverTimestamp() }, { merge: true });
}

export async function deleteAddon(slug) {
  return deleteDoc(doc(db, 'addons', slug));
}

// ── System Settings ─────────────────────

export async function getBillingSettings() {
  const snap = await getDoc(doc(db, 'settings', 'billing'));
  if (!snap.exists()) return null;
  return snap.data();
}

export async function setBillingSettings(data) {
  return setDoc(doc(db, 'settings', 'billing'), { ...data, updatedAt: serverTimestamp() }, { merge: true });
}
