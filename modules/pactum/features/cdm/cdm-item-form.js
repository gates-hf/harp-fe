// Add / edit a CDM item — one modal, one panel, one save. The charge code is
// the line's identity: it is set once and read-only afterwards, because
// contract rules reference it. Bundles are not edited here; they open the
// builder, which needs a page rather than a dialog.

import * as cdm from '../../../../data/repositories/cdm.js';
import * as modal from '../../../../shared/modal.js';
import { dateTime, esc, usd } from '../../../../shared/format.js';

/** openItemForm(id | null) -> Promise<{ row, created } | undefined>. */
export async function openItemForm(id) {
  const line = id ? cdm.get(id) : null;
  if (id && !line) return undefined;

  const dialog = modal.open({
    title: line ? esc(line.chargeCode) : 'Add item',
    sub: line
      ? `${esc(cdm.label(line))} · ${usd(line.standardPrice)} · updated ${dateTime(line.updatedAt)}`
      : 'A charge code, a description and a price. The code cannot be changed later.',
    icon: line ? 'sell' : 'add',
    size: 'lg',
    body: bodyHtml(line),
    note: 'Cancel discards every change.',
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="save">${line ? 'Save item' : 'Add item'}</button>`,
  });

  const el = dialog.el;
  const $ = (sel) => el.querySelector(sel);

  $('#cf-category').innerHTML = options(cdm.ITEM_CATEGORIES, line?.category || 'Consultation');
  $('#cf-uom').innerHTML = options(cdm.UOMS, line?.uom || 'Each');
  $('#cf-status').innerHTML = options(cdm.STATUSES, line?.status || 'Active');

  function clearErrors() {
    for (const box of el.querySelectorAll('.field-error')) {
      box.hidden = true;
      box.textContent = '';
    }
    for (const field of el.querySelectorAll('.field')) field.classList.remove('field--invalid');
  }

  function showError(name, message) {
    const box = el.querySelector(`[data-error="${name}"]`);
    box.textContent = message;
    box.hidden = false;
    el.querySelector(`[name="${name}"]`)?.closest('.field')?.classList.add('field--invalid');
  }

  function save() {
    clearErrors();
    const values = {
      chargeCode: (line ? line.chargeCode : $('[name="chargeCode"]').value).trim().toUpperCase(),
      descriptionEn: $('[name="descriptionEn"]').value.trim(),
      category: $('#cf-category').value,
      uom: $('#cf-uom').value,
      standardPrice: $('[name="standardPrice"]').value.trim(),
      status: $('#cf-status').value,
    };

    const errors = validate(values, id);
    if (Object.keys(errors).length) {
      for (const [name, message] of Object.entries(errors)) showError(name, message);
      el.querySelector(`[name="${Object.keys(errors)[0]}"]`)?.focus();
      return;
    }

    const record = { ...values, standardPrice: Number(values.standardPrice), kind: 'item' };
    const row = id
      ? cdm.update(id, record)
      : cdm.create(record, { details: `${record.chargeCode} — ${record.descriptionEn}` });
    dialog.close({ row, created: !id });
  }

  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="save"]')) save();
  });

  return dialog.closed;
}

const options = (values, selected) =>
  values.map((v) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(v)}</option>`).join('');

function bodyHtml(line) {
  return `
    <dl class="dl">
      <dt><label for="cf-chargeCode">Charge code *</label></dt>
      <dd>
        <label class="field">
          <input id="cf-chargeCode" name="chargeCode" placeholder="LAB-0042"
                 value="${esc(line?.chargeCode || '')}" ${line ? 'readonly' : 'autofocus'}>
        </label>
        <div class="field-error" data-error="chargeCode" hidden></div>
        <p class="t-body-sm">${line
          ? 'The charge code is fixed once the line exists — contract rules reference it.'
          : 'Unique across the whole catalogue, items and bundles. It cannot be changed later.'}</p>
      </dd>

      <dt><label for="cf-descriptionEn">Description (EN) *</label></dt>
      <dd>
        <label class="field">
          <input id="cf-descriptionEn" name="descriptionEn" placeholder="Complete blood count (CBC)"
                 value="${esc(line?.descriptionEn || '')}" ${line ? 'autofocus' : ''}>
        </label>
        <div class="field-error" data-error="descriptionEn" hidden></div>
      </dd>

      <dt><label for="cf-category">Category *</label></dt>
      <dd>
        <label class="field"><select id="cf-category" name="category"></select></label>
        <div class="field-error" data-error="category" hidden></div>
      </dd>

      <dt><label for="cf-uom">Unit of measure *</label></dt>
      <dd>
        <label class="field"><select id="cf-uom" name="uom"></select></label>
        <div class="field-error" data-error="uom" hidden></div>
      </dd>

      <dt><label for="cf-standardPrice">Standard price (USD) *</label></dt>
      <dd>
        <label class="field">
          <input id="cf-standardPrice" name="standardPrice" type="number" min="0" step="0.01"
                 placeholder="12.50" value="${esc(line?.standardPrice ?? '')}">
        </label>
        <div class="field-error" data-error="standardPrice" hidden></div>
      </dd>

      <dt><label for="cf-status">Status *</label></dt>
      <dd>
        <label class="field"><select id="cf-status" name="status"></select></label>
        <div class="field-error" data-error="status" hidden></div>
      </dd>
    </dl>`;
}

/** Returns { field: message } for every invalid field, in form order. */
function validate(v, excludeId) {
  const errors = {};
  if (v.chargeCode.length < 3) errors.chargeCode = 'Enter a charge code, for example LAB-0042.';
  else if (!cdm.isChargeCodeUnique(v.chargeCode, excludeId)) {
    errors.chargeCode = `${v.chargeCode} is already used by another charge line.`;
  }

  if (v.descriptionEn.length < 3) errors.descriptionEn = 'Enter the description billing staff will read.';
  if (!cdm.ITEM_CATEGORIES.includes(v.category)) errors.category = 'Choose a category.';
  if (!cdm.UOMS.includes(v.uom)) errors.uom = 'Choose a unit of measure.';

  const price = Number(v.standardPrice);
  if (v.standardPrice === '' || !Number.isFinite(price)) errors.standardPrice = 'Enter the price in USD.';
  else if (price <= 0) errors.standardPrice = 'The price must be greater than zero.';

  if (!cdm.STATUSES.includes(v.status)) errors.status = 'Choose a status.';
  return errors;
}
