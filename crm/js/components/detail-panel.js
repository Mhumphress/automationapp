/**
 * Creates and manages a slide-in detail panel on the right side of .app-main.
 *
 * Usage:
 *   const panel = createDetailPanel();
 *   panel.open('Contact Details', htmlContent);
 *   panel.close();
 *   panel.onClose(() => { ... });
 */
export function createDetailPanel() {
  // Create DOM structure once
  const overlay = document.createElement('div');
  overlay.className = 'panel-overlay';

  const panel = document.createElement('div');
  panel.className = 'detail-panel';
  panel.innerHTML = `
    <div class="panel-header">
      <h2 class="panel-title"></h2>
      <button class="panel-close" title="Close">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <div class="panel-body"></div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(panel);

  const titleEl = panel.querySelector('.panel-title');
  const bodyEl = panel.querySelector('.panel-body');
  const closeBtn = panel.querySelector('.panel-close');
  let closeCallback = null;

  function open(title, contentHtml) {
    titleEl.textContent = title;
    if (typeof contentHtml === 'string') {
      bodyEl.innerHTML = contentHtml;
    } else {
      bodyEl.innerHTML = '';
      bodyEl.appendChild(contentHtml);
    }
    panel.classList.add('open');
    overlay.classList.add('open');
  }

  function close() {
    panel.classList.remove('open');
    overlay.classList.remove('open');
    if (closeCallback) closeCallback();
  }

  function setBody(contentHtml) {
    if (typeof contentHtml === 'string') {
      bodyEl.innerHTML = contentHtml;
    } else {
      bodyEl.innerHTML = '';
      bodyEl.appendChild(contentHtml);
    }
  }

  function onClose(cb) {
    closeCallback = cb;
  }

  function getBodyEl() {
    return bodyEl;
  }

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', close);

  return { open, close, setBody, onClose, getBodyEl };
}
