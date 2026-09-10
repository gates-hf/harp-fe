// Remittance history — every change made to one remittance, read-only, newest
// first: capture, claims added and matched, postings with their fan-out,
// patient shifts, hand-offs, exceptions resolved, reversals, close. The claim
// trail's shape, bound to the `remittances` entity.
//
// Two readers use the same markup: the remittance page's History tab and the
// View history row action, which opens it in the shared drawer.

import * as remittances from '../../../../data/repositories/remittances.js';
import * as drawer from '../../../../shared/drawer.js';
import { dateTime, esc } from '../../../../shared/format.js';

export const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'capture', label: 'Capture' },
  { id: 'posting', label: 'Posting' },
  { id: 'exceptions', label: 'Exceptions' },
];

const GROUPS = {
  capture: ['Captured', 'Updated', 'Claim added', 'Claim removed', 'Matched'],
  posting: ['Posted', 'Reversed', 'Patient shift', 'Handed off', 'Secondary activated', 'Closed'],
  exceptions: ['Exception resolved', 'Matched'],
};

/** The chips and the trail, ready to drop into a panel or a drawer body. */
export function historyHtml(no, filter = 'all') {
  const entries = remittances.history(no).filter((row) => filter === 'all' || (GROUPS[filter] || []).includes(row.action));
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

/** View history — the same trail beside the workbench rather than on the page. */
export async function openRemittanceHistory(no) {
  const rem = remittances.get(no);
  if (!rem) return undefined;
  let filter = 'all';
  const sheet = drawer.open({
    title: `History — ${esc(rem.remittanceNo)}`,
    sub: `${esc(rem.status.toLowerCase())} · append-only`,
    icon: 'history',
    body: historyHtml(no, filter),
  });
  sheet.el.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter]');
    if (chip) {
      filter = chip.dataset.filter;
      sheet.el.querySelector('.drawer__body').innerHTML = historyHtml(no, filter);
    }
  });
  return sheet.closed;
}

function rowHtml(entry) {
  const parts = String(entry.details || '').split(' · ');
  return `
    <li class="journey__row">
      <span class="journey__at t-mono-sm">${dateTime(entry.at)}</span>
      <span class="journey__action">${esc(entry.action)}</span>
      <span class="journey__actor">${esc(entry.user)}</span>
      <span class="journey__detail">${parts.length > 3 ? parts.map((p) => esc(p)).join('<br>') : esc(entry.details || '')}</span>
    </li>`;
}

function emptyHtml(filter) {
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">history</span></div>
      <div class="state-view__title">Nothing recorded yet</div>
      <p class="state-view__body">${filter === 'all'
        ? 'Every change to this remittance — its capture, each claim matched, every posting and what it did, and every reversal — is recorded here, with the user and the time.'
        : 'No entries of this kind. Choose All to see the whole trail.'}</p>
    </div>`;
}
