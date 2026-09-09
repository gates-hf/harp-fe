// Repository — pre-registrations. Owner: modules/frontis.
//
// A pre-registration is what the hospital knows about a visit before the
// patient arrives, held in one place so that conversion is a hand-off and not a
// re-typing: the identity becomes a patient record, the cover becomes a policy,
// the pre-check becomes the encounter's eligibility snapshot and the expected
// visit becomes the encounter itself.
//
// It is a holding pen, not an archive. Every open row is either Pending or
// Ready, and which one it is is never a field a caller passes: completeness
// decides, on every save. Two doors close a row for good — Converted and
// Cancelled — and one closes it by neglect: expirePreregs() retires anything
// still open 48 hours after the arrival it was expecting.
//
// The dataset seeds itself on first read (data/seed/prereg.js) rather than
// through data/store.js: it reads the register, the policy chains, the charge
// master and the encounter board to exist.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as patients from './patients.js';
import * as policies from './policies.js';
import * as eligibility from './eligibility.js';
import { buildPrereg, buildPreregTrail } from '../seed/prereg.js';
import { computeCompleteness } from '../engines/prereg-completeness.js';
import { compareDates, iso, todayIso } from '../../shared/format.js';

const TABLE = 'prereg';

/** The trail is keyed on this entity name; a pre-registration's id is its no. */
const ENTITY = 'prereg';

export const STATUSES = ['Pending', 'Ready', 'Converted', 'Cancelled', 'Expired'];

/** The two a pre-registration can still be worked on from. */
export const OPEN_STATUSES = ['Pending', 'Ready'];

export const VISIT_TYPES = ['OP', 'IP', 'ER', 'Day Case'];

export const TYPE_LABELS = {
  OP: 'Outpatient', IP: 'Inpatient', ER: 'Emergency', 'Day Case': 'Day Case',
};

/**
 * Three vocabularies meet on this entity and each conversion needs its own map.
 * The board speaks in two-letter codes and has no Day Case — a day case is
 * booked as an outpatient visit and priced as a day case — while the
 * eligibility engine speaks in visit types, where Day Case is its own word.
 */
export const ENCOUNTER_TYPE_OF = { OP: 'OP', IP: 'IP', ER: 'ER', 'Day Case': 'OP' };
export const VISIT_TYPE_OF = {
  OP: 'Outpatient', IP: 'Inpatient', ER: 'Emergency', 'Day Case': 'Day Case',
};

export const CONFIG = {
  // How long after the expected arrival an unconverted row is left open. Two
  // days: a patient who did not come yesterday may still come today.
  preregExpiryHours: 48,
};

export function all() {
  const rows = store.table(TABLE);
  if (!rows.length) {
    // The eligibility trail is read first so the seed's own references continue
    // its sequence rather than colliding with it.
    const checks = eligibility.all();
    const built = buildPrereg(eligibility.nextRef());
    rows.push(...built.rows);
    checks.push(...built.snapshots);
    // The seeded trail, written with the times the events happened at rather
    // than through audit.log(), which would stamp them all with now.
    const trail = audit.all();
    for (const item of buildPreregTrail(built.rows)) {
      trail.push({ id: store.nextId('audit', 'AU-'), ...item });
    }
  }
  return rows;
}

export const get = (no) => all().find((row) => row.no === no) || null;

export const isOpen = (row) => OPEN_STATUSES.includes(row?.status);

export const typeLabel = (type) => TYPE_LABELS[type] || type || '—';

export function statusTone(status) {
  if (status === 'Ready') return 'success';
  if (status === 'Pending') return 'warning';
  if (status === 'Converted') return 'accent';
  if (status === 'Cancelled') return 'critical';
  return '';
}

/** Done, Failed or Pending, with the tone and the word the badge carries. */
export function precheckIndicator(row) {
  const status = row?.precheck?.status || 'Pending';
  if (status === 'Done') return { status, tone: 'success', label: 'Pre-check run against the cover on file' };
  if (status === 'Failed') return { status, tone: 'critical', label: 'The payer refused the cover — open the snapshot' };
  return { status, tone: '', label: 'No pre-check has been run yet' };
}

// --- reading ------------------------------------------------------------------

/** The name to show: the linked record's, or the one taken over the phone. */
export const patientName = (row) =>
  (row?.patientMrn ? patients.get(row.patientMrn)?.nameEn : row?.newPatient?.nameEn) || '—';

export const phoneOf = (row) =>
  (row?.patientMrn ? patients.get(row.patientMrn)?.phone : row?.newPatient?.phone) || '';

const identifiersOf = (row) => {
  const p = row?.patientMrn ? patients.get(row.patientMrn) : row?.newPatient;
  return [p?.civilId, p?.passportNo].filter(Boolean);
};

export const completeness = (row) => computeCompleteness(row);

/** The cover in words — a policy, a pending one, or the self-pay decision. */
export function coverLabel(row) {
  const insurance = row?.insurance || {};
  if (insurance.mode === 'selfpay') return 'Self-Pay';
  if (insurance.policyId) {
    const policy = policies.get(insurance.policyId);
    return policy ? policies.label(policy) : 'Policy no longer on file';
  }
  if (insurance.pendingPolicy) {
    const payer = policies.payerOfPlan(insurance.pendingPolicy.planId);
    const plan = payer?.plans.find((p) => p.id === insurance.pendingPolicy.planId);
    return `${payer?.nameEn || '—'}${plan ? ` · ${plan.name}` : ''}`;
  }
  return 'Not captured';
}

/** One patient's pre-registrations, soonest arrival first. */
export const byPatient = (mrn) =>
  all()
    .filter((row) => row.patientMrn === mrn)
    .sort((a, b) => String(a.visit.expectedAt).localeCompare(String(b.visit.expectedAt)));

/** What the record's Encounters tab lists as expected: still open, still ahead. */
export const expectedFor = (mrn) =>
  byPatient(mrn).filter((row) => isOpen(row) && String(row.visit.expectedAt) >= new Date().toISOString());

/** Expected today, or still open from an arrival that has already passed. */
export const today = (on = todayIso()) =>
  all().filter((row) => expectedOn(row, on) || (isOpen(row) && compareDates(row.visit.expectedAt, on) < 0));

export const expectedOn = (row, on = todayIso()) => iso(row.visit.expectedAt) === iso(on);

/**
 * search(q, filters, { upcomingOnly }) — the worklist's one query, soonest
 * arrival first. `upcomingOnly` is the Today + upcoming scope: everything
 * expected from today on, plus anything still open that was expected earlier
 * and never arrived, which is the follow-up work the desk owes.
 */
export function search(q = '', {
  status = '', department = '', type = '', precheck = '', from = '', to = '',
} = {}, { upcomingOnly = true } = {}) {
  const needle = String(q).trim().toLowerCase();
  const on = todayIso();
  return all()
    .filter((row) => {
      if (upcomingOnly && compareDates(row.visit.expectedAt, on) < 0 && !isOpen(row)) return false;
      if (status && row.status !== status) return false;
      if (department && row.visit.department !== department) return false;
      if (type && row.visit.type !== type) return false;
      if (precheck && (row.precheck?.status || 'Pending') !== precheck) return false;
      const day = iso(row.visit.expectedAt);
      if (from && compareDates(day, from) < 0) return false;
      if (to && compareDates(day, to) > 0) return false;
      if (!needle) return true;
      return [row.no, patientName(row), row.patientMrn, phoneOf(row), ...identifiersOf(row)]
        .some((v) => String(v || '').toLowerCase().includes(needle));
    })
    .sort((a, b) => String(a.visit.expectedAt).localeCompare(String(b.visit.expectedAt)));
}

/**
 * The rail's figures, read off whatever list the worklist is showing — each one
 * is the row count of the slice its card selects, so the two can never disagree.
 * `open` is the nav badge: what the desk still owes on today's arrivals.
 */
export function counts(rows = all()) {
  const on = todayIso();
  return {
    today: rows.filter((row) => expectedOn(row, on)).length,
    ready: rows.filter((row) => row.status === 'Ready').length,
    pending: rows.filter((row) => row.status === 'Pending').length,
    failed: rows.filter((row) => row.precheck?.status === 'Failed').length,
    converted: rows.filter((row) => row.status === 'Converted').length,
    open: rows.filter(isOpen).length,
  };
}

/** Next number in this year's sequence, read off the register itself. */
export function nextNo(year = new Date().getFullYear()) {
  const prefix = `PRE-${year}-`;
  const max = all().reduce((n, row) => {
    if (!String(row.no).startsWith(prefix)) return n;
    const digits = Number(String(row.no).slice(prefix.length));
    return Number.isFinite(digits) && digits > n ? digits : n;
  }, 0);
  return prefix + String(max + 1).padStart(6, '0');
}

// --- writes -------------------------------------------------------------------

export function create(data = {}) {
  const now = new Date().toISOString();
  const row = {
    no: nextNo(),
    patientMrn: null,
    newPatient: null,
    visit: { type: 'OP', expectedAt: '', department: '', doctorId: null, procedureItemId: null, admissionIntent: false },
    insurance: { mode: null, policyId: null, pendingPolicy: null },
    precheck: { status: 'Pending', snapshotRef: null, at: null },
    status: 'Pending',
    cancelReason: '',
    convertedTo: null,
    ...data,
    createdAt: now,
    updatedAt: now,
  };
  row.status = readiness(row);
  all().push(row);
  store.commit('prereg.create');
  const c = completeness(row);
  log(row, 'Created', `${typeLabel(row.visit.type)} for ${patientName(row)} — ${row.status}, ${c.pct}% complete`);
  return row;
}

/**
 * Replace what the form holds. Status is never in the patch: completeness is
 * what says whether a row is Ready, so every save recomputes it and the flip
 * either way is recorded — the desk reads the trail to see when a row became
 * convertible.
 */
export function update(no, patch = {}, { action = 'Updated', details = '' } = {}) {
  const row = get(no);
  if (!row || !isOpen(row)) return null;

  const was = row.status;
  const wasMrn = row.patientMrn;
  const before = completeness(row).pct;
  const { status, no: ignored, ...rest } = patch;
  Object.assign(row, rest, { updatedAt: new Date().toISOString() });
  row.status = readiness(row);
  // Gaining a record is what resolves a pre-check that ran before there was
  // one, and the moment matters: registration reads latestValid() to decide
  // whether to reuse a check or run another, and that decision is taken before
  // the encounter exists. Resolving it here rather than at conversion is what
  // lets the check the desk already paid for be the one the encounter carries.
  if (!wasMrn && row.patientMrn && row.precheck?.snapshotRef) {
    eligibility.attachPatient(row.precheck.snapshotRef, row.patientMrn, row.insurance?.policyId);
  }
  store.commit('prereg.update');

  const after = completeness(row);
  const moved = before === after.pct ? '' : ` — ${before}% → ${after.pct}% complete`;
  log(row, action, `${details || 'Saved'}${moved}`);
  if (row.status !== was) {
    log(row, row.status === 'Ready' ? 'Ready' : 'Reopened', row.status === 'Ready'
      ? 'Everything conversion needs is captured'
      : `Back to Pending — ${after.missing.join('; ')}`);
  }
  return row;
}

/** The pre-check result, written where the worklist and the form both read it. */
export function setPrecheck(no, { status, snapshotRef = null, at = null, result = '' } = {}) {
  const row = get(no);
  if (!row || !isOpen(row)) return null;
  const was = row.status;
  row.precheck = { status, snapshotRef, at: at || new Date().toISOString() };
  row.updatedAt = new Date().toISOString();
  row.status = readiness(row);
  store.commit('prereg.precheck');
  log(row, 'Pre-check', `${status}${result ? ` — ${result}` : ''}${snapshotRef ? ` (${snapshotRef})` : ''}`);
  if (row.status !== was && row.status === 'Ready') log(row, 'Ready', 'Everything conversion needs is captured');
  return row;
}

export function cancel(no, reason = '') {
  const row = get(no);
  if (!row || !isOpen(row)) return null;
  row.status = 'Cancelled';
  row.cancelReason = reason;
  row.updatedAt = new Date().toISOString();
  store.commit('prereg.cancel');
  log(row, 'Cancelled', reason || 'No reason recorded');
  return row;
}

/**
 * An expired row is not a mistake, it is a visit that slipped: reactivating it
 * asks for the new arrival time rather than restoring the old one, which had
 * already passed.
 */
export function reactivate(no, newExpectedAt) {
  const row = get(no);
  if (!row || row.status !== 'Expired' || !newExpectedAt) return null;
  const was = row.visit.expectedAt;
  row.visit = { ...row.visit, expectedAt: newExpectedAt };
  row.updatedAt = new Date().toISOString();
  row.status = readiness(row);
  store.commit('prereg.reactivate');
  log(row, 'Reactivated', `Expected arrival ${stamp(was)} → ${stamp(newExpectedAt)} — ${row.status}`);
  return row;
}

/** The one door conversion writes back through, once both records exist. */
export function markConverted(no, mrn, encounterNo) {
  const row = get(no);
  if (!row || !isOpen(row) || !mrn || !encounterNo) return null;
  row.patientMrn = mrn;
  row.status = 'Converted';
  row.convertedTo = { mrn, encounterNo, at: new Date().toISOString() };
  row.updatedAt = row.convertedTo.at;
  // The pre-check may have run before this patient had a record to run it
  // against, in which case its snapshot is still holding the pre-registration
  // number in place of an MRN. Registering them is what resolves it, and until
  // it is resolved the check cannot be reused at registration, cannot appear on
  // the record's Eligibility tab, and reads "Not registered" for good.
  if (row.precheck?.snapshotRef) {
    eligibility.attachPatient(row.precheck.snapshotRef, mrn, row.insurance?.policyId);
  }
  store.commit('prereg.converted');
  log(row, 'Converted', `${mrn} · encounter ${encounterNo}`);
  return row;
}

/**
 * Open rows whose arrival came and went, retired on load. The window is
 * CONFIG.preregExpiryHours after the expected time, not after the day.
 */
export function expirePreregs(now = Date.now()) {
  const cutoff = now - CONFIG.preregExpiryHours * 3600000;
  let closed = 0;
  for (const row of all()) {
    if (!isOpen(row)) continue;
    const at = Date.parse(row.visit.expectedAt);
    if (!Number.isFinite(at) || at > cutoff) continue;
    row.status = 'Expired';
    row.updatedAt = new Date(now).toISOString();
    log(row, 'Expired',
      `Expected ${stamp(row.visit.expectedAt)} and not converted within ${CONFIG.preregExpiryHours} hours`);
    closed += 1;
  }
  if (closed) store.commit('prereg.expire');
  return closed;
}

// --- merge --------------------------------------------------------------------

/**
 * A pre-registration follows the patient when two records are folded together,
 * exactly as the policies do — the visit it is holding is still expected, and
 * it is expected of whichever record survived.
 */
patients.relinkHooks.push({
  label: 'Pre-registrations',
  count: (mrn) => all().filter((row) => row.patientMrn === mrn).length,
  relink: (fromMrn, toMrn) => {
    const moving = all().filter((row) => row.patientMrn === fromMrn);
    const now = new Date().toISOString();
    for (const row of moving) {
      row.patientMrn = toMrn;
      row.updatedAt = now;
      log(row, 'Re-linked', `Moved from ${fromMrn} to ${toMrn} on merge`);
    }
    return moving.length;
  },
});

// --- internals ----------------------------------------------------------------

/** An instant as the trail reads it: minutes, no seconds, no timezone letter. */
const stamp = (at) => String(at).slice(0, 16).replace('T', ' ');

/** Ready is a fact about completeness, never a field a caller sets. */
const readiness = (row) => (computeCompleteness(row).ready ? 'Ready' : 'Pending');

function log(row, action, details) {
  audit.log({ entity: ENTITY, entityId: row.no, action, details });
}

expirePreregs();
