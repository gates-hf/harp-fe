// CSV for the charge-line importer: template, built-in sample, parser, row
// rules and the error report. Same shape as the payer importer's helper, with
// the CDM columns and rules — items only, never bundles.

import * as cdm from '../../../../data/repositories/cdm.js';

export const COLUMNS = [
  ['Charge Code', 'chargeCode'],
  ['Description EN', 'descriptionEn'],
  ['Category', 'category'],
  ['UoM', 'uom'],
  ['Standard Price', 'standardPrice'],
  ['Status', 'status'],
];

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function templateCsv() {
  return [
    COLUMNS.map(([label]) => label).join(','),
    csvLine(['LAB-0099', 'Example blood test', 'Lab', 'Test', '18.50', 'Active']),
  ].join('\r\n');
}

/** Ten rows: seven clean, three that must fail. The demo needs no real file. */
export const SAMPLE_FILE = 'cdm-sample-import.csv';
export const SAMPLE_CSV = [
  COLUMNS.map(([label]) => label).join(','),
  csvLine(['LAB-0101', 'Ferritin', 'Lab', 'Test', '19.00', 'Active']),
  csvLine(['LAB-0102', 'Prothrombin time (INR)', 'Lab', 'Test', '14.50', 'Active']),
  csvLine(['RAD-0101', 'CT head, without contrast', 'Radiology', 'Each', '210.00', 'Active']),
  csvLine(['LAB-0001', 'Complete blood count (CBC)', 'Lab', 'Test', '12.50', 'Active']),
  csvLine(['PRC-0101', 'Ear syringing', 'Procedure', 'Session', '0', 'Active']),
  csvLine(['PHA-0101', 'Amoxicillin 500mg capsule', 'Pharmacy', 'Unit', '0.85', 'Active']),
  csvLine(['XRY-0101', 'Portable X-ray, bedside', 'Imaging', 'Each', '90.00', 'Active']),
  csvLine(['CNS-0101', 'Nasal cannula, adult', 'Consumables', 'Each', '3.10', 'Active']),
  csvLine(['PRF-0101', 'Dietitian time, per hour', 'Professional Fee', 'Hour', '75.00', 'Inactive']),
  csvLine(['RNB-0101', 'Day-case recovery chair', 'Room & Board', 'Session', '48.00', 'Active']),
].join('\r\n');

// --- parsing -----------------------------------------------------------------

/** Quote-aware CSV split. Returns rows of raw strings, blank lines dropped. */
export function parseCsv(text) {
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
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

/** Header row + data rows -> records keyed by entity field. */
export function toRecords(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const index = new Map(COLUMNS.map(([label, key]) => [key, headers.indexOf(label.toLowerCase())]));

  return rows.slice(1).map((cells) => {
    const record = {};
    for (const [, key] of COLUMNS) {
      const at = index.get(key);
      record[key] = at >= 0 ? String(cells[at] ?? '').trim() : '';
    }
    return record;
  });
}

// --- rules -------------------------------------------------------------------

/** Marks every row Valid or Error with the first reason it failed. */
export function validateRows(records) {
  const seen = new Set();
  return records.map((record) => {
    const row = { ...record, chargeCode: record.chargeCode.toUpperCase(), status: record.status || 'Active' };
    const reason = rowReason(row, seen);
    seen.add(row.chargeCode);
    return { ...row, valid: !reason, reason };
  });
}

function rowReason(r, seen) {
  const missing = [];
  if (!r.chargeCode) missing.push('Charge Code');
  if (!r.descriptionEn) missing.push('Description EN');
  if (!r.category) missing.push('Category');
  if (!r.uom) missing.push('UoM');
  if (r.standardPrice === '') missing.push('Standard Price');
  if (missing.length) return `Missing required ${missing.join(', ')}`;

  if (!cdm.ITEM_CATEGORIES.includes(r.category)) return `Unknown category "${r.category}"`;
  if (!cdm.UOMS.includes(r.uom)) return `Unknown UoM "${r.uom}"`;
  if (!cdm.STATUSES.includes(r.status)) return `Unknown status "${r.status}"`;

  const price = Number(r.standardPrice);
  if (!Number.isFinite(price)) return `Invalid price "${r.standardPrice}"`;
  if (price <= 0) return 'Invalid price — must be greater than zero';

  if (seen.has(r.chargeCode)) return 'Duplicate charge code within this file';
  if (!cdm.isChargeCodeUnique(r.chargeCode)) return `Duplicate charge code — ${r.chargeCode} already exists`;

  return '';
}

// --- output ------------------------------------------------------------------

export function errorReportCsv(rows) {
  return [
    [...COLUMNS.map(([label]) => label), 'Reason'].join(','),
    ...rows.map((r) => csvLine([...COLUMNS.map(([, key]) => r[key]), r.reason])),
  ].join('\r\n');
}

/** Hands the browser a file. The demo never uploads anything. */
export function download(fileName, text) {
  // The byte-order mark keeps Excel reading the file as UTF-8.
  const bom = String.fromCharCode(0xfeff);
  const url = URL.createObjectURL(new Blob([bom, text], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function csvLine(values) {
  return values
    .map((v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '')))
    .join(',');
}
