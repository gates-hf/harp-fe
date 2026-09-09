// Repository — policies. Owner: modules/frontis (Patient Access & Eligibility).
// The only way any module reads or writes a patient's insurance. Encounters,
// eligibility and billing will reference a policy by its id.
//
// A patient's policies fall into two sets: the chain — the Active policies
// numbered 1..3, which is the order a claim is billed in — and everything out
// of it (suspended, cancelled, expired), which is kept for the record. Only the
// chain carries a priority; leaving it always sets priority to null and
// renumbers what is left, so the chain has no gaps.
//
// Self-Pay is not a policy and is never a row here: a patient with an empty
// chain is self-pay, and every caller appends that fallback itself.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as patients from './patients.js';
import * as payers from './payers.js';
import * as contracts from './contracts.js';
import { compareDates, iso, todayIso } from '../../shared/format.js';

const TABLE = 'policies';

/** The trail is keyed on this entity name, not the table — one policy, one id. */
const ENTITY = 'policy';

export const RELATIONSHIPS = ['Self', 'Spouse', 'Child', 'Parent', 'Other'];
export const STATUSES = ['Active', 'Suspended', 'Cancelled', 'Expired'];

/** Three positions, no more: primary, secondary, tertiary, then Self-Pay. */
export const MAX_CHAIN = 3;
export const MAX_CARD_BYTES = 10 * 1024 * 1024;

const RANKS = { 1: 'Primary', 2: 'Secondary', 3: 'Tertiary' };

const FIELD_LABELS = {
  payerId: 'payer',
  planId: 'plan',
  memberId: 'member ID',
  policyNo: 'policy no.',
  relationship: 'relationship',
  holderName: 'policy holder',
  validFrom: 'valid from',
  validTo: 'valid to',
};

export const fieldLabel = (key) => FIELD_LABELS[key] || key;

export function all() {
  return store.table(TABLE);
}

export function get(id) {
  return all().find((p) => p.id === id) || null;
}

// --- reading ------------------------------------------------------------------

/** One patient's policies: the chain in order, then everything out of it. */
export function byPatient(mrn) {
  const rows = all().filter((p) => p.patientMrn === mrn);
  const inChain = rows.filter((p) => p.priority).sort((a, b) => a.priority - b.priority);
  const out = rows
    .filter((p) => !p.priority)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return [...inChain, ...out];
}

/**
 * The billing order: Active policies, priority 1 first. This is what eligibility
 * and billing consume. It is empty for a self-pay patient — the fallback is not
 * a record, so a caller that needs it appends it after this list.
 */
export const chain = (mrn) => byPatient(mrn).filter((p) => p.status === 'Active' && p.priority);

/** A fourth active policy has nowhere to sit. */
export const canAddToChain = (mrn) => chain(mrn).length < MAX_CHAIN;

export const priorityLabel = (priority) => (priority ? `${priority} ${RANKS[priority]}` : '—');

export function statusTone(status) {
  if (status === 'Active') return 'success';
  if (status === 'Suspended') return 'warning';
  if (status === 'Cancelled') return 'critical';
  return '';
}

export const payerOf = (policy) => (policy ? payers.get(policy.payerId) : null);
export const payerName = (policy) => payerOf(policy)?.nameEn || '—';
export const planOf = (policy) => payerOf(policy)?.plans.find((pl) => pl.id === policy.planId) || null;
export const planName = (policy) => planOf(policy)?.name || '—';
export const label = (policy) => `${payerName(policy)} · ${planName(policy)}`;

/** The payer that owns a plan — the picker knows it, the repository looks it up. */
export const payerOfPlan = (planId) => payers.all().find((p) => p.plans.some((pl) => pl.id === planId)) || null;

/** Days until the policy runs out; negative once it has. */
export function daysLeft(policy) {
  const end = iso(policy?.validTo);
  if (!end) return null;
  return Math.round((Date.parse(end) - Date.parse(todayIso())) / 86400000);
}

/** A member ID belongs to one patient per payer. Pass the id when editing. */
export function isMemberIdUnique(payerId, memberId, excludeId = null) {
  const needle = String(memberId || '').trim().toLowerCase();
  if (!needle) return true;
  return !all().some(
    (p) => p.id !== excludeId && p.payerId === payerId && String(p.memberId).trim().toLowerCase() === needle,
  );
}

/**
 * Two live policies with the same payer over the same dates are a data-entry
 * mistake far more often than a real double cover, so the modal warns and lets
 * the clerk save anyway. Cancelled and expired rows cannot conflict.
 */
export function overlaps(mrn, payerId, from, to, excludeId = null) {
  const start = iso(from);
  const end = iso(to);
  if (!start || !end) return null;
  return (
    all().find(
      (p) =>
        p.patientMrn === mrn &&
        p.payerId === payerId &&
        p.id !== excludeId &&
        (p.status === 'Active' || p.status === 'Suspended') &&
        compareDates(start, p.validTo) <= 0 &&
        compareDates(end, p.validFrom) >= 0,
    ) || null
  );
}

/** Whether Pactum holds a contract that would price this plan on that date. */
export function planHasActiveContract(planId, on = todayIso()) {
  const payer = payerOfPlan(planId);
  return Boolean(payer && contracts.contractForService(payer.id, planId, on));
}

/** "1 NSSF → 2 AXA" — the chain as one line, for the reorder trail and preview. */
export const orderLabel = (mrn) =>
  chain(mrn).map((p) => `${p.priority} ${payerName(p)}`).join(' → ') || 'empty';

// --- writes -------------------------------------------------------------------

export function create(data) {
  const now = new Date().toISOString();
  const row = {
    id: store.nextId(TABLE, 'POL-'),
    patientMrn: '',
    payerId: '',
    planId: '',
    memberId: '',
    policyNo: '',
    relationship: 'Self',
    holderName: null,
    validFrom: '',
    validTo: '',
    priority: null,
    status: 'Active',
    statusReason: '',
    lastVerifiedAt: null,
    cardFront: null,
    cardBack: null,
    usedInEncounters: false,
    ...data,
    createdAt: now,
    updatedAt: now,
  };
  row.priority = canAddToChain(row.patientMrn) ? chain(row.patientMrn).length + 1 : null;
  all().push(row);
  store.commit('policy.create');
  log(row, 'Added', `${label(row)} — ${priorityLabel(row.priority)}, valid ${row.validFrom} to ${row.validTo}`);
  return row;
}

/**
 * Replace the editable fields of one policy. A changed payer or plan on a policy
 * claims were filed under carries the clerk's reason into the trail — the screen
 * asks for it, this records it.
 */
export function update(id, patch, { reason = '' } = {}) {
  const row = get(id);
  if (!row) return null;

  const before = { ...row };
  Object.assign(row, patch, { updatedAt: new Date().toISOString() });
  store.commit('policy.update');

  const changed = Object.keys(FIELD_LABELS).filter((key) => before[key] !== row[key]);
  if (changed.length) {
    const diff = changed.map((key) => `${FIELD_LABELS[key]}: ${show(before, key)} → ${show(row, key)}`).join('; ');
    log(row, 'Updated', reason ? `${diff} — reason: ${reason}` : diff);
  }
  return row;
}

/**
 * setStatus(id, status, reason) — the one door out of the chain and back into
 * it. Suspend and Cancel drop the priority and compact what is left; Reactivate
 * appends at the end of the chain. Expired is set by expirePolicies() alone.
 */
export function setStatus(id, status, reason = '') {
  const row = get(id);
  if (!row || !STATUSES.includes(status) || row.status === status) return null;

  const was = row.status;
  row.status = status;
  row.statusReason = reason;
  row.priority = status === 'Active' && canAddToChain(row.patientMrn) ? chain(row.patientMrn).length + 1 : null;
  row.updatedAt = new Date().toISOString();
  store.commit('policy.status');

  const action = status === 'Suspended' ? 'Suspended'
    : status === 'Cancelled' ? 'Cancelled'
      : status === 'Active' ? 'Reactivated' : 'Expired';
  const seat = row.priority ? ` — back in the chain at ${priorityLabel(row.priority)}` : '';
  log(row, action, `${was} → ${status}${seat}${reason ? ` — reason: ${reason}` : ''}`);

  compact(row.patientMrn);
  return row;
}

/**
 * A passing eligibility check is the only thing that verifies a policy, so the
 * date it stamps here comes from the check and nowhere else. It changes nothing
 * else about the policy, and the check's own reference is what the trail names
 * — the policy history says when it was last confirmed and against which check.
 */
export function markVerified(id, at, ref = '') {
  const row = get(id);
  if (!row) return null;
  const on = iso(at) || todayIso();
  if (row.lastVerifiedAt === on) return row;
  row.lastVerifiedAt = on;
  row.updatedAt = new Date().toISOString();
  store.commit('policy.verified');
  log(row, 'Verified', `Eligibility confirmed on ${on}${ref ? ` — check ${ref}` : ''}`);
  return row;
}

/** reorder(mrn, orderedIds) — the chain renumbered 1..n in the order given. */
export function reorder(mrn, orderedIds) {
  const before = orderLabel(mrn);
  const rows = orderedIds.map(get).filter((p) => p && p.patientMrn === mrn && p.status === 'Active');
  if (rows.length !== chain(mrn).length) return null;
  return renumber(mrn, rows, before, 'Priority changed');
}

/**
 * A policy leaving the chain leaves a hole in the numbering, so what is left
 * closes up: the remaining Active policies keep their order and are renumbered
 * 1..n. It reads as a reorder in the trail, because that is what it is.
 */
function compact(mrn) {
  const before = orderLabel(mrn);
  const rows = chain(mrn);
  return renumber(mrn, rows, before, 'Priority compacted');
}

function renumber(mrn, rows, before, action) {
  const now = new Date().toISOString();
  const moved = [];
  rows.forEach((row, i) => {
    if (row.priority === i + 1) return;
    row.priority = i + 1;
    row.updatedAt = now;
    moved.push(row);
  });
  if (!moved.length) return null;
  store.commit('policy.reorder');
  const after = orderLabel(mrn);
  for (const row of moved) log(row, action, `Priority order changed: ${before} → ${after}`);
  return after;
}

/**
 * Active policies past their end date, retired on load. Each drops out of the
 * chain and what is left closes up, so a stale policy never sits at priority 1.
 */
export function expirePolicies(on = todayIso()) {
  const touched = new Set();
  const now = new Date().toISOString();
  for (const row of all()) {
    if (row.status !== 'Active' || !row.validTo || compareDates(row.validTo, on) >= 0) continue;
    row.status = 'Expired';
    row.priority = null;
    row.statusReason = `Validity ended ${row.validTo}`;
    row.updatedAt = now;
    log(row, 'Expired', `Validity ended ${row.validTo}`);
    touched.add(row.patientMrn);
  }
  if (!touched.size) return 0;
  store.commit('policy.expire');
  for (const mrn of touched) compact(mrn);
  return touched.size;
}

// --- merge --------------------------------------------------------------------

/**
 * Policies follow the patient when two records are folded together. The merge
 * screen counts them here before anything moves, and merge() re-points them.
 * A survivor's chain is capped at three, so anything that will not fit arrives
 * out of the chain and the clerk reorders it.
 */
patients.relinkHooks.push({
  label: 'Policies',
  count: (mrn) => all().filter((p) => p.patientMrn === mrn).length,
  relink: (fromMrn, toMrn) => {
    const moving = byPatient(fromMrn);
    if (!moving.length) return 0;
    const now = new Date().toISOString();
    for (const row of moving) {
      row.patientMrn = toMrn;
      row.priority = null;
      row.updatedAt = now;
      log(row, 'Re-linked', `Moved from ${fromMrn} to ${toMrn} on merge`);
    }
    const keep = chain(toMrn).concat(moving.filter((p) => p.status === 'Active')).slice(0, MAX_CHAIN);
    renumber(toMrn, keep, 'the survivor’s chain', 'Priority changed');
    return moving.length;
  },
});

// --- internals ----------------------------------------------------------------

function log(row, action, details) {
  audit.log({ entity: ENTITY, entityId: row.id, action, details });
}

function show(row, key) {
  if (key === 'payerId') return payerName(row);
  if (key === 'planId') return planName(row);
  const value = row[key];
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

expirePolicies();
