// Repository — potential duplicate pairs. Owner: modules/frontis. The registry
// raises a pair when a registration looks like someone already on file; this is
// where that pair waits for a decision.
//
// A pair is unordered: the same two MRNs on the same basis are one row however
// they were entered, so the detector cannot fill the worklist with copies.
// Rows are never deleted — Dismissed and Merged are answers, not removals.

import { store } from '../store.js';
import * as audit from './audit.js';

const TABLE = 'duplicates';

export const BASES = ['Name+DOB', 'Phone'];
export const STATUSES = ['Open', 'Dismissed', 'Merged'];

export function all() {
  return store.table(TABLE);
}

export function get(id) {
  return all().find((row) => row.id === id) || null;
}

/** list({ basis, status }) — newest detection first. */
export function list({ basis = '', status = '' } = {}) {
  return all()
    .filter((row) => (!basis || row.basis === basis) && (!status || row.status === status))
    .sort((a, b) => String(b.detectedAt).localeCompare(String(a.detectedAt)));
}

/** The pairs still waiting for a decision, newest detection first. */
export const open = () => list({ status: 'Open' });

export const openCount = () => open().length;

/** Every pair one patient appears in, whatever its status. */
export const forPatient = (mrn) => all().filter((row) => row.mrnA === mrn || row.mrnB === mrn);

const samePair = (row, a, b) =>
  (row.mrnA === a && row.mrnB === b) || (row.mrnA === b && row.mrnB === a);

export const find = (a, b, basis) => all().find((row) => samePair(row, a, b) && row.basis === basis) || null;

// --- writes -------------------------------------------------------------------

/** Raise a pair, or hand back the open one that already says this. */
export function create({ mrnA, mrnB, basis, justification = '' }) {
  const existing = find(mrnA, mrnB, basis);
  if (existing && existing.status === 'Open') return existing;

  const row = {
    id: store.nextId(TABLE, 'DP-'),
    mrnA,
    mrnB,
    basis,
    detectedAt: new Date().toISOString(),
    status: 'Open',
    justification,
  };
  all().push(row);
  store.commit('duplicate.create');
  audit.log({
    entity: 'patients',
    entityId: mrnA,
    action: 'Duplicate flagged',
    details: `${basis} match with ${mrnB}${justification ? ` — reason: ${justification}` : ''}`,
  });
  return row;
}

export function dismiss(id, reason) {
  const row = get(id);
  if (!row || row.status !== 'Open') return row;
  row.status = 'Dismissed';
  row.justification = reason;
  store.commit('duplicate.dismiss');
  audit.log({
    entity: 'patients',
    entityId: row.mrnA,
    action: 'Duplicate dismissed',
    details: `${row.mrnA} and ${row.mrnB} are different people — reason: ${reason}`,
  });
  return row;
}

/** Close every open pair between two records once one is merged into the other. */
export function markMerged(survivorMrn, duplicateMrn) {
  const rows = all().filter((row) => samePair(row, survivorMrn, duplicateMrn) && row.status === 'Open');
  for (const row of rows) row.status = 'Merged';
  if (rows.length) store.commit('duplicate.merged');
  return rows;
}
