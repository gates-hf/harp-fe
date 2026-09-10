// Seed — pre-registrations. Owner: modules/frontis.
//
// Eight hand-written rows, because the worklist has to open on exactly them:
// four expected today (the happy path, an incomplete new patient, a refused
// pre-check and a self-payer), two upcoming (one an admission with a procedure
// package), one nobody converted in time and one already converted.
//
// The pre-check snapshots are produced the way data/seed/eligibility.js
// produces its own — the engine runs, and what it answers is stored. A snapshot
// written out by hand would be a record of something that never ran, and would
// drift from the contracts the moment either changed.
//
// Times are offsets from now, so "in two hours" is always ahead of the clock
// and the row expected three days ago is always the one the sweep expires.
//
// data/store.js does not import this file: a pre-registration reads the
// register, the policy chains, the charge master and the encounter board to
// exist. data/repositories/prereg.js builds on first read of an empty table —
// the shape data/seed/encounters.js already uses.

import * as patients from '../repositories/patients.js';
import * as policies from '../repositories/policies.js';
import * as cdm from '../repositories/cdm.js';
import * as encounters from '../repositories/encounters.js';
import { computeCompleteness } from '../engines/prereg-completeness.js';
import { verify, SELF_PAY } from '../engines/eligibility-engine.js';
import { ROLES } from '../../shared/roles.js';
import { todayIso } from '../../shared/format.js';

const NURSE = ROLES.find((r) => r.id === 'nurse').name;
const CODER = ROLES.find((r) => r.id === 'coder').name;

/** The first number this register hands out. Sequential from there. */
const FIRST = 41;

/** Visit type as the eligibility engine says it. Mirrors the repository's map. */
const VISIT_TYPE_OF = { OP: 'Outpatient', IP: 'Inpatient', ER: 'Emergency', 'Day Case': 'Day Case' };

/**
 * The two covers a new patient can arrive with. A pending policy is the policy
 * form's own record, held on the pre-registration until there is an MRN to
 * write it against — which is why it carries no id and no patient.
 */
const AXA_PENDING = {
  payerId: 'PY-0008', planId: 'PL-0019', memberId: 'AXA-LB-0552317', policyNo: 'AXA-2026-13380',
  relationship: 'Self', holderName: null, validFrom: '2026-02-01', validTo: '2027-01-31',
  cardFront: { fileName: 'axa-card-front.jpg', size: 184320 }, cardBack: null,
};
const BANKERS_PENDING = {
  payerId: 'PY-0007', planId: 'PL-0015', memberId: 'BNK-A-90427', policyNo: 'BA-CORP-2026-771',
  relationship: 'Self', holderName: null, validFrom: '2026-01-01', validTo: '2026-12-31',
  cardFront: null, cardBack: null,
};

/**
 * One row each. `mrn` is a matched record and `newPatient` the minimal details
 * the desk took over the phone — never both. `precheck: 'run'` verifies the
 * cover named in `insurance`, so the seed never checks one cover and stores
 * another.
 */
const ROWS = [
  // The demo's happy path: everything captured, the payer answered, Ready.
  { key: 'nour', hours: 2, mrn: 'MRN-000103', by: NURSE,
    visit: { type: 'OP', department: 'Internal Medicine', doctorId: 'DR-0002' },
    insurance: { mode: 'policy', policyId: 'POL-0001' }, precheck: 'run' },

  // Taken over the phone: no Arabic name and no identifier yet, so the rail
  // shows 9 of 11 and the row stays Pending however good the pre-check is.
  { key: 'jad', hours: 4, by: NURSE,
    newPatient: {
      nameEn: 'Jad Moukarzel', nameAr: '', dob: '1994-09-22', gender: 'Male',
      phone: '+961 3 447 219', nationality: 'Lebanese', civilId: null, passportNo: null,
    },
    visit: { type: 'OP', department: 'Cardiology', doctorId: 'DR-0004' },
    insurance: { mode: 'policy', pendingPolicy: AXA_PENDING }, precheck: 'run' },

  // The ISF dependants plan no Pactum contract names: the pre-check refuses at
  // the contract step, which is what the Failed badge on the worklist links to.
  { key: 'carla', hours: 6, mrn: 'MRN-000108', by: NURSE,
    visit: { type: 'Day Case', department: 'Obstetrics & Gynaecology', doctorId: 'DR-0012',
      procedureCode: 'SUR-0001' },
    insurance: { mode: 'policy', policyId: 'POL-0008' }, precheck: 'run' },

  // Cover ran out last quarter and the patient is paying: a Self-Pay pre-check
  // is recorded without verification, and the row is Ready on that decision.
  { key: 'ahmad', hours: 8, mrn: 'MRN-000110', by: CODER,
    visit: { type: 'OP', department: 'Orthopaedics', doctorId: 'DR-0008' },
    insurance: { mode: 'selfpay' }, precheck: 'run' },

  // Upcoming: the admission the conversion demo walks through, priced against
  // the appendectomy package the theatre booked.
  { key: 'rami', hours: 34, mrn: 'MRN-000101', by: NURSE,
    visit: { type: 'IP', department: 'General Surgery', doctorId: 'DR-0006',
      procedureCode: 'PKG-APP-001', admissionIntent: true },
    insurance: { mode: 'policy', policyId: 'POL-0004' }, precheck: 'run' },

  // Upcoming with the pre-check still to run — the follow-up the worklist's
  // Pending card counts.
  { key: 'ziad', hours: 96, mrn: 'MRN-000111', by: NURSE,
    visit: { type: 'OP', department: 'Cardiology', doctorId: 'DR-0004' },
    insurance: { mode: 'policy', policyId: 'POL-0012' }, precheck: 'Pending' },

  // Expected three days ago and never converted. Seeded open: expirePreregs()
  // is what closes it on load, so the trail says when it lapsed and why.
  { key: 'rita', hours: -72, by: NURSE,
    newPatient: {
      nameEn: 'Rita Aoun', nameAr: 'ريتا عون', dob: '1969-03-05', gender: 'Female',
      phone: '+961 70 338 512', nationality: 'Lebanese', civilId: '69030501', passportNo: null,
    },
    visit: { type: 'OP', department: 'Oncology', doctorId: 'DR-0016' },
    insurance: { mode: 'policy', pendingPolicy: BANKERS_PENDING }, precheck: 'run' },

  // Already converted, into a visit that is on today's board.
  { key: 'converted', hours: -2, mrn: 'MRN-000111', by: NURSE, converted: true,
    visit: { type: 'OP', department: 'Cardiology', doctorId: 'DR-0004' },
    insurance: { mode: 'policy', policyId: 'POL-0012' }, precheck: 'run' },
];

const fromNow = (hours) => new Date(Date.now() + hours * 3600000).toISOString();

/** How long before the expected arrival the desk took the call. */
const hoursBefore = (spec) => (spec.hours > 24 ? 48 : 20);

/**
 * The seeded register's own trail, written with the times the events happened
 * at. audit.log() would stamp every one of them with now and with whoever is
 * signed in, which is not what a history is — the same call the encounter seed
 * makes. Expiry is not written here: the sweep runs on load and records its own.
 */
export function buildPreregTrail(rows) {
  const out = [];
  for (const row of rows) {
    const by = row.createdBy;
    const c = computeCompleteness(row);
    // At the moment it was created the pre-check had not run, so the figure the
    // Created entry carries is the one without it.
    const atCreation = computeCompleteness({ ...row, precheck: { status: 'Pending' } });
    out.push(entry(row, 'Created', by, row.createdAt,
      `${VISIT_TYPE_OF[row.visit.type]} for ${nameOf(row)} — ${atCreation.pct}% complete`));
    if (row.precheck.snapshotRef) {
      out.push(entry(row, 'Pre-check', by, row.precheck.at,
        `${row.precheck.status} (${row.precheck.snapshotRef})`));
    }
    if (c.ready) out.push(entry(row, 'Ready', by, row.updatedAt, 'Everything conversion needs is captured'));
    if (row.convertedTo) {
      out.push(entry(row, 'Converted', by, row.convertedTo.at,
        `${row.convertedTo.mrn} · encounter ${row.convertedTo.encounterNo}`));
    }
  }
  return out;
}

const entry = (row, action, user, at, details) =>
  ({ entity: 'prereg', entityId: row.no, action, user, at, details });

const nameOf = (row) =>
  (row.patientMrn ? patients.get(row.patientMrn)?.nameEn : row.newPatient?.nameEn) || row.no;

/**
 * buildPrereg(baseRef) -> { rows, snapshots }
 *
 * `baseRef` is the next free eligibility reference; the pre-checks take it and
 * the ones after it, so the two trails share one sequence. The repository is
 * what pushes the snapshots onto the eligibility table, the way the encounter
 * repository pushes its own seeded trail onto the audit table.
 */
export function buildPrereg(baseRef = 'ELG-0000-000001') {
  const year = new Date().getFullYear();
  const rows = [];
  const snapshots = [];

  ROWS.forEach((spec, i) => {
    if (spec.mrn && !patients.get(spec.mrn)) return;

    const procedure = spec.visit.procedureCode ? cdm.getByCode(spec.visit.procedureCode) : null;
    const createdAt = fromNow(spec.hours - hoursBefore(spec));
    const row = {
      no: `PRE-${year}-${String(FIRST + i).padStart(6, '0')}`,
      patientMrn: spec.mrn || null,
      newPatient: spec.newPatient ? { ...spec.newPatient } : null,
      visit: {
        type: spec.visit.type,
        expectedAt: fromNow(spec.hours),
        department: spec.visit.department,
        doctorId: spec.visit.doctorId || null,
        procedureItemId: procedure?.id || null,
        admissionIntent: Boolean(spec.visit.admissionIntent) || spec.visit.type === 'IP',
      },
      insurance: {
        mode: spec.insurance.mode,
        policyId: spec.insurance.policyId || null,
        pendingPolicy: spec.insurance.pendingPolicy ? { ...spec.insurance.pendingPolicy } : null,
      },
      precheck: { status: 'Pending', snapshotRef: null, at: null },
      status: 'Pending',
      cancelReason: '',
      convertedTo: null,
      createdBy: spec.by,
      createdAt,
      updatedAt: createdAt,
    };

    if (spec.precheck === 'run') {
      const snapshot = precheckOf(row, spec, snapshots.length, baseRef);
      if (snapshot) {
        snapshots.push(snapshot);
        row.precheck = {
          status: snapshot.systemResult === 'Not Eligible' ? 'Failed' : 'Done',
          snapshotRef: snapshot.ref,
          at: snapshot.checkedAt,
        };
      }
    }

    // The status a row carries is the status its own completeness earns, so the
    // seed cannot drift from the rule create() and update() apply.
    row.status = computeCompleteness(row).ready ? 'Ready' : 'Pending';
    if (spec.converted) convert(row, spec.mrn);
    rows.push(row);
  });

  return { rows, snapshots };
}

/** One pre-check, run through the engine and stored exactly as it answered. */
function precheckOf(row, spec, seq, baseRef) {
  const patient = row.patientMrn
    ? patients.get(row.patientMrn)
    // A pre-registration with no record yet stands in for one: the pre-check is
    // about the cover, and refusing it at step 1 for a patient nobody has
    // registered would answer a question nobody asked.
    : { mrn: row.no, status: 'Active', nameEn: row.newPatient?.nameEn || row.no };

  const policy = row.insurance.mode === 'selfpay'
    ? SELF_PAY
    : row.insurance.policyId
      ? policies.get(row.insurance.policyId)
      : { ...row.insurance.pendingPolicy, status: 'Active' };
  if (!policy) return null;

  const checkedAt = row.createdAt;
  const services = row.visit.procedureItemId ? [{ itemId: row.visit.procedureItemId, qty: 1 }] : [];
  const visitType = VISIT_TYPE_OF[row.visit.type] || null;
  const answer = verify({ patient, policy, date: checkedAt.slice(0, 10), visitType, services }, { authorizations: false });

  return {
    ref: bump(baseRef, seq),
    patientMrn: row.patientMrn || null,
    preregNo: row.no,
    policyId: row.insurance.policyId || null,
    payerId: policy === SELF_PAY ? null : policy.payerId,
    planId: policy === SELF_PAY ? null : policy.planId,
    checkType: 'Pre-Registration',
    visitType,
    services,
    checkedAt,
    checkedBy: spec.by,
    systemResult: answer.result,
    steps: answer.steps,
    conditions: answer.conditions,
    failureReasons: answer.failureReasons,
    coverageSummary: answer.coverageSummary,
    contract: answer.contract,
    override: null,
    finalResult: answer.result,
    encounterId: null,
    attemptOf: null,
  };
}

/** The visit the converted row became, read off the board rather than assumed. */
function convert(row, mrn) {
  const seen = encounters.byPatient(mrn);
  const enc = seen.find((e) => e.type === row.visit.type && e.department === row.visit.department
    && String(e.startAt).slice(0, 10) === todayIso()) || seen[0];
  if (!enc) return;
  row.status = 'Converted';
  row.visit.expectedAt = enc.startAt;
  row.convertedTo = { mrn, encounterNo: enc.no, at: enc.createdAt || enc.startAt };
  row.updatedAt = row.convertedTo.at;
}

/** The nth reference after a base — ELG-2026-000016 plus 2 is ELG-2026-000018. */
const bump = (ref, n) =>
  String(ref).replace(/(\d+)$/, (digits) => String(Number(digits) + n).padStart(digits.length, '0'));
