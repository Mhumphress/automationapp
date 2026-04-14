/**
 * Shared entity creation forms that can be opened from any dropdown.
 * Opens a stacked modal with the full form, pre-filled with the typed name.
 * Returns the created entity { id, label, ... } or null if cancelled.
 */
import { addDocument, queryDocuments } from '../services/firestore.js';
import { openStackedModal } from '../components/modal.js';
import { createDropdown } from '../components/dropdown.js';
import { showToast } from '../ui.js';

/**
 * Open a full "Create Contact" form in a stacked modal.
 * @param {string} prefillName - name typed in the dropdown, split into first/last
 * @returns {Promise<{id, label, firstName, lastName, companyId, companyName}|null>}
 */
export async function createContactFromDropdown(prefillName) {
  const parts = (prefillName || '').trim().split(/\s+/);
  const prefillFirst = parts[0] || '';
  const prefillLast = parts.slice(1).join(' ') || '';

  // Load companies for the dropdown
  let companies = [];
  try { companies = await queryDocuments('companies', 'name', 'asc'); } catch (e) { console.error(e); }

  return openStackedModal('New Contact', (bodyEl, close) => {
    const form = document.createElement('div');
    form.innerHTML = `
      <form class="modal-form" id="stackedContactForm">
        <div class="modal-form-grid">
          <div class="modal-field">
            <label>First Name *</label>
            <input type="text" name="firstName" required placeholder="First name" value="${escAttr(prefillFirst)}">
          </div>
          <div class="modal-field">
            <label>Last Name *</label>
            <input type="text" name="lastName" required placeholder="Last name" value="${escAttr(prefillLast)}">
          </div>
        </div>
        <div class="modal-form-grid">
          <div class="modal-field">
            <label>Email</label>
            <input type="email" name="email" placeholder="email@example.com">
          </div>
          <div class="modal-field">
            <label>Phone</label>
            <input type="tel" name="phone" placeholder="Phone number">
          </div>
        </div>
        <div class="modal-field">
          <label>Job Title</label>
          <input type="text" name="jobTitle" placeholder="Job title">
        </div>
        <div class="modal-field">
          <label>Company</label>
          <div id="stackedCompanySlot"></div>
        </div>
        <div class="modal-actions">
          <button type="submit" class="btn btn-primary btn-lg">Create Contact</button>
          <span class="modal-cancel" id="stackedContactCancel">Cancel</span>
        </div>
      </form>
    `;

    bodyEl.appendChild(form);

    // Company dropdown inside the stacked modal
    let selectedCompany = null;
    const companyDropdown = createDropdown({
      fetchItems: async () => companies.map(c => ({ id: c.id, label: c.name })),
      onSelect: (item) => { selectedCompany = item; },
      onCreate: async (name) => {
        // Create bare company from nested dropdown (one level deep is enough)
        const ref = await addDocument('companies', { name });
        selectedCompany = { id: ref.id, label: name };
        companyDropdown.setSelected(selectedCompany);
        showToast(`Company "${name}" created`, 'success');
      },
      placeholder: 'Search or create company...'
    });
    form.querySelector('#stackedCompanySlot').appendChild(companyDropdown);

    form.querySelector('#stackedContactCancel').addEventListener('click', () => close(null));

    form.querySelector('#stackedContactForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const data = {
        firstName: fd.get('firstName').trim(),
        lastName: fd.get('lastName').trim(),
        email: fd.get('email').trim(),
        phone: fd.get('phone').trim(),
        jobTitle: fd.get('jobTitle').trim(),
        companyId: selectedCompany ? selectedCompany.id : '',
        companyName: selectedCompany ? selectedCompany.label : '',
        notes: ''
      };

      try {
        const ref = await addDocument('contacts', data);
        showToast('Contact created', 'success');
        close({
          id: ref.id,
          label: `${data.firstName} ${data.lastName}`,
          firstName: data.firstName,
          lastName: data.lastName,
          companyId: data.companyId,
          companyName: data.companyName
        });
      } catch (err) {
        console.error('Create contact failed:', err);
        showToast('Failed to create contact', 'error');
      }
    });
  });
}

/**
 * Open a full "Create Company" form in a stacked modal.
 * @param {string} prefillName - company name typed in the dropdown
 * @returns {Promise<{id, label}|null>}
 */
export async function createCompanyFromDropdown(prefillName) {
  return openStackedModal('New Company', (bodyEl, close) => {
    const form = document.createElement('div');
    form.innerHTML = `
      <form class="modal-form" id="stackedCompanyForm">
        <div class="modal-field">
          <label>Company Name *</label>
          <input type="text" name="name" required placeholder="Company name" value="${escAttr(prefillName || '')}">
        </div>
        <div class="modal-form-grid">
          <div class="modal-field">
            <label>Phone</label>
            <input type="tel" name="phone" placeholder="Company phone">
          </div>
          <div class="modal-field">
            <label>Email</label>
            <input type="email" name="email" placeholder="info@company.com">
          </div>
        </div>
        <div class="modal-field">
          <label>Website</label>
          <input type="text" name="website" placeholder="https://...">
        </div>
        <div class="modal-form-grid">
          <div class="modal-field">
            <label>Industry</label>
            <input type="text" name="industry" placeholder="Industry">
          </div>
          <div class="modal-field">
            <label>Address</label>
            <input type="text" name="address" placeholder="Street, City, State, ZIP">
          </div>
        </div>
        <div class="modal-actions">
          <button type="submit" class="btn btn-primary btn-lg">Create Company</button>
          <span class="modal-cancel" id="stackedCompanyCancel">Cancel</span>
        </div>
      </form>
    `;

    bodyEl.appendChild(form);

    form.querySelector('#stackedCompanyCancel').addEventListener('click', () => close(null));

    form.querySelector('#stackedCompanyForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const addrStr = fd.get('address').trim();
      const addrParts = addrStr.split(',').map(s => s.trim());

      const data = {
        name: fd.get('name').trim(),
        phone: fd.get('phone').trim(),
        email: fd.get('email').trim(),
        website: fd.get('website').trim(),
        industry: fd.get('industry').trim(),
        address: addrStr ? {
          street: addrParts[0] || '',
          city: addrParts[1] || '',
          state: addrParts[2] || '',
          zip: addrParts[3] || '',
          country: addrParts[4] || ''
        } : {},
        notes: ''
      };

      try {
        const ref = await addDocument('companies', data);
        showToast(`Company "${data.name}" created`, 'success');
        close({ id: ref.id, label: data.name });
      } catch (err) {
        console.error('Create company failed:', err);
        showToast('Failed to create company', 'error');
      }
    });
  });
}

function escAttr(str) {
  return (str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
