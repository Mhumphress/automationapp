# CRM Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the CRM foundation — Firebase backend, authentication, app shell with sidebar navigation, and dashboard overview — so all subsequent feature modules plug into a working frame.

**Architecture:** Single-page app pattern using vanilla HTML/CSS/JS with Firebase (Firestore + Auth). One `login.html` for authentication, one `app.html` as the main shell with client-side view routing. Shared CSS design system matching the main Automation App site (blue/grey/white/black palette). PWA-ready structure.

**Tech Stack:** Vanilla JS (ES modules), Firebase v10 SDK (CDN), Firestore, Firebase Auth (email/password), CSS custom properties, no build tools.

---

## File Structure

```
crm/
├── login.html              # Auth page (login + register)
├── app.html                # Main CRM shell (all views render here)
├── css/
│   ├── variables.css       # Design tokens shared across CRM
│   ├── auth.css            # Login/register page styles
│   └── app.css             # App shell + dashboard styles
├── js/
│   ├── config.js           # Firebase config + initialization
│   ├── auth.js             # Login/register/logout logic
│   ├── router.js           # Client-side view switching
│   ├── dashboard.js        # Dashboard view (summary cards, recent activity)
│   └── ui.js               # Shared UI helpers (toasts, modals, formatters)
└── firestore.rules         # Firestore security rules (deploy later)
```

---

### Task 0: Firebase Project Setup (User Action)

**Files:** None (browser-based setup)

This task requires the user to perform actions in the Firebase console. The engineer should guide them through each step and collect the config values.

- [ ] **Step 0.1: Create Firebase project**

Go to https://console.firebase.google.com/ and click "Create a project."
- Project name: `automation-app-crm`
- Disable Google Analytics (not needed now, add later)
- Click "Create project"

- [ ] **Step 0.2: Enable Authentication**

In the Firebase console sidebar:
1. Click "Authentication" > "Get started"
2. Click "Email/Password" provider
3. Enable "Email/Password" (toggle ON)
4. Leave "Email link" OFF
5. Click "Save"

- [ ] **Step 0.3: Create Firestore Database**

In the sidebar:
1. Click "Firestore Database" > "Create database"
2. Select "Start in test mode" (we'll add rules in Task 5)
3. Choose the closest region (e.g. `us-east1`)
4. Click "Create"

- [ ] **Step 0.4: Register Web App and get config**

1. Click the gear icon > "Project settings"
2. Scroll to "Your apps" > Click the web icon (`</>`)
3. App nickname: `crm-web`
4. Do NOT check "Firebase Hosting"
5. Click "Register app"
6. Copy the `firebaseConfig` object — we need it for Task 1

The config looks like:
```javascript
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "automation-app-crm.firebaseapp.com",
  projectId: "automation-app-crm",
  storageBucket: "automation-app-crm.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

- [ ] **Step 0.5: Create first admin user**

In Firebase console > Authentication > Users tab:
1. Click "Add user"
2. Enter your email and a strong password
3. Click "Add user"
4. Copy the UID — we'll use it in security rules

---

### Task 1: Firebase Config Module

**Files:**
- Create: `crm/js/config.js`

- [ ] **Step 1.1: Create the config file**

```javascript
// crm/js/config.js
// Firebase configuration and initialization
// Replace the placeholder values with your actual Firebase config

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
```

- [ ] **Step 1.2: Replace placeholders with actual Firebase config**

Paste the real values from Step 0.4 into the config object.

- [ ] **Step 1.3: Verify — open browser console**

Create a temporary test page or use the login page (Task 3) to verify Firebase loads without errors. The browser console should show no errors when importing this module.

---

### Task 2: Design System CSS

**Files:**
- Create: `crm/css/variables.css`

- [ ] **Step 2.1: Create shared design tokens**

```css
/* crm/css/variables.css */
/* Design tokens — matches main Automation App site palette */

:root {
  /* Accent */
  --accent: #4F7BF7;
  --accent-light: #7B9FFF;
  --accent-dim: rgba(79,123,247,0.15);
  --accent-strong: #3A5FD9;

  /* Neutrals */
  --black: #0B0F1A;
  --off-black: #111827;
  --dark: #1A2332;
  --dark-2: #1E293B;
  --dark-3: #334155;
  --white: #F8FAFC;
  --off-white: #EEF2F7;
  --gray: #8892A8;
  --gray-light: #CBD5E1;
  --gray-dark: #64748B;

  /* Semantic */
  --success: #34D399;
  --success-dim: rgba(52,211,153,0.15);
  --warning: #FBBF24;
  --warning-dim: rgba(251,191,36,0.15);
  --danger: #F87171;
  --danger-dim: rgba(248,113,113,0.15);
  --info: #60A5FA;
  --info-dim: rgba(96,165,250,0.15);

  /* Typography */
  --font-display: 'Cormorant Garamond', Georgia, serif;
  --font-body: 'Outfit', sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;

  /* Spacing */
  --sidebar-width: 260px;
  --header-height: 64px;
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.06);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.08);
  --shadow-lg: 0 12px 40px rgba(0,0,0,0.12);
  --shadow-glow: 0 0 20px rgba(79,123,247,0.15);

  /* Transitions */
  --ease: cubic-bezier(0.4, 0, 0.2, 1);
  --duration: 0.2s;
}
```

- [ ] **Step 2.2: Verify tokens load**

Open any HTML page that imports `variables.css` and inspect an element — confirm the CSS custom properties appear in the computed styles.

---

### Task 3: Login Page

**Files:**
- Create: `crm/css/auth.css`
- Create: `crm/login.html`
- Create: `crm/js/auth.js`

- [ ] **Step 3.1: Create auth styles**

```css
/* crm/css/auth.css */
@import url('./variables.css');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: var(--font-body);
  background: var(--black);
  color: var(--white);
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.auth-container {
  width: 100%;
  max-width: 420px;
  padding: 2rem;
  position: relative;
  z-index: 1;
}

.auth-bg {
  position: fixed;
  inset: 0;
  background:
    radial-gradient(ellipse 60% 50% at 50% 100%, rgba(79,123,247,0.08) 0%, transparent 70%),
    radial-gradient(ellipse 40% 40% at 80% 20%, rgba(79,123,247,0.04) 0%, transparent 60%);
  pointer-events: none;
}

.auth-logo {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  justify-content: center;
  margin-bottom: 3rem;
}

.auth-logo svg {
  height: 48px;
  width: auto;
  color: var(--accent);
}

.auth-logo span {
  font-family: var(--font-display);
  font-size: 1.8rem;
  font-weight: 600;
  color: var(--accent);
  letter-spacing: 0.08em;
}

.auth-card {
  background: var(--off-black);
  border: 1px solid var(--dark-2);
  border-radius: var(--radius-lg);
  padding: 2.5rem;
  box-shadow: var(--shadow-lg);
}

.auth-card h1 {
  font-family: var(--font-display);
  font-size: 1.6rem;
  font-weight: 400;
  color: var(--white);
  margin-bottom: 0.4rem;
}

.auth-card .subtitle {
  font-size: 0.85rem;
  color: var(--gray);
  font-weight: 300;
  margin-bottom: 2rem;
}

.form-group {
  margin-bottom: 1.4rem;
}

.form-group label {
  display: block;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--gray);
  margin-bottom: 0.5rem;
}

.form-group input {
  width: 100%;
  padding: 0.75rem 1rem;
  background: var(--dark);
  border: 1px solid var(--dark-3);
  border-radius: var(--radius-sm);
  color: var(--white);
  font-family: var(--font-body);
  font-size: 0.9rem;
  outline: none;
  transition: border-color var(--duration) var(--ease);
}

.form-group input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-dim);
}

.form-group input::placeholder {
  color: var(--dark-3);
}

.auth-btn {
  width: 100%;
  padding: 0.85rem;
  background: var(--accent);
  color: var(--white);
  border: none;
  border-radius: var(--radius-sm);
  font-family: var(--font-body);
  font-size: 0.82rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background var(--duration) var(--ease), transform 0.1s;
  margin-top: 0.5rem;
}

.auth-btn:hover {
  background: var(--accent-strong);
  transform: translateY(-1px);
}

.auth-btn:active {
  transform: translateY(0);
}

.auth-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.auth-toggle {
  text-align: center;
  margin-top: 1.5rem;
  font-size: 0.82rem;
  color: var(--gray);
}

.auth-toggle a {
  color: var(--accent);
  text-decoration: none;
  font-weight: 500;
  cursor: pointer;
}

.auth-toggle a:hover {
  color: var(--accent-light);
}

.auth-error {
  background: var(--danger-dim);
  border: 1px solid rgba(248,113,113,0.3);
  color: var(--danger);
  padding: 0.7rem 1rem;
  border-radius: var(--radius-sm);
  font-size: 0.82rem;
  margin-bottom: 1rem;
  display: none;
}

.auth-error.visible {
  display: block;
}

.auth-footer {
  text-align: center;
  margin-top: 2rem;
  font-size: 0.72rem;
  color: var(--dark-3);
}

.auth-footer a {
  color: var(--gray);
  text-decoration: none;
}
```

- [ ] **Step 3.2: Create login.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="icon" type="image/svg+xml" href="../logo.svg">
  <title>Login - Automation App CRM</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;600&family=Outfit:wght@300;400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="css/auth.css">
</head>
<body>

<div class="auth-bg"></div>

<div class="auth-container">
  <div class="auth-logo">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="currentColor">
      <g fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="10" y1="38" x2="24" y2="8"/><line x1="38" y1="38" x2="24" y2="8"/><line x1="15" y1="26" x2="33" y2="26"/>
      </g>
      <circle cx="24" cy="8" r="3"/><circle cx="10" cy="38" r="3"/><circle cx="38" cy="38" r="3"/>
      <circle cx="15" cy="26" r="2.5"/><circle cx="33" cy="26" r="2.5"/>
    </svg>
    <span>Automation App</span>
  </div>

  <div class="auth-card">
    <!-- Login Form -->
    <div id="loginView">
      <h1>Welcome back</h1>
      <p class="subtitle">Sign in to your CRM dashboard</p>
      <div class="auth-error" id="loginError"></div>
      <form id="loginForm">
        <div class="form-group">
          <label>Email</label>
          <input type="email" id="loginEmail" placeholder="you@company.com" required />
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" id="loginPassword" placeholder="Enter your password" required />
        </div>
        <button type="submit" class="auth-btn" id="loginBtn">Sign In</button>
      </form>
      <div class="auth-toggle">
        Don't have an account? <a id="showRegister">Create one</a>
      </div>
    </div>

    <!-- Register Form (hidden by default) -->
    <div id="registerView" style="display:none;">
      <h1>Create account</h1>
      <p class="subtitle">Set up your CRM access</p>
      <div class="auth-error" id="registerError"></div>
      <form id="registerForm">
        <div class="form-group">
          <label>Full Name</label>
          <input type="text" id="registerName" placeholder="John Smith" required />
        </div>
        <div class="form-group">
          <label>Email</label>
          <input type="email" id="registerEmail" placeholder="you@company.com" required />
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" id="registerPassword" placeholder="Min. 8 characters" minlength="8" required />
        </div>
        <button type="submit" class="auth-btn" id="registerBtn">Create Account</button>
      </form>
      <div class="auth-toggle">
        Already have an account? <a id="showLogin">Sign in</a>
      </div>
    </div>
  </div>

  <div class="auth-footer">
    <a href="../index.html">Back to Automation App</a>
  </div>
</div>

<script type="module" src="js/auth.js"></script>
</body>
</html>
```

- [ ] **Step 3.3: Create auth.js**

```javascript
// crm/js/auth.js
import { auth, db } from './config.js';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  doc,
  setDoc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// Redirect to app if already logged in
onAuthStateChanged(auth, (user) => {
  if (user) {
    window.location.href = 'app.html';
  }
});

// Toggle between login and register views
const loginView = document.getElementById('loginView');
const registerView = document.getElementById('registerView');

document.getElementById('showRegister').addEventListener('click', () => {
  loginView.style.display = 'none';
  registerView.style.display = 'block';
});

document.getElementById('showLogin').addEventListener('click', () => {
  registerView.style.display = 'none';
  loginView.style.display = 'block';
});

function showError(elementId, message) {
  const el = document.getElementById(elementId);
  el.textContent = message;
  el.classList.add('visible');
}

function clearError(elementId) {
  const el = document.getElementById(elementId);
  el.classList.remove('visible');
}

function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  btn.disabled = loading;
  btn.textContent = loading ? 'Please wait...' : (btnId === 'loginBtn' ? 'Sign In' : 'Create Account');
}

// Login
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError('loginError');
  setLoading('loginBtn', true);

  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;

  try {
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged handles redirect
  } catch (err) {
    const messages = {
      'auth/user-not-found': 'No account found with this email.',
      'auth/wrong-password': 'Incorrect password.',
      'auth/invalid-credential': 'Invalid email or password.',
      'auth/too-many-requests': 'Too many attempts. Try again later.',
    };
    showError('loginError', messages[err.code] || 'Sign in failed. Please try again.');
    setLoading('loginBtn', false);
  }
});

// Register
document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError('registerError');
  setLoading('registerBtn', true);

  const name = document.getElementById('registerName').value;
  const email = document.getElementById('registerEmail').value;
  const password = document.getElementById('registerPassword').value;

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });

    // Create user doc in Firestore
    await setDoc(doc(db, 'users', cred.user.uid), {
      name,
      email,
      role: 'member',
      createdAt: serverTimestamp()
    });

    // onAuthStateChanged handles redirect
  } catch (err) {
    const messages = {
      'auth/email-already-in-use': 'An account with this email already exists.',
      'auth/weak-password': 'Password must be at least 8 characters.',
      'auth/invalid-email': 'Please enter a valid email address.',
    };
    showError('registerError', messages[err.code] || 'Registration failed. Please try again.');
    setLoading('registerBtn', false);
  }
});
```

- [ ] **Step 3.4: Verify login page**

Open `crm/login.html` in a browser. Confirm:
1. Page renders with blue accent design, dark background
2. Can toggle between login and register forms
3. Register creates a user (check Firebase console > Authentication > Users)
4. Login redirects to `app.html` (will 404 — that's expected, built in Task 4)

- [ ] **Step 3.5: Commit**

```bash
git add crm/login.html crm/css/variables.css crm/css/auth.css crm/js/config.js crm/js/auth.js
git commit -m "feat(crm): add login page with Firebase auth"
```

---

### Task 4: App Shell

**Files:**
- Create: `crm/css/app.css`
- Create: `crm/app.html`
- Create: `crm/js/router.js`
- Create: `crm/js/ui.js`

- [ ] **Step 4.1: Create shared UI helpers**

```javascript
// crm/js/ui.js
// Shared UI utilities: toasts, modals, formatters

export function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('visible'));

  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

export function formatDate(timestamp) {
  if (!timestamp) return '—';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
}

export function timeAgo(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return formatDate(timestamp);
}

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
```

- [ ] **Step 4.2: Create client-side router**

```javascript
// crm/js/router.js
// Simple hash-based view router

const views = {};
let currentView = null;

export function registerView(name, { init, render, destroy }) {
  views[name] = { init, render, destroy, initialized: false };
}

export function navigate(viewName) {
  if (currentView === viewName) return;

  // Destroy previous view
  if (currentView && views[currentView]?.destroy) {
    views[currentView].destroy();
  }

  // Hide all view containers
  document.querySelectorAll('.view-container').forEach(el => {
    el.style.display = 'none';
  });

  // Show target view
  const container = document.getElementById(`view-${viewName}`);
  if (container) {
    container.style.display = 'block';
  }

  // Initialize if first time
  const view = views[viewName];
  if (view && !view.initialized) {
    view.init?.();
    view.initialized = true;
  }

  // Render
  view?.render?.();

  // Update active nav
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === viewName);
  });

  currentView = viewName;
  window.location.hash = viewName;
}

export function initRouter(defaultView) {
  const hash = window.location.hash.slice(1);
  navigate(hash && views[hash] ? hash : defaultView);

  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.slice(1);
    if (hash && views[hash]) navigate(hash);
  });
}
```

- [ ] **Step 4.3: Create app.css**

```css
/* crm/css/app.css */
@import url('./variables.css');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: var(--font-body);
  background: var(--off-white);
  color: var(--black);
  min-height: 100vh;
  overflow: hidden;
}

/* ── LAYOUT ── */
.app-layout {
  display: grid;
  grid-template-columns: var(--sidebar-width) 1fr;
  grid-template-rows: var(--header-height) 1fr;
  height: 100vh;
}

/* ── SIDEBAR ── */
.sidebar {
  grid-row: 1 / -1;
  background: var(--black);
  border-right: 1px solid var(--dark-2);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.sidebar-logo {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 1.2rem 1.4rem;
  border-bottom: 1px solid var(--dark-2);
  text-decoration: none;
}

.sidebar-logo svg {
  height: 30px;
  width: auto;
  color: var(--accent);
}

.sidebar-logo span {
  font-family: var(--font-display);
  font-size: 1.2rem;
  font-weight: 600;
  color: var(--accent);
  letter-spacing: 0.06em;
}

.sidebar-nav {
  flex: 1;
  padding: 1rem 0.8rem;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.nav-section-label {
  font-size: 0.6rem;
  font-weight: 600;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--dark-3);
  padding: 1.2rem 0.8rem 0.4rem;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 0.8rem;
  border-radius: var(--radius-sm);
  color: var(--gray);
  text-decoration: none;
  font-size: 0.84rem;
  font-weight: 400;
  cursor: pointer;
  transition: all var(--duration) var(--ease);
  border: none;
  background: none;
  width: 100%;
  text-align: left;
}

.nav-item:hover {
  background: var(--dark);
  color: var(--white);
}

.nav-item.active {
  background: var(--accent-dim);
  color: var(--accent);
}

.nav-item svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.nav-item .badge {
  margin-left: auto;
  background: var(--accent);
  color: var(--white);
  font-size: 0.65rem;
  font-weight: 600;
  padding: 0.1rem 0.45rem;
  border-radius: 10px;
  min-width: 18px;
  text-align: center;
}

.sidebar-footer {
  padding: 1rem 1.2rem;
  border-top: 1px solid var(--dark-2);
}

.sidebar-user {
  display: flex;
  align-items: center;
  gap: 0.7rem;
}

.sidebar-user .avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--accent-dim);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 600;
}

.sidebar-user .user-info {
  flex: 1;
  min-width: 0;
}

.sidebar-user .user-name {
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--white);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-user .user-role {
  font-size: 0.68rem;
  color: var(--gray);
}

.logout-btn {
  background: none;
  border: none;
  color: var(--gray);
  cursor: pointer;
  padding: 0.3rem;
  border-radius: var(--radius-sm);
  transition: color var(--duration);
}

.logout-btn:hover {
  color: var(--danger);
}

/* ── HEADER ── */
.app-header {
  background: var(--white);
  border-bottom: 1px solid var(--gray-light);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2rem;
}

.header-title {
  font-family: var(--font-display);
  font-size: 1.4rem;
  font-weight: 400;
  color: var(--black);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.8rem;
}

/* ── MAIN CONTENT ── */
.app-main {
  overflow-y: auto;
  padding: 2rem;
}

.view-container {
  display: none;
}

/* ── DASHBOARD CARDS ── */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1rem;
  margin-bottom: 2rem;
}

.stat-card {
  background: var(--white);
  border: 1px solid var(--gray-light);
  border-radius: var(--radius-md);
  padding: 1.5rem;
  transition: box-shadow var(--duration) var(--ease);
}

.stat-card:hover {
  box-shadow: var(--shadow-md);
}

.stat-card .stat-label {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--gray);
  margin-bottom: 0.5rem;
}

.stat-card .stat-value {
  font-size: 2rem;
  font-weight: 300;
  color: var(--black);
  line-height: 1;
  margin-bottom: 0.3rem;
}

.stat-card .stat-change {
  font-size: 0.75rem;
  font-weight: 500;
}

.stat-change.up { color: var(--success); }
.stat-change.down { color: var(--danger); }

/* ── TABLE ── */
.data-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--white);
  border: 1px solid var(--gray-light);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.data-table th {
  text-align: left;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--gray);
  padding: 0.8rem 1rem;
  background: var(--off-white);
  border-bottom: 1px solid var(--gray-light);
}

.data-table td {
  padding: 0.8rem 1rem;
  font-size: 0.88rem;
  font-weight: 300;
  color: var(--black);
  border-bottom: 1px solid var(--off-white);
}

.data-table tr:last-child td {
  border-bottom: none;
}

.data-table tr:hover td {
  background: var(--off-white);
}

/* ── STATUS BADGES ── */
.badge-status {
  display: inline-block;
  padding: 0.2rem 0.6rem;
  border-radius: 20px;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.05em;
}

.badge-status.lead { background: var(--info-dim); color: var(--info); }
.badge-status.proposal { background: var(--warning-dim); color: var(--warning); }
.badge-status.active { background: var(--success-dim); color: var(--success); }
.badge-status.complete { background: var(--accent-dim); color: var(--accent); }
.badge-status.lost { background: var(--danger-dim); color: var(--danger); }

/* ── BUTTONS ── */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.55rem 1.1rem;
  border-radius: var(--radius-sm);
  font-family: var(--font-body);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  cursor: pointer;
  border: none;
  transition: all var(--duration) var(--ease);
  text-decoration: none;
}

.btn-primary {
  background: var(--accent);
  color: var(--white);
}

.btn-primary:hover {
  background: var(--accent-strong);
  transform: translateY(-1px);
}

.btn-secondary {
  background: var(--off-white);
  color: var(--black);
  border: 1px solid var(--gray-light);
}

.btn-secondary:hover {
  background: var(--gray-light);
}

.btn-ghost {
  background: transparent;
  color: var(--gray);
}

.btn-ghost:hover {
  color: var(--black);
  background: var(--off-white);
}

.btn svg {
  width: 16px;
  height: 16px;
  stroke: currentColor;
  fill: none;
  stroke-width: 2;
}

/* ── EMPTY STATE ── */
.empty-state {
  text-align: center;
  padding: 4rem 2rem;
  color: var(--gray);
}

.empty-state svg {
  width: 64px;
  height: 64px;
  stroke: var(--gray-light);
  fill: none;
  stroke-width: 1.5;
  margin-bottom: 1rem;
}

.empty-state h3 {
  font-family: var(--font-display);
  font-size: 1.3rem;
  font-weight: 400;
  color: var(--black);
  margin-bottom: 0.4rem;
}

.empty-state p {
  font-size: 0.88rem;
  font-weight: 300;
  margin-bottom: 1.5rem;
}

/* ── TOAST ── */
#toastContainer {
  position: fixed;
  bottom: 1.5rem;
  right: 1.5rem;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.toast {
  padding: 0.75rem 1.2rem;
  border-radius: var(--radius-sm);
  font-size: 0.82rem;
  font-weight: 500;
  box-shadow: var(--shadow-lg);
  opacity: 0;
  transform: translateY(10px);
  transition: all 0.3s var(--ease);
}

.toast.visible {
  opacity: 1;
  transform: translateY(0);
}

.toast-info { background: var(--black); color: var(--white); }
.toast-success { background: var(--success); color: var(--black); }
.toast-error { background: var(--danger); color: var(--white); }

/* ── RESPONSIVE ── */
@media (max-width: 768px) {
  .app-layout {
    grid-template-columns: 1fr;
  }
  .sidebar {
    display: none;
  }
  .app-main {
    padding: 1rem;
  }
  .stats-grid {
    grid-template-columns: 1fr 1fr;
  }
}
```

- [ ] **Step 4.4: Create app.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="icon" type="image/svg+xml" href="../logo.svg">
  <title>CRM - Automation App</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;600&family=Outfit:wght@300;400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="css/app.css">
</head>
<body>

<div class="app-layout">

  <!-- SIDEBAR -->
  <aside class="sidebar">
    <a href="../index.html" class="sidebar-logo">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="currentColor">
        <g fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="10" y1="38" x2="24" y2="8"/><line x1="38" y1="38" x2="24" y2="8"/><line x1="15" y1="26" x2="33" y2="26"/>
        </g>
        <circle cx="24" cy="8" r="3"/><circle cx="10" cy="38" r="3"/><circle cx="38" cy="38" r="3"/>
        <circle cx="15" cy="26" r="2.5"/><circle cx="33" cy="26" r="2.5"/>
      </svg>
      <span>Automation App</span>
    </a>

    <nav class="sidebar-nav">
      <div class="nav-section-label">Overview</div>
      <button class="nav-item active" data-view="dashboard">
        <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
        Dashboard
      </button>

      <div class="nav-section-label">Manage</div>
      <button class="nav-item" data-view="contacts">
        <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        Contacts
      </button>
      <button class="nav-item" data-view="pipeline">
        <svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        Pipeline
      </button>
      <button class="nav-item" data-view="tasks">
        <svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        Tasks
      </button>

      <div class="nav-section-label">Finance</div>
      <button class="nav-item" data-view="invoices">
        <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        Invoices
      </button>
      <button class="nav-item" data-view="subscriptions">
        <svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9c1.66 0 3-4.03 3-9s-1.34-9-3-9m0 18c-1.66 0-3-4.03-3-9s1.34-9 3-9"/></svg>
        Subscriptions
      </button>

      <div class="nav-section-label">Client</div>
      <button class="nav-item" data-view="messages">
        <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        Messages
      </button>
    </nav>

    <div class="sidebar-footer">
      <div class="sidebar-user">
        <div class="avatar" id="userAvatar">—</div>
        <div class="user-info">
          <div class="user-name" id="userName">Loading...</div>
          <div class="user-role" id="userRole">Member</div>
        </div>
        <button class="logout-btn" id="logoutBtn" title="Sign out">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        </button>
      </div>
    </div>
  </aside>

  <!-- HEADER -->
  <header class="app-header">
    <h1 class="header-title" id="headerTitle">Dashboard</h1>
    <div class="header-actions" id="headerActions"></div>
  </header>

  <!-- MAIN CONTENT -->
  <main class="app-main">

    <!-- Dashboard View -->
    <div class="view-container" id="view-dashboard">
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Total Contacts</div>
          <div class="stat-value" id="statContacts">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Active Projects</div>
          <div class="stat-value" id="statProjects">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Open Tasks</div>
          <div class="stat-value" id="statTasks">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Revenue (MTD)</div>
          <div class="stat-value" id="statRevenue">$0</div>
        </div>
      </div>

      <div class="empty-state" id="dashboardEmpty">
        <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>
        </svg>
        <h3>Welcome to your CRM</h3>
        <p>Start by adding your first contact or creating a pipeline deal.</p>
        <button class="btn btn-primary" onclick="window.location.hash='contacts'">Add First Contact</button>
      </div>
    </div>

    <!-- Placeholder views for other modules -->
    <div class="view-container" id="view-contacts">
      <div class="empty-state">
        <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
        <h3>Contacts</h3>
        <p>Contact management coming in Phase 2.</p>
      </div>
    </div>

    <div class="view-container" id="view-pipeline">
      <div class="empty-state">
        <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        <h3>Pipeline</h3>
        <p>Deal pipeline coming in Phase 2.</p>
      </div>
    </div>

    <div class="view-container" id="view-tasks">
      <div class="empty-state">
        <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        <h3>Tasks</h3>
        <p>Task management coming in Phase 3.</p>
      </div>
    </div>

    <div class="view-container" id="view-invoices">
      <div class="empty-state">
        <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <h3>Invoices</h3>
        <p>Invoice management coming in Phase 4.</p>
      </div>
    </div>

    <div class="view-container" id="view-subscriptions">
      <div class="empty-state">
        <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/></svg>
        <h3>Subscriptions</h3>
        <p>Subscription tracking coming in Phase 4.</p>
      </div>
    </div>

    <div class="view-container" id="view-messages">
      <div class="empty-state">
        <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <h3>Messages</h3>
        <p>Client messaging coming in Phase 5.</p>
      </div>
    </div>

  </main>

</div>

<!-- Toast Container -->
<div id="toastContainer"></div>

<script type="module">
  import { auth } from './js/config.js';
  import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
  import { registerView, navigate, initRouter } from './js/router.js';
  import { showToast } from './js/ui.js';

  // Auth guard — redirect to login if not authenticated
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = 'login.html';
      return;
    }

    // Set user info in sidebar
    const initials = (user.displayName || user.email)
      .split(' ')
      .map(w => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);

    document.getElementById('userAvatar').textContent = initials;
    document.getElementById('userName').textContent = user.displayName || user.email;
  });

  // Logout
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await signOut(auth);
  });

  // View title mapping
  const titles = {
    dashboard: 'Dashboard',
    contacts: 'Contacts',
    pipeline: 'Pipeline',
    tasks: 'Tasks',
    invoices: 'Invoices',
    subscriptions: 'Subscriptions',
    messages: 'Messages'
  };

  // Register all views
  Object.keys(titles).forEach(name => {
    registerView(name, {
      render() {
        document.getElementById('headerTitle').textContent = titles[name];
      }
    });
  });

  // Nav click handlers
  document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.view));
  });

  // Start router
  initRouter('dashboard');
</script>

</body>
</html>
```

- [ ] **Step 4.5: Verify app shell**

Open `crm/login.html` in a browser. Log in. Confirm:
1. Redirects to `app.html` after login
2. Sidebar renders with all nav items and correct icons
3. User initials and name appear at bottom of sidebar
4. Clicking nav items switches views (shows placeholder empty states)
5. Header title updates to match current view
6. Logout button returns to login page
7. Navigating directly to `app.html` without auth redirects to login

- [ ] **Step 4.6: Commit**

```bash
git add crm/app.html crm/css/app.css crm/js/router.js crm/js/ui.js
git commit -m "feat(crm): add app shell with sidebar, routing, and dashboard"
```

---

### Task 5: Firestore Security Rules

**Files:**
- Create: `crm/firestore.rules`

- [ ] **Step 5.1: Write security rules**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Helper: is the request from an authenticated user?
    function isAuth() {
      return request.auth != null;
    }

    // Helper: is the user an admin?
    function isAdmin() {
      return isAuth() && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }

    // Users collection
    match /users/{userId} {
      allow read: if isAuth();
      allow write: if request.auth.uid == userId || isAdmin();
    }

    // Contacts
    match /contacts/{contactId} {
      allow read, write: if isAuth();
    }

    // Deals (pipeline)
    match /deals/{dealId} {
      allow read, write: if isAuth();
    }

    // Tasks
    match /tasks/{taskId} {
      allow read, write: if isAuth();
    }

    // Notes
    match /notes/{noteId} {
      allow read, write: if isAuth();
    }

    // Invoices
    match /invoices/{invoiceId} {
      allow read, write: if isAuth();
    }

    // Payments
    match /payments/{paymentId} {
      allow read, write: if isAuth();
    }

    // Subscriptions
    match /subscriptions/{subId} {
      allow read, write: if isAuth();
    }

    // Messages
    match /messages/{messageId} {
      allow read, write: if isAuth();
    }

    // Settings (white-label config)
    match /settings/{settingId} {
      allow read: if isAuth();
      allow write: if isAdmin();
    }
  }
}
```

- [ ] **Step 5.2: Deploy rules (user action — do later)**

Rules will be deployed when Firebase CLI is set up. For now, the Firestore "test mode" rules allow all access. Save this file for when we configure Firebase CLI deployment.

- [ ] **Step 5.3: Commit**

```bash
git add crm/firestore.rules
git commit -m "feat(crm): add Firestore security rules"
```

---

## Phase Summary

Phase 1 delivers:
- Firebase project with Auth + Firestore
- Login/Register page with error handling
- Full app shell with sidebar navigation and 7 view placeholders
- Client-side hash router
- Shared design system (CSS variables, components)
- Firestore security rules
- Toast notifications and UI utilities

## Next Phases (separate plans)

- **Phase 2: Contacts + Pipeline** — CRUD for contacts, kanban pipeline board, deal tracking
- **Phase 3: Tasks + Activity** — Task management, follow-up reminders, notes/activity log
- **Phase 4: Invoices + Payments** — Invoice generation, payment tracking, subscription management
- **Phase 5: Client Portal** — Client-facing portal, milestones, messaging
- **Phase 6: Reporting + White-Label** — Dashboard analytics, white-label/branding settings
