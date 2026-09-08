// Repository — claims. Owner: modules/pactum for now; a future claims module
// takes ownership and this API stays where it is, so Performance never changes.
//
// Read-only by design: the demo adjudicates nothing. The dataset is generated
// (data/seed/claims.js) and seeds itself on first read rather than through
// data/store.js, which keeps the store free of a seed that has to read the
// contracts and the charge master to exist. A reset empties the table and the
// next read regenerates the same 600 rows.
//
// Query helpers only. Every metric definition lives in
// data/engines/performance-engine.js and nowhere else.

import { store } from '../store.js';
import { generateClaims, DENIAL_REASONS } from '../seed/claims.js';
import * as cdm from './cdm.js';
import * as contracts from './contracts.js';
import { compareDates } from '../../shared/format.js';

const TABLE = 'claims';

export const STATUSES = ['Paid', 'Partially Paid', 'Denied', 'Pending'];
/** A claim the payer has answered — the denominator of every rate. */
export const ADJUDICATED = ['Paid', 'Partially Paid', 'Denied'];
export { DENIAL_REASONS };

export const denialLabel = (code) => DENIAL_REASONS.find((r) => r.code === code)?.label || '—';

export function all() {
  const rows = store.table(TABLE);
  if (!rows.length) rows.push(...generateClaims());
  return rows;
}

export const get = (id) => all().find((c) => c.id === id) || null;

export const isAdjudicated = (claim) => ADJUDICATED.includes(claim?.status);
export const isPaid = (claim) => Boolean(claim?.paidAt);

export function statusTone(status) {
  if (status === 'Paid') return 'success';
  if (status === 'Partially Paid') return 'warning';
  if (status === 'Denied') return 'critical';
  return '';
}

/** list({ payerId, contractId, serviceGroup, status, itemId, from, to }). */
export function list({
  payerId = '', contractId = '', serviceGroup = '', status = '', itemId = '',
  from = '', to = '',
} = {}) {
  return all().filter((c) => {
    if (payerId && c.payerId !== payerId) return false;
    if (contractId && c.contractId !== contractId) return false;
    if (serviceGroup && c.serviceGroup !== serviceGroup) return false;
    if (status && c.status !== status) return false;
    if (itemId && c.itemId !== itemId) return false;
    if (from && compareDates(c.dateOfService, from) < 0) return false;
    if (to && compareDates(c.dateOfService, to) > 0) return false;
    return true;
  });
}

export const byPayer = (payerId, range = {}) => list({ payerId, ...range });
export const byContract = (contractId, range = {}) => list({ contractId, ...range });
export const byServiceGroup = (contractId, serviceGroup, range = {}) =>
  list({ contractId, serviceGroup, ...range });

/** The payers that have claims at all — who Performance can report on. */
export const trackedPayerIds = () => [...new Set(all().map((c) => c.payerId))].sort();

/** The contract versions that carry claims, newest term first. */
export function trackedContracts(payerId = '') {
  const ids = [...new Set(list({ payerId }).map((c) => c.contractId))];
  return ids
    .map((id) => contracts.get(id))
    .filter(Boolean)
    .sort((a, b) => b.startDate.localeCompare(a.startDate) || b.version - a.version);
}

/** The charge line a claim names, and its label — the tables read both. */
export const itemOf = (claim) => cdm.get(claim?.itemId);
export const itemName = (claim) => cdm.label(itemOf(claim)) || claim?.itemId || '—';

export function counts() {
  const rows = all();
  return {
    total: rows.length,
    adjudicated: rows.filter(isAdjudicated).length,
    denied: rows.filter((c) => c.status === 'Denied').length,
    pending: rows.filter((c) => c.status === 'Pending').length,
    payers: trackedPayerIds().length,
  };
}
