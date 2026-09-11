// Add / edit a code system version — one modal, one save. Adding offers to
// start the release from an earlier one (the repository's createFromPrevious
// copy) and to make it current straight away; both are the repository's own
// writes, run after the version exists, so a refused create leaves nothing
// behind. The repository validates (label unique in the system, dates in
// order, no overlap with another term) and the form shows its sentences.

import * as versions from '../../../../data/repositories/code-system-versions.js';
import * as codes from '../../../../data/repositories/standard-codes.js';
import * as modal from '../../../../shared/modal.js';
import { date, esc } from '../../../../shared/format.js';

/** openVersionForm(systemId, versionId | null) -> Promise<{ row, copied } | undefined>. */
export async function openVersionForm(systemId, versionId) {
  const version = versionId ? versions.get(versionId) : null;
  if (versionId && !version) return undefined;
  const others = versions.bySystem(systemId).filter((v) => v.id !== versionId);

  const dialog = modal.open({
    title: version ? `Version ${esc(version.versionLabel)}` : 'Add version',
    sub: version
      ? `${esc(versions.label(version))} · ${esc(version.status)}${version.isCurrent ? ' · current' : ''}`
      : 'A release and the term it is valid over. Terms of one system never overlap.',
    icon: version ? 'layers' : 'library_add',
    size: 'lg',
    body: formHtml(version, others),
    note: version ? 'Current is moved from the Versions tab, never from here.' : 'Codes are entered or imported on the Codes tab.',
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="save">${version ? 'Save version' : 'Add version'}</button>`,
  });

  const el = dialog.el;
  const $ = (sel) => el.querySelector(sel);
  const choice = { copy: others.length > 0, current: false };

  function read() {
    return {
      codeSystemId: systemId,
      versionLabel: $('[name="versionLabel"]').value,
      releaseDate: $('[name="releaseDate"]').value,
      validFrom: $('[name="validFrom"]').value,
      validTo: $('[name="validTo"]').value,
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

  function syncChoices() {
    for (const btn of el.querySelectorAll('[data-copy]')) btn.setAttribute('aria-pressed', String((btn.dataset.copy === 'yes') === choice.copy));
    for (const btn of el.querySelectorAll('[data-current]')) btn.setAttribute('aria-pressed', String((btn.dataset.current === 'yes') === choice.current));
    const from = $('#vf-from');
    if (from) from.hidden = !choice.copy;
  }

  el.addEventListener('click', (e) => {
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      choice.copy = copy.dataset.copy === 'yes';
      return syncChoices();
    }
    const current = e.target.closest('[data-current]');
    if (current) {
      choice.current = current.dataset.current === 'yes';
      return syncChoices();
    }
    if (!e.target.closest('[data-act="save"]')) return;

    const data = read();
    if (version) {
      const result = versions.update(version.id, data);
      if (result.error) return showErrors(result.errors || { versionLabel: result.error });
      return dialog.close({ row: result.row, copied: 0 });
    }
    const result = versions.create(data);
    if (result.error) return showErrors(result.errors || { versionLabel: result.error });
    let copied = 0;
    if (choice.copy && others.length) {
      copied = codes.createFromPrevious(result.row.id, $('[name="fromVersionId"]').value).copied || 0;
    }
    if (choice.current) versions.setCurrent(result.row.id);
    dialog.close({ row: versions.get(result.row.id), copied });
  });

  if (!version) syncChoices();
  return dialog.closed;
}

function formHtml(version, others) {
  return `
    <dl class="dl">
      <dt><label for="vf-label">Version label *</label></dt>
      <dd>
        <label class="field"><input id="vf-label" name="versionLabel" autofocus placeholder="2027" value="${esc(version?.versionLabel || '')}"></label>
        <div class="field-error" data-error="versionLabel" hidden></div>
      </dd>
      <dt><label for="vf-release">Release date *</label></dt>
      <dd>
        <label class="field"><input id="vf-release" name="releaseDate" type="date" value="${esc(version?.releaseDate || '')}"></label>
        <div class="field-error" data-error="releaseDate" hidden></div>
      </dd>
      <dt><label for="vf-valid-from">Valid from *</label></dt>
      <dd>
        <label class="field"><input id="vf-valid-from" name="validFrom" type="date" value="${esc(version?.validFrom || '')}"></label>
        <div class="field-error" data-error="validFrom" hidden></div>
      </dd>
      <dt><label for="vf-valid-to">Valid to</label></dt>
      <dd>
        <label class="field"><input id="vf-valid-to" name="validTo" type="date" value="${esc(version?.validTo || '')}"></label>
        <div class="field-error" data-error="validTo" hidden></div>
        <p class="t-body-sm">Leave blank while the release is the latest; the next release added after it closes it the day before it starts.</p>
      </dd>
      ${version ? '' : `
      <dt>Codes</dt>
      <dd>
        <span class="segmented" role="group" aria-label="Starting codes">
          <button type="button" data-copy="yes" aria-pressed="true" ${others.length ? '' : 'disabled title="No earlier version to copy from"'}>Copy from a version</button>
          <button type="button" data-copy="no" aria-pressed="false">Start empty</button>
        </span>
        <!-- A plain wrapper carries hidden: .toolbar sets its own display. -->
        <div id="vf-from">
          <div class="toolbar">
            <label class="field">
              <span class="icon icon--sm">layers</span>
              <select name="fromVersionId" aria-label="Copy codes from">
                ${others.map((v, i) => `<option value="${esc(v.id)}"${i === 0 ? ' selected' : ''}>${esc(v.versionLabel)} — ${codes.counts(v.id).active} active codes · valid ${date(v.validFrom)}${v.validTo ? ` – ${date(v.validTo)}` : ' onward'}</option>`).join('')}
              </select>
            </label>
          </div>
        </div>
        <p class="t-body-sm">Active codes of the chosen version are copied in; edit the displays that changed on the Codes tab.</p>
      </dd>
      <dt>Set as current</dt>
      <dd>
        <span class="segmented" role="group" aria-label="Set as current after saving">
          <button type="button" data-current="yes" aria-pressed="false">Yes</button>
          <button type="button" data-current="no" aria-pressed="true">No</button>
        </span>
        <p class="t-body-sm">Yes makes this the version lookups with no date read, and clears the one that was current.</p>
      </dd>`}
    </dl>`;
}
