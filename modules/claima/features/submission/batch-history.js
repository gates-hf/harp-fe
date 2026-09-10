// Batch history — every change made to one batch, read-only, newest first:
// created, claims added or excluded, validated with its ejections, each
// generation, the submission, the acknowledgment, every rejection, closed.
// The claim history's shape, bound to the `batches` entity. Two readers use
// the same markup: the batch page's History tab and the View history row
// action, which opens it in the shared drawer beside the table.

import * as batches from '../../../../data/repositories/batches.js';
import * as drawer from '../../../../shared/drawer.js';
import { dateTime, esc } from '../../../../shared/format.js';

export const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'contents', label: 'Contents' },
  { id: 'files', label: 'Files' },
  { id: 'payer', label: 'Payer' },
];

const GROUPS = {
  contents: ['Created', 'Claims added', 'Claim excluded', 'Validated'],
  files: ['Generated'],
  payer: ['Submitted', 'Acknowledged', 'Rejection recorded', 'Closed'],
};

/** The chips and the trail, ready to drop into a panel or a drawer body. */
export function historyHtml(batchNo, filter = 'all') {
  const entries = batches.history(batchNo).filter((row) => filter === 'all' || (GROUPS[filter] || []).includes(row.action));
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

/** View history — the same trail beside the table rather than on the page. */
export async function openBatchHistory(batchNo) {
  const batch = batches.get(batchNo);
  if (!batch) return undefined;
  let filter = 'all';
  const sheet = drawer.open({
    title: `History — ${esc(batch.batchNo)}`,
    sub: `${esc(batch.mode.toLowerCase())} · ${esc(batch.status.toLowerCase())} · append-only`,
    icon: 'history',
    body: historyHtml(batch.batchNo, filter),
  });
  sheet.el.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter]');
    if (chip) {
      filter = chip.dataset.filter;
      sheet.el.querySelector('.drawer__body').innerHTML = historyHtml(batch.batchNo, filter);
    }
  });
  return sheet.closed;
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
    ? 'Every change to this batch — what went in and came out, each generation, the submission, the payer’s answer — is recorded here, with the user and the time.'
    : 'No entries of this kind. Choose All to see the whole trail.'}</p>
    </div>`;
}
