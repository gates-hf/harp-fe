// Coding history — every change made to one chart, read-only, newest first:
// who took it, each draft, each query and its answer, each version marked
// coded and each recode. The referral trail's shape, bound to the `coding`
// entity, which is keyed on the encounter number.
//
// Two readers use the same markup: the workspace's History section and the
// View history row action, which opens it in the shared drawer beside the
// worklist.

import * as coding from '../../../../data/repositories/coding.js';
import * as drawer from '../../../../shared/drawer.js';
import { dateTime, esc } from '../../../../shared/format.js';

export const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'work', label: 'Work' },
  { id: 'queries', label: 'Queries' },
  { id: 'versions', label: 'Versions' },
];

const GROUPS = {
  work: ['Assigned', 'Reassigned', 'Self-assigned', 'Released to pool', 'Draft saved'],
  queries: ['Query raised', 'Query answered', 'Query resolved', 'Query reopened', 'Query withdrawn'],
  versions: ['Marked coded', 'Recode requested', 'Recode started', 'Request dismissed'],
};

/** The chips and the trail, ready to drop into a panel or a drawer body. */
export function historyHtml(no, filter = 'all') {
  const entries = coding.history(no).filter((row) => keep(row, filter));
  return `
    <div class="toolbar">
      <span class="t-title-sm">Changes</span>
      <span class="spacer"></span>
      <div class="segmented" role="group" aria-label="Filter history">
        ${FILTERS.map((f) => `<button data-filter="${f.id}" aria-pressed="${f.id === filter}">${f.label}</button>`).join('')}
      </div>
    </div>
    ${entries.length ? `<ol class="journey">${entries.map(rowHtml).join('')}</ol>` : emptyHtml(filter)}`;
}

/** View history — the same trail beside the worklist rather than on the page. */
export async function openCodingHistory(no) {
  let filter = 'all';
  const rec = coding.get(no);
  const sheet = drawer.open({
    title: `History — ${esc(no)}`,
    sub: `${esc(rec?.status || 'Unassigned')} · ${rec?.versions.length ? `${rec.versions.length} version${rec.versions.length === 1 ? '' : 's'}` : 'no draft yet'} · append-only`,
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

function rowHtml(entry) {
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
        ? 'Nobody has taken this chart. Every assignment, draft, query and version is recorded here, with the user and the time.'
        : 'No entries of this kind. Choose All to see the whole trail.'}</p>
    </div>`;
}
