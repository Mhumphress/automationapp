# Quote-Centric CRM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the multi-step customer onboarding flow (Contact → Company → Deal → Status → Package → Pricing → Provision) into one intuitive Quote Builder, plus add post-sale subscription management with proration and a universal search.

**Architecture:** Vanilla ES modules following existing CRM patterns. New `quotes` collection replaces the deal pipeline. Public-facing quote page (anonymous auth) uses a 32-char token and two companion collections (`quote_views` for read, `quote_responses` for write). Tenant subscription changes produce prorated invoices or credits in `tenants/{t}/invoices/`.

**Tech Stack:** Firebase Firestore (10.12.0 via CDN), vanilla JS ES modules, Cloudflare Pages, Chart.js already loaded.

**Spec:** `docs/superpowers/specs/2026-04-17-quote-centric-crm-design.md`

**Pattern references (existing code to mirror):**
- `portal/js/views/shared/invoicing.js` — list → form → detail flow
- `portal/js/services/tickets.js` — runTransaction for counter minting + cross-doc atomic writes
- `portal/js/views/repair/checkin.js` — wizard-style form with cascading selects
- `crm/js/views/pipeline.js` — existing deal/provisioning logic to adapt

**Testing model:** No automated test framework. Each task ends with a specific manual browser check against a real Firestore backend, then a commit.

---

### Task 1: Firestore rules for quotes, responses, views, refund-type

**Files:**
- Modify: `crm/firestore.rules`

Adds rules for the new collections and permits the anonymous write needed by the public quote page.

- [ ] **Step 1: Add counter rule**

Find the existing `match /counters/{counterId}` rule for the tenant subcollection. Above the root `match /settings/{settingId}` rule, add a root-level counter rule for the CRM's quote counter:

```
    // ── Root-level counters (admin-only) ─────
    match /counters/{counterId} {
      allow read, write: if isAdmin();
    }
```

- [ ] **Step 2: Add quote rules**

After the `match /contacts/{contactId}` rule in the root section, add:

```
    // ── Quotes ───────────────────────────────
    match /quotes/{quoteId} {
      allow read: if isApprovedUser();
      allow create: if isApprovedUser();
      allow update: if isApprovedUser();
      allow delete: if isAdmin();
    }
```

- [ ] **Step 3: Add public quote view + response rules**

After the quote rules, add:

```
    // ── Public quote views (public read, admin write) ──
    match /quote_views/{token} {
      allow read: if true;
      allow create, update, delete: if isAdmin();
    }

    // ── Public quote responses (anonymous create, admin read) ──
    match /quote_responses/{token} {
      // Customers can create their response if the document ID matches the token field.
      // Prevents reuse of the same response doc and blocks reads by non-admins.
      allow create: if request.resource.data.token == token
                    && request.resource.data.response in ['accepted', 'declined']
                    && request.resource.data.response.size() <= 16;
      allow read, update, delete: if isAdmin();
    }
```

- [ ] **Step 4: Commit**

```bash
git add crm/firestore.rules
git commit -m "feat(rules): add quotes, quote_views, quote_responses rules + CRM counter"
```

- [ ] **Step 5: Deploy rules to Firebase Console manually**

Copy the full `crm/firestore.rules` file and paste into Firebase Console → Firestore → Rules → Publish. Verify the rules save without errors.

---

### Task 2: Quotes data service

**Files:**
- Create: `crm/js/services/quotes.js`

Atomic quote-number minting, token generation, response-doc processing.

- [ ] **Step 1: Create the service**

```javascript
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
```

- [ ] **Step 2: Manual check**

Open CRM, load the file in the browser console via a dynamic import to confirm no syntax errors:
```js
await import('./services/quotes.js')
```
No errors.

- [ ] **Step 3: Commit**

```bash
git add crm/js/services/quotes.js
git commit -m "feat(crm): add quotes data service with counter, token, response listener"
```

---

### Task 3: Subscription service with proration

**Files:**
- Create: `crm/js/services/subscription.js`

Proration math + the four lifecycle actions.

- [ ] **Step 1: Create the service**

```javascript
import { db, auth } from '../config.js';
import {
  collection, doc, getDoc, addDoc, updateDoc, serverTimestamp, Timestamp,
  runTransaction
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getPackage } from './catalog.js';

// ── Proration ────────────────────────────────────────────

export function prorationRatio(currentPeriodStart, currentPeriodEnd, now = Date.now()) {
  const start = toMs(currentPeriodStart);
  const end = toMs(currentPeriodEnd);
  if (!start || !end || end <= start) return 0;
  const daysInPeriod = Math.max(1, (end - start) / 86400000);
  const daysRemaining = Math.max(0, (end - now) / 86400000);
  return Math.min(1, Math.max(0, daysRemaining / daysInPeriod));
}

function toMs(ts) {
  if (!ts) return 0;
  if (ts.toDate) return ts.toDate().getTime();
  if (ts instanceof Date) return ts.getTime();
  return Number(ts) || 0;
}

function round2(n) { return Math.round(n * 100) / 100; }

// ── Implementation fee lookup ────────────────────────────

async function getImplementationFee() {
  const snap = await getDoc(doc(db, 'settings', 'billing'));
  if (!snap.exists()) return 25;
  const v = snap.data().addOnImplementationFee;
  return typeof v === 'number' ? v : 25;
}

// ── Actions ──────────────────────────────────────────────

/**
 * Preview the math for adding an add-on. Returns {prorated, implementationFee, total}
 */
export function previewAddAddOn(tenant, addon) {
  const ratio = prorationRatio(tenant.currentPeriodStart, tenant.currentPeriodEnd);
  const monthlyPrice = (addon.priceMonthly || 0) * (addon.qty || 1);
  const prorated = round2(monthlyPrice * ratio);
  return { ratio, monthlyPrice, prorated };
}

export async function addAddOn(tenantId, addon) {
  const user = auth.currentUser;
  const tenantRef = doc(db, 'tenants', tenantId);
  const tenantSnap = await getDoc(tenantRef);
  if (!tenantSnap.exists()) throw new Error('Tenant not found');
  const tenant = tenantSnap.data();

  const fee = await getImplementationFee();
  const { ratio, monthlyPrice, prorated } = previewAddAddOn(tenant, addon);

  const lineItems = [];
  if (prorated > 0) {
    lineItems.push({
      description: `${addon.name} (prorated: ${(ratio * 100).toFixed(1)}% of billing period)`,
      quantity: 1, rate: prorated, amount: prorated,
    });
  }
  if (fee > 0) {
    lineItems.push({
      description: 'Add-on implementation fee',
      quantity: 1, rate: fee, amount: fee,
    });
  }
  const total = lineItems.reduce((s, l) => s + l.amount, 0);

  // Write: update tenant addOns + write invoice + log activity
  const newAddOns = Array.isArray(tenant.addOns) ? [...tenant.addOns] : [];
  newAddOns.push({ slug: addon.slug, name: addon.name, qty: addon.qty || 1, priceMonthly: addon.priceMonthly });

  await updateDoc(tenantRef, {
    addOns: newAddOns,
    updatedAt: serverTimestamp(),
    updatedBy: user ? user.uid : null,
  });

  const invoiceRef = await addDoc(collection(db, 'tenants', tenantId, 'invoices'), {
    invoiceNumber: `INV-T-${Date.now().toString().slice(-6)}`,
    type: 'charge',
    amount: total, total,
    status: 'sent',
    issuedDate: serverTimestamp(),
    dueDate: Timestamp.fromDate(new Date(Date.now() + 14 * 86400000)),
    lineItems,
    reason: `Added add-on: ${addon.name}`,
    createdAt: serverTimestamp(),
    createdBy: user ? user.uid : null,
  });

  await addDoc(collection(db, 'tenants', tenantId, 'activity'), {
    type: 'addon_added',
    description: `Added ${addon.name} — invoice ${formatCurrency(total)}`,
    metadata: { slug: addon.slug, invoiceId: invoiceRef.id },
    createdAt: serverTimestamp(),
  });

  return { invoiceId: invoiceRef.id, total };
}

export function previewRemoveAddOn(tenant, slug) {
  const addon = (tenant.addOns || []).find(a => a.slug === slug);
  if (!addon) return null;
  const ratio = prorationRatio(tenant.currentPeriodStart, tenant.currentPeriodEnd);
  const monthlyPrice = (addon.priceMonthly || 0) * (addon.qty || 1);
  const refund = round2(monthlyPrice * ratio);
  return { addon, ratio, refund };
}

export async function removeAddOn(tenantId, slug) {
  const user = auth.currentUser;
  const tenantRef = doc(db, 'tenants', tenantId);
  const tenantSnap = await getDoc(tenantRef);
  if (!tenantSnap.exists()) throw new Error('Tenant not found');
  const tenant = tenantSnap.data();

  const preview = previewRemoveAddOn(tenant, slug);
  if (!preview) throw new Error('Add-on not found on tenant');

  const newAddOns = (tenant.addOns || []).filter(a => a.slug !== slug);
  await updateDoc(tenantRef, {
    addOns: newAddOns,
    updatedAt: serverTimestamp(),
    updatedBy: user ? user.uid : null,
  });

  if (preview.refund > 0) {
    const invoiceRef = await addDoc(collection(db, 'tenants', tenantId, 'invoices'), {
      invoiceNumber: `CR-${Date.now().toString().slice(-6)}`,
      type: 'refund',
      amount: -preview.refund, total: -preview.refund,
      status: 'issued',
      issuedDate: serverTimestamp(),
      lineItems: [{
        description: `Prorated credit for removed add-on: ${preview.addon.name}`,
        quantity: 1, rate: -preview.refund, amount: -preview.refund,
      }],
      reason: `Removed add-on: ${preview.addon.name}`,
      createdAt: serverTimestamp(),
      createdBy: user ? user.uid : null,
    });
    await addDoc(collection(db, 'tenants', tenantId, 'activity'), {
      type: 'addon_removed',
      description: `Removed ${preview.addon.name} — credit ${formatCurrency(preview.refund)}`,
      metadata: { slug, invoiceId: invoiceRef.id },
      createdAt: serverTimestamp(),
    });
    return { invoiceId: invoiceRef.id, refund: preview.refund };
  }

  await addDoc(collection(db, 'tenants', tenantId, 'activity'), {
    type: 'addon_removed',
    description: `Removed ${preview.addon.name} (no refund — billing period ended)`,
    metadata: { slug },
    createdAt: serverTimestamp(),
  });
  return { invoiceId: null, refund: 0 };
}

export async function previewChangePlan(tenant, newPackageId) {
  const oldPkg = tenant.packageId ? await getPackage(tenant.packageId) : null;
  const newPkg = await getPackage(newPackageId);
  if (!newPkg) throw new Error('New package not found');
  const ratio = prorationRatio(tenant.currentPeriodStart, tenant.currentPeriodEnd);
  const oldPrice = oldPkg ? (tenant.priceOverride ?? oldPkg.basePrice ?? 0) : 0;
  const newPrice = newPkg.basePrice || 0;
  const refund = round2(oldPrice * ratio);
  const charge = round2(newPrice * ratio);
  const net = round2(charge - refund);
  return { oldPkg, newPkg, ratio, refund, charge, net };
}

export async function changePlan(tenantId, newPackageId) {
  const user = auth.currentUser;
  const tenantRef = doc(db, 'tenants', tenantId);
  const tenantSnap = await getDoc(tenantRef);
  if (!tenantSnap.exists()) throw new Error('Tenant not found');
  const tenant = tenantSnap.data();

  const preview = await previewChangePlan(tenant, newPackageId);

  const lineItems = [];
  if (preview.refund > 0) lineItems.push({
    description: `Credit — previous plan (${preview.oldPkg?.name || 'previous'})`,
    quantity: 1, rate: -preview.refund, amount: -preview.refund,
  });
  if (preview.charge > 0) lineItems.push({
    description: `New plan (${preview.newPkg.name}) prorated`,
    quantity: 1, rate: preview.charge, amount: preview.charge,
  });
  const total = preview.net;

  await updateDoc(tenantRef, {
    packageId: newPackageId,
    tier: preview.newPkg.tier,
    features: preview.newPkg.features || [],
    priceOverride: null, // reset override — user can set again if needed
    updatedAt: serverTimestamp(),
    updatedBy: user ? user.uid : null,
  });

  const invoiceRef = await addDoc(collection(db, 'tenants', tenantId, 'invoices'), {
    invoiceNumber: `INV-T-${Date.now().toString().slice(-6)}`,
    type: total >= 0 ? 'charge' : 'refund',
    amount: total, total,
    status: 'sent',
    issuedDate: serverTimestamp(),
    dueDate: Timestamp.fromDate(new Date(Date.now() + 14 * 86400000)),
    lineItems,
    reason: `Plan change: ${preview.oldPkg?.name || '-'} → ${preview.newPkg.name}`,
    createdAt: serverTimestamp(),
    createdBy: user ? user.uid : null,
  });
  await addDoc(collection(db, 'tenants', tenantId, 'activity'), {
    type: 'plan_changed',
    description: `Plan changed to ${preview.newPkg.name} — net ${total >= 0 ? 'charge' : 'credit'} ${formatCurrency(Math.abs(total))}`,
    metadata: { oldPackageId: tenant.packageId, newPackageId, invoiceId: invoiceRef.id },
    createdAt: serverTimestamp(),
  });
  return { invoiceId: invoiceRef.id, total };
}

export function previewCancelNow(tenant) {
  const pkg = tenant.packageId;
  const price = tenant.priceOverride ?? tenant.basePrice ?? 0;
  const ratio = prorationRatio(tenant.currentPeriodStart, tenant.currentPeriodEnd);
  return { refund: round2(price * ratio) };
}

export async function cancelNow(tenantId) {
  const user = auth.currentUser;
  const tenantRef = doc(db, 'tenants', tenantId);
  const tenantSnap = await getDoc(tenantRef);
  if (!tenantSnap.exists()) throw new Error('Tenant not found');
  const tenant = tenantSnap.data();

  const { refund } = previewCancelNow(tenant);

  await updateDoc(tenantRef, {
    status: 'cancelled',
    cancelAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: user ? user.uid : null,
  });

  let invoiceId = null;
  if (refund > 0) {
    const invoiceRef = await addDoc(collection(db, 'tenants', tenantId, 'invoices'), {
      invoiceNumber: `CR-${Date.now().toString().slice(-6)}`,
      type: 'refund',
      amount: -refund, total: -refund,
      status: 'issued',
      issuedDate: serverTimestamp(),
      lineItems: [{
        description: `Prorated refund — cancellation`,
        quantity: 1, rate: -refund, amount: -refund,
      }],
      reason: 'Subscription cancelled',
      createdAt: serverTimestamp(),
      createdBy: user ? user.uid : null,
    });
    invoiceId = invoiceRef.id;
  }

  await addDoc(collection(db, 'tenants', tenantId, 'activity'), {
    type: 'subscription_cancelled',
    description: `Subscription cancelled immediately${refund > 0 ? ` — credit ${formatCurrency(refund)}` : ''}`,
    metadata: { invoiceId },
    createdAt: serverTimestamp(),
  });
  return { invoiceId, refund };
}

export async function cancelAtPeriodEnd(tenantId) {
  const user = auth.currentUser;
  const tenantRef = doc(db, 'tenants', tenantId);
  const tenantSnap = await getDoc(tenantRef);
  if (!tenantSnap.exists()) throw new Error('Tenant not found');
  const tenant = tenantSnap.data();

  await updateDoc(tenantRef, {
    cancelAt: tenant.currentPeriodEnd || null,
    updatedAt: serverTimestamp(),
    updatedBy: user ? user.uid : null,
  });
  await addDoc(collection(db, 'tenants', tenantId, 'activity'), {
    type: 'subscription_cancel_scheduled',
    description: `Cancellation scheduled for end of billing period`,
    metadata: {},
    createdAt: serverTimestamp(),
  });
  return { scheduledFor: tenant.currentPeriodEnd };
}

// ── cancelAt enforcement (called on admin load from main.js) ──

export async function enforceCancellations() {
  const { collection: col, getDocs: gd, query: q, where: w } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
  const snap = await gd(q(col(db, 'tenants'), w('status', '==', 'active')));
  const now = Date.now();
  const due = [];
  snap.forEach(docSnap => {
    const data = docSnap.data();
    const cancelAt = toMs(data.cancelAt);
    if (cancelAt && cancelAt <= now) due.push(docSnap.id);
  });
  for (const id of due) {
    await updateDoc(doc(db, 'tenants', id), { status: 'cancelled', updatedAt: serverTimestamp() });
    await addDoc(collection(db, 'tenants', id, 'activity'), {
      type: 'subscription_cancelled',
      description: 'Scheduled cancellation took effect',
      createdAt: serverTimestamp(),
    });
  }
  return due.length;
}

function formatCurrency(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
}
```

- [ ] **Step 2: Update tenant service to include `currentPeriodStart/End` on create**

Open `crm/js/services/tenants.js`. Find the `createTenant` function. Add to the default doc payload (after `status`):

```javascript
currentPeriodStart: data.currentPeriodStart || serverTimestamp(),
currentPeriodEnd: data.currentPeriodEnd || null,
cancelAt: null,
```

If the import list at the top doesn't include `serverTimestamp` and `Timestamp`, add them.

- [ ] **Step 3: Manual check**

Load the subscription module in the browser console:
```js
const m = await import('./services/subscription.js')
m.prorationRatio(Date.now() - 10*86400000, Date.now() + 20*86400000)
// Expected: ~0.666 (20 of 30 days remaining)
```

- [ ] **Step 4: Commit**

```bash
git add crm/js/services/subscription.js crm/js/services/tenants.js
git commit -m "feat(crm): subscription service with proration + period fields"
```

---

### Task 4: Catalog helper for shared getPackage

**Files:**
- Modify: `crm/js/services/catalog.js` (create `getPackage` export if missing)

The subscription service needs `getPackage(id)`. Check if it's already exported.

- [ ] **Step 1: Verify or add**

```bash
grep -n "export" crm/js/services/catalog.js | head -20
```

If `getPackage` is already exported, skip this task. If not, add to `catalog.js`:

```javascript
export async function getPackage(packageId) {
  const { getDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
  const { db } = await import('../config.js');
  const snap = await getDoc(doc(db, 'packages', packageId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
```

- [ ] **Step 2: Commit (if any change made)**

```bash
git add crm/js/services/catalog.js
git commit -m "feat(crm): export getPackage from catalog service"
```

---

### Task 5: Quotes list view

**Files:**
- Create: `crm/js/views/quotes.js`

A list view for quotes. The Quote Builder form comes in Task 6 (separate for commit size).

- [ ] **Step 1: Create the list view**

```javascript
import { listQuotes } from '../services/quotes.js';
import { isAdmin } from '../services/roles.js';
import { showToast, escapeHtml, formatDate, formatCurrency } from '../ui.js';

let quotes = [];
let currentPage = 'list';
let searchTerm = '';

export async function init() {}
export function destroy() { currentPage = 'list'; }

export async function render() {
  const container = document.getElementById('view-quotes');
  container.innerHTML = '<div class="loading">Loading quotes...</div>';
  try { quotes = await listQuotes(); }
  catch (err) { console.error(err); quotes = []; }
  if (currentPage === 'list') renderList();
}

function renderList() {
  const container = document.getElementById('view-quotes');
  container.innerHTML = '';

  const topbar = document.createElement('div');
  topbar.className = 'view-topbar';
  topbar.innerHTML = `
    <input type="search" class="search-input" placeholder="Search quotes..." value="${escapeHtml(searchTerm)}" style="flex:1;max-width:360px;">
    <button class="btn btn-primary" id="newQuoteBtn">+ New Quote</button>
  `;
  container.appendChild(topbar);

  topbar.querySelector('.search-input').addEventListener('input', (e) => {
    searchTerm = e.target.value.trim().toLowerCase();
    renderTable();
  });
  topbar.querySelector('#newQuoteBtn').addEventListener('click', () => {
    import('./quote-builder.js').then(m => m.openBuilder(null));
  });

  const content = document.createElement('div');
  content.id = 'quotesContent';
  content.className = 'view-content';
  container.appendChild(content);

  renderTable();
}

function renderTable() {
  const content = document.getElementById('quotesContent');
  if (!content) return;

  let filtered = quotes;
  if (searchTerm) {
    filtered = filtered.filter(q =>
      (q.quoteNumber || '').toLowerCase().includes(searchTerm) ||
      ((q.customerSnapshot?.firstName || '') + ' ' + (q.customerSnapshot?.lastName || '')).toLowerCase().includes(searchTerm) ||
      (q.customerSnapshot?.company || '').toLowerCase().includes(searchTerm) ||
      (q.customerSnapshot?.email || '').toLowerCase().includes(searchTerm)
    );
  }

  if (filtered.length === 0) {
    content.innerHTML = quotes.length === 0
      ? '<div class="empty-state"><div class="empty-title">No quotes yet</div><p class="empty-description">Click + New Quote to create your first.</p></div>'
      : '<div class="empty-state"><p class="empty-description">No quotes match your search.</p></div>';
    return;
  }

  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = '<thead><tr><th>Quote #</th><th>Customer</th><th>Company</th><th>Total</th><th>Status</th><th>Sent</th></tr></thead>';
  const tbody = document.createElement('tbody');
  filtered.forEach(q => {
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    const cs = q.customerSnapshot || {};
    const statusClass = q.status === 'provisioned' ? 'badge-success'
      : q.status === 'accepted' ? 'badge-info'
      : q.status === 'sent' ? 'badge-default'
      : q.status === 'declined' || q.status === 'expired' ? 'badge-danger'
      : 'badge-default';
    tr.innerHTML = `
      <td style="font-family:monospace;font-weight:500;">${escapeHtml(q.quoteNumber || '-')}</td>
      <td>${escapeHtml((cs.firstName || '') + ' ' + (cs.lastName || ''))}</td>
      <td>${escapeHtml(cs.company || '-')}</td>
      <td>${formatCurrency(q.total || 0)}</td>
      <td><span class="badge ${statusClass}">${escapeHtml(q.status || 'draft')}</span></td>
      <td>${formatDate(q.sentAt)}</td>
    `;
    tr.addEventListener('click', () => {
      import('./quote-builder.js').then(m => m.openBuilder(q.id));
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  content.innerHTML = '';
  content.appendChild(table);
}
```

- [ ] **Step 2: Commit**

```bash
git add crm/js/views/quotes.js
git commit -m "feat(crm): add Quotes list view"
```

---

### Task 6: Quote Builder form + live pricing

**Files:**
- Create: `crm/js/views/quote-builder.js`

Single-screen quote builder with live pricing panel. Handles both new drafts and editing existing quotes.

- [ ] **Step 1: Create the builder**

```javascript
import { db } from '../config.js';
import { collection, getDocs, addDoc, serverTimestamp, query, orderBy } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { createDraft, updateDraft, sendQuote, getQuote } from '../services/quotes.js';
import { getVerticals, getPackagesByVertical, getAddons } from '../services/catalog.js';
import { showToast, escapeHtml, formatCurrency } from '../ui.js';

const ADDON_PRICE_MONTHLY = 'priceMonthly';

// State for the form
let formState = null;

export async function openBuilder(existingQuoteId) {
  const container = document.getElementById('view-quotes');
  container.innerHTML = '<div class="loading">Loading builder...</div>';

  const [verticals, addons, contactsSnap] = await Promise.all([
    getVerticals(),
    getAddons(),
    getDocs(query(collection(db, 'contacts'), orderBy('lastName', 'asc'))),
  ]);
  const contacts = contactsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  let existing = null;
  if (existingQuoteId) existing = await getQuote(existingQuoteId);

  formState = {
    id: existing?.id || null,
    contactId: existing?.contactId || '',
    customerSnapshot: existing?.customerSnapshot || { firstName: '', lastName: '', email: '', phone: '', company: '' },
    vertical: existing?.vertical || (verticals[0]?.id || ''),
    packageId: existing?.packageId || '',
    tier: existing?.tier || '',
    billingCycle: existing?.billingCycle || 'monthly',
    basePrice: existing?.basePrice || 0,
    priceOverride: existing?.priceOverride || null,
    addOns: existing?.addOns || [],
    laborHours: existing?.laborHours || 0,
    laborRate: existing?.laborRate || 125,
    laborDescription: existing?.laborDescription || '',
    lineItems: existing?.lineItems || [],
    discount: existing?.discount || { reason: '', type: 'percent', value: 0 },
    notes: existing?.notes || 'This quote is valid for 30 days. Payment due within 14 days of invoice.',
    status: existing?.status || 'draft',
  };

  let packages = formState.vertical ? await getPackagesByVertical(formState.vertical) : [];

  container.innerHTML = '';
  container.appendChild(renderShell(existing, verticals, packages, addons, contacts));
  attachBuilderHandlers(verticals, packages, addons, contacts);
  recalc();
}

function renderShell(existing, verticals, packages, addons, contacts) {
  const wrap = document.createElement('div');
  wrap.className = 'builder-root';
  wrap.style.cssText = 'display:grid;grid-template-columns:1fr 320px;gap:1.5rem;align-items:flex-start;';

  wrap.innerHTML = `
    <div>
      <button class="detail-back" id="builderBack">&larr; Back to Quotes</button>
      <h2 style="font-family:var(--font-display);font-size:1.4rem;margin-bottom:1rem;">
        ${existing ? escapeHtml(existing.quoteNumber) : 'New Quote'}
      </h2>

      <!-- Customer -->
      <div class="settings-section">
        <h3 class="section-title">Customer</h3>
        <div class="modal-field">
          <label>Existing customer (autocomplete by name/email/phone)</label>
          <input type="text" id="customerSearch" placeholder="Start typing or leave blank for new customer" autocomplete="off">
          <div id="customerResults" style="position:relative;"></div>
        </div>
        <div class="modal-form-grid">
          <div class="modal-field"><label>First Name</label><input type="text" name="firstName" value="${escapeHtml(formState.customerSnapshot.firstName)}"></div>
          <div class="modal-field"><label>Last Name</label><input type="text" name="lastName" value="${escapeHtml(formState.customerSnapshot.lastName)}"></div>
        </div>
        <div class="modal-form-grid">
          <div class="modal-field"><label>Email</label><input type="email" name="email" value="${escapeHtml(formState.customerSnapshot.email)}"></div>
          <div class="modal-field"><label>Phone</label><input type="tel" name="phone" value="${escapeHtml(formState.customerSnapshot.phone)}"></div>
        </div>
        <div class="modal-field"><label>Company</label><input type="text" name="company" value="${escapeHtml(formState.customerSnapshot.company)}"></div>
      </div>

      <!-- Plan -->
      <div class="settings-section" style="margin-top:1rem;">
        <h3 class="section-title">Plan</h3>
        <div class="modal-form-grid">
          <div class="modal-field">
            <label>Vertical</label>
            <select id="verticalSel">
              ${verticals.map(v => `<option value="${escapeHtml(v.id)}" ${v.id === formState.vertical ? 'selected' : ''}>${escapeHtml(v.name)}</option>`).join('')}
            </select>
          </div>
          <div class="modal-field">
            <label>Package</label>
            <select id="packageSel">
              <option value="">— Select —</option>
              ${packages.map(p => `<option value="${escapeHtml(p.id)}" ${p.id === formState.packageId ? 'selected' : ''}>${escapeHtml(p.name)} · ${escapeHtml(p.tier)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="modal-form-grid">
          <div class="modal-field">
            <label>Billing Cycle</label>
            <select name="billingCycle">
              <option value="monthly" ${formState.billingCycle === 'monthly' ? 'selected' : ''}>Monthly</option>
              <option value="annual" ${formState.billingCycle === 'annual' ? 'selected' : ''}>Annual</option>
            </select>
          </div>
          <div class="modal-field">
            <label>Price Override (optional)</label>
            <input type="number" name="priceOverride" min="0" step="0.01" value="${formState.priceOverride ?? ''}" placeholder="Leave blank to use package default">
          </div>
        </div>
      </div>

      <!-- Add-ons -->
      <div class="settings-section" style="margin-top:1rem;">
        <h3 class="section-title">Add-ons</h3>
        <div id="addonsList"></div>
      </div>

      <!-- Labor -->
      <div class="settings-section" style="margin-top:1rem;">
        <h3 class="section-title">Labor (setup / implementation)</h3>
        <div class="modal-form-grid">
          <div class="modal-field"><label>Hours</label><input type="number" name="laborHours" min="0" step="0.5" value="${formState.laborHours}"></div>
          <div class="modal-field"><label>Rate (per hour)</label><input type="number" name="laborRate" min="0" step="0.01" value="${formState.laborRate}"></div>
        </div>
        <div class="modal-field"><label>Description</label><textarea name="laborDescription" rows="2" placeholder="e.g., Data migration + 2-hour training">${escapeHtml(formState.laborDescription)}</textarea></div>
      </div>

      <!-- Line items -->
      <div class="settings-section" style="margin-top:1rem;">
        <h3 class="section-title">Line items (one-time custom work)</h3>
        <table class="data-table" id="lineItemsTable">
          <thead><tr><th>Description</th><th style="width:80px;">Qty</th><th style="width:100px;">Rate</th><th style="width:100px;">Amount</th><th style="width:40px;"></th></tr></thead>
          <tbody id="lineItemsBody"></tbody>
        </table>
        <button type="button" class="btn btn-ghost btn-sm" id="addLineBtn">+ Add Line</button>
      </div>

      <!-- Discount -->
      <div class="settings-section" style="margin-top:1rem;">
        <h3 class="section-title">Discount</h3>
        <div class="modal-form-grid">
          <div class="modal-field">
            <label>Reason</label>
            <input type="text" name="discountReason" value="${escapeHtml(formState.discount.reason)}" placeholder="e.g., Intro offer">
          </div>
          <div class="modal-field">
            <label>Type</label>
            <select name="discountType">
              <option value="percent" ${formState.discount.type === 'percent' ? 'selected' : ''}>% off</option>
              <option value="amount" ${formState.discount.type === 'amount' ? 'selected' : ''}>$ off</option>
            </select>
          </div>
          <div class="modal-field">
            <label>Value</label>
            <input type="number" name="discountValue" min="0" step="0.01" value="${formState.discount.value || 0}">
          </div>
        </div>
      </div>

      <!-- Terms -->
      <div class="settings-section" style="margin-top:1rem;">
        <h3 class="section-title">Terms & Notes</h3>
        <textarea name="notes" rows="4" style="width:100%;">${escapeHtml(formState.notes)}</textarea>
      </div>
    </div>

    <aside id="livePanel" style="position:sticky;top:1rem;background:#fff;border:1px solid var(--off-white);border-radius:12px;padding:1.25rem;"></aside>
  `;
  return wrap;
}

function attachBuilderHandlers(verticals, packages, addons, contacts) {
  const root = document.getElementById('view-quotes');

  root.querySelector('#builderBack').addEventListener('click', () => {
    import('./quotes.js').then(m => m.render());
  });

  // Customer autocomplete
  const searchInput = root.querySelector('#customerSearch');
  const resultsEl = root.querySelector('#customerResults');
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) { resultsEl.innerHTML = ''; return; }
    const normPhone = q.replace(/\D/g, '');
    const hits = contacts.filter(c =>
      ((c.firstName || '') + ' ' + (c.lastName || '')).toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.company || '').toLowerCase().includes(q) ||
      (normPhone && (c.phone || '').replace(/\D/g, '').includes(normPhone))
    ).slice(0, 5);
    resultsEl.innerHTML = hits.map(c => `
      <div class="autocomplete-row" data-id="${c.id}" style="padding:0.5rem;border:1px solid var(--off-white);border-top:none;cursor:pointer;background:#fff;">
        ${escapeHtml((c.firstName || '') + ' ' + (c.lastName || ''))} · ${escapeHtml(c.email || c.phone || '')} ${c.company ? '· ' + escapeHtml(c.company) : ''}
      </div>
    `).join('');
    resultsEl.querySelectorAll('.autocomplete-row').forEach(row => {
      row.addEventListener('click', () => {
        const c = contacts.find(x => x.id === row.dataset.id);
        if (!c) return;
        formState.contactId = c.id;
        formState.customerSnapshot = {
          firstName: c.firstName || '',
          lastName: c.lastName || '',
          email: c.email || '',
          phone: c.phone || '',
          company: c.company || '',
        };
        root.querySelector('[name="firstName"]').value = formState.customerSnapshot.firstName;
        root.querySelector('[name="lastName"]').value = formState.customerSnapshot.lastName;
        root.querySelector('[name="email"]').value = formState.customerSnapshot.email;
        root.querySelector('[name="phone"]').value = formState.customerSnapshot.phone;
        root.querySelector('[name="company"]').value = formState.customerSnapshot.company;
        searchInput.value = `${formState.customerSnapshot.firstName} ${formState.customerSnapshot.lastName}`.trim();
        resultsEl.innerHTML = '';
      });
    });
  });

  // Customer fields overwrite snapshot (if user types directly)
  ['firstName', 'lastName', 'email', 'phone', 'company'].forEach(field => {
    root.querySelector(`[name="${field}"]`).addEventListener('input', (e) => {
      formState.customerSnapshot[field] = e.target.value;
      formState.contactId = null; // typing overrides selection — we'll create/find on save
    });
  });

  // Plan
  root.querySelector('#verticalSel').addEventListener('change', async (e) => {
    formState.vertical = e.target.value;
    const newPackages = await getPackagesByVertical(formState.vertical);
    const pkgSel = root.querySelector('#packageSel');
    pkgSel.innerHTML = '<option value="">— Select —</option>' +
      newPackages.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} · ${escapeHtml(p.tier)}</option>`).join('');
    formState.packageId = '';
    formState.basePrice = 0;
    formState.tier = '';
    renderAddons(addons);
    recalc();
  });
  root.querySelector('#packageSel').addEventListener('change', async (e) => {
    formState.packageId = e.target.value;
    if (formState.packageId) {
      const { getPackage } = await import('../services/catalog.js');
      const pkg = await getPackage(formState.packageId);
      if (pkg) {
        formState.basePrice = Number(pkg.basePrice) || 0;
        formState.tier = pkg.tier || '';
      }
    } else {
      formState.basePrice = 0; formState.tier = '';
    }
    renderAddons(addons);
    recalc();
  });
  root.querySelector('[name="billingCycle"]').addEventListener('change', (e) => { formState.billingCycle = e.target.value; recalc(); });
  root.querySelector('[name="priceOverride"]').addEventListener('input', (e) => { formState.priceOverride = e.target.value ? Number(e.target.value) : null; recalc(); });

  // Labor
  root.querySelector('[name="laborHours"]').addEventListener('input', (e) => { formState.laborHours = Number(e.target.value) || 0; recalc(); });
  root.querySelector('[name="laborRate"]').addEventListener('input', (e) => { formState.laborRate = Number(e.target.value) || 0; recalc(); });
  root.querySelector('[name="laborDescription"]').addEventListener('input', (e) => { formState.laborDescription = e.target.value; });

  // Line items
  renderLineItems();
  root.querySelector('#addLineBtn').addEventListener('click', () => {
    formState.lineItems.push({ description: '', quantity: 1, rate: 0, amount: 0 });
    renderLineItems();
  });

  // Discount
  root.querySelector('[name="discountReason"]').addEventListener('input', (e) => { formState.discount.reason = e.target.value; recalc(); });
  root.querySelector('[name="discountType"]').addEventListener('change', (e) => { formState.discount.type = e.target.value; recalc(); });
  root.querySelector('[name="discountValue"]').addEventListener('input', (e) => { formState.discount.value = Number(e.target.value) || 0; recalc(); });

  // Notes
  root.querySelector('[name="notes"]').addEventListener('input', (e) => { formState.notes = e.target.value; });

  renderAddons(addons);
  renderLivePanel();
}

function renderAddons(addons) {
  const list = document.getElementById('addonsList');
  if (!list) return;
  const applicable = addons.filter(a =>
    a.active !== false &&
    (!a.applicableVerticals || a.applicableVerticals.includes('all') || a.applicableVerticals.includes(formState.vertical))
  );
  if (applicable.length === 0) {
    list.innerHTML = '<p style="color:var(--gray);font-size:0.9rem;">Select a vertical to see applicable add-ons.</p>';
    return;
  }
  list.innerHTML = applicable.map(a => {
    const selected = formState.addOns.find(x => x.slug === a.slug);
    const qty = selected?.qty || 1;
    return `
      <div style="display:flex;gap:0.75rem;align-items:center;padding:0.4rem 0;">
        <input type="checkbox" class="addon-check" data-slug="${escapeHtml(a.slug)}" ${selected ? 'checked' : ''}>
        <div style="flex:1;">${escapeHtml(a.name)} <span style="color:var(--gray-dark);font-size:0.85rem;">${formatCurrency(a.priceMonthly)}/mo</span></div>
        ${a.pricingModel === 'per_unit' ? `<input type="number" class="addon-qty" data-slug="${escapeHtml(a.slug)}" min="1" value="${qty}" style="width:70px;" ${selected ? '' : 'disabled'}>` : ''}
      </div>
    `;
  }).join('');

  list.querySelectorAll('.addon-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const slug = cb.dataset.slug;
      const a = addons.find(x => x.slug === slug);
      if (cb.checked) {
        formState.addOns.push({ slug: a.slug, name: a.name, qty: 1, priceMonthly: a.priceMonthly || 0 });
        const qtyInput = list.querySelector(`.addon-qty[data-slug="${slug}"]`);
        if (qtyInput) qtyInput.disabled = false;
      } else {
        formState.addOns = formState.addOns.filter(x => x.slug !== slug);
        const qtyInput = list.querySelector(`.addon-qty[data-slug="${slug}"]`);
        if (qtyInput) qtyInput.disabled = true;
      }
      recalc();
    });
  });
  list.querySelectorAll('.addon-qty').forEach(inp => {
    inp.addEventListener('input', () => {
      const slug = inp.dataset.slug;
      const item = formState.addOns.find(x => x.slug === slug);
      if (item) item.qty = Number(inp.value) || 1;
      recalc();
    });
  });
}

function renderLineItems() {
  const tbody = document.getElementById('lineItemsBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  formState.lineItems.forEach((li, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" class="li-desc" data-i="${i}" value="${escapeHtml(li.description)}" style="width:100%;border:none;outline:none;"></td>
      <td><input type="number" class="li-qty" data-i="${i}" min="0" step="0.5" value="${li.quantity || 0}" style="width:100%;border:none;outline:none;text-align:right;"></td>
      <td><input type="number" class="li-rate" data-i="${i}" min="0" step="0.01" value="${li.rate || 0}" style="width:100%;border:none;outline:none;text-align:right;"></td>
      <td style="text-align:right;">${formatCurrency(li.amount || 0)}</td>
      <td><button type="button" class="btn btn-ghost btn-sm li-remove" data-i="${i}" style="color:var(--danger);">&times;</button></td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('.li-desc').forEach(el => el.addEventListener('input', e => { formState.lineItems[Number(e.target.dataset.i)].description = e.target.value; }));
  tbody.querySelectorAll('.li-qty').forEach(el => el.addEventListener('input', e => { const i = Number(e.target.dataset.i); formState.lineItems[i].quantity = Number(e.target.value) || 0; recalcLineItem(i); recalc(); }));
  tbody.querySelectorAll('.li-rate').forEach(el => el.addEventListener('input', e => { const i = Number(e.target.dataset.i); formState.lineItems[i].rate = Number(e.target.value) || 0; recalcLineItem(i); recalc(); }));
  tbody.querySelectorAll('.li-remove').forEach(el => el.addEventListener('click', e => { formState.lineItems.splice(Number(e.target.dataset.i), 1); renderLineItems(); recalc(); }));
}

function recalcLineItem(i) {
  const li = formState.lineItems[i];
  li.amount = (li.quantity || 0) * (li.rate || 0);
}

function recalc() {
  renderLineItems(); // refresh amount cells
  renderLivePanel();
}

function renderLivePanel() {
  const panel = document.getElementById('livePanel');
  if (!panel) return;

  const plan = formState.priceOverride ?? formState.basePrice ?? 0;
  const addonsTotal = (formState.addOns || []).reduce((s, a) => s + (a.priceMonthly || 0) * (a.qty || 1), 0);
  const laborTotal = (formState.laborHours || 0) * (formState.laborRate || 0);
  const lineItemsTotal = (formState.lineItems || []).reduce((s, l) => s + (l.amount || 0), 0);
  const oneTime = laborTotal + lineItemsTotal;
  const recurring = plan + addonsTotal;
  const subtotal = oneTime + recurring;
  let discount = 0;
  if (formState.discount.value > 0) {
    discount = formState.discount.type === 'percent'
      ? Math.round(subtotal * (Math.min(formState.discount.value, 100) / 100) * 100) / 100
      : Math.min(formState.discount.value, subtotal);
  }
  const totalToday = Math.max(0, subtotal - discount);

  formState.subtotal = subtotal;
  formState.total = totalToday;
  formState.discountAmount = discount;

  panel.innerHTML = `
    <h3 style="font-family:var(--font-display);font-size:1.1rem;margin:0 0 0.75rem;">Live Quote</h3>
    ${plan > 0 ? `<div class="tip-row"><span>${escapeHtml(formState.tier || 'Plan')}</span><strong>${formatCurrency(plan)}/${formState.billingCycle === 'annual' ? 'yr' : 'mo'}</strong></div>` : ''}
    ${addonsTotal > 0 ? `<div class="tip-row"><span>Add-ons</span><strong>${formatCurrency(addonsTotal)}/mo</strong></div>` : ''}
    ${laborTotal > 0 ? `<div class="tip-row"><span>Labor (${formState.laborHours}h)</span><strong>${formatCurrency(laborTotal)}</strong></div>` : ''}
    ${lineItemsTotal > 0 ? `<div class="tip-row"><span>Custom work</span><strong>${formatCurrency(lineItemsTotal)}</strong></div>` : ''}
    <hr style="margin:0.5rem 0;border:none;border-top:1px solid var(--off-white);">
    <div class="tip-row"><span>Subtotal</span><strong>${formatCurrency(subtotal)}</strong></div>
    ${discount > 0 ? `<div class="tip-row" style="color:#059669;"><span>Discount</span><strong>-${formatCurrency(discount)}</strong></div>` : ''}
    <div class="tip-row" style="font-size:1.15rem;padding-top:0.5rem;"><span>Total today</span><strong>${formatCurrency(totalToday)}</strong></div>
    <div class="tip-row" style="color:var(--gray-dark);font-size:0.85rem;"><span>Recurring</span><strong>${formatCurrency(recurring)}/${formState.billingCycle === 'annual' ? 'yr' : 'mo'}</strong></div>
    <div style="display:flex;flex-direction:column;gap:0.5rem;margin-top:1rem;">
      <button type="button" class="btn btn-ghost" id="saveDraftBtn">Save Draft</button>
      <button type="button" class="btn btn-primary" id="sendBtn">Send to Customer →</button>
    </div>
    <style>
      .tip-row { display:flex; justify-content:space-between; padding:0.3rem 0; font-size:0.9rem; }
    </style>
  `;

  panel.querySelector('#saveDraftBtn').addEventListener('click', () => saveQuote(false));
  panel.querySelector('#sendBtn').addEventListener('click', () => saveQuote(true));
}

async function saveQuote(send) {
  const btn = document.getElementById(send ? 'sendBtn' : 'saveDraftBtn');
  btn.disabled = true;
  btn.textContent = send ? 'Sending...' : 'Saving...';

  try {
    // Ensure contact exists or create one
    let contactId = formState.contactId;
    if (!contactId) {
      if (!formState.customerSnapshot.firstName && !formState.customerSnapshot.lastName) {
        throw new Error('Please enter a customer name or pick an existing customer.');
      }
      const { addDocument } = await import('../services/firestore.js');
      const ref = await addDocument('contacts', {
        firstName: formState.customerSnapshot.firstName || '',
        lastName: formState.customerSnapshot.lastName || '',
        email: formState.customerSnapshot.email || '',
        phone: formState.customerSnapshot.phone || '',
        company: formState.customerSnapshot.company || '',
      });
      contactId = ref.id;
    }

    const payload = {
      contactId,
      customerSnapshot: formState.customerSnapshot,
      vertical: formState.vertical,
      packageId: formState.packageId || null,
      tier: formState.tier,
      billingCycle: formState.billingCycle,
      basePrice: formState.basePrice,
      priceOverride: formState.priceOverride,
      addOns: formState.addOns,
      laborHours: formState.laborHours,
      laborRate: formState.laborRate,
      laborDescription: formState.laborDescription,
      lineItems: formState.lineItems,
      discount: { ...formState.discount, amount: formState.discountAmount || 0 },
      subtotal: formState.subtotal,
      total: formState.total,
      notes: formState.notes,
    };

    if (formState.id) {
      await updateDraft(formState.id, payload);
    } else {
      const { id } = await createDraft(payload);
      formState.id = id;
    }

    if (send) {
      const { url } = await sendQuote(formState.id);
      try { await navigator.clipboard.writeText(url); } catch {}
      showToast('Quote sent — URL copied to clipboard', 'success');
      import('./quotes.js').then(m => m.render());
    } else {
      showToast('Draft saved', 'success');
    }
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Save failed', 'error');
    btn.disabled = false;
    btn.textContent = send ? 'Send to Customer →' : 'Save Draft';
  }
}
```

- [ ] **Step 2: Manual check**

Register the quotes view (done in Task 12). For now, just confirm the module loads without errors:
```js
await import('./views/quote-builder.js')
```

- [ ] **Step 3: Commit**

```bash
git add crm/js/views/quote-builder.js
git commit -m "feat(crm): Quote Builder UI with live pricing panel"
```

---

### Task 7: Public quote page

**Files:**
- Create: `quote.html`
- Create: `quote/js/quote.js`
- Create: `quote/css/quote.css`

Standalone page the customer opens via the public URL. No auth. Reads view mirror, writes response.

- [ ] **Step 1: Create `quote.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Quote</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600&family=Cormorant+Garamond:wght@500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="quote/css/quote.css">
</head>
<body>
  <main class="quote-wrap" id="quoteWrap">
    <div class="loading">Loading quote...</div>
  </main>
  <script type="module" src="quote/js/quote.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `quote/css/quote.css`**

```css
:root {
  --q-accent: #4F7BF7;
  --q-fg: #0f172a;
  --q-muted: #64748b;
  --q-border: #e2e8f0;
  --q-bg: #f8fafc;
  --q-danger: #dc2626;
  --q-ok: #059669;
}
* { box-sizing: border-box; }
body {
  font-family: 'Outfit', system-ui, sans-serif;
  margin: 0;
  background: var(--q-bg);
  color: var(--q-fg);
  padding: 2rem 1rem;
}
.quote-wrap {
  max-width: 820px;
  margin: 0 auto;
  background: #fff;
  border-radius: 14px;
  padding: 3rem;
  box-shadow: 0 12px 40px rgba(15,23,42,0.06);
}
.q-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 2rem;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid var(--q-border);
}
.q-brand { display: flex; gap: 0.75rem; align-items: center; }
.q-brand img, .q-brand-placeholder {
  width: 48px; height: 48px; border-radius: 8px; object-fit: contain;
  background: var(--q-accent); color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-family: 'Cormorant Garamond', serif; font-size: 1.4rem; font-weight: 600;
}
.q-brand h1 { font-family: 'Cormorant Garamond', serif; font-size: 1.6rem; margin: 0; }
.q-meta { text-align: right; color: var(--q-muted); font-size: 0.9rem; }
.q-meta .num { font-family: 'Cormorant Garamond', serif; font-size: 1.4rem; color: var(--q-fg); margin-bottom: 0.25rem; font-weight: 600; }

.q-section { margin: 1.5rem 0; }
.q-section h2 { font-family: 'Cormorant Garamond', serif; font-size: 1.15rem; margin: 0 0 0.5rem; font-weight: 600; letter-spacing: -0.005em; }
.q-field { display: flex; justify-content: space-between; padding: 0.35rem 0; font-size: 0.95rem; }
.q-field .label { color: var(--q-muted); }
.q-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; margin-top: 0.5rem; }
.q-table th { text-align: left; color: var(--q-muted); font-weight: 500; padding: 0.4rem 0; border-bottom: 1px solid var(--q-border); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
.q-table td { padding: 0.55rem 0; border-bottom: 1px solid var(--q-border); }
.q-table .num { text-align: right; font-variant-numeric: tabular-nums; }

.q-totals { margin-top: 1.25rem; padding-top: 1rem; border-top: 2px solid var(--q-border); }
.q-totals .row { display: flex; justify-content: space-between; padding: 0.35rem 0; font-size: 0.95rem; }
.q-totals .row.discount { color: var(--q-ok); }
.q-totals .row.grand { font-size: 1.4rem; font-weight: 600; font-family: 'Cormorant Garamond', serif; border-top: 1px solid var(--q-border); padding-top: 0.75rem; margin-top: 0.5rem; }
.q-totals .row.recurring { color: var(--q-muted); font-size: 0.85rem; }

.q-notes { background: var(--q-bg); padding: 1rem; border-radius: 8px; font-size: 0.85rem; color: var(--q-muted); white-space: pre-wrap; margin-top: 1.5rem; }

.q-actions { display: flex; gap: 0.75rem; margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid var(--q-border); }
.btn { border: none; border-radius: 8px; padding: 0.75rem 1.5rem; font-size: 1rem; font-weight: 500; cursor: pointer; font-family: inherit; transition: transform 0.1s ease, opacity 0.15s ease; }
.btn-primary { background: var(--q-accent); color: #fff; flex: 1; }
.btn-primary:hover { transform: translateY(-1px); }
.btn-ghost { background: transparent; color: var(--q-muted); border: 1px solid var(--q-border); }
.btn-ghost:hover { color: var(--q-fg); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

.q-end { text-align: center; padding: 3rem 0; }
.q-end .icon { font-size: 3rem; margin-bottom: 0.5rem; }
.q-end.ok .icon { color: var(--q-ok); }
.q-end.err .icon { color: var(--q-danger); }
.q-end h2 { font-family: 'Cormorant Garamond', serif; font-size: 1.6rem; margin: 0 0 0.5rem; }
.q-end p { color: var(--q-muted); max-width: 500px; margin: 0 auto; }

.loading { text-align: center; padding: 4rem 0; color: var(--q-muted); }
```

- [ ] **Step 3: Create `quote/js/quote.js`**

```javascript
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// Minimal Firebase init (reads config from the CRM config file on same origin)
const cfgModule = await import('../../crm/js/config.js');
const db = cfgModule.db;

const params = new URLSearchParams(window.location.search);
const token = params.get('t');
const wrap = document.getElementById('quoteWrap');

if (!token) {
  renderError('Invalid link.', 'No quote token in the URL.');
} else {
  loadQuote();
}

async function loadQuote() {
  try {
    const [viewSnap, brandSnap] = await Promise.all([
      getDoc(doc(db, 'quote_views', token)),
      getDoc(doc(db, 'settings', 'branding')).catch(() => null),
    ]);
    if (!viewSnap.exists()) {
      renderError('Quote not found.', 'This link may be invalid or the quote may have been cancelled.');
      return;
    }
    const q = viewSnap.data();
    const brand = brandSnap && brandSnap.exists() ? brandSnap.data() : {};

    // Check expiry
    if (q.validUntil) {
      const until = q.validUntil.toDate ? q.validUntil.toDate() : new Date(q.validUntil);
      if (until < new Date()) {
        renderError('Quote expired.', 'This quote is past its validity date. Please contact us for a fresh quote.');
        return;
      }
    }
    renderQuote(q, brand);
  } catch (err) {
    console.error('Load quote failed:', err);
    renderError('Something went wrong.', err.message || 'Please try again or contact us directly.');
  }
}

function renderQuote(q, brand) {
  const cs = q.customerSnapshot || {};
  const brandName = brand.businessName || 'Your Business';
  const brandLogo = brand.logoUrl;
  const accent = brand.accent || brand.primaryColor || '#4F7BF7';
  document.documentElement.style.setProperty('--q-accent', accent);

  const plan = q.priceOverride ?? q.basePrice ?? 0;
  const addonsTotal = (q.addOns || []).reduce((s, a) => s + (a.priceMonthly || 0) * (a.qty || 1), 0);
  const laborTotal = (q.laborHours || 0) * (q.laborRate || 0);
  const lineTotal = (q.lineItems || []).reduce((s, l) => s + (l.amount || 0), 0);
  const cycle = q.billingCycle === 'annual' ? 'yr' : 'mo';
  const fullDate = q.validUntil ? (q.validUntil.toDate ? q.validUntil.toDate() : new Date(q.validUntil)) : null;

  wrap.innerHTML = `
    <header class="q-header">
      <div class="q-brand">
        ${brandLogo ? `<img src="${escapeAttr(brandLogo)}" alt="${escapeAttr(brandName)}">` : `<div class="q-brand-placeholder">${escapeHtml(brandName.charAt(0))}</div>`}
        <h1>${escapeHtml(brandName)}</h1>
      </div>
      <div class="q-meta">
        <div class="num">${escapeHtml(q.quoteNumber || '-')}</div>
        ${fullDate ? `<div>Valid until ${escapeHtml(fullDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }))}</div>` : ''}
      </div>
    </header>

    <section class="q-section">
      <h2>Prepared for</h2>
      <div class="q-field"><span class="label">Name</span><span>${escapeHtml((cs.firstName || '') + ' ' + (cs.lastName || ''))}</span></div>
      ${cs.company ? `<div class="q-field"><span class="label">Company</span><span>${escapeHtml(cs.company)}</span></div>` : ''}
      ${cs.email ? `<div class="q-field"><span class="label">Email</span><span>${escapeHtml(cs.email)}</span></div>` : ''}
      ${cs.phone ? `<div class="q-field"><span class="label">Phone</span><span>${escapeHtml(cs.phone)}</span></div>` : ''}
    </section>

    ${plan > 0 ? `
    <section class="q-section">
      <h2>Plan</h2>
      <table class="q-table">
        <tr><td>${escapeHtml(q.tier || 'Subscription')}</td><td class="num">${money(plan)}/${cycle}</td></tr>
        ${(q.addOns || []).map(a => `<tr><td style="color:var(--q-muted);padding-left:1rem;">+ ${escapeHtml(a.name)}${a.qty > 1 ? ` × ${a.qty}` : ''}</td><td class="num">${money((a.priceMonthly || 0) * (a.qty || 1))}/${cycle}</td></tr>`).join('')}
      </table>
    </section>` : ''}

    ${(laborTotal > 0 || lineTotal > 0) ? `
    <section class="q-section">
      <h2>One-time work</h2>
      <table class="q-table">
        <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
        <tbody>
          ${laborTotal > 0 ? `<tr><td>${escapeHtml(q.laborDescription || 'Labor')} </td><td class="num">${q.laborHours}</td><td class="num">${money(q.laborRate)}</td><td class="num">${money(laborTotal)}</td></tr>` : ''}
          ${(q.lineItems || []).map(l => `<tr><td>${escapeHtml(l.description || '')}</td><td class="num">${l.quantity || 0}</td><td class="num">${money(l.rate || 0)}</td><td class="num">${money(l.amount || 0)}</td></tr>`).join('')}
        </tbody>
      </table>
    </section>` : ''}

    <div class="q-totals">
      <div class="row"><span>Subtotal</span><span class="num">${money(q.subtotal || 0)}</span></div>
      ${q.discount && q.discount.amount > 0 ? `<div class="row discount"><span>Discount — ${escapeHtml(q.discount.reason || '')}</span><span class="num">-${money(q.discount.amount)}</span></div>` : ''}
      <div class="row grand"><span>Total today</span><span class="num">${money(q.total || 0)}</span></div>
      ${(plan + addonsTotal) > 0 ? `<div class="row recurring"><span>Recurring</span><span class="num">${money(plan + addonsTotal)}/${cycle}</span></div>` : ''}
    </div>

    ${q.notes ? `<div class="q-notes">${escapeHtml(q.notes)}</div>` : ''}

    <div class="q-actions">
      <button class="btn btn-ghost" id="declineBtn">Decline</button>
      <button class="btn btn-primary" id="acceptBtn">Accept Quote</button>
    </div>
  `;

  wrap.querySelector('#acceptBtn').addEventListener('click', () => respond('accepted'));
  wrap.querySelector('#declineBtn').addEventListener('click', () => respond('declined'));
}

async function respond(response) {
  const btn = document.getElementById(response === 'accepted' ? 'acceptBtn' : 'declineBtn');
  btn.disabled = true;

  let signatureName = '';
  if (response === 'accepted') {
    signatureName = prompt('Please type your full name to accept this quote:') || '';
    if (!signatureName.trim()) { btn.disabled = false; return; }
  }

  try {
    await setDoc(doc(db, 'quote_responses', token), {
      token,
      response,
      signatureName: signatureName.trim(),
      respondedAt: serverTimestamp(),
      userAgent: navigator.userAgent,
    });
    renderEnd(response);
  } catch (err) {
    console.error('Respond failed:', err);
    renderError('Could not submit.', err.message || 'Please try again.');
  }
}

function renderEnd(response) {
  if (response === 'accepted') {
    wrap.innerHTML = `
      <div class="q-end ok">
        <div class="icon">✓</div>
        <h2>Quote accepted</h2>
        <p>Your account is being set up. You'll receive an email shortly with your login details. Thanks!</p>
      </div>
    `;
  } else {
    wrap.innerHTML = `
      <div class="q-end">
        <div class="icon">×</div>
        <h2>Quote declined</h2>
        <p>Thanks for your time. If you change your mind, contact us for a fresh quote.</p>
      </div>
    `;
  }
}

function renderError(title, detail) {
  wrap.innerHTML = `
    <div class="q-end err">
      <div class="icon">!</div>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(detail)}</p>
    </div>
  `;
}

function money(n) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0); }
function escapeHtml(s) { if (s == null) return ''; const d = document.createElement('span'); d.textContent = String(s); return d.innerHTML; }
function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }
```

- [ ] **Step 4: Update CSP in `_headers` to permit the quote page**

Add to `_headers`:

```
/quote.html
  Content-Security-Policy: default-src 'self'; script-src 'self' https://www.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://identitytoolkit.googleapis.com; img-src 'self' data: https:; frame-ancestors 'none'
  Cache-Control: no-store, no-cache, must-revalidate, max-age=0

/quote/*
  Cache-Control: no-store, no-cache, must-revalidate, max-age=0
```

- [ ] **Step 5: Commit**

```bash
git add quote.html quote/ _headers
git commit -m "feat: public quote page with accept/decline flow"
```

---

### Task 8: Acceptance listener + auto-provisioning

**Files:**
- Modify: `crm/js/main.js`

Set up the response listener on admin login. When a response arrives, run the provisioning transaction.

- [ ] **Step 1: Add imports to main.js**

Near the existing imports, add:

```javascript
import { subscribeToResponses, getQuote } from './services/quotes.js';
import { enforceCancellations } from './services/subscription.js';
import { createTenant, addTenantActivity, addTenantInvoice, addTenantUser } from './services/tenants.js';
import { doc, getDoc, updateDoc, setDoc, deleteDoc, serverTimestamp, runTransaction, Timestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { db } from './config.js';
```

- [ ] **Step 2: Add handler functions**

Add near the bottom of `main.js`:

```javascript
async function handleQuoteAccepted(responseId, responseData) {
  const responseRef = doc(db, 'quote_responses', responseId);
  // Claim the response atomically — prevents double-processing across tabs
  const claimed = await runTransaction(db, async (tx) => {
    const snap = await tx.get(responseRef);
    if (!snap.exists()) return false;
    const data = snap.data();
    if (data.processedAt) return false;
    tx.update(responseRef, { processedAt: serverTimestamp() });
    return true;
  });
  if (!claimed) return;

  // Find the matching quote
  const { collection: col, query: q, where: w, getDocs: gd } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
  const quoteSnap = await gd(q(col(db, 'quotes'), w('publicToken', '==', responseData.token)));
  if (quoteSnap.empty) { console.warn('No quote found for token', responseData.token); return; }
  const quoteDoc = quoteSnap.docs[0];
  const quote = quoteDoc.data();
  if (quote.status === 'provisioned') return; // already done

  try {
    // Flip quote status so the CRM shows "Accepted — provisioning..."
    await updateDoc(quoteDoc.ref, {
      status: 'accepted', acceptedAt: serverTimestamp(), signatureName: responseData.signatureName || '',
    });

    // Compute current period
    const now = new Date();
    const end = new Date(now);
    if (quote.billingCycle === 'annual') end.setFullYear(end.getFullYear() + 1);
    else end.setMonth(end.getMonth() + 1);

    const { getPackage } = await import('./services/catalog.js');
    const pkg = quote.packageId ? await getPackage(quote.packageId) : null;

    // Create the tenant
    const tenantRef = await createTenant({
      companyName: quote.customerSnapshot?.company || `${quote.customerSnapshot?.firstName || ''} ${quote.customerSnapshot?.lastName || ''}`.trim() || 'New Tenant',
      vertical: quote.vertical,
      packageId: quote.packageId,
      tier: quote.tier,
      addOns: quote.addOns || [],
      priceOverride: quote.priceOverride,
      billingCycle: quote.billingCycle,
      status: 'active',
      gracePeriodEnd: null,
      features: pkg?.features || [],
      featureOverrides: {},
      userLimit: pkg?.userLimit || 0,
      ownerUserId: '',
      contactId: quote.contactId || '',
      companyId: '',
      dealId: null,
      quoteId: quoteDoc.id,
      currentPeriodStart: Timestamp.fromDate(now),
      currentPeriodEnd: Timestamp.fromDate(end),
      cancelAt: null,
      scheduledChange: null,
      trialEndsAt: null,
      onboardingStep: 'pending',
      dataExportRequested: false,
      dataExportGeneratedAt: null,
    });
    const tenantId = tenantRef.id;

    // Seed settings (laborRate, taxRate, warrantyDays, currency, timezone)
    const { setDoc: sd, doc: dc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    await sd(dc(db, `tenants/${tenantId}/settings/general`), {
      laborRate: quote.laborRate || 0, taxRate: 0, warrantyDays: 90, currency: 'USD', timezone: 'America/Chicago',
      createdAt: serverTimestamp(),
    });

    // Create owner user placeholder + user_tenants mapping (so portal finds them)
    const ownerEmail = quote.customerSnapshot?.email || '';
    if (ownerEmail) {
      await addTenantUser(tenantId, `pending_${Date.now()}`, {
        email: ownerEmail,
        displayName: `${quote.customerSnapshot?.firstName || ''} ${quote.customerSnapshot?.lastName || ''}`.trim(),
        role: 'owner', status: 'pending', invitedBy: 'system',
      });
      const emailKey = ownerEmail.toLowerCase().trim();
      await sd(dc(db, 'user_tenants', emailKey), {
        tenantId, email: ownerEmail, role: 'owner',
        companyName: quote.customerSnapshot?.company || '',
        createdAt: serverTimestamp(),
      });
    }

    // Build first invoice line items: labor + line items + first recurring period + discount
    const lineItems = [];
    const laborAmount = (quote.laborHours || 0) * (quote.laborRate || 0);
    if (laborAmount > 0) lineItems.push({ description: quote.laborDescription || 'Setup / implementation', quantity: quote.laborHours, rate: quote.laborRate, amount: laborAmount });
    (quote.lineItems || []).forEach(li => lineItems.push(li));
    const planPrice = quote.priceOverride ?? quote.basePrice ?? 0;
    if (planPrice > 0) lineItems.push({
      description: `${pkg?.name || 'Subscription'} — first ${quote.billingCycle === 'annual' ? 'year' : 'month'}`,
      quantity: 1, rate: planPrice, amount: planPrice,
    });
    (quote.addOns || []).forEach(a => {
      const mo = (a.priceMonthly || 0) * (a.qty || 1);
      if (mo > 0) lineItems.push({
        description: `Add-on: ${a.name}${a.qty > 1 ? ` × ${a.qty}` : ''} — first ${quote.billingCycle === 'annual' ? 'year' : 'month'}`,
        quantity: 1, rate: mo, amount: mo,
      });
    });
    if (quote.discount && quote.discount.amount > 0) {
      lineItems.push({
        description: `Discount — ${quote.discount.reason || ''}`,
        quantity: 1, rate: -quote.discount.amount, amount: -quote.discount.amount, isDiscount: true,
      });
    }
    const total = lineItems.reduce((s, l) => s + (l.amount || 0), 0);

    const invoiceRef = await addTenantInvoice(tenantId, {
      invoiceNumber: `INV-T-${Date.now().toString().slice(-6)}`,
      type: 'charge',
      amount: total, total,
      status: 'sent',
      issuedDate: serverTimestamp(),
      dueDate: Timestamp.fromDate(new Date(Date.now() + 14 * 86400000)),
      lineItems,
      reason: `First invoice from quote ${quote.quoteNumber}`,
    });

    await addTenantActivity(tenantId, {
      type: 'quote_accepted',
      description: `Provisioned from quote ${quote.quoteNumber}`,
      metadata: { quoteId: quoteDoc.id, invoiceId: invoiceRef.id, signatureName: responseData.signatureName || '' },
    });

    // Update quote as provisioned
    await updateDoc(quoteDoc.ref, {
      status: 'provisioned',
      provisionedAt: serverTimestamp(),
      tenantId,
      invoiceId: invoiceRef.id,
    });

    // Delete the public view so the URL stops exposing pricing
    try { await deleteDoc(doc(db, 'quote_views', responseData.token)); } catch {}

    showToast(`Tenant provisioned from quote ${quote.quoteNumber}`, 'success');
  } catch (err) {
    console.error('Provisioning failed:', err);
    // Flip quote so admin can retry
    await updateDoc(quoteDoc.ref, {
      status: 'accepted', // stays accepted but not provisioned
      provisioningError: err.message || String(err),
    });
    showToast('Provisioning failed — see Quotes list', 'error');
  }
}

async function handleQuoteDeclined(responseId, responseData) {
  const responseRef = doc(db, 'quote_responses', responseId);
  const claimed = await runTransaction(db, async (tx) => {
    const snap = await tx.get(responseRef);
    if (!snap.exists()) return false;
    if (snap.data().processedAt) return false;
    tx.update(responseRef, { processedAt: serverTimestamp() });
    return true;
  });
  if (!claimed) return;

  const { collection: col, query: q, where: w, getDocs: gd } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
  const quoteSnap = await gd(q(col(db, 'quotes'), w('publicToken', '==', responseData.token)));
  if (quoteSnap.empty) return;
  await updateDoc(quoteSnap.docs[0].ref, { status: 'declined', declinedAt: serverTimestamp() });
  try { await deleteDoc(doc(db, 'quote_views', responseData.token)); } catch {}
  showToast(`Quote declined`, 'info');
}
```

- [ ] **Step 3: Start the listener after admin bootstrap**

In the `.then(role => { ... })` block where admin features are shown, add at the end:

```javascript
      // Start listening for quote responses + enforce scheduled cancellations
      subscribeToResponses(handleQuoteAccepted, handleQuoteDeclined);
      enforceCancellations().catch(err => console.error('Cancellation sweep failed:', err));
```

- [ ] **Step 4: Manual check**

Reload CRM. Open browser console. Verify no errors on bootstrap. Create a quote, send it, open the public URL in incognito, accept it. Watch the CRM's quote list — it should flip to "accepted" then "provisioned" within a few seconds. A new tenant should appear in the Tenants list with the first invoice attached.

- [ ] **Step 5: Commit**

```bash
git add crm/js/main.js
git commit -m "feat(crm): quote acceptance listener with auto-provisioning"
```

---

### Task 9: Tenant detail — Subscription section

**Files:**
- Modify: `crm/js/views/tenants.js`

Add the Subscription section with the 4 actions: Add Add-on, Remove Add-on, Change Plan, Cancel.

- [ ] **Step 1: Add the Subscription section to the tenant detail view**

Find the function that renders the tenant detail (usually `showDetail` or `renderDetail`). After the existing account/plan display, insert a Subscription section that calls the subscription service. Example insertion (adapt function names and selectors to the existing file):

```javascript
import {
  addAddOn, removeAddOn, changePlan, cancelNow, cancelAtPeriodEnd,
  previewAddAddOn, previewRemoveAddOn, previewChangePlan, previewCancelNow,
  prorationRatio,
} from '../services/subscription.js';
import { getAddons, getPackages } from '../services/catalog.js';

// In the function that renders tenant detail, after current plan section:
async function renderSubscriptionSection(tenant, container) {
  const section = document.createElement('div');
  section.className = 'settings-section';
  section.style.marginTop = '1.5rem';

  const ratio = prorationRatio(tenant.currentPeriodStart, tenant.currentPeriodEnd);
  const start = tenant.currentPeriodStart?.toDate ? tenant.currentPeriodStart.toDate() : null;
  const end = tenant.currentPeriodEnd?.toDate ? tenant.currentPeriodEnd.toDate() : null;
  const daysRemaining = end ? Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86400000)) : 0;

  section.innerHTML = `
    <h3 class="section-title">Subscription</h3>
    <div class="detail-field"><div class="detail-field-label">Current period</div><div class="detail-field-value">${start && end ? `${start.toLocaleDateString()} – ${end.toLocaleDateString()} · ${daysRemaining} days remaining` : '—'}</div></div>
    ${tenant.cancelAt ? `<div class="detail-field"><div class="detail-field-label" style="color:#d97706;">Cancels on</div><div class="detail-field-value">${tenant.cancelAt.toDate ? tenant.cancelAt.toDate().toLocaleDateString() : '—'}</div></div>` : ''}

    <h4 style="margin:1rem 0 0.5rem;font-size:0.95rem;">Add-ons</h4>
    <div id="addonsList"></div>
    <button class="btn btn-ghost btn-sm" id="addAddonBtn" style="margin-top:0.5rem;">+ Add Add-on</button>

    <div style="margin-top:1.5rem;display:flex;gap:0.5rem;">
      <button class="btn btn-ghost" id="changePlanBtn">Change Plan</button>
      <button class="btn btn-ghost" id="cancelSubBtn" style="color:var(--danger);margin-left:auto;">Cancel Subscription</button>
    </div>
  `;
  container.appendChild(section);

  // Render add-ons
  const listEl = section.querySelector('#addonsList');
  if (!tenant.addOns || tenant.addOns.length === 0) {
    listEl.innerHTML = '<p style="color:var(--gray-dark);font-size:0.9rem;">No add-ons.</p>';
  } else {
    listEl.innerHTML = '<table class="data-table"><thead><tr><th>Name</th><th>Qty</th><th>Monthly</th><th></th></tr></thead><tbody>' +
      tenant.addOns.map(a => `
        <tr>
          <td>${escapeHtml(a.name)}</td>
          <td>${a.qty || 1}</td>
          <td>${formatCurrency((a.priceMonthly || 0) * (a.qty || 1))}</td>
          <td><button class="btn btn-ghost btn-sm remove-addon" data-slug="${escapeHtml(a.slug)}" style="color:var(--danger);">Remove</button></td>
        </tr>
      `).join('') + '</tbody></table>';
  }

  // Wire handlers
  listEl.querySelectorAll('.remove-addon').forEach(btn => {
    btn.addEventListener('click', async () => {
      const slug = btn.dataset.slug;
      const preview = previewRemoveAddOn(tenant, slug);
      if (!preview) return;
      const msg = `Remove ${preview.addon.name}?\n\nYou'll issue a credit of ${formatCurrency(preview.refund)} (${preview.addon.priceMonthly}/mo × ${(preview.ratio * 100).toFixed(1)}% of billing period remaining).\n\nContinue?`;
      if (!confirm(msg)) return;
      try {
        await removeAddOn(tenant.id, slug);
        showToast('Add-on removed', 'success');
        // Re-render tenant detail
        location.reload(); // simplest; could be refined to a soft reload of the view
      } catch (err) { showToast('Failed: ' + err.message, 'error'); }
    });
  });

  section.querySelector('#addAddonBtn').addEventListener('click', async () => {
    const allAddons = await getAddons();
    const current = new Set((tenant.addOns || []).map(a => a.slug));
    const available = allAddons.filter(a => !current.has(a.slug) && a.active !== false);
    if (available.length === 0) { showToast('No more add-ons available', 'info'); return; }
    const slug = prompt('Add-on slug? Available:\n\n' + available.map(a => `- ${a.slug}: ${a.name} (${formatCurrency(a.priceMonthly)}/mo)`).join('\n'));
    if (!slug) return;
    const addon = available.find(a => a.slug === slug.trim());
    if (!addon) { showToast('Unknown add-on', 'error'); return; }
    let qty = 1;
    if (addon.pricingModel === 'per_unit') {
      qty = Number(prompt('Quantity?', '1')) || 1;
    }
    const preview = previewAddAddOn(tenant, { ...addon, qty });
    const fee = 25; // matches default from subscription.js
    const msg = `Add ${addon.name}${qty > 1 ? ` × ${qty}` : ''}?\n\n` +
      `Prorated: ${formatCurrency(preview.prorated)} (${(preview.ratio * 100).toFixed(1)}% of period remaining)\n` +
      `Implementation fee: ${formatCurrency(fee)}\n` +
      `Total: ${formatCurrency(preview.prorated + fee)}\n\n` +
      `An invoice will be created and sent. Continue?`;
    if (!confirm(msg)) return;
    try {
      await addAddOn(tenant.id, { ...addon, qty });
      showToast('Add-on added', 'success');
      location.reload();
    } catch (err) { showToast('Failed: ' + err.message, 'error'); }
  });

  section.querySelector('#changePlanBtn').addEventListener('click', async () => {
    const allPkgs = await getPackages();
    const same = allPkgs.filter(p => p.vertical === tenant.vertical && p.id !== tenant.packageId && p.active !== false);
    if (same.length === 0) { showToast('No other packages for this vertical', 'info'); return; }
    const id = prompt('New package? Available:\n\n' + same.map(p => `- ${p.id}: ${p.name} · ${formatCurrency(p.basePrice)}/mo`).join('\n'));
    if (!id) return;
    const preview = await previewChangePlan(tenant, id.trim()).catch(e => { showToast(e.message, 'error'); return null; });
    if (!preview) return;
    const msg = `Change to ${preview.newPkg.name}?\n\n` +
      `Refund previous: ${formatCurrency(preview.refund)}\n` +
      `Charge new (prorated): ${formatCurrency(preview.charge)}\n` +
      `Net: ${preview.net >= 0 ? 'charge ' : 'credit '}${formatCurrency(Math.abs(preview.net))}\n\nContinue?`;
    if (!confirm(msg)) return;
    try {
      await changePlan(tenant.id, id.trim());
      showToast('Plan changed', 'success');
      location.reload();
    } catch (err) { showToast('Failed: ' + err.message, 'error'); }
  });

  section.querySelector('#cancelSubBtn').addEventListener('click', async () => {
    const choice = prompt('Cancel subscription:\n\n1. End of period (no refund)\n2. Cancel now (prorated refund)\n\nEnter 1 or 2:');
    if (choice === '1') {
      await cancelAtPeriodEnd(tenant.id);
      showToast('Cancellation scheduled', 'success');
      location.reload();
    } else if (choice === '2') {
      const preview = previewCancelNow(tenant);
      if (!confirm(`Cancel now with refund of ${formatCurrency(preview.refund)}?`)) return;
      try {
        await cancelNow(tenant.id);
        showToast('Subscription cancelled', 'success');
        location.reload();
      } catch (err) { showToast('Failed: ' + err.message, 'error'); }
    }
  });
}
```

Call `renderSubscriptionSection(tenant, container)` from wherever the tenant detail renders.

- [ ] **Step 2: Manual check**

Open a tenant, see the Subscription section with current period, add-ons, and three action buttons. Click each in turn (use test data) and verify the preview math in the prompt.

- [ ] **Step 3: Commit**

```bash
git add crm/js/views/tenants.js
git commit -m "feat(crm): tenant subscription management section with proration"
```

---

### Task 10: Customers view (replaces Contacts)

**Files:**
- Modify: `crm/js/views/contacts.js` → rename displayed label + show company column; OR create `crm/js/views/customers.js` that re-exports the same module

Simplest path: keep the file as `contacts.js` (code-side) but register it under the new label in the sidebar. Add company column to the list table.

- [ ] **Step 1: Add the company column**

Find the contacts list rendering in `crm/js/views/contacts.js`. The table probably shows Name / Email / Phone. Add a Company column:

```javascript
// Update the table <thead>:
table.innerHTML = '<thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Company</th></tr></thead>';

// Update each row to add the company cell:
tr.innerHTML = `
  <td style="font-weight:500;">${escapeHtml(displayName)}</td>
  <td>${escapeHtml(c.email || '\u2014')}</td>
  <td>${escapeHtml(c.phone || '\u2014')}</td>
  <td>${escapeHtml(c.company || '\u2014')}</td>
`;
```

- [ ] **Step 2: Add "Other contacts at {company}" on the contact detail**

In the contact detail rendering, after the existing field rendering, add:

```javascript
// If this contact has a company, show other contacts at the same company
if (contact.company) {
  const sameCompany = allContacts.filter(c =>
    c.id !== contact.id &&
    (c.company || '').toLowerCase() === contact.company.toLowerCase()
  );
  if (sameCompany.length > 0) {
    const section = document.createElement('div');
    section.className = 'settings-section';
    section.style.marginTop = '1rem';
    section.innerHTML = `
      <h3 class="section-title">Other contacts at ${escapeHtml(contact.company)}</h3>
      <table class="data-table"><tbody>${sameCompany.map(c => `
        <tr class="clickable" data-id="${c.id}">
          <td>${escapeHtml((c.firstName || '') + ' ' + (c.lastName || ''))}</td>
          <td>${escapeHtml(c.email || c.phone || '-')}</td>
        </tr>`).join('')}</tbody></table>
    `;
    container.appendChild(section);
    section.querySelectorAll('tr[data-id]').forEach(tr => {
      tr.addEventListener('click', () => {
        const c = allContacts.find(x => x.id === tr.dataset.id);
        if (c) showDetail(c);
      });
    });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add crm/js/views/contacts.js
git commit -m "feat(crm): customers view — company column + sibling contacts"
```

---

### Task 11: Universal search

**Files:**
- Create: `crm/js/services/search.js`
- Create: `crm/js/components/universal-search.js`

Cross-collection search with keyboard navigation.

- [ ] **Step 1: Create the search service**

```javascript
// crm/js/services/search.js
import { db } from '../config.js';
import { collection, getDocs, query, orderBy, limit, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

let cache = { contacts: [], quotes: [], invoices: [], tenants: [], loadedAt: 0 };
const TTL_MS = 60000; // 1 minute cache

export async function primeSearchCache() {
  const now = Date.now();
  if (now - cache.loadedAt < TTL_MS) return cache;

  const [cs, qs, is, ts] = await Promise.all([
    getDocs(query(collection(db, 'contacts'), orderBy('lastName', 'asc'), limit(2000))).catch(() => ({ docs: [] })),
    getDocs(query(collection(db, 'quotes'), orderBy('createdAt', 'desc'), limit(500))).catch(() => ({ docs: [] })),
    getDocs(query(collection(db, 'invoices'), orderBy('createdAt', 'desc'), limit(500))).catch(() => ({ docs: [] })),
    getDocs(query(collection(db, 'tenants'), orderBy('createdAt', 'desc'), limit(500))).catch(() => ({ docs: [] })),
  ]);
  cache = {
    contacts: cs.docs.map(d => ({ id: d.id, ...d.data() })),
    quotes: qs.docs.map(d => ({ id: d.id, ...d.data() })),
    invoices: is.docs.map(d => ({ id: d.id, ...d.data() })),
    tenants: ts.docs.map(d => ({ id: d.id, ...d.data() })),
    loadedAt: now,
  };
  return cache;
}

export async function universalSearch(q) {
  const needle = q.trim().toLowerCase();
  if (!needle) return { contacts: [], quotes: [], invoices: [], tenants: [] };
  const data = await primeSearchCache();
  const digits = needle.replace(/\D/g, '');

  const contacts = data.contacts.filter(c =>
    ((c.firstName || '') + ' ' + (c.lastName || '')).toLowerCase().includes(needle) ||
    (c.email || '').toLowerCase().includes(needle) ||
    (c.company || '').toLowerCase().includes(needle) ||
    (digits && (c.phone || '').replace(/\D/g, '').includes(digits))
  ).slice(0, 8);

  const quotes = data.quotes.filter(qq =>
    (qq.quoteNumber || '').toLowerCase().includes(needle) ||
    (((qq.customerSnapshot?.firstName || '') + ' ' + (qq.customerSnapshot?.lastName || '') + ' ' + (qq.customerSnapshot?.company || '')).toLowerCase().includes(needle)) ||
    (qq.customerSnapshot?.email || '').toLowerCase().includes(needle)
  ).slice(0, 5);

  const invoices = data.invoices.filter(i =>
    (i.invoiceNumber || '').toLowerCase().includes(needle) ||
    (i.clientName || '').toLowerCase().includes(needle)
  ).slice(0, 5);

  const tenants = data.tenants.filter(t =>
    (t.companyName || '').toLowerCase().includes(needle)
  ).slice(0, 5);

  // Doc-ID lookup if query looks like a Firestore auto-ID
  if (/^[A-Za-z0-9]{18,25}$/.test(q.trim())) {
    const id = q.trim();
    const lookups = await Promise.all([
      getDoc(doc(db, 'contacts', id)).catch(() => null),
      getDoc(doc(db, 'quotes', id)).catch(() => null),
      getDoc(doc(db, 'tenants', id)).catch(() => null),
    ]);
    if (lookups[0] && lookups[0].exists() && !contacts.find(c => c.id === id)) contacts.unshift({ id, ...lookups[0].data() });
    if (lookups[1] && lookups[1].exists() && !quotes.find(q => q.id === id)) quotes.unshift({ id, ...lookups[1].data() });
    if (lookups[2] && lookups[2].exists() && !tenants.find(t => t.id === id)) tenants.unshift({ id, ...lookups[2].data() });
  }

  return { contacts, quotes, invoices, tenants };
}

export function invalidateSearchCache() { cache.loadedAt = 0; }
```

- [ ] **Step 2: Create the universal-search component**

```javascript
// crm/js/components/universal-search.js
import { universalSearch, primeSearchCache } from '../services/search.js';
import { navigate } from '../router.js';
import { escapeHtml, formatCurrency } from '../ui.js';

let panelOpen = false;
let flatResults = [];
let activeIdx = -1;

export function mountUniversalSearch() {
  const host = document.getElementById('headerActions');
  if (!host) return;

  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;flex:1;max-width:520px;';
  wrap.innerHTML = `
    <input type="search" id="usSearchInput" placeholder="Search — customers, quotes, invoices, tenants…  ( / )" style="width:100%;padding:0.55rem 0.9rem;border:1px solid var(--off-white);border-radius:8px;font-size:0.9rem;background:#fff;">
    <div id="usPanel" style="display:none;position:absolute;top:110%;left:0;right:0;background:#fff;border:1px solid var(--off-white);border-radius:10px;box-shadow:0 16px 40px rgba(15,23,42,0.08);z-index:500;max-height:400px;overflow-y:auto;"></div>
  `;
  host.appendChild(wrap);

  const input = wrap.querySelector('#usSearchInput');
  const panel = wrap.querySelector('#usPanel');

  primeSearchCache();

  input.addEventListener('input', async () => {
    const q = input.value.trim();
    if (!q) { panel.style.display = 'none'; panelOpen = false; return; }
    const results = await universalSearch(q);
    renderResults(panel, results);
    panel.style.display = 'block';
    panelOpen = true;
    activeIdx = -1;
  });

  input.addEventListener('keydown', (e) => {
    if (!panelOpen) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(flatResults.length - 1, activeIdx + 1); updateActive(panel); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(0, activeIdx - 1); updateActive(panel); }
    else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); selectResult(flatResults[activeIdx]); }
    else if (e.key === 'Escape') { panel.style.display = 'none'; panelOpen = false; input.blur(); }
  });

  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) { panel.style.display = 'none'; panelOpen = false; }
  });

  // Global keybindings: "/" and Cmd/Ctrl+K
  document.addEventListener('keydown', (e) => {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if ((e.key === '/' && !inField) || ((e.metaKey || e.ctrlKey) && e.key === 'k')) {
      e.preventDefault();
      input.focus(); input.select();
    }
  });
}

function renderResults(panel, results) {
  flatResults = [];
  let html = '';
  const sections = [
    { key: 'contacts', label: 'Customers', items: results.contacts, render: c => `${escapeHtml((c.firstName || '') + ' ' + (c.lastName || ''))} · ${escapeHtml(c.email || c.phone || '—')}${c.company ? ' · ' + escapeHtml(c.company) : ''}` },
    { key: 'quotes', label: 'Quotes', items: results.quotes, render: q => `${escapeHtml(q.quoteNumber)} · ${escapeHtml((q.customerSnapshot?.firstName || '') + ' ' + (q.customerSnapshot?.lastName || ''))} · ${formatCurrency(q.total)} · ${escapeHtml(q.status || 'draft')}` },
    { key: 'invoices', label: 'Invoices', items: results.invoices, render: i => `${escapeHtml(i.invoiceNumber || '-')} · ${escapeHtml(i.clientName || '-')} · ${formatCurrency(i.total)} · ${escapeHtml(i.status || 'draft')}` },
    { key: 'tenants', label: 'Tenants', items: results.tenants, render: t => `${escapeHtml(t.companyName || '-')} · ${escapeHtml(t.status || '-')}` },
  ];
  for (const sec of sections) {
    if (sec.items.length === 0) continue;
    html += `<div style="padding:0.35rem 0.9rem;font-size:0.7rem;color:var(--gray-dark);text-transform:uppercase;letter-spacing:0.05em;font-weight:600;background:#fafafa;border-bottom:1px solid var(--off-white);">${sec.label}</div>`;
    sec.items.forEach(item => {
      const idx = flatResults.length;
      flatResults.push({ kind: sec.key, item });
      html += `<div class="us-row" data-idx="${idx}" style="padding:0.55rem 0.9rem;cursor:pointer;border-bottom:1px solid var(--off-white);font-size:0.9rem;">${sec.render(item)}</div>`;
    });
  }
  if (flatResults.length === 0) {
    html = '<div style="padding:1rem;color:var(--gray-dark);font-size:0.9rem;">No results.</div>';
  }
  panel.innerHTML = html;
  panel.querySelectorAll('.us-row').forEach(row => {
    row.addEventListener('mouseenter', () => { activeIdx = Number(row.dataset.idx); updateActive(panel); });
    row.addEventListener('click', () => selectResult(flatResults[Number(row.dataset.idx)]));
  });
}

function updateActive(panel) {
  panel.querySelectorAll('.us-row').forEach((row, i) => {
    row.style.background = i === activeIdx ? 'var(--off-white)' : '';
  });
}

function selectResult({ kind, item }) {
  const input = document.getElementById('usSearchInput');
  const panel = document.getElementById('usPanel');
  input.value = '';
  panel.style.display = 'none';
  panelOpen = false;

  // Navigate using the router + deep-link state
  if (kind === 'contacts') {
    navigate('contacts');
    // Best-effort scroll/select via location hash + timeout
    setTimeout(() => {
      const row = document.querySelector(`[data-contact-id="${item.id}"]`);
      if (row) row.click();
    }, 200);
  } else if (kind === 'quotes') {
    navigate('quotes');
    setTimeout(() => {
      import('../views/quote-builder.js').then(m => m.openBuilder(item.id));
    }, 100);
  } else if (kind === 'invoices') {
    navigate('invoices');
  } else if (kind === 'tenants') {
    navigate('tenants');
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add crm/js/services/search.js crm/js/components/universal-search.js
git commit -m "feat(crm): universal search service + header component"
```

---

### Task 12: Sidebar restructure, header search mount, register quotes view

**Files:**
- Modify: `crm/app.html`
- Modify: `crm/js/main.js`

- [ ] **Step 1: Update sidebar in `crm/app.html`**

Find the sidebar nav. Rename sections and items per the spec:

```
Overview
  Dashboard

Customers & Sales
  Customers       (was Contacts — change label + data-view if needed)
  Quotes          (new item; data-view="quotes")
  Invoices
  Subscriptions
  Tasks

(Remove Companies link entirely)

Platform
  Tenants
  Packages
  Renewals

Admin
  Settings
```

Remove the Companies `<button>` or `<a>` from the nav. Add a Quotes nav item with the appropriate icon. Rename "Contacts" label to "Customers" (keep the `data-view` value as `contacts` to avoid breaking the existing view registration — only the user-visible label changes).

Also add the search host to the header:

```html
<header class="app-header">
  <button class="menu-toggle" id="menuToggle">☰</button>
  <h1 id="headerTitle">Dashboard</h1>
  <div id="headerActions" style="display:flex;align-items:center;gap:0.75rem;flex:1;justify-content:flex-end;"></div>
</header>
```

- [ ] **Step 2: Register the quotes view + mount search in main.js**

Add the import near the top:

```javascript
import * as quotesView from './views/quotes.js';
import { mountUniversalSearch } from './components/universal-search.js';
```

Find where other views are registered (e.g. `registerView('contacts', ...)`) and add:

```javascript
registerView('quotes', {
  init: quotesView.init,
  render() { document.getElementById('headerTitle').textContent = 'Quotes'; quotesView.render(); },
  destroy: quotesView.destroy,
});
```

In the bootstrap `.then(role => { ... })` where the nav is shown (after admin check passes), add at the end:

```javascript
      mountUniversalSearch();
```

Add a view container for quotes in the HTML if missing:

```html
<div id="view-quotes" class="view-container"></div>
```

- [ ] **Step 3: Manual check**

Reload CRM. Sidebar shows new labels. Click Quotes → opens the list. Header shows search input. Press `/` → search focuses.

- [ ] **Step 4: Commit**

```bash
git add crm/app.html crm/js/main.js
git commit -m "feat(crm): restructured sidebar + Quotes view + header search"
```

---

### Task 13: Migration + end-to-end verification

**Files:**
- Modify: `crm/js/main.js` (add one-time migration on admin load)

Copy `companyId → contact.company` string, and migrate `deals` with `status=won` into `quotes` as `provisioned`.

- [ ] **Step 1: Add migration helper**

Near the handler functions in main.js, add:

```javascript
async function runCompaniesMigration() {
  const { getDoc: gd, setDoc: sd, doc: dc, updateDoc: ud, collection: col, getDocs: gds, serverTimestamp: ts } =
    await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
  const flagRef = dc(db, 'settings', 'migrations');
  const flagSnap = await gd(flagRef);
  const flags = flagSnap.exists() ? flagSnap.data() : {};
  if (flags.companiesToContactStrings) return;

  console.log('[migration] Starting companies→contact.company …');
  const contactsSnap = await gds(col(db, 'contacts'));
  const companiesSnap = await gds(col(db, 'companies')).catch(() => ({ docs: [] }));
  const companyMap = {};
  companiesSnap.docs.forEach(d => { companyMap[d.id] = d.data().name || ''; });

  let migrated = 0;
  for (const c of contactsSnap.docs) {
    const data = c.data();
    if (data.company) continue; // already has string
    if (!data.companyId) continue;
    const name = companyMap[data.companyId];
    if (!name) continue;
    await ud(dc(db, 'contacts', c.id), { company: name });
    migrated += 1;
  }
  await sd(flagRef, { companiesToContactStrings: { ranAt: ts(), migrated } }, { merge: true });
  console.log(`[migration] Done (${migrated} contacts updated).`);
}
```

- [ ] **Step 2: Call migration from admin bootstrap**

In the admin branch of the bootstrap, add:

```javascript
      runCompaniesMigration().catch(err => console.error('Migration failed:', err));
```

- [ ] **Step 3: Commit**

```bash
git add crm/js/main.js
git commit -m "feat(crm): one-time migration companies→contact.company"
```

---

### Task 14: Final end-to-end verification

No code — manual testing pass. This is the gate before declaring the feature shipped.

- [ ] **Step 1: Deploy**

```bash
git push origin master
```

Wait for Cloudflare build (~1-2 minutes).

- [ ] **Step 2: Redeploy Firestore rules**

Copy `crm/firestore.rules` contents into Firebase Console → Firestore → Rules → Publish.

- [ ] **Step 3: Run the 15-step test matrix**

Test each in order against production. Mark each as you confirm it works; stop and fix on first failure.

- [ ] 1. `+ New Quote` → fill customer (new), plan (Repair Pro), add-on (Extra User × 2), labor (4h × $125), one custom line item ($200), 10% discount → Save Draft. Verify quote appears in Quotes list; new contact was created.
- [ ] 2. Open the draft quote → Send to Customer → verify URL copied to clipboard, quote flips to Sent.
- [ ] 3. Incognito window: paste URL → quote renders correctly with all sections + valid-until date + branding.
- [ ] 4. Click Accept → type name → verify "Quote accepted" confirmation screen.
- [ ] 5. Back in CRM: quote flips to `accepted` then `provisioned` within 5 seconds. Tenant appears in Tenants list; first invoice shows labor + line items + first period + discount correctly.
- [ ] 6. New quote → Decline in incognito → verify status flips to `declined` in CRM.
- [ ] 7. Open a provisioned tenant → Subscription section shows period, add-ons, buttons. Click Remove on an add-on → confirm prorated refund amount matches `(monthly × ratio)` → Remove → verify credit invoice exists (negative total).
- [ ] 8. Click + Add Add-on → pick SMS pack → confirm dialog shows prorated + implementation fee = correct total → Add → verify invoice created.
- [ ] 9. Change Plan → pick another Repair tier → verify net invoice correct.
- [ ] 10. Cancel Subscription → choose "2" (now) → refund amount matches → tenant status flips to cancelled, refund invoice created.
- [ ] 11. New quote → Schedule cancellation on another tenant instead (choose "1") → verify `cancelAt` set, status still active until date.
- [ ] 12. Press `/` anywhere in CRM → search focuses. Type a customer's phone → customer shows. Type a quote number → quote shows. Type 20-char doc ID → matched record shows.
- [ ] 13. Two customers with same company name → open one → "Other contacts at X" section links to the other.
- [ ] 14. Try a random 32-char string in the URL `/quote.html?t=<garbage>` → should show "Quote not found" cleanly (no stack trace).
- [ ] 15. Companies tab is gone from sidebar; no broken links left.

- [ ] **Step 4: Record completion**

```bash
echo "Quote-centric CRM shipped and verified $(date -u +%Y-%m-%d)" >> docs/superpowers/plans/2026-04-17-quote-centric-crm.md
git add docs/superpowers/plans/2026-04-17-quote-centric-crm.md
git commit -m "docs: mark quote-centric CRM plan complete"
git push origin master
```

---

## Plan Complete

**Shipped:**
- `crm/js/services/quotes.js` — quote CRUD, counter-based numbering, public token, response listener
- `crm/js/services/subscription.js` — proration + add/remove/change/cancel with refund invoices
- `crm/js/services/search.js` — cross-collection universal search
- `crm/js/views/quotes.js` — quotes list
- `crm/js/views/quote-builder.js` — single-screen quote builder with live pricing
- `crm/js/views/tenants.js` — Subscription section (modified)
- `crm/js/views/contacts.js` — company column + sibling contacts (modified)
- `crm/js/components/universal-search.js` — header search UI with keyboard nav
- `crm/js/main.js` — response listener, migration, subscription enforcement (modified)
- `crm/app.html` — sidebar restructure + header search mount (modified)
- `crm/firestore.rules` — rules for quotes, responses, views, CRM counter (modified)
- `quote.html`, `quote/js/quote.js`, `quote/css/quote.css` — public quote page
- `_headers` — CSP + cache rules for `/quote.html` (modified)

**Deferred (separate plans/specs):**
- CRM dashboard redesign (Sub-project B)
- Outbound welcome email on provisioning (needs Functions)
- Payment collection on Accept (needs Stripe + Functions)
- Legacy deals migration to quotes (covered partially; can be extended)

**What's next:** Sub-project B — CRM dashboard with charts, drill-downs, and live KPIs matching the portal polish.
