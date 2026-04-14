/**
 * Centered modal dialog with backdrop blur.
 * Used for create forms (contacts, deals) and settings.
 */
export function createModal() {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog';
  dialog.innerHTML = `
    <div class="modal-header">
      <h2 class="modal-title"></h2>
      <button class="modal-close" title="Close" type="button">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <div class="modal-body"></div>
  `;

  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  const titleEl = dialog.querySelector('.modal-title');
  const bodyEl = dialog.querySelector('.modal-body');
  const closeBtn = dialog.querySelector('.modal-close');
  let onCloseCallback = null;

  function open(title, content) {
    titleEl.textContent = title;
    bodyEl.innerHTML = '';
    if (typeof content === 'string') {
      bodyEl.innerHTML = content;
    } else {
      bodyEl.appendChild(content);
    }
    backdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    backdrop.classList.remove('open');
    document.body.style.overflow = '';
    if (onCloseCallback) onCloseCallback();
  }

  function onClose(cb) { onCloseCallback = cb; }
  function getBody() { return bodyEl; }

  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && backdrop.classList.contains('open')) close();
  });

  return { open, close, onClose, getBody };
}

/**
 * Opens a temporary stacked modal on top of an existing one.
 * Returns a promise that resolves with the created entity (or null if cancelled).
 * Automatically cleans up when closed.
 */
export function openStackedModal(title, buildForm) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop modal-stacked';

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog';
    dialog.innerHTML = `
      <div class="modal-header">
        <h2 class="modal-title">${title}</h2>
        <button class="modal-close" title="Close" type="button">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="modal-body"></div>
    `;

    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    const bodyEl = dialog.querySelector('.modal-body');
    const closeBtn = dialog.querySelector('.modal-close');

    function close(result) {
      backdrop.classList.remove('open');
      setTimeout(() => backdrop.remove(), 300);
      resolve(result || null);
    }

    closeBtn.addEventListener('click', () => close(null));
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(null);
    });

    // Build the form — pass close function so form can resolve with data
    buildForm(bodyEl, close);

    // Open with animation
    requestAnimationFrame(() => backdrop.classList.add('open'));
  });
}
