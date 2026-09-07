// Add or edit one pre-authorization row. Scope level picks what the row covers,
// the toggle says whether the payer has to approve it, and the threshold turns
// that into "only above this amount". Saving goes through the repository, which
// writes the audit diff.

import * as contracts from '../../../../data/repositories/contracts.js';
import * as cdm from '../../../../data/repositories/cdm.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { esc } from '../../../../shared/format.js';
import { optionsHtml } from './fee-schedule.js';

/** openPreAuthForm({ contractId, rowId }) -> Promise<row|undefined> */
export async function openPreAuthForm({ contractId, rowId = null }) {
  const contract = contracts.get(contractId);
  if (!contract) return undefined;
  const existing = contracts.preAuthRows(contract).find((r) => r.id === rowId) || null;

  const draft = {
    id: existing?.id || null,
    scopeLevel: existing?.scopeLevel || 'Service Group',
    scopeValue: existing?.scopeValue ?? '',
    required: existing ? existing.required !== false : true,
    threshold: existing?.threshold == null ? '' : String(existing.threshold),
  };

  const dialog = modal.open({
    title: existing ? 'Edit pre-auth row' : 'Add pre-auth row',
    sub: `${esc(contract.contractNo)} — version ${contract.version}`,
    icon: 'verified_user',
    size: 'lg',
    body: bodyHtml(draft),
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="save">${existing ? 'Save row' : 'Add row'}</button>`,
  });

  const el = dialog.el;
  const redraw = () => { el.querySelector('.modal__body').innerHTML = bodyHtml(draft); };

  function showError(message) {
    const box = el.querySelector('#pf-error');
    box.textContent = message;
    box.hidden = false;
    box.scrollIntoView({ block: 'nearest' });
  }

  el.addEventListener('input', (e) => {
    const field = e.target.closest('[name]');
    if (field) draft[field.name] = field.value;
  });

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
      // A row that requires nothing has no amount to sit above.
      if (!draft.required) draft.threshold = '';
      return redraw();
    }
    if (!e.target.closest('[data-act="save"]')) return;

    const problem = problemWith(draft, contract);
    if (problem) return showError(problem);

    const saved = contracts.savePreAuth(contract.id, {
      id: draft.id,
      scopeLevel: draft.scopeLevel,
      scopeValue: draft.scopeValue,
      required: draft.required,
      threshold: draft.threshold,
    });
    dialog.close(saved);
    toast(`${contracts.preAuthLabel(saved)} saved`, 'success');
  });

  return dialog.closed;
}

// --- markup ------------------------------------------------------------------

function bodyHtml(draft) {
  return `
    <dl class="dl dl--narrow">
      <dt><label for="pf-level">Scope level *</label></dt>
      <dd>
        <label class="field">
          <select id="pf-level" name="scopeLevel">
            ${contracts.PREAUTH_LEVELS.map((s) => `<option value="${s}"${s === draft.scopeLevel ? ' selected' : ''}>${s}</option>`).join('')}
          </select>
        </label>
        <p class="t-body-sm">A narrower row beats a wider one: Item, then Category, then Service Group.</p>
      </dd>

      <dt><label for="pf-value">Scope value *</label></dt>
      <dd><label class="field"><select id="pf-value" name="scopeValue">${scopeOptions(draft)}</select></label></dd>

      <dt><label>Pre-auth required *</label></dt>
      <dd>
        <span class="segmented" role="group" aria-label="Pre-auth required">
          <button type="button" data-req="yes" aria-pressed="${draft.required}">Yes</button>
          <button type="button" data-req="no" aria-pressed="${!draft.required}">No</button>
        </span>
        <p class="t-body-sm">${draft.required
          ? 'The payer approves this scope before the service is delivered.'
          : 'This scope goes ahead without approval — and exempts itself from any broader row that requires one.'}</p>
      </dd>

      <dt><label for="pf-threshold">Threshold amount</label></dt>
      <dd>
        <label class="field">
          <span class="icon icon--sm">attach_money</span>
          <input id="pf-threshold" name="threshold" type="number" min="0" step="0.01"
                 value="${esc(draft.threshold)}"${draft.required ? '' : ' disabled'}>
        </label>
        <p class="t-body-sm">${draft.required
          ? 'Approval is needed only above this amount. Leave it empty to require it every time.'
          : 'A row that requires nothing carries no threshold.'}</p>
      </dd>
    </dl>
    <div class="field-error" id="pf-error" hidden></div>`;
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
  if (!draft.scopeValue) return 'Choose the scope value this row covers.';
  if (draft.required && String(draft.threshold).trim() !== '' && !(Number(draft.threshold) > 0)) {
    return 'A threshold has to be greater than zero. Leave it empty to require approval every time.';
  }

  const clash = contracts.preAuthOverlap(contract, {
    id: draft.id,
    scopeLevel: draft.scopeLevel,
    scopeValue: draft.scopeValue,
  });
  if (clash) {
    return `${contracts.preAuthLabel(clash)} already has a pre-auth row — ${
      clash.required ? `required, ${contracts.thresholdLabel(clash).toLowerCase()}` : 'not required'
    }. Edit that row instead, or choose another scope.`;
  }
  return '';
}
