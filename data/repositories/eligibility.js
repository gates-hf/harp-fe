// Repository — eligibility snapshots. Owner: modules/frontis.
//
// Append-only by design. A snapshot is what the platform answered at a moment,
// which is exactly what a payer dispute is argued from: there is no update and
// no delete. Two fields may be set afterwards and both are audited — the
// encounter a check was consumed by, and the override a supervisor recorded
// beside the system answer. `systemResult` is never touched by either.
//
// The dataset seeds itself on first read (data/seed/eligibility.js) rather than
// through data/store.js, because it has to read the contracts, the charge
// master and the register to exist. A reset empties the table and the next read
// rebuilds the same trail.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as patients from './patients.js';
import * as policies from './policies.js';
import { buildEligibility } from '../seed/eligibility.js';
import { RESULTS, resultTone, isPass } from '../engines/eligibility-engine.js';
import { current as currentRole } from '../../shared/roles.js';
import { compareDates, iso, todayIso } from '../../shared/format.js';

const TABLE = 'eligibility';

/** The trail is keyed on this entity name; a snapshot's id is its reference. */
const ENTITY = 'eligibility';

export const CHECK_TYPES = ['Manual', 'Auto-Registration', 'Pre-Registration', 'Re-check'];
export const OVERRIDE_REASONS = ['Payer phone confirmation', 'Payer portal', 'Management decision', 'Other'];

/** The two reasons that name something outside the platform, so both need a ref. */
export const PAYER_REASONS = ['Payer phone confirmation', 'Payer portal'];

/** How long a check stays good enough for registration to reuse. */
export const REUSE_DAYS = 7;

export { RESULTS, resultTone, isPass };

export function all() {
  const rows = store.table(TABLE);
  if (!rows.length) rows.push(...buildEligibility());
  return rows;
}

export const get = (ref) => all().find((row) => row.ref === ref) || null;

export const isOverridden = (row) => Boolean(row?.override);

/**
 * What the check was run against — a policy, a cover a pre-registration is
 * still holding, or the self-pay fallback. A pre-registration check names a
 * plan without a policy id: the card exists, the record it will hang off does
 * not, and reading that as Self-Pay would say the opposite of what was asked.
 */
export function coverLabel(row) {
  if (row?.policyId) {
    const policy = policies.get(row.policyId);
    return policy ? policies.label(policy) : 'Policy no longer on file';
  }
  if (row?.planId) {
    const payer = policies.payerOfPlan(row.planId);
    const plan = payer?.plans.find((p) => p.id === row.planId);
    return `${payer?.nameEn || '—'}${plan ? ` · ${plan.name}` : ''} (not yet on file)`;
  }
  return 'Self-Pay';
}

/**
 * A check run before the patient was registered has no MRN to read a name off,
 * so it is named by the pre-registration it belongs to — which is also the only
 * record that holds the name at that point.
 */
export const patientName = (row) =>
  patients.get(row?.patientMrn)?.nameEn || row?.patientMrn || row?.preregNo || '—';

// --- reading ------------------------------------------------------------------

/** One patient's checks, newest first — what the record's Eligibility tab draws. */
export const byPatient = (mrn) =>
  all()
    .filter((row) => row.patientMrn === mrn)
    .sort((a, b) => String(b.checkedAt).localeCompare(String(a.checkedAt)));

/** Every attempt in one cascade, the first attempt included, oldest first. */
export function cascadeOf(ref) {
  const row = get(ref);
  if (!row) return [];
  const first = row.attemptOf || row.ref;
  return all()
    .filter((r) => r.ref === first || r.attemptOf === first)
    .sort((a, b) => String(a.checkedAt).localeCompare(String(b.checkedAt)));
}

/**
 * list({ q, result, payerId, from, to, overridden }) — the worklist's one query,
 * newest first. `q` matches the reference, the MRN or the patient's name.
 * `overridden` has no control of its own on the screen: the card that counts
 * them is its own filter, and Clear filters clears it with the rest.
 */
export function list({ q = '', result = '', payerId = '', from = '', to = '', overridden = false } = {}) {
  const needle = String(q).trim().toLowerCase();
  return all()
    .filter((row) => {
      if (result && row.finalResult !== result) return false;
      if (payerId && row.payerId !== payerId) return false;
      if (overridden && !isOverridden(row)) return false;
      const on = String(row.checkedAt).slice(0, 10);
      if (from && compareDates(on, from) < 0) return false;
      if (to && compareDates(on, to) > 0) return false;
      if (!needle) return true;
      return [row.ref, row.patientMrn, patientName(row)]
        .some((v) => String(v).toLowerCase().includes(needle));
    })
    .sort((a, b) => String(b.checkedAt).localeCompare(String(a.checkedAt)));
}

export const checkedOn = (day = todayIso()) =>
  all().filter((row) => String(row.checkedAt).slice(0, 10) === day);

/** The rail's five figures, all read off the same list the table shows. */
export function counts(rows = all()) {
  const today = todayIso();
  return {
    today: rows.filter((row) => String(row.checkedAt).slice(0, 10) === today).length,
    eligible: rows.filter((row) => row.finalResult === 'Eligible').length,
    conditions: rows.filter((row) => row.finalResult === 'Eligible with Conditions').length,
    notEligible: rows.filter((row) => row.finalResult === 'Not Eligible').length,
    overridden: rows.filter((row) => isOverridden(row)).length,
    selfPay: rows.filter((row) => row.finalResult === 'Self-Pay').length,
  };
}

/**
 * The newest check registration may reuse: same patient, same policy, a passing
 * final result and made inside the window. Encounter Registration calls this
 * before running a check of its own, so a patient verified at the desk an hour
 * earlier is not verified twice.
 */
export function latestValid(mrn, policyId, days = REUSE_DAYS) {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  return (
    byPatient(mrn).find(
      (row) =>
        (row.policyId || null) === (policyId || null) &&
        isPass(row.finalResult) &&
        String(row.checkedAt) >= cutoff,
    ) || null
  );
}

/** Next reference in this year's sequence, read off the trail itself. */
export function nextRef(year = new Date().getFullYear()) {
  const prefix = `ELG-${year}-`;
  const max = all().reduce((n, row) => {
    if (!String(row.ref).startsWith(prefix)) return n;
    const digits = Number(String(row.ref).slice(prefix.length));
    return Number.isFinite(digits) && digits > n ? digits : n;
  }, 0);
  return prefix + String(max + 1).padStart(6, '0');
}

// --- writes -------------------------------------------------------------------

/**
 * Record one attempt. Everything the engine answered is stored as it stands —
 * the snapshot is the evidence, so nothing here recomputes it.
 */
export function create(data) {
  const rows = all();
  const row = {
    ref: nextRef(),
    patientMrn: '',
    policyId: null,
    payerId: null,
    planId: null,
    checkType: 'Manual',
    visitType: null,
    services: [],
    checkedAt: new Date().toISOString(),
    checkedBy: currentRole().name,
    systemResult: 'Not Eligible',
    steps: [],
    conditions: [],
    failureReasons: [],
    coverageSummary: null,
    contract: null,
    override: null,
    encounterId: null,
    // The pre-registration a check was run for, when it was run before there
    // was a patient record to run it against.
    preregNo: null,
    attemptOf: null,
    ...data,
  };
  row.finalResult = row.override?.result || row.systemResult;
  rows.push(row);
  store.commit('eligibility.create');
  log(row, 'Checked', `${row.checkType} check — ${coverLabel(row)}: ${row.systemResult}`);
  return row;
}

/**
 * The one field registration sets after the fact: which encounter consumed the
 * check. It is never re-pointed — a snapshot belongs to one encounter.
 */
export function attachEncounter(ref, encounterId) {
  const row = get(ref);
  if (!row || !encounterId || row.encounterId) return null;
  row.encounterId = encounterId;
  store.commit('eligibility.attach');
  log(row, 'Linked to encounter', `Encounter ${encounterId}`);
  return row;
}

/**
 * The last fields a snapshot may gain after it is written, and the same shape
 * as the encounter link: a check run for a pre-registration has neither an MRN
 * nor a policy id, because neither the patient nor the cover was on file when
 * the payer answered. Registering them creates both, and resolving the patient
 * alone would leave a check made against a real card looking like a self-pay
 * answer, which `latestValid` would then offer to the wrong classification.
 *
 * Which is why the guard is per field rather than on the MRN alone: today both
 * arrive in one call, but a flow that registered the patient and filed the card
 * second would otherwise be locked out of ever resolving the policy, and would
 * fail the silent way — the check simply stops being reusable.
 *
 * It is gated on `preregNo`, and that gate is doing real work: an ordinary
 * self-pay check also has an MRN and no policy, and it is *meant* to. Only a
 * snapshot that named a pre-registration in place of a record can be resolved,
 * so no other check can have a payer written onto it after the fact.
 *
 * The answer itself is untouched either way: what changes is which records the
 * evidence hangs off, which is what `byPatient`, `latestValid` and the record's
 * Eligibility tab all read by.
 */
export function attachPatient(ref, mrn, policyId = null) {
  const row = get(ref);
  if (!row || !mrn || !row.preregNo) return null;

  const patient = row.patientMrn ? null : mrn;
  const policy = policyId && !row.policyId ? policyId : null;
  if (!patient && !policy) return null;

  if (patient) row.patientMrn = patient;
  if (policy) row.policyId = policy;
  store.commit('eligibility.attach-patient');
  log(row, 'Linked to patient', patient
    ? `Registered as ${patient} from ${row.preregNo}${policy ? ` · policy ${policy}` : ''}`
    : `Cover filed as ${policy} from ${row.preregNo}`);
  return row;
}

/**
 * A supervisor's answer, stored beside the system's and never in place of it.
 * Both are shown wherever the snapshot is read, and the trail names the move.
 */
export function applyOverride(ref, override) {
  const row = get(ref);
  if (!row || row.override) return null;
  row.override = {
    result: override.result,
    reason: override.reason,
    payerRef: override.payerRef || '',
    contact: override.contact || '',
    note: override.note || '',
    by: override.by || currentRole().name,
    at: new Date().toISOString(),
  };
  row.finalResult = row.override.result;
  store.commit('eligibility.override');
  const ticket = row.override.payerRef ? `, ref ${row.override.payerRef}` : '';
  log(row, 'Overridden',
    `Eligibility overridden: ${row.systemResult} → ${row.override.result} (${row.override.reason}${ticket})`);
  return row;
}

// --- internals ----------------------------------------------------------------

function log(row, action, details) {
  audit.log({ entity: ENTITY, entityId: row.ref, action, details });
}

/** Kept for the screens that ask "was this check made on or after X?". */
export const checkedOnOrAfter = (row, day) => compareDates(String(row.checkedAt).slice(0, 10), iso(day)) >= 0;
