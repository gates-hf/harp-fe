// CSV for the code importer: the template, the built-in sample, a parser, the
// row rules, and the error report. No behaviour and no markup — code-import.js
// owns the flow. The parser and the download are the payer importer's, copied
// rather than imported: a feature reaches into no other feature's files.

import * as codes from '../../../../data/repositories/standard-codes.js';
import * as cdm from '../../../../data/repositories/cdm.js';
import { iso } from '../../../../shared/format.js';

/** Columns in the order the template writes them. Only the first two are required. */
export const COLUMNS = [
  ['Code', 'code'],
  ['Display', 'display'],
  ['Valid from', 'validFrom'],
  ['Sex', 'sex'],
  ['Age min', 'ageMin'],
  ['Age max', 'ageMax'],
  ['Category', 'category'],
];

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function templateCsv(diagnosis) {
  return [
    COLUMNS.map(([label]) => label).join(','),
    csvLine(diagnosis
      ? ['Z99.11', 'Dependence on respirator [ventilator] status', '', '', '', '', '']
      : ['99214', 'Office or outpatient visit, established patient, moderate complexity', '', '', '', '', 'Consultation']),
  ].join('\r\n');
}

/** Eight rows: five clean, three that must fail. The demo needs no real file. */
export const SAMPLE_FILE = 'codes-sample-import.csv';

export function sampleCsv(diagnosis) {
  const rows = diagnosis
    ? [
      ['Z99.11', 'Dependence on respirator [ventilator] status', '', '', '', '', ''],
      ['G47.33', 'Obstructive sleep apnoea (adult) (paediatric)', '', '', '', '', ''],
      ['N18.4', 'Chronic kidney disease, stage 4 (severe)', '', '', '', '', ''],
      ['O24.410', 'Gestational diabetes mellitus in pregnancy, diet controlled', '', 'F', '12', '55', ''],
      ['P22.0', 'Respiratory distress syndrome of newborn', '', '', '0', '0', ''],
      ['R06.02', '', '', '', '', '', ''],
      ['Z99.11', 'Dependence on respirator [ventilator] status', '', '', '', '', ''],
      ['N18.5', 'Chronic kidney disease, stage 5', '', 'X', '', '', ''],
    ]
    : [
      ['99214', 'Office or outpatient visit, established patient, moderate complexity', '', '', '', '', 'Consultation'],
      ['71250', 'Computed tomography, thorax, without contrast', '', '', '', '', 'Radiology'],
      ['80053', 'Comprehensive metabolic panel', '', '', '', '', 'Lab'],
      ['58150', 'Total abdominal hysterectomy', '', 'F', '18', '', 'Surgery'],
      ['90471', 'Immunisation administration, one vaccine', '', '', '', '', 'Procedure'],
      ['99215', '', '', '', '', '', 'Consultation'],
      ['99214', 'Office or outpatient visit, established patient, moderate complexity', '', '', '', '', 'Consultation'],
      ['45378', 'Colonoscopy, diagnostic', '', '', '50', '40', 'Surgery'],
    ];
  return [COLUMNS.map(([label]) => label).join(','), ...rows.map(csvLine)].join('\r\n');
}

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

/** Header row + data rows -> records keyed by field. */
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

/** Marks every row Valid or Error with the first reason it failed, against one version. */
export function validateRows(records, versionId) {
  const seen = new Set();
  return records.map((record) => {
    const code = codes.normalizeCode(record.code);
    const reason = rowReason({ ...record, code }, versionId, seen);
    seen.add(code);
    return { ...record, code, valid: !reason, reason };
  });
}

const isAge = (v) => /^\d{1,3}$/.test(v) && Number(v) <= 120;

function rowReason(r, versionId, seen) {
  if (!r.code) return 'Missing required Code';
  if (!r.display) return 'Missing required Display';
  if (r.validFrom && !iso(r.validFrom)) return `Invalid date "${r.validFrom}"`;
  if (r.sex && !['F', 'M'].includes(r.sex.toUpperCase())) return `Unknown sex "${r.sex}" — F, M or blank`;
  if (r.ageMin && !isAge(r.ageMin)) return `Invalid age min "${r.ageMin}"`;
  if (r.ageMax && !isAge(r.ageMax)) return `Invalid age max "${r.ageMax}"`;
  if (r.ageMin && r.ageMax && Number(r.ageMin) > Number(r.ageMax)) return `Age min ${r.ageMin} is above age max ${r.ageMax}`;
  if (r.category && !cdm.ITEM_CATEGORIES.includes(r.category)) return `Unknown category "${r.category}"`;
  if (seen.has(r.code)) return 'Duplicate code within this file';
  if (!codes.isCodeUnique(versionId, r.code)) return `Duplicate code — ${r.code} is already in this version`;
  return '';
}

/** A valid row as the repository takes it. */
export const toCode = (r) => ({
  code: r.code,
  display: r.display,
  validFrom: r.validFrom || '',
  attributes: {
    sex: r.sex ? r.sex.toUpperCase() : null,
    ageMin: r.ageMin === '' ? null : Number(r.ageMin),
    ageMax: r.ageMax === '' ? null : Number(r.ageMax),
    category: r.category || null,
    chapter: null,
  },
});

// --- output ------------------------------------------------------------------

export function errorReportCsv(rows) {
  return [
    [...COLUMNS.map(([label]) => label), 'Reason'].join(','),
    ...rows.map((r) => csvLine([...COLUMNS.map(([, key]) => r[key]), r.reason])),
  ].join('\r\n');
}

/** Hands the browser a file. The demo never uploads anything. */
export function download(fileName, text) {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8;' }));
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
