// Repository — code sets. Owner: modules/claima (amendment 26).
//
// The ICD-10 and procedure catalogues a coder searches. Read-only: nothing in
// the demo adds a code, so there is no store table and no write — the seed is
// read once and searched from memory, the way data/seed/reference.js is read.
//
// Both catalogues answer the same three questions — everything, one code, the
// codes matching a search — so they are two instances of one shape, and the
// sanity check the workspace runs over a chosen code lives beside them because
// it reads what the catalogue carries: the sex a code is valid for and the age
// band it makes sense in.

import { buildIcd, buildProc } from '../seed/code-sets.js';
import { ageFrom } from '../../shared/format.js';

const LIMIT = 12;

function catalogue(build) {
  let rows = null;
  const all = () => (rows ||= build());
  const get = (code) => all().find((row) => row.code === String(code || '').toUpperCase().trim()) || null;

  /**
   * Code prefix first, then every word of the query somewhere in the
   * description. Twelve hits: a coder narrows by typing rather than paging.
   */
  function search(q = '', { limit = LIMIT, category = '' } = {}) {
    const needle = String(q || '').trim().toLowerCase();
    if (!needle) return [];
    const words = needle.split(/\s+/).filter(Boolean);
    const pool = category ? all().filter((row) => row.category === category) : all();
    const byCode = pool.filter((row) => row.code.toLowerCase().startsWith(needle));
    const byDesc = pool.filter((row) =>
      !byCode.includes(row) && words.every((w) => row.desc.toLowerCase().includes(w)));
    return [...byCode, ...byDesc].slice(0, limit);
  }

  return { all, get, search };
}

export const icd = catalogue(buildIcd);
export const proc = catalogue(buildProc);

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
