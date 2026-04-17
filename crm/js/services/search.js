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
    (c.company || c.companyName || '').toLowerCase().includes(needle) ||
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
