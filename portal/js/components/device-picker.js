// Cascading device picker — Manufacturer → Product Line → Model.
// Each level supports "Other" which reveals a free-text input.
// Final value is a single composed string (e.g., "Apple iPhone 17 Pro Max").

import { DEVICE_CATALOG, getManufacturers, getProductLines, getModels } from '../data/device-catalog.js';

const OTHER = '__OTHER__';

function escapeHtml(str) {
  if (str == null) return '';
  const node = document.createElement('span');
  node.appendChild(document.createTextNode(String(str)));
  return node.innerHTML;
}

// Attempt to parse an existing deviceType string into {manufacturer, line, model}.
// Returns null if the string doesn't match any catalog entry — in which case the picker
// falls back to "Other" at the manufacturer level with the raw string as the free-text value.
function parseDeviceString(s) {
  if (!s) return null;
  const str = String(s).trim();
  if (!str) return null;

  for (const mfr of getManufacturers()) {
    if (!str.toLowerCase().startsWith(mfr.toLowerCase())) continue;
    const rest = str.slice(mfr.length).trim();
    for (const line of getProductLines(mfr)) {
      const models = getModels(mfr, line);
      const directMatch = models.find(m => m === rest);
      if (directMatch) return { manufacturer: mfr, line, model: directMatch };
    }
    // Manufacturer matched but no exact model in any line — still return the mfr
    return { manufacturer: mfr, line: null, model: null, remainder: rest };
  }
  return null;
}

export function renderDevicePicker({ idPrefix, initialValue = '', disabled = false, required = true }) {
  const parsed = parseDeviceString(initialValue);
  const disAttr = disabled ? 'disabled' : '';
  const reqMark = required ? ' *' : '';

  const mfrSel = parsed?.manufacturer || '';
  const mfrOther = !parsed && initialValue ? initialValue : '';
  const showMfrOther = !!mfrOther;

  const lineSel = parsed?.line || '';
  const lineOther = parsed?.remainder && !parsed?.line ? parsed.remainder : '';
  const showLineOther = !!lineOther;

  const modelSel = parsed?.model || '';

  const manufacturerOptions = getManufacturers().map(m =>
    `<option value="${escapeHtml(m)}" ${m === mfrSel ? 'selected' : ''}>${escapeHtml(m)}</option>`
  ).join('');

  const lineOptions = mfrSel
    ? getProductLines(mfrSel).map(l =>
        `<option value="${escapeHtml(l)}" ${l === lineSel ? 'selected' : ''}>${escapeHtml(l)}</option>`
      ).join('')
    : '';

  const modelOptions = (mfrSel && lineSel)
    ? getModels(mfrSel, lineSel).map(md =>
        `<option value="${escapeHtml(md)}" ${md === modelSel ? 'selected' : ''}>${escapeHtml(md)}</option>`
      ).join('')
    : '';

  return `
    <div class="device-picker" data-id-prefix="${escapeHtml(idPrefix)}">
      <div class="modal-form-grid">
        <div class="modal-field">
          <label>Manufacturer${reqMark}</label>
          <select id="${idPrefix}_mfr" ${disAttr}>
            <option value="">— Select —</option>
            ${manufacturerOptions}
            <option value="${OTHER}" ${showMfrOther ? 'selected' : ''}>Other…</option>
          </select>
          <input type="text" id="${idPrefix}_mfrOther" placeholder="Type manufacturer / device" value="${escapeHtml(mfrOther)}" ${disAttr} style="margin-top:0.5rem;display:${showMfrOther ? 'block' : 'none'};">
        </div>
        <div class="modal-field">
          <label>Product Line${reqMark}</label>
          <select id="${idPrefix}_line" ${disAttr} ${showMfrOther ? 'disabled' : ''}>
            <option value="">— Select —</option>
            ${lineOptions}
            <option value="${OTHER}" ${showLineOther ? 'selected' : ''}>Other…</option>
          </select>
          <input type="text" id="${idPrefix}_lineOther" placeholder="Type product line / model" value="${escapeHtml(lineOther)}" ${disAttr} style="margin-top:0.5rem;display:${showLineOther ? 'block' : 'none'};">
        </div>
      </div>
      <div class="modal-field">
        <label>Model${reqMark}</label>
        <select id="${idPrefix}_model" ${disAttr} ${(showMfrOther || showLineOther) ? 'disabled' : ''}>
          <option value="">— Select —</option>
          ${modelOptions}
          <option value="${OTHER}" ${modelSel === '' && initialValue && parsed?.line ? 'selected' : ''}>Other…</option>
        </select>
        <input type="text" id="${idPrefix}_modelOther" placeholder="Type specific model" ${disAttr} style="margin-top:0.5rem;display:none;">
      </div>
    </div>
  `;
}

export function attachDevicePickerHandlers(root, idPrefix) {
  const mfrSel = root.querySelector(`#${idPrefix}_mfr`);
  const mfrOther = root.querySelector(`#${idPrefix}_mfrOther`);
  const lineSel = root.querySelector(`#${idPrefix}_line`);
  const lineOther = root.querySelector(`#${idPrefix}_lineOther`);
  const modelSel = root.querySelector(`#${idPrefix}_model`);
  const modelOther = root.querySelector(`#${idPrefix}_modelOther`);

  if (!mfrSel || !lineSel || !modelSel) return;

  function rebuildLineOptions() {
    const mfr = mfrSel.value;
    if (!mfr || mfr === OTHER) {
      lineSel.innerHTML = '<option value="">— Select —</option>';
      lineSel.disabled = true;
      modelSel.innerHTML = '<option value="">— Select —</option>';
      modelSel.disabled = true;
      return;
    }
    lineSel.disabled = false;
    const lines = getProductLines(mfr);
    lineSel.innerHTML = '<option value="">— Select —</option>'
      + lines.map(l => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join('')
      + `<option value="${OTHER}">Other…</option>`;
    modelSel.innerHTML = '<option value="">— Select —</option>';
    modelSel.disabled = true;
  }

  function rebuildModelOptions() {
    const mfr = mfrSel.value;
    const line = lineSel.value;
    if (!mfr || mfr === OTHER || !line || line === OTHER) {
      modelSel.innerHTML = '<option value="">— Select —</option><option value="' + OTHER + '">Other…</option>';
      modelSel.disabled = !!(mfr === OTHER || line === OTHER || !line);
      return;
    }
    modelSel.disabled = false;
    const models = getModels(mfr, line);
    modelSel.innerHTML = '<option value="">— Select —</option>'
      + models.map(md => `<option value="${escapeHtml(md)}">${escapeHtml(md)}</option>`).join('')
      + `<option value="${OTHER}">Other…</option>`;
  }

  function syncOtherInput(selEl, otherEl, disablesDownstream) {
    const isOther = selEl.value === OTHER;
    otherEl.style.display = isOther ? 'block' : 'none';
    if (!isOther) otherEl.value = '';
    if (disablesDownstream) {
      if (isOther) {
        lineSel.disabled = true;
        modelSel.disabled = true;
      }
    }
  }

  mfrSel.addEventListener('change', () => {
    rebuildLineOptions();
    syncOtherInput(mfrSel, mfrOther, true);
    // Clear any downstream "Other" text
    lineOther.style.display = 'none'; lineOther.value = '';
    modelOther.style.display = 'none'; modelOther.value = '';
  });

  lineSel.addEventListener('change', () => {
    rebuildModelOptions();
    syncOtherInput(lineSel, lineOther, false);
    if (lineSel.value === OTHER) {
      modelSel.disabled = true;
    }
    modelOther.style.display = 'none'; modelOther.value = '';
  });

  modelSel.addEventListener('change', () => {
    syncOtherInput(modelSel, modelOther, false);
  });
}

// Read the composed value from the picker.
// Returns the composed device string, or '' if nothing meaningful was entered.
export function getDevicePickerValue(root, idPrefix) {
  const mfrSel = root.querySelector(`#${idPrefix}_mfr`);
  const mfrOther = root.querySelector(`#${idPrefix}_mfrOther`);
  const lineSel = root.querySelector(`#${idPrefix}_line`);
  const lineOther = root.querySelector(`#${idPrefix}_lineOther`);
  const modelSel = root.querySelector(`#${idPrefix}_model`);
  const modelOther = root.querySelector(`#${idPrefix}_modelOther`);

  if (!mfrSel) return '';

  // Level 1: manufacturer
  const mfrVal = mfrSel.value;
  if (!mfrVal) return '';
  if (mfrVal === OTHER) {
    return (mfrOther.value || '').trim();
  }

  // Level 2: product line
  const lineVal = lineSel.value;
  if (!lineVal) return mfrVal; // just manufacturer
  if (lineVal === OTHER) {
    const extra = (lineOther.value || '').trim();
    return extra ? `${mfrVal} ${extra}` : mfrVal;
  }

  // Level 3: model
  const modelVal = modelSel.value;
  if (!modelVal) {
    // Manufacturer + line (product line alone is rarely meaningful but keep it)
    return `${mfrVal} ${lineVal}`;
  }
  if (modelVal === OTHER) {
    const extra = (modelOther.value || '').trim();
    return extra ? `${mfrVal} ${extra}` : `${mfrVal} ${lineVal}`;
  }

  // Model names already contain the product context (e.g., "iPhone 17 Pro Max"),
  // so we prepend the manufacturer only.
  return `${mfrVal} ${modelVal}`;
}
