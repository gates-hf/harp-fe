// The trail the TPA screens draw: an accrual's, a dispute's, an amendment's
// or a schedule's audit entries, newest first, in the denial trail's shape
// (the shared `.journey` list). Read-only.

import { dateTime, esc } from '../../../../shared/format.js';

const TONE = {
  Accrued: 'info', 'Separation added': 'info', Matched: 'success', Overcharged: 'critical', 'Dispute raised': 'warning', 'Dispute acknowledged': 'info',
  'Dispute settled': 'success', 'Dispute written off': 'critical', Amended: 'accent', Raised: 'warning', Acknowledged: 'info', Settled: 'success', 'Written off': 'critical',
  Drafted: '', 'Impact computed': 'info', 'Sent for review': 'warning', Approved: 'success', Rejected: 'critical', Posted: 'accent', 'Version added': 'info',
  'Restatement drafted': 'accent', 'Restatement posted': 'accent', 'Payer linked': 'info', 'Payer link ended': '', Registered: 'info',
};

export function historyHtml(entries = [], { empty = 'Nothing recorded yet.' } = {}) {
  if (!entries.length) return `<p class="t-body-sm">${esc(empty)}</p>`;
  return `<ol class="journey">${entries.map((e) => {
    const tone = TONE[e.action] ?? '';
    return `
    <li class="journey__row">
      <span class="journey__at t-mono-sm">${dateTime(e.at)}</span>
      <span class="journey__action"><span class="badge${tone ? ` badge--${tone}` : ''}">${esc(e.action)}</span></span>
      <span class="journey__actor">${esc(e.user || '')}</span>
      <span class="journey__detail">${esc(e.details || '')}</span>
    </li>`;
  }).join('')}</ol>`;
}
