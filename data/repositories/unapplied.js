// Repository — unapplied cash. Owner: modules/claima (amendment 29).
//
// Money a payer sent that no claim on its remittance accounts for. It is held
// until the desk applies it to a claim, gives it back or writes it on; every
// row names the remittance it came from, and every movement is audited under
// the row. Rows are created by data/repositories/remittances.js as it posts
// and by nothing else, so — like denials — the table fills as the seeded
// remittances post, through the seed hook the remittance repository pushes.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as claims from './claims.js';
import { CONFIG } from '../../shared/config.js';
import { current as currentRole } from '../../shared/roles.js';
import { todayIso, usd } from '../../shared/format.js';

const TABLE = 'unapplied';
const ENTITY = 'unapplied';

export const STATUSES = ['Held', 'Applied', 'Refunded', 'Adjusted'];

/** The remittance repository pushes its seeder here; an empty table runs it once. */
export const seedHooks = [];

export function all() {
  const rows = store.table(TABLE);
  if (!rows.length) for (const fn of seedHooks) fn();
  return rows;
}

export const get = (id) => all().find((r) => r.id === id) || null;

export const warnDays = () => CONFIG.claima?.posting?.unappliedAgeWarnDays ?? 30;

/** Whole days the money has waited — until it was resolved, or until today. */
export function ageDays(row, on = todayIso()) {
  const from = String(row?.since || '').slice(0, 10);
  const to = row?.resolution?.at ? String(row.resolution.at).slice(0, 10) : on;
  if (!from) return 0;
  return Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86400000));
}

export const isOverdue = (row) => row?.status === 'Held' && ageDays(row) > warnDays();

/** Still held, oldest first. */
export const open = () => all().filter((r) => r.status === 'Held').sort(bySince);

export const byRemittance = (remittanceNo) => all().filter((r) => r.remittanceNo === remittanceNo).sort(bySince);

/**
 * byPayer({ status }) → [{ payerId, rows, held, count }], the payer holding the
 * most first. `status` narrows the rows; the default is what is still held.
 */
export function byPayer({ status = 'Held' } = {}) {
  const groups = new Map();
  for (const row of all().filter((r) => !status || r.status === status).sort(bySince)) {
    (groups.get(row.payerId) || groups.set(row.payerId, []).get(row.payerId)).push(row);
  }
  return [...groups.entries()]
    .map(([payerId, rows]) => ({
      payerId, rows,
      held: round(rows.filter((r) => r.status === 'Held').reduce((n, r) => n + r.amount, 0)),
      count: rows.length,
    }))
    .sort((a, b) => b.held - a.held || a.payerId.localeCompare(b.payerId));
}

export function counts() {
  const rows = all();
  const held = rows.filter((r) => r.status === 'Held');
  return {
    total: rows.length,
    held: held.length,
    heldAmount: round(held.reduce((n, r) => n + r.amount, 0)),
    overdue: held.filter(isOverdue).length,
    payers: new Set(held.map((r) => r.payerId)).size,
  };
}

export const history = (id) => audit.forEntity(ENTITY, id);

// --- writes -------------------------------------------------------------------

/** create({ payerId, remittanceNo, amount, at, by }) → the held row. */
export function create(data = {}) {
  const at = data.at || new Date().toISOString();
  const by = data.by || currentRole().name;
  const row = {
    id: store.nextId(TABLE, 'UC-'),
    payerId: data.payerId,
    remittanceNo: data.remittanceNo,
    postingId: data.postingId || null,
    amount: round(data.amount),
    since: at,
    status: 'Held',
    resolution: null,
  };
  all().push(row);
  log(row, 'Held', `${usd(row.amount)} from ${row.remittanceNo} held as unapplied cash`, at, by);
  store.commit('unapplied.create');
  return row;
}

/**
 * apply(id, claimNo, { reason, at, by }) → { row, claim, error }. The claim
 * has to be this payer's and still owed something; the cash lands on it as a
 * payment through the one status path, and the row is Applied.
 */
export function apply(id, claimNo, { reason = '', at = null, by = null } = {}) {
  const row = get(id);
  if (!row || row.status !== 'Held') return { error: 'This cash is no longer held', row };
  const claim = claims.get(claimNo);
  if (!claim) return { error: `No claim ${claimNo}`, row };
  if (claim.payerId !== row.payerId) return { error: 'That claim is with another payer', row };
  if (!claims.isPending(claim) && claim.status !== 'Partially Paid') {
    return { error: `A ${claim.status.toLowerCase()} claim cannot take a payment`, row };
  }
  const paid = round((claim.totals?.paid || 0) + row.amount);
  const status = paid + 0.005 >= (claim.totals?.payerShare || 0) ? 'Paid' : 'Partially Paid';
  claims.setStatus(claim.id, status, {
    paid, paidAt: (at || new Date().toISOString()).slice(0, 10), remittanceId: row.remittanceNo,
    reason: 'Unapplied cash applied', details: `${usd(row.amount)} from ${row.remittanceNo}${reason ? ` — ${reason}` : ''}`,
  });
  return { error: '', row: resolve(row, 'Applied', { kind: 'Applied to claim', ref: claim.claimNo, reason, at, by }), claim };
}

/** Give it back to the payer. The role gate is the screen's; the reason is required. */
export function refund(id, { reason = '', reference = '', at = null, by = null } = {}) {
  const row = get(id);
  if (!row || row.status !== 'Held') return { error: 'This cash is no longer held', row };
  if (!String(reason).trim()) return { error: 'Say why it is being refunded', row };
  return { error: '', row: resolve(row, 'Refunded', { kind: 'Refunded to payer', ref: reference || null, reason, at, by }) };
}

/** Write it on: the hospital keeps it against nothing in particular. Reason required. */
export function adjust(id, { reason = '', at = null, by = null } = {}) {
  const row = get(id);
  if (!row || row.status !== 'Held') return { error: 'This cash is no longer held', row };
  if (!String(reason).trim()) return { error: 'Say why it is being adjusted', row };
  return { error: '', row: resolve(row, 'Adjusted', { kind: 'Adjusted', ref: null, reason, at, by }) };
}

function resolve(row, status, { kind, ref, reason, at, by }) {
  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  row.status = status;
  row.resolution = { kind, ref, reason: String(reason || '').trim(), by: who, at: when };
  log(row, status, `${usd(row.amount)} ${kind.toLowerCase()}${ref ? ` · ${ref}` : ''}${row.resolution.reason ? ` — ${row.resolution.reason}` : ''}`, when, who);
  store.commit('unapplied.resolve');
  return row;
}

// --- internals ----------------------------------------------------------------

const bySince = (a, b) => String(a.since).localeCompare(String(b.since)) || a.id.localeCompare(b.id);
const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

function log(row, action, details, at, by) {
  audit.all().push({
    id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: row.id, action, details,
    user: by || currentRole().name, at: at || new Date().toISOString(),
  });
}
