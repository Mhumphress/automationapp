/**
 * Make a .panel-field-value element inline-editable.
 *
 * @param {HTMLElement} el - the .panel-field-value element
 * @param {object} opts
 * @param {string} opts.field - field name (for activity log)
 * @param {string} opts.type - "text", "email", "tel", "textarea", "date", "number"
 * @param {string} opts.value - current value
 * @param {function} opts.onSave - async (newValue, oldValue) => void — called on save
 */
export function makeEditable(el, { field, type = 'text', value = '', onSave }) {
  if (el.dataset.editBound) return;
  el.dataset.editBound = 'true';

  // Display the current value
  setDisplay(el, value, type);

  el.addEventListener('click', () => {
    if (el.classList.contains('editing')) return;
    startEdit(el, { field, type, value: el.dataset.currentValue || value, onSave });
  });
}

function setDisplay(el, value, type) {
  el.dataset.currentValue = value || '';
  if (!value && value !== 0) {
    el.textContent = 'Click to add...';
    el.classList.add('empty');
  } else {
    if (type === 'number') {
      el.textContent = formatNumber(value);
    } else if (type === 'date') {
      el.textContent = formatDateDisplay(value);
    } else {
      el.textContent = value;
    }
    el.classList.remove('empty');
  }
}

function startEdit(el, { field, type, value, onSave }) {
  const oldValue = value;
  el.classList.add('editing');
  el.innerHTML = '';

  let input;
  if (type === 'textarea') {
    input = document.createElement('textarea');
    input.rows = 3;
  } else {
    input = document.createElement('input');
    input.type = type === 'date' ? 'date' : type === 'number' ? 'number' : type;
    if (type === 'number') input.step = '0.01';
  }

  if (type === 'date' && value) {
    // Convert to YYYY-MM-DD for date input
    try {
      const d = value.toDate ? value.toDate() : new Date(value);
      input.value = d.toISOString().split('T')[0];
    } catch {
      input.value = '';
    }
  } else {
    input.value = value || '';
  }

  el.appendChild(input);
  input.focus();
  input.select();

  async function save() {
    const newValue = type === 'number' ? parseFloat(input.value) || 0 : input.value.trim();
    el.classList.remove('editing');
    el.innerHTML = '';

    if (String(newValue) !== String(oldValue)) {
      try {
        await onSave(newValue, oldValue);
        el.dataset.currentValue = newValue;
        setDisplay(el, newValue, type);
        el.classList.add('flash-success');
        setTimeout(() => el.classList.remove('flash-success'), 600);
      } catch (err) {
        console.error('Inline edit save failed:', err);
        setDisplay(el, oldValue, type);
        el.classList.add('flash-error');
        setTimeout(() => el.classList.remove('flash-error'), 600);
      }
    } else {
      setDisplay(el, oldValue, type);
    }
  }

  function cancel() {
    el.classList.remove('editing');
    el.innerHTML = '';
    setDisplay(el, oldValue, type);
  }

  input.addEventListener('blur', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && type !== 'textarea') {
      e.preventDefault();
      input.removeEventListener('blur', save);
      save();
    }
    if (e.key === 'Escape') {
      input.removeEventListener('blur', save);
      cancel();
    }
  });
}

function formatNumber(val) {
  const num = parseFloat(val);
  if (isNaN(num)) return val;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
}

function formatDateDisplay(val) {
  if (!val) return '';
  try {
    const d = val.toDate ? val.toDate() : new Date(val);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}
