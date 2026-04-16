import { db } from '../config.js';
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, orderBy, where, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ── Verticals ───────────────────────────

export async function getVerticals() {
  const q = query(collection(db, 'verticals'), orderBy('name', 'asc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
  const q = query(collection(db, 'features'), orderBy('name', 'asc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getFeaturesByVertical(verticalSlug) {
  const q = query(collection(db, 'features'), where('verticals', 'array-contains', verticalSlug));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function setFeature(slug, data) {
  return setDoc(doc(db, 'features', slug), { ...data, updatedAt: serverTimestamp() }, { merge: true });
}

export async function deleteFeature(slug) {
  return deleteDoc(doc(db, 'features', slug));
}

// ── Packages ────────────────────────────

export async function getPackages() {
  const q = query(collection(db, 'packages'), orderBy('sortOrder', 'asc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getPackagesByVertical(verticalSlug) {
  const q = query(
    collection(db, 'packages'),
    where('vertical', '==', verticalSlug),
    orderBy('sortOrder', 'asc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
  const q = query(collection(db, 'addons'), orderBy('name', 'asc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
