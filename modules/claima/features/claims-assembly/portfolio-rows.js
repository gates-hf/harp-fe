// The portfolio's table — the same rows whether the screen is flat or grouped
// by payer or status, so the three views cannot drift. A group is a
// `<details>` whose `<summary>` carries the count and the total, the
// collapsible the design system needs no CSS for.

import * as claims from '../../../../data/repositories/claims.js';
import { esc, usd } from '../../../../shared/format.js';
import {
  ageHtml, contractHtml, coverLabel, downstreamNote, encounterHtml, isWithheld, kindHtml, patientHtml, scrubHtml,
  staleHtml, statusHtml, valueHtml, withheldCell,
} from './claim-chips.js';
import { finalizeBlocker } from './claim-actions.js';

export function groupHtml({ title, rows, role, state }) {
  const total = rows.reduce((n, c) => n + (Number(c.totals?.payerShare) || 0), 0);
  const ready = rows.filter((c) => c.status === 'Ready').length;
  return `
    <details open>
      <summary class="panel-header">
        <span>${esc(title)}</span>
        <span class="badge">${rows.length}</span>
        <span class="spacer"></span>
        ${ready ? `<span class="badge badge--success">${ready} ready</span>` : ''}
        <span class="t-mono-sm">${esc(usd(total))}</span>
      </summary>
      ${rowsTableHtml(rows, role, state)}
    </details>`;
}

export function rowsTableHtml(rows, role, state) {
  const allSelected = rows.length > 0 && rows.every((c) => state.selected.has(c.id));
  return `
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col"><input type="checkbox" data-select="all" aria-label="Select every row"${allSelected ? ' checked' : ''}></th>
          <th scope="col">Claim no.</th>
          <th scope="col">Patient</th>
          <th scope="col">Encounter</th>
          <th scope="col">Payer / plan</th>
          <th scope="col">Contract</th>
          <th scope="col">Status</th>
          <th scope="col">Scrub</th>
          <th scope="col">Value</th>
          <th scope="col">Age</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>${rows.map((c) => rowHtml(c, role, state)).join('')}</tbody>
    </table>`;
}

/**
 * A row the desk no longer owns — submitted, or answered — is read-only: it
 * opens and it has a history, and the Actions cell says where it is managed.
 * A restricted record's cover and money are withheld, the rest of the row not.
 */
function rowHtml(claim, role, state) {
  const masked = isWithheld(claim, role);
  const editable = claims.isEditable(claim);
  const draft = claim.status === 'Draft';
  const blocker = finalizeBlocker(claim);
  return `
    <tr data-id="${esc(claim.id)}" tabindex="0" title="Open ${esc(claim.claimNo)}">
      <td><input type="checkbox" data-select="${esc(claim.id)}" aria-label="Select ${esc(claim.claimNo)}"${
        state.selected.has(claim.id) ? ' checked' : ''}${editable ? '' : ' disabled'}></td>
      <td><span class="t-mono-sm">${esc(claim.claimNo)}</span> ${kindHtml(claim)}${
        (claim.lateLineIds || []).length ? ' <span class="badge badge--warning" title="Carries late charges">Late</span>' : ''}</td>
      <td>${patientHtml(claim, role)}</td>
      <td>${encounterHtml(claim)}</td>
      <td>${masked ? withheldCell() : esc(coverLabel(claim))}</td>
      <td>${contractHtml(claim)}</td>
      <td>${statusHtml(claim)} ${staleHtml(claim)}</td>
      <td>${scrubHtml(claim)}</td>
      <td>${masked ? withheldCell() : valueHtml(claim)}</td>
      <td>${ageHtml(claim)}</td>
      <td>
        <button class="btn btn--ghost btn--icon btn--sm" data-act="open" title="Open ${esc(claim.claimNo)}">
          <span class="icon icon--sm">visibility</span>
        </button>
        ${editable ? `
          ${action('scrub', 'fact_check', draft && !masked, draft
            ? (masked ? 'Your role reads this record masked and cannot scrub its claim' : 'Run the scrub')
            : 'A Ready claim is locked — reopen it to scrub again')}
          ${action('finalize', 'lock', !blocker && !masked, blocker || 'Finalize — Ready for submission')}
          ${action('refresh', 'sync', draft && claims.kindOf(claim) !== 'Secondary' && !masked, draft
            ? claims.kindOf(claim) === 'Secondary' ? 'A secondary claim is activated by the primary’s remittance'
              : 'Re-assemble from the visit and show what changed'
            : 'A Ready claim is locked — reopen it to refresh')}`
          : downstreamNote(claim)}
        <button class="btn btn--ghost btn--icon btn--sm" data-act="history" title="View history">
          <span class="icon icon--sm">history</span>
        </button>
      </td>
    </tr>`;
}

const action = (act, icon, allowed, why) => `
  <button class="btn btn--ghost btn--icon btn--sm" data-act="${act}"${allowed ? '' : ' disabled'} title="${esc(why)}">
    <span class="icon icon--sm">${icon}</span>
  </button>`;

export function emptyHtml(state) {
  const filtered = state.q || state.status || state.payerId || state.scrub || state.band || state.age || state.stale
    || state.from || state.to;
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">${filtered ? 'search_off' : 'inventory_2'}</span></div>
      <div class="state-view__title">${filtered ? 'No claims found' : 'Nothing in assembly'}</div>
      <p class="state-view__body">${filtered
        ? 'No claim matches. Change the search text or clear the filters to see the whole portfolio.'
        : 'Every coded visit has been finalized and sent on. A claim appears here the moment a chart is marked coded, or a late charge lands on a visit that was already billed.'}</p>
      <div class="state-view__actions">
        ${filtered ? '<button class="btn btn--secondary" data-act="clear">Clear filters</button>' : ''}
        ${state.view !== 'all' ? '<button class="btn btn--secondary" data-scope="all">Show every claim</button>' : ''}
      </div>
    </div>`;
}
