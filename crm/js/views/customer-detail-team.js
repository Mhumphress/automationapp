// ─────────────────────────────────────────────────────────────────
//  customer-detail-team.js — Team & Portal Access tab.
// ─────────────────────────────────────────────────────────────────

import { escapeHtml, formatDate, showToast } from '../ui.js';
import { openStackedModal } from '../components/modal.js';
import { addTenantUser, getTenantUsers } from '../services/tenants.js';
import { db } from '../config.js';
import { doc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

export function renderTeamTab(body, state, rerender) {
  if (!state.tenant) {
    body.innerHTML = `
      <div class="empty-state">
        <div class="empty-title">No portal account</div>
        <p class="empty-description">This customer has no linked tenant. Send them a quote to provision one.</p>
      </div>
    `;
    return;
  }

  // Portal URL copy
  const portalUrl = `${location.origin}/portal/`;
  const urlBar = document.createElement('div');
  urlBar.className = 'settings-section';
  urlBar.innerHTML = `
    <h3 class="section-title">Portal URL</h3>
    <div style="display:flex;gap:0.5rem;align-items:center;">
      <code style="flex:1;background:var(--off-white);padding:0.5rem;border-radius:6px;">${escapeHtml(portalUrl)}</code>
      <button class="btn btn-ghost btn-sm" data-action="copy-url">Copy</button>
    </div>
  `;
  urlBar.querySelector('[data-action="copy-url"]').addEventListener('click', () => {
    navigator.clipboard.writeText(portalUrl).then(() => showToast('Copied', 'success'));
  });
  body.appendChild(urlBar);

  // Users table
  const usersWrap = document.createElement('div');
  usersWrap.className = 'settings-section';
  usersWrap.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
      <h3 class="section-title" style="margin:0;">Users (${state.users.length})</h3>
      <button class="btn btn-primary btn-sm" data-action="invite">+ Invite User</button>
    </div>
  `;
  body.appendChild(usersWrap);

  if (!state.users.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:1rem;color:var(--gray);font-size:0.85rem;';
    empty.textContent = 'No users yet. Invite someone to give them portal access.';
    usersWrap.appendChild(empty);
  } else {
    const table = document.createElement('table');
    table.className = 'data-table';
    table.innerHTML = `
      <thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Status</th><th>Added</th></tr></thead>
      <tbody>
        ${state.users.map(u => `
          <tr>
            <td>${escapeHtml(u.email || '—')}</td>
            <td>${escapeHtml(u.displayName || '—')}</td>
            <td>${escapeHtml(u.role || '—')}</td>
            <td><span class="badge ${u.status === 'active' ? 'badge-success' : 'badge-default'}">${escapeHtml(u.status || 'pending')}</span></td>
            <td>${escapeHtml(formatDate(u.createdAt))}</td>
          </tr>
        `).join('')}
      </tbody>
    `;
    usersWrap.appendChild(table);
  }

  usersWrap.querySelector('[data-action="invite"]').addEventListener('click', async () => {
    const invite = await openInviteModal();
    if (!invite) return;
    try {
      const placeholderId = `pending_${Date.now()}`;
      await addTenantUser(state.tenant.id, placeholderId, {
        email: invite.email,
        displayName: invite.displayName || '',
        role: invite.role || 'user',
        status: 'pending',
        invitedBy: 'crm',
      });
      // Write user_tenants mapping so they resolve on first login
      const emailKey = invite.email.toLowerCase().trim();
      await setDoc(doc(db, 'user_tenants', emailKey), {
        tenantId: state.tenant.id,
        email: invite.email,
        role: invite.role || 'user',
        companyName: state.tenant.companyName || '',
        createdAt: serverTimestamp(),
      });
      showToast('Invite recorded — share the portal URL', 'success');
      state.users = await getTenantUsers(state.tenant.id);
      rerender();
    } catch (err) {
      console.error(err);
      showToast('Failed to invite user', 'error');
    }
  });
}

function openInviteModal() {
  return openStackedModal('Invite User', (body, close) => {
    const form = document.createElement('form');
    form.className = 'modal-form';
    form.innerHTML = `
      <div class="modal-field">
        <label>Email *</label>
        <input type="email" name="email" required>
      </div>
      <div class="modal-form-grid">
        <div class="modal-field">
          <label>Name</label>
          <input type="text" name="displayName">
        </div>
        <div class="modal-field">
          <label>Role</label>
          <select name="role">
            <option value="user">User</option>
            <option value="admin">Admin</option>
            <option value="owner">Owner</option>
            <option value="viewer">Viewer</option>
          </select>
        </div>
      </div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary btn-lg">Invite</button>
        <span class="modal-cancel">Cancel</span>
      </div>
    `;
    form.querySelector('.modal-cancel').addEventListener('click', () => close(null));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      close({
        email: (fd.get('email') || '').toString().trim(),
        displayName: (fd.get('displayName') || '').toString().trim(),
        role: (fd.get('role') || 'user').toString(),
      });
    });
    body.appendChild(form);
  });
}
