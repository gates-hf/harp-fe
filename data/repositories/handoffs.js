// Repository — handoffs. Underpayment hand-offs raised from Pactum's contract
// performance screen and worked in Defensio, which does not exist yet. Shared
// entity: Defensio takes ownership when it lands, and this API stays.
//
// Like claims, the seed is derived from the generated dataset, so it seeds
// itself on first read instead of through data/store.js. A hand-off written in
// the browser lands in the same table and persists for the session.

import { store } from '../store.js';
import * as audit from './audit.js';
import { generateHandoffs, HANDOFF_STATUSES, HANDOFF_REASONS } from '../seed/handoffs.js';
import { current as currentRole } from '../../shared/roles.js';
import { usd } from '../../shared/format.js';

const TABLE = 'handoffs';
const ENTITY = 'handoffs';

export const STATUSES = HANDOFF_STATUSES;
export const REASONS = HANDOFF_REASONS;

/** Where the chip on a handed-off row points. Defensio is not built yet. */
export const DEFENSIO_PATH = '#/defensio';

export function all() {
  const rows = store.table(TABLE);
  if (!rows.length) rows.push(...generateHandoffs());
  return rows;
}

export const get = (id) => all().find((h) => h.id === id) || null;

/** The hand-off raised for one claim, or null — a claim is handed off once. */
export const forClaim = (claimId) => all().find((h) => h.claimId === claimId) || null;

export const byContract = (contractId) => all().filter((h) => h.contractId === contractId);
export const byPayer = (payerId) => all().filter((h) => h.payerId === payerId);

export function statusTone(status) {
  if (status === 'Recovered') return 'success';
  if (status === 'In appeal') return 'warning';
  return 'info';
}

export function counts(rows = all()) {
  return {
    total: rows.length,
    open: rows.filter((h) => h.status !== 'Recovered').length,
    recovered: rows.filter((h) => h.status === 'Recovered').length,
  };
}

// --- writes ------------------------------------------------------------------

/** create({ claimId, contractId, payerId, amount, reason, note }). */
export function create(data) {
  const existing = forClaim(data.claimId);
  if (existing) return existing;

  const row = {
    id: store.nextId(TABLE, 'HO-'),
    claimId: data.claimId,
    contractId: data.contractId,
    payerId: data.payerId,
    amount: round2(data.amount),
    status: 'Handed off',
    recoveredAmount: 0,
    reason: data.reason || REASONS[0],
    note: data.note || '',
    createdBy: currentRole().name,
    createdAt: new Date().toISOString(),
  };
  all().push(row);
  store.commit('handoff.create');
  audit.log({
    entity: ENTITY,
    entityId: row.id,
    action: 'Handed off',
    details: `${row.claimId} · ${usd(row.amount)} — ${row.reason}`,
  });
  return row;
}

/** Move a hand-off along its appeal. `recoveredAmount` only matters at Recovered. */
export function setStatus(id, status, recoveredAmount = null) {
  const row = get(id);
  if (!row || row.status === status) return row;
  row.status = status;
  row.recoveredAmount = status === 'Recovered'
    ? round2(recoveredAmount == null ? row.amount : recoveredAmount)
    : 0;
  store.commit('handoff.status');
  audit.log({
    entity: ENTITY,
    entityId: id,
    action: status,
    details: status === 'Recovered' ? `${usd(row.recoveredAmount)} recovered` : `${row.claimId} set to ${status}`,
  });
  return row;
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
