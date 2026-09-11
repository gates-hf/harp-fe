// The chips the appeal tracking screens read a case by: status, the payer's
// response clock (the responseDeadline — never the denial's filingDeadline,
// which is the appeal window amendment 36 counts), the outcome, the
// recovery state and the money. The claim's vocabulary — patient cell, cover,
// masking — is the denial feature's, imported from inside the module.

import * as tracking from '../../../../data/repositories/appeal-tracking.js';
import * as recoveries from '../../../../data/repositories/expected-recoveries.js';
import { date, esc, usd } from '../../../../shared/format.js';

export { coverLabel, isWithheld, patientHtml, payerName, withheldCell } from '../denials/denial-chips.js';

export function statusHtml(c) {
  const tone = tracking.statusTone(c.status);
  const sub = tracking.submissionOf(c);
  const title = c.status === 'Submitted' ? `Submitted ${date(sub.submittedAt)}${sub.method ? ` by ${sub.method}` : ''}${sub.reference ? ` · ref ${sub.reference}` : ''}`
    : c.status === 'Under Review' ? `The payer acknowledged the appeal ${date(c.tracking?.underReview?.at)}${c.tracking?.underReview?.ref ? ` · ref ${c.tracking.underReview.ref}` : ''}`
      : c.outcome ? `${tracking.outcomeLabel(c.outcome.type)} ${date(c.decidedAt)}${c.outcome.payerRef ? ` · ${c.outcome.payerRef}` : ''}${c.closedAt ? ` · closed ${date(c.closedAt)}` : ''}` : '';
  return `<span class="badge${tone ? ` badge--${tone}` : ''}" title="${esc(title)}"><span class="dot"></span>${esc(c.status)}</span>`;
}

/** The response clock: days to the payer's deadline, amber inside the warning window, red once overdue; quiet once answered. */
export function clockHtml(c) {
  const clock = tracking.clockOf(c);
  if (!clock.deadline) return '<span class="t-body-sm" title="No submission date on the case">—</span>';
  if (!clock.binding) return `<span class="t-body-sm" title="Answered — the response deadline no longer applies">${date(clock.deadline)}</span>`;
  const text = clock.overdue ? `Overdue ${Math.abs(clock.daysLeft)} d` : clock.daysLeft === 0 ? 'Due today' : `${clock.daysLeft} d left`;
  return `<span class="badge${clock.tone ? ` badge--${clock.tone}` : ''}" title="${esc(`Payer's answer due ${date(clock.deadline)} — ${tracking.responseWindowDays(c.payerId)}-day response window from the submission`)}">${esc(text)}</span>`;
}

export function outcomeHtml(c) {
  if (!c.outcome) return '<span class="t-body-sm" title="No decision yet">Pending</span>';
  const tone = tracking.outcomeTone(c.outcome.type);
  return `<span class="badge${tone ? ` badge--${tone}` : ''}" title="${esc(`${usd(c.outcome.concededTotal)} of ${usd(tracking.disputedOf(c))} conceded · decided ${date(c.decidedAt)}${c.outcome.payerRef ? ` · ${c.outcome.payerRef}` : ''}`)}">${esc(tracking.outcomeLabel(c.outcome.type))}</span>`;
}

/** The recovery state, with the aging days under it while the money is waiting. */
export function recoveryHtml(c) {
  const state = tracking.recoveryStateOf(c);
  if (!state) return '<span class="t-body-sm">—</span>';
  if (state === 'NothingExpected') return '<span class="t-body-sm" title="Nothing was conceded, so nothing is expected">Nothing expected</span>';
  const tone = tracking.recoveryTone(state);
  const rows = tracking.recoveriesOf(c);
  const waiting = rows.filter((r) => r.state === 'AwaitingRemittance');
  const days = waiting.length ? Math.max(...waiting.map((r) => recoveries.recoveryAge(r))) : 0;
  const aging = waiting.some((r) => recoveries.isAging(r));
  const title = state === 'Recovered' ? rows.map((r) => `${usd(r.recoveredAmount)} on ${r.remittanceRef}`).join(' · ')
    : state === 'Shortfall' ? rows.filter((r) => r.state === 'Shortfall').map((r) => `${usd(r.recoveredAmount)} of ${usd(r.concededAmount)} on ${r.remittanceRef}`).join(' · ')
      : `${usd(waiting.reduce((n, r) => n + r.concededAmount, 0))} conceded, waiting ${days} d${aging ? ` — past the ${tracking.recoveryAgingDays()}-day aging mark` : ''}`;
  return `<span class="badge${aging ? ' badge--critical' : tone ? ` badge--${tone}` : ''}" title="${esc(title)}">${esc(tracking.recoveryStateLabel(state))}</span>${
    state === 'AwaitingRemittance' ? `<br><span class="t-body-sm">${days} d waiting</span>` : ''}`;
}

export const moneyHtml = (n, title = '') => `<span class="t-mono-sm"${title ? ` title="${esc(title)}"` : ''}>${esc(usd(n))}</span>`;

/** Disputed, with what was conceded under it once there is a decision. */
export function amountHtml(c) {
  const disputed = tracking.disputedOf(c);
  const under = c.outcome ? `<br><span class="t-body-sm">${esc(usd(c.outcome.concededTotal))} conceded</span>` : '';
  return `${moneyHtml(disputed, `Disputed ${usd(disputed)}`)}${under}`;
}

export const dispositionHtml = (a) => (a.lostDisposition
  ? `<span class="badge${a.lostDisposition === 'escalate' ? ' badge--accent' : a.lostDisposition === 'writeOffLoop' ? ' badge--critical' : ''}" title="${esc(a.reason || '')}">${esc(tracking.dispositionLabel(a.lostDisposition))}</span>`
  : '<span class="badge badge--warning" title="A lost share nobody has answered yet">Pending</span>');

export const nextDueHtml = (c) => {
  const due = tracking.nextDueOf(c);
  if (!due) return '<span class="t-body-sm">—</span>';
  const today = new Date().toISOString().slice(0, 10);
  const tone = due < today ? 'critical' : due === today ? 'warning' : '';
  return `<span class="badge${tone ? ` badge--${tone}` : ''}" title="Next follow-up ${esc(date(due))}">${esc(date(due))}</span>`;
};
