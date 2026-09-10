// Repository — TPA fee accruals. STUB (amendment 36). Owner: modules/defensio;
// amendment 42 (Defensio F7 — TPA fee reconciliation) takes the entity over
// and builds the feature on it: the fee the administrator withheld from a
// remittance, accrued against the payer, reconciled against the TPA
// agreement and settled or disputed.
//
// TODO(A42): the accrual's own lifecycle — Accrued, Reconciled, Disputed,
// Settled — the agreement it is read against and the screen at
// #/defensio/tpa-fees. Until then an accrual is a record with a number: a
// denial separated as a TPA fee creates one here (create) and keeps its id on
// the reclassification, and this file keeps the denial's id — the two-way
// link. Nothing in this file moves an accrual.

import { store } from '../store.js';
import * as audit from './audit.js';
import { current as currentRole } from '../../shared/roles.js';
import { usd } from '../../shared/format.js';

const TABLE = 'tpaFeeAccruals';
const ENTITY = 'tpaFeeAccruals';

export const STATUSES = ['Accrued', 'Reconciled', 'Disputed', 'Settled'];

export const all = () => store.table(TABLE);
export const get = (id) => all().find((a) => a.id === id) || null;
export const byDenial = (denialId) => all().filter((a) => a.denialId === denialId);
export const byPayer = (payerId) => all().filter((a) => a.payerId === payerId);
export const counts = () => ({
  total: all().length,
  accrued: all().filter((a) => a.status === 'Accrued').length,
  amount: Math.round(all().reduce((n, a) => n + (a.status === 'Accrued' ? a.amount : 0), 0) * 100) / 100,
});

/**
 * create({ denialId, claimNo, claimId, payerId, remittanceNo, amount, note,
 * at, by, commit }) → the accrual, Accrued. One per denial: a second call
 * hands the first back.
 */
export function create(data = {}, { at = null, by = null, commit = true } = {}) {
  const existing = byDenial(data.denialId)[0];
  if (existing) return existing;
  const when = at || data.at || new Date().toISOString();
  const who = by || data.by || currentRole().name;
  const row = {
    id: store.nextId(TABLE, 'TPA-'),
    denialId: data.denialId || null,
    claimNo: data.claimNo || null,
    claimId: data.claimId || null,
    payerId: data.payerId || null,
    remittanceNo: data.remittanceNo || null,
    amount: Math.round((Number(data.amount) || 0) * 100) / 100,
    note: data.note || '',
    status: 'Accrued',
    createdAt: when,
    createdBy: who,
    updatedAt: when,
  };
  all().push(row);
  audit.all().push({
    id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: row.id, action: 'Accrued',
    details: `${row.denialId || '—'} · ${row.claimNo || '—'} · ${usd(row.amount)}${row.note ? ` — ${row.note}` : ''}`,
    user: who, at: when,
  });
  if (commit) store.commit('tpaFeeAccruals.create');
  return row;
}
