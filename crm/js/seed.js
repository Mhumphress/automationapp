import { auth } from './config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { isAdmin, bootstrapCurrentUser } from './services/roles.js';
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
    statusEl.className = 'status error';
    return;
  }
  await bootstrapCurrentUser();
  const admin = await isAdmin();
  if (!admin) {
    statusEl.textContent = 'Access denied. Admin role required.';
    statusEl.className = 'status error';
    return;
  }
  statusEl.textContent = `Logged in as ${user.email} (admin). Ready to seed.`;
  statusEl.className = 'status ready';
  seedBtn.disabled = false;
});

seedBtn.addEventListener('click', async () => {
  seedBtn.disabled = true;
  statusEl.textContent = 'Seeding product catalog...';
  statusEl.className = 'status running';
  logEl.innerHTML = '';

  try {
    await seedBillingSettings();
    await seedVerticals();
    await seedFeatures();
    await seedAddons();
    await seedPackages();
    log('\n=== All done! ===', 'success');
    statusEl.textContent = 'Seed complete. All data written to Firestore.';
    statusEl.className = 'status ready';
  } catch (err) {
    log(`\nFATAL: ${err.message}`, 'error');
    console.error(err);
    statusEl.textContent = 'Seed failed. Check log for details.';
    statusEl.className = 'status error';
  }
  seedBtn.disabled = false;
});

// ── Billing Settings ──

async function seedBillingSettings() {
  log('── Billing Settings ──', 'heading');
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
  log('\n── Verticals ──', 'heading');

  const verticals = [
    {
      slug: 'repair',
      name: 'Electronics / Device Repair',
      icon: 'tool',
      modules: ['contacts', 'tickets', 'inventory', 'checkin', 'invoicing', 'tasks', 'scheduling', 'reporting'],
      terminology: { client: 'Customer', ticket: 'Repair Ticket', item: 'Device', inventory_item: 'Part' },
      defaultFeatures: ['contacts', 'tickets', 'invoicing', 'tasks'],
      description: 'Repair shops for phones, computers, electronics, and devices'
    },
    {
      slug: 'trades',
      name: 'Field Service / Trades',
      icon: 'wrench',
      modules: ['contacts', 'jobs', 'dispatching', 'quoting', 'invoicing', 'tasks', 'scheduling', 'reporting'],
      terminology: { client: 'Customer', ticket: 'Job', item: 'Service Call', inventory_item: 'Part/Material' },
      defaultFeatures: ['contacts', 'jobs', 'invoicing', 'tasks'],
      description: 'HVAC, plumbing, electrical, and general contracting'
    },
    {
      slug: 'manufacturing',
      name: 'Small-Scale Manufacturing',
      icon: 'factory',
      modules: ['contacts', 'bom', 'work_orders', 'production', 'inventory', 'invoicing', 'tasks', 'scheduling', 'reporting'],
      terminology: { client: 'Customer', ticket: 'Work Order', item: 'Product', inventory_item: 'Raw Material' },
      defaultFeatures: ['contacts', 'inventory', 'invoicing', 'tasks'],
      description: 'Workshop and small-scale manufacturing operations'
    },
    {
      slug: 'services',
      name: 'Professional Services / Consulting',
      icon: 'briefcase',
      modules: ['contacts', 'projects', 'time_tracking', 'proposals', 'resource_scheduling', 'invoicing', 'tasks', 'scheduling', 'reporting'],
      terminology: { client: 'Client', ticket: 'Task', item: 'Deliverable' },
      defaultFeatures: ['contacts', 'tasks', 'invoicing', 'time_tracking_manual'],
      description: 'Consulting firms, agencies, and professional service providers'
    },
    {
      slug: 'property',
      name: 'Property Management',
      icon: 'building',
      modules: ['contacts', 'properties', 'leases', 'maintenance', 'rent_collection', 'invoicing', 'tasks', 'scheduling', 'reporting'],
      terminology: { client: 'Owner/Tenant', ticket: 'Maintenance Request', item: 'Unit' },
      defaultFeatures: ['contacts', 'properties', 'invoicing', 'tasks'],
      description: 'Residential and commercial property management'
    },
    {
      slug: 'salon',
      name: 'Salon / Spa / Appointments',
      icon: 'scissors',
      modules: ['contacts', 'appointments', 'service_menu', 'staff_calendar', 'loyalty', 'invoicing', 'tasks', 'scheduling', 'reporting'],
      terminology: { client: 'Client', ticket: 'Appointment', item: 'Service', inventory_item: 'Product' },
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
  log('\n── Features ──', 'heading');

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
  log('\n── Add-ons ──', 'heading');

  const addons = [
    { slug: 'extra_users', name: 'Additional User Seat', priceMonthly: 19, priceAnnual: 190, pricingModel: 'per_unit', description: 'Add team members beyond plan limit', applicableVerticals: ['all'], active: true },
    { slug: 'extra_locations', name: 'Additional Location', priceMonthly: 39, priceAnnual: 390, pricingModel: 'per_unit', description: 'Add business locations', applicableVerticals: ['repair', 'salon', 'trades'], active: true },
    { slug: 'sms_pack', name: 'SMS Credits (500)', priceMonthly: 25, priceAnnual: 250, pricingModel: 'per_unit', description: '500 SMS credits for reminders and notifications', applicableVerticals: ['all'], active: true },
    { slug: 'white_label', name: 'White Label Branding', priceMonthly: 49, priceAnnual: 490, pricingModel: 'flat', description: 'Remove branding, use your own domain', applicableVerticals: ['all'], active: true },
    { slug: 'api_access_addon', name: 'API Access', priceMonthly: 29, priceAnnual: 290, pricingModel: 'flat', description: 'REST API for custom integrations', applicableVerticals: ['all'], active: true },
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

// ── Packages (6 verticals x 3 tiers = 18 packages) ──

async function seedPackages() {
  log('\n── Packages ──', 'heading');

  const packages = [
    // Repair
    { id: 'repair_basic', name: 'RepairApp Basic', vertical: 'repair', tier: 'basic', description: 'Essential repair shop management', basePrice: 49, annualPrice: 490, userLimit: 3, features: ['contacts', 'tickets', 'invoicing', 'tasks'], addOns: ['extra_users', 'sms_pack', 'extra_storage'], sortOrder: 1, active: true },
    { id: 'repair_pro', name: 'RepairApp Pro', vertical: 'repair', tier: 'pro', description: 'Full repair shop with inventory and check-in', basePrice: 99, annualPrice: 990, userLimit: 8, features: ['contacts', 'tickets', 'inventory', 'checkin', 'invoicing', 'tasks', 'scheduling', 'reporting'], addOns: ['extra_users', 'extra_locations', 'sms_pack', 'white_label', 'extra_storage'], sortOrder: 2, active: true },
    { id: 'repair_enterprise', name: 'RepairApp Enterprise', vertical: 'repair', tier: 'enterprise', description: 'Unlimited repair operations with advanced features', basePrice: 199, annualPrice: 1990, userLimit: 0, features: ['contacts', 'tickets', 'inventory', 'checkin', 'invoicing', 'tasks', 'scheduling', 'reporting', 'purchase_orders', 'low_stock_alerts', 'multi_location', 'api_access', 'custom_fields'], addOns: ['extra_locations', 'sms_pack', 'white_label', 'extra_storage', 'advanced_reporting'], sortOrder: 3, active: true },

    // Trades
    { id: 'trades_basic', name: 'TradesApp Basic', vertical: 'trades', tier: 'basic', description: 'Essential field service management', basePrice: 49, annualPrice: 490, userLimit: 3, features: ['contacts', 'jobs', 'invoicing', 'tasks'], addOns: ['extra_users', 'sms_pack', 'extra_storage'], sortOrder: 1, active: true },
    { id: 'trades_pro', name: 'TradesApp Pro', vertical: 'trades', tier: 'pro', description: 'Full dispatching and quoting', basePrice: 149, annualPrice: 1490, userLimit: 10, features: ['contacts', 'jobs', 'dispatching', 'quoting', 'invoicing', 'tasks', 'scheduling', 'reporting'], addOns: ['extra_users', 'extra_locations', 'sms_pack', 'white_label', 'extra_storage'], sortOrder: 2, active: true },
    { id: 'trades_enterprise', name: 'TradesApp Enterprise', vertical: 'trades', tier: 'enterprise', description: 'Full field service with automation', basePrice: 299, annualPrice: 2990, userLimit: 0, features: ['contacts', 'jobs', 'dispatching', 'quoting', 'invoicing', 'tasks', 'scheduling', 'reporting', 'recurring_jobs', 'online_booking', 'materials_inventory', 'api_access', 'custom_fields'], addOns: ['extra_locations', 'sms_pack', 'white_label', 'extra_storage', 'advanced_reporting'], sortOrder: 3, active: true },

    // Manufacturing
    { id: 'mfg_basic', name: 'MfgApp Basic', vertical: 'manufacturing', tier: 'basic', description: 'Essential inventory and order management', basePrice: 99, annualPrice: 990, userLimit: 3, features: ['contacts', 'inventory', 'invoicing', 'tasks'], addOns: ['extra_users', 'extra_storage'], sortOrder: 1, active: true },
    { id: 'mfg_pro', name: 'MfgApp Pro', vertical: 'manufacturing', tier: 'pro', description: 'Full BOM and work order management', basePrice: 249, annualPrice: 2490, userLimit: 10, features: ['contacts', 'inventory', 'bom', 'work_orders', 'invoicing', 'tasks', 'scheduling', 'reporting'], addOns: ['extra_users', 'sms_pack', 'white_label', 'extra_storage'], sortOrder: 2, active: true },
    { id: 'mfg_enterprise', name: 'MfgApp Enterprise', vertical: 'manufacturing', tier: 'enterprise', description: 'Advanced manufacturing with production planning', basePrice: 499, annualPrice: 4990, userLimit: 0, features: ['contacts', 'inventory', 'bom', 'work_orders', 'production', 'invoicing', 'tasks', 'scheduling', 'reporting', 'multi_level_bom', 'purchase_orders', 'api_access', 'custom_fields'], addOns: ['extra_users', 'sms_pack', 'white_label', 'extra_storage', 'advanced_reporting'], sortOrder: 3, active: true },

    // Services
    { id: 'services_basic', name: 'ServicesApp Basic', vertical: 'services', tier: 'basic', description: 'Essential client and time management', basePrice: 29, annualPrice: 290, userLimit: 2, features: ['contacts', 'tasks', 'invoicing', 'time_tracking_manual'], addOns: ['extra_users', 'extra_storage'], sortOrder: 1, active: true },
    { id: 'services_pro', name: 'ServicesApp Pro', vertical: 'services', tier: 'pro', description: 'Full project and proposal management', basePrice: 79, annualPrice: 790, userLimit: 10, features: ['contacts', 'tasks', 'invoicing', 'time_tracking', 'projects', 'proposals', 'scheduling', 'reporting'], addOns: ['extra_users', 'sms_pack', 'white_label', 'extra_storage'], sortOrder: 2, active: true },
    { id: 'services_enterprise', name: 'ServicesApp Enterprise', vertical: 'services', tier: 'enterprise', description: 'Full professional services suite', basePrice: 149, annualPrice: 1490, userLimit: 0, features: ['contacts', 'tasks', 'invoicing', 'time_tracking', 'projects', 'proposals', 'scheduling', 'reporting', 'resource_scheduling', 'budget_tracking', 'api_access', 'custom_fields'], addOns: ['extra_users', 'sms_pack', 'white_label', 'extra_storage', 'advanced_reporting'], sortOrder: 3, active: true },

    // Property — Pro and Enterprise only (Basic was deprecated 2026-04-18)
    { id: 'property_pro', name: 'PropertyApp Pro', vertical: 'property', tier: 'pro', description: 'Full lease and maintenance management (up to 100 units)', basePrice: 149, annualPrice: 1490, userLimit: 10, features: ['contacts', 'properties', 'leases', 'maintenance', 'rent_collection', 'invoicing', 'tasks', 'scheduling', 'reporting'], addOns: ['extra_users', 'sms_pack', 'white_label', 'extra_storage'], sortOrder: 1, active: true },
    { id: 'property_enterprise', name: 'PropertyApp Enterprise', vertical: 'property', tier: 'enterprise', description: 'Unlimited property management with analytics', basePrice: 299, annualPrice: 2990, userLimit: 0, features: ['contacts', 'properties', 'leases', 'maintenance', 'rent_collection', 'invoicing', 'tasks', 'scheduling', 'reporting', 'bulk_invoicing', 'vacancy_analytics', 'api_access', 'custom_fields'], addOns: ['extra_users', 'sms_pack', 'white_label', 'extra_storage', 'advanced_reporting'], sortOrder: 2, active: true },

    // Salon
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
