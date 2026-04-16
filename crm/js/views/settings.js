import { db, auth } from '../config.js';
import { collection, collectionGroup, getDocs, doc, updateDoc, query, orderBy, limit as fbLimit } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
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

    // ── Audit Log Section ──
    const auditSection = document.createElement('div');
    auditSection.className = 'settings-section';
    auditSection.style.marginTop = '2rem';
    auditSection.innerHTML = '<h2 class="section-title">Audit Log</h2><div class="loading">Loading recent activity...</div>';
    container.appendChild(auditSection);

    try {
      const actSnap = await getDocs(
        query(collectionGroup(db, 'activity'), orderBy('createdAt', 'desc'), fbLimit(50))
      );

      if (actSnap.empty) {
        auditSection.innerHTML = '<h2 class="section-title">Audit Log</h2><p style="color:var(--gray-dark);padding:1rem;">No activity recorded yet.</p>';
      } else {
        let auditHtml = '<h2 class="section-title">Audit Log</h2>';
        auditHtml += '<table class="data-table"><thead><tr><th>Time</th><th>User</th><th>Entity</th><th>Action</th></tr></thead><tbody>';

        actSnap.docs.forEach(d => {
          const act = d.data();
          const parentRef = d.ref.parent.parent;
          const entityType = parentRef?.parent?.id || 'unknown';
          const entityId = parentRef?.id || '';
          const time = act.createdAt?.toDate ? act.createdAt.toDate().toLocaleString() : '\u2014';
          const user = act.createdByEmail || '\u2014';
          const entity = entityType.charAt(0).toUpperCase() + entityType.slice(1);
          const action = act.description || act.type || '\u2014';

          auditHtml += `<tr>
            <td style="white-space:nowrap;font-size:0.8rem;">${escapeHtml(time)}</td>
            <td>${escapeHtml(user)}</td>
            <td><span class="badge badge-status">${escapeHtml(entity)}</span></td>
            <td>${escapeHtml(action)}</td>
          </tr>`;
        });

        auditHtml += '</tbody></table>';
        auditSection.innerHTML = auditHtml;
      }
    } catch (err) {
      console.error('Audit log error:', err);
      const indexMatch = err.message && err.message.match(/(https:\/\/console\.firebase\.google\.com\S+)/);
      if (indexMatch) {
        auditSection.innerHTML = `<h2 class="section-title">Audit Log</h2>
          <div style="padding:1rem;">
            <p style="color:var(--gray-dark);margin-bottom:0.75rem;">A Firestore index is required for the audit log.</p>
            <a href="${escapeHtml(indexMatch[1])}" target="_blank" rel="noopener" class="btn btn-primary">Create Index in Firebase Console</a>
            <p style="color:var(--gray);font-size:0.8rem;margin-top:0.75rem;">After creating the index, wait a few minutes for it to build, then reload this page.</p>
          </div>`;
      } else {
        auditSection.innerHTML = '<h2 class="section-title">Audit Log</h2><p style="color:var(--gray-dark);padding:1rem;">Unable to load audit log. Check the browser console for details.</p>';
      }
    }
  } catch (err) {
    container.innerHTML = '<div class="empty-state"><div class="empty-title">Error</div><p class="empty-description">Failed to load users.</p></div>';
    console.error(err);
  }
}

export function destroy() {}
