// Add / edit a code system — one modal, one save. The repository validates
// (name unique, type known, dates in order) and the form shows its sentences
// under the fields; nothing is written until Save passes.

import * as systems from '../../../../data/repositories/code-systems.js';
import * as modal from '../../../../shared/modal.js';
import { dateTime, esc } from '../../../../shared/format.js';

/** openSystemForm(id | null) -> Promise<system | undefined>. */
export async function openSystemForm(id) {
  const system = id ? systems.get(id) : null;
  if (id && !system) return undefined;

  const dialog = modal.open({
    title: system ? esc(system.name) : 'Add code system',
    sub: system
      ? `${esc(systems.typeLabel(system.systemType))} · ${esc(system.status)} · updated ${dateTime(system.updatedAt)}`
      : 'A vocabulary and its type. Versions and codes are added on the system page.',
    icon: system ? 'menu_book' : 'library_add',
    size: 'lg',
    body: formHtml(system),
    note: system ? 'Versions and codes are edited on the system page.' : 'The first version is added on the system page after saving.',
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="save">${system ? 'Save system' : 'Add system'}</button>`,
  });

  const el = dialog.el;
  const $ = (sel) => el.querySelector(sel);

  function read() {
    return {
      name: $('[name="name"]').value,
      systemType: $('[name="systemType"]').value,
      status: $('[name="status"]').value,
      validFrom: $('[name="validFrom"]').value,
      validTo: $('[name="validTo"]').value,
      description: $('[name="description"]').value,
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
    el.querySelector('.field--invalid input, .field--invalid select')?.focus();
  }

  el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="save"]')) return;
    const data = read();
    const result = system ? systems.update(system.id, data) : systems.create(data);
    if (result.error) return showErrors(result.errors || { name: result.error });
    dialog.close(result.row);
  });

  return dialog.closed;
}

function formHtml(system) {
  const typeOptions = systems.TYPES.map((t) =>
    `<option value="${t}"${(system?.systemType || 'DIAGNOSIS') === t ? ' selected' : ''}>${esc(systems.typeLabel(t))}</option>`).join('');
  const statusOptions = systems.STATUSES.map((s) =>
    `<option value="${s}"${(system?.status || 'Active') === s ? ' selected' : ''}>${s}</option>`).join('');
  return `
    <dl class="dl">
      <dt><label for="sf-name">Name *</label></dt>
      <dd>
        <label class="field"><input id="sf-name" name="name" autofocus placeholder="ICD-10-CM" value="${esc(system?.name || '')}"></label>
        <div class="field-error" data-error="name" hidden></div>
      </dd>
      <dt><label for="sf-type">Type *</label></dt>
      <dd>
        <label class="field"><select id="sf-type" name="systemType">${typeOptions}</select></label>
        <div class="field-error" data-error="systemType" hidden></div>
      </dd>
      <dt><label for="sf-status">Status *</label></dt>
      <dd>
        <label class="field"><select id="sf-status" name="status">${statusOptions}</select></label>
        <div class="field-error" data-error="status" hidden></div>
      </dd>
      <dt><label for="sf-from">Valid from *</label></dt>
      <dd>
        <label class="field"><input id="sf-from" name="validFrom" type="date" value="${esc(system?.validFrom || '')}"></label>
        <div class="field-error" data-error="validFrom" hidden></div>
      </dd>
      <dt><label for="sf-to">Valid to</label></dt>
      <dd>
        <label class="field"><input id="sf-to" name="validTo" type="date" value="${esc(system?.validTo || '')}"></label>
        <div class="field-error" data-error="validTo" hidden></div>
        <p class="t-body-sm">Leave blank for an open-ended agreement with the publisher.</p>
      </dd>
      <dt><label for="sf-desc">Description</label></dt>
      <dd>
        <label class="field field--area"><textarea id="sf-desc" name="description" rows="3" placeholder="What the system is used for and where its releases come from">${esc(system?.description || '')}</textarea></label>
      </dd>
    </dl>`;
}
