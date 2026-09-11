// The accountability dialogs: record the person's response, record that the
// window closed with nothing, decide (the decider is never the analyst — the
// form says so before the repository refuses), file the appeal, review it
// (the reviewer is senior to the decider; a Modified outcome names the
// decision it becomes), send the recommendation to HR, capture HR's answer,
// close. Each validates, writes through the repository and says what it did;
// the page redraws on the commit.

import * as accountabilityCases from '../../../../data/repositories/accountability-cases.js';
import { staffByName, staffLevel, levelLabel } from '../../../../data/seed/staff.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { esc, usd } from '../../../../shared/format.js';

const errorBox = (el, problems) => {
  el.innerHTML = problems.length
    ? `<div class="alert alert--critical"><span class="icon">error</span><div>${problems.map(esc).join('<br>')}</div></div>` : '';
};

const decisionOptions = (selected = '') => accountabilityCases.DECISION_TYPES.map((t) => `<option value="${t}"${t === selected ? ' selected' : ''}>${esc(accountabilityCases.decisionLabel(t))}</option>`).join('');

/** The deduction pair, shown only for a recommendation. */
const deductionFields = (prefix, deduction = null) => `
  <div id="${prefix}-deduction"${deduction ? '' : ' hidden'}>
    <div class="toolbar">
      <label class="field"><span class="icon icon--sm">attach_money</span><input type="number" id="${prefix}-amount" min="0" step="0.01" placeholder="Amount recommended" aria-label="Amount" value="${deduction ? esc(String(deduction.amount)) : ''}"></label>
      <label class="field field--grow"><span class="icon icon--sm">notes</span><input type="text" id="${prefix}-basis" placeholder="Basis — the policy and the share it allows" aria-label="Basis" maxlength="200" value="${esc(deduction?.basis || '')}"></label>
    </div>
    <p class="t-body-sm">A recommendation only: it goes to HR with a reference and HR’s answer is captured as a note. Nothing is posted to payroll from here.</p>
  </div>`;

export async function openResponseDialog(id) {
  const row = accountabilityCases.get(id);
  if (!row) return undefined;
  const dialog = modal.open({
    title: `Record the response — ${row.id}`,
    sub: 'What the person said, as received',
    icon: 'forum',
    size: 'md',
    body: `
      <label class="field field--area"><span class="icon icon--sm">notes</span><textarea id="rs-text" rows="4" placeholder="The person’s account, in their words" aria-label="Response" maxlength="1200"></textarea></label>
      <label class="field"><span class="icon icon--sm">attach_file</span><input type="text" id="rs-file" placeholder="Attachment file name (optional)" aria-label="Attachment" maxlength="120"></label>
      <div id="rs-error"></div>`,
    foot: `<button class="btn btn--secondary" data-close>Cancel</button><button class="btn btn--primary" id="rs-save">Record response</button>`,
  });
  dialog.el.querySelector('#rs-save').addEventListener('click', () => {
    const file = dialog.el.querySelector('#rs-file').value.trim();
    const r = accountabilityCases.recordResponse(id, { text: dialog.el.querySelector('#rs-text').value, attachments: file ? [{ fileName: file, size: 0 }] : [] });
    if (r?.error) return errorBox(dialog.el.querySelector('#rs-error'), [r.error]);
    toast(`${id} — response recorded`);
    return dialog.close(r);
  });
  return dialog.closed;
}

export async function confirmNoResponse(id) {
  const row = accountabilityCases.get(id);
  if (!row) return undefined;
  const w = accountabilityCases.windowOf(row);
  const ok = await modal.confirm({
    title: `Record no response — ${row.id}`,
    icon: 'timer_off',
    confirmLabel: 'Record no response',
    body: `<p class="modal__lede">The ${row.employeeResponse.windowDays}-day window closed ${esc(w.closes)} with nothing received. Recording that is what lets a decision follow; a response recorded later still stands on the trail.</p>`,
  });
  if (!ok) return undefined;
  const r = accountabilityCases.recordNoResponse(id);
  if (r?.error) { toast(r.error, 'warning'); return undefined; }
  toast(`${id} — no response recorded`);
  return r;
}

export async function openDecisionDialog(id) {
  const row = accountabilityCases.get(id);
  if (!row) return undefined;
  const blocker = accountabilityCases.decideBlocker(row);
  if (blocker) { toast(blocker, 'warning'); return undefined; }
  const dialog = modal.open({
    title: `Decide — ${row.id}`,
    sub: `${currentRole().name} decides; the analyst never does`,
    icon: 'gavel',
    size: 'md',
    body: `
      <label class="field"><span class="icon icon--sm">gavel</span><select id="dc-type" aria-label="Decision">${decisionOptions('coaching')}</select></label>
      <p class="t-body-sm" id="dc-hint"></p>
      ${deductionFields('dc')}
      <label class="field field--area"><span class="icon icon--sm">notes</span><textarea id="dc-why" rows="3" placeholder="Rationale — what was weighed" aria-label="Rationale" maxlength="600"></textarea></label>
      <div id="dc-error"></div>`,
    foot: `<button class="btn btn--secondary" data-close>Cancel</button><button class="btn btn--primary" id="dc-save">Record decision</button>`,
  });
  const $ = (sel) => dialog.el.querySelector(sel);
  const HINT = {
    noAction: 'The finding stands on the case; nothing follows for the person.',
    coaching: 'A conversation and a note — the lightest answer.',
    warning: 'A formal warning on the record.',
    deductionRecommendation: 'A deduction is recommended to HR — never applied here.',
  };
  const paint = () => { const t = $('#dc-type').value; $('#dc-hint').textContent = HINT[t]; $('#dc-deduction').hidden = t !== 'deductionRecommendation'; };
  $('#dc-type').addEventListener('change', paint);
  paint();
  $('#dc-save').addEventListener('click', () => {
    const type = $('#dc-type').value;
    const r = accountabilityCases.decide(id, { type, rationale: $('#dc-why').value, deduction: type === 'deductionRecommendation' ? { amount: $('#dc-amount').value, basis: $('#dc-basis').value } : null });
    if (r?.error) return errorBox($('#dc-error'), [r.error]);
    toast(`${id} — ${accountabilityCases.decisionLabel(type).toLowerCase()} recorded`);
    return dialog.close(r);
  });
  return dialog.closed;
}

export async function openAppealDialog(id) {
  const row = accountabilityCases.get(id);
  if (!row) return undefined;
  const dialog = modal.open({
    title: `File an appeal — ${row.id}`,
    sub: `Against: ${accountabilityCases.decisionLabel(row.decision?.type)}`,
    icon: 'reply',
    size: 'md',
    body: `
      <p class="modal__lede">Reviewed by somebody senior to ${esc(row.decision?.decidedBy || 'the decider')} (${esc(levelLabel(staffLevel(staffByName(row.decision?.decidedBy)?.id)))}). The grounds are recorded as received.</p>
      <label class="field field--area"><span class="icon icon--sm">notes</span><textarea id="ap-text" rows="4" placeholder="The grounds of the appeal" aria-label="Grounds" maxlength="1200"></textarea></label>
      <div id="ap-error"></div>`,
    foot: `<button class="btn btn--secondary" data-close>Cancel</button><button class="btn btn--primary" id="ap-save">File appeal</button>`,
  });
  dialog.el.querySelector('#ap-save').addEventListener('click', () => {
    const r = accountabilityCases.fileAppeal(id, { text: dialog.el.querySelector('#ap-text').value });
    if (r?.error) return errorBox(dialog.el.querySelector('#ap-error'), [r.error]);
    toast(`${id} — appeal filed`);
    return dialog.close(r);
  });
  return dialog.closed;
}

export async function openReviewDialog(id) {
  const row = accountabilityCases.get(id);
  if (!row) return undefined;
  const blocker = accountabilityCases.reviewBlocker(row);
  if (blocker) { toast(blocker, 'warning'); return undefined; }
  const dialog = modal.open({
    title: `Review the appeal — ${row.id}`,
    sub: `${currentRole().name} (${levelLabel(staffLevel(currentRole().id))}) reviews a decision by ${row.decision?.decidedBy}`,
    icon: 'balance',
    size: 'md',
    body: `
      <div class="alert alert--info"><span class="icon">reply</span><div><div class="title">Grounds</div>${esc(row.appeal?.text || '')}</div></div>
      <div class="toolbar">
        <span class="t-body-sm">Outcome</span>
        <span class="segmented" role="group" aria-label="Outcome">
          ${accountabilityCases.APPEAL_OUTCOMES.map((o) => `<button type="button" data-outcome="${o}" aria-pressed="${o === 'Upheld'}" title="${esc(o === 'Upheld' ? 'The decision stands' : o === 'Modified' ? 'The decision changes — say to what' : 'The decision falls; No action is recorded')}">${esc(o)}</button>`).join('')}
        </span>
      </div>
      <div id="rv-modified" hidden>
        <label class="field"><span class="icon icon--sm">gavel</span><select id="rv-type" aria-label="Becomes">${decisionOptions(row.decision?.type)}</select></label>
        ${deductionFields('rv', row.decision?.deduction)}
      </div>
      <label class="field field--area"><span class="icon icon--sm">notes</span><textarea id="rv-why" rows="3" placeholder="Rationale" aria-label="Rationale" maxlength="600"></textarea></label>
      <div id="rv-error"></div>`,
    foot: `<button class="btn btn--secondary" data-close>Cancel</button><button class="btn btn--primary" id="rv-save">Record review</button>`,
  });
  const $ = (sel) => dialog.el.querySelector(sel);
  let outcome = 'Upheld';
  const paint = () => { $('#rv-modified').hidden = outcome !== 'Modified'; $('#rv-deduction').hidden = $('#rv-type').value !== 'deductionRecommendation'; };
  dialog.el.addEventListener('click', (e) => { const b = e.target.closest('[data-outcome]'); if (!b) return; outcome = b.dataset.outcome; for (const x of dialog.el.querySelectorAll('[data-outcome]')) x.setAttribute('aria-pressed', String(x === b)); paint(); });
  $('#rv-type').addEventListener('change', paint);
  paint();
  $('#rv-save').addEventListener('click', () => {
    const type = $('#rv-type').value;
    const modified = outcome === 'Modified' ? { type, deduction: type === 'deductionRecommendation' ? { amount: $('#rv-amount').value, basis: $('#rv-basis').value } : null } : null;
    const r = accountabilityCases.reviewAppeal(id, { outcome, rationale: $('#rv-why').value, modified });
    if (r?.error) return errorBox($('#rv-error'), [r.error]);
    toast(`${id} — appeal ${outcome.toLowerCase()}`);
    return dialog.close(r);
  });
  return dialog.closed;
}

export async function openHrDialog(id, kind) {
  const row = accountabilityCases.get(id);
  if (!row) return undefined;
  const send = kind === 'send';
  const dialog = modal.open({
    title: send ? `Send to HR — ${row.id}` : `Capture HR’s outcome — ${row.id}`,
    sub: `${usd(row.decision?.deduction?.amount)} recommended — ${row.decision?.deduction?.basis || ''}`,
    icon: 'account_balance',
    size: 'sm',
    body: send ? `
      <p class="modal__lede">The recommendation leaves with a reference; HR decides whether and how it is applied.</p>
      <label class="field"><span class="icon icon--sm">tag</span><input type="text" id="hr-ref" placeholder="HR reference" aria-label="HR reference" maxlength="60"></label>
      <div id="hr-error"></div>` : `
      <p class="modal__lede">What HR decided, as a note — payroll is theirs.</p>
      <label class="field field--area"><span class="icon icon--sm">notes</span><textarea id="hr-outcome" rows="3" placeholder="HR’s answer" aria-label="HR outcome" maxlength="400"></textarea></label>
      <label class="field"><span class="icon icon--sm">tag</span><input type="text" id="hr-ref" placeholder="HR reference (optional)" aria-label="HR reference" maxlength="60" value="${esc(row.deductionTracking?.sentRef || '')}"></label>
      <div id="hr-error"></div>`,
    foot: `<button class="btn btn--secondary" data-close>Cancel</button><button class="btn btn--primary" id="hr-save">${send ? 'Send to HR' : 'Capture outcome'}</button>`,
  });
  dialog.el.querySelector('#hr-save').addEventListener('click', () => {
    const ref = dialog.el.querySelector('#hr-ref').value;
    const r = send ? accountabilityCases.sendToHr(id, { sentRef: ref }) : accountabilityCases.captureHrOutcome(id, { hrOutcome: dialog.el.querySelector('#hr-outcome').value, hrRef: ref });
    if (r?.error) return errorBox(dialog.el.querySelector('#hr-error'), [r.error]);
    toast(send ? `${id} — sent to HR` : `${id} — HR outcome captured`);
    return dialog.close(r);
  });
  return dialog.closed;
}

export async function openCloseDialog(id) {
  const row = accountabilityCases.get(id);
  if (!row) return undefined;
  const blocker = accountabilityCases.closeBlocker(row);
  if (blocker) { toast(blocker, 'warning'); return undefined; }
  const dialog = modal.open({
    title: `Close ${row.id}`, icon: 'lock', size: 'sm',
    body: `<p class="modal__lede">${esc(accountabilityCases.decisionLabel(row.decision?.type))}${row.appeal?.outcome ? ` · appeal ${esc(row.appeal.outcome.toLowerCase())}` : ''}. A closed case is read-only.</p>
      <label class="field field--area"><span class="icon icon--sm">notes</span><textarea id="cl-note" rows="2" placeholder="Closing note (optional)" aria-label="Closing note" maxlength="300"></textarea></label>
      <div id="cl-error"></div>`,
    foot: `<button class="btn btn--secondary" data-close>Cancel</button><button class="btn btn--primary" id="cl-save">Close case</button>`,
  });
  dialog.el.querySelector('#cl-save').addEventListener('click', () => {
    const r = accountabilityCases.close(id, { note: dialog.el.querySelector('#cl-note').value });
    if (r?.error) return errorBox(dialog.el.querySelector('#cl-error'), [r.error]);
    toast(`${id} closed`);
    return dialog.close(r);
  });
  return dialog.closed;
}
