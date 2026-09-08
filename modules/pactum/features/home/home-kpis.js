// The six numbers at the top of the Pactum home screen. Each is read from a
// repository and links to the list it was counted from — the headline and the
// row count of the screen it opens are the same figure, so a demo can click
// through and reconcile.
//
// The sub-line is the design system's `.metric-rail-card__sub` — the card
// grows a row for it — and it stays in the card's `title` as well, so the
// tooltip reads the whole card the way it does on every other rail.

import * as payers from '../../../../data/repositories/payers.js';
import * as cdm from '../../../../data/repositories/cdm.js';
import * as contracts from '../../../../data/repositories/contracts.js';
import { esc } from '../../../../shared/format.js';

/** The window "Expiring soon" means, here and on the attention panel. */
export const EXPIRY_WINDOW = 60;

export function cards() {
  const p = payers.counts();
  const c = contracts.counts();
  const k = cdm.counts();
  const expiring = contracts.expiringWithin(EXPIRY_WINDOW).length;
  const flagged = cdm.flaggedBundles().length;
  const activeItems = cdm.list({ kind: 'item', status: 'Active' }).length;
  const ready = readyDrafts().length;

  return [
    {
      value: p.total,
      label: 'Payers',
      sub: `${p.active} active`,
      href: '#/pactum/payers',
    },
    {
      value: c.active,
      label: 'Active contracts',
      sub: `across ${c.payers} payer${c.payers === 1 ? '' : 's'}`,
      href: '#/pactum/contracts?status=Active',
    },
    {
      value: expiring,
      label: 'Expiring soon',
      sub: `within ${EXPIRY_WINDOW} days`,
      href: `#/pactum/contracts?expiring=${EXPIRY_WINDOW}`,
      tone: expiring ? 'warning' : '',
    },
    {
      value: c.draft,
      label: 'Draft contracts',
      sub: `${ready} ready to activate`,
      href: '#/pactum/contracts?status=Draft',
    },
    {
      value: k.items,
      label: 'CDM items',
      sub: `${activeItems} active`,
      href: '#/pactum/cdm?kind=item',
    },
    {
      value: k.bundles,
      label: 'Bundles',
      sub: `${flagged} flagged for review`,
      href: '#/pactum/cdm/bundles',
      tone: flagged ? 'warning' : '',
    },
  ];
}

/** Drafts with nothing standing between them and Activate. */
export function readyDrafts() {
  return contracts.list({ status: 'Draft' }).filter((d) => !contracts.activationBlockers(d).length);
}

export function kpisHtml() {
  return cards().map(cardHtml).join('');
}

function cardHtml(c) {
  return `
    <a class="metric-rail-card${c.tone ? ` metric-rail-card--${c.tone}` : ''}"
       href="${esc(c.href)}" title="${esc(c.label)} — ${esc(c.sub)}">
      <span class="metric-rail-card__value">${esc(c.value)}</span>
      <span class="metric-rail-card__label">${esc(c.label)}</span>
      <span class="metric-rail-card__sub">${esc(c.sub)}</span>
    </a>`;
}
