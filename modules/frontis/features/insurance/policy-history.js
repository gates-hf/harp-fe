// Policy history — every change made to one policy, read-only, newest first.
// The patient trail, bound to the `policy` entity: same chips, same strip, same
// drawer. A policy's id is what the audit rows are keyed on, so one query
// returns the whole life of the record — including the priority changes it
// picked up when a policy beside it left the chain.

import * as audit from '../../../../data/repositories/audit.js';
import * as policies from '../../../../data/repositories/policies.js';
import * as drawer from '../../../../shared/drawer.js';
import { dateTime, esc } from '../../../../shared/format.js';

const ENTITY = 'policy';

export const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'details', label: 'Details' },
  { id: 'status', label: 'Status' },
  { id: 'priority', label: 'Priority' },
  { id: 'merge', label: 'Merge' },
];

const GROUPS = {
  details: ['Added', 'Updated'],
  status: ['Suspended', 'Cancelled', 'Reactivated', 'Expired'],
  priority: ['Priority changed', 'Priority compacted'],
  merge: ['Re-linked'],
};

/** The chips and the trail, ready to drop into a drawer body. */
export function policyHistoryHtml(policyId, filter = 'all') {
  const entries = audit.forEntity(ENTITY, policyId).filter((row) => keep(row, filter));
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

/** View history — the trail beside the tab, in the shared sheet. */
export async function openPolicyHistory(policyId) {
  const policy = policies.get(policyId);
  if (!policy) return undefined;

  let filter = 'all';
  const sheet = drawer.open({
    title: `History — ${esc(policies.payerName(policy))}`,
    sub: `${esc(policy.memberId)} · ${esc(policies.planName(policy))} · append-only`,
    icon: 'history',
    body: policyHistoryHtml(policyId, filter),
  });

  sheet.el.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter]');
    if (!chip) return;
    filter = chip.dataset.filter;
    sheet.el.querySelector('.drawer__body').innerHTML = policyHistoryHtml(policyId, filter);
  });

  return sheet.closed;
}

function keep(entry, filter) {
  if (filter === 'all') return true;
  return (GROUPS[filter] || []).includes(entry.action);
}

// Field changes are stored as "plan: A → B; valid to: C → D" — one line each,
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
        ? 'This policy was seeded with the demo data, so nothing has been changed on it yet. Every edit, suspension and reorder from here on is recorded, with the user and the time.'
        : 'No entries of this kind. Choose All to see the whole trail.'}</p>
    </div>`;
}
