import { db, auth } from '../config.js';
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, setDoc,
  query, orderBy, where, serverTimestamp, runTransaction, onSnapshot, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

export async function listQuotes() {
  const snap = await getDocs(query(collection(db, 'quotes'), orderBy('createdAt', 'desc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getQuote(quoteId) {
  const snap = await getDoc(doc(db, 'quotes', quoteId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

// Atomic: read counter, increment, create quote doc all in one transaction.
export async function createDraft(data) {
  const user = auth.currentUser;
  const counterRef = doc(db, 'counters', 'quotes');
  const quotesCol = collection(db, 'quotes');

  return runTransaction(db, async (tx) => {
    const counterSnap = await tx.get(counterRef);
    const last = counterSnap.exists() ? (counterSnap.data().lastNumber || 0) : 0;
    const next = last + 1;
    const quoteNumber = `Q-${String(next).padStart(3, '0')}`;
    const newRef = doc(quotesCol);

    tx.set(newRef, {
      quoteNumber,
      status: 'draft',
      ...data,
      publicToken: null,
      sentAt: null, acceptedAt: null, provisionedAt: null,
      tenantId: null, invoiceId: null,
      createdAt: serverTimestamp(),
      createdBy: user ? user.uid : null,
      updatedAt: serverTimestamp(),
      updatedBy: user ? user.uid : null,
    });
    tx.set(counterRef, { lastNumber: next }, { merge: true });
    return { id: newRef.id, quoteNumber };
  });
}

export async function updateDraft(quoteId, patch) {
  const user = auth.currentUser;
  return updateDoc(doc(db, 'quotes', quoteId), {
    ...patch,
    updatedAt: serverTimestamp(),
    updatedBy: user ? user.uid : null,
  });
}

// Mint a token, flip status to 'sent', write a public view mirror doc.
export async function sendQuote(quoteId) {
  const token = randomToken(32);
  const quote = await getQuote(quoteId);
  if (!quote) throw new Error('Quote not found');

  // Minimal set of fields the customer needs to see.
  const viewDoc = {
    quoteNumber: quote.quoteNumber,
    customerSnapshot: quote.customerSnapshot || {},
    vertical: quote.vertical || '',
    packageId: quote.packageId || '',
    tier: quote.tier || '',
    billingCycle: quote.billingCycle || 'monthly',
    basePrice: quote.basePrice || 0,
    priceOverride: quote.priceOverride || null,
    addOns: quote.addOns || [],
    laborHours: quote.laborHours || 0,
    laborRate: quote.laborRate || 0,
    laborDescription: quote.laborDescription || '',
    lineItems: quote.lineItems || [],
    discount: quote.discount || null,
    subtotal: quote.subtotal || 0,
    total: quote.total || 0,
    notes: quote.notes || '',
    validUntil: quote.validUntil || null,
    token,
    quoteId,
  };

  const now = new Date();
  const validUntil = quote.validUntil || Timestamp.fromDate(new Date(now.getTime() + 30 * 86400000));

  // Write view mirror first so page loads work even if the quote update fails mid-op.
  await setDoc(doc(db, 'quote_views', token), viewDoc);
  await updateDoc(doc(db, 'quotes', quoteId), {
    status: 'sent',
    publicToken: token,
    sentAt: serverTimestamp(),
    validUntil,
    updatedAt: serverTimestamp(),
  });
  return { token, url: `${window.location.origin}/quote.html?t=${token}` };
}

export async function markExpired(quoteId) {
  return updateDoc(doc(db, 'quotes', quoteId), { status: 'expired', updatedAt: serverTimestamp() });
}

// ── Response listener (called from main.js on admin login) ──

export function subscribeToResponses(onAccepted, onDeclined) {
  const q = query(collection(db, 'quote_responses'), orderBy('respondedAt', 'desc'));
  return onSnapshot(q, async (snap) => {
    for (const change of snap.docChanges()) {
      if (change.type !== 'added') continue;
      const data = change.doc.data();
      if (data.processedAt) continue;  // already handled by another tab

      try {
        if (data.response === 'accepted') {
          await onAccepted(change.doc.id, data);
        } else if (data.response === 'declined') {
          await onDeclined(change.doc.id, data);
        }
      } catch (err) {
        console.error('Response processing failed for', change.doc.id, err);
      }
    }
  });
}

function randomToken(len) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, v => chars[v % chars.length]).join('');
}
