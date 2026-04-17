import { db, auth } from '../config.js';
import { collection, getDocs, doc, updateDoc, query, limit as fbLimit } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { isAdmin } from '../services/roles.js';
import { showToast, escapeHtml } from '../ui.js';
import { loadBranding, saveBranding, applyBranding, resolveColors, THEMES } from '../services/branding.js';

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
    const snap = await getDocs(collection(db, 'users'));
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
            }).catch(err => console.warn('Activity query skipped:', err.code || err.message))
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

    // ── Branding Section ──
    const brandingSection = document.createElement('div');
    brandingSection.className = 'settings-section';
    brandingSection.style.marginTop = '2rem';
    const current = await loadBranding();
    const initialTheme = current.theme || (current.primaryColor || current.sidebarBg || current.accent ? 'custom' : 'classic_dark');
    const initialColors = resolveColors(current);

    const themeOptions = Object.entries(THEMES).map(([key, t]) =>
      `<option value="${key}" ${initialTheme === key ? 'selected' : ''}>${escapeHtml(t.label)}</option>`
    ).join('') + `<option value="custom" ${initialTheme === 'custom' ? 'selected' : ''}>Custom…</option>`;

    brandingSection.innerHTML = `
      <h2 class="section-title">Branding</h2>
      <p style="color:var(--gray-dark);font-size:0.85rem;margin-bottom:0.75rem;">Pick a preset theme, or choose Custom to set each color individually.</p>
      <div class="modal-field">
        <label>Theme</label>
        <select id="crmThemeSelect">${themeOptions}</select>
      </div>
      <div id="crmCustomColors" class="modal-form-grid" style="display:${initialTheme === 'custom' ? 'grid' : 'none'};">
        <div class="modal-field">
          <label>Sidebar Background</label>
          <input type="color" id="crmSidebarBg" value="${escapeHtml(initialColors.sidebarBg || '#0B0F1A')}" style="width:100%;height:42px;padding:0.15rem;cursor:pointer;">
        </div>
        <div class="modal-field">
          <label>Sidebar Text</label>
          <input type="color" id="crmSidebarFg" value="${escapeHtml(initialColors.sidebarFg || '#CBD5E1')}" style="width:100%;height:42px;padding:0.15rem;cursor:pointer;">
        </div>
        <div class="modal-field">
          <label>Accent (buttons)</label>
          <input type="color" id="crmAccent" value="${escapeHtml(initialColors.accent || '#4F7BF7')}" style="width:100%;height:42px;padding:0.15rem;cursor:pointer;">
        </div>
      </div>
      <div class="modal-field" style="margin-top:0.75rem;">
        <label>Logo URL</label>
        <input type="url" id="crmBrandLogo" value="${escapeHtml(current.logoUrl || '')}" placeholder="https://example.com/logo.png">
      </div>
      <div style="display:flex;gap:0.5rem;align-items:center;margin-top:0.75rem;">
        <button class="btn btn-primary btn-sm" id="crmBrandSave">Save Branding</button>
        <button class="btn btn-ghost btn-sm" id="crmBrandReset">Reset to default</button>
      </div>
    `;
    container.appendChild(brandingSection);

    const themeSel = brandingSection.querySelector('#crmThemeSelect');
    const customWrap = brandingSection.querySelector('#crmCustomColors');
    const bgEl = brandingSection.querySelector('#crmSidebarBg');
    const fgEl = brandingSection.querySelector('#crmSidebarFg');
    const accEl = brandingSection.querySelector('#crmAccent');
    const logoEl = brandingSection.querySelector('#crmBrandLogo');

    function currentBrandingObj() {
      const theme = themeSel.value;
      if (theme !== 'custom') return { theme, logoUrl: logoEl.value.trim() };
      return {
        theme: 'custom',
        sidebarBg: bgEl.value,
        sidebarFg: fgEl.value,
        accent: accEl.value,
        logoUrl: logoEl.value.trim(),
      };
    }

    function livePreview() { applyBranding(currentBrandingObj()); }

    themeSel.addEventListener('change', () => {
      customWrap.style.display = themeSel.value === 'custom' ? 'grid' : 'none';
      if (themeSel.value !== 'custom' && THEMES[themeSel.value]) {
        bgEl.value = THEMES[themeSel.value].sidebarBg;
        fgEl.value = THEMES[themeSel.value].sidebarFg;
        accEl.value = THEMES[themeSel.value].accent;
      }
      livePreview();
    });
    bgEl.addEventListener('input', livePreview);
    fgEl.addEventListener('input', livePreview);
    accEl.addEventListener('input', livePreview);
    logoEl.addEventListener('change', livePreview);

    brandingSection.querySelector('#crmBrandSave').addEventListener('click', async () => {
      try {
        const data = currentBrandingObj();
        await saveBranding(data);
        applyBranding(data);
        showToast('Branding saved', 'success');
      } catch (err) {
        showToast('Save failed: ' + err.message, 'error');
      }
    });
    brandingSection.querySelector('#crmBrandReset').addEventListener('click', async () => {
      try {
        await saveBranding({ theme: 'classic_dark', sidebarBg: '', sidebarFg: '', accent: '', logoUrl: '', primaryColor: '' });
        themeSel.value = 'classic_dark';
        customWrap.style.display = 'none';
        const t = THEMES.classic_dark;
        bgEl.value = t.sidebarBg; fgEl.value = t.sidebarFg; accEl.value = t.accent;
        logoEl.value = '';
        applyBranding({ theme: 'classic_dark' });
        showToast('Branding reset', 'success');
      } catch (err) {
        showToast('Reset failed: ' + err.message, 'error');
      }
    });

  } catch (err) {
    container.innerHTML = '<div class="empty-state"><div class="empty-title">Error</div><p class="empty-description">Failed to load users.</p></div>';
    console.error(err);
  }
}

export function destroy() {}
