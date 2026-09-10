// The pipeline board's columns and cards — markup only, drawn from what
// data/engines/claim-events.js `board()` answers. A column is a panel in one
// scrolling row and a card is a `.row-list` row inside it: the worklist
// vocabulary the shell already ships, since the design system has no kanban.
// A card opens the claim's timeline; the claim number inside it opens the claim.

import * as lifecycle from '../../../../data/engines/claim-events.js';
import { esc, usd } from '../../../../shared/format.js';
import {
  coverLabel, daysChip, escalatedFlag, familyChip, isWithheld, kindChip, patientHtml, withheldCell,
} from './lifecycle-chips.js';

/** How many cards a column draws before it asks; the count in the header is the whole column. */
export const CARD_CAP = 40;

export function boardHtml(board, { hidden, expanded, role, statusFilter }) {
  const columns = board.columns.filter((c) => (statusFilter ? c.status === statusFilter : !hidden.has(c.status)));
  if (!columns.length) {
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">view_column</span></div>
        <div class="state-view__title">Every column is hidden</div>
        <p class="state-view__body">Open the Columns menu and switch some back on.</p>
      </div>`;
  }
  // One row that scrolls sideways: the grid names its own track count, since a
  // wrapping grid would put Denied under Draft and lose the left-to-right read.
  return `
    <div class="worklists" style="grid-template-columns: repeat(${columns.length}, minmax(236px, 1fr)); overflow-x: auto">
      ${columns.map((c) => columnHtml(c, { expanded: expanded.has(c.status), role })).join('')}
    </div>`;
}

function columnHtml(column, { expanded, role }) {
  const cards = expanded ? column.cards : column.cards.slice(0, CARD_CAP);
  const more = column.cards.length - cards.length;
  return `
    <section class="panel panel--bordered" data-column="${esc(column.status)}" aria-label="${esc(column.status)}">
      <div class="panel-header">
        <span>${esc(column.status)}</span>
        <span class="badge">${column.count}</span>
        <span class="spacer"></span>
        <span class="t-mono-sm" title="Payer share in this column">${esc(usd(column.value))}</span>
      </div>
      <div class="panel-body">
        ${cards.length ? `<ul class="row-list">${cards.map((card) => cardHtml(card, role)).join('')}</ul>`
          : '<p class="muted">No claims here.</p>'}
        ${more > 0 ? `
          <button class="btn btn--ghost btn--sm" data-expand="${esc(column.status)}"
                  title="Draw the ${more} card${more === 1 ? '' : 's'} not shown">
            <span class="icon icon--sm">expand_more</span>${more} more
          </button>` : ''}
      </div>
    </section>`;
}

/**
 * One card. The patient and the cover are withheld on a restricted record —
 * the encounter board's line — while the number, the days and the flag stay.
 */
function cardHtml(card, role) {
  const { claim, days, escalated } = card;
  const masked = isWithheld(claim, role);
  const since = lifecycle.statusSince(claim, card.events);
  return `
    <li data-no="${esc(claim.claimNo)}" tabindex="0" title="Open the timeline of ${esc(claim.claimNo)}">
      <div>
        <div>
          <a class="crumb-link t-mono-sm" href="#/claima/claims/${esc(claim.claimNo)}" title="Open the claim">${esc(claim.claimNo)}</a>
          ${kindChip(claim)} ${familyChip(card)}
        </div>
        <div class="row-list__main">${masked ? withheldCell() : patientLine(claim, role)}</div>
        <div class="t-body-sm">${masked ? '' : esc(coverLabel(claim))}</div>
        ${escalated ? `<div>${escalatedFlag(card)}</div>` : ''}
      </div>
      <div class="row-list__sub">
        ${masked ? '' : `<span class="t-mono-sm">${esc(usd(claim.totals?.payerShare))}</span><br>`}
        ${daysChip(days, since, claim.status)}
      </div>
    </li>`;
}

/** The patient cell without its MRN line — a card has no room for two lines of identifier. */
function patientLine(claim, role) {
  const html = patientHtml(claim, role);
  return html.split('<br>')[0];
}
