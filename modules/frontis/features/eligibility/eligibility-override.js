// The override dialog. A supervisor answers beside the system, never in place
// of it: `applyOverride` stores the decision alongside `systemResult`, and both
// are drawn wherever the snapshot is read.
//
// Nothing here gates on a role — the screen decides who may open it, the way
// every other dialog in Frontis works. It returns true when the repository was
// written to, so the caller redraws.

import * as eligibility from '../../../../data/repositories/eligibility.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { esc } from '../../../../shared/format.js';

/** The results a supervisor may land on. Self-Pay is a decision, not a verdict. */
const RESULTS = ['Eligible', 'Eligible with Conditions', 'Not Eligible'];

export async function askOverride(ref) {
  const row = eligibility.get(ref);
  if (!row || eligibility.isOverridden(row)) return false;

  const dialog = modal.open({
    title: 'Override eligibility result',
    sub: `${row.ref} — the system answered ${row.systemResult}`,
    icon: 'flag',
    tone: 'warning',
    size: 'md',
    body: bodyHtml(row),
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="save">Record override</button>`,
    note: 'The system result is kept and shown beside yours. Nothing about the check is rewritten.',
  });

  const el = dialog.el;
  const $ = (sel) => el.querySelector(sel);
  const reasonSel = $('#ov-reason');
  const errorBox = $('#ov-error');

  /** A payer confirmation names something outside the platform, so it needs a ref. */
  function syncReason() {
    const needsRef = eligibility.PAYER_REASONS.includes(reasonSel.value);
    for (const id of ['ov-ref-row', 'ov-contact-row', 'ov-ref-label', 'ov-contact-label']) {
      const node = $(`#${id}`);
      if (node) node.hidden = !needsRef;
    }
    return needsRef;
  }

  reasonSel.addEventListener('change', syncReason);
  syncReason();

  el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="save"]')) return;
    const needsRef = eligibility.PAYER_REASONS.includes(reasonSel.value);
    const values = {
      result: $('#ov-result').value,
      reason: reasonSel.value,
      payerRef: $('#ov-ref').value.trim(),
      contact: $('#ov-contact').value.trim(),
      note: $('#ov-note').value.trim(),
      by: currentRole().name,
    };

    const errors = [];
    if (!values.result) errors.push('Choose the result this check should carry.');
    if (values.result === row.systemResult) errors.push('That is the answer the system already gave — an override has to change it.');
    if (!values.reason) errors.push('Choose the reason for the override.');
    if (needsRef && !values.payerRef) errors.push('A payer confirmation needs the reference the payer gave.');
    if (needsRef && !values.contact) errors.push('Name who at the payer confirmed it.');

    // A plain wrapper, not the alert itself: `.alert` sets display:flex, which
    // outranks the hidden attribute and would leave an empty box on screen.
    errorBox.innerHTML = errors.length
      ? `<div class="alert alert--critical"><span class="icon">error</span>
           <div>${errors.map((x) => esc(x)).join('<br>')}</div></div>`
      : '';
    if (errors.length) return;

    eligibility.applyOverride(row.ref, values);
    toast(`${row.ref} overridden to ${values.result}`, 'success');
    dialog.close(true);
  });

  return Boolean(await dialog.closed);
}

function bodyHtml(row) {
  return `
    <dl class="dl dl--narrow">
      <dt><label for="ov-result">Result</label></dt>
      <dd>
        <label class="field">
          <select id="ov-result">
            <option value="">Choose a result</option>
            ${RESULTS.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}
          </select>
        </label>
      </dd>
      <dt><label for="ov-reason">Reason</label></dt>
      <dd>
        <label class="field">
          <select id="ov-reason">
            <option value="">Choose a reason</option>
            ${eligibility.OVERRIDE_REASONS.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}
          </select>
        </label>
      </dd>
      <dt id="ov-ref-label"><label for="ov-ref">Payer reference</label></dt>
      <dd id="ov-ref-row"><label class="field"><input id="ov-ref" type="text" placeholder="4471"></label></dd>
      <dt id="ov-contact-label"><label for="ov-contact">Contact</label></dt>
      <dd id="ov-contact-row">
        <label class="field"><input id="ov-contact" type="text" placeholder="Rania Chidiac, claims desk"></label>
      </dd>
      <dt><label for="ov-note">Note</label></dt>
      <dd>
        <label class="field field--area">
          <textarea id="ov-note" rows="3" placeholder="What the payer said, and anything the biller will need."></textarea>
        </label>
      </dd>
    </dl>
    <div id="ov-error"></div>`;
}
