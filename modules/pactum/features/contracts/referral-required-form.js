// Add or edit one referral-required row. Scope level picks what the row covers
// and the toggle says whether the payer wants a doctor's referral before it
// will answer for it. Saving goes through the repository, which writes the
// audit diff.
//
// It is preauth-form.js with one field fewer and one level more: there is no
// threshold — a referral is asked for or it is not, whatever the charge comes
// to — and a Contract row is the blanket answer a narrower row overrides.

import * as contracts from '../../../../data/repositories/contracts.js';
import * as cdm from '../../../../data/repositories/cdm.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { esc } from '../../../../shared/format.js';
import { optionsHtml } from './fee-schedule.js';

/** openReferralForm({ contractId, rowId, scopeLevel }) -> Promise<row|undefined> */
export async function openReferralForm({ contractId, rowId = null, scopeLevel = '' }) {
  const contract = contracts.get(contractId);
  if (!contract) return undefined;
  const existing = contracts.referralRows(contract).find((r) => r.id === rowId) || null;

  const draft = {
    id: existing?.id || null,
    scopeLevel: existing?.scopeLevel || scopeLevel || 'Category',
    scopeValue: existing?.scopeValue ?? '',
    required: existing ? existing.required !== false : true,
  };

  const dialog = modal.open({
    title: existing ? 'Edit referral rule' : 'Add referral rule',
    sub: `${esc(contract.contractNo)} — version ${contract.version}`,
    icon: 'forward',
    size: 'lg',
    body: bodyHtml(draft),
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="save">${existing ? 'Save rule' : 'Add rule'}</button>`,
  });

  const el = dialog.el;
  const redraw = () => { el.querySelector('.modal__body').innerHTML = bodyHtml(draft); };

  function showError(message) {
    const box = el.querySelector('#rr-error');
    box.textContent = message;
    box.hidden = false;
    box.scrollIntoView({ block: 'nearest' });
  }

  el.addEventListener('change', (e) => {
    const field = e.target.closest('[name]');
    if (!field) return;
    draft[field.name] = field.value;
    // The level changes what the value picker offers, so the value starts over.
    if (field.name === 'scopeLevel') {
      draft.scopeValue = '';
      redraw();
    }
  });

  el.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-req]');
    if (toggle) {
      draft.required = toggle.dataset.req === 'yes';
      return redraw();
    }
    if (!e.target.closest('[data-act="save"]')) return;

    const problem = problemWith(draft, contract);
    if (problem) return showError(problem);

    const saved = contracts.saveReferralRequired(contract.id, draft);
    dialog.close(saved);
    toast(`${contracts.referralLabel(saved)} saved`, 'success');
  });

  return dialog.closed;
}

// --- markup ------------------------------------------------------------------

function bodyHtml(draft) {
  const blanket = draft.scopeLevel === 'Contract';
  return `
    <dl class="dl dl--narrow">
      <dt><label for="rr-level">Scope level *</label></dt>
      <dd>
        <label class="field">
          <select id="rr-level" name="scopeLevel">
            ${contracts.REFERRAL_LEVELS.map((s) => `<option value="${s}"${s === draft.scopeLevel ? ' selected' : ''}>${s}</option>`).join('')}
          </select>
        </label>
        <p class="t-body-sm">A narrower row beats a wider one: Item, then Category, then Service Group, then the
          whole contract.</p>
      </dd>

      ${blanket ? '' : `
        <dt><label for="rr-value">Scope value *</label></dt>
        <dd><label class="field"><select id="rr-value" name="scopeValue">${scopeOptions(draft)}</select></label></dd>`}

      <dt><label>Referral required *</label></dt>
      <dd>
        <span class="segmented" role="group" aria-label="Referral required">
          <button type="button" data-req="yes" aria-pressed="${draft.required}">Yes</button>
          <button type="button" data-req="no" aria-pressed="${!draft.required}">No</button>
        </span>
        <p class="t-body-sm">${draft.required
          ? blanket
            ? 'Every charge this agreement covers needs a referral, except the ones a narrower row exempts.'
            : 'The payer wants a doctor’s referral before it answers for this scope.'
          : 'This scope goes ahead without a referral — and exempts itself from any broader row that wants one.'}</p>
      </dd>
    </dl>
    <div class="field-error" id="rr-error" hidden></div>`;
}

function scopeOptions(draft) {
  const chosen = String(draft.scopeValue ?? '');
  if (draft.scopeLevel === 'Item') return optionsHtml(cdm.findActive(), chosen);
  const values = draft.scopeLevel === 'Category' ? cdm.CATEGORIES : contracts.SERVICE_GROUPS;
  return `<option value=""${chosen ? '' : ' selected'}>Choose a value</option>${values
    .map((v) => `<option value="${esc(v)}"${v === chosen ? ' selected' : ''}>${esc(v)}</option>`)
    .join('')}`;
}

// --- rules -------------------------------------------------------------------

/** The first thing wrong with the draft, or ''. */
function problemWith(draft, contract) {
  if (draft.scopeLevel !== 'Contract' && !draft.scopeValue) {
    return 'Choose the scope value this rule covers.';
  }
  const clash = contracts.referralOverlap(contract, {
    id: draft.id,
    scopeLevel: draft.scopeLevel,
    scopeValue: draft.scopeLevel === 'Contract' ? null : draft.scopeValue,
  });
  if (clash) {
    return `${contracts.referralLabel(clash)} already has a referral rule — ${
      clash.required ? 'required' : 'not required'
    }. Edit that rule instead, or choose another scope.`;
  }
  return '';
}
