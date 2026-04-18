// ─────────────────────────────────────────────────────────────────
//  record-configs.js — Per-vertical configuration for the generic
//  records module. Each config maps to a single tenant subcollection.
// ─────────────────────────────────────────────────────────────────

import { renderLeaseBillingSection } from './lease-billing-section.js';
import { makeQuickInvoiceSection } from './quick-invoice-section.js';
import { renderPropertyUnitsSection } from './property-units-section.js';
import { renderUnitDetailSection } from './unit-detail-section.js';
import { openAssignTenantPicker } from './assign-tenant-picker.js';

// ── Salon ─────────────────────────────────────────────────

export const appointmentsConfig = {
  collection: 'appointments',
  title: 'Appointments',
  singular: 'Appointment',
  showCalendar: true,
  calendarTitle: 'title',
  calendarStart: 'startAt',
  calendarEnd: 'endAt',
  colorField: 'status',
  orderField: 'startAt',
  statuses: ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'],
  listColumns: ['title', 'customerName', 'staff', 'startAt', 'status'],
  fields: [
    { key: 'title', label: 'Title', type: 'text', required: true, primary: true },
    { key: 'customerName', label: 'Customer', type: 'text' },
    { key: 'customerPhone', label: 'Customer Phone', type: 'tel' },
    { key: 'service', label: 'Service', type: 'text' },
    { key: 'staff', label: 'Staff', type: 'text' },
    { key: 'startAt', label: 'Start', type: 'datetime', required: true },
    { key: 'endAt', label: 'End', type: 'datetime', required: true },
    { key: 'price', label: 'Price', type: 'money' },
    { key: 'status', label: 'Status', type: 'select', options: ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'], default: 'scheduled' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
  detailSections: [
    { title: 'Billing', render: makeQuickInvoiceSection({
      parentType: 'appointment',
      chargeType: 'service',
      buildLineItems: (rec) => {
        if (rec.price && rec.price > 0) {
          return [{
            description: rec.service || rec.title || 'Service',
            quantity: 1,
            rate: rec.price,
            amount: rec.price,
          }];
        }
        return [];
      },
    }) },
  ],
};

export const servicesMenuConfig = {
  collection: 'services_menu',
  title: 'Services',
  singular: 'Service',
  listColumns: ['name', 'category', 'durationMinutes', 'price', 'active'],
  statuses: ['active', 'inactive'],
  fields: [
    { key: 'name', label: 'Name', type: 'text', required: true, primary: true },
    { key: 'category', label: 'Category', type: 'text' },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'durationMinutes', label: 'Duration (min)', type: 'number' },
    { key: 'price', label: 'Price', type: 'money' },
    { key: 'active', label: 'Status', type: 'select', options: ['active', 'inactive'], default: 'active' },
  ],
};

export const staffCalendarConfig = {
  collection: 'appointments',  // same collection; calendar filtered view
  title: 'Staff Calendar',
  singular: 'Appointment',
  showCalendar: true,
  calendarTitle: 'staff',
  calendarStart: 'startAt',
  calendarEnd: 'endAt',
  colorField: 'status',
  orderField: 'startAt',
  listColumns: ['staff', 'title', 'customerName', 'startAt', 'status'],
  statuses: ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'],
  fields: [
    { key: 'staff', label: 'Staff', type: 'text', required: true, primary: true },
    { key: 'title', label: 'Title', type: 'text', required: true },
    { key: 'customerName', label: 'Customer', type: 'text' },
    { key: 'startAt', label: 'Start', type: 'datetime', required: true },
    { key: 'endAt', label: 'End', type: 'datetime', required: true },
    { key: 'status', label: 'Status', type: 'select', options: ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'], default: 'scheduled' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
};

export const membershipsConfig = {
  collection: 'memberships',
  title: 'Memberships',
  singular: 'Membership',
  listColumns: ['customerName', 'planName', 'monthlyPrice', 'startDate', 'nextRenewal', 'status'],
  statuses: ['active', 'paused', 'cancelled', 'expired'],
  fields: [
    { key: 'customerName', label: 'Client', type: 'text', required: true, primary: true },
    { key: 'customerEmail', label: 'Client Email', type: 'email' },
    { key: 'customerPhone', label: 'Client Phone', type: 'tel' },
    { key: 'planName', label: 'Plan', type: 'text', required: true },
    { key: 'monthlyPrice', label: 'Monthly Price', type: 'money' },
    { key: 'includedServices', label: 'Included services (comma-separated)', type: 'textarea' },
    { key: 'serviceQuota', label: 'Services per month (0 = unlimited)', type: 'number' },
    { key: 'startDate', label: 'Start Date', type: 'date', required: true },
    { key: 'nextRenewal', label: 'Next Renewal', type: 'date' },
    { key: 'billingDay', label: 'Billing Day (1-28)', type: 'number' },
    { key: 'autoBill', label: 'Auto-Bill?', type: 'select', options: ['yes', 'no'], default: 'yes' },
    { key: 'status', label: 'Status', type: 'select', options: ['active', 'paused', 'cancelled', 'expired'], default: 'active' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
};

export const loyaltyConfig = {
  collection: 'loyalty',
  title: 'Loyalty',
  singular: 'Loyalty Record',
  listColumns: ['customerName', 'points', 'visits', 'tier', 'lastVisit'],
  statuses: ['bronze', 'silver', 'gold', 'platinum'],
  fields: [
    { key: 'customerName', label: 'Customer', type: 'text', required: true, primary: true },
    { key: 'customerEmail', label: 'Email', type: 'email' },
    { key: 'points', label: 'Points', type: 'number', default: 0 },
    { key: 'visits', label: 'Visits', type: 'number', default: 0 },
    { key: 'tier', label: 'Tier', type: 'select', options: ['bronze', 'silver', 'gold', 'platinum'], default: 'bronze' },
    { key: 'lastVisit', label: 'Last Visit', type: 'date' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
};

// ── Trades ────────────────────────────────────────────────

export const jobsConfig = {
  collection: 'jobs',
  title: 'Jobs',
  singular: 'Job',
  showCalendar: true,
  calendarTitle: 'name',
  calendarStart: 'scheduledAt',
  calendarEnd: 'completedAt',
  colorField: 'status',
  orderField: 'scheduledAt',
  listColumns: ['name', 'customerName', 'assignedTo', 'scheduledAt', 'status'],
  statuses: ['new', 'scheduled', 'in_progress', 'completed', 'cancelled', 'on_hold'],
  fields: [
    { key: 'name', label: 'Job Name', type: 'text', required: true, primary: true },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'customerName', label: 'Customer', type: 'text' },
    { key: 'address', label: 'Address', type: 'text' },
    { key: 'assignedTo', label: 'Assigned To', type: 'text' },
    { key: 'scheduledAt', label: 'Scheduled', type: 'datetime' },
    { key: 'completedAt', label: 'Completed', type: 'datetime' },
    { key: 'laborHours', label: 'Labor Hours', type: 'number' },
    { key: 'materialsCost', label: 'Materials $', type: 'money' },
    { key: 'totalPrice', label: 'Total Price', type: 'money' },
    { key: 'status', label: 'Status', type: 'select', options: ['new', 'scheduled', 'in_progress', 'completed', 'cancelled', 'on_hold'], default: 'new' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
  detailSections: [
    { title: 'Billing', render: makeQuickInvoiceSection({
      parentType: 'job',
      chargeType: 'service',
      buildLineItems: (rec) => {
        const lines = [];
        if (rec.laborHours && rec.laborHours > 0) {
          lines.push({
            description: rec.description ? `Labor: ${rec.description}` : 'Labor',
            quantity: rec.laborHours,
            rate: 0,
            amount: 0,
          });
        }
        if (rec.materialsCost && rec.materialsCost > 0) {
          lines.push({
            description: 'Materials',
            quantity: 1,
            rate: rec.materialsCost,
            amount: rec.materialsCost,
          });
        }
        if (rec.totalPrice && rec.totalPrice > 0 && lines.length === 0) {
          lines.push({
            description: rec.name || 'Job',
            quantity: 1,
            rate: rec.totalPrice,
            amount: rec.totalPrice,
          });
        }
        return lines;
      },
    }) },
  ],
};

export const dispatchingConfig = {
  collection: 'scheduling',
  title: 'Dispatching',
  singular: 'Dispatch',
  showCalendar: true,
  calendarTitle: 'jobName',
  calendarStart: 'startAt',
  calendarEnd: 'endAt',
  colorField: 'status',
  orderField: 'startAt',
  listColumns: ['jobName', 'technician', 'startAt', 'status'],
  statuses: ['unassigned', 'assigned', 'en_route', 'on_site', 'completed', 'cancelled'],
  fields: [
    { key: 'jobName', label: 'Job', type: 'text', required: true, primary: true },
    { key: 'technician', label: 'Technician', type: 'text' },
    { key: 'address', label: 'Address', type: 'text' },
    { key: 'startAt', label: 'Start', type: 'datetime', required: true },
    { key: 'endAt', label: 'End', type: 'datetime' },
    { key: 'status', label: 'Status', type: 'select', options: ['unassigned', 'assigned', 'en_route', 'on_site', 'completed', 'cancelled'], default: 'unassigned' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
};

export const quotingConfig = {
  collection: 'quotes',
  title: 'Quoting',
  singular: 'Quote',
  listColumns: ['quoteNumber', 'customerName', 'total', 'status', 'createdAt'],
  statuses: ['draft', 'sent', 'accepted', 'declined', 'expired'],
  fields: [
    { key: 'quoteNumber', label: 'Quote #', type: 'text', required: true, primary: true },
    { key: 'customerName', label: 'Customer', type: 'text', required: true },
    { key: 'customerEmail', label: 'Email', type: 'email' },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'subtotal', label: 'Subtotal', type: 'money' },
    { key: 'tax', label: 'Tax', type: 'money' },
    { key: 'total', label: 'Total', type: 'money' },
    { key: 'status', label: 'Status', type: 'select', options: ['draft', 'sent', 'accepted', 'declined', 'expired'], default: 'draft' },
    { key: 'validUntil', label: 'Valid Until', type: 'date' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
};

// ── Manufacturing ─────────────────────────────────────────

export const workOrdersConfig = {
  collection: 'work_orders',
  title: 'Work Orders',
  singular: 'Work Order',
  listColumns: ['orderNumber', 'product', 'quantity', 'assignedTo', 'dueDate', 'status'],
  statuses: ['queued', 'in_progress', 'qa', 'completed', 'on_hold', 'cancelled'],
  fields: [
    { key: 'orderNumber', label: 'WO #', type: 'text', required: true, primary: true },
    { key: 'product', label: 'Product', type: 'text', required: true },
    { key: 'quantity', label: 'Quantity', type: 'number' },
    { key: 'customerName', label: 'Customer', type: 'text' },
    { key: 'customerEmail', label: 'Customer Email', type: 'email' },
    { key: 'unitPrice', label: 'Unit Price', type: 'money' },
    { key: 'assignedTo', label: 'Assigned To', type: 'text' },
    { key: 'dueDate', label: 'Due', type: 'date' },
    { key: 'status', label: 'Status', type: 'select', options: ['queued', 'in_progress', 'qa', 'completed', 'on_hold', 'cancelled'], default: 'queued' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
  detailSections: [
    { title: 'Billing', render: makeQuickInvoiceSection({
      parentType: 'work_order',
      chargeType: 'service',
      buildLineItems: (rec) => {
        if (rec.unitPrice && rec.quantity) {
          return [{
            description: `${rec.product || 'Work order'} — ${rec.orderNumber || ''}`.trim(),
            quantity: Number(rec.quantity) || 1,
            rate: Number(rec.unitPrice) || 0,
            amount: (Number(rec.quantity) || 1) * (Number(rec.unitPrice) || 0),
          }];
        }
        return [];
      },
    }) },
  ],
};

export const bomConfig = {
  collection: 'bom',
  title: 'Bills of Materials',
  singular: 'BOM',
  listColumns: ['productName', 'version', 'partCount', 'totalCost', 'active'],
  statuses: ['active', 'draft', 'obsolete'],
  fields: [
    { key: 'productName', label: 'Product', type: 'text', required: true, primary: true },
    { key: 'version', label: 'Version', type: 'text' },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'partCount', label: 'Parts', type: 'number' },
    { key: 'totalCost', label: 'Total Cost', type: 'money' },
    { key: 'active', label: 'Status', type: 'select', options: ['active', 'draft', 'obsolete'], default: 'active' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
};

// ── Services ──────────────────────────────────────────────

export const projectsConfig = {
  collection: 'projects',
  title: 'Projects',
  singular: 'Project',
  listColumns: ['name', 'clientName', 'projectManager', 'status', 'dueDate'],
  statuses: ['planning', 'active', 'on_hold', 'completed', 'cancelled'],
  fields: [
    { key: 'name', label: 'Project Name', type: 'text', required: true, primary: true },
    { key: 'clientName', label: 'Client', type: 'text' },
    { key: 'clientEmail', label: 'Client Email', type: 'email' },
    { key: 'projectManager', label: 'Project Manager', type: 'text' },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'startDate', label: 'Start', type: 'date' },
    { key: 'dueDate', label: 'Due', type: 'date' },
    { key: 'budget', label: 'Budget', type: 'money' },
    { key: 'status', label: 'Status', type: 'select', options: ['planning', 'active', 'on_hold', 'completed', 'cancelled'], default: 'planning' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
  detailSections: [
    { title: 'Billing', render: makeQuickInvoiceSection({
      parentType: 'project',
      chargeType: 'retainer',
      customerFields: { name: 'clientName', email: 'clientEmail' },
      buildLineItems: (rec) => rec.budget ? [{
        description: rec.name || 'Project retainer',
        quantity: 1,
        rate: rec.budget,
        amount: rec.budget,
      }] : [],
    }) },
  ],
};

export const timeTrackingConfig = {
  collection: 'time_entries',
  title: 'Time Tracking',
  singular: 'Time Entry',
  listColumns: ['description', 'project', 'user', 'hours', 'date', 'billable'],
  statuses: ['billable', 'non_billable'],
  fields: [
    { key: 'description', label: 'Description', type: 'text', required: true, primary: true },
    { key: 'project', label: 'Project', type: 'text' },
    { key: 'user', label: 'User', type: 'text' },
    { key: 'date', label: 'Date', type: 'date', required: true },
    { key: 'hours', label: 'Hours', type: 'number', required: true },
    { key: 'rate', label: 'Rate', type: 'money' },
    { key: 'billable', label: 'Billable', type: 'select', options: ['billable', 'non_billable'], default: 'billable' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
};

export const proposalsConfig = {
  collection: 'proposals',
  title: 'Proposals',
  singular: 'Proposal',
  listColumns: ['title', 'clientName', 'total', 'status', 'validUntil'],
  statuses: ['draft', 'sent', 'accepted', 'declined', 'expired'],
  fields: [
    { key: 'title', label: 'Title', type: 'text', required: true, primary: true },
    { key: 'clientName', label: 'Client', type: 'text' },
    { key: 'scope', label: 'Scope', type: 'textarea' },
    { key: 'total', label: 'Total', type: 'money' },
    { key: 'validUntil', label: 'Valid Until', type: 'date' },
    { key: 'status', label: 'Status', type: 'select', options: ['draft', 'sent', 'accepted', 'declined', 'expired'], default: 'draft' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
};

// ── Property ──────────────────────────────────────────────

export const propertiesConfig = {
  collection: 'properties',
  title: 'Properties',
  singular: 'Property',
  listColumns: ['name', 'address', 'type', 'units', 'status'],
  statuses: ['active', 'acquiring', 'selling', 'off_market'],
  fields: [
    { key: 'name', label: 'Name', type: 'text', required: true, primary: true },
    { key: 'address', label: 'Address', type: 'text', required: true },
    { key: 'type', label: 'Type', type: 'select', options: ['residential', 'commercial', 'mixed_use'], default: 'residential' },
    { key: 'units', label: 'Total Units', type: 'number' },
    { key: 'squareFeet', label: 'Total Sq Ft', type: 'number' },
    { key: 'yearBuilt', label: 'Year Built', type: 'number' },
    { key: 'purchasePrice', label: 'Purchase Price', type: 'money' },
    { key: 'currentValue', label: 'Current Value', type: 'money' },
    { key: 'status', label: 'Status', type: 'select', options: ['active', 'acquiring', 'selling', 'off_market'], default: 'active' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
  detailSections: [
    { title: 'Units at this property', render: renderPropertyUnitsSection },
  ],
};

export const unitsConfig = {
  collection: 'units',
  title: 'Units',
  singular: 'Unit',
  orderField: 'label',
  listColumns: ['label', 'propertyName', 'bedrooms', 'sqft', 'baseRent', 'status', 'currentTenantName'],
  statuses: ['vacant', 'occupied', 'maintenance', 'off_market'],
  fields: [
    { key: 'label', label: 'Unit Label', type: 'text', required: true, primary: true },
    { key: 'propertyName', label: 'Property', type: 'text' },
    { key: 'propertyId', label: 'Property ID', type: 'text' },
    { key: 'bedrooms', label: 'Bedrooms', type: 'number' },
    { key: 'bathrooms', label: 'Bathrooms', type: 'number' },
    { key: 'sqft', label: 'Square Feet', type: 'number' },
    { key: 'baseRent', label: 'Base Rent', type: 'money' },
    { key: 'securityDeposit', label: 'Security Deposit', type: 'money' },
    { key: 'status', label: 'Status', type: 'select', options: ['vacant', 'occupied', 'maintenance', 'off_market'], default: 'vacant' },
    { key: 'currentTenantName', label: 'Current Tenant', type: 'text' },
    { key: 'currentLeaseId', label: 'Current Lease ID', type: 'text' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
  detailSections: [
    { title: 'Current lease', render: renderUnitDetailSection },
  ],
};

export const leasesConfig = {
  collection: 'leases',
  title: 'Tenants & Leases',
  singular: 'Lease',
  listColumns: ['tenantName', 'property', 'unit', 'startDate', 'endDate', 'monthlyRent', 'status'],
  statuses: ['active', 'pending', 'expired', 'terminated'],
  fields: [
    { key: 'tenantName', label: 'Tenant (Renter) Name', type: 'text', required: true, primary: true },
    { key: 'tenantEmail', label: 'Tenant Email', type: 'email' },
    { key: 'tenantPhone', label: 'Tenant Phone', type: 'tel' },
    { key: 'property', label: 'Property', type: 'text' },
    { key: 'unit', label: 'Unit Label', type: 'text' },
    { key: 'propertyId', label: 'Property ID (for auto-link)', type: 'text' },
    { key: 'unitId', label: 'Unit ID (for auto-link)', type: 'text' },
    { key: 'startDate', label: 'Lease Start', type: 'date', required: true },
    { key: 'endDate', label: 'Lease End', type: 'date', required: true },
    { key: 'monthlyRent', label: 'Monthly Rent', type: 'money' },
    { key: 'deposit', label: 'Security Deposit', type: 'money' },
    { key: 'status', label: 'Status', type: 'select', options: ['active', 'pending', 'expired', 'terminated'], default: 'pending' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
  detailSections: [
    { title: 'Billing', render: renderLeaseBillingSection },
  ],
  createOverride: openAssignTenantPicker,
};

export const maintenanceConfig = {
  collection: 'maintenance',
  title: 'Maintenance',
  singular: 'Request',
  showCalendar: true,
  calendarTitle: 'issue',
  calendarStart: 'scheduledAt',
  calendarEnd: 'completedAt',
  colorField: 'status',
  orderField: 'scheduledAt',
  listColumns: ['issue', 'property', 'priority', 'scheduledAt', 'status'],
  statuses: ['open', 'scheduled', 'in_progress', 'completed', 'cancelled'],
  fields: [
    { key: 'issue', label: 'Issue', type: 'text', required: true, primary: true },
    { key: 'property', label: 'Property', type: 'text' },
    { key: 'unit', label: 'Unit', type: 'text' },
    { key: 'tenantName', label: 'Bill To (Tenant)', type: 'text' },
    { key: 'tenantEmail', label: 'Tenant Email', type: 'email' },
    { key: 'billable', label: 'Billable?', type: 'select', options: ['yes', 'no'], default: 'no' },
    { key: 'priority', label: 'Priority', type: 'select', options: ['low', 'medium', 'high', 'emergency'], default: 'medium' },
    { key: 'assignedTo', label: 'Assigned To', type: 'text' },
    { key: 'scheduledAt', label: 'Scheduled', type: 'datetime' },
    { key: 'completedAt', label: 'Completed', type: 'datetime' },
    { key: 'cost', label: 'Cost', type: 'money' },
    { key: 'status', label: 'Status', type: 'select', options: ['open', 'scheduled', 'in_progress', 'completed', 'cancelled'], default: 'open' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
  detailSections: [
    { title: 'Billing', render: makeQuickInvoiceSection({
      parentType: 'maintenance',
      chargeType: 'maintenance',
      customerFields: { name: 'tenantName', email: 'tenantEmail' },
      buildLineItems: (rec) => {
        if (rec.cost && rec.cost > 0) {
          return [{
            description: rec.issue ? `Maintenance: ${rec.issue}` : 'Maintenance charge',
            quantity: 1,
            rate: rec.cost,
            amount: rec.cost,
          }];
        }
        return [];
      },
    }) },
  ],
};

// ── Shared (any vertical) ─────────────────────────────────

export const schedulingConfig = {
  collection: 'scheduling',
  title: 'Scheduling',
  singular: 'Event',
  showCalendar: true,
  calendarTitle: 'title',
  calendarStart: 'startAt',
  calendarEnd: 'endAt',
  colorField: 'status',
  orderField: 'startAt',
  listColumns: ['title', 'assignedTo', 'startAt', 'status'],
  statuses: ['scheduled', 'confirmed', 'completed', 'cancelled'],
  fields: [
    { key: 'title', label: 'Title', type: 'text', required: true, primary: true },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'assignedTo', label: 'Assigned To', type: 'text' },
    { key: 'location', label: 'Location', type: 'text' },
    { key: 'startAt', label: 'Start', type: 'datetime', required: true },
    { key: 'endAt', label: 'End', type: 'datetime' },
    { key: 'status', label: 'Status', type: 'select', options: ['scheduled', 'confirmed', 'completed', 'cancelled'], default: 'scheduled' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
};

// ── Registry — map view name → config ─────────────────────

export const VIEW_CONFIG = {
  // Salon
  appointments:    appointmentsConfig,
  'service-menu':  servicesMenuConfig,
  'staff-calendar': staffCalendarConfig,
  memberships:     membershipsConfig,
  loyalty:         loyaltyConfig,
  // Trades
  jobs:            jobsConfig,
  dispatching:     dispatchingConfig,
  quoting:         quotingConfig,
  // Manufacturing
  'work-orders':   workOrdersConfig,
  bom:             bomConfig,
  // Services
  projects:        projectsConfig,
  'time-tracking': timeTrackingConfig,
  proposals:       proposalsConfig,
  // Property
  properties:      propertiesConfig,
  units:           unitsConfig,
  leases:          leasesConfig,
  maintenance:     maintenanceConfig,
  // Shared
  scheduling:      schedulingConfig,
};
