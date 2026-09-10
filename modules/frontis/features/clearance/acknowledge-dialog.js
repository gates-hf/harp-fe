// Record that the patient was shown the estimate and accepted it.
//
// The dialog does one thing and writes one row. It does not price anything and
// it does not change the estimate: the quotation was frozen when it was issued,
// and what is captured here is who put their name to it, how, and when.
//
// The estimate selector usually has exactly one option — the quotation the
// clearance engine already reads this visit against — but every live estimate
// for the patient is offered, because a desk that quoted twice has to be able
// to say which one was signed.

import * as clearance from '../../../../data/repositories/clearance.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import * as estimates from '../../../../data/repositories/estimates.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as acknowledgments from '../../../../data/repositories/acknowledgments.js';
import { estimateFor } from '../../../../data/engines/clearance-engine.js';
import { date, esc, fileSize, usd } from '../../../../shared/format.js';
import { open } from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';

/** Ten megabytes, the ceiling every upload in the platform is held to. */
const MAX_BYTES = 10 * 1024 * 1024;

export async function askAcknowledge(no) {
  const enc = encounters.get(no);
  if (!enc) return null;

  const choices = options(enc);
  if (!choices.length) return void noEstimate(enc);

  const preferred = estimateFor(enc)?.no || choices[0].no;
  const patient = patients.get(enc.patientMrn);

  const dialog = open({
    title: 'Record acknowledgment',
    sub: `${enc.no} — ${patient?.nameEn || enc.patientMrn}`,
    icon: 'draw',
    size: 'md',
    body: bodyHtml(choices, preferred, patient),
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-save>Save acknowledgment</button>`,
  });

  const el = dialog.el;
  const $ = (sel) => el.querySelector(sel);
  const byKind = $('[name="by"]');
  const byName = $('[name="byName"]');
  // Both halves of the row are switched, never a wrapper around them: a div
  // inside a .dl is one cell of the grid and throws every row below it out of
  // its column — the call the policy form already learned.
  const guardianRow = [$('#ack-guardian-label'), $('#ack-guardian')];

  // A patient signing for themselves is named by the register, so the field is
  // shown only when somebody else is signing.
  const syncBy = () => {
    const guardian = byKind.value === 'Guardian';
    for (const half of guardianRow) half.hidden = !guardian;
    if (!guardian) byName.value = '';
  };
  byKind.addEventListener('change', syncBy);
  syncBy();

  $('[name="estimateNo"]').addEventListener('change', () => drawSummary(el, choices));
  drawSummary(el, choices);

  el.querySelector('[data-save]').addEventListener('click', () => {
    const values = read(el);
    const error = validate(values, el);
    if (error) return void showError(el, error);

    const row = acknowledgments.create({
      encounterNo: enc.no,
      estimateNo: values.estimateNo,
      by: values.by,
      byName: values.by === 'Guardian' ? values.byName : (patient?.nameEn || enc.patientMrn),
      method: values.method,
      document: values.document,
      note: values.note,
    });
    // The stamp is recomputed by the store subscription, so the checklist behind
    // the dialog has already moved by the time it closes.
    clearance.refreshClearance(enc.no);
    toast(`${row.estimateNo} acknowledged`);
    dialog.close('saved');
  });

  return dialog.closed;
}

/** Live quotations for this patient, plus anything already hung off the visit. */
function options(enc) {
  const found = new Map();
  for (const row of estimates.byEncounter(enc.no)) if (row.result) found.set(row.no, row);
  for (const row of estimates.validForClearance(enc.patientMrn)) found.set(row.no, row);
  return [...found.values()].sort((a, b) => String(b.issuedAt).localeCompare(String(a.issuedAt)));
}

function bodyHtml(choices, preferred, patient) {
  return `
    <dl class="dl dl--narrow">
      <dt><label for="ack-estimate">Estimate</label></dt>
      <dd>
        <label class="field">
          <span class="icon icon--sm">calculate</span>
          <select id="ack-estimate" name="estimateNo">
            ${choices.map((row) => `
              <option value="${esc(row.no)}"${row.no === preferred ? ' selected' : ''}>
                ${esc(row.no)} — ${esc(estimates.servicesLabel(row))}
              </option>`).join('')}
          </select>
        </label>
        <div id="ack-summary" class="t-body-sm"></div>
      </dd>

      <dt><label for="ack-by">Acknowledged by *</label></dt>
      <dd>
        <label class="field">
          <span class="icon icon--sm">person</span>
          <select id="ack-by" name="by">
            ${acknowledgments.BY_KINDS.map((k) => `<option value="${esc(k)}">${esc(k)}</option>`).join('')}
          </select>
        </label>
        <span class="t-body-sm">${esc(patient?.nameEn || '')} signs as the patient; a guardian signs for a
          child or a dependant and is named below.</span>
      </dd>

      <dt id="ack-guardian-label" hidden><label for="ack-by-name">Guardian *</label></dt>
      <dd id="ack-guardian" hidden>
        <label class="field">
          <span class="icon icon--sm">badge</span>
          <input type="text" id="ack-by-name" name="byName"
                 placeholder="Full name of the person signing" aria-label="Signed by">
        </label>
      </dd>

      <dt><label for="ack-method">Method *</label></dt>
      <dd>
        <label class="field">
          <span class="icon icon--sm">how_to_reg</span>
          <select id="ack-method" name="method">
            ${acknowledgments.METHODS.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}
          </select>
        </label>
      </dd>

      <dt><label for="ack-file">Signed copy</label></dt>
      <dd>
        <label class="field">
          <input type="file" id="ack-file" name="file" accept=".pdf,.jpg,.jpeg,.png" aria-label="Signed copy">
        </label>
        <span class="t-body-sm">PDF, JPG or PNG, up to 10 MB. The demo keeps the name and the size, not the file.</span>
      </dd>

      <dt><label for="ack-note">Note</label></dt>
      <dd>
        <label class="field field--area">
          <textarea id="ack-note" name="note" rows="2"
                    placeholder="Anything the desk should remember about this signature"></textarea>
        </label>
      </dd>
    </dl>
    <div id="ack-error"></div>`;
}

/** What the patient is signing for, under the picker. */
function drawSummary(el, choices) {
  const chosen = choices.find((row) => row.no === el.querySelector('[name="estimateNo"]').value);
  const box = el.querySelector('#ack-summary');
  if (!chosen) return void (box.textContent = '');
  const share = chosen.result?.totals?.patientShare || 0;
  box.textContent = `Issued ${date(chosen.issuedAt)}, valid to ${date(chosen.validUntil)}`
    + ` — patient share ${usd(share)}.`;
}

function read(el) {
  const value = (name) => el.querySelector(`[name="${name}"]`)?.value || '';
  const file = el.querySelector('[name="file"]')?.files?.[0] || null;
  return {
    estimateNo: value('estimateNo'),
    by: value('by'),
    byName: value('byName').trim(),
    method: value('method'),
    note: value('note').trim(),
    document: file ? { fileName: file.name, size: file.size } : null,
    file,
  };
}

/**
 * One error box under the body rather than one per field: the guardian name is
 * the only conditional field, and a dialog this short reads better answering in
 * one place — the call the methodology modal already made.
 */
function validate(values) {
  if (!values.estimateNo) return 'Choose the estimate the patient signed for.';
  if (values.by === 'Guardian' && !values.byName) return 'Name the guardian who signed.';
  if (!values.method) return 'Say how the acknowledgment was taken.';
  if (values.file && values.file.size > MAX_BYTES) {
    return `The signed copy is ${fileSize(values.file.size)}. The limit is 10 MB.`;
  }
  return '';
}

function showError(el, message) {
  el.querySelector('#ack-error').innerHTML = `
    <div class="alert alert--critical">
      <span class="icon">error</span>
      <div>${esc(message)}</div>
    </div>`;
}

/** Nothing to sign for is not a validation failure — it is the previous item. */
function noEstimate(enc) {
  open({
    title: 'No estimate to acknowledge',
    sub: enc.no,
    icon: 'calculate',
    tone: 'warning',
    size: 'sm',
    body: `<p class="modal__lede">There is no issued, in-date estimate for this visit, so there is nothing for
      the patient to put their name to. Issue one first and the acknowledgment follows from it.</p>`,
    foot: `
      <button class="btn btn--secondary" data-close>Close</button>
      <a class="btn btn--primary"
         href="#/frontis/estimates/new?mrn=${esc(enc.patientMrn)}&encounterNo=${esc(enc.no)}"
         data-close>Create estimate</a>`,
  });
}
