// Claim history — every change made to one claim, read-only, newest first:
// assembly, refreshes with their diff, scrub runs, acknowledgments, finalize
// and reopen. The pre-auth trail's shape, bound to the `claims` entity.
//
// Two readers use the same markup: the claim page's History tab and the View
// history row action, which opens it in the shared drawer beside the portfolio.

import * as claims from '../../../../data/repositories/claims.js';
import * as drawer from '../../../../shared/drawer.js';
import { dateTime, esc } from '../../../../shared/format.js';
import { diffHtml } from './claim-refresh.js';

export const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'assembly', label: 'Assembly' },
  { id: 'scrub', label: 'Scrub' },
  { id: 'lifecycle', label: 'Lifecycle' },
];

const GROUPS = {
  assembly: ['Created', 'Refreshed', 'Stale', 'Late charge added', 'Attachment added', 'Attachment removed', 'Attachment linked', 'Re-linked'],
  scrub: ['Scrubbed', 'Warning acknowledged'],
  lifecycle: ['Status', 'Updated'],
};

/** The chips and the trail, ready to drop into a panel or a drawer body. */
export function historyHtml(id, filter = 'all') {
  const claim = claims.get(id);
  const entries = claims.history(claim?.id).filter((row) => keep(row, filter));
  return `
    <div class="toolbar">
      <span class="t-title-sm">Changes</span>
      <span class="spacer"></span>
      <div class="segmented" role="group" aria-label="Filter history">
        ${FILTERS.map((f) => `<button data-filter="${f.id}" aria-pressed="${f.id === filter}">${f.label}</button>`).join('')}
      </div>
    </div>
    ${entries.length ? `<ol class="journey">${entries.map((e) => rowHtml(e, claim)).join('')}</ol>` : emptyHtml(filter)}`;
}

/** View history — the same trail beside the portfolio rather than on the page. */
export async function openClaimHistory(id) {
  const claim = claims.get(id);
  if (!claim) return undefined;
  let filter = 'all';
  const sheet = drawer.open({
    title: `History — ${esc(claim.claimNo)}`,
    sub: `${esc(claims.kindOf(claim).toLowerCase())} · ${esc(claim.status.toLowerCase())} · append-only`,
    icon: 'history',
    body: historyHtml(claim.id, filter),
  });
  sheet.el.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter]');
    if (chip) {
      filter = chip.dataset.filter;
      sheet.el.querySelector('.drawer__body').innerHTML = historyHtml(claim.id, filter);
    }
  });
  return sheet.closed;
}

function keep(entry, filter) {
  if (filter === 'all') return true;
  return (GROUPS[filter] || []).includes(entry.action);
}

/**
 * A refresh entry carries its diff inline, read off the claim's own refreshes
 * by time — the trail line says what moved, the table under it says how.
 */
function rowHtml(entry, claim) {
  const parts = String(entry.details || '').split('; ');
  const refresh = entry.action === 'Refreshed'
    ? (claim?.refreshes || []).find((r) => Math.abs(Date.parse(r.at) - Date.parse(entry.at)) < 2000) : null;
  return `
    <li class="journey__row">
      <span class="journey__at t-mono-sm">${dateTime(entry.at)}</span>
      <span class="journey__action">${esc(entry.action)}</span>
      <span class="journey__actor">${esc(entry.user)}</span>
      <span class="journey__detail">${parts.filter(Boolean).map((p) => esc(p)).join('<br>')}${refresh
        ? `<details><summary class="t-body-sm">Show the diff</summary>${diffHtml(refresh.diff)}</details>` : ''}</span>
    </li>`;
}

function emptyHtml(filter) {
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">history</span></div>
      <div class="state-view__title">Nothing recorded yet</div>
      <p class="state-view__body">${filter === 'all'
        ? 'Every change to this claim — its assembly, each refresh and what it moved, every scrub run and acknowledgment, and when it was finalized or reopened — is recorded here, with the user and the time.'
        : 'No entries of this kind. Choose All to see the whole trail.'}</p>
    </div>`;
}
