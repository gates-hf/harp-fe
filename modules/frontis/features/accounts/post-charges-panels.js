// The two panels the posting screen draws: the charge lines on the left and the
// priced preview on the right. Markup only — post-charges.js owns the state and
// the events, so the two files each stay near the line cap, the split
// simulator-inputs.js and prereg-form-panels.js already make.
//
// Nothing here prices anything: the rows arrive already priced by
// data/engines/account-engine.js, and this file only says what they look like.

import * as cdm from '../../../../data/repositories/cdm.js';
import { consumptionHtml } from '../../../../shared/consumption-table.js';
import { metricRailHtml } from '../../../../shared/metric-card.js';
import { esc, usd } from '../../../../shared/format.js';

/** The rail's inputs: the posting date and one sunken card per charge line. */
export function inputsHtml(state) {
  const chosen = state.lines.filter((line) => line.itemId).length;
  return `
    <div class="toolbar">
      <label class="field">
        <span class="icon icon--sm">event</span>
        <input type="datetime-local" value="${esc(state.at)}" data-field="at" aria-label="Posting date">
      </label>
      <span class="spacer"></span>
      <span class="t-body-sm">${chosen} line${chosen === 1 ? '' : 's'}</span>
    </div>
    ${state.lines.map(lineHtml).join('')}
    <div class="toolbar">
      <span class="spacer"></span>
      <button class="btn btn--secondary btn--sm" data-act="add-line">
        <span class="icon icon--sm">add</span>Add charge
      </button>
    </div>`;
}

/** One charge: the picker and its quantity on a row, consumption under a package. */
function lineHtml(line, i) {
  const item = cdm.get(line.itemId);
  return `
    <div class="panel panel--sunken" data-index="${i}">
      <div class="panel-header">
        <span class="t-title-sm">Charge ${i + 1}</span>
        ${item && cdm.isBundle(item) ? '<span class="badge badge--accent">Package</span>' : ''}
        <span class="spacer"></span>
        <span class="t-body-sm">${item ? `${usd(item.standardPrice)} standard` : 'nothing chosen'}</span>
        <button class="btn btn--ghost btn--icon btn--sm" data-act="remove-line" title="Remove charge ${i + 1}">
          <span class="icon icon--sm">delete</span>
        </button>
      </div>
      <div class="panel-body">
        <div class="toolbar">
          <label class="field field--grow">
            <span class="icon icon--sm">sell</span>
            <select data-field="itemId" aria-label="Charge ${i + 1}">
              <option value=""${line.itemId ? '' : ' selected'}>Choose a charge</option>
              ${cdm.findActive().map((row) => `
                <option value="${esc(row.id)}"${row.id === line.itemId ? ' selected' : ''}>
                  ${esc(row.chargeCode)} — ${esc(cdm.label(row))}${cdm.isBundle(row) ? ' (package)' : ''}
                </option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span class="icon icon--sm">tag</span>
            <input type="number" min="1" step="1" value="${esc(line.qty)}" data-field="qty"
                   aria-label="Quantity on charge ${i + 1}">
          </label>
        </div>
        ${item && cdm.isBundle(item) ? consumptionHtml(line, item) : ''}
      </div>
    </div>`;
}

/** Nothing chosen yet: what this panel is for, rather than an empty table. */
export const emptyPreviewHtml = () => `
  <div class="state-view">
    <div class="state-view__glyph"><span class="icon">receipt_long</span></div>
    <div class="state-view__title">Nothing to price yet</div>
    <p class="state-view__body">Choose the charges this visit ran up. Each one is priced through the
      agreement in force on the posting date, and what you see here is exactly what is appended.</p>
  </div>`;

/** The priced preview: the three totals, the warnings and every row to append. */
export function previewHtml(priced) {
  return `
    <div class="metric-rail metric-rail--3">${railHtml(priced.totals)}</div>
    ${priced.totals.held ? `
      <div class="alert alert--warning">
        <span class="icon">gpp_maybe</span>
        <div>${priced.totals.held} line${priced.totals.held === 1 ? ' is' : 's are'} held for approval — the
          payer requires prior authorisation. They post at the priced amount and are marked held.</div>
      </div>` : ''}
    ${priced.error ? `
      <div class="alert alert--critical"><span class="icon">error</span><div>${esc(priced.error)}</div></div>` : ''}
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">Charge</th>
          <th scope="col" class="num">Qty</th>
          <th scope="col" class="num">Standard</th>
          <th scope="col" class="num">Allowed</th>
          <th scope="col" class="num">Payer</th>
          <th scope="col" class="num">Patient</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>${priced.rows.map(rowHtml).join('')}</tbody>
    </table>`;
}

function railHtml(totals) {
  return metricRailHtml([
    { value: usd(totals.patient), label: 'Patient share', tone: 'warning', text: true,
      sub: 'due at the desk', title: 'What the patient is left with once the agreement is applied' },
    { value: usd(totals.allowed), label: 'Allowed', text: true, sub: 'at the agreed rates',
      title: 'Every line and its overage at the rates the agreement sets' },
    { value: usd(totals.payer), label: 'Payer share', text: true, sub: 'billed to the payer',
      title: 'What the payer is expected to carry on these lines' },
  ]);
}

function rowHtml(row) {
  const d = row.detail;
  return `
    <tr${d.isOverage ? ' title="Beyond what the package price covers"' : ''}>
      <td>
        <span class="t-mono-sm">${esc(d.chargeCode)}</span> ${esc(d.description)}
        ${d.isOverage ? '<span class="badge badge--warning">overage</span>' : ''}
      </td>
      <td class="num t-mono-sm">${esc(d.qtyLabel || d.qty)}</td>
      <td class="num t-mono-sm">${d.gross === null || d.gross === undefined ? '—' : usd(d.gross)}</td>
      <td class="num t-mono-sm">${usd(d.allowed)}</td>
      <td class="num t-mono-sm">${usd(d.payerShare)}</td>
      <td class="num t-mono-sm"><b>${usd(d.patientShare)}</b></td>
      <td>${d.status === 'Held for approval'
    ? '<span class="badge badge--warning">Held for approval</span>'
    : d.status === 'Not billable'
      ? '<span class="badge badge--critical">Not billable</span>'
      : '<span class="badge badge--success">Priced</span>'}</td>
    </tr>`;
}
