import { auth } from './config.js';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// --- Auth state listener: redirect if already logged in ---
onAuthStateChanged(auth, (user) => {
  if (user) {
    window.location.replace('app.html');
  }
});

// --- DOM refs ---
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const showRegisterLink = document.getElementById('showRegister');
const showLoginLink = document.getElementById('showLogin');
const loginView = document.getElementById('loginView');
const registerView = document.getElementById('registerView');

// --- Toggle login/register ---
if (showRegisterLink) showRegisterLink.addEventListener('click', (e) => {
  e.preventDefault();
  if (loginView) loginView.classList.remove('active');
  if (registerView) registerView.classList.add('active');
});
if (showLoginLink) showLoginLink.addEventListener('click', (e) => {
  e.preventDefault();
  if (registerView) registerView.classList.remove('active');
  if (loginView) loginView.classList.add('active');
});

// --- Login ---
if (loginForm) loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError('loginError');

  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  if (!email || !password) {
    showError('loginError', 'Please fill in all fields.');
    return;
  }

  setLoading('loginBtn', true);

  try {
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged will handle redirect
  } catch (err) {
    console.error('Portal Auth Error:', err.code, err.message);
    const msg = mapAuthError(err.code);
    // If user not found, suggest registration
    if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential' || err.code === 'auth/invalid-login-credentials') {
      showError('loginError', msg + ' If you\'re a new customer, click "Create an account" below.');
    } else {
      showError('loginError', msg);
    }
  } finally {
    setLoading('loginBtn', false);
  }
});

// --- Register ---
if (registerForm) registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError('registerError');

  const email = document.getElementById('registerEmail').value.trim();
  const password = document.getElementById('registerPassword').value;
  const confirmPassword = document.getElementById('registerConfirm').value;

  if (!email || !password || !confirmPassword) {
    showError('registerError', 'Please fill in all fields.');
    return;
  }

  if (password !== confirmPassword) {
    showError('registerError', 'Passwords do not match.');
    return;
  }

  if (password.length < 6) {
    showError('registerError', 'Password must be at least 6 characters.');
    return;
  }

  setLoading('registerBtn', true);

  try {
    await createUserWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged will redirect to app.html
  } catch (err) {
    console.error('Register Error:', err.code, err.message);
    showError('registerError', mapAuthError(err.code));
  } finally {
    setLoading('registerBtn', false);
  }
});

// --- Helpers ---

function showError(elementId, message) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = message;
  el.classList.add('visible');
}

function clearError(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = '';
  el.classList.remove('visible');
}

function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;

  if (loading) {
    btn.dataset.originalText = btn.textContent;
    btn.textContent = 'Please wait\u2026';
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.originalText || btn.textContent;
    btn.disabled = false;
  }
}

function mapAuthError(code) {
  const errors = {
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/user-disabled': 'This account has been disabled. Contact support.',
    'auth/user-not-found': 'No account found with that email. You may need to create an account first.',
    'auth/wrong-password': 'Incorrect password. Please try again.',
    'auth/invalid-credential': 'Invalid email or password. Please try again.',
    'auth/invalid-login-credentials': 'Invalid email or password. Please try again.',
    'auth/email-already-in-use': 'An account with that email already exists. Try signing in instead.',
    'auth/weak-password': 'Password is too weak. Use at least 6 characters.',
    'auth/too-many-requests': 'Too many attempts. Please wait and try again.',
    'auth/network-request-failed': 'Network error. Check your connection.',
    'auth/operation-not-allowed': 'This sign-in method is not enabled. Contact support.',
    'auth/internal-error': 'An unexpected error occurred. Please try again.'
  };
  return errors[code] || `Authentication error (${code || 'unknown'}). Please try again.`;
}
