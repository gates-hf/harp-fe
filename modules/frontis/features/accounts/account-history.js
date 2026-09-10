// Account history — everything that has happened to one patient's money,
// read-only and newest first. The patient trail bound to the `account` entity:
// same chips, same strip, same drawer.
//
// The account's id is the MRN, and every ledger row is audited against it, so
// one query returns the whole financial life of a record whatever wrote it —
// a posting, a payment, a deposit or a correction.

import * as audit from '../../../../data/repositories/audit.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as drawer from '../../../../shared/drawer.js';
import { dateTime, esc } from '../../../../shared/format.js';

const ENTITY = 'account';

export const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'charges', label: 'Charges' },
  { id: 'money', label: 'Money in' },
  { id: 'corrections', label: 'Corrections' },
];

const GROUPS = {
  charges: ['Charge'],
  money: ['Payment', 'DepositHeld', 'DepositApplied', 'Allocation'],
  corrections: ['Reversal', 'DepositRefund', 'Adjustment', 'Refund', 'Re-linked'],
};

/** The chips and the trail, ready to drop into a tab body or a drawer. */
export function accountHistoryHtml(mrn, filter = 'all') {
  const entries = audit.forEntity(ENTITY, mrn).filter((row) => keep(row, filter));
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
export async function openAccountHistory(mrn) {
  const patient = patients.get(mrn);
  let filter = 'all';
  const sheet = drawer.open({
    title: `History — ${esc(mrn)}`,
    sub: `${esc(patient?.nameEn || mrn)} · append-only`,
    icon: 'history',
    body: accountHistoryHtml(mrn, filter),
  });

  sheet.el.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter]');
    if (!chip) return;
    filter = chip.dataset.filter;
    sheet.el.querySelector('.drawer__body').innerHTML = accountHistoryHtml(mrn, filter);
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
        ? 'No money has moved on this account yet. Every charge, payment and correction from here on is recorded, with the user and the time.'
        : 'No entries of this kind. Choose All to see the whole trail.'}</p>
    </div>`;
}
