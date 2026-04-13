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

// --- Auth state listener: redirect if already logged in ---
onAuthStateChanged(auth, (user) => {
  if (user) {
    window.location.replace('app.html');
  }
});

// --- DOM refs ---
const loginView = document.getElementById('loginView');
const registerView = document.getElementById('registerView');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const showRegisterLink = document.getElementById('showRegister');
const showLoginLink = document.getElementById('showLogin');

// --- View toggle ---
showRegisterLink.addEventListener('click', (e) => {
  e.preventDefault();
  loginView.classList.remove('active');
  registerView.classList.add('active');
  clearError('loginError');
});

showLoginLink.addEventListener('click', (e) => {
  e.preventDefault();
  registerView.classList.remove('active');
  loginView.classList.add('active');
  clearError('registerError');
});

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
    showError('loginError', mapAuthError(err.code));
  } finally {
    setLoading('loginBtn', false);
  }
});

// --- Register ---
registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError('registerError');

  const name = document.getElementById('registerName').value.trim();
  const email = document.getElementById('registerEmail').value.trim();
  const password = document.getElementById('registerPassword').value;

  if (!name || !email || !password) {
    showError('registerError', 'Please fill in all fields.');
    return;
  }

  if (password.length < 6) {
    showError('registerError', 'Password must be at least 6 characters.');
    return;
  }

  setLoading('registerBtn', true);

  try {
    const { user } = await createUserWithEmailAndPassword(auth, email, password);

    await updateProfile(user, { displayName: name });

    await setDoc(doc(db, 'users', user.uid), {
      name,
      email,
      role: 'member',
      createdAt: serverTimestamp()
    });

    // onAuthStateChanged will handle redirect
  } catch (err) {
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
    'auth/user-not-found': 'No account found with that email.',
    'auth/wrong-password': 'Incorrect password. Please try again.',
    'auth/invalid-credential': 'Invalid email or password. Please try again.',
    'auth/email-already-in-use': 'An account with that email already exists.',
    'auth/weak-password': 'Password is too weak. Use at least 6 characters.',
    'auth/too-many-requests': 'Too many attempts. Please wait and try again.',
    'auth/network-request-failed': 'Network error. Check your connection.',
    'auth/operation-not-allowed': 'This sign-in method is not enabled.',
    'auth/internal-error': 'An unexpected error occurred. Please try again.'
  };
  return errors[code] || 'Something went wrong. Please try again.';
}
