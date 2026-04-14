# CRM Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the CRM application against unauthorized data access, XSS, clickjacking, and auth bypass by fixing Firestore rules, adding security headers, enforcing auth in the router, and implementing a role-based access system.

**Architecture:** The CRM is a vanilla JS SPA (hash-router) hosted on Cloudflare Pages with Firebase Auth + Firestore backend. All security enforcement currently relies on a single `isAuth()` check in Firestore rules, which is insufficient — anyone who creates a Firebase account using the public API key can read/write all data. We'll add an approved-user gate, role-based permissions, security headers, and client-side guards.

**Tech Stack:** Firebase Auth, Firestore Security Rules, Cloudflare Pages `_headers`, vanilla JavaScript ES6 modules

---

### Task 1: Harden Firestore Security Rules

**Files:**
- Modify: `crm/firestore.rules`

This is the highest-priority fix. Currently every collection uses `allow read, write: if isAuth()` which means any Firebase-authenticated user (including someone who self-registers via the public API key) can access all CRM data.

The fix introduces:
1. An `isApprovedUser()` gate — users must have a document in the `users` collection (which only admins can create for others)
2. Role-based write rules — admins can do anything, members can create and edit, only admins/creators can delete
3. Subcollection rules inherit from parent document access

- [ ] **Step 1: Replace `crm/firestore.rules` with hardened rules**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ── Helper functions ─────────────────────

    function isAuth() {
      return request.auth != null;
    }

    function isApprovedUser() {
      return isAuth() &&
        exists(/databases/$(database)/documents/users/$(request.auth.uid));
    }

    function isAdmin() {
      return isApprovedUser() &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }

    function isOwner() {
      return resource.data.createdBy == request.auth.uid;
    }

    // ── Users ────────────────────────────────
    // Users can read their own doc; admins can read all.
    // Only the user themselves or admins can write.
    match /users/{userId} {
      allow read: if isApprovedUser();
      allow create: if isAdmin() || request.auth.uid == userId;
      allow update: if request.auth.uid == userId || isAdmin();
      allow delete: if isAdmin();
    }

    // ── CRM Data Collections ─────────────────
    // Approved users can read all CRM data (shared team CRM).
    // Approved users can create and update.
    // Only admins or the creator can delete.

    match /contacts/{contactId} {
      allow read: if isApprovedUser();
      allow create: if isApprovedUser();
      allow update: if isApprovedUser();
      allow delete: if isAdmin() || (isApprovedUser() && isOwner());

      match /activity/{activityId} {
        allow read: if isApprovedUser();
        allow create: if isApprovedUser();
        allow update, delete: if false;
      }
    }

    match /companies/{companyId} {
      allow read: if isApprovedUser();
      allow create: if isApprovedUser();
      allow update: if isApprovedUser();
      allow delete: if isAdmin() || (isApprovedUser() && isOwner());
    }

    match /deals/{dealId} {
      allow read: if isApprovedUser();
      allow create: if isApprovedUser();
      allow update: if isApprovedUser();
      allow delete: if isAdmin() || (isApprovedUser() && isOwner());

      match /activity/{activityId} {
        allow read: if isApprovedUser();
        allow create: if isApprovedUser();
        allow update, delete: if false;
      }
    }

    match /tasks/{taskId} {
      allow read: if isApprovedUser();
      allow create: if isApprovedUser();
      allow update: if isApprovedUser();
      allow delete: if isAdmin() || (isApprovedUser() && isOwner());

      match /activity/{activityId} {
        allow read: if isApprovedUser();
        allow create: if isApprovedUser();
        allow update, delete: if false;
      }
    }

    match /invoices/{invoiceId} {
      allow read: if isApprovedUser();
      allow create: if isApprovedUser();
      allow update: if isApprovedUser();
      allow delete: if isAdmin() || (isApprovedUser() && isOwner());

      match /activity/{activityId} {
        allow read: if isApprovedUser();
        allow create: if isApprovedUser();
        allow update, delete: if false;
      }
    }

    match /subscriptions/{subId} {
      allow read: if isApprovedUser();
      allow create: if isApprovedUser();
      allow update: if isApprovedUser();
      allow delete: if isAdmin() || (isApprovedUser() && isOwner());

      match /activity/{activityId} {
        allow read: if isApprovedUser();
        allow create: if isApprovedUser();
        allow update, delete: if false;
      }

      match /payments/{paymentId} {
        allow read: if isApprovedUser();
        allow create: if isApprovedUser();
        allow update: if isApprovedUser();
        allow delete: if isAdmin();
      }
    }

    match /internal_subs/{id} {
      allow read: if isApprovedUser();
      allow create: if isApprovedUser();
      allow update: if isApprovedUser();
      allow delete: if isAdmin() || (isApprovedUser() && isOwner());
    }

    match /notes/{noteId} {
      allow read: if isApprovedUser();
      allow create: if isApprovedUser();
      allow update: if isApprovedUser();
      allow delete: if isAdmin() || (isApprovedUser() && isOwner());
    }

    match /payments/{paymentId} {
      allow read: if isApprovedUser();
      allow create: if isApprovedUser();
      allow update: if isApprovedUser();
      allow delete: if isAdmin();
    }

    match /messages/{messageId} {
      allow read: if isApprovedUser();
      allow create: if isApprovedUser();
      allow update: if isApprovedUser();
      allow delete: if isAdmin() || (isApprovedUser() && isOwner());
    }

    // ── Settings ─────────────────────────────
    // All approved users can read settings. Only admins can write.
    match /settings/{settingId} {
      allow read: if isApprovedUser();
      allow write: if isAdmin();
    }
  }
}
```

- [ ] **Step 2: Deploy the rules to Firebase**

Run:
```bash
cd crm && npx firebase deploy --only firestore:rules
```

If Firebase CLI is not installed or the project isn't linked:
```bash
npm install -g firebase-tools
firebase login
firebase use automation-app-crm
firebase deploy --only firestore:rules
```

- [ ] **Step 3: Ensure current user has an approved user document**

In the Firebase Console (or via a one-time script), ensure that `users/{your-uid}` exists with `role: 'admin'`. Without this, the new `isApprovedUser()` gate will lock you out.

If needed, temporarily add a bootstrap rule or use the Firebase Console to create the document manually before deploying.

- [ ] **Step 4: Commit**

```bash
git add crm/firestore.rules
git commit -m "security: harden Firestore rules with approved-user gate and role-based delete"
```

---

### Task 2: Add Cloudflare Pages Security Headers

**Files:**
- Create: `crm/_headers`

Cloudflare Pages reads a `_headers` file in the output directory to apply HTTP response headers. This adds protections against clickjacking, MIME sniffing, and other common attacks.

- [ ] **Step 1: Create `crm/_headers`**

```
/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains

/crm/*
  Content-Security-Policy: default-src 'self'; script-src 'self' https://www.gstatic.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://identitytoolkit.googleapis.com; img-src 'self' data:; frame-ancestors 'none'
```

- [ ] **Step 2: Commit**

```bash
git add crm/_headers
git commit -m "security: add Cloudflare Pages security headers (CSP, HSTS, X-Frame)"
```

---

### Task 3: Harden Router with Auth Re-validation

**Files:**
- Modify: `crm/js/router.js`

The hash-based router doesn't re-check auth state on navigation. If `auth.currentUser` becomes null mid-session (token expiry, manual cookie deletion), the user stays on the page. Add an auth check to every navigation.

- [ ] **Step 1: Update `crm/js/router.js` to accept and check auth**

Import auth and add a check in `navigate()`:

```javascript
// At the top of router.js, add:
import { auth } from './config.js';

// In the navigate() function, add as the first lines inside the function body:
  if (!auth.currentUser) {
    window.location.replace('login.html');
    return;
  }
```

- [ ] **Step 2: Commit**

```bash
git add crm/js/router.js
git commit -m "security: add auth guard to router navigation"
```

---

### Task 4: Implement Client-Side Role System

**Files:**
- Create: `crm/js/services/roles.js` — role fetching/caching
- Modify: `crm/app.html` — fetch and display actual role, expose role to views
- Modify: `crm/js/services/firestore.js` — add helper for user document creation

This task adds a client-side role system so the UI can show/hide features based on role. The source of truth is the `users/{uid}` Firestore document with a `role` field (`admin` or `member`).

- [ ] **Step 1: Create `crm/js/services/roles.js`**

```javascript
import { db, auth } from '../config.js';
import { doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

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

  const userRef = doc(db, 'users', user.uid);
  const snap = await getDoc(userRef);

  if (snap.exists()) {
    cachedRole = snap.data().role || 'member';
  } else {
    // First login — create user document as member
    await setDoc(userRef, {
      email: user.email,
      displayName: user.displayName || user.email,
      role: 'member',
      createdAt: serverTimestamp(),
      createdBy: user.uid
    });
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
```

- [ ] **Step 2: Update `crm/app.html` auth block to fetch and display actual role**

In the `onAuthStateChanged` callback (around line 233), after setting the display name, add role fetching:

```javascript
// Add import at the top of the <script type="module"> block:
import { getCurrentUserRole, clearRoleCache } from './js/services/roles.js';

// Inside onAuthStateChanged, after line 251 (setting userRole text):
// Replace:  document.getElementById('userRole').textContent = 'member';
// With:
getCurrentUserRole().then(role => {
  document.getElementById('userRole').textContent = role || 'member';
});
```

In the logout handler, add `clearRoleCache()` before `signOut`:

```javascript
document.getElementById('logoutBtn').addEventListener('click', async () => {
  try {
    clearRoleCache();
    await signOut(auth);
  } catch (err) {
    showToast('Sign out failed. Please try again.', 'error');
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add crm/js/services/roles.js crm/app.html
git commit -m "feat: add client-side role system with Firestore user documents"
```

---

### Task 5: Wire Up Delete Protection in Views

**Files:**
- Modify: `crm/js/views/contacts.js`
- Modify: `crm/js/views/pipeline.js`
- Modify: `crm/js/views/tasks.js`
- Modify: `crm/js/views/invoices.js`
- Modify: `crm/js/views/subscriptions.js`

With the Firestore rules now enforcing that only admins or creators can delete, the client-side should also check before showing delete buttons. This prevents confusing "permission denied" errors.

- [ ] **Step 1: Add a shared delete-guard helper to `crm/js/services/roles.js`**

Append to the existing file:

```javascript
/**
 * Check if the current user can delete a document.
 * Returns true if admin or if createdBy matches current user UID.
 */
export async function canDelete(doc) {
  const user = auth.currentUser;
  if (!user) return false;
  const role = await getCurrentUserRole();
  if (role === 'admin') return true;
  return doc.createdBy === user.uid;
}
```

- [ ] **Step 2: In each view that renders delete buttons, import `canDelete` and conditionally show/hide the button**

Each view file needs:
```javascript
import { canDelete } from '../services/roles.js';
```

Then wrap delete button rendering with an `await canDelete(record)` check. If false, either hide the button or show it disabled.

The exact locations vary per view — search for `delete` or `Delete` in each view file and wrap with the guard.

- [ ] **Step 3: Commit**

```bash
git add crm/js/services/roles.js crm/js/views/*.js
git commit -m "feat: hide delete buttons for non-admin non-owner users"
```

---

### Task 6: Add Admin User Management UI

**Files:**
- Create: `crm/js/views/settings.js` — settings view with user management
- Modify: `crm/app.html` — add Settings nav item and view container, register view

This adds a Settings page (admin-only) where admins can see all users and change roles. This is essential for the role system to be usable.

- [ ] **Step 1: Add Settings nav item to sidebar in `crm/app.html`**

After the Messages nav button, add a new section:

```html
<!-- Admin -->
<div class="nav-section-label" id="adminNavSection" style="display:none;">Admin</div>
<button class="nav-item" data-view="settings" id="settingsNavItem" style="display:none;">
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
  Settings
</button>
```

- [ ] **Step 2: Add view container in `<main>` section**

```html
<!-- Settings -->
<div id="view-settings" class="view-container"></div>
```

- [ ] **Step 3: Create `crm/js/views/settings.js` with user management**

```javascript
import { db, auth } from '../config.js';
import { collection, getDocs, doc, updateDoc, query, orderBy } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { isAdmin } from '../services/roles.js';
import { showToast, escapeHtml } from '../ui.js';

const containerId = 'view-settings';
let isAdminUser = false;

export async function init() {}

export async function render() {
  isAdminUser = await isAdmin();
  const container = document.getElementById(containerId);

  if (!isAdminUser) {
    container.innerHTML = '<div class="empty-state"><div class="empty-title">Access Denied</div><p class="empty-description">Only administrators can access settings.</p></div>';
    return;
  }

  container.innerHTML = '<div class="loading">Loading users...</div>';

  try {
    const snap = await getDocs(query(collection(db, 'users'), orderBy('createdAt', 'desc')));
    const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    let html = '<div class="settings-section"><h2 class="section-title">User Management</h2>';
    html += '<table class="data-table"><thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Actions</th></tr></thead><tbody>';

    users.forEach(u => {
      const isSelf = u.id === auth.currentUser.uid;
      html += `<tr data-uid="${u.id}">
        <td>${escapeHtml(u.email || '')}</td>
        <td>${escapeHtml(u.displayName || '')}</td>
        <td>
          <select class="role-select" data-uid="${u.id}" ${isSelf ? 'disabled title="Cannot change your own role"' : ''}>
            <option value="member" ${u.role === 'member' ? 'selected' : ''}>Member</option>
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
          </select>
        </td>
        <td>${isSelf ? '<span class="badge badge-info">You</span>' : ''}</td>
      </tr>`;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;

    // Wire up role change handlers
    container.querySelectorAll('.role-select').forEach(select => {
      select.addEventListener('change', async (e) => {
        const uid = e.target.dataset.uid;
        const newRole = e.target.value;
        try {
          await updateDoc(doc(db, 'users', uid), { role: newRole });
          showToast(`Role updated to ${newRole}`, 'success');
        } catch (err) {
          showToast('Failed to update role', 'error');
          console.error(err);
        }
      });
    });
  } catch (err) {
    container.innerHTML = '<div class="empty-state"><div class="empty-title">Error</div><p class="empty-description">Failed to load users.</p></div>';
    console.error(err);
  }
}

export function destroy() {}
```

- [ ] **Step 4: Register the settings view in `crm/app.html`**

Add to the imports:
```javascript
import * as settingsView from './js/views/settings.js';
```

Add to `viewTitles`:
```javascript
settings: 'Settings',
```

Register the view:
```javascript
registerView('settings', {
  init: settingsView.init,
  render() {
    document.getElementById('headerTitle').textContent = 'Settings';
    settingsView.render();
  },
  destroy: settingsView.destroy
});
```

Show the admin nav items after role check:
```javascript
getCurrentUserRole().then(role => {
  document.getElementById('userRole').textContent = role || 'member';
  if (role === 'admin') {
    document.getElementById('adminNavSection').style.display = '';
    document.getElementById('settingsNavItem').style.display = '';
  }
});
```

- [ ] **Step 5: Commit**

```bash
git add crm/js/views/settings.js crm/app.html
git commit -m "feat: add admin settings page with user role management"
```

---

### Task 7: Ensure Current Admin User Document Exists

**Files:**
- Modify: `crm/js/services/roles.js`

When the new Firestore rules go live, the `isApprovedUser()` function checks for the existence of a `users/{uid}` document. If the current user (Michael) doesn't have one, he'll be locked out. The `getCurrentUserRole()` function in Task 4 already creates a user doc on first login, but the first user needs to be bootstrapped as admin.

- [ ] **Step 1: Add a bootstrap function to `crm/js/services/roles.js`**

```javascript
/**
 * Bootstrap: ensure current user has a user document.
 * If no users collection docs exist yet, make the first user an admin.
 */
export async function bootstrapCurrentUser() {
  const user = auth.currentUser;
  if (!user) return;

  const userRef = doc(db, 'users', user.uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) {
    // Check if any users exist
    const { getDocs: gd, collection: col, limit: lim, query: q2 } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const existing = await gd(q2(col(db, 'users'), lim(1)));
    const role = existing.empty ? 'admin' : 'member';

    await setDoc(userRef, {
      email: user.email,
      displayName: user.displayName || user.email,
      role,
      createdAt: serverTimestamp(),
      createdBy: user.uid
    });

    cachedRole = role;
  }
}
```

- [ ] **Step 2: Call `bootstrapCurrentUser()` in the auth state change handler in `crm/app.html`**

Inside the `onAuthStateChanged` callback, after checking user exists:
```javascript
import { getCurrentUserRole, clearRoleCache, bootstrapCurrentUser } from './js/services/roles.js';

// Inside onAuthStateChanged, right after the null check:
await bootstrapCurrentUser();
```

Note: The `onAuthStateChanged` callback needs to become `async`:
```javascript
onAuthStateChanged(auth, async (user) => {
```

- [ ] **Step 3: Commit**

```bash
git add crm/js/services/roles.js crm/app.html
git commit -m "security: add admin bootstrap for first user on fresh deployment"
```

---

## Summary of Changes

| File | Action | Purpose |
|------|--------|---------|
| `crm/firestore.rules` | Modify | Approved-user gate, role-based delete, immutable activity logs |
| `crm/_headers` | Create | CSP, HSTS, X-Frame-Options, MIME sniffing protection |
| `crm/js/router.js` | Modify | Auth guard on every navigation |
| `crm/js/services/roles.js` | Create | Role fetching, caching, admin check, delete guard, bootstrap |
| `crm/js/views/settings.js` | Create | Admin user management UI |
| `crm/app.html` | Modify | Settings nav, role display, bootstrap call, view registration |

## Deployment Order

1. **Before deploying new Firestore rules**: Ensure your `users/{uid}` document exists with `role: 'admin'` in Firebase Console
2. Deploy rules
3. Deploy client-side code (Cloudflare Pages auto-deploys on push)
4. Verify you can still access the app
5. Test that a non-approved user gets denied
