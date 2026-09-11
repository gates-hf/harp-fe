// The Tracking & outcome tab of an appeal case — registered in
// modules/defensio/tabs.js for amendment 38's case view, and drawn by this
// feature's own case host at #/defensio/appeal-tracking/<id>. Five panels in
// one node: the payer's response clock (the responseDeadline, kept apart
// from the denial's filingDeadline), the follow-up log, the decision (the
// capture button while the case is in flight, the outcome and its
// allocations once it is decided, a disposition on each lost share still
// pending), the recovery panel (the expected records and their states, a
// shortfall's answer) and the close, gated on the ledger. Owns its node and
// listener; `redraw` is the host's, called after every write.
//
// render(host, { caseId, redraw })

import * as tracking from '../../../../data/repositories/appeal-tracking.js';
import * as denials from '../../../../data/repositories/denials.js';
import * as recoveries from '../../../../data/repositories/expected-recoveries.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { date, dateTime, esc, usd } from '../../../../shared/format.js';
import { clockHtml, dispositionHtml, outcomeHtml, recoveryHtml, statusHtml } from './tracking-chips.js';
import {
  openCloseDialog, openDispositionDialog, openFollowUpDialog, openOutcomeDialog, openShortfallDialog, openUnderReviewDialog,
} from './tracking-dialogs.js';

export function render(host, { caseId, redraw = () => {} }) {
  const c = tracking.get(caseId);
  if (!c) { host.innerHTML = '<div class="state-view"><div class="state-view__title">No such case</div></div>'; return; }
  if (!tracking.isTracked(c)) {
    host.innerHTML = `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">schedule_send</span></div>
        <div class="state-view__title">Not submitted yet</div>
        <p class="state-view__body">Tracking starts when the appeal is submitted to the payer. The case is ${esc(String(c.status || '').toLowerCase())} — prepare and submit it on the case's own tabs.</p>
      </div>`;
    return;
  }
  host.innerHTML = `${clockPanel(c)}${followUpPanel(c)}${outcomePanel(c)}${recoveryPanel(c)}${closePanel(c)}`;

  host.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    if (act === 'followup') await openFollowUpDialog([caseId]);
    else if (act === 'review') await openUnderReviewDialog(caseId);
    else if (act === 'outcome') await openOutcomeDialog(caseId);
    else if (act === 'dispose') await openDispositionDialog(caseId, btn.dataset.denial);
    else if (act === 'shortfall') await openShortfallDialog(caseId, btn.dataset.recovery);
    else if (act === 'chase') { recoveries.noteChase(btn.dataset.recovery, 'The payer was asked for the remittance from the tab'); }
    else if (act === 'close') await openCloseDialog(caseId);
    else return;
    redraw();
  });
}

const panel = (title, head, body) => `
  <div class="panel">
    <div class="panel-header"><span>${esc(title)}</span><span class="spacer"></span>${head}</div>
    <div class="panel-body">${body}</div>
  </div>`;

function clockPanel(c) {
  const sub = tracking.submissionOf(c);
  const clock = tracking.clockOf(c);
  const filing = tracking.denialIdsOf(c).map((id) => denials.get(id)).filter(Boolean).map((d) => `${d.id} by ${date(d.deadline?.appealBy)}`).join(' · ');
  const head = c.status === 'Submitted'
    ? '<button class="btn btn--secondary btn--sm" data-act="review" title="The payer has acknowledged the appeal and is reading it"><span class="icon icon--sm">visibility</span>Under review</button>' : '';
  return panel('Response clock', head, `
    <dl class="dl dl--narrow">
      <dt>Status</dt><dd>${statusHtml(c)}</dd>
      <dt>Submitted</dt><dd>${date(sub.submittedAt)}${sub.method ? ` · ${esc(sub.method)}` : ''}${sub.reference ? `<br><span class="t-body-sm">ref ${esc(sub.reference)}${sub.packageRef ? ` · ${esc(sub.packageRef)}` : ''}</span>` : ''}</dd>
      <dt title="How long the payer has to answer — not the filing deadline">Response due</dt>
      <dd>${clockHtml(c)}<br><span class="t-body-sm">${esc(clock.deadline ? `${date(clock.deadline)} — ${tracking.responseWindowDays(c.payerId)}-day response window from the submission` : 'No submission date on the case')}</span></dd>
      <dt title="The denial's own deadline — the payer's appeal window, met by the submission">Filing deadline</dt>
      <dd><span class="t-body-sm">${esc(filing || '—')} · met</span></dd>
      ${c.tracking?.underReview ? `<dt>Under review</dt><dd>${dateTime(c.tracking.underReview.at)}${c.tracking.underReview.ref ? `<br><span class="t-body-sm">ref ${esc(c.tracking.underReview.ref)}</span>` : ''}</dd>` : ''}
    </dl>`);
}

function followUpPanel(c) {
  const rows = tracking.followUpsOf(c);
  const head = tracking.isInFlight(c)
    ? '<button class="btn btn--primary btn--sm" data-act="followup" title="Log a call, a portal check or an email to the payer"><span class="icon icon--sm">call</span>Log follow-up</button>'
    : '<button class="btn btn--secondary btn--sm" data-act="followup" title="A note on a decided case — the payer chased for the remittance, say"><span class="icon icon--sm">call</span>Log follow-up</button>';
  const body = rows.length ? `
    <table class="tbl">
      <thead><tr><th scope="col">When</th><th scope="col">How</th><th scope="col">Who</th><th scope="col">What was said</th><th scope="col">Next due</th><th scope="col">By</th></tr></thead>
      <tbody>${[...rows].reverse().map((f) => `
        <tr>
          <td>${date(f.date)}</td>
          <td><span class="badge">${esc(f.method)}</span></td>
          <td>${esc(f.contact || '—')}</td>
          <td>${esc(f.note)}</td>
          <td>${f.nextDue ? date(f.nextDue) : '—'}</td>
          <td class="t-body-sm">${esc(f.by || '')}</td>
        </tr>`).join('')}</tbody>
    </table>` : '<p class="t-body-sm">No follow-up yet. The response clock says when to start asking.</p>';
  return panel('Follow-ups', head, body);
}

function outcomePanel(c) {
  if (!c.outcome) {
    const head = tracking.isInFlight(c)
      ? '<button class="btn btn--primary btn--sm" data-act="outcome" title="Record the payer’s decision and allocate it over the case’s denials"><span class="icon icon--sm">gavel</span>Capture decision</button>' : '';
    return panel('Decision', head, '<p class="t-body-sm">No decision yet. When the payer answers, capture it here: won, partially won, lost or settled, with the rationale and the allocation per denial.</p>');
  }
  const o = c.outcome;
  const allocations = o.allocations || [];
  const rows = allocations.map((a) => `
    <tr>
      <td><a class="crumb-link t-mono-sm" href="#/defensio/denials/${esc(a.denialId)}">${esc(a.denialId)}</a></td>
      <td class="t-mono-sm">${esc(usd(a.concededShare))}</td>
      <td class="t-mono-sm">${esc(usd(a.lostShare))}</td>
      <td>${a.lostShare > 0 ? dispositionHtml(a) : '<span class="t-body-sm">—</span>'}${
    a.writeoffId ? ` <a class="crumb-link t-mono-sm" href="#/claima/writeoffs/${esc(a.writeoffId)}" title="The write-off request on the claim's residual">${esc(a.writeoffId)}</a>` : ''}${
    a.escalation ? ` <a class="crumb-link t-mono-sm" href="${a.escalation.kind === 'case' ? `#/defensio/appeals/${esc(a.escalation.ref)}` : '#/defensio/appeal-tracking'}" title="${a.escalation.kind === 'case' ? 'The level-2 case' : 'The escalation request the appeal feature picks up'}">${esc(a.escalation.ref)}</a>` : ''}${
    a.reason ? `<br><span class="t-body-sm">${esc(a.reason)}</span>` : ''}</td>
      <td>${a.lostShare > 0 && !a.lostDisposition && c.status !== 'Closed'
    ? `<button class="btn btn--secondary btn--sm" data-act="dispose" data-denial="${esc(a.denialId)}" title="Escalate, write off, or accept the lost share"><span class="icon icon--sm">call_split</span>Dispose</button>` : ''}</td>
    </tr>`).join('');
  return panel('Decision', outcomeHtml(c), `
    <dl class="dl dl--narrow">
      <dt>Decided</dt><dd>${date(o.decisionDate)}${o.payerRef ? ` · <span class="t-mono-sm">${esc(o.payerRef)}</span>` : ''}<br><span class="t-body-sm">captured ${dateTime(o.capturedAt)} by ${esc(o.capturedBy || '')}</span></dd>
      <dt>Conceded</dt><dd>${esc(usd(o.concededTotal))} of ${esc(usd(tracking.disputedOf(c)))}</dd>
      <dt>Rationale</dt><dd>${o.payerRationale?.code ? `<span class="badge">${esc(denials.denialCodeLabel(o.payerRationale.code))}</span> ` : ''}${esc(o.payerRationale?.text || '—')}</dd>
      <dt>Document</dt><dd>${o.documentRef ? `<span class="icon icon--sm">attach_file</span> ${esc(o.documentRef.fileName)}` : '<span class="t-body-sm">None attached</span>'}</dd>
    </dl>
    <table class="tbl">
      <thead><tr><th scope="col">Denial</th><th scope="col">Conceded</th><th scope="col">Lost</th><th scope="col">Lost share</th><th scope="col"></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`);
}

function recoveryPanel(c) {
  const rows = tracking.recoveriesOf(c);
  const l = tracking.ledgerOf(c);
  const verdict = `<span class="badge badge--${l.holds ? 'success' : 'critical'}" title="${esc(tracking.ledgerLine(l))}">${l.holds ? 'Ledger balances' : 'Ledger out of step'}</span>`;
  const body = !c.outcome ? '<p class="t-body-sm">Expected recoveries are written when a decision concedes something.</p>'
    : !rows.length ? '<p class="t-body-sm">Nothing was conceded, so nothing is expected from the payer.</p>' : `
    <table class="tbl">
      <thead><tr><th scope="col">Record</th><th scope="col">Denial</th><th scope="col">Conceded</th><th scope="col">State</th><th scope="col">Recovered</th><th scope="col">Remittance</th><th scope="col">Waiting</th><th scope="col"></th></tr></thead>
      <tbody>${rows.map((r) => `
        <tr>
          <td class="t-mono-sm">${esc(r.id)}</td>
          <td><a class="crumb-link t-mono-sm" href="#/defensio/denials/${esc(r.denialId)}">${esc(r.denialId)}</a></td>
          <td class="t-mono-sm">${esc(usd(r.concededAmount))}</td>
          <td><span class="badge badge--${tracking.recoveryTone(r.state)}">${esc(tracking.recoveryLabel(r.state))}</span>${
    r.shortfall ? `<br><span class="t-body-sm">${r.shortfall.how === 'accept' ? 'gap accepted' : `gap to ${esc(r.shortfall.writeoffId || 'write-off')}`}</span>` : ''}</td>
          <td class="t-mono-sm">${esc(usd(r.recoveredAmount))}</td>
          <td>${r.remittanceRef ? `<a class="crumb-link t-mono-sm" href="#/claima/remittances/${esc(r.remittanceRef)}/postings">${esc(r.remittanceRef)}</a>` : '<span class="t-body-sm">—</span>'}</td>
          <td>${r.state === 'AwaitingRemittance' ? `<span class="badge${recoveries.isAging(r) ? ' badge--critical' : ''}" title="${esc(`Since the decision on ${date(r.agingFrom)}; aging past ${tracking.recoveryAgingDays()} days`)}">${recoveries.recoveryAge(r)} d</span>` : '<span class="t-body-sm">—</span>'}</td>
          <td>${r.state === 'AwaitingRemittance' ? `<button class="btn btn--secondary btn--sm" data-act="chase" data-recovery="${esc(r.id)}" title="Note that the payer was asked for the remittance"><span class="icon icon--sm">notifications</span>Chase</button>`
    : r.state === 'Shortfall' && !r.shortfall && c.status !== 'Closed' ? `<button class="btn btn--secondary btn--sm" data-act="shortfall" data-recovery="${esc(r.id)}" title="Accept the gap with a reason, or send it to the write-off loop"><span class="icon icon--sm">trending_down</span>Answer</button>` : ''}</td>
        </tr>`).join('')}</tbody>
    </table>`;
  return panel('Recovery', c.outcome ? `${recoveryHtml(c)} ${verdict}` : '', `${body}${c.outcome ? `<p class="t-body-sm">${esc(tracking.ledgerLine(l))}</p>` : ''}`);
}

function closePanel(c) {
  if (c.status === 'Closed') {
    return panel('Close', '<span class="badge badge--success"><span class="dot"></span>Closed</span>', `<p class="t-body-sm">Closed ${dateTime(c.closedAt)}. ${esc(tracking.ledgerLine(tracking.ledgerOf(c)))}</p>`);
  }
  const blockers = tracking.closeBlockers(c);
  const role = currentRole();
  const gate = blockers.length ? blockers.join('. ') : role.canResolveDenial ? 'Close the case — the ledger balances and nothing is owed' : 'Only the RCM coder and the CMO close an appeal case';
  const ok = !blockers.length && role.canResolveDenial;
  return panel('Close', `<button class="btn btn--primary btn--sm" data-act="close"${ok ? '' : ' disabled'} title="${esc(gate)}"><span class="icon icon--sm">task_alt</span>Close case</button>`,
    `<p class="t-body-sm">${esc(blockers.length ? `Not yet: ${blockers.join('; ')}.` : 'Every lost share has its disposition and nothing conceded is still owed.')}</p>`);
}
