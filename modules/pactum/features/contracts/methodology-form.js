// Add or edit one rate methodology. Scope level picks what the row covers,
// methodology picks how it is paid, and the parameter fields swap with it —
// Fixed Amount reveals the fee schedule (fee-schedule.js) and its importer.
// Saving goes through the repository, which writes the audit diff.

import * as contracts from '../../../../data/repositories/contracts.js';
import * as cdm from '../../../../data/repositories/cdm.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { date, esc } from '../../../../shared/format.js';
import { feeScheduleHtml, scheduleRows, noteText, optionsHtml } from './fee-schedule.js';
import { openFeeScheduleImport } from './fee-schedule-import.js';

const BLANK_PARAMS = {
  percent: '', amount: '', wardType: 'General', bundleId: '',
  baseRate: '', weightSource: 'Local', perMemberPerMonth: '', memberCount: '',
};

/** openMethodologyForm({ contractId, methodologyId }) -> Promise<row|undefined> */
export async function openMethodologyForm({ contractId, methodologyId = null }) {
  const contract = contracts.get(contractId);
  if (!contract) return undefined;
  const existing = contracts.methodologies(contract).find((m) => m.id === methodologyId) || null;

  const draft = {
    id: existing?.id || null,
    scopeLevel: existing?.scopeLevel || 'Default',
    scopeValue: existing?.scopeValue ?? '',
    method: existing?.method || '% of Charges',
    effectiveFrom: existing?.effectiveFrom || contract.startDate,
    effectiveTo: existing?.effectiveTo || contract.endDate,
    params: { ...BLANK_PARAMS, ...(existing?.params || {}) },
    schedule: (existing?.params?.feeSchedule || []).map((line) => ({ ...line })),
  };

  const dialog = modal.open({
    title: existing ? 'Edit methodology' : 'Add methodology',
    sub: `${esc(contract.contractNo)} — version ${contract.version}`,
    icon: 'payments',
    // The widest the design system ships without going full-bleed: the fee
    // schedule is a four-column table inside the dialog.
    size: 'xl',
    body: bodyHtml(draft),
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="save">${existing ? 'Save methodology' : 'Add methodology'}</button>`,
  });

  const el = dialog.el;
  const redraw = () => { el.querySelector('.modal__body').innerHTML = bodyHtml(draft); };
  const drawSchedule = () => {
    el.querySelector('#mf-schedule').innerHTML = scheduleRows(draft.schedule);
    el.querySelector('#mf-schedule-note').textContent = noteText(draft.schedule);
  };

  function showError(message) {
    const box = el.querySelector('#mf-error');
    box.textContent = message;
    box.hidden = false;
    box.scrollIntoView({ block: 'nearest' });
  }

  el.addEventListener('input', (e) => {
    const field = e.target.closest('[name]');
    if (!field) return assignSchedule(e.target, draft, drawSchedule);
    assign(field, draft);
  });

  el.addEventListener('change', (e) => {
    const field = e.target.closest('[name]');
    if (!field) return assignSchedule(e.target, draft, drawSchedule);
    assign(field, draft);
    // Both selects change what the rest of the form asks for.
    if (field.name === 'scopeLevel' || field.name === 'method') {
      if (field.name === 'scopeLevel') draft.scopeValue = '';
      redraw();
    }
  });

  el.addEventListener('click', async (e) => {
    const fs = e.target.closest('[data-fs]')?.dataset.fs;
    if (fs === 'add') {
      draft.schedule.push({ itemId: '', price: '' });
      return drawSchedule();
    }
    if (fs === 'import') {
      const rows = await openFeeScheduleImport({ existing: draft.schedule });
      if (!rows?.length) return;
      draft.schedule.push(...rows);
      drawSchedule();
      return void toast(`${rows.length} price${rows.length === 1 ? '' : 's'} added to the schedule`, 'success');
    }
    const remove = e.target.closest('[data-fs-remove]');
    if (remove) {
      draft.schedule.splice(Number(remove.dataset.fsRemove), 1);
      return drawSchedule();
    }

    if (!e.target.closest('[data-act="save"]')) return;
    const problem = problemWith(draft, contract);
    if (problem) return showError(problem);

    const saved = contracts.saveMethodology(contract.id, {
      id: draft.id,
      scopeLevel: draft.scopeLevel,
      scopeValue: draft.scopeValue,
      method: draft.method,
      effectiveFrom: draft.effectiveFrom,
      effectiveTo: draft.effectiveTo,
      params: draft.method === 'Fixed Amount' ? { feeSchedule: draft.schedule } : draft.params,
    });
    dialog.close(saved);
    toast(`${contracts.scopeLabel(saved)} — ${saved.method} saved`, 'success');
  });

  return dialog.closed;
}

// --- markup ------------------------------------------------------------------

function bodyHtml(draft) {
  const isDefault = draft.scopeLevel === 'Default';
  return `
    <dl class="dl dl--narrow">
      <dt><label for="mf-level">Scope level *</label></dt>
      <dd>
        <label class="field">
          <select id="mf-level" name="scopeLevel">
            ${contracts.SCOPE_LEVELS.map((s) => `<option value="${s}"${s === draft.scopeLevel ? ' selected' : ''}>${s}</option>`).join('')}
          </select>
        </label>
        <p class="t-body-sm">${isDefault
          ? 'The fallback for every charge no narrower row covers.'
          : 'A narrower row beats a wider one: Item, then Category, then Service Group, then Admission Type.'}</p>
      </dd>
      ${isDefault ? '' : `
      <dt><label for="mf-value">Scope value *</label></dt>
      <dd><label class="field"><select id="mf-value" name="scopeValue">${scopeOptions(draft)}</select></label></dd>`}
      <dt><label for="mf-method">Methodology *</label></dt>
      <dd>
        <label class="field">
          <select id="mf-method" name="method">
            ${contracts.METHODS.map((m) => `<option value="${m}"${m === draft.method ? ' selected' : ''}>${m}</option>`).join('')}
          </select>
        </label>
      </dd>
      <dt><label for="mf-from">Effective from *</label></dt>
      <dd><label class="field"><input id="mf-from" name="effectiveFrom" type="date" value="${esc(draft.effectiveFrom)}"></label></dd>
      <dt><label for="mf-to">Effective to</label></dt>
      <dd>
        <label class="field"><input id="mf-to" name="effectiveTo" type="date" value="${esc(draft.effectiveTo)}"></label>
        <p class="t-body-sm">Leave it empty to run for as long as the contract does.</p>
      </dd>
      ${paramFields(draft)}
    </dl>
    ${draft.method === 'Fixed Amount' ? feeScheduleHtml(draft.schedule) : ''}
    <div class="field-error" id="mf-error" hidden></div>`;
}

function scopeOptions(draft) {
  const chosen = String(draft.scopeValue ?? '');
  if (draft.scopeLevel === 'Item') return optionsHtml(cdm.findActive(), chosen);
  const values = draft.scopeLevel === 'Service Group' ? contracts.SERVICE_GROUPS
    : draft.scopeLevel === 'Category' ? cdm.CATEGORIES
      : contracts.ADMISSION_TYPES;
  return `<option value=""${chosen ? '' : ' selected'}>Choose a value</option>${values
    .map((v) => `<option value="${esc(v)}"${v === chosen ? ' selected' : ''}>${esc(v)}</option>`)
    .join('')}`;
}

function paramFields(draft) {
  const p = draft.params;
  const money = (name, label, value) => `
    <dt><label for="mf-${name}">${label} *</label></dt>
    <dd>
      <label class="field">
        <span class="icon icon--sm">attach_money</span>
        <input id="mf-${name}" name="p.${name}" type="number" min="0" step="0.01" value="${esc(value)}">
      </label>
    </dd>`;
  const choice = (name, label, values, value) => `
    <dt><label for="mf-${name}">${label} *</label></dt>
    <dd>
      <label class="field">
        <select id="mf-${name}" name="p.${name}">
          ${values.map((v) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(v)}</option>`).join('')}
        </select>
      </label>
    </dd>`;

  if (draft.method === '% of Charges') {
    return `
      <dt><label for="mf-percent">Percent of charges *</label></dt>
      <dd>
        <label class="field">
          <span class="icon icon--sm">percent</span>
          <input id="mf-percent" name="p.percent" type="number" min="0" max="100" step="0.1" value="${esc(p.percent)}">
        </label>
        <p class="t-body-sm">Applied to the standard price of every charge in scope.</p>
      </dd>`;
  }
  if (draft.method === 'Fixed Amount') {
    return `
      <dt>Parameters</dt>
      <dd><p class="t-body-sm">The fee schedule below is this row's parameter — one agreed price per charge line.</p></dd>`;
  }
  if (draft.method === 'Per Diem') {
    return money('amount', 'Amount per night', p.amount) + choice('wardType', 'Ward type', contracts.WARD_TYPES, p.wardType);
  }
  if (draft.method === 'Case Rate') {
    const bundles = cdm.findActive().filter((r) => cdm.isBundle(r));
    return money('amount', 'Case rate', p.amount) + `
      <dt><label for="mf-bundle">Priced bundle *</label></dt>
      <dd>
        <label class="field"><select id="mf-bundle" name="p.bundleId">${optionsHtml(bundles, p.bundleId)}</select></label>
        <p class="t-body-sm">Anything a claim runs past the bundle's component limits is overage — set its policy on the Overage tab.</p>
      </dd>`;
  }
  if (draft.method === 'DRG') {
    return money('baseRate', 'Base rate', p.baseRate) + choice('weightSource', 'Weight source', contracts.WEIGHT_SOURCES, p.weightSource);
  }
  return money('perMemberPerMonth', 'Per member per month', p.perMemberPerMonth) + `
    <dt><label for="mf-members">Member count *</label></dt>
    <dd><label class="field"><input id="mf-members" name="p.memberCount" type="number" min="0" step="1" value="${esc(p.memberCount)}"></label></dd>`;
}

// --- state and rules ---------------------------------------------------------

function assign(field, draft) {
  if (field.name.startsWith('p.')) draft.params[field.name.slice(2)] = field.value;
  else draft[field.name] = field.value;
}

function assignSchedule(target, draft, drawSchedule) {
  const item = target.closest('[data-fs-item]');
  if (item) {
    draft.schedule[Number(item.dataset.fsItem)].itemId = item.value;
    return drawSchedule();
  }
  const price = target.closest('[data-fs-price]');
  if (!price) return;
  draft.schedule[Number(price.dataset.fsPrice)].price = price.value;
  const note = document.getElementById('mf-schedule-note');
  if (note) note.textContent = noteText(draft.schedule);
}

/** The first thing wrong with the draft, or ''. */
function problemWith(draft, contract) {
  const positive = (v) => Number(v) > 0;
  if (draft.scopeLevel !== 'Default' && !draft.scopeValue) return 'Choose the scope value this row covers.';
  if (!draft.effectiveFrom) return 'Choose the date this methodology starts.';
  if (draft.effectiveTo && draft.effectiveTo < draft.effectiveFrom) return 'Effective to cannot be before effective from.';

  const p = draft.params;
  if (draft.method === '% of Charges' && !(Number(p.percent) > 0 && Number(p.percent) <= 100)) {
    return 'Enter a percentage above zero and no more than 100.';
  }
  if (draft.method === 'Fixed Amount') {
    if (!draft.schedule.length) return 'A fixed amount row needs at least one priced item.';
    if (draft.schedule.some((line) => !line.itemId)) return 'Every fee schedule row needs a charge line.';
    if (draft.schedule.some((line) => !positive(line.price))) return 'Every agreed price has to be greater than zero.';
    const ids = draft.schedule.map((line) => line.itemId);
    if (new Set(ids).size !== ids.length) return 'The same charge line is priced twice — remove the duplicate.';
  }
  if (draft.method === 'Per Diem' && !positive(p.amount)) return 'Enter a per-diem amount above zero.';
  if (draft.method === 'Case Rate') {
    if (!positive(p.amount)) return 'Enter a case rate above zero.';
    if (!p.bundleId) return 'Choose the bundle this case rate prices.';
  }
  if (draft.method === 'DRG' && !positive(p.baseRate)) return 'Enter a base rate above zero.';
  if (draft.method === 'Capitation' && !(positive(p.perMemberPerMonth) && positive(p.memberCount))) {
    return 'Enter a per-member-per-month amount and a member count above zero.';
  }

  const clash = contracts.methodologyOverlap(contract, {
    id: draft.id,
    scopeLevel: draft.scopeLevel,
    scopeValue: draft.scopeLevel === 'Default' ? null : draft.scopeValue,
    effectiveFrom: draft.effectiveFrom,
    effectiveTo: draft.effectiveTo,
  });
  if (clash) {
    return `${contracts.scopeLabel(clash)} is already priced as ${clash.method} from ${date(clash.effectiveFrom)} to ${
      clash.effectiveTo ? date(clash.effectiveTo) : 'the end of the contract'}. Change the scope or move the dates.`;
  }
  return '';
}
