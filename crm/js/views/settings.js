import { db, auth } from '../config.js';
import { collection, getDocs, doc, updateDoc, query, orderBy, limit as fbLimit } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
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
      // Query each parent collection's activity subcollection individually
      // to avoid needing collectionGroup rules/indexes
      const parentCollections = ['contacts', 'deals', 'tasks', 'invoices', 'subscriptions'];
      const allActivities = [];

      const parentSnaps = await Promise.all(
        parentCollections.map(col => getDocs(collection(db, col)))
      );

      const activityQueries = [];
      parentSnaps.forEach((snap, i) => {
        const colName = parentCollections[i];
        snap.docs.forEach(parentDoc => {
          activityQueries.push(
            getDocs(query(
              collection(db, colName, parentDoc.id, 'activity'),
              orderBy('createdAt', 'desc'),
              fbLimit(10)
            )).then(actSnap => {
              actSnap.docs.forEach(d => {
                allActivities.push({
                  ...d.data(),
                  _entityType: colName,
                  _entityId: parentDoc.id
                });
              });
            }).catch(() => {})
          );
        });
      });

      await Promise.all(activityQueries);

      // Sort by createdAt desc and take top 50
      allActivities.sort((a, b) => {
        const ta = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(0);
        const tb = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(0);
        return tb - ta;
      });
      const recent = allActivities.slice(0, 50);

      if (recent.length === 0) {
        auditSection.innerHTML = '<h2 class="section-title">Audit Log</h2><p style="color:var(--gray-dark);padding:1rem;">No activity recorded yet.</p>';
      } else {
        let auditHtml = '<h2 class="section-title">Audit Log</h2>';
        auditHtml += '<table class="data-table"><thead><tr><th>Time</th><th>User</th><th>Entity</th><th>Action</th></tr></thead><tbody>';

        recent.forEach(act => {
          const time = act.createdAt?.toDate ? act.createdAt.toDate().toLocaleString() : '\u2014';
          const user = act.createdByEmail || '\u2014';
          const entity = act._entityType.charAt(0).toUpperCase() + act._entityType.slice(1);
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
      auditSection.innerHTML = `<h2 class="section-title">Audit Log</h2>
        <p style="color:var(--gray-dark);padding:1rem;">Unable to load audit log.</p>`;
    }
  } catch (err) {
    container.innerHTML = '<div class="empty-state"><div class="empty-title">Error</div><p class="empty-description">Failed to load users.</p></div>';
    console.error(err);
  }
}

export function destroy() {}
