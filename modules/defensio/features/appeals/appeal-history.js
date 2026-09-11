// Appeal case history — every change made to one case, read-only, newest
// first: opened, grounds, citations, evidence, letter versions, review
// rounds, the package, the submission, a withdrawal, an escalation. The
// denial trail's shape, bound to the `appealCases` entity.

import * as appealCases from '../../../../data/repositories/appeal-cases.js';
import { dateTime, esc } from '../../../../shared/format.js';

const TONE = {
  Created: 'accent', 'Grounds set': 'info', 'Citation added': 'info', 'Citation argued': '', 'Citation removed': '',
  'Evidence attached': 'info', 'Evidence included': '', 'Evidence left out': '', 'Evidence removed': '',
  'Letter generated': 'info', 'Letter edited': 'warning', 'Sent for review': 'accent', Approved: 'success', Returned: 'warning',
  'Package generated': 'info', Submitted: 'success', Withdrawn: 'critical', Escalated: 'accent',
};

export function historyHtml(id) {
  const entries = appealCases.history(id);
  return `
    <div class="toolbar">
      <span class="t-title-sm">Changes</span>
      <span class="badge">${entries.length}</span>
      <span class="spacer"></span>
      <span class="t-body-sm">Append-only — a letter regenerated is a new version, never an edit of the old one.</span>
    </div>
    ${entries.length ? `<ol class="journey">${entries.map(rowHtml).join('')}</ol>` : `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">history</span></div>
      <div class="state-view__title">No changes yet</div>
      <p class="state-view__body">The trail starts when the denial is routed to an appeal and grows with every citation, version, review and filing.</p>
    </div>`}`;
}

function rowHtml(e) {
  const tone = TONE[e.action] ?? '';
  return `
    <li class="journey__row">
      <span class="journey__at t-mono-sm">${dateTime(e.at)}</span>
      <span class="journey__action"><span class="badge${tone ? ` badge--${tone}` : ''}">${esc(e.action)}</span></span>
      <span class="journey__actor">${esc(e.user || '')}</span>
      <span class="journey__detail">${esc(e.details || '')}</span>
    </li>`;
}
