// ─────────────────────────────────────────────────────────────────
//  subscription-events.js — Structured subscription history log.
//
//  Every plan change, add-on addition/removal, cancellation, renewal,
//  and creation writes an append-only event here. The CRM timeline
//  and MRR charts query this collection. Activity log remains for
//  human-readable descriptions; this collection is the queryable truth.
// ─────────────────────────────────────────────────────────────────

import { db, auth } from '../config.js';
import {
  collection, doc, addDoc, getDoc, getDocs, updateDoc, setDoc,
  query, where, orderBy, serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { computeMRR } from './money.js';

export const EVENT_TYPES = Object.freeze({
  CREATED:           'created',
  PLAN_CHANGED:      'plan_changed',
  ADDON_ADDED:       'addon_added',
  ADDON_REMOVED:     'addon_removed',
  PRICE_ADJUSTED:    'price_adjusted',
  RENEWED:           'renewed',
  CANCELLED:         'cancelled',
  CANCEL_SCHEDULED:  'cancel_scheduled',
  CANCEL_UNDONE:     'cancel_undone',
  PAUSED:            'paused',
  RESUMED:           'resumed',
  REACTIVATED:       'reactivated',
});

/**
 * Write a subscription event. All fields optional except tenantId and type.
 *
 * @param {object} p
 * @param {string} p.tenantId
 * @param {string} p.type                  one of EVENT_TYPES
 * @param {string} [p.contactId]
 * @param {object} [p.fromState]           { packageId, tier, basePrice, priceOverride, addOns, billingCycle, status }
 * @param {object} [p.toState]
 * @param {Date|Timestamp} [p.effectiveAt] when change took effect (default: now)
 * @param {string} [p.invoiceId]
 * @param {string} [p.reason]
 * @param {number} [p.mrrDelta]            computed if fromState + toState provided
 * @param {object} [p.metadata]
 */
export async function recordEvent(p) {
  if (!p || !p.tenantId || !p.type) {
    throw new Error('recordEvent requires tenantId and type');
  }
  const user = auth.currentUser;
  const mrrBefore = p.fromState ? computeMRR({ ...p.fromState, status: 'active' }) : null;
  const mrrAfter  = p.toState   ? computeMRR({ ...p.toState,   status: 'active' }) : null;
  const mrrDelta  = p.mrrDelta != null
    ? Number(p.mrrDelta)
    : (mrrBefore != null && mrrAfter != null ? mrrAfter - mrrBefore : 0);

  const eff = p.effectiveAt
    ? (p.effectiveAt instanceof Date ? Timestamp.fromDate(p.effectiveAt) : p.effectiveAt)
    : serverTimestamp();

  const doc = {
    tenantId:         p.tenantId,
    contactId:        p.contactId || null,
    type:             p.type,
    fromState:        p.fromState || null,
    toState:          p.toState || null,
    effectiveAt:      eff,
    recordedAt:       serverTimestamp(),
    recordedBy:       user ? user.uid : null,
    recordedByEmail:  user ? user.email || '' : '',
    invoiceId:        p.invoiceId || null,
    reason:           p.reason || '',
    mrrDelta:         Math.round(mrrDelta * 100) / 100,
    arrDelta:         Math.round(mrrDelta * 12 * 100) / 100,
    metadata:         p.metadata || {},
  };

  return addDoc(collection(db, 'subscription_events'), doc);
}

/** List events for a tenant, newest first. */
export async function listEventsForTenant(tenantId) {
  if (!tenantId) return [];
  const q = query(
    collection(db, 'subscription_events'),
    where('tenantId', '==', tenantId),
    orderBy('effectiveAt', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** List events by contactId (resolved via tenants linked to that contact). */
export async function listEventsForContact(contactId) {
  if (!contactId) return [];
  const q = query(
    collection(db, 'subscription_events'),
    where('contactId', '==', contactId),
    orderBy('effectiveAt', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** All events since date — for dashboard MRR-over-time charts. */
export async function listEventsSince(date) {
  const since = date instanceof Date ? Timestamp.fromDate(date) : date;
  const q = query(
    collection(db, 'subscription_events'),
    where('effectiveAt', '>=', since),
    orderBy('effectiveAt', 'asc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Backfill migration ──────────────────────────────────────────
//
// Scans tenants/*/activity for subscription-relevant types and
// synthesizes subscription_events. Flag-gated so it only runs once.

const FLAG_DOC_PATH = ['settings', 'migrations'];
const FLAG_KEY = 'subscriptionEventsBackfill';

const ACTIVITY_TO_EVENT = {
  quote_accepted:                EVENT_TYPES.CREATED,
  addon_added:                   EVENT_TYPES.ADDON_ADDED,
  addon_removed:                 EVENT_TYPES.ADDON_REMOVED,
  plan_changed:                  EVENT_TYPES.PLAN_CHANGED,
  subscription_cancelled:        EVENT_TYPES.CANCELLED,
  subscription_cancel_scheduled: EVENT_TYPES.CANCEL_SCHEDULED,
};

export async function backfillSubscriptionEvents() {
  const flagRef = doc(db, ...FLAG_DOC_PATH);
  const flagSnap = await getDoc(flagRef);
  const flags = flagSnap.exists() ? flagSnap.data() : {};
  if (flags[FLAG_KEY]) return { skipped: true, count: 0 };

  console.log('[migration] subscription_events backfill starting…');

  // 1. Enumerate all tenants.
  const tenantsSnap = await getDocs(collection(db, 'tenants'));
  let total = 0;

  for (const tenantDoc of tenantsSnap.docs) {
    const tenantId = tenantDoc.id;
    const tenant = tenantDoc.data();

    // 2. Read activity for this tenant.
    let actDocs = [];
    try {
      const actSnap = await getDocs(
        query(collection(db, 'tenants', tenantId, 'activity'), orderBy('createdAt', 'asc'))
      );
      actDocs = actSnap.docs;
    } catch (err) {
      console.warn(`[migration] tenant ${tenantId} activity read failed:`, err);
      continue;
    }

    for (const a of actDocs) {
      const act = a.data();
      const type = ACTIVITY_TO_EVENT[act.type];
      if (!type) continue;

      try {
        await addDoc(collection(db, 'subscription_events'), {
          tenantId,
          contactId:       tenant.contactId || null,
          type,
          fromState:       null,  // Not reconstructable
          toState:         null,
          effectiveAt:     act.createdAt || serverTimestamp(),
          recordedAt:      serverTimestamp(),
          recordedBy:      null,
          recordedByEmail: '(backfilled)',
          invoiceId:       act.metadata?.invoiceId || null,
          reason:          act.description || '',
          mrrDelta:        0,
          arrDelta:        0,
          metadata:        { ...(act.metadata || {}), backfilled: true, sourceActivityId: a.id },
        });
        total += 1;
      } catch (err) {
        console.warn('[migration] failed to write event:', err);
      }
    }
  }

  await setDoc(flagRef, {
    [FLAG_KEY]: { ranAt: serverTimestamp(), count: total },
  }, { merge: true });

  console.log(`[migration] subscription_events backfill complete (${total} events).`);
  return { skipped: false, count: total };
}
