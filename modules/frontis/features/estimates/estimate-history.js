// Estimate history — everything that happened to one quotation, read-only and
// newest first. The patient trail bound to the `estimate` entity: same chips,
// same strip, same drawer.
//
// An estimate's number is what the audit rows are keyed on, so one query
// returns its whole life — including the line written on it by the estimate
// that replaced it, which is the only entry a document does not write itself.

import * as audit from '../../../../data/repositories/audit.js';
import * as estimates from '../../../../data/repositories/estimates.js';
import * as drawer from '../../../../shared/drawer.js';
import { dateTime, esc } from '../../../../shared/format.js';

const ENTITY = 'estimate';

export const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'draft', label: 'Draft' },
  { id: 'issue', label: 'Issue' },
  { id: 'outcome', label: 'Outcome' },
];

const GROUPS = {
  draft: ['Created', 'Updated', 'Duplicated', 'Linked'],
  issue: ['Issued', 'Supersedes', 'Superseded'],
  outcome: ['Converted', 'Cancelled', 'Expired', 'Re-linked'],
};

/** The chips and the trail, ready to drop into a drawer body. */
export function estimateHistoryHtml(no, filter = 'all') {
  const entries = audit.forEntity(ENTITY, no).filter((row) => keep(row, filter));
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

/** View history — the trail beside the list, in the shared sheet. */
export async function openEstimateHistory(no) {
  const row = estimates.get(no);
  if (!row) return undefined;

  let filter = 'all';
  const sheet = drawer.open({
    title: `History — ${esc(no)}`,
    sub: `${esc(estimates.subjectName(row))} · ${esc(estimates.coverLabel(row))} · append-only`,
    icon: 'history',
    body: estimateHistoryHtml(no, filter),
  });

  sheet.el.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter]');
    if (!chip) return;
    filter = chip.dataset.filter;
    sheet.el.querySelector('.drawer__body').innerHTML = estimateHistoryHtml(no, filter);
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
        ? 'Nothing has happened to this estimate yet. Every save, issue and conversion from here on is recorded, with the user and the time.'
        : 'No entries of this kind. Choose All to see the whole trail.'}</p>
    </div>`;
}
