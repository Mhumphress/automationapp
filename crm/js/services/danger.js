// Admin-only destructive operations. Guarded by a confirmation phrase in the UI.
// Wipes customer / transactional data only. Leaves the service catalog, CRM admin
// users, and global settings / branding intact.

import { db } from '../config.js';
import {
  collection, getDocs, doc, deleteDoc, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// Root-level collections holding customer + transactional data
const ROOT_COLLECTIONS = [
  'contacts',
  'companies',
  'deals',
  'invoices',
  'subscriptions',
  'payments',
  'internal_subs',
  'notes',
  'messages',
  'tasks',
  'quotes',
  'quote_views',
  'quote_responses',
  'user_tenants',
  'counters',
];

// Subcollections to wipe beneath each /tenants/{tid} before deleting the tenant itself
const TENANT_SUBCOLLECTIONS = [
  'users',
  'invitations',
  'invoices',
  'payments',
  'activity',
  'notifications',
  'settings',
  'counters',
  // Tenant CRM data
  'contacts',
  'tickets',
  'jobs',
  'work_orders',
  'projects',
  'properties',
  'appointments',
  'inventory',
  'invoices_crm',
  'scheduling',
  'tasks',
  'quotes',
  'bom',
  'leases',
  'maintenance',
  'services_menu',
  'loyalty',
  'time_entries',
  'proposals',
];

async function deleteAllDocsIn(collRef, onDelete) {
  const snap = await getDocs(collRef);
  let count = 0;
  // Use batches of 400 writes (Firestore limit is 500)
  let batch = writeBatch(db);
  let inBatch = 0;
  for (const d of snap.docs) {
    batch.delete(d.ref);
    inBatch++;
    count++;
    if (inBatch >= 400) {
      await batch.commit();
      batch = writeBatch(db);
      inBatch = 0;
    }
  }
  if (inBatch > 0) await batch.commit();
  if (onDelete) onDelete(count);
  return count;
}

export async function wipeCustomerData({ onProgress } = {}) {
  let totals = { rootDocs: 0, tenantDocs: 0, subcollectionDocs: 0, errors: 0 };
  const log = (msg) => onProgress && onProgress(msg);

  async function tryWipe(label, fn) {
    try {
      return await fn();
    } catch (err) {
      totals.errors++;
      log(`  ! ${label} FAILED: ${err.code || err.message}`);
      return null;
    }
  }

  // 1. Tenants — delete all known subcollections, then the tenant doc itself
  log('Scanning tenants…');
  let tenantIds = [];
  try {
    const tenantsSnap = await getDocs(collection(db, 'tenants'));
    tenantIds = tenantsSnap.docs.map(d => d.id);
    log(`Found ${tenantIds.length} tenant${tenantIds.length === 1 ? '' : 's'}.`);
  } catch (err) {
    log(`! list tenants FAILED: ${err.code || err.message}`);
    totals.errors++;
  }

  for (const tid of tenantIds) {
    log(`Wiping tenants/${tid}…`);
    for (const sub of TENANT_SUBCOLLECTIONS) {
      const n = await tryWipe(`tenants/${tid}/${sub}`, () =>
        deleteAllDocsIn(collection(db, 'tenants', tid, sub))
      );
      if (n && n > 0) {
        totals.subcollectionDocs += n;
        log(`  tenants/${tid}/${sub} — ${n}`);
      }
    }
    const deleted = await tryWipe(`tenants/${tid}`, () => deleteDoc(doc(db, 'tenants', tid)));
    if (deleted !== null) totals.tenantDocs++;
  }

  // 2. Root-level customer + transactional collections
  for (const name of ROOT_COLLECTIONS) {
    log(`Wiping ${name}…`);
    const n = await tryWipe(name, () => deleteAllDocsIn(collection(db, name)));
    if (n != null) {
      totals.rootDocs += n;
      log(`  ${name} — ${n}`);
    }
  }

  log(`Done. Deleted ${totals.rootDocs} root docs + ${totals.tenantDocs} tenants + ${totals.subcollectionDocs} subcollection docs. Errors: ${totals.errors}.`);
  return totals;
}
