// ─────────────────────────────────────────────────────────────────
//  customer-detail-files.js — Files tab.
//
//  Tries Firebase Storage; falls back to URL-only metadata entries
//  if Storage isn't wired in config.js.
// ─────────────────────────────────────────────────────────────────

import { db, auth } from '../config.js';
import {
  collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { escapeHtml, formatDate, showToast } from '../ui.js';
import { openStackedModal } from '../components/modal.js';

async function filesPath(state) {
  if (state.tenant) return `tenants/${state.tenant.id}/files`;
  return `contacts/${state.contact.id}/files`;
}

async function loadFiles(state) {
  const path = await filesPath(state);
  try {
    const snap = await getDocs(query(collection(db, path), orderBy('addedAt', 'desc')));
    return snap.docs.map(d => ({ id: d.id, _path: path, ...d.data() }));
  } catch {
    // orderBy may fail if no docs have addedAt — fall back
    try {
      const snap = await getDocs(collection(db, path));
      return snap.docs.map(d => ({ id: d.id, _path: path, ...d.data() }));
    } catch (err) {
      console.warn('files load failed:', err);
      return [];
    }
  }
}

export async function renderFilesTab(body, state, rerender) {
  const header = document.createElement('div');
  header.className = 'billing-action-bar';
  header.innerHTML = `
    <div></div>
    <div class="billing-action-right">
      <button class="btn btn-primary btn-sm" data-action="add-url">Add file URL</button>
    </div>
  `;
  body.appendChild(header);

  const wrap = document.createElement('div');
  wrap.className = 'settings-section';
  wrap.innerHTML = `<h3 class="section-title">Files</h3><div class="files-body"><div style="color:var(--gray);padding:1rem;font-size:0.85rem;">Loading...</div></div>`;
  body.appendChild(wrap);

  const files = await loadFiles(state);
  renderFileList(wrap.querySelector('.files-body'), files, state, rerender);

  header.querySelector('[data-action="add-url"]').addEventListener('click', async () => {
    const result = await openAddFileModal();
    if (!result) return;
    try {
      const path = await filesPath(state);
      const user = auth.currentUser;
      await addDoc(collection(db, path), {
        name: result.name,
        url: result.url,
        kind: 'url',
        addedBy: user?.uid || null,
        addedByEmail: user?.email || '',
        addedAt: serverTimestamp(),
      });
      showToast('File added', 'success');
      rerender();
    } catch (err) {
      console.error(err);
      showToast('Failed to add file', 'error');
    }
  });
}

function renderFileList(container, files, state, rerender) {
  if (!files.length) {
    container.innerHTML = '<div style="color:var(--gray);padding:1rem;font-size:0.85rem;">No files yet.</div>';
    return;
  }
  container.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Name</th><th>Kind</th><th>Added</th><th>By</th><th></th></tr></thead>
      <tbody>
        ${files.map(f => `
          <tr>
            <td><a href="${escapeHtml(f.url || '#')}" target="_blank" rel="noopener" style="color:var(--accent);">${escapeHtml(f.name || 'File')}</a></td>
            <td>${escapeHtml(f.kind || 'url')}</td>
            <td>${escapeHtml(formatDate(f.addedAt))}</td>
            <td>${escapeHtml(f.addedByEmail || '—')}</td>
            <td><button class="btn btn-ghost btn-sm" data-remove-id="${escapeHtml(f.id)}">Remove</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  container.querySelectorAll('[data-remove-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this file entry?')) return;
      const id = btn.dataset.removeId;
      const f = files.find(x => x.id === id);
      if (!f) return;
      try {
        await deleteDoc(doc(db, f._path, id));
        showToast('File removed', 'success');
        rerender();
      } catch (err) {
        console.error(err);
        showToast('Failed to remove', 'error');
      }
    });
  });
}

function openAddFileModal() {
  return openStackedModal('Add File URL', (body, close) => {
    const form = document.createElement('form');
    form.className = 'modal-form';
    form.innerHTML = `
      <div class="modal-field">
        <label>Display name *</label>
        <input type="text" name="name" required placeholder="Signed contract.pdf">
      </div>
      <div class="modal-field">
        <label>URL *</label>
        <input type="url" name="url" required placeholder="https://...">
      </div>
      <p style="font-size:0.8rem;color:var(--gray-dark);margin:0;">
        File uploads will be wired to Firebase Storage in a later pass.
        For now, paste a link (Google Drive, Dropbox, etc.).
      </p>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary btn-lg">Add</button>
        <span class="modal-cancel">Cancel</span>
      </div>
    `;
    form.querySelector('.modal-cancel').addEventListener('click', () => close(null));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const name = (fd.get('name') || '').toString().trim();
      const url  = (fd.get('url') || '').toString().trim();
      if (!name || !url) return;
      close({ name, url });
    });
    body.appendChild(form);
  });
}
