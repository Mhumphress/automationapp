/**
 * Create a searchable dropdown for picking from a list.
 *
 * @param {object} opts
 * @param {function} opts.fetchItems - async () => [{ id, label, sublabel? }]
 * @param {function} opts.onSelect - (item) => void
 * @param {function} opts.onCreate - (searchText) => void — called when "Create new" is clicked
 * @param {string} opts.placeholder - input placeholder text
 * @returns {HTMLElement} the dropdown container element
 */
export function createDropdown({ fetchItems, onSelect, onCreate, placeholder = 'Search...' }) {
  const container = document.createElement('div');
  container.className = 'dropdown-search';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'dropdown-input';
  input.placeholder = placeholder;

  const list = document.createElement('div');
  list.className = 'dropdown-list';
  list.style.display = 'none';

  container.appendChild(input);
  container.appendChild(list);

  let items = [];
  let isOpen = false;

  async function loadItems() {
    items = await fetchItems();
    renderList('');
  }

  function renderList(filter) {
    const lower = filter.toLowerCase();
    const filtered = items.filter(item =>
      item.label.toLowerCase().includes(lower) ||
      (item.sublabel && item.sublabel.toLowerCase().includes(lower))
    );

    list.innerHTML = '';

    filtered.forEach(item => {
      const row = document.createElement('div');
      row.className = 'dropdown-item';
      row.innerHTML = `
        <div class="dropdown-item-label">${escapeHtml(item.label)}</div>
        ${item.sublabel ? `<div class="dropdown-item-sub">${escapeHtml(item.sublabel)}</div>` : ''}
      `;
      row.addEventListener('click', () => {
        onSelect(item);
        close();
      });
      list.appendChild(row);
    });

    if (onCreate && filter.trim()) {
      const createRow = document.createElement('div');
      createRow.className = 'dropdown-item dropdown-create';
      createRow.innerHTML = `<div class="dropdown-item-label">+ Create "${escapeHtml(filter.trim())}"</div>`;
      createRow.addEventListener('click', () => {
        onCreate(filter.trim());
        close();
      });
      list.appendChild(createRow);
    }

    if (filtered.length === 0 && !filter.trim()) {
      const empty = document.createElement('div');
      empty.className = 'dropdown-empty';
      empty.textContent = 'No items found';
      list.appendChild(empty);
    }
  }

  function open() {
    list.style.display = 'block';
    isOpen = true;
    loadItems();
  }

  function close() {
    list.style.display = 'none';
    isOpen = false;
    input.value = '';
  }

  input.addEventListener('focus', open);
  input.addEventListener('input', () => renderList(input.value));

  // Close on click outside
  document.addEventListener('click', (e) => {
    if (isOpen && !container.contains(e.target)) {
      close();
    }
  });

  return container;
}

function escapeHtml(str) {
  if (!str) return '';
  const node = document.createElement('span');
  node.appendChild(document.createTextNode(str));
  return node.innerHTML;
}
