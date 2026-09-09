// Add / edit a policy — one modal, one save. Cancel discards everything, the
// card images included: nothing reaches the repository until Save validates.
//
// Two things happen between a valid form and a write. Warnings are raised and
// confirmed rather than blocking — a plan Pactum holds no contract for is a
// real policy the desk still has to record — and a payer or plan changing on a
// policy claims were filed under asks for a reason first.

import * as policies from '../../../../data/repositories/policies.js';
import * as payers from '../../../../data/repositories/payers.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { compareDates, date, esc, fileSize } from '../../../../shared/format.js';
import { askReason } from './policy-actions.js';

const CARD_TYPES = ['pdf', 'jpg', 'jpeg', 'png'];

/** openPolicyForm(mrn, policyId | null, { readOnly }) -> Promise<policy | undefined>. */
export async function openPolicyForm(mrn, policyId, { readOnly = false } = {}) {
  const policy = policyId ? policies.get(policyId) : null;
  if (policyId && !policy) return undefined;
  if (!policy && !policies.canAddToChain(mrn)) {
    toast('Only three chain positions — suspend or cancel one first', 'warning');
    return undefined;
  }

  const cards = { cardFront: policy?.cardFront || null, cardBack: policy?.cardBack || null };

  const dialog = modal.open({
    title: policy ? `${esc(policies.payerName(policy))} policy` : 'Add policy',
    sub: policy
      ? `${esc(policy.memberId)} · ${esc(policies.planName(policy))} · ${esc(policy.status)}`
      : `${esc(mrn)} · joins the chain at ${policies.priorityLabel(policies.chain(mrn).length + 1)}`,
    icon: policy ? 'contract' : 'add_card',
    size: 'lg',
    body: bodyHtml(policy, cards, readOnly),
    note: readOnly
      ? 'This policy is closed. Its details are shown as they were recorded.'
      : 'Cancel discards every change, the card images included.',
    foot: readOnly
      ? '<button class="btn btn--secondary" data-close>Close</button>'
      : `<button class="btn btn--secondary" data-close>Cancel</button>
         <button class="btn btn--primary" data-act="save">${policy ? 'Save policy' : 'Add policy'}</button>`,
  });

  const el = dialog.el;
  const $ = (sel) => el.querySelector(sel);

  drawPayers(policy);
  drawPlans($('[name="payerId"]').value, policy);
  markHolder();
  if (readOnly) for (const input of el.querySelectorAll('input, select, textarea')) input.disabled = true;

  function drawPayers(current) {
    const active = payers.findActive();
    const stale = current && !active.some((p) => p.id === current.payerId);
    $('[name="payerId"]').innerHTML =
      (stale ? `<option value="${esc(current.payerId)}" selected disabled>${esc(policies.payerName(current))} (inactive)</option>` : '<option value="">Choose a payer</option>') +
      active.map((p) => `<option value="${p.id}"${current?.payerId === p.id ? ' selected' : ''}>${esc(p.nameEn)}</option>`).join('');
  }

  // The plan list is the chosen payer's Active plans. An inactive plan already
  // on the policy stays readable the same way its payer does.
  function drawPlans(payerId, current) {
    const payer = payers.findActive().find((p) => p.id === payerId);
    const plans = payer?.plans || [];
    const keep = current && current.payerId === payerId && !plans.some((pl) => pl.id === current.planId);
    $('[name="planId"]').innerHTML =
      (keep ? `<option value="${esc(current.planId)}" selected disabled>${esc(policies.planName(current))} (inactive)</option>` : '<option value="">Choose a plan</option>') +
      plans.map((pl) => `<option value="${pl.id}"${current?.planId === pl.id ? ' selected' : ''}>${esc(pl.name)} · ${esc(pl.code)}</option>`).join('');
  }

  // The holder row is a dt/dd pair inside the definition grid, so both halves
  // are switched — a wrapper around them would be one grid cell and throw every
  // row below it out of its column.
  function markHolder() {
    const self = $('[name="relationship"]').value === 'Self';
    $('#pf-holder-dt').hidden = self;
    $('#pf-holder-dd').hidden = self;
  }

  function read() {
    const values = {};
    for (const input of el.querySelectorAll('[name]')) {
      if (input.type !== 'file') values[input.name] = input.value.trim();
    }
    return values;
  }

  function clearErrors() {
    for (const box of el.querySelectorAll('.field-error')) {
      box.hidden = true;
      box.textContent = '';
    }
    for (const field of el.querySelectorAll('.field')) field.classList.remove('field--invalid');
  }

  function showErrors(errors) {
    for (const [name, message] of Object.entries(errors)) {
      const box = el.querySelector(`[data-error="${name}"]`);
      if (box) {
        box.textContent = message;
        box.hidden = false;
      }
      el.querySelector(`[name="${name}"]`)?.closest('.field')?.classList.add('field--invalid');
    }
    el.querySelector(`[name="${Object.keys(errors)[0]}"]`)?.focus();
  }

  // --- cards ----------------------------------------------------------------

  function readCard(which) {
    const input = el.querySelector(`[name="${which}"]`);
    const file = input?.files?.[0];
    const box = el.querySelector(`[data-error="${which}"]`);
    if (!file) return '';
    const ext = file.name.split('.').pop().toLowerCase();
    if (!CARD_TYPES.includes(ext)) return `${file.name} is not a PDF, JPG or PNG.`;
    if (file.size > policies.MAX_CARD_BYTES) return `${file.name} is ${fileSize(file.size)}. The limit is 10 MB.`;
    cards[which] = { fileName: file.name, size: file.size };
    box.hidden = true;
    return '';
  }

  function drawCards() {
    for (const which of ['cardFront', 'cardBack']) {
      el.querySelector(`#pf-${which}`).innerHTML = cardChip(which, cards[which]);
    }
  }

  // --- save -----------------------------------------------------------------

  async function save() {
    clearErrors();
    const values = read();
    const errors = validate(values, mrn, policy?.id || null);
    for (const which of ['cardFront', 'cardBack']) {
      const message = readCard(which);
      if (message) errors[which] = message;
    }
    if (Object.keys(errors).length) return showErrors(errors);

    if (!(await confirmWarnings(values, mrn, policy?.id || null))) return;

    // The payer or plan moving on a policy claims were filed under is the edit
    // an auditor comes looking for, so it is asked about rather than saved
    // quietly. A new policy has nothing behind it and never asks.
    let reason = '';
    if (policy?.usedInEncounters && (values.payerId !== policy.payerId || values.planId !== policy.planId)) {
      reason = await askReason({
        title: 'Why is the payer or plan changing?',
        sub: `${policies.payerName(policy)} · ${policies.planName(policy)}`,
        icon: 'fingerprint',
        lede: 'Encounters have already been billed under this policy. The change is recorded with your reason.',
        placeholder: 'Corrected against the card the patient presented today — the group moved to the new plan in July.',
        confirmLabel: 'Save the change',
      });
      if (!reason) return;
    }

    const record = { ...values, holderName: values.relationship === 'Self' ? null : values.holderName, ...cards };
    const saved = policy
      ? policies.update(policy.id, record, { reason })
      : policies.create({ ...record, patientMrn: mrn });
    toast(policy ? 'Policy saved' : `${policies.payerName(saved)} added as ${policies.priorityLabel(saved.priority)}`, 'success');
    dialog.close(saved);
  }

  // --- events ---------------------------------------------------------------

  el.addEventListener('click', (e) => {
    const drop = e.target.closest('[data-drop]');
    if (drop) {
      cards[drop.dataset.drop] = null;
      el.querySelector(`[name="${drop.dataset.drop}"]`).value = '';
      return drawCards();
    }
    if (e.target.closest('[data-act="save"]')) save();
  });

  el.addEventListener('change', (e) => {
    if (e.target.name === 'payerId') return drawPlans(e.target.value, policy);
    if (e.target.name === 'relationship') return markHolder();
    if (e.target.type === 'file') {
      readCard(e.target.name);
      drawCards();
    }
  });

  return dialog.closed;
}

// --- markup -------------------------------------------------------------------

function bodyHtml(policy, cards, readOnly) {
  return `
    <dl class="dl">
      ${row('Payer *', '<select name="payerId"></select>', 'payerId')}
      ${row('Plan *', '<select name="planId"></select>', 'planId')}
      ${row('Member ID *', `<input name="memberId" value="${esc(policy?.memberId || '')}" placeholder="1120078451">`, 'memberId')}
      ${row('Policy no.', `<input name="policyNo" value="${esc(policy?.policyNo || '')}" placeholder="NSSF/TR/44810">`, 'policyNo')}
      ${row('Relationship *', `<select name="relationship">${policies.RELATIONSHIPS
        .map((r) => `<option value="${r}"${(policy?.relationship || 'Self') === r ? ' selected' : ''}>${r}</option>`).join('')}</select>`, 'relationship')}
      <dt id="pf-holder-dt"${(policy?.relationship || 'Self') === 'Self' ? ' hidden' : ''}>Policy holder *</dt>
      <dd id="pf-holder-dd"${(policy?.relationship || 'Self') === 'Self' ? ' hidden' : ''}>
        <label class="field"><input name="holderName" value="${esc(policy?.holderName || '')}" placeholder="Bilal Baalbaki"></label>
        <div class="field-error" data-error="holderName" hidden></div>
      </dd>
      ${row('Valid from *', `<input name="validFrom" type="date" value="${esc(policy?.validFrom || '')}">`, 'validFrom')}
      ${row('Valid to *', `<input name="validTo" type="date" value="${esc(policy?.validTo || '')}">`, 'validTo')}
      <dt>Card front</dt>
      <dd>
        ${readOnly ? '' : '<label class="field"><input type="file" name="cardFront" accept=".pdf,.jpg,.jpeg,.png" aria-label="Card front"></label>'}
        <div id="pf-cardFront">${cardChip('cardFront', cards.cardFront, readOnly)}</div>
        <div class="field-error" data-error="cardFront" hidden></div>
      </dd>
      <dt>Card back</dt>
      <dd>
        ${readOnly ? '' : '<label class="field"><input type="file" name="cardBack" accept=".pdf,.jpg,.jpeg,.png" aria-label="Card back"></label>'}
        <div id="pf-cardBack">${cardChip('cardBack', cards.cardBack, readOnly)}</div>
        <div class="field-error" data-error="cardBack" hidden></div>
      </dd>
    </dl>
    <p class="t-body-sm">PDF, JPG or PNG, up to 10 MB. The demo stores the file details, not the file.</p>`;
}

const row = (label, control, name) => `
  <dt>${label}</dt>
  <dd><label class="field">${control}</label><div class="field-error" data-error="${name}" hidden></div></dd>`;

/**
 * The card as a line with its icon — the demo holds no image to show. Not a
 * badge: the design system's badge is 20px high and an icon inside one spills.
 */
function cardChip(which, card, readOnly = false) {
  if (!card) return '<span class="t-body-sm">None attached</span>';
  return `
    <span class="t-body-sm"><span class="icon icon--sm">${card.fileName.endsWith('.pdf') ? 'picture_as_pdf' : 'image'}</span>
      ${esc(card.fileName)} · ${fileSize(card.size)}</span>
    ${readOnly ? '' : `<button class="btn btn--ghost btn--icon btn--sm" data-drop="${which}" title="Remove this card">
        <span class="icon icon--sm">close</span>
      </button>`}`;
}

// --- validation ---------------------------------------------------------------

/** Returns { field: message } for every invalid field, in the order they read. */
function validate(v, mrn, excludeId) {
  const errors = {};
  if (!v.payerId) errors.payerId = 'Choose the payer this policy is with.';
  if (!v.planId) errors.planId = 'Choose the plan the member is on.';

  if (!v.memberId) errors.memberId = 'Enter the member ID printed on the card.';
  else if (!policies.isMemberIdUnique(v.payerId, v.memberId, excludeId)) {
    errors.memberId = 'Another policy with this payer already uses this member ID.';
  }

  if (!policies.RELATIONSHIPS.includes(v.relationship)) errors.relationship = 'Choose the relationship to the policy holder.';
  if (v.relationship !== 'Self' && !v.holderName) errors.holderName = 'Enter the name on the policy.';

  if (!v.validFrom) errors.validFrom = 'Enter the date the cover starts.';
  if (!v.validTo) errors.validTo = 'Enter the date the cover ends.';
  else if (v.validFrom && compareDates(v.validTo, v.validFrom) <= 0) {
    errors.validTo = 'Valid to must be after valid from.';
  }
  return errors;
}

/**
 * The two warnings a valid policy can still raise. Neither blocks the save —
 * both are things the desk needs to know before it commits, so they are shown
 * once, together, and confirmed.
 */
async function confirmWarnings(v, mrn, excludeId) {
  const warnings = [];
  if (!policies.planHasActiveContract(v.planId, v.validFrom)) {
    warnings.push(`This plan has no active Pactum contract on ${date(v.validFrom)} — eligibility will fail.`);
  }
  const clash = policies.overlaps(mrn, v.payerId, v.validFrom, v.validTo, excludeId);
  if (clash) {
    warnings.push(`Overlaps with policy ${clash.policyNo || clash.memberId} (${policies.payerName(clash)}) valid until ${date(clash.validTo)}.`);
  }
  if (!warnings.length) return true;

  return modal.confirm({
    title: warnings.length === 1 ? 'One thing to check' : 'Two things to check',
    body: esc(warnings.join(' ')),
    confirmLabel: 'Save anyway',
    tone: 'warning',
    icon: 'priority_high',
    note: 'The policy is recorded either way. Neither of these stops registration.',
  });
}
