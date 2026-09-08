// The right-hand half of the billing simulator: the priced result. It is one
// file rather than three hundred more lines of simulator.js — that screen holds
// the encounter form and the actions, this one holds what the engine answered.
//
// breakdown-panel.js still owns the panels and the invoice table; this file is
// the page around them, and the redraw that lets a KPI card select the lines
// behind its total without collapsing a breakdown the reader has opened.

import * as contracts from '../../../../data/repositories/contracts.js';
import { invoiceRows } from '../../../../data/engines/billing-engine.js';
import { breakdownHtml, totalsRailHtml, invoiceTableHtml, INVOICE_FILTERS } from './breakdown-panel.js';
import { date, esc } from '../../../../shared/format.js';

/** `state` is the simulator's own: the outcome to draw and the line filter. */
export function resultView(mount, state) {
  const $ = (sel) => mount.querySelector(sel);

  function drawResult() {
    const box = $('#bs-result');
    if (!state.outcome) {
      box.innerHTML = stateView('play_circle', 'Nothing run yet',
        'Choose a payer, a plan and the charges, then run the encounter. Or load one of the canned scenarios from the header.');
      return;
    }
    const { contract, error, traces, totals } = state.outcome;
    if (error) {
      box.innerHTML = stateView('error', 'No contract to price against', error);
      return;
    }
    box.innerHTML = `
      <div class="toolbar">
        <span class="t-title-sm">${esc(contract.contractNo)} v${contract.version}</span>
        <span class="badge badge--accent">${esc(contracts.payerName(contract))}</span>
        <span class="badge">${esc(contracts.planNameOf(contract, state.planId))}</span>
        <span class="spacer"></span>
        <span class="t-body-sm">Date of service ${date(state.encounter.dateOfService)}</span>
      </div>
      <div id="bs-totals"></div>
      <div class="toolbar">
        <span class="t-title-sm">Breakdown</span>
        <span class="spacer"></span>
        <span class="t-body-sm">${traces.length} charge line${traces.length === 1 ? '' : 's'} — open one to read its five steps</span>
      </div>
      ${traces.map((trace, i) => breakdownHtml(trace, { open: i === 0 })).join('')}
      <div class="toolbar">
        <span class="t-title-sm">Invoice preview</span>
        <span class="spacer"></span>
        <span class="t-body-sm" id="bs-invoice-note"></span>
      </div>
      <div id="bs-invoice"></div>`;
    drawInvoice();
  }

  /**
   * The totals rail and the invoice under it. A KPI card selects the lines
   * behind its number, and only this pair redraws — the breakdown panels
   * between them keep whichever ones the reader has opened.
   */
  function drawInvoice() {
    const { traces, totals } = state.outcome;
    const rows = invoiceRows(traces);
    const only = INVOICE_FILTERS[state.lineFilter] || INVOICE_FILTERS.all;
    const shown = rows.filter(only.test);
    const overage = rows.filter((r) => r.isOverage).length;
    $('#bs-totals').innerHTML = totalsRailHtml(totals, state.lineFilter);
    $('#bs-invoice').innerHTML = invoiceTableHtml(shown);
    $('#bs-invoice-note').textContent = state.lineFilter === 'all'
      ? `${overage} overage line${overage === 1 ? '' : 's'} of ${rows.length}`
      : `${shown.length} of ${rows.length} line${rows.length === 1 ? '' : 's'} — ${only.words}`;
  }

  function stateView(icon, title, body) {
    return `
    <div class="state-view state-view--tall">
      <div class="state-view__glyph"><span class="icon">${icon}</span></div>
      <div class="state-view__title">${esc(title)}</div>
      <p class="state-view__body">${esc(body)}</p>
    </div>`;
  }

  return { draw: drawResult, drawInvoice };
}
