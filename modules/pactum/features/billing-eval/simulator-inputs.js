// The input rail's markup: the resolved-contract answer and the charge-line
// cards. Markup only — simulator.js owns the state and the events, so the rail
// and the result panel each stay near the line cap.

import * as cdm from '../../../../data/repositories/cdm.js';
import * as contracts from '../../../../data/repositories/contracts.js';
import { consumptionHtml } from '../../../../shared/consumption-table.js';
import { optionsHtml } from '../contracts/fee-schedule.js';
import { date, esc, usd } from '../../../../shared/format.js';

const NEAR_MISSES = 3;

/**
 * What the payer, plan and date resolve to. Three answers, never one warning
 * for all of them: nothing chosen yet is a hint, a contract found is the chip,
 * and nothing covering the plan names the versions that came closest.
 */
export function contractHtml({ contract, payerId, planId, on }) {
  if (!payerId || !planId) {
    return '<p class="t-body-sm">Choose a payer and a plan to see which contract prices this encounter.</p>';
  }
  if (contract) return chipHtml(contract);
  return `
    <div class="alert alert--warning">
      <span class="icon">error</span>
      <div>
        <div class="title">No contract billed this plan on ${esc(date(on))}</div>
        ${nearMissHtml(payerId, planId)}
      </div>
    </div>`;
}

function chipHtml(contract) {
  return `
    <div class="rule-child-row">
      <span class="icon">contract</span>
      <a class="crumb-link" href="#/pactum/contracts/${esc(contract.id)}">${esc(contract.contractNo)} — ${esc(contract.name)}</a>
      <span class="badge badge--accent">v${contract.version}</span>
      <span class="badge badge--${contracts.statusTone(contract.status) || ''}"><span class="dot"></span>${esc(contract.status)}</span>
      <span class="t-body-sm">${date(contract.startDate)} – ${date(contract.endDate)}</span>
    </div>`;
}

/** The versions naming this plan, so the miss reads as a date or a status. */
function nearMissHtml(payerId, planId) {
  const near = contracts
    .byPayer(payerId)
    .filter((c) => (c.planIds || []).includes(planId))
    .slice(0, NEAR_MISSES);
  if (!near.length) {
    return 'No contract on this payer names this plan. Add one from the payer’s Contracts screen.';
  }
  return `Contracts naming this plan:<br>${near
    .map((c) => `<span class="t-mono-sm">${esc(c.contractNo)} v${c.version}</span> — ${esc(c.status)} · ${
      date(c.startDate)} – ${date(c.endDate)}`)
    .join('<br>')}`;
}

// --- charge lines ------------------------------------------------------------

/** One charge line: the picker and its quantity on one row, the card's own
 *  header carrying the standard price and the remove button. */
export function lineHtml(line, i) {
  const item = cdm.get(line.itemId);
  return `
    <div class="panel panel--sunken" data-index="${i}">
      <div class="panel-header">
        <span class="t-title-sm">Line ${i + 1}</span>
        <span class="spacer"></span>
        <span class="t-body-sm">${item ? `${usd(item.standardPrice)} standard` : 'No charge chosen'}</span>
        <button class="btn btn--ghost btn--icon btn--sm" data-act="remove-line" title="Remove line ${i + 1}">
          <span class="icon icon--sm">delete</span>
        </button>
      </div>
      <div class="panel-body">
        <div class="toolbar">
          <label class="field field--grow">
            <span class="icon icon--sm">sell</span>
            <select data-field="itemId" aria-label="Charge line ${i + 1}">${optionsHtml(cdm.findActive(), line.itemId)}</select>
          </label>
          <label class="field">
            <span class="icon icon--sm">tag</span>
            <input type="number" min="1" step="1" value="${esc(line.qty)}" data-field="qty"
                   aria-label="Quantity on line ${i + 1}">
          </label>
        </div>
        ${item && cdm.isBundle(item) ? consumptionHtml(line, item) : ''}
      </div>
    </div>`;
}
