// The services an estimate is quoting: the charge picker, the lines, and the
// consumption sub-table a bundle opens. Markup only — estimate-builder.js owns
// the state and the events, so the two files each stay near the line cap.
//
// The picker is written here rather than imported from Pactum's fee schedule: a
// module never reaches into another module's files. What has to stay in step is
// cdm.findActive(), which is the repository's own list and the only one anybody
// offers. The consumption table is shared/consumption-table.js, because what a
// package includes is one answer and both modules ask it.

import * as cdm from '../../../../data/repositories/cdm.js';
import { consumptionHtml } from '../../../../shared/consumption-table.js';
import { esc, usd } from '../../../../shared/format.js';

/** The active charge master as a picker, bundles and items in one list. */
export const optionsHtml = (selected) =>
  `<option value=""${selected ? '' : ' selected'}>Choose a service</option>` +
  cdm.findActive().map((row) => `
    <option value="${esc(row.id)}"${row.id === selected ? ' selected' : ''}>
      ${esc(row.chargeCode)} — ${esc(cdm.label(row))}${cdm.isBundle(row) ? ' (package)' : ''}
    </option>`).join('');

/** The whole Services section: the lines, the Add button and the live total. */
export function linesPanelHtml(lines, gross) {
  return `
    <div class="toolbar">
      <span class="t-title-sm">Services</span>
      <span class="spacer"></span>
      <span class="t-body-sm">${lines.length} line${lines.length === 1 ? '' : 's'}</span>
      <button class="btn btn--secondary btn--sm" data-act="add-line">
        <span class="icon icon--sm">add</span>Add service
      </button>
    </div>
    ${lines.length
      ? lines.map(lineHtml).join('')
      : '<p class="t-body-sm">No services yet. Add the ones this visit is expected to need.</p>'}
    <div class="toolbar">
      <span class="t-title-sm">Running gross total</span>
      <span class="spacer"></span>
      <span class="t-mono-sm">${usd(gross)}</span>
    </div>
    <p class="t-body-sm">At the charge master's standard prices, before the agreement is applied. Simulate to see
      what the payer allows and what the patient is left with.</p>`;
}

/** One line: the picker and its quantity on one row, the price in the header. */
export function lineHtml(line, i) {
  const item = cdm.get(line.itemId);
  return `
    <div class="panel panel--sunken" data-index="${i}">
      <div class="panel-header">
        <span class="t-title-sm">Service ${i + 1}</span>
        ${item && cdm.isBundle(item) ? '<span class="badge badge--accent">Package</span>' : ''}
        <span class="spacer"></span>
        <span class="t-body-sm">${item
          ? `${usd(item.standardPrice)} standard · ${usd(item.standardPrice * Math.max(1, Number(line.qty) || 1))} for ${
            Math.max(1, Number(line.qty) || 1)}`
          : 'No service chosen'}</span>
        <button class="btn btn--ghost btn--icon btn--sm" data-act="remove-line" title="Remove service ${i + 1}">
          <span class="icon icon--sm">delete</span>
        </button>
      </div>
      <div class="panel-body">
        <div class="toolbar">
          <label class="field field--grow">
            <span class="icon icon--sm">sell</span>
            <select data-field="itemId" aria-label="Service ${i + 1}">${optionsHtml(line.itemId)}</select>
          </label>
          <label class="field">
            <span class="icon icon--sm">tag</span>
            <input type="number" min="1" step="1" value="${esc(line.qty)}" data-field="qty"
                   aria-label="Quantity on service ${i + 1}">
          </label>
        </div>
        ${item && cdm.isBundle(item) ? consumptionHtml(line, item) : ''}
      </div>
    </div>`;
}
