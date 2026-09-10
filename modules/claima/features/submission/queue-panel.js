// The ready queue by payer — one row per payer with Ready claims in no open
// batch: how many, what they are worth, how the payer takes them, when the
// cycle falls, how long the oldest has waited, and the one button that moves
// them: Create batch, or Add to the batch the payer already has open.

import * as batches from '../../../../data/repositories/batches.js';
import { esc, usd } from '../../../../shared/format.js';
import { cycleChip, modeHtml } from './batch-chips.js';

export function queueHtml(rows, state) {
  if (!rows.length) return emptyHtml(state);
  return `
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">Payer</th>
          <th scope="col">Claims</th>
          <th scope="col">Value</th>
          <th scope="col">Mode</th>
          <th scope="col">Cycle</th>
          <th scope="col">Oldest</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>${rows.map(rowHtml).join('')}</tbody>
    </table>`;
}

function rowHtml(r) {
  const tone = r.oldestAge > 14 ? 'critical' : r.oldestAge > 7 ? 'warning' : '';
  const open = r.openBatch;
  return `
    <tr data-payer="${esc(r.payerId)}">
      <td>${esc(r.payer?.nameEn || r.payerId)}<br><span class="t-body-sm">${esc(r.payer?.type || '')}</span></td>
      <td><span class="badge">${r.count}</span></td>
      <td><span class="t-mono-sm">${esc(usd(r.value))}</span></td>
      <td>${modeHtml(r.mode)}</td>
      <td>${cycleChip({ cycle: r.cycle })}</td>
      <td><span class="badge${tone ? ` badge--${tone}` : ''}" title="Days since the oldest claim in the queue was finalized">${r.oldestAge} d</span></td>
      <td>
        ${open
    ? `<button class="btn btn--secondary btn--sm" data-act="add" title="${esc(open.batchNo)} is still open for ${esc(r.payer?.nameEn || r.payerId)} — add these ${r.count} claim${r.count === 1 ? '' : 's'} to it">
             <span class="icon icon--sm">playlist_add</span>Add to ${esc(open.batchNo)}</button>`
    : `<button class="btn btn--primary btn--sm" data-act="create" title="Open a ${esc(r.mode.toLowerCase())} batch holding these ${r.count} claim${r.count === 1 ? '' : 's'}">
             <span class="icon icon--sm">add</span>Create batch</button>`}
      </td>
    </tr>`;
}

function emptyHtml(state) {
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">${state.due ? 'event_available' : 'outbox'}</span></div>
      <div class="state-view__title">${state.due ? 'Nothing due today' : 'Nothing waiting for submission.'}</div>
      <p class="state-view__body">${state.due
    ? 'No payer whose cycle falls today has claims waiting. Clear the card to see the whole queue.'
    : 'A claim joins the queue the moment it is finalized on the portfolio. Everything Ready is already in an open batch.'}</p>
      <div class="state-view__actions">
        ${state.due ? '<button class="btn btn--secondary" data-act="clear">Show the whole queue</button>' : '<a class="btn btn--secondary" href="#/claima/claims?status=Ready">Open the portfolio</a>'}
      </div>
    </div>`;
}
