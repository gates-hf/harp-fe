// Repository — code sets. Owner: modules/claima (amendment 26); the catalogues
// themselves belong to Pactum's standard code systems since amendment 44.
//
// The shape amendment 26 published is kept — `icd` and `proc` each answer
// everything, one code and the codes matching a search — but the rows are read
// through standard-codes.js's lookupCodes() rather than a static list: the
// DIAGNOSIS systems for `icd`, the PROCEDURE systems for `proc`, resolved on
// the version in force on `atDate` when a caller names one. A coder reading a
// chart from last year passes the date of service and gets last year's
// display; a caller that names no date reads the current version.
//
// The sanity check the workspace runs over a chosen code lives beside them
// because it reads what a code carries: the sex a code is valid for and the
// age band it makes sense in.

import { lookupCodes } from './standard-codes.js';
import { ageFrom } from '../../shared/format.js';

const LIMIT = 12;

/** The row amendment 26 wrote: `desc` beside the flattened attributes. */
const legacy = (row) => ({
  code: row.code,
  desc: row.display,
  sex: row.sex ?? null,
  ageMin: row.ageMin ?? null,
  ageMax: row.ageMax ?? null,
  category: row.category ?? null,
  chapter: row.chapter ?? null,
  systemName: row.systemName,
  versionId: row.versionId,
  versionLabel: row.versionLabel,
  fallback: row.fallback,
});

function catalogue(systemType) {
  const all = (atDate = '') => lookupCodes({ systemType, atDate }).map(legacy);
  const get = (code, atDate = '') => {
    const needle = String(code || '').toUpperCase().trim();
    return all(atDate).find((row) => row.code === needle) || null;
  };

  /**
   * Code prefix first, then every word of the query somewhere in the
   * description. Twelve hits: a coder narrows by typing rather than paging.
   */
  function search(q = '', { limit = LIMIT, category = '', atDate = '' } = {}) {
    const needle = String(q || '').trim();
    if (!needle) return [];
    const rows = lookupCodes({ systemType, query: needle, atDate }).map(legacy);
    return (category ? rows.filter((row) => row.category === category) : rows).slice(0, limit);
  }

  return { all, get, search };
}

export const icd = catalogue('DIAGNOSIS');
export const proc = catalogue('PROCEDURE');

/** The one-line label a picked code is shown as everywhere. */
export const label = (row) => (row ? `${row.code} — ${row.desc}` : '');

/**
 * A code ending in unspecified is not wrong, but it is the first thing a payer
 * queries, so the workspace warns on it. Read off the description rather than
 * the digit: ".9" is unspecified in most chapters and not in all.
 */
export const isUnspecified = (row) => /unspecified/i.test(row?.desc || '');

/**
 * Whether a code fits the patient it is being written on. Returns the reasons
 * it does not, as sentences, or an empty list — sex first, then age, because a
 * prostate code on a female record is the louder mistake.
 */
export function sanity(row, patient) {
  if (!row || !patient) return [];
  const out = [];
  const sex = patient.gender === 'Female' ? 'F' : patient.gender === 'Male' ? 'M' : null;
  if (row.sex && sex && row.sex !== sex) {
    out.push(`${row.code} is a ${row.sex === 'F' ? 'female' : 'male'}-only code and the patient is ${patient.gender.toLowerCase()}`);
  }
  const years = ageFrom(patient.dob);
  if (years !== null) {
    if (row.ageMin !== null && years < row.ageMin) out.push(`${row.code} is not expected under ${row.ageMin} — the patient is ${years}`);
    if (row.ageMax !== null && years > row.ageMax) {
      out.push(row.ageMax === 0
        ? `${row.code} is a newborn code — the patient is ${years}`
        : `${row.code} is not expected over ${row.ageMax} — the patient is ${years}`);
    }
  }
  return out;
}
