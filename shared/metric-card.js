// The design system's metric-rail card, built in one place for every screen
// that shows one. A KPI card is a control, not a label: it either opens the
// screen holding the rows it counts, or it acts on the page it already sits on
// — selecting the slice it counts, so the number on the card and the rows under
// it are the same thing, or sorting the table by the column it summarises.
//
// Markup only, no state: the screen owns what a click means. It reads
// `metricKey(event)` in the delegated handler it already has and moves its own
// filters, the way it does for any other control.

import { esc } from './format.js';

/**
 * One card.
 *
 * `href` makes it an `<a>` — navigation has to survive a middle click — and
 * `key` a `<button>` carrying `data-kpi`. A card with neither is the plain
 * `<div>` the design system reserves for a number nothing can act on.
 *
 * `pressed` — a boolean, not left undefined — makes the button a toggle and
 * says whether the page is showing that slice now; the design system tints a
 * pressed card. Leave it out for a card that acts without holding a state, such
 * as one that jumps to the panel explaining it.
 *
 * `raw` keeps composed markup in the value (the denial card's inline arrow);
 * `text` is the design system's smaller value, for a word rather than a number.
 */
export function metricCardHtml({
  value, label, sub = '', tone = '', title = '',
  href = '', key = '', pressed, raw = false, text = false,
}) {
  const cls = `metric-rail-card${tone ? ` metric-rail-card--${tone}` : ''}`;
  const tip = title ? ` title="${esc(title)}"` : '';
  const inner =
    `<span class="metric-rail-card__value${text ? ' metric-rail-card__value--text' : ''}">${raw ? value : esc(value)}</span>` +
    `<span class="metric-rail-card__label">${esc(label)}</span>` +
    (sub ? `<span class="metric-rail-card__sub">${esc(sub)}</span>` : '');

  if (href) return `<a class="${cls}" href="${esc(href)}"${tip}>${inner}</a>`;
  if (key) {
    const toggle = typeof pressed === 'boolean' ? ` aria-pressed="${pressed}"` : '';
    return `<button type="button" class="${cls}" data-kpi="${esc(key)}"${toggle}${tip}>${inner}</button>`;
  }
  return `<div class="${cls}"${tip}>${inner}</div>`;
}

/** A whole rail's worth of cards. The `.metric-rail` element itself is markup. */
export const metricRailHtml = (cards) => cards.map((c) => metricCardHtml(c)).join('');

/** The key of the card a click landed on, or '' — for a delegated handler. */
export const metricKey = (e) => e.target.closest('[data-kpi]')?.dataset.kpi || '';

/**
 * The list half of the pattern, for a screen whose cards count slices of the
 * table under them. `map` reads card key -> the filter state that card selects,
 * with `all` holding the cleared state every other entry is merged onto.
 *
 * `showing(key)` is the card's pressed state: the page is showing that slice
 * and nothing else, so the card's number is the row count. `select(key)`
 * applies the slice, or clears back to `all` when it is already the one on
 * screen. Both work on the screen's own state object; the screen redraws.
 */
export function kpiFilter(state, map) {
  const showing = (key) =>
    Object.entries({ ...map.all, ...map[key] }).every(([k, v]) => state[k] === v);
  const select = (key) => Object.assign(state, { ...map.all, ...(showing(key) ? {} : map[key]) });
  return { showing, select };
}
