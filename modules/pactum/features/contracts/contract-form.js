// Add / edit contract — one modal, one save. Nothing reaches the repository
// until every field validates, so Cancel discards the document too.
//
// A new contract is always version 1 and always a Draft: activating it is a
// separate, audited decision (contract-actions.js).

import * as contracts from '../../../../data/repositories/contracts.js';
import * as payers from '../../../../data/repositories/payers.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { date, esc, fileSize } from '../../../../shared/format.js';

const MAX_DOC_BYTES = 10 * 1024 * 1024;
const DOC_EXTENSIONS = ['pdf', 'docx'];

/** openContractForm({ payerId, contractId }) -> Promise<contract | undefined>. */
export async function openContractForm({ payerId, contractId = null }) {
  const contract = contractId ? contracts.get(contractId) : null;
  const payer = payers.get(contract?.payerId || payerId);
  if (!payer) return undefined;

  // Editing keeps a plan that has since been deactivated on the list, checked
  // and labelled — dropping it silently would change the contract behind you.
  const planIds = new Set(contract?.planIds || []);
  const plans = payer.plans.filter((p) => p.status === 'Active' || planIds.has(p.id));

  let attachment = contract?.document ? { ...contract.document } : null;

  const dialog = modal.open({
    title: contract ? `${esc(contract.contractNo)} — version ${contract.version}` : 'Add contract',
    sub: contract
      ? `${esc(payer.nameEn)} · ${esc(contract.status)}`
      : `${esc(payer.nameEn)} · saved as a draft until you activate it`,
    icon: contract ? 'contract' : 'note_add',
    size: 'xl',
    body: bodyHtml(contract, plans),
    note: 'Cancel discards every change, the document included.',
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="save">${contract ? 'Save contract' : 'Create draft'}</button>`,
  });

  const el = dialog.el;
  const $ = (sel) => el.querySelector(sel);

  drawDocument();

  function drawDocument() {
    $('#cf-document').innerHTML = attachment
      ? `<div class="rule-child-row" data-doc>
           <span class="icon">description</span>
           <span>${esc(attachment.fileName)}</span>
           <span class="t-mono-sm">${fileSize(attachment.size)}</span>
           <span class="t-body-sm">attached ${esc(date(attachment.uploadedAt))}</span>
           <span class="spacer"></span>
           <button class="btn btn--ghost btn--icon btn--sm" data-act="remove-doc" title="Remove ${esc(attachment.fileName)}">
             <span class="icon icon--sm">delete</span>
           </button>
         </div>`
      : '<p class="t-body-sm">No document attached. The demo stores the file details, not the file.</p>';
  }

  function clearErrors() {
    for (const box of el.querySelectorAll('.field-error')) {
      box.hidden = true;
      box.textContent = '';
    }
    for (const field of el.querySelectorAll('.field')) field.classList.remove('field--invalid');
  }

  function showError(name, message) {
    const box = el.querySelector(`[data-error="${name}"]`);
    if (!box) return;
    box.textContent = message;
    box.hidden = false;
    el.querySelector(`[name="${name}"]`)?.closest('.field')?.classList.add('field--invalid');
  }

  function read() {
    const values = {};
    for (const input of el.querySelectorAll('[name]')) values[input.name] = input.value.trim();
    return {
      name: values.name,
      contractNo: values.contractNo,
      startDate: values.startDate,
      endDate: values.endDate,
      planIds: [...el.querySelectorAll('[data-plan] input:checked')].map((i) => i.value),
    };
  }

  function save() {
    clearErrors();
    const values = read();
    const errors = validate(values, payer.id, contractId);

    for (const [name, message] of Object.entries(errors)) showError(name, message);
    if (Object.keys(errors).length) {
      el.querySelector(`[name="${Object.keys(errors)[0]}"]`)?.focus();
      return;
    }

    const record = { ...values, payerId: payer.id, document: attachment };
    const saved = contractId ? contracts.update(contractId, record) : contracts.create(record);
    dialog.close(saved);
  }

  function attach() {
    const input = el.querySelector('[name="docFile"]');
    const file = input.files?.[0];
    const box = el.querySelector('[data-error="document"]');
    const fail = (message) => {
      box.textContent = message;
      box.hidden = false;
    };

    box.hidden = true;
    if (!file) return fail('Choose a file to attach.');
    const ext = file.name.split('.').pop().toLowerCase();
    if (!DOC_EXTENSIONS.includes(ext)) return fail(`${file.name} is not a PDF or DOCX file.`);
    if (file.size > MAX_DOC_BYTES) return fail(`${file.name} is ${fileSize(file.size)}. The limit is 10 MB.`);

    attachment = { fileName: file.name, size: file.size, uploadedAt: new Date().toISOString() };
    input.value = '';
    drawDocument();
    toast(`Attached ${file.name}`, 'success');
  }

  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="save"]')) return save();
    if (e.target.closest('[data-act="attach"]')) return attach();
    if (e.target.closest('[data-act="remove-doc"]')) {
      attachment = null;
      drawDocument();
      toast('Document removed', 'success');
    }
  });

  return dialog.closed;
}

// --- markup ------------------------------------------------------------------

function bodyHtml(contract, plans) {
  return `
    <dl class="dl">
      <dt><label for="cf-name">Contract name *</label></dt>
      <dd>
        <label class="field"><input id="cf-name" name="name" autofocus placeholder="Bankers Assurance master agreement"
               value="${esc(contract?.name ?? '')}"></label>
        <div class="field-error" data-error="name" hidden></div>
      </dd>
      <dt><label for="cf-no">Contract no. *</label></dt>
      <dd>
        <label class="field"><input id="cf-no" name="contractNo" placeholder="CT-2026-008"
               value="${esc(contract?.contractNo ?? '')}"></label>
        <div class="field-error" data-error="contractNo" hidden></div>
      </dd>
      <dt><label for="cf-start">Start date *</label></dt>
      <dd>
        <label class="field"><input id="cf-start" name="startDate" type="date" value="${esc(contract?.startDate ?? '')}"></label>
        <div class="field-error" data-error="startDate" hidden></div>
      </dd>
      <dt><label for="cf-end">End date *</label></dt>
      <dd>
        <label class="field"><input id="cf-end" name="endDate" type="date" value="${esc(contract?.endDate ?? '')}"></label>
        <div class="field-error" data-error="endDate" hidden></div>
      </dd>
    </dl>

    <div class="toolbar">
      <span class="t-title-sm">Plans covered *</span>
      <span class="spacer"></span>
      <span class="t-body-sm">Active plans of this payer. A plan sits in one contract at a time.</span>
    </div>
    ${plans.length ? plans.map((p) => planRow(p, contract)).join('') : '<p class="t-body-sm">This payer has no active plans. Add one in Payer Master first.</p>'}
    <div class="field-error" data-error="planIds" hidden></div>

    <div class="toolbar">
      <span class="t-title-sm">Signed document</span>
      <span class="spacer"></span>
      <span class="t-body-sm">PDF or DOCX, up to 10 MB.</span>
    </div>
    <div class="rule-child-row">
      <label class="field"><input type="file" name="docFile" aria-label="Contract document" accept=".pdf,.docx"></label>
      <button class="btn btn--secondary btn--sm" data-act="attach">
        <span class="icon icon--sm">upload_file</span>Attach document
      </button>
    </div>
    <div class="field-error" data-error="document" hidden></div>
    <div id="cf-document"></div>`;
}

function planRow(plan, contract) {
  const checked = (contract?.planIds || []).includes(plan.id);
  const inactive = plan.status !== 'Active';
  return `
    <div class="rule-child-row" data-plan="${esc(plan.id)}">
      <label><input type="checkbox" value="${esc(plan.id)}"${checked ? ' checked' : ''}> ${esc(plan.name)}</label>
      <span class="t-mono-sm">${esc(plan.code)}</span>
      ${inactive
        ? '<span class="badge badge--warning"><span class="dot"></span>Inactive plan, still linked</span>'
        : ''}
    </div>`;
}

// --- validation --------------------------------------------------------------

/** Returns { field: message } for every invalid field, in form order. */
function validate(v, payerId, excludeId) {
  const errors = {};

  if (v.name.length < 2) errors.name = 'Enter the contract name.';

  if (!v.contractNo) errors.contractNo = 'Enter the contract number.';
  else if (!contracts.isContractNoUnique(payerId, v.contractNo, excludeId)) {
    errors.contractNo = 'This payer already has a contract with that number.';
  }

  if (!v.startDate) errors.startDate = 'Choose the start date.';
  if (!v.endDate) errors.endDate = 'Choose the end date.';
  else if (v.startDate && v.endDate <= v.startDate) {
    errors.endDate = 'The end date must be after the start date.';
  }

  if (!v.planIds.length) errors.planIds = 'Choose at least one plan.';
  else if (!errors.startDate && !errors.endDate) {
    const clash = contracts.planOverlap(v.planIds, v.startDate, v.endDate, excludeId);
    if (clash) {
      errors.planIds = `Plan ${clash.planName} is already covered by ${clash.contract.contractNo} (${clash.contract.status}) until ${date(clash.contract.endDate)}.`;
    }
  }

  return errors;
}
