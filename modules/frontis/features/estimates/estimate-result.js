// The right-hand half of the builder: what the engine answered. It is a file of
// its own for the reason the billing simulator's result is — that screen holds
// the question, this one holds the answer — and because the totals rail has to
// redraw the lines table under it without collapsing a breakdown the reader has
// opened.
//
// estimate-doc.js owns everything the document also shows, so what is on screen
// before issuing and what is printed after it cannot drift apart. What this
// file adds is the part that is only useful while the price can still change:
// the five-step trace behind each line.

import { breakdownHtml, INVOICE_FILTERS } from '../../../../shared/billing-breakdown.js';
import { date, esc } from '../../../../shared/format.js';
import {
  contractChipHtml, disclaimerHtml, exclusionsHtml, flagsHtml, limitsHtml, linesTableHtml, totalsRailHtml,
} from './estimate-doc.js';

/** `state` is the builder's own: the outcome to draw and the line filter. */
export function resultView(mount, state) {
  const $ = (sel) => mount.querySelector(sel);

  function draw() {
    const box = $('#eb-result');
    if (!state.outcome) {
      box.innerHTML = stateView('calculate', 'Nothing priced yet',
        'Choose who this is for, the cover and the services, then simulate. Nothing is written until the estimate is saved or issued.');
      return;
    }
    if (state.outcome.error) {
      box.innerHTML = stateView('error', 'Nothing prices these services', state.outcome.error);
      return;
    }
    const result = state.outcome;
    box.innerHTML = `
      <div class="toolbar">
        <span class="t-title-sm">Priced on ${esc(date(result.dateOfService))}</span>
        <span class="spacer"></span>
        <span class="t-body-sm">${result.rows.length} line${result.rows.length === 1 ? '' : 's'}</span>
      </div>
      ${contractChipHtml(result)}
      <div id="eb-totals"></div>
      ${flagsHtml(result.preAuthFlags)}
      ${exclusionsHtml(result.exclusions)}
      <div class="toolbar">
        <span class="t-title-sm">Quotation</span>
        <span class="spacer"></span>
        <span class="t-body-sm" id="eb-lines-note"></span>
      </div>
      <div id="eb-quote"></div>
      ${limitsHtml(result.limits)}
      ${result.lines.length
        ? `<div class="toolbar">
             <span class="t-title-sm">How each line was priced</span>
             <span class="spacer"></span>
             <span class="t-body-sm">open one to read its five steps</span>
           </div>
           ${result.lines.map((trace, i) => breakdownHtml(trace, { open: i === 0 })).join('')}`
        : `<p class="t-body-sm">There is no agreement behind these prices, so there are no steps to read: every
             line is the charge master's own price and the patient carries it.</p>`}
      ${disclaimerHtml(result.disclaimer)}`;
    drawTotals();
  }

  /**
   * The totals rail and the quotation under it. A card selects the lines behind
   * its number, and only this pair redraws — the traces below keep whichever
   * ones the reader has opened.
   */
  function drawTotals() {
    const result = state.outcome;
    const only = INVOICE_FILTERS[state.lineFilter] || INVOICE_FILTERS.all;
    const shown = result.rows.filter(only.test);
    $('#eb-totals').innerHTML = totalsRailHtml(result, state.lineFilter);
    $('#eb-quote').innerHTML = linesTableHtml(shown);
    $('#eb-lines-note').textContent = state.lineFilter === 'all'
      ? 'every line, at the agreed rates'
      : `${shown.length} of ${result.rows.length} line${result.rows.length === 1 ? '' : 's'} — ${only.words}`;
  }

  function stateView(icon, title, body) {
    return `
      <div class="state-view state-view--tall">
        <div class="state-view__glyph"><span class="icon">${icon}</span></div>
        <div class="state-view__title">${esc(title)}</div>
        <p class="state-view__body">${esc(body)}</p>
      </div>`;
  }

  return { draw, drawTotals };
}
