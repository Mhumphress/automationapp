import { db, auth } from '../config.js';
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc,
  query, orderBy, serverTimestamp, runTransaction, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getTenantId } from '../tenant-context.js';

const HISTORY_CAP = 50;

function tenantDoc(path) {
  const tid = getTenantId();
  if (!tid) throw new Error('No tenant context');
  return doc(db, `tenants/${tid}/${path}`);
}

function tenantCollection(path) {
  const tid = getTenantId();
  if (!tid) throw new Error('No tenant context');
  return collection(db, `tenants/${tid}/${path}`);
}

// ── Queries ─────────────────────────────

export async function listTickets() {
  const q = query(tenantCollection('tickets'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getTicket(ticketId) {
  const snap = await getDoc(tenantDoc(`tickets/${ticketId}`));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

// ── Create with atomic number minting ──

export async function createTicket(data) {
  const tid = getTenantId();
  if (!tid) throw new Error('No tenant context');
  const user = auth.currentUser;
  const counterRef = doc(db, `tenants/${tid}/counters/tickets`);
  const ticketsCol = collection(db, `tenants/${tid}/tickets`);

  return runTransaction(db, async (tx) => {
    const counterSnap = await tx.get(counterRef);
    const last = counterSnap.exists() ? (counterSnap.data().lastNumber || 0) : 0;
    const next = last + 1;
    const ticketNumber = `T-${String(next).padStart(3, '0')}`;

    // Use addDoc-equivalent: make a new doc ref manually
    const newRef = doc(ticketsCol);

    const now = serverTimestamp();
    const history = [{
      type: 'status_change',
      description: `Ticket created with status ${data.status || 'checked_in'}`,
      at: Timestamp.now(),
      byUid: user ? user.uid : null,
      byEmail: user ? user.email : null
    }];

    tx.set(newRef, {
      ticketNumber,
      contactId: data.contactId || null,
      customerName: data.customerName || '',
      deviceType: data.deviceType || '',
      serial: data.serial || '',
      issue: data.issue || '',
      condition: data.condition || '',
      status: data.status || 'checked_in',
      estimatedCompletion: data.estimatedCompletion || null,
      assignedTechId: data.assignedTechId || null,
      partsUsed: [],
      partsNotes: data.partsNotes || '',
      laborMinutes: 0,
      notes: data.notes || '',
      history,
      invoiceId: null,
      completedAt: null,
      createdAt: now,
      createdBy: user ? user.uid : null,
      updatedAt: now,
      updatedBy: user ? user.uid : null
    });

    tx.set(counterRef, { lastNumber: next }, { merge: true });

    return { id: newRef.id, ticketNumber };
  });
}

// ── Update basic fields (no inventory-touching changes) ──

export async function updateTicket(ticketId, patch) {
  const user = auth.currentUser;
  const ref = tenantDoc(`tickets/${ticketId}`);

  // If status is changing to 'completed', set completedAt
  const updates = {
    ...patch,
    updatedAt: serverTimestamp(),
    updatedBy: user ? user.uid : null
  };
  if (patch.status === 'completed') {
    updates.completedAt = serverTimestamp();
  }
  return updateDoc(ref, updates);
}

// ── Append history (capped at 50 entries) ──

export async function appendTicketHistory(ticketId, entry) {
  const user = auth.currentUser;
  const ref = tenantDoc(`tickets/${ticketId}`);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Ticket not found');
  const existing = snap.data().history || [];
  const next = [
    {
      ...entry,
      at: Timestamp.now(),
      byUid: user ? user.uid : null,
      byEmail: user ? user.email : null
    },
    ...existing
  ].slice(0, HISTORY_CAP);
  return updateDoc(ref, {
    history: next,
    updatedAt: serverTimestamp(),
    updatedBy: user ? user.uid : null
  });
}

// ── Add part to ticket (transactional with inventory) ──

export async function addPartToTicket(ticketId, partId, qty) {
  const tid = getTenantId();
  if (!tid) throw new Error('No tenant context');
  const user = auth.currentUser;
  const ticketRef = doc(db, `tenants/${tid}/tickets/${ticketId}`);
  const partRef = doc(db, `tenants/${tid}/inventory/${partId}`);

  return runTransaction(db, async (tx) => {
    const [ticketSnap, partSnap] = await Promise.all([tx.get(ticketRef), tx.get(partRef)]);
    if (!ticketSnap.exists()) throw new Error('Ticket not found');
    if (!partSnap.exists()) throw new Error('Part not found');

    const ticket = ticketSnap.data();
    const part = partSnap.data();

    if ((part.quantity || 0) < qty) {
      throw new Error(`Not enough stock: ${part.name} has ${part.quantity || 0} available`);
    }

    const partsUsed = Array.isArray(ticket.partsUsed) ? [...ticket.partsUsed] : [];
    partsUsed.push({
      partId,
      sku: part.sku || '',
      name: part.name || '',
      qty,
      unitCost: part.unitCost || 0,
      unitPrice: part.unitPrice || 0
    });

    const historyEntry = {
      type: 'part_added',
      description: `Added ${qty}× ${part.name || part.sku}`,
      at: Timestamp.now(),
      byUid: user ? user.uid : null,
      byEmail: user ? user.email : null
    };
    const history = [historyEntry, ...(ticket.history || [])].slice(0, HISTORY_CAP);

    tx.update(ticketRef, {
      partsUsed,
      history,
      updatedAt: serverTimestamp(),
      updatedBy: user ? user.uid : null
    });
    tx.update(partRef, {
      quantity: (part.quantity || 0) - qty,
      updatedAt: serverTimestamp(),
      updatedBy: user ? user.uid : null
    });
  });
}

// ── Remove part from ticket (transactional — returns stock) ──

export async function removePartFromTicket(ticketId, partIndex) {
  const tid = getTenantId();
  if (!tid) throw new Error('No tenant context');
  const user = auth.currentUser;
  const ticketRef = doc(db, `tenants/${tid}/tickets/${ticketId}`);

  return runTransaction(db, async (tx) => {
    const ticketSnap = await tx.get(ticketRef);
    if (!ticketSnap.exists()) throw new Error('Ticket not found');
    const ticket = ticketSnap.data();
    const partsUsed = Array.isArray(ticket.partsUsed) ? [...ticket.partsUsed] : [];
    if (partIndex < 0 || partIndex >= partsUsed.length) throw new Error('Invalid part index');

    const removed = partsUsed.splice(partIndex, 1)[0];
    const partRef = removed.partId ? doc(db, `tenants/${tid}/inventory/${removed.partId}`) : null;

    // All reads before any writes (Firestore transaction requirement)
    let partData = null;
    if (partRef) {
      const partSnap = await tx.get(partRef);
      if (partSnap.exists()) partData = partSnap.data();
    }

    const historyEntry = {
      type: 'part_removed',
      description: `Removed ${removed.qty}× ${removed.name || removed.sku}`,
      at: Timestamp.now(),
      byUid: user ? user.uid : null,
      byEmail: user ? user.email : null
    };
    const history = [historyEntry, ...(ticket.history || [])].slice(0, HISTORY_CAP);

    tx.update(ticketRef, {
      partsUsed,
      history,
      updatedAt: serverTimestamp(),
      updatedBy: user ? user.uid : null
    });

    if (partRef && partData) {
      tx.update(partRef, {
        quantity: (partData.quantity || 0) + removed.qty,
        updatedAt: serverTimestamp(),
        updatedBy: user ? user.uid : null
      });
    }
  });
}

// ── Generate invoice from a completed ticket ──
// Creates the invoice at tenants/{t}/invoices_crm, links ticket.invoiceId, logs activity.
// For Basic tier (no partsUsed), caller passes basicPartsTotal and basicPartsLabel.

export async function generateInvoiceFromTicket(ticketId, opts = {}) {
  const tid = getTenantId();
  if (!tid) throw new Error('No tenant context');
  const user = auth.currentUser;
  const ticketRef = doc(db, `tenants/${tid}/tickets/${ticketId}`);
  const settingsRef = doc(db, `tenants/${tid}/settings/general`);
  const invoicesCol = collection(db, `tenants/${tid}/invoices_crm`);
  const activityCol = collection(db, `tenants/${tid}/activity`);

  return runTransaction(db, async (tx) => {
    // All reads first
    const [ticketSnap, settingsSnap] = await Promise.all([
      tx.get(ticketRef),
      tx.get(settingsRef)
    ]);
    if (!ticketSnap.exists()) throw new Error('Ticket not found');
    const ticket = { id: ticketSnap.id, ...ticketSnap.data() };
    if (ticket.invoiceId) throw new Error('Ticket already has an invoice');
    if (ticket.status !== 'completed') throw new Error('Ticket must be completed to generate an invoice');

    const laborRate = settingsSnap.exists() ? (settingsSnap.data().laborRate || 0) : 0;

    // Compute line items
    const lineItems = [];
    let subtotal = 0;

    const hasInventoryParts = Array.isArray(ticket.partsUsed) && ticket.partsUsed.length > 0;
    if (hasInventoryParts) {
      ticket.partsUsed.forEach(p => {
        const amount = (p.qty || 0) * (p.unitPrice || 0);
        lineItems.push({
          description: p.name || p.sku || 'Part',
          quantity: p.qty || 0,
          rate: p.unitPrice || 0,
          amount
        });
        subtotal += amount;
      });
    } else if (opts.basicPartsTotal && opts.basicPartsTotal > 0) {
      const amount = opts.basicPartsTotal;
      lineItems.push({
        description: opts.basicPartsLabel || 'Parts',
        quantity: 1,
        rate: amount,
        amount
      });
      subtotal += amount;
    }

    if ((ticket.laborMinutes || 0) > 0) {
      const hours = Math.round(((ticket.laborMinutes || 0) / 60) * 4) / 4;
      const labor = hours * laborRate;
      lineItems.push({
        description: 'Labor',
        quantity: hours,
        rate: laborRate,
        amount: labor
      });
      subtotal += labor;
    }

    const invoiceNumber = `INV-${ticket.ticketNumber}`;
    const invoiceRef = doc(invoicesCol);
    const activityRef = doc(activityCol);

    const invoiceData = {
      invoiceNumber,
      clientName: ticket.customerName || '',
      contactId: ticket.contactId || null,
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      issueDate: new Date().toISOString().split('T')[0],
      dueDate: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
      lineItems,
      subtotal,
      taxRate: 0,
      taxAmount: 0,
      total: subtotal,
      status: 'draft',
      notes: `Auto-generated from ticket ${ticket.ticketNumber}`,
      createdAt: serverTimestamp(),
      createdBy: user ? user.uid : null,
      updatedAt: serverTimestamp(),
      updatedBy: user ? user.uid : null
    };

    // All writes
    tx.set(invoiceRef, invoiceData);

    const historyEntry = {
      type: 'invoice_generated',
      description: `Invoice ${invoiceNumber} generated (${lineItems.length} line items)`,
      at: Timestamp.now(),
      byUid: user ? user.uid : null,
      byEmail: user ? user.email : null
    };
    tx.update(ticketRef, {
      invoiceId: invoiceRef.id,
      history: [historyEntry, ...(ticket.history || [])].slice(0, HISTORY_CAP),
      updatedAt: serverTimestamp(),
      updatedBy: user ? user.uid : null
    });

    tx.set(activityRef, {
      type: 'ticket_completed',
      description: `Ticket ${ticket.ticketNumber} completed and invoice ${invoiceNumber} generated`,
      metadata: { ticketId: ticket.id, invoiceId: invoiceRef.id },
      createdAt: serverTimestamp(),
      createdBy: user ? user.uid : null,
      createdByEmail: user ? user.email : null
    });

    return { invoiceId: invoiceRef.id, invoiceNumber };
  });
}

export { Timestamp };
