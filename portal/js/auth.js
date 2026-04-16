import { auth } from './config.js';
import {
  signInWithEmailAndPassword,
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

// --- Login ---
loginForm.addEventListener('submit', async (e) => {
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
    showError('loginError', mapAuthError(err.code));
  } finally {
    setLoading('loginBtn', false);
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
    'auth/user-not-found': 'No account found with that email.',
    'auth/wrong-password': 'Incorrect password. Please try again.',
    'auth/invalid-credential': 'Invalid email or password. Please try again.',
    'auth/too-many-requests': 'Too many attempts. Please wait and try again.',
    'auth/network-request-failed': 'Network error. Check your connection.'
  };
  return errors[code] || 'Something went wrong. Please try again.';
}
