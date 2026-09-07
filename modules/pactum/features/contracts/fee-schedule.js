// The fee schedule a Fixed Amount methodology carries: one agreed price per
// active charge line, edited inside the methodology modal. This file is the
// schedule itself — its table markup and its file format. methodology-form.js
// owns the draft and the events; fee-schedule-import.js drives the stepper.

import * as cdm from '../../../../data/repositories/cdm.js';
import { esc, usd } from '../../../../shared/format.js';

/** Active items only: a bundle is priced by a case rate, never by a fee line. */
export const scheduleItems = () => cdm.findActive().filter((r) => r.kind === 'item');

/** Options for a CDM picker. Lines already used elsewhere are offered disabled. */
export function optionsHtml(rows, selectedId, taken = new Set()) {
  const options = rows.map((r) => {
    const used = taken.has(r.id) && r.id !== selectedId;
    return `<option value="${esc(r.id)}"${r.id === selectedId ? ' selected' : ''}${used ? ' disabled' : ''}>
              ${esc(r.chargeCode)} — ${esc(cdm.label(r))}${used ? ' (already in the schedule)' : ''}
            </option>`;
  });
  return `<option value=""${selectedId ? '' : ' selected'}>Choose a charge line</option>${options.join('')}`;
}

/** The panel inside the modal: its own header, the table, and a running note. */
export function feeScheduleHtml(schedule) {
  return `
    <div class="toolbar">
      <span class="t-title-sm">Fee schedule</span>
      <span class="spacer"></span>
      <button class="btn btn--secondary btn--sm" data-fs="add"><span class="icon icon--sm">add</span>Add item</button>
      <button class="btn btn--secondary btn--sm" data-fs="import"><span class="icon icon--sm">upload_file</span>Bulk import</button>
    </div>
    <table class="tbl">
      <thead>
        <tr><th>Item</th><th class="num">Standard price</th><th class="num">Agreed price *</th><th></th></tr>
      </thead>
      <tbody id="mf-schedule">${scheduleRows(schedule)}</tbody>
    </table>
    <p class="t-body-sm" id="mf-schedule-note">${esc(noteText(schedule))}</p>`;
}

/** The rows on their own — the modal redraws just these after add or remove. */
export function scheduleRows(schedule) {
  if (!schedule.length) {
    return '<tr><td colspan="4">No prices yet. Add an item, or import a schedule from a file.</td></tr>';
  }
  const rows = scheduleItems();
  const taken = new Set(schedule.map((line) => line.itemId));
  return schedule
    .map((line, i) => {
      const item = cdm.get(line.itemId);
      return `
        <tr>
          <td class="toolbar">
            <label class="field">
              <select data-fs-item="${i}" aria-label="Charge line for row ${i + 1}">
                ${optionsHtml(rows, line.itemId, taken)}
              </select>
            </label>
          </td>
          <td class="num t-mono-sm">${item ? usd(item.standardPrice) : '—'}</td>
          <td class="num">
            <label class="field">
              <span class="icon icon--sm">attach_money</span>
              <input type="number" min="0" step="0.01" value="${esc(line.price)}" data-fs-price="${i}"
                     aria-label="Agreed price for row ${i + 1}">
            </label>
          </td>
          <td>
            <button class="btn btn--ghost btn--icon btn--sm" data-fs-remove="${i}"
                    title="Remove ${esc(item ? item.chargeCode : `row ${i + 1}`)}">
              <span class="icon icon--sm">delete</span>
            </button>
          </td>
        </tr>`;
    })
    .join('');
}

/** How far the schedule sits under the standard prices it replaces. */
export function noteText(schedule) {
  const priced = schedule.filter((line) => cdm.get(line.itemId));
  if (!priced.length) {
    return 'Every line the schedule names is paid at its agreed price; anything it misses falls to the next methodology in the precedence order.';
  }
  const standard = priced.reduce((sum, line) => sum + Number(cdm.get(line.itemId).standardPrice), 0);
  const agreed = priced.reduce((sum, line) => sum + (Number(line.price) || 0), 0);
  const delta = standard ? ((agreed - standard) / standard) * 100 : 0;
  const gap = Math.abs(delta) < 0.05
    ? 'at standard price'
    : `${Math.abs(delta).toFixed(1)}% ${delta < 0 ? 'under' : 'over'} standard`;
  return `${priced.length} item${priced.length === 1 ? '' : 's'} · ${usd(agreed)} against ${usd(standard)} standard — ${gap}.`;
}

// --- file format -------------------------------------------------------------
// Two columns and one rule set, shared by the importer's template, sample,
// preview and error report. The charge master is never written by an import:
// a schedule prices lines that already exist.

export const COLUMNS = [['Charge Code', 'chargeCode'], ['Agreed Price', 'price']];
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const SAMPLE_FILE = 'fee-schedule-sample.csv';

/** Eight rows: six clean, one unknown code and one priced at zero. */
export const SAMPLE_CSV = [
  COLUMNS.map(([label]) => label).join(','),
  'RAD-0001,260.00',
  'RAD-0002,22.00',
  'CON-0001,20.00',
  'CON-0002,38.00',
  'PRC-0001,15.00',
  'PRC-0002,24.00',
  'LAB-9999,15.00',
  'SUR-0001,0',
].join('\r\n');

export const templateCsv = () => [COLUMNS.map(([label]) => label).join(','), 'LAB-0001,9.50'].join('\r\n');

/** Quote-aware split, then header row + data rows -> records. */
export function toRecords(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }

  const data = rows.filter((r) => r.some((v) => v.trim() !== ''));
  if (!data.length) return [];
  const headers = data[0].map((h) => h.trim().toLowerCase());
  const index = new Map(COLUMNS.map(([label, key]) => [key, headers.indexOf(label.toLowerCase())]));
  return data.slice(1).map((cells) => {
    const record = {};
    for (const [, key] of COLUMNS) {
      const at = index.get(key);
      record[key] = at >= 0 ? String(cells[at] ?? '').trim() : '';
    }
    return record;
  });
}

/** Marks every row Valid or Error with the first reason it failed. */
export function validateRows(records, priced = new Set()) {
  const seen = new Set();
  return records.map((record) => {
    const row = { ...record, chargeCode: record.chargeCode.toUpperCase() };
    const reason = rowReason(row, seen, priced);
    seen.add(row.chargeCode);
    return { ...row, valid: !reason, reason };
  });
}

function rowReason(r, seen, priced) {
  if (!r.chargeCode || r.price === '') return 'Missing required Charge Code, Agreed Price';
  if (seen.has(r.chargeCode)) return 'Duplicate charge code within this file';

  const item = cdm.getByCode(r.chargeCode);
  if (!item || item.kind !== 'item') return `Unknown charge code "${r.chargeCode}"`;
  if (item.status !== 'Active') return `${r.chargeCode} is not an active charge line`;
  if (priced.has(item.id)) return `${r.chargeCode} is already in this schedule`;

  const price = Number(r.price);
  if (!Number.isFinite(price)) return `Invalid price "${r.price}"`;
  if (price <= 0) return 'Invalid price — must be greater than zero';
  return '';
}

export function errorReportCsv(rows) {
  return [
    [...COLUMNS.map(([label]) => label), 'Reason'].join(','),
    ...rows.map((r) => csvLine([...COLUMNS.map(([, key]) => r[key]), r.reason])),
  ].join('\r\n');
}

/** One CSV row, quoted where it has to be. The fee report writes its own too. */
export function csvLine(values) {
  return values
    .map((v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '')))
    .join(',');
}

/** Hands the browser a file. The demo never uploads anything. */
export function download(fileName, text) {
  // The byte-order mark keeps Excel reading the file as UTF-8.
  const url = URL.createObjectURL(new Blob([String.fromCharCode(0xfeff), text], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
