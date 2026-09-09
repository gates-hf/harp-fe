// Patient history — every change made to one record, read-only, newest first.
// Same shape as the payer and contract trails, wearing the audit strip.
//
// Two readers use the same markup: the History tab on the record page, and the
// View history row action, which opens it in the shared drawer beside the list.

import * as audit from '../../../../data/repositories/audit.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as drawer from '../../../../shared/drawer.js';
import { dateTime, esc } from '../../../../shared/format.js';
import { current as currentRole } from '../../../../shared/roles.js';

export const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'edits', label: 'Edits' },
  { id: 'status', label: 'Status' },
  { id: 'documents', label: 'Documents' },
  { id: 'merge', label: 'Merge' },
  { id: 'import', label: 'Import' },
];

const GROUPS = {
  edits: ['Registered', 'Updated', 'Identifier changed'],
  status: ['Marked deceased', 'Blocked', 'Unblocked', 'Status changed', 'VIP set', 'VIP cleared'],
  documents: ['Document added', 'Document removed'],
  merge: ['Merged', 'Merged in', 'Duplicate flagged', 'Duplicate dismissed', 'Duplicate override'],
  import: ['Imported'],
};

/** The chips and the trail, ready to drop into a tab panel or a drawer body. */
export function historyHtml(mrn, filter = 'all') {
  const entries = audit.forEntity('patients', mrn).filter((row) => keep(row, filter));
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

/** View history — the same trail beside the list rather than on the record. */
export async function openPatientHistory(mrn) {
  const patient = patients.view(patients.get(mrn), currentRole());
  if (!patient) return undefined;

  let filter = 'all';
  const sheet = drawer.open({
    title: `History — ${esc(patient.nameEn)}`,
    sub: `${esc(patient.mrn)} · append-only`,
    icon: 'history',
    body: historyHtml(mrn, filter),
  });

  sheet.el.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter]');
    if (!chip) return;
    filter = chip.dataset.filter;
    sheet.el.querySelector('.drawer__body').innerHTML = historyHtml(mrn, filter);
  });

  return sheet.closed;
}

function keep(entry, filter) {
  if (filter === 'all') return true;
  return (GROUPS[filter] || []).includes(entry.action);
}

// Field changes are stored as "phone: A → B; city: C → D" — one line each, so a
// reader sees what moved rather than a paragraph.
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
        ? 'Every edit, status change, document and merge on this record is recorded here, with the user and the time.'
        : 'No entries of this kind. Choose All to see the whole trail.'}</p>
    </div>`;
}
