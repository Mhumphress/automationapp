import { db, auth } from '../config.js';
import { collection, getDocs, doc, updateDoc, query, orderBy } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { isAdmin } from '../services/roles.js';
import { showToast, escapeHtml } from '../ui.js';

const containerId = 'view-settings';
let isAdminUser = false;

export async function init() {}

export async function render() {
  isAdminUser = await isAdmin();
  const container = document.getElementById(containerId);

  if (!isAdminUser) {
    container.innerHTML = '<div class="empty-state"><div class="empty-title">Access Denied</div><p class="empty-description">Only administrators can access settings.</p></div>';
    return;
  }

  container.innerHTML = '<div class="loading">Loading users...</div>';

  try {
    const snap = await getDocs(query(collection(db, 'users'), orderBy('createdAt', 'desc')));
    const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    let html = '<div class="settings-section"><h2 class="section-title">User Management</h2>';
    html += '<table class="data-table"><thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Actions</th></tr></thead><tbody>';

    users.forEach(u => {
      const isSelf = u.id === auth.currentUser.uid;
      html += `<tr data-uid="${u.id}">
        <td>${escapeHtml(u.email || '')}</td>
        <td>${escapeHtml(u.displayName || '')}</td>
        <td>
          <select class="role-select" data-uid="${u.id}" ${isSelf ? 'disabled title="Cannot change your own role"' : ''}>
            <option value="member" ${u.role === 'member' ? 'selected' : ''}>Member</option>
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
          </select>
        </td>
        <td>${isSelf ? '<span class="badge badge-info">You</span>' : ''}</td>
      </tr>`;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;

    // Wire up role change handlers
    container.querySelectorAll('.role-select').forEach(select => {
      select.addEventListener('change', async (e) => {
        const uid = e.target.dataset.uid;
        const newRole = e.target.value;
        try {
          await updateDoc(doc(db, 'users', uid), { role: newRole });
          showToast(`Role updated to ${newRole}`, 'success');
        } catch (err) {
          showToast('Failed to update role', 'error');
          console.error(err);
        }
      });
    });
  } catch (err) {
    container.innerHTML = '<div class="empty-state"><div class="empty-title">Error</div><p class="empty-description">Failed to load users.</p></div>';
    console.error(err);
  }
}

export function destroy() {}
