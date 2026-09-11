// Root-cause case history — every change made to one case and to the
// corrective actions and the accountability case hanging off it, read-only,
// newest first: opened, assigned, analysis saved, causer named, concluded
// (with the retags), closed. The denial trail's shape, bound to the three
// entities this feature writes.

import * as rcaCases from '../../../../data/repositories/rca-cases.js';
import * as correctiveActions from '../../../../data/repositories/corrective-actions.js';
import * as accountabilityCases from '../../../../data/repositories/accountability-cases.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { dateTime, esc } from '../../../../shared/format.js';

const TONE = {
  Opened: 'accent', 'Opened by trigger': 'accent', Assigned: '', Unassigned: '', 'Denials added': 'info',
  'Analysis started': 'info', 'Analysis saved': '', 'Causer named': 'warning', 'Causer updated': 'warning', 'Causer cleared': '',
  Concluded: 'success', Closed: 'success',
  Created: 'accent', Updated: '', Done: 'info', Verified: 'success', Reopened: 'warning', 'Attachment added': '',
  'Response recorded': 'info', 'No response': 'critical', Decided: 'warning', 'Appeal filed': 'warning', 'Appeal reviewed': 'info', 'Sent to HR': 'info', 'HR outcome captured': 'success',
};

export function historyHtml(id) {
  const role = currentRole();
  const own = rcaCases.history(id).map((e) => ({ ...e, record: id }));
  const actions = correctiveActions.byCase(id).flatMap((a) => correctiveActions.history(a.id).map((e) => ({ ...e, record: a.id })));
  // The accountability trail names the person; outside the authorised roles it is left off.
  const accs = accountabilityCases.canRead(role)
    ? accountabilityCases.byCase(id).flatMap((a) => accountabilityCases.history(a.id).map((e) => ({ ...e, record: a.id })))
    : [];
  const entries = [...own, ...actions, ...accs].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return `
    <div class="toolbar">
      <span class="t-title-sm">Changes</span>
      <span class="badge">${entries.length}</span>
      <span class="spacer"></span>
      <span class="t-body-sm">Append-only, across the case, its actions${accountabilityCases.canRead(role) ? ' and its accountability case' : ''} — a save is a second line, never an edit.</span>
    </div>
    ${entries.length ? `<ol class="journey">${entries.map(rowHtml).join('')}</ol>` : `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">history</span></div>
      <div class="state-view__title">No changes yet</div>
      <p class="state-view__body">The trail starts when the case opens and grows with every save.</p>
    </div>`}`;
}

function rowHtml(e) {
  const tone = TONE[e.action] ?? '';
  return `
    <li class="journey__row">
      <span class="journey__at t-mono-sm">${dateTime(e.at)}</span>
      <span class="journey__action"><span class="badge${tone ? ` badge--${tone}` : ''}">${esc(e.action)}</span></span>
      <span class="journey__actor">${esc(e.user || '')}</span>
      <span class="journey__detail"><span class="t-mono-sm">${esc(e.record)}</span> · ${esc(e.details || '')}</span>
    </li>`;
}
