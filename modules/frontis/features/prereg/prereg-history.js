// Pre-registration history — every change made to one pre-registration,
// read-only, newest first. The encounter trail's shape, bound to the `prereg`
// entity.
//
// Two readers use the same markup: the form's own History panel and the View
// history row action, which opens it in the shared drawer beside the worklist.

import * as audit from '../../../../data/repositories/audit.js';
import * as prereg from '../../../../data/repositories/prereg.js';
import * as drawer from '../../../../shared/drawer.js';
import { dateTime, esc } from '../../../../shared/format.js';

export const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'lifecycle', label: 'Lifecycle' },
  { id: 'capture', label: 'Capture' },
  { id: 'checks', label: 'Pre-checks' },
];

const GROUPS = {
  lifecycle: ['Created', 'Ready', 'Reopened', 'Converted', 'Cancelled', 'Expired', 'Reactivated'],
  capture: ['Updated', 'Linked', 'Unlinked', 'Re-linked', 'Insurance'],
  checks: ['Pre-check'],
};

/** The chips and the trail, ready to drop into a panel or a drawer body. */
export function historyHtml(no, filter = 'all') {
  const entries = audit.forEntity('prereg', no).filter((row) => keep(row, filter));
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
export async function openPreregHistory(no) {
  const row = prereg.get(no);
  if (!row) return undefined;

  let filter = 'all';
  const sheet = drawer.open({
    title: `History — ${esc(no)}`,
    sub: `${esc(prereg.patientName(row))} · ${esc(prereg.typeLabel(row.visit.type))} · append-only`,
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

// Field changes are stored as "a → b; c → d" — one line each, so a reader sees
// what moved rather than a paragraph.
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
        ? 'Every change to this pre-registration — what was captured, the cover attached, each pre-check and the conversion itself — is recorded here, with the user and the time.'
        : 'No entries of this kind. Choose All to see the whole trail.'}</p>
    </div>`;
}
