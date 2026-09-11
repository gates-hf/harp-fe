// The appeal case's header actions and their dialogs: send for review,
// approve or return (a reviewer who is not the preparer, at the tier the
// amount needs), generate the package, record the submission (late past the
// deadline only with the CMO's override and a reason), withdraw before
// submission, and raise a second level after a loss. Each validates, writes
// through data/repositories/appeal-cases.js and says what it did; the page
// redraws on the commit. A button the role cannot press is disabled with the
// repository's own refusal in its tooltip, so the two never disagree.

import * as appealCases from '../../../../data/repositories/appeal-cases.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { date, esc, todayIso, usd } from '../../../../shared/format.js';

const btn = (act, label, icon, { tone = 'secondary', disabled = '', title = '' } = {}) =>
  `<button class="btn btn--${tone} btn--sm" data-act="${act}"${disabled ? ' disabled' : ''} title="${esc(title || label)}"><span class="icon icon--sm">${icon}</span>${esc(label)}</button>`;

export function actionsHtml(row, role = currentRole()) {
  const out = [];
  if (appealCases.isEditable(row)) {
    const why = appealCases.reviewBlocker(row);
    out.push(btn('withdraw', 'Withdraw', 'undo', { title: 'Withdraw the appeal — the denial goes back to the worklist for re-triage' }));
    out.push(btn('review', 'Send for review', 'rate_review', { tone: 'primary', disabled: why, title: why || `Send to a ${appealCases.tierFor(row.disputedAmount)} reviewer` }));
  } else if (row.status === 'InReview') {
    const check = appealCases.canReview(row, role);
    out.push(btn('withdraw', 'Withdraw', 'undo', { title: 'Withdraw the appeal — the denial goes back to the worklist' }));
    out.push(btn('return', 'Return', 'assignment_return', { disabled: !check.ok, title: check.ok ? 'Return it to the preparer with a note' : check.why }));
    out.push(btn('approve', 'Approve', 'task_alt', { tone: 'primary', disabled: !check.ok, title: check.ok ? 'Approve — the letter locks and the case can be filed' : check.why }));
  } else if (row.status === 'ApprovedToSubmit') {
    const pkg = appealCases.latestPackage(row);
    out.push(btn('withdraw', 'Withdraw', 'undo', { title: 'Withdraw the appeal — the denial goes back to the worklist' }));
    out.push(btn('package', pkg ? 'Package' : 'Generate package', 'inventory_2', { title: pkg ? `Open ${pkg.ref} — the letter, the enclosures and the cover sheet, frozen` : 'Freeze the letter, the bundle index and the cover sheet into the package the payer receives' }));
    out.push(btn('submit', 'Submit to payer', 'send', { tone: 'primary', title: 'Record how and when the package went to the payer' }));
  } else if (row.status === 'Withdrawn') {
    out.push(`<span class="badge">Withdrawn ${esc(date(row.withdrawal?.at))}</span>`);
  } else {
    if (row.packageRef) out.push(btn('print', 'Package', 'print', { title: `Open ${row.packageRef} as filed` }));
    const esc2 = appealCases.canEscalate(row.id);
    if (!row.childCaseId) out.push(btn('level2', `Raise level ${row.level + 1}`, 'stairs', { tone: esc2.ok ? 'primary' : 'secondary', disabled: !esc2.ok, title: esc2.ok ? `The payer refused the level-${row.level} appeal — open a level-${row.level + 1} case pre-loaded with this one's citations and package` : esc2.why }));
  }
  return out.join('');
}

export async function handleAction(act, id, ctx) {
  const row = appealCases.get(id);
  if (!row) return { error: 'No such case' };
  if (act === 'review') return openSendForReview(row);
  if (act === 'approve' || act === 'return') return openReviewDialog(row, act);
  if (act === 'package') {
    const pkg = appealCases.latestPackage(row)?.approvedAt === row.letter.finalLockedAt ? appealCases.latestPackage(row) : appealCases.generatePackage(id);
    if (pkg?.error) return pkg;
    toast(`${pkg.ref} ready`);
    ctx.navigate(`/defensio/appeals/${id}/package`);
    return null;
  }
  if (act === 'print') { ctx.navigate(`/defensio/appeals/${id}/package`); return null; }
  if (act === 'submit') return openSubmissionDialog(row, ctx);
  if (act === 'withdraw') return openWithdrawDialog(row, ctx);
  if (act === 'level2') return openLevel2Dialog(row, ctx);
  return null;
}

const errorBox = (el, problems) => {
  el.innerHTML = problems.length
    ? `<div class="alert alert--critical"><span class="icon">error</span><div>${problems.map(esc).join('<br>')}</div></div>` : '';
};

async function openSendForReview(row) {
  const tier = appealCases.tierFor(row.disputedAmount);
  const warnings = appealCases.evidenceWarnings(row);
  const dialog = modal.open({
    title: `Send ${row.id} for review`,
    sub: `${usd(row.disputedAmount)} disputed · ${tier} tier`,
    icon: 'rate_review',
    size: 'sm',
    body: `
      <p class="modal__lede">${tier === 'senior'
        ? `At or above ${esc(usd(appealCases.seniorAbove()))} the CMO signs. The case is read-only until it comes back approved or returned.`
        : 'The RCM coder or the CMO signs. The case is read-only until it comes back approved or returned.'}</p>
      <dl class="dl dl--narrow">
        <dt>Ground</dt><dd>${esc(appealCases.groundLabel(row.grounds.primary))}</dd>
        <dt>Citations</dt><dd>${row.citations.length}</dd>
        <dt>Enclosures</dt><dd>${appealCases.includedBundle(row).length}</dd>
        <dt>Letter</dt><dd>v${row.letter.versions.length}${appealCases.latestLetter(row)?.manuallyEdited ? ' · edited by hand' : ''}</dd>
      </dl>
      ${warnings.length ? `<div class="alert alert--warning"><span class="icon">warning</span><div><div class="title">Evidence the grounds expect and the bundle does not carry</div>${
    warnings.map((w) => `${esc(w.label)}: ${w.missing.map(esc).join(', ')}`).join('<br>')}<br>The reviewer will see the same gaps.</div></div>` : ''}
      <div id="sr-error"></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" id="sr-save">Send for review</button>`,
  });
  dialog.el.querySelector('#sr-save').addEventListener('click', () => {
    const r = appealCases.submitForReview(row.id);
    if (r?.error) return errorBox(dialog.el.querySelector('#sr-error'), [r.error]);
    toast(`${row.id} sent for ${tier} review`);
    return dialog.close(true);
  });
  return dialog.closed;
}

async function openReviewDialog(row, action) {
  const approve = action === 'approve';
  const dialog = modal.open({
    title: `${approve ? 'Approve' : 'Return'} ${row.id}`,
    sub: `${appealCases.requiredTierOf(row)} tier · prepared by ${row.createdBy} · round ${(row.review?.rounds || []).length + 1}`,
    icon: approve ? 'task_alt' : 'assignment_return',
    tone: approve ? '' : 'warning',
    size: 'sm',
    body: `
      <p class="modal__lede">${approve
        ? `Approving locks letter v${row.letter.versions.length} as the one the payer receives; the package is generated from it.`
        : 'The case goes back to the preparer as Returned with your note; a corrected case comes round again.'}</p>
      <label class="field field--area"><span class="icon icon--sm">notes</span>
        <textarea id="rv-note" rows="3" placeholder="${approve ? 'A note for the record (optional)' : 'What has to change'}" aria-label="Review note" maxlength="400"></textarea>
      </label>
      <div id="rv-error"></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" id="rv-save">${approve ? 'Approve' : 'Return to preparer'}</button>`,
  });
  dialog.el.querySelector('#rv-save').addEventListener('click', () => {
    const r = appealCases.review(row.id, { action, note: dialog.el.querySelector('#rv-note').value });
    if (r?.error) return errorBox(dialog.el.querySelector('#rv-error'), [r.error]);
    toast(approve ? `${row.id} approved — letter locked` : `${row.id} returned to ${row.createdBy}`);
    return dialog.close(true);
  });
  return dialog.closed;
}

async function openSubmissionDialog(row, ctx) {
  const role = currentRole();
  const dl = appealCases.deadlineOf(row);
  const dialog = modal.open({
    title: `Submit ${row.id} to the payer`,
    sub: `${usd(row.disputedAmount)} disputed · file by ${date(row.filingDeadline)}`,
    icon: 'send',
    size: 'md',
    body: `
      <p class="modal__lede">Record how the package went and the payer's reference. ${appealCases.latestPackage(row) ? `${esc(appealCases.latestPackage(row).ref)} is what goes.` : 'The package is generated as you submit.'}</p>
      <div class="toolbar">
        <label class="field"><span class="icon icon--sm">outbox</span>
          <select id="sb-method" aria-label="Method">${appealCases.methods().map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}</select>
        </label>
        <label class="field field--grow"><span class="icon icon--sm">tag</span>
          <input id="sb-ref" placeholder="Payer's reference — portal id, email subject, courier slip" aria-label="Reference" maxlength="60">
        </label>
        <label class="field"><span class="icon icon--sm">event</span>
          <input type="date" id="sb-date" value="${todayIso()}" max="${todayIso()}" aria-label="Filed on">
        </label>
      </div>
      <div id="sb-late"></div>
      <div id="sb-error"></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" id="sb-save">Mark submitted</button>`,
  });
  const $ = (sel) => dialog.el.querySelector(sel);
  function drawLate() {
    const { late, daysLate } = appealCases.lateness(row, $('#sb-date').value || todayIso());
    $('#sb-late').innerHTML = !late ? (dl.warn ? `<p class="t-body-sm">Inside the window — ${dl.daysLeft} day${dl.daysLeft === 1 ? '' : 's'} to spare.</p>` : '')
      : `<div class="alert alert--critical"><span class="icon">timer_off</span><div><div class="title">Late by ${daysLate} day${daysLate === 1 ? '' : 's'}</div>${
        role.canOverrideAppealDeadline ? 'Filing past the deadline is recorded on the submission with your reason; the payer may refuse it as out of time.' : 'Only the CMO files past the deadline. Switch to that role, or withdraw the appeal.'}</div></div>
        ${role.canOverrideAppealDeadline ? `<label class="field field--area"><span class="icon icon--sm">notes</span><textarea id="sb-reason" rows="2" placeholder="Why it is being filed late" aria-label="Late reason" maxlength="300"></textarea></label>` : ''}`;
  }
  $('#sb-date').addEventListener('change', drawLate);
  drawLate();
  $('#sb-save').addEventListener('click', () => {
    const r = appealCases.submit(row.id, { method: $('#sb-method').value, reference: $('#sb-ref').value, submittedAt: $('#sb-date').value, lateReason: $('#sb-reason')?.value || '' });
    if (r?.error) return errorBox($('#sb-error'), [r.error]);
    toast(`${row.id} submitted by ${r.method} — ${r.packageRef}`);
    dialog.close(true);
    return ctx.navigate(`/defensio/appeals/${row.id}`);
  });
  return dialog.closed;
}

async function openWithdrawDialog(row, ctx) {
  const dialog = modal.open({
    title: `Withdraw ${row.id}`,
    sub: `${usd(row.disputedAmount)} disputed · ${appealCases.statusLabel(row.status).toLowerCase()}`,
    icon: 'undo',
    tone: 'warning',
    size: 'sm',
    body: `
      <p class="modal__lede">The case closes as Withdrawn and the denial's Appeal route ends: ${(row.denialIds || []).map(esc).join(', ')} goes back to the worklist as triaged, for another look or another route.</p>
      <label class="field field--area"><span class="icon icon--sm">notes</span>
        <textarea id="wd-reason" rows="3" placeholder="Why the appeal is being withdrawn" aria-label="Reason" maxlength="300"></textarea>
      </label>
      <div id="wd-error"></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" id="wd-save">Withdraw</button>`,
  });
  dialog.el.querySelector('#wd-save').addEventListener('click', () => {
    const r = appealCases.withdraw(row.id, dialog.el.querySelector('#wd-reason').value);
    if (r?.error) return errorBox(dialog.el.querySelector('#wd-error'), [r.error]);
    toast(`${row.id} withdrawn — ${row.denialId} is back on the worklist`);
    dialog.close(true);
    return ctx.navigate(`/defensio/denials/${row.denialId}`);
  });
  return dialog.closed;
}

async function openLevel2Dialog(row, ctx) {
  const check = appealCases.canEscalate(row.id);
  if (!check.ok) { toast(check.why, 'warning'); return null; }
  const out = appealCases.getAppealOutcome(row.id);
  const ok = await modal.confirm({
    title: `Raise a level-${row.level + 1} appeal after ${row.id}`,
    body: `The payer refused the level-${row.level} appeal${out?.decidedAt ? ` on ${date(out.decidedAt)}` : ''}. A new case opens as a draft with this one's grounds, citations and enclosures pre-loaded and the level-${row.level} package attached; the letter is written afresh and the case goes through review again.`,
    confirmLabel: `Open level ${row.level + 1}`,
    tone: 'warning',
    icon: 'stairs',
  });
  if (!ok) return null;
  const child = appealCases.createNextLevel(row.id, {});
  if (child?.error) return child;
  toast(`${child.id} opened at level ${child.level}`);
  ctx.navigate(`/defensio/appeals/${child.id}`);
  return null;
}
