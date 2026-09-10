// Repository — statements of account. Owner: modules/frontis.
//
// A statement is an immutable document: what the account said on the day it
// was generated, frozen with the parameters it was generated under, so a
// reprint a month later prints the same page. There is no update and no
// delete — a statement that is wrong is followed by a new one with a new
// number. The content is data/engines/statement-engine.js's; this file
// numbers it, refuses one that does not reconcile, stores it and audits it on
// the account's trail.
//
// The dataset seeds itself on first read (data/seed/soa.js) — it reads the
// ledger and the register to exist, so data/store.js does not import it.

import { store } from '../store.js';
import * as audit from './audit.js';
import { buildStatement, scopeLabel, SCOPES, DETAILS, LANGUAGES } from '../engines/statement-engine.js';
import { buildStatements } from '../seed/soa.js';
import { current as currentRole } from '../../shared/roles.js';
import { usd } from '../../shared/format.js';

const TABLE = 'soa';
/** The trail is the account's, keyed on the MRN — a statement is a fact about the account. */
const ENTITY = 'account';

export { scopeLabel, SCOPES, DETAILS, LANGUAGES };

export function all() {
  const rows = store.table(TABLE);
  if (!rows.length) {
    rows.push(...buildStatements());
    const trail = audit.all();
    for (const row of rows) {
      trail.push({
        id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: row.mrn, action: 'SOA generated', user: row.by, at: row.generatedAt,
        details: describe(row),
      });
    }
  }
  return rows;
}

export const get = (no) => all().find((row) => row.no === no) || null;

/** One account's statements, newest first. */
export const byPatient = (mrn) => all().filter((row) => row.mrn === mrn)
  .sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)));

export function nextNo(year = new Date().getFullYear()) {
  const prefix = `SOA-${year}-`;
  const max = all().reduce((n, row) => {
    if (!String(row.no).startsWith(prefix)) return n;
    const digits = Number(String(row.no).slice(prefix.length));
    return Number.isFinite(digits) && digits > n ? digits : n;
  }, 88);
  return prefix + String(max + 1).padStart(6, '0');
}

/** The document as it would be generated now — what the preview shows, unstored. */
export const preview = (mrn, params) => buildStatement(mrn, params, { by: currentRole().name });

/**
 * create(mrn, params) → { error, row }. Builds, refuses when the blocks do not
 * add up to the account's balances, freezes, numbers and audits.
 */
export function create(mrn, params = {}, { at = null, by = null } = {}) {
  const built = buildStatement(mrn, params, { at: at || new Date().toISOString(), by: by || currentRole().name });
  if (built.error) return { error: built.error, row: null };
  const row = { no: nextNo(new Date(built.generatedAt).getFullYear()), ...built, reprints: [] };
  all().push(row);
  store.commit('soa.create');
  audit.log({ entity: ENTITY, entityId: mrn, action: 'SOA generated', details: describe(row), user: row.by });
  return { error: '', row };
}

/** A reprint is worth keeping: a second copy went out. The document itself never changes. */
export function markPrinted(no) {
  const row = get(no);
  if (!row) return null;
  row.reprints = [...(row.reprints || []), new Date().toISOString()];
  store.commit('soa.print');
  return row;
}

export const describe = (row) =>
  `${row.no} · ${scopeLabel(row.params)} · ${row.params.detail} · ${row.params.language} — balance due ${usd(row.snapshot.balanceDue)}`;
