// Encounter history — every change made to one encounter, read-only, newest
// first. The patient trail's shape, bound to the `encounters` entity.
//
// Two readers use the same markup: the History tab on the encounter page, and
// the View history row action, which opens it in the shared drawer beside the
// board.

import * as audit from '../../../../data/repositories/audit.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import * as drawer from '../../../../shared/drawer.js';
import { dateTime, esc } from '../../../../shared/format.js';

export const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'lifecycle', label: 'Lifecycle' },
  { id: 'financial', label: 'Financial' },
  { id: 'edits', label: 'Edits' },
  { id: 'links', label: 'Links' },
];

const GROUPS = {
  lifecycle: ['Created', 'Activated', 'Discharged', 'Completed', 'Cancelled'],
  financial: ['Re-classified', 'Clearance'],
  edits: ['Updated', 'Duplicate warning'],
  links: ['Linked', 'Re-linked'],
};

/** The chips and the trail, ready to drop into a tab panel or a drawer body. */
export function historyHtml(no, filter = 'all') {
  const entries = audit.forEntity('encounters', no).filter((row) => keep(row, filter));
  return `
    <div class="toolbar">
      <span class="t-title-sm">Changes</span>
      <span class="spacer"></span>
      <div class="segmented" role="group" aria-label="Filter history">
        ${FILTERS.map((f) => `<button data-filter="${f.id}" aria-pressed="${f.id === filter}">${f.label}</button>`).join('')}
      </div>
    </div>
    ${entries.length ? `<ol class="journey">${entries.map(row).join('')}</ol>` : emptyHtml(filter)}`;
}

/** View history — the same trail beside the board rather than on the page. */
export async function openEncounterHistory(no) {
  const encounter = encounters.get(no);
  if (!encounter) return undefined;

  let filter = 'all';
  const sheet = drawer.open({
    title: `History — ${esc(no)}`,
    sub: `${esc(encounters.typeLabel(encounter.type))} · ${esc(encounter.department)} · append-only`,
    icon: 'history',
    body: historyHtml(no, filter),
  });

  sheet.el.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter]');
    if (!chip) return;
    filter = chip.dataset.filter;
    sheet.el.querySelector('.drawer__body').innerHTML = historyHtml(no, filter);
  });

  return sheet.closed;
}

function keep(entry, filter) {
  if (filter === 'all') return true;
  return (GROUPS[filter] || []).includes(entry.action);
}

// Field changes are stored as "Ward: A → B; Bed class: C → D" — one line each,
// so a reader sees what moved rather than a paragraph.
function row(entry) {
  const parts = String(entry.details || '').split('; ');
  return `
    <li class="journey__row">
      <span class="journey__at t-mono-sm">${dateTime(entry.at)}</span>
      <span class="journey__action">${esc(entry.action)}</span>
      <span class="journey__actor">${esc(entry.user)}</span>
      <span class="journey__detail">${parts.filter(Boolean).map((p) => esc(p)).join('<br>')}</span>
    </li>`;
}

function emptyHtml(filter) {
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">history</span></div>
      <div class="state-view__title">Nothing recorded yet</div>
      <p class="state-view__body">${filter === 'all'
        ? 'Every change to this encounter — the visit, who pays, the clearance stamp and the records linked to it — is recorded here, with the user and the time.'
        : 'No entries of this kind. Choose All to see the whole trail.'}</p>
    </div>`;
}
