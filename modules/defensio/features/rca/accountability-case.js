// The Defensio accountability case page at #/defensio/accountability/<id>:
// authorised roles only. The banner (person, role in failure, stage, the
// root-cause case), then the three panels in the order the register
// enforces — response, decision, appeal — each carrying its own action with
// the repository's refusal in the tooltip, and beside them the deduction
// tracking as the design system's stepper (Recommended → Sent to HR →
// Outcome captured, never a posting), the evidence the person was named on,
// and the history.

import * as accountabilityCases from '../../../../data/repositories/accountability-cases.js';
import * as rcaCases from '../../../../data/repositories/rca-cases.js';
import * as denials from '../../../../data/repositories/denials.js';
import { staff, staffByName, staffName, staffLevel, levelLabel } from '../../../../data/seed/staff.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { date, dateTime, esc, usd } from '../../../../shared/format.js';
import { appealHtml, decisionHtml, deductionHtml, stageHtml } from './rca-chips.js';
import {
  confirmNoResponse, openAppealDialog, openCloseDialog, openDecisionDialog, openHrDialog, openResponseDialog, openReviewDialog,
} from './accountability-dialogs.js';

export const meta = { title: 'Accountability case' };

const TONE = { Opened: 'accent', 'Response recorded': 'info', 'No response': 'critical', Decided: 'warning', 'Appeal filed': 'warning', 'Appeal reviewed': 'info', 'Sent to HR': 'info', 'HR outcome captured': 'success', Closed: 'success' };

export async function render(mount, ctx) {
  const id = ctx.params[0];
  const first = accountabilityCases.get(id);
  if (!first) throw new Error(`No accountability case ${id}`);

  const res = await fetch(new URL('./accountability-case.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load accountability-case.html (${res.status})`);
  mount.innerHTML = await res.text();
  const $ = (sel) => mount.querySelector(sel);

  function draw() {
    const role = currentRole();
    const row = accountabilityCases.get(id);
    if (!row) return;
    const rca = rcaCases.get(row.rcaCaseId);
    ctx.setHeader(`${row.id} — ${accountabilityCases.stageOf(row)}`);
    ctx.setCrumb([
      { label: 'Defensio', path: '/defensio/rca' },
      { label: 'Accountability', path: '/defensio/accountability' },
      { label: row.id },
    ]);
    const allowed = accountabilityCases.canRead(role);
    $('#ac-page').hidden = !allowed;
    if (!allowed) {
      $('#ac-gate').innerHTML = `
        <div class="perm-banner">
          <span class="icon">lock</span>
          <div>
            <div class="title">${esc(accountabilityCases.maskedLabel(row))}</div>
            Accountability cases name people and are read by the authorised roles only. ${esc(role.name)}’s role sees the root-cause case, ${esc(row.rcaCaseId)}, with the name masked.
          </div>
        </div>
        <div class="state-view__actions"><a class="btn btn--secondary" href="#/defensio/rca/${esc(row.rcaCaseId)}">Open ${esc(row.rcaCaseId)}</a></div>`;
      return;
    }
    $('#ac-gate').innerHTML = '';
    const who = staff(row.personId);
    const w = accountabilityCases.windowOf(row);
    const me = role.name;
    $('#ac-id').textContent = row.id;
    $('#ac-rca').href = `#/defensio/rca/${row.rcaCaseId}`;
    $('#ac-meta').innerHTML = `
      <span class="t-mono-sm">${esc(row.id)}</span>
      ${stageHtml(row)}
      <span>·</span>
      <span title="${esc(who ? `${who.title} · ${who.department} · ${levelLabel(who.level)}` : '')}">${esc(staffName(row.personId))}</span>
      <span>·</span>
      <span class="t-body-sm">${esc(row.roleInFailure)}</span>
      <span>·</span>
      <a class="crumb-link t-mono-sm" href="#/defensio/rca/${esc(row.rcaCaseId)}">${esc(row.rcaCaseId)}</a>
      ${rca?.analysis?.confirmedRootCause ? `<span class="t-body-sm">${esc(denials.rootCauseLabel(rca.analysis.confirmedRootCause))}</span>` : ''}
      <span>·</span>
      <span class="t-body-sm">opened ${date(row.openedAt)} · analyst ${esc(staffName(row.analystId))}</span>`;
    const closeBlocker = accountabilityCases.closeBlocker(row);
    $('#ac-actions').innerHTML = row.closedAt
      ? `<span class="badge badge--success">Closed ${date(row.closedAt)}</span>`
      : `<button class="btn btn--primary btn--sm" data-act="close"${closeBlocker ? ' aria-disabled="true"' : ''} title="${esc(closeBlocker || 'Close the case')}"><span class="icon icon--sm">lock</span>Close</button>`;

    // Banners
    const banners = [];
    if (!w.answered && !row.closedAt) banners.push(alert(w.passed ? 'critical' : 'info', 'timer', w.passed ? `Response window closed ${date(w.closes)}` : `Response window open until ${date(w.closes)}`,
      w.passed ? 'Nothing was received. Record that, and a decision can follow.' : `${w.daysLeft} day${w.daysLeft === 1 ? '' : 's'} for ${staffName(row.personId)} to answer. Nothing is decided before the response, or before the window closes and that is recorded.`));
    if (row.decision?.type && !row.appeal?.text && !row.closedAt) banners.push(alert('info', 'gavel', `${accountabilityCases.decisionLabel(row.decision.type)} — ${row.decision.decidedBy}, ${date(row.decision.decidedAt)}`, `${staffName(row.personId)} may appeal to somebody senior to the decider.`));
    if (row.appeal?.text && !row.appeal.outcome) banners.push(alert('warning', 'balance', 'Appeal under review', accountabilityCases.reviewBlocker(row, me) ? `${accountabilityCases.reviewBlocker(row, me)}.` : `${me} can review it.`));
    $('#ac-banners').innerHTML = banners.join('');

    // 1 · Response
    const er = row.employeeResponse;
    $('#ac-response-head').innerHTML = w.answered ? `<span class="badge badge--${er.respondedAt ? 'success' : 'critical'}">${er.respondedAt ? `Answered ${date(er.respondedAt)}` : `No response · ${date(er.noResponseRecordedAt)}`}</span>`
      : `<span class="badge${w.passed ? ' badge--critical' : ' badge--warning'}">${w.passed ? 'Window closed' : `${w.daysLeft} d left`}</span>`;
    $('#ac-response').innerHTML = er.respondedAt ? `
      <div class="alert alert--info"><span class="icon">forum</span><div><div class="title">${esc(staffName(row.personId))} · ${date(er.respondedAt)}</div>${esc(er.text)}</div></div>
      ${er.attachments?.length ? `<p class="t-body-sm">Attached: ${er.attachments.map((a) => esc(a.fileName)).join(', ')}</p>` : ''}`
      : er.noResponseRecordedAt ? `<p class="t-body-sm">The window closed ${date(w.closes)} and nothing was received — recorded ${date(er.noResponseRecordedAt)}. A response recorded later still stands on the trail.</p>${row.decision?.type ? '' : '<div class="toolbar"><span class="spacer"></span><button class="btn btn--secondary btn--sm" data-act="response"><span class="icon icon--sm">forum</span>Record a late response</button></div>'}`
        : `<p class="t-body-sm">${esc(staffName(row.personId))} has ${w.passed ? 'not answered inside the window' : `until ${date(w.closes)} to answer`}. The response is recorded as received — by email, in person, on paper.</p>
        <div class="toolbar"><span class="spacer"></span>
          ${w.passed ? '<button class="btn btn--secondary btn--sm" data-act="no-response"><span class="icon icon--sm">timer_off</span>Record no response</button>' : ''}
          <button class="btn btn--primary btn--sm" data-act="response"><span class="icon icon--sm">forum</span>Record response</button>
        </div>`;

    // 2 · Decision
    const d = row.decision;
    const decideBlocker = accountabilityCases.decideBlocker(row, me);
    $('#ac-decision-head').innerHTML = d?.type ? decisionHtml(row) : '<span class="badge">Pending</span>';
    $('#ac-decision').innerHTML = d?.type ? `
      <dl class="dl dl--narrow">
        <dt>Decision</dt><dd>${decisionHtml(row)}${d.original ? ` <span class="t-body-sm">(was ${esc(accountabilityCases.decisionLabel(d.original.type))}${d.original.deduction ? ` ${esc(usd(d.original.deduction.amount))}` : ''} — modified on appeal)</span>` : ''}</dd>
        ${d.deduction ? `<dt>Deduction</dt><dd><span class="t-mono-sm">${esc(usd(d.deduction.amount))}</span> — ${esc(d.deduction.basis)}</dd>` : ''}
        <dt>Rationale</dt><dd>${esc(d.rationale)}</dd>
        <dt>Decided by</dt><dd>${esc(d.decidedBy)} · ${dateTime(d.decidedAt)}${accountabilityCases.isSamePerson(d.decidedBy, row.analystId) ? ' <span class="badge badge--critical">the analyst</span>' : ''}</dd>
      </dl>`
      : `<p class="t-body-sm">Recorded by somebody who did not analyse the case, once the response is on file or the window has closed and that is recorded. The analyst was ${esc(staffName(row.analystId))}.</p>
      <div class="toolbar"><span class="spacer"></span>
        <button class="btn btn--primary btn--sm" data-act="decide"${decideBlocker ? ' aria-disabled="true"' : ''} title="${esc(decideBlocker || 'Record the decision')}"><span class="icon icon--sm">gavel</span>Decide</button>
      </div>`;

    // 3 · Appeal
    const a = row.appeal;
    const reviewBlocker = a?.text && !a.outcome ? accountabilityCases.reviewBlocker(row, me) : '';
    $('#ac-appeal-head').innerHTML = appealHtml(row);
    $('#ac-appeal').innerHTML = !d?.type ? '<p class="t-body-sm">An appeal follows a decision.</p>'
      : !a?.text ? `<p class="t-body-sm">${esc(staffName(row.personId))} may appeal to somebody senior to ${esc(d.decidedBy)} (${esc(levelLabel(staffLevel(staffByName(d.decidedBy)?.id) || 0))}).</p>
        ${row.closedAt ? '' : '<div class="toolbar"><span class="spacer"></span><button class="btn btn--secondary btn--sm" data-act="appeal"><span class="icon icon--sm">reply</span>File appeal</button></div>'}`
        : `
      <div class="alert alert--info"><span class="icon">reply</span><div><div class="title">Filed ${date(a.filedAt)}</div>${esc(a.text)}</div></div>
      ${a.outcome ? `
      <dl class="dl dl--narrow">
        <dt>Outcome</dt><dd>${appealHtml(row)}</dd>
        <dt>Rationale</dt><dd>${esc(a.rationale)}</dd>
        <dt>Reviewed by</dt><dd>${esc(a.reviewedBy)} (${esc(levelLabel(staffLevel(staffByName(a.reviewedBy)?.id) || 0))}) · ${dateTime(a.reviewedAt)}</dd>
      </dl>` : `
      <div class="toolbar"><span class="t-body-sm">Reviewed by somebody senior to ${esc(d.decidedBy)}.</span><span class="spacer"></span>
        <button class="btn btn--primary btn--sm" data-act="review"${reviewBlocker ? ' aria-disabled="true"' : ''} title="${esc(reviewBlocker || 'Review the appeal')}"><span class="icon icon--sm">balance</span>Review</button>
      </div>`}
      ${a.versions?.length ? `
      <div class="toolbar"><span class="t-title-sm">Versions</span><span class="badge">${a.versions.length}</span></div>
      <ol class="journey">${a.versions.map((v) => `
        <li class="journey__row">
          <span class="journey__at t-mono-sm">${dateTime(v.reviewedAt)}</span>
          <span class="journey__action"><span class="badge">v${v.n} · ${esc(v.outcome)}</span></span>
          <span class="journey__actor">${esc(v.reviewedBy)}</span>
          <span class="journey__detail">${esc(accountabilityCases.decisionLabel(v.decisionBefore.type))} → ${esc(accountabilityCases.decisionLabel(v.decisionAfter.type))}${v.decisionAfter.deduction ? ` ${esc(usd(v.decisionAfter.deduction.amount))}` : ''} — ${esc(v.rationale)}</span>
        </li>`).join('')}</ol>` : ''}`;

    // Deduction tracking
    const t = row.deductionTracking;
    $('#ac-deduction').innerHTML = !t ? `<p class="t-body-sm">${d?.type ? 'No deduction was recommended.' : 'Appears once a deduction is recommended.'}</p>` : `
      <div class="stepper" aria-label="Deduction tracking">${accountabilityCases.DEDUCTION_STAGES.map((s, i) => {
    const idx = accountabilityCases.DEDUCTION_STAGES.indexOf(t.status);
    const cls = i < idx ? ' stepper__step--done' : i === idx ? ' stepper__step--current' : '';
    return `<span class="stepper__step${cls}" aria-disabled="${i > idx}"><span class="stepper__n">${i < idx ? '<span class="icon icon--sm">check</span>' : i + 1}</span><span class="stepper__label">${esc(accountabilityCases.DEDUCTION_LABELS[s])}</span></span>`;
  }).join('<span class="stepper__line"></span>')}</div>
      <dl class="dl dl--narrow">
        <dt>Recommended</dt><dd><span class="t-mono-sm">${esc(usd(d.deduction.amount))}</span> — ${esc(d.deduction.basis)}</dd>
        ${t.sentAt ? `<dt>Sent to HR</dt><dd>${date(t.sentAt)} · <span class="t-mono-sm">${esc(t.sentRef)}</span></dd>` : ''}
        ${t.capturedAt ? `<dt>HR outcome</dt><dd>${esc(t.hrOutcome)}${t.hrRef ? ` · <span class="t-mono-sm">${esc(t.hrRef)}</span>` : ''} · ${date(t.capturedAt)}</dd>` : ''}
      </dl>
      <p class="t-body-sm">A recommendation only — nothing here posts to payroll.</p>
      ${row.closedAt ? '' : `<div class="toolbar"><span class="spacer"></span>
        ${t.status === 'Recommended' ? `<button class="btn btn--primary btn--sm" data-act="hr-send"${a?.text && !a.outcome ? ' aria-disabled="true" title="The appeal is under review — HR waits for the outcome"' : ' title="Send the recommendation to HR with a reference"'}><span class="icon icon--sm">send</span>Send to HR</button>` : ''}
        ${t.status === 'SentToHR' ? '<button class="btn btn--primary btn--sm" data-act="hr-outcome" title="Record what HR decided"><span class="icon icon--sm">fact_check</span>Capture outcome</button>' : ''}
      </div>`}`;

    // Evidence
    const refs = row.evidenceRefs || [];
    $('#ac-evidence').innerHTML = refs.length ? `
      <p class="t-body-sm">The trail entries the root-cause case named ${esc(staffName(row.personId))} on — written by the other registers, never edited here.</p>
      <ol class="journey">${refs.map((ref) => { const live = rcaCases.resolveEvidence(ref); return `
        <li class="journey__row">
          <span class="journey__at t-mono-sm">${dateTime(ref.at)}</span>
          <span class="journey__action"><span class="badge${live ? '' : ' badge--critical'}">${esc(ref.action)}</span></span>
          <span class="journey__actor">${esc(ref.user || '')}</span>
          <span class="journey__detail"><span class="t-mono-sm">${esc(ref.entityId)}</span> · ${esc(live?.details || ref.label || '')}</span>
        </li>`; }).join('')}</ol>` : '<p class="t-body-sm">No evidence refs on the case.</p>';

    // History
    const entries = accountabilityCases.history(id);
    $('#ac-history').innerHTML = `<ol class="journey">${entries.map((e) => `
      <li class="journey__row">
        <span class="journey__at t-mono-sm">${dateTime(e.at)}</span>
        <span class="journey__action"><span class="badge${TONE[e.action] ? ` badge--${TONE[e.action]}` : ''}">${esc(e.action)}</span></span>
        <span class="journey__actor">${esc(e.user || '')}</span>
        <span class="journey__detail">${esc(e.details || '')}</span>
      </li>`).join('')}</ol>`;
  }

  const alert = (tone, icon, title, body) => `
    <div class="alert alert--${tone}"><span class="icon">${icon}</span><div><div class="title">${esc(title)}</div>${esc(body)}</div></div>`;

  mount.addEventListener('click', async (e) => {
    if (e.target.closest('a')) return;
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'response') await openResponseDialog(id);
    else if (act === 'no-response') await confirmNoResponse(id);
    else if (act === 'decide') await openDecisionDialog(id);
    else if (act === 'appeal') await openAppealDialog(id);
    else if (act === 'review') await openReviewDialog(id);
    else if (act === 'hr-send') await openHrDialog(id, 'send');
    else if (act === 'hr-outcome') await openHrDialog(id, 'outcome');
    else if (act === 'close') await openCloseDialog(id);
  });

  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));
  draw();
}
