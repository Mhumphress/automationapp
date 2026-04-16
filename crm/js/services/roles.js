import { db, auth } from '../config.js';
import {
  doc, getDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

let cachedRole = null;
let cachedApproved = null;

/**
 * Check if the current user has a user document in the CRM.
 * Returns false for portal-only users who don't have a CRM user doc.
 */
export async function isApprovedCrmUser() {
  if (cachedApproved !== null) return cachedApproved;

  const user = auth.currentUser;
  if (!user) { cachedApproved = false; return false; }

  try {
    const userRef = doc(db, 'users', user.uid);
    const snap = await getDoc(userRef);
    cachedApproved = snap.exists();
  } catch (err) {
    console.error('Approval check error:', err);
    cachedApproved = false;
  }

  return cachedApproved;
}

/**
 * Fetch the current user's role from Firestore.
 * Returns null if user has no CRM user document (not approved).
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
      cachedRole = null; // Not an approved CRM user
    }
  } catch (err) {
    console.error('Role fetch error:', err);
    cachedRole = null;
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
  cachedApproved = null;
}

/**
 * Bootstrap: check if current user has a CRM user document.
 * Does NOT auto-create one — only admins can add CRM users.
 * Returns true if the user is an approved CRM user, false otherwise.
 */
export async function bootstrapCurrentUser() {
  return await isApprovedCrmUser();
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
