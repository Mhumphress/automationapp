import { getPackages, getVerticals, getFeatures, getAddons, setPackage, deletePackage, setVertical, setFeature, setAddon, deleteFeature, deleteAddon } from '../services/catalog.js';
import { createModal } from '../components/modal.js';
import { showToast, escapeHtml, formatCurrency } from '../ui.js';

let packages = [];
let verticals = [];
let features = [];
let addons = [];
let modal = null;
let currentTab = 'packages';

export function init() {
  modal = createModal();
}

export async function render() {
  await loadData();
  renderView();
}

export function destroy() {}

async function loadData() {
  try {
    const results = await Promise.allSettled([
      getPackages(), getVerticals(), getFeatures(), getAddons()
    ]);
    packages = results[0].status === 'fulfilled' ? results[0].value : [];
    verticals = results[1].status === 'fulfilled' ? results[1].value : [];
    features = results[2].status === 'fulfilled' ? results[2].value : [];
    addons = results[3].status === 'fulfilled' ? results[3].value : [];
  } catch (err) {
    console.error('Failed to load catalog data:', err);
  }
}

function renderView() {
  const container = document.getElementById('view-packages');
  container.innerHTML = '';

  // Tabs
  const tabBar = document.createElement('div');
  tabBar.className = 'view-topbar';
  tabBar.innerHTML = `
    <div class="view-toggle">
      <button data-tab="packages" class="${currentTab === 'packages' ? 'active' : ''}">Packages</button>
      <button data-tab="verticals" class="${currentTab === 'verticals' ? 'active' : ''}">Verticals</button>
      <button data-tab="features" class="${currentTab === 'features' ? 'active' : ''}">Features</button>
      <button data-tab="addons" class="${currentTab === 'addons' ? 'active' : ''}">Add-ons</button>
    </div>
  `;
  container.appendChild(tabBar);

  tabBar.querySelectorAll('.view-toggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      currentTab = btn.dataset.tab;
      renderView();
    });
  });

  const content = document.createElement('div');
  content.className = 'view-content';

  if (currentTab === 'packages') renderPackagesTab(content);
  else if (currentTab === 'verticals') renderVerticalsTab(content);
  else if (currentTab === 'features') renderFeaturesTab(content);
  else if (currentTab === 'addons') renderAddonsTab(content);

  container.appendChild(content);
}

// ── Packages Tab ──

function renderPackagesTab(container) {
  verticals.forEach(v => {
    const section = document.createElement('div');
    section.className = 'settings-section';
    section.style.marginBottom = '2rem';

    const vPackages = packages.filter(p => p.vertical === v.id);

    let html = `<h2 class="section-title">${escapeHtml(v.name)}</h2>`;

    if (vPackages.length === 0) {
      html += '<p style="color:var(--gray);padding:0.5rem 0;">No packages for this vertical.</p>';
    } else {
      html += '<div class="package-grid">';
      vPackages.forEach(pkg => {
        const tierColors = { basic: '#60a5fa', pro: '#8b5cf6', enterprise: '#f59e0b' };
        const color = tierColors[pkg.tier] || '#64748b';
        html += `
          <div class="package-card" data-id="${pkg.id}" style="border-top: 3px solid ${color};">
            <div class="package-card-header">
              <div>
                <div style="font-weight:600;font-size:1rem;">${escapeHtml(pkg.name)}</div>
                <div style="font-size:0.8rem;color:var(--gray);text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(pkg.tier)}</div>
              </div>
              <div style="text-align:right;">
                <div style="font-size:1.25rem;font-weight:600;">${formatCurrency(pkg.basePrice)}<span style="font-size:0.75rem;font-weight:400;color:var(--gray);">/mo</span></div>
                <div style="font-size:0.8rem;color:var(--gray);">${formatCurrency(pkg.annualPrice)}/yr</div>
              </div>
            </div>
            <div style="font-size:0.85rem;color:var(--gray-dark);margin:0.75rem 0;">${escapeHtml(pkg.description)}</div>
            <div style="font-size:0.8rem;margin-bottom:0.5rem;">
              <strong>${pkg.userLimit === 0 ? 'Unlimited' : pkg.userLimit}</strong> users
              &middot; <strong>${(pkg.features || []).length}</strong> features
            </div>
            <div class="package-features">
              ${(pkg.features || []).map(f => `<span class="badge badge-status">${escapeHtml(f)}</span>`).join(' ')}
            </div>
            <div style="display:flex;gap:0.5rem;margin-top:0.75rem;">
              <button class="btn btn-ghost btn-sm pkg-edit" data-id="${pkg.id}">Edit</button>
              <span class="badge ${pkg.active ? 'badge-success' : 'badge-warning'}" style="align-self:center;">${pkg.active ? 'Active' : 'Inactive'}</span>
            </div>
          </div>
        `;
      });
      html += '</div>';
    }

    section.innerHTML = html;
    container.appendChild(section);

    // Wire edit buttons
    section.querySelectorAll('.pkg-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const pkg = packages.find(p => p.id === btn.dataset.id);
        if (pkg) openPackageEditor(pkg);
      });
    });
  });
}

function openPackageEditor(pkg) {
  const form = document.createElement('form');
  form.className = 'modal-form';

  const allFeatureSlugs = features.filter(f =>
    f.verticals.includes(pkg.vertical) || f.verticals.includes('all')
  );
  const allAddonSlugs = addons;

  form.innerHTML = `
    <div class="modal-form-grid">
      <div class="modal-field">
        <label>Name</label>
        <input type="text" name="name" value="${escapeHtml(pkg.name)}" required>
      </div>
      <div class="modal-field">
        <label>Tier</label>
        <select name="tier">
          <option value="basic" ${pkg.tier === 'basic' ? 'selected' : ''}>Basic</option>
          <option value="pro" ${pkg.tier === 'pro' ? 'selected' : ''}>Pro</option>
          <option value="enterprise" ${pkg.tier === 'enterprise' ? 'selected' : ''}>Enterprise</option>
        </select>
      </div>
    </div>
    <div class="modal-field">
      <label>Description</label>
      <input type="text" name="description" value="${escapeHtml(pkg.description || '')}">
    </div>
    <div class="modal-form-grid">
      <div class="modal-field">
        <label>Monthly Price ($)</label>
        <input type="number" name="basePrice" value="${pkg.basePrice}" step="1" min="0">
      </div>
      <div class="modal-field">
        <label>Annual Price ($)</label>
        <input type="number" name="annualPrice" value="${pkg.annualPrice}" step="1" min="0">
      </div>
    </div>
    <div class="modal-form-grid">
      <div class="modal-field">
        <label>User Limit (0 = unlimited)</label>
        <input type="number" name="userLimit" value="${pkg.userLimit}" min="0">
      </div>
      <div class="modal-field">
        <label>Sort Order</label>
        <input type="number" name="sortOrder" value="${pkg.sortOrder || 1}" min="1">
      </div>
    </div>
    <div class="modal-field">
      <label>Features</label>
      <div class="checkbox-grid" id="featureChecks">
        ${allFeatureSlugs.map(f => `
          <label class="checkbox-label">
            <input type="checkbox" name="feature" value="${f.id}" ${(pkg.features || []).includes(f.id) ? 'checked' : ''}>
            ${escapeHtml(f.name)}
          </label>
        `).join('')}
      </div>
    </div>
    <div class="modal-field">
      <label>Available Add-ons</label>
      <div class="checkbox-grid" id="addonChecks">
        ${allAddonSlugs.map(a => `
          <label class="checkbox-label">
            <input type="checkbox" name="addon" value="${a.id}" ${(pkg.addOns || []).includes(a.id) ? 'checked' : ''}>
            ${escapeHtml(a.name)}
          </label>
        `).join('')}
      </div>
    </div>
    <div class="modal-field">
      <label>
        <input type="checkbox" name="active" ${pkg.active ? 'checked' : ''}>
        Active (can be assigned to new tenants)
      </label>
    </div>
    <div class="modal-actions">
      <button type="submit" class="btn btn-primary btn-lg">Save Package</button>
      <span class="modal-cancel">Cancel</span>
    </div>
  `;

  modal.open(`Edit: ${pkg.name}`, form);
  form.querySelector('.modal-cancel').addEventListener('click', () => modal.close());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const selectedFeatures = Array.from(form.querySelectorAll('input[name="feature"]:checked')).map(cb => cb.value);
    const selectedAddons = Array.from(form.querySelectorAll('input[name="addon"]:checked')).map(cb => cb.value);

    try {
      await setPackage(pkg.id, {
        name: fd.get('name').trim(),
        vertical: pkg.vertical,
        tier: fd.get('tier'),
        description: fd.get('description').trim(),
        basePrice: parseFloat(fd.get('basePrice')) || 0,
        annualPrice: parseFloat(fd.get('annualPrice')) || 0,
        userLimit: parseInt(fd.get('userLimit')) || 0,
        sortOrder: parseInt(fd.get('sortOrder')) || 1,
        features: selectedFeatures,
        addOns: selectedAddons,
        active: form.querySelector('input[name="active"]').checked
      });
      showToast('Package updated', 'success');
      modal.close();
      await loadData();
      renderView();
    } catch (err) {
      console.error('Save package failed:', err);
      showToast('Failed to save package', 'error');
    }
  });
}

// ── Verticals Tab ──

function renderVerticalsTab(container) {
  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = `
    <thead><tr>
      <th>Name</th>
      <th>Slug</th>
      <th>Modules</th>
      <th>Packages</th>
    </tr></thead>
    <tbody>
      ${verticals.map(v => {
        const pkgCount = packages.filter(p => p.vertical === v.id).length;
        return `<tr>
          <td style="font-weight:500;">${escapeHtml(v.name)}</td>
          <td><code>${escapeHtml(v.id)}</code></td>
          <td>${(v.modules || []).length} modules</td>
          <td>${pkgCount} packages</td>
        </tr>`;
      }).join('')}
    </tbody>
  `;
  container.appendChild(table);
}

// ── Features Tab ──

function renderFeaturesTab(container) {
  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = `
    <thead><tr>
      <th>Name</th>
      <th>Slug</th>
      <th>Module</th>
      <th>Type</th>
      <th>Verticals</th>
    </tr></thead>
    <tbody>
      ${features.map(f => `<tr>
        <td style="font-weight:500;">${escapeHtml(f.name)}</td>
        <td><code>${escapeHtml(f.id)}</code></td>
        <td>${escapeHtml(f.module || '-')}</td>
        <td><span class="badge ${f.gateType === 'module' ? 'badge-info' : 'badge-warning'}">${escapeHtml(f.gateType)}</span></td>
        <td style="font-size:0.8rem;">${(f.verticals || []).join(', ')}</td>
      </tr>`).join('')}
    </tbody>
  `;
  container.appendChild(table);
}

// ── Add-ons Tab ──

function renderAddonsTab(container) {
  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = `
    <thead><tr>
      <th>Name</th>
      <th>Monthly</th>
      <th>Annual</th>
      <th>Model</th>
      <th>Verticals</th>
      <th>Status</th>
    </tr></thead>
    <tbody>
      ${addons.map(a => `<tr>
        <td style="font-weight:500;">${escapeHtml(a.name)}</td>
        <td>${formatCurrency(a.priceMonthly)}</td>
        <td>${formatCurrency(a.priceAnnual)}</td>
        <td>${escapeHtml(a.pricingModel)}</td>
        <td style="font-size:0.8rem;">${(a.applicableVerticals || []).join(', ')}</td>
        <td><span class="badge ${a.active ? 'badge-success' : 'badge-warning'}">${a.active ? 'Active' : 'Inactive'}</span></td>
      </tr>`).join('')}
    </tbody>
  `;
  container.appendChild(table);
}
