// CSV for the patient importer: template, built-in sample, parser, row rules
// and the error report. Same shape as the charge-line helper in Pactum, with
// the registration columns and rules — a module never imports another module's
// files, so this is a copy rather than a shared import.

import * as patients from '../../../../data/repositories/patients.js';
import { isEmail, isPhone, todayIso } from '../../../../shared/format.js';

export const COLUMNS = [
  ['Name EN', 'nameEn'],
  ['Name AR', 'nameAr'],
  ['DOB', 'dob'],
  ['Gender', 'gender'],
  ['Nationality', 'nationality'],
  ['Civil ID', 'civilId'],
  ['Passport', 'passportNo'],
  ['Phone', 'phone'],
  ['Email', 'email'],
  ['City', 'city'],
];

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function templateCsv() {
  return [
    COLUMNS.map(([label]) => label).join(','),
    csvLine(['Example Patient', 'مريض نموذجي', '1990-01-31', 'Female', 'Lebanese', '90013101', '', '+961 3 111 222', '', 'Beirut']),
  ].join('\r\n');
}

/** Eight rows: five clean, three that must fail. The demo needs no real file. */
export const SAMPLE_FILE = 'patients-sample-import.csv';
export const SAMPLE_CSV = [
  COLUMNS.map(([label]) => label).join(','),
  csvLine(['Walid Haddad', 'وليد حداد', '1975-03-04', 'Male', 'Lebanese', '75030401', '', '+961 3 445 118', 'walid.haddad@gmail.com', 'Beirut']),
  csvLine(['Souad Ayoub', 'سعاد أيوب', '1988-09-21', 'Female', 'Lebanese', '88092101', '', '+961 71 330 902', '', 'Sidon']),
  csvLine(['Georges Rahme', 'جورج رحمة', '1962-12-11', 'Male', 'Lebanese', '62121101', '', '+961 9 447 220', '', 'Jounieh']),
  csvLine(['Maria Estrada', 'ماريا إسترادا', '1994-06-02', 'Female', 'Filipino', '', 'P4471209', '+961 76 990 145', '', 'Beirut']),
  csvLine(['Hala Zantout', 'هالة زنتوت', '2003-01-19', 'Female', 'Lebanese', '03011901', '', '+961 70 618 447', 'hala.z@hotmail.com', 'Tripoli']),
  // The three that fail: a date of birth in the future, a civil ID already on
  // file, and a row with neither identifier.
  csvLine(['Nabil Achkar', 'نبيل عشقر', '2027-04-30', 'Male', 'Lebanese', '99043001', '', '+961 3 662 044', '', 'Zahle']),
  csvLine(['Rami Haddad', 'رامي حداد', '1978-04-12', 'Male', 'Lebanese', '61784120', '', '+961 3 214 587', '', 'Beirut']),
  csvLine(['Yasmine Kfoury', 'ياسمين قفوري', '1999-11-08', 'Female', 'Lebanese', '', '', '+961 71 204 663', '', 'Byblos']),
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
  const seen = { civilId: new Set(), passportNo: new Set() };
  return records.map((record) => {
    const row = { ...record, passportNo: record.passportNo.toUpperCase() };
    const reason = rowReason(row, seen);
    if (row.civilId) seen.civilId.add(row.civilId);
    if (row.passportNo) seen.passportNo.add(row.passportNo);
    return { ...row, valid: !reason, reason };
  });
}

function rowReason(r, seen) {
  const missing = [];
  if (!r.nameEn) missing.push('Name EN');
  if (!r.nameAr) missing.push('Name AR');
  if (!r.dob) missing.push('DOB');
  if (!r.gender) missing.push('Gender');
  if (!r.nationality) missing.push('Nationality');
  if (!r.phone) missing.push('Phone');
  if (missing.length) return `Missing required ${missing.join(', ')}`;

  if (!patients.GENDERS.includes(r.gender)) return `Unknown gender "${r.gender}"`;
  if (!patients.NATIONALITIES.includes(r.nationality)) return `Unknown nationality "${r.nationality}"`;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.dob) || Number.isNaN(Date.parse(r.dob))) {
    return `Invalid date of birth "${r.dob}" — use YYYY-MM-DD`;
  }
  if (r.dob > todayIso()) return `Date of birth "${r.dob}" is in the future`;
  if (!isPhone(r.phone)) return `Invalid phone "${r.phone}" — use +961 3 214 587`;
  if (r.email && !isEmail(r.email)) return `Invalid email "${r.email}"`;

  if (!r.civilId && !r.passportNo) return 'No identifier — a civil ID or a passport number is required';
  if (r.civilId && seen.civilId.has(r.civilId)) return 'Duplicate civil ID within this file';
  if (r.passportNo && seen.passportNo.has(r.passportNo)) return 'Duplicate passport within this file';

  const unique = patients.isIdentifierUnique(r.civilId, r.passportNo);
  if (!unique.civilId) return `Duplicate civil ID — ${r.civilId} is already registered`;
  if (!unique.passportNo) return `Duplicate passport — ${r.passportNo} is already registered`;

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
