# Plan 1: Foundation — Data Model, Rules, Product Catalog

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the Firestore data model, security rules, and seed the product catalog (verticals, features, packages, add-ons) so that all subsequent plans can build on a working foundation.

**Architecture:** Single Firestore project (`automation-app-crm`), multi-tenant. New collections added at root level alongside existing CRM data. Product catalog is admin-managed reference data. Tenant data will live under `tenants/{tenantId}/...` (created in Plan 3). This plan does NOT move shared files yet — that happens in Plan 5 when the portal needs them.

**Tech Stack:** Firebase Firestore (10.12.0 SDK via CDN), vanilla JS ES modules, Cloudflare Pages static hosting.

**Spec:** `docs/superpowers/specs/2026-04-16-customer-portal-platform-design.md`

**Plan index (10 total):**
1. **Foundation** (this plan) — data model, rules, product catalog seed
2. Admin CRM — Package Management views
3. Admin CRM — Tenant Management & provisioning
4. Admin CRM — Renewals & billing dashboard
5. Customer Portal — Core shell, auth, tenant context, account management
6. Customer Portal — Shared modules (contacts, invoicing, tasks, scheduling, reporting)
7. Vertical Modules — Repair & Trades
8. Vertical Modules — Manufacturing & Services
9. Vertical Modules — Property & Salon
10. Access Control & Integration Testing

---

### Task 1: Update Firestore Rules for New Collections

**Files:**
- Modify: `crm/firestore.rules`

- [ ] **Step 1: Add rules for product catalog collections (read-only for approved users, write for admins)**

Add these rules after the existing `// ── Settings` block in `crm/firestore.rules`:

```
    // ── Product Catalog ─────────────────────
    match /packages/{packageId} {
      allow read: if isApprovedUser();
      allow write: if isAdmin();
    }

    match /addons/{addonId} {
      allow read: if isApprovedUser();
      allow write: if isAdmin();
    }

    match /features/{featureId} {
      allow read: if isApprovedUser();
      allow write: if isAdmin();
    }

    match /verticals/{verticalId} {
      allow read: if isApprovedUser();
      allow write: if isAdmin();
    }
```

- [ ] **Step 2: Add tenant helper functions and tenant collection rules**

Add these helper functions after the existing `isOwner()` function:

```
    // ── Tenant helper functions ──────────────
    function isTenantMember(tenantId) {
      return isAuth() &&
        exists(/databases/$(database)/documents/tenants/$(tenantId)/users/$(request.auth.uid));
    }

    function isTenantAdmin(tenantId) {
      return isTenantMember(tenantId) &&
        get(/databases/$(database)/documents/tenants/$(tenantId)/users/$(request.auth.uid)).data.role in ['admin', 'owner'];
    }

    function isTenantOwner(tenantId) {
      return isTenantMember(tenantId) &&
        get(/databases/$(database)/documents/tenants/$(tenantId)/users/$(request.auth.uid)).data.role == 'owner';
    }

    function tenantIsActive(tenantId) {
      return get(/databases/$(database)/documents/tenants/$(tenantId)).data.status == 'active';
    }
```

Add the tenant collection rules after the product catalog rules:

```
    // ── Tenants ─────────────────────────────
    match /tenants/{tenantId} {
      // Internal admins can read/write all tenants
      // Tenant members can read their own tenant doc
      allow read: if isAdmin() || isTenantMember(tenantId);
      allow create: if isAdmin();
      allow update: if isAdmin();
      allow delete: if isAdmin();

      // Tenant users
      match /users/{userId} {
        allow read: if isAdmin() || isTenantMember(tenantId);
        allow create: if isAdmin() || isTenantAdmin(tenantId);
        allow update: if isAdmin() || isTenantAdmin(tenantId);
        allow delete: if isAdmin() || isTenantOwner(tenantId);
      }

      // Tenant invitations
      match /invitations/{inviteId} {
        allow read: if isAdmin() || isTenantMember(tenantId);
        allow create: if isAdmin() || isTenantAdmin(tenantId);
        allow update: if isAdmin() || isTenantAdmin(tenantId);
        allow delete: if isAdmin() || isTenantAdmin(tenantId);
      }

      // Tenant invoices (billing)
      match /invoices/{invoiceId} {
        allow read: if isAdmin() || isTenantMember(tenantId);
        allow create: if isAdmin();
        allow update: if isAdmin();
        allow delete: if isAdmin();
      }

      // Tenant payments
      match /payments/{paymentId} {
        allow read: if isAdmin() || isTenantMember(tenantId);
        allow create: if isAdmin();
        allow update: if isAdmin();
        allow delete: if isAdmin();
      }

      // Tenant activity log
      match /activity/{activityId} {
        allow read: if isAdmin() || isTenantMember(tenantId);
        allow create: if isAdmin() || isTenantMember(tenantId);
        allow update, delete: if false;
      }

      // Tenant notifications
      match /notifications/{notifId} {
        allow read: if isAdmin() || isTenantMember(tenantId);
        allow create: if isAdmin();
        allow update, delete: if false;
      }

      // Tenant settings
      match /settings/{settingId} {
        allow read: if isAdmin() || isTenantMember(tenantId);
        allow write: if isAdmin() || isTenantAdmin(tenantId);
      }

      // Tenant CRM data — all collections under tenant
      // Active tenants: full CRUD for members
      // Past-due tenants: read-only
      // Suspended/cancelled tenants: no access (handled by isTenantMember + tenantIsActive)
      match /contacts/{docId} {
        allow read: if isAdmin() || isTenantMember(tenantId);
        allow create, update: if (isAdmin()) || (isTenantMember(tenantId) && tenantIsActive(tenantId));
        allow delete: if (isAdmin()) || (isTenantAdmin(tenantId) && tenantIsActive(tenantId));
      }

      match /tickets/{docId} {
        allow read: if isAdmin() || isTenantMember(tenantId);
        allow create, update: if (isAdmin()) || (isTenantMember(tenantId) && tenantIsActive(tenantId));
        allow delete: if (isAdmin()) || (isTenantAdmin(tenantId) && tenantIsActive(tenantId));
      }

      match /jobs/{docId} {
        allow read: if isAdmin() || isTenantMember(tenantId);
        allow create, update: if (isAdmin()) || (isTenantMember(tenantId) && tenantIsActive(tenantId));
        allow delete: if (isAdmin()) || (isTenantAdmin(tenantId) && tenantIsActive(tenantId));
      }

      match /work_orders/{docId} {
        allow read: if isAdmin() || isTenantMember(tenantId);
        allow create, update: if (isAdmin()) || (isTenantMember(tenantId) && tenantIsActive(tenantId));
        allow delete: if (isAdmin()) || (isTenantAdmin(tenantId) && tenantIsActive(tenantId));
      }

      match /projects/{docId} {
        allow read: if isAdmin() || isTenantMember(tenantId);
        allow create, update: if (isAdmin()) || (isTenantMember(tenantId) && tenantIsActive(tenantId));
        allow delete: if (isAdmin()) || (isTenantAdmin(tenantId) && tenantIsActive(tenantId));
      }

      match /properties/{docId} {
        allow read: if isAdmin() || isTenantMember(tenantId);
        allow create, update: if (isAdmin()) || (isTenantMember(tenantId) && tenantIsActive(tenantId));
        allow delete: if (isAdmin()) || (isTenantAdmin(tenantId) && tenantIsActive(tenantId));
      }

      match /appointments/{docId} {
        allow read: if isAdmin() || isTenantMember(tenantId);
        allow create, update: if (isAdmin()) || (isTenantMember(tenantId) && tenantIsActive(tenantId));
        allow delete: if (isAdmin()) || (isTenantAdmin(tenantId) && tenantIsActive(tenantId));
      }

      match /inventory/{docId} {
        allow read: if isAdmin() || isTenantMember(tenantId);
        allow create, update: if (isAdmin()) || (isTenantMember(tenantId) && tenantIsActive(tenantId));
        allow delete: if (isAdmin()) || (isTenantAdmin(tenantId) && tenantIsActive(tenantId));
      }

      match /invoices_crm/{docId} {
        allow read: if isAdmin() || isTenantMember(tenantId);
        allow create, update: if (isAdmin()) || (isTenantMember(tenantId) && tenantIsActive(tenantId));
        allow delete: if (isAdmin()) || (isTenantAdmin(tenantId) && tenantIsActive(tenantId));
      }

      match /scheduling/{docId} {
        allow read: if isAdmin() || isTenantMember(tenantId);
        allow create, update: if (isAdmin()) || (isTenantMember(tenantId) && tenantIsActive(tenantId));
        allow delete: if (isAdmin()) || (isTenantAdmin(tenantId) && tenantIsActive(tenantId));
      }

      match /tasks/{docId} {
        allow read: if isAdmin() || isTenantMember(tenantId);
        allow create, update: if (isAdmin()) || (isTenantMember(tenantId) && tenantIsActive(tenantId));
        allow delete: if (isAdmin()) || (isTenantAdmin(tenantId) && tenantIsActive(tenantId));
      }

      // Vertical-specific subcollections
      match /quotes/{docId} {
        allow read: if isAdmin() || isTenantMember(tenantId);
        allow create, update: if (isAdmin()) || (isTenantMember(tenantId) && tenantIsActive(tenantId));
        allow delete: if (isAdmin()) || (isTenantAdmin(tenantId) && tenantIsActive(tenantId));
      }

      match /bom/{docId} {
        allow read: if isAdmin() || isTenantMember(tenantId);
        allow create, update: if (isAdmin()) || (isTenantMember(tenantId) && tenantIsActive(tenantId));
        allow delete: if (isAdmin()) || (isTenantAdmin(tenantId) && tenantIsActive(tenantId));
      }

      match /leases/{docId} {
        allow read: if isAdmin() || isTenantMember(tenantId);
        allow create, update: if (isAdmin()) || (isTenantMember(tenantId) && tenantIsActive(tenantId));
        allow delete: if (isAdmin()) || (isTenantAdmin(tenantId) && tenantIsActive(tenantId));
      }

      match /maintenance/{docId} {
        allow read: if isAdmin() || isTenantMember(tenantId);
        allow create, update: if (isAdmin()) || (isTenantMember(tenantId) && tenantIsActive(tenantId));
        allow delete: if (isAdmin()) || (isTenantAdmin(tenantId) && tenantIsActive(tenantId));
      }

      match /services_menu/{docId} {
        allow read: if isAdmin() || isTenantMember(tenantId);
        allow create, update: if (isAdmin()) || (isTenantMember(tenantId) && tenantIsActive(tenantId));
        allow delete: if (isAdmin()) || (isTenantAdmin(tenantId) && tenantIsActive(tenantId));
      }

      match /loyalty/{docId} {
        allow read: if isAdmin() || isTenantMember(tenantId);
        allow create, update: if (isAdmin()) || (isTenantMember(tenantId) && tenantIsActive(tenantId));
        allow delete: if (isAdmin()) || (isTenantAdmin(tenantId) && tenantIsActive(tenantId));
      }
    }
```

- [ ] **Step 3: Commit**

```bash
git add crm/firestore.rules
git commit -m "feat: add Firestore rules for product catalog and multi-tenant collections"
```

---

### Task 2: Create Product Catalog Seeding Service

**Files:**
- Create: `crm/js/services/catalog.js`

This service provides functions to read the product catalog (packages, features, add-ons, verticals). Used by the admin CRM views in Plan 2 and the portal in Plan 5.

- [ ] **Step 1: Create `crm/js/services/catalog.js`**

```javascript
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
```

- [ ] **Step 2: Commit**

```bash
git add crm/js/services/catalog.js
git commit -m "feat: add catalog service for packages, features, addons, verticals"
```

---

### Task 3: Create Seed Script Page

**Files:**
- Create: `crm/seed.html`
- Create: `crm/js/seed.js`

A standalone page that populates all the product catalog data into Firestore. Run once to set up, then can be re-run safely (uses `setDoc` with merge). Only accessible to logged-in admins.

- [ ] **Step 1: Create `crm/seed.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Seed Data - Automation App</title>
  <style>
    body { font-family: 'Outfit', system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; background: #f8fafc; }
    h1 { font-size: 1.5rem; margin-bottom: 1rem; }
    .log { background: #1e293b; color: #e2e8f0; padding: 1rem; border-radius: 8px; font-family: monospace; font-size: 0.85rem; max-height: 600px; overflow-y: auto; white-space: pre-wrap; }
    .log .success { color: #4ade80; }
    .log .error { color: #f87171; }
    .log .info { color: #60a5fa; }
    button { background: #4F7BF7; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 6px; font-size: 1rem; cursor: pointer; margin-bottom: 1rem; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .status { margin-bottom: 1rem; font-size: 0.9rem; color: #64748b; }
  </style>
</head>
<body>
  <h1>Product Catalog Seed</h1>
  <div class="status" id="status">Checking auth...</div>
  <button id="seedBtn" disabled>Run Seed</button>
  <div class="log" id="log"></div>
  <script type="module" src="js/seed.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `crm/js/seed.js` — auth guard and seed runner**

```javascript
import { auth } from './config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { isAdmin } from './services/roles.js';
import { bootstrapCurrentUser } from './services/roles.js';
import {
  setVertical, setFeature, setPackage, setAddon, setBillingSettings
} from './services/catalog.js';

const logEl = document.getElementById('log');
const statusEl = document.getElementById('status');
const seedBtn = document.getElementById('seedBtn');

function log(msg, type = 'info') {
  const span = document.createElement('span');
  span.className = type;
  span.textContent = msg + '\n';
  logEl.appendChild(span);
  logEl.scrollTop = logEl.scrollHeight;
}

// Auth guard
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    statusEl.textContent = 'Not logged in. Go to login.html first.';
    return;
  }
  await bootstrapCurrentUser();
  const admin = await isAdmin();
  if (!admin) {
    statusEl.textContent = 'Access denied. Admin role required.';
    return;
  }
  statusEl.textContent = `Logged in as ${user.email} (admin). Ready to seed.`;
  seedBtn.disabled = false;
});

seedBtn.addEventListener('click', async () => {
  seedBtn.disabled = true;
  statusEl.textContent = 'Seeding...';
  try {
    await seedBillingSettings();
    await seedVerticals();
    await seedFeatures();
    await seedAddons();
    await seedPackages();
    log('All done!', 'success');
    statusEl.textContent = 'Seed complete.';
  } catch (err) {
    log(`FATAL: ${err.message}`, 'error');
    statusEl.textContent = 'Seed failed. Check log.';
  }
  seedBtn.disabled = false;
});

// ── Billing Settings ──

async function seedBillingSettings() {
  log('Seeding billing settings...', 'info');
  await setBillingSettings({
    gracePeriodDays: 30,
    trialDays: 14,
    defaultCurrency: 'USD',
    pastDueReminderDays: [3, 7, 14, 28]
  });
  log('  settings/billing OK', 'success');
}

// ── Verticals ──

async function seedVerticals() {
  log('Seeding verticals...', 'info');

  const verticals = [
    {
      slug: 'repair',
      name: 'Electronics / Device Repair',
      icon: 'tool',
      modules: ['contacts', 'tickets', 'inventory', 'checkin', 'invoicing', 'tasks', 'scheduling', 'reporting'],
      terminology: {
        client: 'Customer',
        ticket: 'Repair Ticket',
        item: 'Device',
        inventory_item: 'Part'
      },
      defaultFeatures: ['contacts', 'tickets', 'invoicing', 'tasks'],
      description: 'Repair shops for phones, computers, electronics, and devices'
    },
    {
      slug: 'trades',
      name: 'Field Service / Trades',
      icon: 'wrench',
      modules: ['contacts', 'jobs', 'dispatching', 'quoting', 'invoicing', 'tasks', 'scheduling', 'reporting'],
      terminology: {
        client: 'Customer',
        ticket: 'Job',
        item: 'Service Call',
        inventory_item: 'Part/Material'
      },
      defaultFeatures: ['contacts', 'jobs', 'invoicing', 'tasks'],
      description: 'HVAC, plumbing, electrical, and general contracting'
    },
    {
      slug: 'manufacturing',
      name: 'Small-Scale Manufacturing',
      icon: 'factory',
      modules: ['contacts', 'bom', 'work_orders', 'production', 'inventory', 'invoicing', 'tasks', 'scheduling', 'reporting'],
      terminology: {
        client: 'Customer',
        ticket: 'Work Order',
        item: 'Product',
        inventory_item: 'Raw Material'
      },
      defaultFeatures: ['contacts', 'inventory', 'invoicing', 'tasks'],
      description: 'Workshop and small-scale manufacturing operations'
    },
    {
      slug: 'services',
      name: 'Professional Services / Consulting',
      icon: 'briefcase',
      modules: ['contacts', 'projects', 'time_tracking', 'proposals', 'resource_scheduling', 'invoicing', 'tasks', 'scheduling', 'reporting'],
      terminology: {
        client: 'Client',
        ticket: 'Task',
        item: 'Deliverable'
      },
      defaultFeatures: ['contacts', 'tasks', 'invoicing', 'time_tracking_manual'],
      description: 'Consulting firms, agencies, and professional service providers'
    },
    {
      slug: 'property',
      name: 'Property Management',
      icon: 'building',
      modules: ['contacts', 'properties', 'leases', 'maintenance', 'rent_collection', 'invoicing', 'tasks', 'scheduling', 'reporting'],
      terminology: {
        client: 'Owner/Tenant',
        ticket: 'Maintenance Request',
        item: 'Unit'
      },
      defaultFeatures: ['contacts', 'properties', 'invoicing', 'tasks'],
      description: 'Residential and commercial property management'
    },
    {
      slug: 'salon',
      name: 'Salon / Spa / Appointments',
      icon: 'scissors',
      modules: ['contacts', 'appointments', 'service_menu', 'staff_calendar', 'loyalty', 'invoicing', 'tasks', 'scheduling', 'reporting'],
      terminology: {
        client: 'Client',
        ticket: 'Appointment',
        item: 'Service',
        inventory_item: 'Product'
      },
      defaultFeatures: ['contacts', 'appointments', 'service_menu', 'invoicing', 'tasks'],
      description: 'Hair salons, spas, barbershops, and appointment-based services'
    }
  ];

  for (const v of verticals) {
    const { slug, ...data } = v;
    await setVertical(slug, data);
    log(`  verticals/${slug} OK`, 'success');
  }
}

// ── Features ──

async function seedFeatures() {
  log('Seeding features...', 'info');

  const features = [
    // Shared
    { slug: 'contacts', name: 'Contacts', description: 'Customer and client management', module: 'contacts', verticals: ['repair', 'trades', 'manufacturing', 'services', 'property', 'salon'], gateType: 'module' },
    { slug: 'invoicing', name: 'Invoicing', description: 'Billing, line items, PDF export', module: 'invoicing', verticals: ['repair', 'trades', 'manufacturing', 'services', 'property', 'salon'], gateType: 'module' },
    { slug: 'tasks', name: 'Tasks', description: 'Work items, assignments, kanban board', module: 'tasks', verticals: ['repair', 'trades', 'manufacturing', 'services', 'property', 'salon'], gateType: 'module' },
    { slug: 'scheduling', name: 'Scheduling', description: 'Calendar with staff columns and drag-and-drop', module: 'scheduling', verticals: ['repair', 'trades', 'manufacturing', 'services', 'property', 'salon'], gateType: 'module' },
    { slug: 'reporting', name: 'Reporting', description: 'Dashboard stats, charts, data export', module: 'reporting', verticals: ['repair', 'trades', 'manufacturing', 'services', 'property', 'salon'], gateType: 'module' },

    // Repair
    { slug: 'tickets', name: 'Repair Tickets', description: 'Ticket/work-order tracking with status pipeline', module: 'tickets', verticals: ['repair'], gateType: 'module' },
    { slug: 'inventory', name: 'Parts Inventory', description: 'Track parts, stock levels, and suppliers', module: 'inventory', verticals: ['repair', 'manufacturing'], gateType: 'module' },
    { slug: 'checkin', name: 'Check-in / Check-out', description: 'Front-counter intake with claim tags', module: 'checkin', verticals: ['repair'], gateType: 'module' },
    { slug: 'purchase_orders', name: 'Purchase Orders', description: 'Order parts from suppliers', module: 'purchase_orders', verticals: ['repair', 'manufacturing'], gateType: 'module' },
    { slug: 'low_stock_alerts', name: 'Low Stock Alerts', description: 'Notifications when parts fall below reorder level', module: 'low_stock_alerts', verticals: ['repair'], gateType: 'capability' },

    // Trades
    { slug: 'jobs', name: 'Jobs', description: 'Job tracking with labor and materials', module: 'jobs', verticals: ['trades'], gateType: 'module' },
    { slug: 'dispatching', name: 'Dispatching', description: 'Daily dispatch board grouped by technician', module: 'dispatching', verticals: ['trades'], gateType: 'module' },
    { slug: 'quoting', name: 'Quoting', description: 'Create and send quotes, convert to jobs', module: 'quoting', verticals: ['trades'], gateType: 'module' },
    { slug: 'recurring_jobs', name: 'Recurring Jobs', description: 'Auto-schedule repeating service calls', module: 'recurring_jobs', verticals: ['trades'], gateType: 'capability' },
    { slug: 'online_booking', name: 'Online Booking', description: 'Public booking link for customers', module: 'online_booking', verticals: ['trades', 'salon'], gateType: 'capability' },
    { slug: 'materials_inventory', name: 'Materials Inventory', description: 'Track materials and parts for jobs', module: 'inventory', verticals: ['trades'], gateType: 'module' },

    // Manufacturing
    { slug: 'bom', name: 'BOM Management', description: 'Bill of Materials with cost rollup', module: 'bom', verticals: ['manufacturing'], gateType: 'module' },
    { slug: 'work_orders', name: 'Work Orders', description: 'Production work orders with material consumption', module: 'work_orders', verticals: ['manufacturing'], gateType: 'module' },
    { slug: 'production', name: 'Production Planning', description: 'Calendar view with capacity and shortfall alerts', module: 'production', verticals: ['manufacturing'], gateType: 'module' },
    { slug: 'multi_level_bom', name: 'Multi-Level BOM', description: 'Subassembly support in bill of materials', module: 'bom', verticals: ['manufacturing'], gateType: 'capability' },

    // Services
    { slug: 'projects', name: 'Projects', description: 'Project tracking with budget and milestones', module: 'projects', verticals: ['services'], gateType: 'module' },
    { slug: 'time_tracking', name: 'Time Tracking (Timer)', description: 'Start/stop timer with weekly timesheets', module: 'time_tracking', verticals: ['services'], gateType: 'module' },
    { slug: 'time_tracking_manual', name: 'Time Tracking (Manual)', description: 'Manual time entry with billable toggle', module: 'time_tracking', verticals: ['services'], gateType: 'module' },
    { slug: 'proposals', name: 'Proposals', description: 'Create proposals, convert to projects on accept', module: 'proposals', verticals: ['services'], gateType: 'module' },
    { slug: 'resource_scheduling', name: 'Resource Scheduling', description: 'Team availability and utilization dashboards', module: 'resource_scheduling', verticals: ['services'], gateType: 'module' },
    { slug: 'budget_tracking', name: 'Budget Tracking', description: 'Project budget vs actual hours tracking', module: 'projects', verticals: ['services'], gateType: 'capability' },

    // Property
    { slug: 'properties', name: 'Properties & Units', description: 'Property and unit management with vacancy tracking', module: 'properties', verticals: ['property'], gateType: 'module' },
    { slug: 'leases', name: 'Leases', description: 'Lease management with auto-renewal alerts', module: 'leases', verticals: ['property'], gateType: 'module' },
    { slug: 'maintenance', name: 'Maintenance Requests', description: 'Maintenance tracking with vendor assignment', module: 'maintenance', verticals: ['property'], gateType: 'module' },
    { slug: 'rent_collection', name: 'Rent Collection', description: 'Rent dashboard with bulk invoicing', module: 'rent_collection', verticals: ['property'], gateType: 'module' },
    { slug: 'bulk_invoicing', name: 'Bulk Invoicing', description: 'Generate invoices for all active leases at once', module: 'rent_collection', verticals: ['property'], gateType: 'capability' },
    { slug: 'vacancy_analytics', name: 'Vacancy Analytics', description: 'Advanced vacancy and revenue reporting', module: 'reporting', verticals: ['property'], gateType: 'capability' },

    // Salon
    { slug: 'appointments', name: 'Appointments', description: 'Calendar booking with walk-in mode', module: 'appointments', verticals: ['salon'], gateType: 'module' },
    { slug: 'service_menu', name: 'Service Menu', description: 'Services with categories, durations, and pricing', module: 'service_menu', verticals: ['salon'], gateType: 'module' },
    { slug: 'staff_calendar', name: 'Staff Calendar', description: 'Per-staff schedules and availability', module: 'staff_calendar', verticals: ['salon'], gateType: 'module' },
    { slug: 'loyalty', name: 'Client Loyalty', description: 'Visit tracking and points system', module: 'loyalty', verticals: ['salon'], gateType: 'module' },
    { slug: 'commission_tracking', name: 'Commission Tracking', description: 'Per-service commission for staff', module: 'staff_calendar', verticals: ['salon'], gateType: 'capability' },
    { slug: 'product_inventory', name: 'Product Inventory', description: 'Retail product stock management', module: 'inventory', verticals: ['salon'], gateType: 'module' },

    // Cross-vertical capabilities
    { slug: 'api_access', name: 'API Access', description: 'REST API for custom integrations', module: null, verticals: ['repair', 'trades', 'manufacturing', 'services', 'property', 'salon'], gateType: 'capability' },
    { slug: 'custom_fields', name: 'Custom Fields', description: 'Add custom fields to any record', module: null, verticals: ['repair', 'trades', 'manufacturing', 'services', 'property', 'salon'], gateType: 'capability' },
    { slug: 'multi_location', name: 'Multi-Location', description: 'Manage multiple business locations', module: null, verticals: ['repair', 'salon'], gateType: 'capability' },
  ];

  for (const f of features) {
    const { slug, ...data } = f;
    await setFeature(slug, data);
    log(`  features/${slug} OK`, 'success');
  }
}

// ── Add-ons ──

async function seedAddons() {
  log('Seeding add-ons...', 'info');

  const addons = [
    { slug: 'extra_users', name: 'Additional User Seat', priceMonthly: 19, priceAnnual: 190, pricingModel: 'per_unit', description: 'Add team members beyond plan limit', applicableVerticals: ['all'], active: true },
    { slug: 'extra_locations', name: 'Additional Location', priceMonthly: 39, priceAnnual: 390, pricingModel: 'per_unit', description: 'Add business locations', applicableVerticals: ['repair', 'salon', 'trades'], active: true },
    { slug: 'sms_pack', name: 'SMS Credits (500)', priceMonthly: 25, priceAnnual: 250, pricingModel: 'per_unit', description: '500 SMS credits for reminders and notifications', applicableVerticals: ['all'], active: true },
    { slug: 'white_label', name: 'White Label Branding', priceMonthly: 49, priceAnnual: 490, pricingModel: 'flat', description: 'Remove branding, use your own domain', applicableVerticals: ['all'], active: true },
    { slug: 'api_access', name: 'API Access', priceMonthly: 29, priceAnnual: 290, pricingModel: 'flat', description: 'REST API for custom integrations', applicableVerticals: ['all'], active: true },
    { slug: 'advanced_reporting', name: 'Advanced Reporting', priceMonthly: 29, priceAnnual: 290, pricingModel: 'flat', description: 'Custom dashboards and data export', applicableVerticals: ['all'], active: true },
    { slug: 'extra_storage', name: 'Additional Storage (10GB)', priceMonthly: 9, priceAnnual: 90, pricingModel: 'per_unit', description: 'Extra file storage for documents and photos', applicableVerticals: ['all'], active: true },
    { slug: 'onboarding', name: 'Guided Onboarding', priceMonthly: 0, priceAnnual: 0, pricingModel: 'flat', description: 'One-time guided setup and training session ($299)', applicableVerticals: ['all'], active: true },
  ];

  for (const a of addons) {
    const { slug, ...data } = a;
    await setAddon(slug, data);
    log(`  addons/${slug} OK`, 'success');
  }
}

// ── Packages (6 verticals × 3 tiers = 18 packages) ──

async function seedPackages() {
  log('Seeding packages...', 'info');

  const packages = [
    // ── Repair ──
    { id: 'repair_basic', name: 'RepairApp Basic', vertical: 'repair', tier: 'basic', description: 'Essential repair shop management', basePrice: 49, annualPrice: 490, userLimit: 3, features: ['contacts', 'tickets', 'invoicing', 'tasks'], addOns: ['extra_users', 'sms_pack', 'extra_storage'], sortOrder: 1, active: true },
    { id: 'repair_pro', name: 'RepairApp Pro', vertical: 'repair', tier: 'pro', description: 'Full repair shop with inventory and check-in', basePrice: 99, annualPrice: 990, userLimit: 8, features: ['contacts', 'tickets', 'inventory', 'checkin', 'invoicing', 'tasks', 'scheduling', 'reporting'], addOns: ['extra_users', 'extra_locations', 'sms_pack', 'white_label', 'extra_storage'], sortOrder: 2, active: true },
    { id: 'repair_enterprise', name: 'RepairApp Enterprise', vertical: 'repair', tier: 'enterprise', description: 'Unlimited repair operations with advanced features', basePrice: 199, annualPrice: 1990, userLimit: 0, features: ['contacts', 'tickets', 'inventory', 'checkin', 'invoicing', 'tasks', 'scheduling', 'reporting', 'purchase_orders', 'low_stock_alerts', 'multi_location', 'api_access', 'custom_fields'], addOns: ['extra_locations', 'sms_pack', 'white_label', 'extra_storage', 'advanced_reporting'], sortOrder: 3, active: true },

    // ── Trades ──
    { id: 'trades_basic', name: 'TradesApp Basic', vertical: 'trades', tier: 'basic', description: 'Essential field service management', basePrice: 49, annualPrice: 490, userLimit: 3, features: ['contacts', 'jobs', 'invoicing', 'tasks'], addOns: ['extra_users', 'sms_pack', 'extra_storage'], sortOrder: 1, active: true },
    { id: 'trades_pro', name: 'TradesApp Pro', vertical: 'trades', tier: 'pro', description: 'Full dispatching and quoting', basePrice: 149, annualPrice: 1490, userLimit: 10, features: ['contacts', 'jobs', 'dispatching', 'quoting', 'invoicing', 'tasks', 'scheduling', 'reporting'], addOns: ['extra_users', 'extra_locations', 'sms_pack', 'white_label', 'extra_storage'], sortOrder: 2, active: true },
    { id: 'trades_enterprise', name: 'TradesApp Enterprise', vertical: 'trades', tier: 'enterprise', description: 'Full field service with automation', basePrice: 299, annualPrice: 2990, userLimit: 0, features: ['contacts', 'jobs', 'dispatching', 'quoting', 'invoicing', 'tasks', 'scheduling', 'reporting', 'recurring_jobs', 'online_booking', 'materials_inventory', 'api_access', 'custom_fields'], addOns: ['extra_locations', 'sms_pack', 'white_label', 'extra_storage', 'advanced_reporting'], sortOrder: 3, active: true },

    // ── Manufacturing ──
    { id: 'mfg_basic', name: 'MfgApp Basic', vertical: 'manufacturing', tier: 'basic', description: 'Essential inventory and order management', basePrice: 99, annualPrice: 990, userLimit: 3, features: ['contacts', 'inventory', 'invoicing', 'tasks'], addOns: ['extra_users', 'extra_storage'], sortOrder: 1, active: true },
    { id: 'mfg_pro', name: 'MfgApp Pro', vertical: 'manufacturing', tier: 'pro', description: 'Full BOM and work order management', basePrice: 249, annualPrice: 2490, userLimit: 10, features: ['contacts', 'inventory', 'bom', 'work_orders', 'invoicing', 'tasks', 'scheduling', 'reporting'], addOns: ['extra_users', 'sms_pack', 'white_label', 'extra_storage'], sortOrder: 2, active: true },
    { id: 'mfg_enterprise', name: 'MfgApp Enterprise', vertical: 'manufacturing', tier: 'enterprise', description: 'Advanced manufacturing with production planning', basePrice: 499, annualPrice: 4990, userLimit: 0, features: ['contacts', 'inventory', 'bom', 'work_orders', 'production', 'invoicing', 'tasks', 'scheduling', 'reporting', 'multi_level_bom', 'purchase_orders', 'api_access', 'custom_fields'], addOns: ['extra_users', 'sms_pack', 'white_label', 'extra_storage', 'advanced_reporting'], sortOrder: 3, active: true },

    // ── Services ──
    { id: 'services_basic', name: 'ServicesApp Basic', vertical: 'services', tier: 'basic', description: 'Essential client and time management', basePrice: 29, annualPrice: 290, userLimit: 2, features: ['contacts', 'tasks', 'invoicing', 'time_tracking_manual'], addOns: ['extra_users', 'extra_storage'], sortOrder: 1, active: true },
    { id: 'services_pro', name: 'ServicesApp Pro', vertical: 'services', tier: 'pro', description: 'Full project and proposal management', basePrice: 79, annualPrice: 790, userLimit: 10, features: ['contacts', 'tasks', 'invoicing', 'time_tracking', 'projects', 'proposals', 'scheduling', 'reporting'], addOns: ['extra_users', 'sms_pack', 'white_label', 'extra_storage'], sortOrder: 2, active: true },
    { id: 'services_enterprise', name: 'ServicesApp Enterprise', vertical: 'services', tier: 'enterprise', description: 'Full professional services suite', basePrice: 149, annualPrice: 1490, userLimit: 0, features: ['contacts', 'tasks', 'invoicing', 'time_tracking', 'projects', 'proposals', 'scheduling', 'reporting', 'resource_scheduling', 'budget_tracking', 'api_access', 'custom_fields'], addOns: ['extra_users', 'sms_pack', 'white_label', 'extra_storage', 'advanced_reporting'], sortOrder: 3, active: true },

    // ── Property ──
    { id: 'property_basic', name: 'PropertyApp Basic', vertical: 'property', tier: 'basic', description: 'Essential property management (up to 25 units)', basePrice: 49, annualPrice: 490, userLimit: 3, features: ['contacts', 'properties', 'invoicing', 'tasks'], addOns: ['extra_users', 'extra_storage'], sortOrder: 1, active: true },
    { id: 'property_pro', name: 'PropertyApp Pro', vertical: 'property', tier: 'pro', description: 'Full lease and maintenance management (up to 100 units)', basePrice: 149, annualPrice: 1490, userLimit: 10, features: ['contacts', 'properties', 'leases', 'maintenance', 'rent_collection', 'invoicing', 'tasks', 'scheduling', 'reporting'], addOns: ['extra_users', 'sms_pack', 'white_label', 'extra_storage'], sortOrder: 2, active: true },
    { id: 'property_enterprise', name: 'PropertyApp Enterprise', vertical: 'property', tier: 'enterprise', description: 'Unlimited property management with analytics', basePrice: 299, annualPrice: 2990, userLimit: 0, features: ['contacts', 'properties', 'leases', 'maintenance', 'rent_collection', 'invoicing', 'tasks', 'scheduling', 'reporting', 'bulk_invoicing', 'vacancy_analytics', 'api_access', 'custom_fields'], addOns: ['extra_users', 'sms_pack', 'white_label', 'extra_storage', 'advanced_reporting'], sortOrder: 3, active: true },

    // ── Salon ──
    { id: 'salon_basic', name: 'SalonApp Basic', vertical: 'salon', tier: 'basic', description: 'Essential appointment and client management (1 staff)', basePrice: 39, annualPrice: 390, userLimit: 2, features: ['contacts', 'appointments', 'service_menu', 'invoicing', 'tasks'], addOns: ['extra_users', 'sms_pack', 'extra_storage'], sortOrder: 1, active: true },
    { id: 'salon_pro', name: 'SalonApp Pro', vertical: 'salon', tier: 'pro', description: 'Full salon management with loyalty (up to 5 staff)', basePrice: 99, annualPrice: 990, userLimit: 7, features: ['contacts', 'appointments', 'service_menu', 'staff_calendar', 'loyalty', 'online_booking', 'invoicing', 'tasks', 'scheduling', 'reporting'], addOns: ['extra_users', 'extra_locations', 'sms_pack', 'white_label', 'extra_storage'], sortOrder: 2, active: true },
    { id: 'salon_enterprise', name: 'SalonApp Enterprise', vertical: 'salon', tier: 'enterprise', description: 'Unlimited salon operations with advanced features', basePrice: 199, annualPrice: 1990, userLimit: 0, features: ['contacts', 'appointments', 'service_menu', 'staff_calendar', 'loyalty', 'online_booking', 'commission_tracking', 'product_inventory', 'invoicing', 'tasks', 'scheduling', 'reporting', 'multi_location', 'api_access', 'custom_fields'], addOns: ['extra_locations', 'sms_pack', 'white_label', 'extra_storage', 'advanced_reporting'], sortOrder: 3, active: true },
  ];

  for (const p of packages) {
    const { id, ...data } = p;
    await setPackage(id, data);
    log(`  packages/${id} OK`, 'success');
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add crm/seed.html crm/js/seed.js
git commit -m "feat: add product catalog seed script with all verticals, features, packages, addons"
```

---

### Task 4: Create Tenant Service

**Files:**
- Create: `crm/js/services/tenants.js`

Service for managing tenant documents from the admin CRM. Used by the Tenants view in Plan 3 and the provisioning pipeline.

- [ ] **Step 1: Create `crm/js/services/tenants.js`**

```javascript
import { db, auth } from '../config.js';
import {
  collection, doc, addDoc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, orderBy, where, serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ── Tenant CRUD ─────────────────────────

export async function getTenants() {
  const q = query(collection(db, 'tenants'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getTenantsByStatus(status) {
  const q = query(
    collection(db, 'tenants'),
    where('status', '==', status),
    orderBy('createdAt', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getTenant(tenantId) {
  const snap = await getDoc(doc(db, 'tenants', tenantId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function createTenant(data) {
  const user = auth.currentUser;
  return addDoc(collection(db, 'tenants'), {
    ...data,
    createdAt: serverTimestamp(),
    createdBy: user ? user.uid : null,
    updatedAt: serverTimestamp(),
    updatedBy: user ? user.uid : null
  });
}

export async function updateTenant(tenantId, data) {
  const user = auth.currentUser;
  return updateDoc(doc(db, 'tenants', tenantId), {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: user ? user.uid : null
  });
}

// ── Tenant Users ────────────────────────

export async function getTenantUsers(tenantId) {
  const q = query(collection(db, 'tenants', tenantId, 'users'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function addTenantUser(tenantId, userId, data) {
  return setDoc(doc(db, 'tenants', tenantId, 'users', userId), {
    ...data,
    createdAt: serverTimestamp()
  });
}

export async function updateTenantUser(tenantId, userId, data) {
  return updateDoc(doc(db, 'tenants', tenantId, 'users', userId), data);
}

export async function removeTenantUser(tenantId, userId) {
  return deleteDoc(doc(db, 'tenants', tenantId, 'users', userId));
}

// ── Tenant Activity ─────────────────────

export async function addTenantActivity(tenantId, entry) {
  const user = auth.currentUser;
  return addDoc(collection(db, 'tenants', tenantId, 'activity'), {
    ...entry,
    createdAt: serverTimestamp(),
    createdBy: user ? user.uid : null,
    createdByEmail: user ? user.email : null
  });
}

export async function getTenantActivity(tenantId) {
  const q = query(
    collection(db, 'tenants', tenantId, 'activity'),
    orderBy('createdAt', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Tenant Invoices ─────────────────────

export async function getTenantInvoices(tenantId) {
  const q = query(
    collection(db, 'tenants', tenantId, 'invoices'),
    orderBy('issuedDate', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function addTenantInvoice(tenantId, data) {
  const user = auth.currentUser;
  return addDoc(collection(db, 'tenants', tenantId, 'invoices'), {
    ...data,
    createdAt: serverTimestamp(),
    createdBy: user ? user.uid : null
  });
}

export async function updateTenantInvoice(tenantId, invoiceId, data) {
  return updateDoc(doc(db, 'tenants', tenantId, 'invoices', invoiceId), data);
}

// ── Tenant Payments ─────────────────────

export async function getTenantPayments(tenantId) {
  const q = query(
    collection(db, 'tenants', tenantId, 'payments'),
    orderBy('processedAt', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function addTenantPayment(tenantId, data) {
  const user = auth.currentUser;
  return addDoc(collection(db, 'tenants', tenantId, 'payments'), {
    ...data,
    createdAt: serverTimestamp(),
    createdBy: user ? user.uid : null
  });
}

// ── Tenant Notifications ────────────────

export async function addTenantNotification(tenantId, data) {
  return addDoc(collection(db, 'tenants', tenantId, 'notifications'), {
    ...data,
    sentAt: serverTimestamp()
  });
}

export async function getTenantNotifications(tenantId) {
  const q = query(
    collection(db, 'tenants', tenantId, 'notifications'),
    orderBy('sentAt', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Re-export for convenience
export { Timestamp, serverTimestamp };
```

- [ ] **Step 2: Commit**

```bash
git add crm/js/services/tenants.js
git commit -m "feat: add tenant service for CRUD, users, activity, invoices, payments"
```

---

### Task 5: Update CSP Headers for Portal

**Files:**
- Modify: `_headers`

- [ ] **Step 1: Add CSP for `/portal/*` path**

Add a new block after the existing `/crm/*` block in `_headers`:

```
/portal/*
  Content-Security-Policy: default-src 'self'; script-src 'self' https://www.gstatic.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://identitytoolkit.googleapis.com; img-src 'self' data:; frame-ancestors 'none'
```

- [ ] **Step 2: Commit**

```bash
git add _headers
git commit -m "feat: add CSP headers for /portal/ path"
```

---

### Task 6: Run Seed Script and Verify

- [ ] **Step 1: Deploy to Cloudflare Pages**

```bash
git push origin master
```

- [ ] **Step 2: Navigate to `https://automationapp.org/crm/seed.html` in browser**

Log in with your admin account. Click "Run Seed". Verify all items show green "OK" in the log.

- [ ] **Step 3: Verify in Firebase Console**

Open Firebase Console → Firestore. Check that these collections exist with the correct documents:

- `settings/billing` — has gracePeriodDays, trialDays, etc.
- `verticals/` — 6 documents (repair, trades, manufacturing, services, property, salon)
- `features/` — ~40 documents with correct verticals arrays
- `addons/` — 8 documents
- `packages/` — 18 documents (6 verticals × 3 tiers) with correct feature arrays

- [ ] **Step 4: Verify Firestore rules are deployed**

The rules in `crm/firestore.rules` need to be deployed to Firebase separately. Copy the full contents of `crm/firestore.rules` and paste into Firebase Console → Firestore → Rules → Publish.

Verify the rules are active by checking that the seed script can write to the new collections.

- [ ] **Step 5: Commit any fixes**

If the seed script or rules needed adjustments, commit those changes:

```bash
git add -A
git commit -m "fix: adjust seed data after verification"
git push origin master
```

---

## Plan 1 Complete

**What was delivered:**
- Firestore security rules for all new collections (product catalog + multi-tenant)
- Catalog service (`crm/js/services/catalog.js`) for reading/writing packages, features, add-ons, verticals
- Tenant service (`crm/js/services/tenants.js`) for managing tenant lifecycle
- Seed script that populates the full product catalog (6 verticals, ~40 features, 8 add-ons, 18 packages, billing settings)
- CSP headers for the portal path

**What's next:** Plan 2 — Admin CRM Package Management views (CRUD UI for packages, features, add-ons, verticals from within the CRM).
