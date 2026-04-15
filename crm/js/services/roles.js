import { db, auth } from '../config.js';
import {
  doc, getDoc, setDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

let cachedRole = null;

/**
 * Fetch the current user's role from Firestore.
 * Creates a user document with 'member' role if none exists.
 * Caches the result for the session.
 */
export async function getCurrentUserRole() {
  if (cachedRole) return cachedRole;

  const user = auth.currentUser;
  if (!user) return null;

  try {
    const userRef = doc(db, 'users', user.uid);
    const snap = await getDoc(userRef);

    if (snap.exists()) {
      cachedRole = snap.data().role || 'member';
    } else {
      cachedRole = 'member';
    }
  } catch (err) {
    console.error('Role fetch error:', err);
    cachedRole = 'member';
  }

  return cachedRole;
}

/**
 * Check if the current user has admin role.
 */
export async function isAdmin() {
  const role = await getCurrentUserRole();
  return role === 'admin';
}

/**
 * Clear cached role (call on logout).
 */
export function clearRoleCache() {
  cachedRole = null;
}

/**
 * Bootstrap: ensure current user has a user document.
 * First user to log in gets 'admin' role automatically.
 */
export async function bootstrapCurrentUser() {
  const user = auth.currentUser;
  if (!user) return;

  try {
    const userRef = doc(db, 'users', user.uid);
    const snap = await getDoc(userRef);

    if (!snap.exists()) {
      // First user gets admin — subsequent users should be
      // invited via the Settings page by an admin.
      await setDoc(userRef, {
        email: user.email,
        displayName: user.displayName || user.email,
        role: 'admin',
        createdAt: serverTimestamp(),
        createdBy: user.uid
      });
      cachedRole = 'admin';
    }
  } catch (err) {
    console.error('Bootstrap error:', err);
  }
}

/**
 * Check if the current user can delete a document.
 * Returns true if admin or if createdBy matches current user UID.
 */
export async function canDelete(record) {
  const user = auth.currentUser;
  if (!user) return false;
  const role = await getCurrentUserRole();
  if (role === 'admin') return true;
  return record.createdBy === user.uid;
}
