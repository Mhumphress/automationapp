// ─────────────────────────────────────────────
//  router.js — Client-side hash-based view router
// ─────────────────────────────────────────────

const views = {};          // { name: { init, render, destroy } }
const initialised = {};    // track which views have had init() called
let currentView = null;

/**
 * Register a view with lifecycle hooks.
 * @param {string} name       — view name (matches #view-{name} container)
 * @param {object} hooks
 * @param {Function} [hooks.init]    — runs once on first visit
 * @param {Function} [hooks.render]  — runs every time the view is shown
 * @param {Function} [hooks.destroy] — runs when leaving the view
 */
export function registerView(name, { init, render, destroy } = {}) {
  views[name] = {
    init: init || null,
    render: render || null,
    destroy: destroy || null
  };
}

/**
 * Navigate to a registered view.
 * @param {string} viewName
 */
export function navigate(viewName) {
  // Validate view exists
  if (!views[viewName]) {
    console.warn(`[router] Unknown view: "${viewName}"`);
    return;
  }

  // Destroy current view
  if (currentView && views[currentView] && views[currentView].destroy) {
    try { views[currentView].destroy(); } catch (e) { console.error('[router] destroy error:', e); }
  }

  // Hide all view containers
  const containers = document.querySelectorAll('.view-container');
  containers.forEach(el => { el.style.display = 'none'; });

  // Show target view container
  const target = document.getElementById(`view-${viewName}`);
  if (target) {
    target.style.display = 'block';
  }

  // Init on first visit
  if (!initialised[viewName] && views[viewName].init) {
    try { views[viewName].init(); } catch (e) { console.error('[router] init error:', e); }
    initialised[viewName] = true;
  }

  // Render
  if (views[viewName].render) {
    try { views[viewName].render(); } catch (e) { console.error('[router] render error:', e); }
  }

  // Update active nav state
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });

  // Update hash (without triggering hashchange again)
  currentView = viewName;
  if (window.location.hash !== `#${viewName}`) {
    window.location.hash = viewName;
  }
}

/**
 * Initialise the router. Reads the hash on load and listens for changes.
 * @param {string} defaultView — view to show if hash is empty or invalid
 */
export function initRouter(defaultView = 'dashboard') {
  const hashView = window.location.hash.replace('#', '');
  const startView = (hashView && views[hashView]) ? hashView : defaultView;

  navigate(startView);

  window.addEventListener('hashchange', () => {
    const next = window.location.hash.replace('#', '');
    if (next && views[next] && next !== currentView) {
      navigate(next);
    }
  });
}
