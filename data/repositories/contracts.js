// Repository — contracts. Owner: modules/pactum (Payer & Contract Management).
// The only way any module reads or writes payer contracts.
//
// A contract is versioned: every version of one agreement shares a `lineageId`
// and carries its own `version`, dates and configuration. Activating a new
// version closes the previous one. Contracts are never deleted once they have
// been Active — only a Draft can be removed.
//
// The audit trail is keyed on the lineage, not on the row, so one query returns
// the history of every version. This repository reads payers through their
// repository (never their table) for the payer name and type.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as payers from './payers.js';
import { current as currentRole } from '../../shared/roles.js';

const TABLE = 'contracts';
const ENTITY = 'contract';

export const STATUSES = ['Draft', 'Active', 'Expired', 'Terminated'];
export const EXPIRY_WINDOWS = [30, 60, 90];

const FIELD_LABELS = {
  name: 'name',
  contractNo: 'contract no.',
  startDate: 'start date',
  endDate: 'end date',
};

export const today = () => new Date().toISOString().slice(0, 10);

export function all() {
  return store.table(TABLE);
}

export function get(id) {
  return all().find((c) => c.id === id) || null;
}

/** One payer's contracts, newest agreement first. */
export function byPayer(payerId) {
  return all()
    .filter((c) => c.payerId === payerId)
    .sort((a, b) => b.startDate.localeCompare(a.startDate) || b.version - a.version);
}

export function activeOnly() {
  return all().filter((c) => c.status === 'Active');
}

/** Every version of one agreement, oldest first. */
export function versionsOf(lineageId) {
  return all()
    .filter((c) => c.lineageId === lineageId)
    .sort((a, b) => a.version - b.version);
}

export function nextVersion(lineageId) {
  return versionsOf(lineageId).reduce((n, c) => Math.max(n, c.version), 0) + 1;
}

/** The version a payer list shows for a lineage: the newest one. */
export function currentOf(lineageId) {
  const rows = versionsOf(lineageId);
  return rows[rows.length - 1] || null;
}

export const payerOf = (contract) => (contract ? payers.get(contract.payerId) : null);
export const payerName = (contract) => payerOf(contract)?.nameEn || '—';

export function statusTone(status) {
  if (status === 'Active') return 'success';
  if (status === 'Expired') return 'warning';
  if (status === 'Terminated') return 'critical';
  return '';
}

/** Whole days from today to the end date. Negative once the date has passed. */
export function daysLeft(contract) {
  if (!contract?.endDate) return null;
  return Math.round((Date.parse(contract.endDate) - Date.parse(today())) / 86400000);
}

/** The linked plans, read off the payer — name, code and current status. */
export function plansOf(contract) {
  const payer = payerOf(contract);
  return (contract?.planIds || []).map((id) => {
    const plan = payer?.plans.find((p) => p.id === id);
    return plan ? { ...plan } : { id, name: id, code: '—', status: 'Inactive' };
  });
}

/**
 * Contract numbers are unique within a payer. Versions of one agreement keep
 * the same number, so the lineage of `excludeId` never counts against itself.
 */
export function isContractNoUnique(payerId, no, excludeId = null) {
  const needle = String(no || '').trim().toLowerCase();
  const lineage = excludeId ? get(excludeId)?.lineageId : null;
  return !all().some(
    (c) =>
      c.payerId === payerId &&
      c.id !== excludeId &&
      c.lineageId !== lineage &&
      c.contractNo.trim().toLowerCase() === needle,
  );
}

/**
 * The first Active or Draft contract already covering one of these plans over
 * an intersecting date range, or null. Expired and Terminated contracts never
 * conflict, and neither do other versions of the same agreement. Returns
 * { contract, planId, planName } so the form can name both.
 */
export function planOverlap(planIds, start, end, excludeId = null) {
  const wanted = new Set(planIds || []);
  const lineage = excludeId ? get(excludeId)?.lineageId : null;
  for (const c of all()) {
    if (c.id === excludeId || (lineage && c.lineageId === lineage)) continue;
    if (c.status !== 'Active' && c.status !== 'Draft') continue;
    if (!(start <= c.endDate && c.startDate <= end)) continue;
    const hit = c.planIds.find((id) => wanted.has(id));
    if (hit) {
      const plan = plansOf(c).find((p) => p.id === hit);
      return { contract: c, planId: hit, planName: plan?.name || hit };
    }
  }
  return null;
}

/** list({ q, payerType, expiring, status, payerId, onlyActive, sort, dir }). */
export function list({
  q = '', payerType = '', expiring = '', status = '', payerId = '',
  onlyActive = false, sort = 'endDate', dir = 'asc',
} = {}) {
  const needle = q.trim().toLowerCase();
  const rows = all().filter((c) => {
    if (onlyActive && c.status !== 'Active') return false;
    if (status && c.status !== status) return false;
    if (payerId && c.payerId !== payerId) return false;
    if (payerType && payerOf(c)?.type !== payerType) return false;
    if (expiring) {
      const days = daysLeft(c);
      if (days == null || days < 0 || days > Number(expiring)) return false;
    }
    if (!needle) return true;
    return (
      c.name.toLowerCase().includes(needle) ||
      c.contractNo.toLowerCase().includes(needle) ||
      payerName(c).toLowerCase().includes(needle)
    );
  });

  const sign = dir === 'desc' ? -1 : 1;
  return rows.sort((a, b) => {
    if (sort === 'version') return (a.version - b.version) * sign;
    if (sort === 'rules') return (a.rules.length - b.rules.length) * sign;
    const av = sort === 'payer' ? payerName(a) : a[sort];
    const bv = sort === 'payer' ? payerName(b) : b[sort];
    return String(av ?? '').localeCompare(String(bv ?? '')) * sign;
  });
}

export function counts() {
  const active = activeOnly();
  return {
    total: all().length,
    active: active.length,
    expiring30: active.filter((c) => {
      const days = daysLeft(c);
      return days != null && days >= 0 && days <= 30;
    }).length,
    draft: all().filter((c) => c.status === 'Draft').length,
    payers: new Set(active.map((c) => c.payerId)).size,
  };
}

/**
 * Active contracts past their end date are Expired. Runs once when this module
 * loads, so every screen reads a current list.
 */
export function expireContracts() {
  const now = today();
  let expired = 0;
  for (const row of all()) {
    if (row.status !== 'Active' || !row.endDate || row.endDate >= now) continue;
    row.status = 'Expired';
    row.updatedAt = new Date().toISOString();
    expired += 1;
    log(row, 'Expired', `Term ended ${row.endDate}`);
  }
  if (expired) store.commit('contract.expire');
  return expired;
}

// --- writes ------------------------------------------------------------------

export function create(data) {
  const now = new Date().toISOString();
  const row = {
    id: store.nextId(TABLE, 'CTR-'),
    payerId: '',
    contractNo: '',
    name: '',
    version: 1,
    lineageId: newLineageId(),
    status: 'Draft',
    startDate: '',
    endDate: '',
    effectiveDate: null,
    closedAt: null,
    terminationDate: null,
    terminationReason: '',
    // Filled by later amendments — empty structures so the contract page can
    // count them today.
    methodologies: [],
    overagePolicies: [],
    coverage: [],
    preAuth: {},
    rules: [],
    ...data,
    planIds: [...(data.planIds || [])],
    document: data.document ? { ...data.document } : null,
    createdBy: currentRole().name,
    createdAt: now,
    updatedAt: now,
  };
  all().push(row);
  store.commit('contract.create');
  log(row, 'Created', `${row.contractNo} — ${row.name}`);
  return row;
}

/** Corrective edit — same version, field-level diff in the trail. */
export function update(id, patch) {
  const row = get(id);
  if (!row) return null;

  const before = { ...row, planIds: [...row.planIds], document: row.document ? { ...row.document } : null };
  Object.assign(row, patch, {
    planIds: [...(patch.planIds ?? row.planIds)],
    document:
      patch.document === undefined ? row.document : (patch.document ? { ...patch.document } : null),
    updatedAt: new Date().toISOString(),
  });
  store.commit('contract.update');

  const changed = diff(before, row);
  if (changed.length) log(row, 'Corrective edit', changed.join('; '));
  return row;
}

/** Activate a Draft. The previous Active version of the lineage is closed. */
export function activate(id, effectiveDate) {
  const row = get(id);
  if (!row || row.status !== 'Draft') return null;

  const previous = versionsOf(row.lineageId).find((c) => c.status === 'Active' && c.id !== id);
  if (previous) {
    previous.status = 'Expired';
    previous.closedAt = effectiveDate;
    previous.updatedAt = new Date().toISOString();
    log(previous, 'Expired', `Closed ${effectiveDate} — replaced by version ${row.version}`);
  }

  row.status = 'Active';
  row.effectiveDate = effectiveDate;
  row.updatedAt = new Date().toISOString();
  store.commit('contract.activate');
  log(row, 'Activated', `Active from ${effectiveDate}${previous ? `, version ${previous.version} closed` : ''}`);
  return row;
}

export function terminate(id, { terminationDate, terminationReason }) {
  const row = get(id);
  if (!row || row.status !== 'Active') return null;
  row.status = 'Terminated';
  row.terminationDate = terminationDate;
  row.terminationReason = terminationReason;
  row.updatedAt = new Date().toISOString();
  store.commit('contract.terminate');
  log(row, 'Terminated', `Terminated ${terminationDate} — ${terminationReason}`);
  return row;
}

/** Only a Draft can be removed; every other status stays on file. */
export function deleteDraft(id) {
  const row = get(id);
  if (!row || row.status !== 'Draft') return false;
  all().splice(all().indexOf(row), 1);
  store.commit('contract.delete');
  log(row, 'Draft deleted', `${row.contractNo} — ${row.name}`);
  return true;
}

/** Change edit — a deep copy at the next version, Draft, same lineage. */
export function createVersion(id, note = '') {
  const source = get(id);
  if (!source) return null;
  const version = nextVersion(source.lineageId);
  const now = new Date().toISOString();
  const row = {
    ...structuredClone(source),
    id: store.nextId(TABLE, 'CTR-'),
    version,
    status: 'Draft',
    effectiveDate: null,
    closedAt: null,
    terminationDate: null,
    terminationReason: '',
    createdBy: currentRole().name,
    createdAt: now,
    updatedAt: now,
  };
  all().push(row);
  store.commit('contract.version');
  audit.log({
    entity: ENTITY,
    entityId: source.lineageId,
    action: `Change edit → v${version}`,
    details: `v${source.version} · Version ${version} draft created${note ? ` — ${note}` : ''}`,
  });
  return row;
}

// --- internals ---------------------------------------------------------------

function log(row, action, details) {
  audit.log({ entity: ENTITY, entityId: row.lineageId, action, details: `v${row.version} · ${details}` });
}

function newLineageId() {
  const max = all().reduce((n, c) => {
    const digits = Number(String(c.lineageId).replace('CL-', ''));
    return Number.isFinite(digits) && digits > n ? digits : n;
  }, 0);
  return `CL-${String(max + 1).padStart(4, '0')}`;
}

const show = (v) => (v === '' || v == null ? '—' : String(v));

function diff(before, after) {
  const changed = Object.entries(FIELD_LABELS)
    .filter(([key]) => String(before[key] ?? '') !== String(after[key] ?? ''))
    .map(([key, text]) => `${text} ${show(before[key])} → ${show(after[key])}`);
  if (before.planIds.join() !== after.planIds.join()) {
    changed.push(`plans ${before.planIds.length} → ${after.planIds.length}`);
  }
  if ((before.document?.fileName || '') !== (after.document?.fileName || '')) {
    changed.push(`document ${show(before.document?.fileName)} → ${show(after.document?.fileName)}`);
  }
  return changed;
}

expireContracts();
