// Add or edit one coverage row, and copy a whole schedule from another plan.
// Scope level picks what the row covers, Covered decides whether the share
// fields are asked for at all, and the share type swaps the rest of the form.
// Saving goes through the repository, which writes the audit diff.

import * as contracts from '../../../../data/repositories/contracts.js';
import * as cdm from '../../../../data/repositories/cdm.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { esc, usd } from '../../../../shared/format.js';
import { optionsHtml } from './fee-schedule.js';

/** openCoverageForm({ contractId, planId, rowId }) -> Promise<row|undefined> */
export async function openCoverageForm({ contractId, planId, rowId = null }) {
  const contract = contracts.get(contractId);
  if (!contract || !planId) return undefined;
  const existing = contracts.coverageFor(contract, planId).find((r) => r.id === rowId) || null;

  const draft = {
    id: existing?.id || null,
    scopeLevel: existing?.scopeLevel || 'Default',
    scopeValue: existing?.scopeValue ?? '',
    covered: existing ? (existing.covered ? 'yes' : 'no') : 'yes',
    shareType: existing?.shareType || 'Co-pay %',
    shareValue: existing?.shareValue ?? '',
    deductible: existing?.deductible ?? '',
    ceiling: existing?.ceiling ?? '',
  };

  const dialog = modal.open({
    title: existing ? 'Edit coverage row' : 'Add coverage row',
    sub: `${esc(contract.contractNo)} — ${esc(contracts.planNameOf(contract, planId))}`,
    icon: 'balance',
    size: 'md',
    body: bodyHtml(draft),
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="save">${existing ? 'Save row' : 'Add row'}</button>`,
  });

  const el = dialog.el;
  const redraw = () => { el.querySelector('.modal__body').innerHTML = bodyHtml(draft); };

  el.addEventListener('input', (e) => {
    const field = e.target.closest('[name]');
    if (field) draft[field.name] = field.value;
  });

  el.addEventListener('change', (e) => {
    const field = e.target.closest('[name]');
    if (!field) return;
    draft[field.name] = field.value;
    // Each of the three changes what the rest of the form asks for.
    if (field.name === 'scopeLevel') draft.scopeValue = '';
    if (['scopeLevel', 'covered', 'shareType'].includes(field.name)) redraw();
  });

  el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="save"]')) return;
    const problem = problemWith(draft, contract, planId);
    if (problem) {
      const box = el.querySelector('#cf-error');
      box.textContent = problem;
      box.hidden = false;
      box.scrollIntoView({ block: 'nearest' });
      return;
    }
    const saved = contracts.saveCoverageRow(contractId, planId, {
      id: draft.id,
      scopeLevel: draft.scopeLevel,
      scopeValue: draft.scopeValue,
      covered: draft.covered === 'yes',
      shareType: draft.shareType,
      shareValue: draft.shareValue,
      deductible: draft.deductible,
      ceiling: draft.ceiling,
    });
    dialog.close(saved);
    toast(`${contracts.scopeLabel(saved)} — coverage saved`, 'success');
  });

  return dialog.closed;
}

/** openCopyCoverage({ contractId, toPlanId }) -> Promise<number|undefined> */
export async function openCopyCoverage({ contractId, toPlanId }) {
  const contract = contracts.get(contractId);
  const others = contracts.plansOf(contract).filter((p) => p.id !== toPlanId);
  if (!contract || !others.length) return undefined;

  const draft = { fromPlanId: others[0].id, mode: 'Replace' };
  const dialog = modal.open({
    title: 'Copy coverage from another plan',
    sub: `Into ${esc(contracts.planNameOf(contract, toPlanId))}`,
    icon: 'content_copy',
    size: 'md',
    body: copyBodyHtml(contract, toPlanId, draft, others),
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="copy">Copy rows</button>`,
  });

  const el = dialog.el;

  el.addEventListener('change', (e) => {
    const field = e.target.closest('[name]');
    if (!field) return;
    draft[field.name] = field.value;
    el.querySelector('#cf-copy-count').textContent = copyNote(contract, toPlanId, draft);
  });

  el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="copy"]')) return;
    const from = contracts.planNameOf(contract, draft.fromPlanId);
    const written = contracts.copyCoverage(contractId, draft.fromPlanId, toPlanId, draft.mode);
    dialog.close(written);
    toast(written
      ? `${written} row${written === 1 ? '' : 's'} copied from ${from}`
      : `Nothing to copy from ${from}`, written ? 'success' : 'info');
  });

  return dialog.closed;
}

// --- markup ------------------------------------------------------------------

function bodyHtml(draft) {
  const isDefault = draft.scopeLevel === 'Default';
  const covered = draft.covered === 'yes';
  return `
    <dl class="dl dl--narrow">
      <dt><label for="cf-level">Scope level *</label></dt>
      <dd>
        <label class="field">
          <select id="cf-level" name="scopeLevel">
            ${contracts.COVERAGE_SCOPE_LEVELS.map((s) => `<option value="${s}"${s === draft.scopeLevel ? ' selected' : ''}>${s}</option>`).join('')}
          </select>
        </label>
        <p class="t-body-sm">${isDefault
          ? 'The fallback for every charge no narrower row covers.'
          : 'A narrower row beats a wider one: Item, then Category, then Service Group.'}</p>
      </dd>
      ${isDefault ? '' : `
      <dt><label for="cf-value">Scope value *</label></dt>
      <dd><label class="field"><select id="cf-value" name="scopeValue">${scopeOptions(draft)}</select></label></dd>`}
      <dt><label for="cf-covered">Covered *</label></dt>
      <dd>
        <label class="field">
          <select id="cf-covered" name="covered">
            <option value="yes"${covered ? ' selected' : ''}>Yes</option>
            <option value="no"${covered ? '' : ' selected'}>No</option>
          </select>
        </label>
        ${covered ? '' : '<p class="t-body-sm">Fully patient responsibility — the payer pays nothing for this scope.</p>'}
      </dd>
      ${covered ? shareFields(draft) : ''}
    </dl>
    <div class="field-error" id="cf-error" hidden></div>`;
}

function shareFields(draft) {
  const type = draft.shareType;
  const percent = type === 'Co-pay %' || type === 'Deductible then %';
  return `
    <dt><label for="cf-type">Share type *</label></dt>
    <dd>
      <label class="field">
        <select id="cf-type" name="shareType">
          ${contracts.SHARE_TYPES.map((s) => `<option value="${esc(s)}"${s === type ? ' selected' : ''}>${esc(s)}</option>`).join('')}
        </select>
      </label>
      <p class="t-body-sm">${shareHint(type)}</p>
    </dd>
    ${type === 'Deductible then %' ? `
    <dt><label for="cf-deductible">Deductible *</label></dt>
    <dd>
      <label class="field">
        <span class="icon icon--sm">attach_money</span>
        <input id="cf-deductible" name="deductible" type="number" min="0" step="0.01" value="${esc(draft.deductible)}">
      </label>
    </dd>` : ''}
    ${type === 'None' ? '' : `
    <dt><label for="cf-value-amount">Share value *</label></dt>
    <dd>
      <label class="field">
        <span class="icon icon--sm">${percent ? 'percent' : 'attach_money'}</span>
        <input id="cf-value-amount" name="shareValue" type="number" min="0"
               ${percent ? 'max="100" step="0.1"' : 'step="0.01"'} value="${esc(draft.shareValue)}">
      </label>
    </dd>`}
    <dt><label for="cf-ceiling">Ceiling</label></dt>
    <dd>
      <label class="field">
        <span class="icon icon--sm">attach_money</span>
        <input id="cf-ceiling" name="ceiling" type="number" min="0" step="0.01" value="${esc(draft.ceiling)}">
      </label>
      <p class="t-body-sm">The most the patient pays on one charge. Leave it empty for no cap.</p>
    </dd>`;
}

function shareHint(type) {
  if (type === 'None') return 'The payer pays the whole allowed amount.';
  if (type === 'Co-pay %') return 'The patient pays this share of the allowed amount.';
  if (type === 'Fixed Co-pay') return 'The patient pays this amount, or the allowed amount if it is smaller.';
  return 'The patient pays the deductible first, then this share of what is left.';
}

function scopeOptions(draft) {
  const chosen = String(draft.scopeValue ?? '');
  if (draft.scopeLevel === 'Item') return optionsHtml(cdm.findActive(), chosen);
  const values = draft.scopeLevel === 'Service Group' ? contracts.SERVICE_GROUPS : cdm.CATEGORIES;
  return `<option value=""${chosen ? '' : ' selected'}>Choose a value</option>${values
    .map((v) => `<option value="${esc(v)}"${v === chosen ? ' selected' : ''}>${esc(v)}</option>`)
    .join('')}`;
}

function copyBodyHtml(contract, toPlanId, draft, others) {
  return `
    <p class="modal__lede">Copying brings the source plan's rows across as they stand. Nothing on the source plan changes.</p>
    <dl class="dl dl--narrow">
      <dt><label for="cf-source">Source plan *</label></dt>
      <dd>
        <label class="field">
          <select id="cf-source" name="fromPlanId">
            ${others.map((p) => {
    const n = contracts.coverageFor(contract, p.id).length;
    return `<option value="${esc(p.id)}"${p.id === draft.fromPlanId ? ' selected' : ''}>${esc(p.name)} — ${n} row${n === 1 ? '' : 's'}</option>`;
  }).join('')}
          </select>
        </label>
      </dd>
      <dt><label for="cf-mode">Mode *</label></dt>
      <dd>
        <label class="field">
          <select id="cf-mode" name="mode">
            ${contracts.COPY_MODES.map((m) => `<option value="${esc(m.id)}"${m.id === draft.mode ? ' selected' : ''}>${esc(m.label)}</option>`).join('')}
          </select>
        </label>
        <p class="t-body-sm">Replace clears this plan first. Merge keeps every row it already holds and adds only the scopes it is missing.</p>
      </dd>
    </dl>
    <p class="t-body-sm" id="cf-copy-count">${esc(copyNote(contract, toPlanId, draft))}</p>`;
}

function copyNote(contract, toPlanId, draft) {
  const n = contracts.coverageCopyCount(contract, draft.fromPlanId, toPlanId, draft.mode);
  const held = contracts.coverageFor(contract, toPlanId).length;
  const dropped = draft.mode === 'Replace' && held ? ` ${held} existing row${held === 1 ? '' : 's'} will be replaced.` : '';
  return `Will copy ${n} row${n === 1 ? '' : 's'}.${dropped}`;
}

// --- rules -------------------------------------------------------------------

/** The first thing wrong with the draft, or ''. */
function problemWith(draft, contract, planId) {
  if (draft.scopeLevel !== 'Default' && !draft.scopeValue) return 'Choose the scope value this row covers.';

  if (draft.covered === 'yes' && draft.shareType !== 'None') {
    const value = Number(draft.shareValue);
    const percent = draft.shareType === 'Co-pay %' || draft.shareType === 'Deductible then %';
    if (percent && !(value > 0 && value <= 100)) return 'Enter a share above zero and no more than 100 percent.';
    if (!percent && !(value > 0)) return 'Enter a co-pay amount above zero.';
    if (draft.shareType === 'Deductible then %' && !(Number(draft.deductible) > 0)) {
      return 'Enter a deductible above zero, or choose a different share type.';
    }
  }
  if (draft.covered === 'yes' && draft.ceiling !== '' && !(Number(draft.ceiling) > 0)) {
    return 'A ceiling has to be greater than zero. Leave it empty for no cap.';
  }

  const clash = contracts.coverageOverlap(contract, planId, {
    id: draft.id,
    scopeLevel: draft.scopeLevel,
    scopeValue: draft.scopeLevel === 'Default' ? null : draft.scopeValue,
  });
  if (clash) {
    return `${contracts.scopeLabel(clash)} is already covered on this plan — ${
      clash.covered ? `patient pays ${contracts.shareSummary(clash)}` : 'not covered'
    }${clash.ceiling ? `, ceiling ${usd(clash.ceiling)}` : ''}. Edit that row, or choose another scope.`;
  }
  return '';
}
