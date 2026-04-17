// Admin-only test data seeder. Generates realistic-looking contacts / quotes / tenants
// so you don't have to hand-enter every field when testing flows.

import { db, auth } from '../config.js';
import {
  collection, addDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const FIRST_NAMES = [
  'James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda',
  'David', 'Barbara', 'William', 'Elizabeth', 'Richard', 'Susan', 'Joseph', 'Jessica',
  'Thomas', 'Sarah', 'Christopher', 'Karen', 'Charles', 'Nancy', 'Daniel', 'Lisa',
  'Matthew', 'Margaret', 'Anthony', 'Betty', 'Mark', 'Sandra', 'Donald', 'Ashley',
  'Steven', 'Kimberly', 'Paul', 'Emily', 'Andrew', 'Donna', 'Joshua', 'Michelle',
  'Kenneth', 'Dorothy', 'Kevin', 'Carol', 'Brian', 'Amanda', 'George', 'Melissa',
  'Timothy', 'Deborah', 'Ronald', 'Stephanie', 'Jason', 'Rebecca', 'Edward', 'Laura',
  'Jeffrey', 'Helen', 'Ryan', 'Sharon', 'Jacob', 'Cynthia', 'Gary', 'Kathleen',
  'Nicholas', 'Amy', 'Eric', 'Shirley', 'Stephen', 'Angela', 'Jonathan', 'Anna',
  'Larry', 'Brenda', 'Justin', 'Pamela', 'Scott', 'Emma', 'Brandon', 'Nicole',
];

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
  'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
  'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker',
  'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill',
  'Flores', 'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell',
  'Mitchell', 'Carter', 'Roberts', 'Gomez', 'Phillips', 'Evans', 'Turner', 'Diaz',
  'Parker', 'Cruz', 'Edwards', 'Collins', 'Reyes', 'Stewart', 'Morris', 'Morales',
  'Murphy', 'Cook', 'Rogers', 'Gutierrez', 'Ortiz', 'Morgan', 'Cooper', 'Peterson',
];

// Company name templates: mix of independent names + suffix patterns keyed by
// the industries our platform covers.
const COMPANY_PATTERNS = [
  // Repair
  { vertical: 'repair', templates: [
    '{last} Repair Shop', '{last} Electronics', 'Quick Fix by {last}', '{last} Device Clinic',
    'TechMend {last}', '{last} & Sons Repair', 'iFix by {last}', '{city} Device Repair',
  ]},
  // Trades
  { vertical: 'trades', templates: [
    '{last} Plumbing', '{last} HVAC Services', '{last} Electric Co.', '{last} Contracting',
    'Precision {last}', '{last} Heating & Air', '{city} Trades by {last}',
  ]},
  // Manufacturing
  { vertical: 'manufacturing', templates: [
    '{last} Manufacturing', '{last} Industries', '{last} Works', '{last} Fabrication',
    'Precision Products by {last}', '{last} Machine Shop',
  ]},
  // Services
  { vertical: 'services', templates: [
    '{last} Consulting', '{last} Advisors', '{last} & Partners', '{last} Strategy Group',
    'Clearwater {last}', '{last} Creative Studio', '{last} Digital',
  ]},
  // Property
  { vertical: 'property', templates: [
    '{last} Property Management', '{last} Realty', '{last} Holdings', '{last} Rentals',
    '{city} Properties by {last}', '{last} Real Estate Group',
  ]},
  // Salon
  { vertical: 'salon', templates: [
    '{last} Salon & Spa', 'Style by {last}', '{last} Hair Studio', '{last} Nails & Co.',
    'The {last} Salon', 'Pure {last} Beauty',
  ]},
];

const CITIES = [
  'Dallas', 'Austin', 'Houston', 'Nashville', 'Phoenix', 'Denver', 'Portland',
  'Seattle', 'Atlanta', 'Charlotte', 'Orlando', 'Tampa', 'Minneapolis', 'Indianapolis',
  'Kansas City', 'St. Louis', 'Columbus', 'Cincinnati', 'Cleveland', 'Pittsburgh',
];

const NOTES_POOL = [
  'Found us through a referral — Q4 priority lead.',
  'Previously used {competitor}. Looking for better reporting.',
  'Will decide by end of quarter. Price-sensitive but values service.',
  'Owner wears many hats — needs something low-maintenance.',
  'Growing fast — 3 new hires coming next month. Wants room to scale.',
  'Prefers text / SMS over email for updates.',
  'Technical buyer — cares about integrations. Asked about API access.',
  'Referred by {other}. Wants the same setup if possible.',
  'Had a bad experience with a prior vendor. Go easy on upsell.',
  'Ready to sign this week if pricing works out.',
  'Small team (2 people). Keep it simple — no add-on overload.',
  'Multi-location — needs per-site visibility eventually.',
];

const COMPETITORS = ['RepairShopr', 'ServiceTitan', 'Jobber', 'Housecall Pro', 'Pipedrive', 'Salesforce'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function randomPhone() {
  const area = 200 + Math.floor(Math.random() * 700);
  const exch = 200 + Math.floor(Math.random() * 700);
  const num = Math.floor(1000 + Math.random() * 9000);
  return `(${area}) ${exch}-${num}`;
}

function emailFrom(first, last) {
  const clean = s => s.toLowerCase().replace(/[^a-z]/g, '');
  const domains = ['gmail.com', 'outlook.com', 'yahoo.com', 'icloud.com', 'hey.com'];
  const style = Math.random();
  if (style < 0.4) return `${clean(first)}.${clean(last)}@${pick(domains)}`;
  if (style < 0.7) return `${clean(first)}${clean(last)}@${pick(domains)}`;
  return `${clean(first)[0]}${clean(last)}${Math.floor(Math.random() * 90) + 10}@${pick(domains)}`;
}

function companyFor(last) {
  const group = pick(COMPANY_PATTERNS);
  const template = pick(group.templates);
  return template
    .replace('{last}', last)
    .replace('{city}', pick(CITIES));
}

function noteFor() {
  return pick(NOTES_POOL)
    .replace('{competitor}', pick(COMPETITORS))
    .replace('{other}', pick(LAST_NAMES));
}

export function generateContact() {
  const firstName = pick(FIRST_NAMES);
  const lastName = pick(LAST_NAMES);
  return {
    firstName,
    lastName,
    email: emailFrom(firstName, lastName),
    phone: randomPhone(),
    company: companyFor(lastName),
    notes: noteFor(),
  };
}

// Main entry — creates N contacts, returns the IDs.
export async function seedContacts(count = 5) {
  const user = auth.currentUser;
  const created = [];
  for (let i = 0; i < count; i++) {
    const c = generateContact();
    const ref = await addDoc(collection(db, 'contacts'), {
      ...c,
      createdAt: serverTimestamp(),
      createdBy: user ? user.uid : null,
      updatedAt: serverTimestamp(),
      updatedBy: user ? user.uid : null,
      _seeded: true, // flag so you can find and purge test data later
    });
    created.push({ id: ref.id, ...c });
  }
  return created;
}
