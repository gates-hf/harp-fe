// Add or edit one documentation-required row. Scope level picks what the row
// covers, the document types say what the payer wants attached for it, and an
// optional threshold narrows the row to lines worth more than it. Saving goes
// through the repository, which writes the audit diff.
//
// It is referral-required-form.js with a list where the toggle was: a payer
// asks for documents by type, and one row may ask for several.

import * as contracts from '../../../../data/repositories/contracts.js';
import * as cdm from '../../../../data/repositories/cdm.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { esc } from '../../../../shared/format.js';
import { optionsHtml } from './fee-schedule.js';

/** openDocumentationForm({ contractId, rowId, scopeLevel }) -> Promise<row|undefined> */
export async function openDocumentationForm({ contractId, rowId = null, scopeLevel = '' }) {
  const contract = contracts.get(contractId);
  if (!contract) return undefined;
  const existing = contracts.documentationRows(contract).find((r) => r.id === rowId) || null;

  const draft = {
    id: existing?.id || null,
    scopeLevel: existing?.scopeLevel || scopeLevel || 'Category',
    scopeValue: existing?.scopeValue ?? '',
    docTypes: [...(existing?.docTypes || [])],
    thresholdAmount: existing?.thresholdAmount ?? '',
  };

  const dialog = modal.open({
    title: existing ? 'Edit documentation rule' : 'Add documentation rule',
    sub: `${esc(contract.contractNo)} — version ${contract.version}`,
    icon: 'description',
    size: 'lg',
    body: bodyHtml(draft),
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="save">${existing ? 'Save rule' : 'Add rule'}</button>`,
  });

  const el = dialog.el;
  const redraw = () => { el.querySelector('.modal__body').innerHTML = bodyHtml(draft); };

  function showError(message) {
    const box = el.querySelector('#dr-error');
    box.textContent = message;
    box.hidden = false;
    box.scrollIntoView({ block: 'nearest' });
  }

  el.addEventListener('change', (e) => {
    const doc = e.target.closest('[data-doc]');
    if (doc) {
      const type = doc.dataset.doc;
      draft.docTypes = doc.checked
        ? [...new Set([...draft.docTypes, type])]
        : draft.docTypes.filter((t) => t !== type);
      return;
    }
    const field = e.target.closest('[name]');
    if (!field) return;
    draft[field.name] = field.value;
    // The level changes what the value picker offers, so the value starts over.
    if (field.name === 'scopeLevel') {
      draft.scopeValue = '';
      redraw();
    }
  });

  el.addEventListener('input', (e) => {
    if (e.target.name === 'thresholdAmount') draft.thresholdAmount = e.target.value;
  });

  el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="save"]')) return;
    const problem = problemWith(draft, contract);
    if (problem) return showError(problem);
    const saved = contracts.saveDocumentationRequired(contract.id, draft);
    dialog.close(saved);
    toast(`${contracts.documentationLabel(saved)} saved`, 'success');
  });

  return dialog.closed;
}

// --- markup ------------------------------------------------------------------

function bodyHtml(draft) {
  const blanket = draft.scopeLevel === 'Contract';
  return `
    <dl class="dl dl--narrow">
      <dt><label for="dr-level">Scope level *</label></dt>
      <dd>
        <label class="field">
          <select id="dr-level" name="scopeLevel">
            ${contracts.DOC_LEVELS.map((s) => `<option value="${s}"${s === draft.scopeLevel ? ' selected' : ''}>${s}</option>`).join('')}
          </select>
        </label>
        <p class="t-body-sm">Rows add up: every row whose scope covers a line asks for its documents, and a Contract
          row asks on every claim.</p>
      </dd>

      ${blanket ? '' : `
        <dt><label for="dr-value">Scope value *</label></dt>
        <dd><label class="field"><select id="dr-value" name="scopeValue">${scopeOptions(draft)}</select></label></dd>`}

      <dt>Documents required *</dt>
      <dd>
        ${contracts.DOC_TYPES.map((t) => `
          <label class="rule-child-row">
            <input type="checkbox" data-doc="${esc(t)}"${draft.docTypes.includes(t) ? ' checked' : ''}>
            <span>${esc(t)}</span>
          </label>`).join('')}
      </dd>

      <dt><label for="dr-threshold">Threshold</label></dt>
      <dd>
        <div class="toolbar">
          <label class="field">
            <span class="icon icon--sm">attach_money</span>
            <input id="dr-threshold" name="thresholdAmount" type="number" min="0" step="0.01"
                   value="${esc(draft.thresholdAmount)}" placeholder="Always">
          </label>
        </div>
        <p class="t-body-sm">${blanket
          ? 'Blank asks on every claim; an amount asks only on claims whose payer share is above it.'
          : 'Blank asks on every line in scope; an amount asks only on lines allowed above it.'}</p>
      </dd>
    </dl>
    <div class="field-error" id="dr-error" hidden></div>`;
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
  if (draft.scopeLevel !== 'Contract' && !draft.scopeValue) return 'Choose the scope value this rule covers.';
  if (!draft.docTypes.length) return 'Tick at least one document type the payer wants.';
  if (String(draft.thresholdAmount).trim() !== '' && !(Number(draft.thresholdAmount) >= 0)) {
    return 'The threshold has to be an amount, or blank for always.';
  }
  const clash = contracts.documentationOverlap(contract, {
    id: draft.id,
    scopeLevel: draft.scopeLevel,
    scopeValue: draft.scopeLevel === 'Contract' ? null : draft.scopeValue,
  });
  if (clash) {
    return `${contracts.documentationLabel(clash)} already has a documentation rule — ${
      (clash.docTypes || []).join(', ')}. Edit that rule instead, or choose another scope.`;
  }
  return '';
}
