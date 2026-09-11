// Add a code to a version — one modal, one save. Code and display are what a
// code is; the sex, age band and category are what the coder's sanity checks
// and the charge-line link read, and stay blank when the code has no such
// rule. A diagnosis code's chapter is its first letter and is not asked for.

import * as systems from '../../../../data/repositories/code-systems.js';
import * as versions from '../../../../data/repositories/code-system-versions.js';
import * as codes from '../../../../data/repositories/standard-codes.js';
import * as cdm from '../../../../data/repositories/cdm.js';
import * as modal from '../../../../shared/modal.js';
import { date, esc } from '../../../../shared/format.js';

/** openCodeForm(versionId) -> Promise<code | undefined>. */
export async function openCodeForm(versionId) {
  const version = versions.get(versionId);
  if (!version) return undefined;
  const system = systems.get(version.codeSystemId);
  const diagnosis = system?.systemType === 'DIAGNOSIS';

  const dialog = modal.open({
    title: 'Add code',
    sub: `${esc(versions.label(version))} · valid ${date(version.validFrom)}${version.validTo ? ` – ${date(version.validTo)}` : ' onward'}`,
    icon: 'data_object',
    size: 'lg',
    body: formHtml(version, diagnosis),
    note: 'A code is never edited or deleted once saved — its display can be corrected, and a wrong code is deactivated.',
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="save">Add code</button>`,
  });

  const el = dialog.el;
  const $ = (sel) => el.querySelector(sel);

  function read() {
    const code = codes.normalizeCode($('[name="code"]').value);
    return {
      codeSystemVersionId: versionId,
      code,
      display: $('[name="display"]').value,
      validFrom: $('[name="validFrom"]').value,
      attributes: {
        sex: $('[name="sex"]').value || null,
        ageMin: $('[name="ageMin"]').value === '' ? null : Number($('[name="ageMin"]').value),
        ageMax: $('[name="ageMax"]').value === '' ? null : Number($('[name="ageMax"]').value),
        category: diagnosis ? null : ($('[name="category"]').value || null),
        chapter: diagnosis && code ? code[0] : null,
      },
    };
  }

  function showErrors(errors) {
    for (const box of el.querySelectorAll('.field-error')) {
      box.hidden = true;
      box.textContent = '';
    }
    for (const field of el.querySelectorAll('.field')) field.classList.remove('field--invalid');
    for (const [name, message] of Object.entries(errors)) {
      const box = el.querySelector(`[data-error="${name}"]`);
      if (!box) continue;
      box.textContent = message;
      box.hidden = false;
      el.querySelector(`[name="${name}"]`)?.closest('.field')?.classList.add('field--invalid');
    }
    el.querySelector('.field--invalid input')?.focus();
  }

  el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="save"]')) return;
    const data = read();
    const errors = {};
    if (data.attributes.ageMin !== null && data.attributes.ageMax !== null && data.attributes.ageMin > data.attributes.ageMax) {
      errors.ageMax = 'Age max is below age min';
    }
    if (Object.keys(errors).length) return showErrors(errors);
    const result = codes.create(data);
    if (result.error) return showErrors(result.errors || { code: result.error });
    dialog.close(result.row);
  });

  return dialog.closed;
}

function formHtml(version, diagnosis) {
  return `
    <dl class="dl">
      <dt><label for="cf-code">Code *</label></dt>
      <dd>
        <label class="field"><input id="cf-code" name="code" autofocus placeholder="${diagnosis ? 'I10' : '99213'}"></label>
        <div class="field-error" data-error="code" hidden></div>
      </dd>
      <dt><label for="cf-display">Display *</label></dt>
      <dd>
        <label class="field"><input id="cf-display" name="display" placeholder="${diagnosis ? 'Essential (primary) hypertension' : 'Office or outpatient visit, established patient'}"></label>
        <div class="field-error" data-error="display" hidden></div>
      </dd>
      <dt><label for="cf-from">Valid from</label></dt>
      <dd>
        <label class="field"><input id="cf-from" name="validFrom" type="date" value="${esc(version.validFrom)}"></label>
        <div class="field-error" data-error="validFrom" hidden></div>
        <p class="t-body-sm">Defaults to the version's own start.</p>
      </dd>
      <dt><label for="cf-sex">Sex</label></dt>
      <dd>
        <label class="field"><select id="cf-sex" name="sex">
          <option value="">Any</option><option value="F">Female only</option><option value="M">Male only</option>
        </select></label>
      </dd>
      <dt>Age band</dt>
      <dd>
        <div class="toolbar">
          <label class="field"><input name="ageMin" type="number" min="0" max="120" placeholder="min" aria-label="Age min"></label>
          <label class="field"><input name="ageMax" type="number" min="0" max="120" placeholder="max" aria-label="Age max"></label>
        </div>
        <div class="field-error" data-error="ageMax" hidden></div>
        <p class="t-body-sm">Blank when the code fits any age; 0 – 0 is a newborn code.</p>
      </dd>
      ${diagnosis ? '' : `
      <dt><label for="cf-category">Category</label></dt>
      <dd>
        <label class="field"><select id="cf-category" name="category">
          <option value="">—</option>
          ${cdm.ITEM_CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
        </select></label>
        <p class="t-body-sm">The charge master category a coded procedure links a released line by.</p>
      </dd>`}
    </dl>`;
}
