// The five quick actions in the dashboard's panel header. Every one is a page
// and opens as an ordinary link, landing with the focus the owning screen
// already reads off its query — a slice its own rail presses, a period the
// analytics bar reads — so the desk arrives on the rows it came for and the
// screen says what it is filtered by. The primary is last, which is where the
// system puts one.

import { esc } from '../../../../shared/format.js';

export function actions() {
  return [
    { href: '#/defensio/appeals?slice=due', icon: 'gavel', label: 'Appeals to file',
      title: 'Open the appeals workbench on the cases inside the filing warning window or past it, soonest first' },
    { href: '#/defensio/appeal-tracking?slice=overdue', icon: 'track_changes', label: 'Chase payers',
      title: 'Open appeal tracking on the submitted appeals the payer has not answered inside its window' },
    { href: '#/defensio/rca?slice=overdue', icon: 'troubleshoot', label: 'Root cause',
      title: 'Open the root-cause worklist on the cases past their target' },
    { href: '#/defensio/analytics/overview?period=MTD', icon: 'query_stats', label: 'Analytics',
      title: 'Open the denial analytics on the month to date' },
    { href: '#/defensio/denials?status=Untriaged', icon: 'rule', label: 'Triage queue', primary: true,
      title: 'Open the denial worklist on what nobody has triaged, largest open amount first' },
  ];
}

/** The whole header row — title, spacer and the buttons as flex children. */
export function headerHtml() {
  const buttons = actions().map((a) => `
    <a class="btn ${a.primary ? 'btn--primary' : 'btn--secondary'} btn--sm" href="${esc(a.href)}" title="${esc(a.title)}">
      <span class="icon icon--sm">${esc(a.icon)}</span>${esc(a.label)}
    </a>`).join('');
  return `<span>Defensio</span><span class="spacer"></span>${buttons}`;
}
