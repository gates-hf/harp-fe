// Repository — appeal cases. STUB (amendment 36). Owner: modules/defensio;
// amendment 38 (Defensio F3 — Appeal Management) takes the entity over and
// builds the feature on it: the appeal letter, the lodging, the payer's
// answer, the outcome that resolves the denial.
//
// TODO(A38): the case's own lifecycle — Lodged, Won, Lost, Withdrawn — its
// documents, its deadline tracking and the screen at #/defensio/appeals/<id>.
// Until then a case is a record with a number: the denial's Appeal route
// creates one here (create), keeps its id on the route, and this file keeps
// the denial's id on the case — the two-way link amendment 36 asks for.
// Nothing in this file moves a case; `resolveFromAppeal` on the denials
// repository is what A38 calls when one ends.

import { store } from '../store.js';
import * as audit from './audit.js';
import { current as currentRole } from '../../shared/roles.js';
import { usd } from '../../shared/format.js';

const TABLE = 'appealCases';
const ENTITY = 'appealCases';

export const STATUSES = ['Open', 'Lodged', 'Won', 'Lost', 'Withdrawn'];

export const all = () => store.table(TABLE);
export const get = (id) => all().find((a) => a.id === id) || null;
export const byDenial = (denialId) => all().filter((a) => a.denialId === denialId);
export const byClaim = (claimNo) => all().filter((a) => a.claimNo === claimNo);
export const isOpen = (a) => a?.status === 'Open' || a?.status === 'Lodged';
export const counts = () => ({ total: all().length, open: all().filter(isOpen).length });

/**
 * create({ denialId, claimNo, claimId, payerId, amount, appealBy, reason,
 * note, at, by, commit }) → the case, Open. One open case per denial: a
 * second call hands the first back.
 */
export function create(data = {}, { at = null, by = null, commit = true } = {}) {
  const open = byDenial(data.denialId).find(isOpen);
  if (open) return open;
  const when = at || data.at || new Date().toISOString();
  const who = by || data.by || currentRole().name;
  const row = {
    id: store.nextId(TABLE, 'AC-'),
    denialId: data.denialId || null,
    claimNo: data.claimNo || null,
    claimId: data.claimId || null,
    payerId: data.payerId || null,
    amount: Math.round((Number(data.amount) || 0) * 100) / 100,
    appealBy: data.appealBy || null,
    reason: data.reason || '',
    note: data.note || '',
    status: 'Open',
    outcome: null,
    createdAt: when,
    createdBy: who,
    updatedAt: when,
  };
  all().push(row);
  audit.all().push({
    id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: row.id, action: 'Created',
    details: `${row.denialId || '—'} · ${row.claimNo || '—'} · ${usd(row.amount)}${row.appealBy ? ` · appeal by ${row.appealBy}` : ''}${row.reason ? ` — ${row.reason}` : ''}`,
    user: who, at: when,
  });
  if (commit) store.commit('appealCases.create');
  return row;
}
