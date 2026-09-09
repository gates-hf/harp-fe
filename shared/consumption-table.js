// What a bundle line actually used, entered against the parent's limits. Markup
// and one small prefill, shared for the reason billing-breakdown.js is: the
// billing simulator asks this question of a claim that never happened and the
// cost estimate asks it of a visit that has not happened yet, and a second copy
// would be a second set of rules about what a bundle includes.
//
// The limits themselves come from data/engines/overage-engine.js. Nothing here
// decides anything — it draws the rows that engine names and reads the numbers
// back off the inputs.

import * as cdm from '../data/repositories/cdm.js';
import { limitRows, consumedLabel } from '../data/engines/overage-engine.js';
import { esc } from './format.js';

/**
 * A bundle line's consumption table, prefilled with what the bundle includes.
 * `line` is { itemId, qty, consumption: [{ componentId, qty | amount }] }; the
 * caller's `input` handler reads `data-consumption` and `data-unit` back.
 */
export function consumptionHtml(line, item) {
  const rows = limitRows(item.id, line.qty);
  if (!rows.length) return '<p class="t-body-sm">This bundle holds no components.</p>';
  return `
    <div class="toolbar">
      <span class="t-title-sm">Consumption</span>
      <span class="spacer"></span>
      <span class="t-body-sm">what the claim used</span>
    </div>
    <table class="tbl">
      <thead><tr><th>Component</th><th class="num">Consumed</th></tr></thead>
      <tbody>${rows.map((row) => componentRowHtml(line, row)).join('')}</tbody>
    </table>`;
}

function componentRowHtml(line, row) {
  const entry = (line.consumption || []).find((c) => c.componentId === row.componentId);
  const value = entry ? entry[row.unit] ?? row.included : row.included;
  // The rail is narrower than the result, so what the bundle includes reads
  // under the component name rather than in a column of its own.
  return `
    <tr>
      <td>
        <span class="t-mono-sm">${esc(row.item.chargeCode)}</span> ${esc(cdm.label(row.item))}
        <br><span class="t-body-sm">includes ${esc(consumedLabel(row, row.included))}</span>
      </td>
      <td class="num">
        <label class="field">
          <input type="number" min="0" step="${row.unit === 'amount' ? '0.01' : '1'}" value="${esc(value)}"
                 data-consumption="${esc(row.componentId)}" data-unit="${row.unit}"
                 aria-label="Consumed ${esc(cdm.label(row.item))}">
        </label>
      </td>
    </tr>
    ${row.inner.map((inner) => `
      <tr>
        <td colspan="2" class="t-body-sm">· ${esc(inner.item.chargeCode)} — ${esc(cdm.label(inner.item))} ×${inner.qty},
            inside ${esc(cdm.label(row.item))}</td>
      </tr>`).join('')}`;
}

/**
 * A component the claim does not name is assumed to have been consumed exactly
 * to its limit, so a new bundle line starts at what it includes rather than at
 * nothing — which would read as an unused package.
 */
export function prefilledConsumption(itemId, qty = 1) {
  const item = cdm.get(itemId);
  if (!item || !cdm.isBundle(item)) return [];
  return limitRows(item.id, qty).map((row) => ({ componentId: row.componentId, [row.unit]: row.included }));
}
