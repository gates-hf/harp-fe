// The five quick actions in the dashboard's panel header. Every one is a page
// and opens as an ordinary link — the amendment's Manual Charge would open the
// capture modal on arrival, but the charges screen reads no such hash
// parameter, so the action lands on the worklist whose header holds the
// button. The one thing drawn here rather than in home.html is the day-close
// action, whose label depends on the signed-in role: a role that may close the
// day reads "Close day", everyone else "Today's DTR", both at #/claima/dtr —
// amendment 34's screen, feature-detected through the role flag it adds.

import { current as currentRole } from '../../../../shared/roles.js';
import { esc } from '../../../../shared/format.js';

/** The actions in order; the primary is last, which is where the system puts one. */
export function actions(role = currentRole()) {
  const closes = Boolean(role?.canCloseDay);
  return [
    { href: '#/claima/charges', icon: 'post_add', label: 'Manual charge',
      title: 'Open the capture worklist — Manual charge is in its header' },
    { href: '#/claima/submission', icon: 'send', label: 'Create batch',
      title: 'Open the submission workbench on the ready queue by payer' },
    { href: '#/claima/remittances/new', icon: 'payments', label: 'New remittance',
      title: 'Enter a payer’s remittance by hand' },
    // A36 — the queue is Defensio's worklist now.
    { href: '#/defensio/denials?status=Untriaged', icon: 'report', label: 'Denials queue',
      title: 'Open the Defensio denial worklist on what nobody has triaged' },
    { href: '#/claima/dtr', icon: closes ? 'lock_clock' : 'today',
      label: closes ? 'Close day' : 'Today’s DTR', primary: true,
      title: closes
        ? 'Open today’s daily transaction report to reconcile and close the day'
        : 'Open today’s daily transaction report' },
  ];
}

/** The whole header row — title, spacer and the buttons as flex children. */
export function headerHtml() {
  const buttons = actions().map((a) => `
    <a class="btn ${a.primary ? 'btn--primary' : 'btn--secondary'} btn--sm" href="${esc(a.href)}" title="${esc(a.title)}">
      <span class="icon icon--sm">${esc(a.icon)}</span>${esc(a.label)}
    </a>`).join('');
  return `<span>Claima</span><span class="spacer"></span>${buttons}`;
}
