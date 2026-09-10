// Denial history — every change made to one denial, read-only, newest
// first: created, denied again, assigned, triaged, routed, in progress,
// the resolution. The claim trail's shape, bound to the `denials` entity;
// the page's History tab and the worklist's View history drawer read it.

import * as denials from '../../../../data/repositories/denials.js';
import * as drawer from '../../../../shared/drawer.js';
import { dateTime, esc } from '../../../../shared/format.js';

const TONE = {
  Created: 'critical', 'Denied again': 'critical', Routed: 'accent', 'In progress': 'accent', Triaged: 'info', Assigned: '', Unassigned: '',
  Recovered: 'success', 'Partially Recovered': 'info', 'Written Off': 'critical', Lost: 'critical', 'Manually Resolved': 'warning',
  'Deadline passed': 'critical', Reversed: '', 'Repeat withdrawn': '', 'Partly written off': 'info',
};

export function historyHtml(id) {
  const entries = denials.history(id);
  return `
    <div class="toolbar">
      <span class="t-title-sm">Changes</span>
      <span class="badge">${entries.length}</span>
      <span class="spacer"></span>
      <span class="t-body-sm">Append-only — a triage rewritten is a second line, never an edit.</span>
    </div>
    ${entries.length ? `<ol class="journey">${entries.map(rowHtml).join('')}</ol>` : `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">history</span></div>
      <div class="state-view__title">No changes yet</div>
      <p class="state-view__body">The trail starts when the denial is created and grows with every triage, route and resolution.</p>
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

/** View history — the same trail beside the worklist rather than on the page. */
export async function openDenialHistory(id) {
  const denial = denials.get(id);
  if (!denial) return undefined;
  const sheet = drawer.open({
    title: `History — ${esc(denial.id)}`,
    sub: `${esc(denial.claimNo)} · ${esc(denial.status.toLowerCase())}`,
    icon: 'history',
    body: historyHtml(denial.id),
  });
  return sheet.closed;
}
