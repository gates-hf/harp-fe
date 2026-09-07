// CSV for the payer importer: the template, the built-in sample, a parser, the
// row rules, and the error report. No behaviour and no markup — bulk-import.js
// owns the flow.

import * as payers from '../../../../data/repositories/payers.js';
import { isEmail, isPhone } from '../../../../shared/format.js';

/** Tab-1 columns, in the order the template writes them. */
export const COLUMNS = [
  ['Name (EN)', 'nameEn'],
  ['Name (AR)', 'nameAr'],
  ['Type', 'type'],
  ['Status', 'status'],
  ['License No.', 'licenseNo'],
  ['Email', 'email'],
  ['Phone', 'phone'],
  ['Address', 'address'],
];

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function templateCsv() {
  return [
    COLUMNS.map(([label]) => label).join(','),
    csvLine(['Example Insurance', 'مثال للتأمين', 'Private', 'Active', 'INS-EXM-999', 'claims@example.com.lb', '+961 1 200 300', 'Hamra, Beirut']),
  ].join('\r\n');
}

/** Eight rows: five clean, three that must fail. The demo needs no real file. */
export const SAMPLE_FILE = 'payers-sample-import.csv';
export const SAMPLE_CSV = [
  COLUMNS.map(([label]) => label).join(','),
  csvLine(['United Takaful', 'الاتحاد الوطني تكافل', 'Private', 'Active', 'INS-UNT-116', 'takaful@ittihad.com.lb', '+961 1 611 500', 'Badaro, Beirut']),
  csvLine(['Byblos Health Fund', 'صندوق بيبلوس الصحي', 'Government', 'Active', 'GOV-BYB-007', 'fund@byblos.gov.lb', '+961 9 546 200', 'Byblos, Keserwan']),
  csvLine(['Bankers Assurance', 'بنكرز للتأمين', 'Private', 'Active', 'INS-BNK-101', 'health@bankers.com.lb', '+961 1 999 555', 'Hamra, Beirut']),
  csvLine(['Chtaura Mutual Fund', 'صندوق تعاضد شتورا', 'Cooperative', 'Active', 'GOV-CHT-008', 'info@chtaura-fund.org.lb', '+961 8 544 010', 'Chtaura, Zahle']),
  csvLine(['Phoenix Assurance', 'فينيكس للتأمين', 'Private', 'Active', 'INS-PHX-117', 'contact(at)phoenix.com.lb', '+961 1 425 900', 'Achrafieh, Beirut']),
  csvLine(['Cedars Global Care', 'سيدرز غلوبال كير', 'International', 'Active', 'INT-CDR-303', 'claims@cedarsglobal.com', '+961 1 987 654', 'Downtown Beirut']),
  csvLine(['Nour Insurance', 'نور للتأمين', 'Private', 'Inactive', 'INS-NUR-118', 'claims@nour.com.lb', '+961 1 887 220', 'Verdun, Beirut']),
  csvLine(['Saida Municipal Fund', 'صندوق بلدية صيدا', 'Government', 'Active', 'GOV-SAI-008', 'fund@saida.gov.lb', '+961 7 720 400', 'Saida, South']),
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
  const seenEn = new Set();
  const seenAr = new Set();

  return records.map((record) => {
    const reason = rowReason(record, seenEn, seenAr);
    seenEn.add(record.nameEn.toLowerCase());
    seenAr.add(record.nameAr);
    return { ...record, status: record.status || 'Active', valid: !reason, reason };
  });
}

function rowReason(r, seenEn, seenAr) {
  const missing = [];
  if (!r.nameEn) missing.push('Name (EN)');
  if (!r.nameAr) missing.push('Name (AR)');
  if (!r.type) missing.push('Type');
  if (!r.email) missing.push('Email');
  if (!r.phone) missing.push('Phone');
  if (missing.length) return `Missing required ${missing.join(', ')}`;

  if (!payers.TYPES.includes(r.type)) return `Unknown type "${r.type}"`;
  if (r.status && !payers.STATUSES.includes(r.status)) return `Unknown status "${r.status}"`;
  if (!r.licenseNo && r.type !== payers.NO_LICENSE_TYPE) return 'Missing required License No.';
  if (!isEmail(r.email)) return `Invalid email "${r.email}"`;
  if (!isPhone(r.phone)) return `Invalid phone "${r.phone}"`;

  if (seenEn.has(r.nameEn.toLowerCase()) || seenAr.has(r.nameAr)) return 'Duplicate name within this file';
  const unique = payers.isNameUnique(r.nameEn, r.nameAr);
  if (!unique.nameEn) return `Duplicate name — ${r.nameEn} already exists`;
  if (!unique.nameAr) return `Duplicate Arabic name — ${r.nameAr} already exists`;

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
  const url = URL.createObjectURL(new Blob(['\ufeff', text], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function csvLine(values) {
  return values.map((v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''))).join(',');
}
