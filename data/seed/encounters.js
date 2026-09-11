// Seed — encounters. Owner: modules/frontis.
//
// Ten of today's are hand-written because the board has to open on exactly
// them: four clinics, four beds (one in intensive care, one self-funded and
// unquoted), an emergency arrival and one visit booked for later this
// afternoon. The rest are generated over the last thirty days with a fixed-seed
// PRNG, so every tab loads the same register.
//
// Times are offsets from now, not stamps, so "this afternoon" is always ahead
// of the clock and the board always opens on today's work, whatever day the
// demo runs.
//
// data/store.js does not import this file: an encounter reads the register, the
// policy chains and the eligibility trail to exist.
// data/repositories/encounters.js builds on first read of an empty table — the
// shape data/seed/eligibility.js and data/seed/claims.js already use.

import * as patients from '../repositories/patients.js';
import * as policies from '../repositories/policies.js';
import * as eligibility from '../repositories/eligibility.js';
import { DOCTORS } from './reference.js';
import { ROLES } from '../../shared/roles.js';
import { todayIso } from '../../shared/format.js';

const NURSE = ROLES.find((r) => r.id === 'nurse').name;
const CODER = ROLES.find((r) => r.id === 'coder').name;

/** The first number this register hands out. Sequential from there, never reused. */
const FIRST = 401;

/**
 * data/seed/eligibility.js writes one Auto-Registration snapshot already
 * pointing at the encounter that consumed it, which is the eighteenth row here
 * — MRN-000102's admission a week ago. The two constants have to agree, so this
 * seed reads the snapshot's own number back rather than trusting the count.
 */
const LINKED_SNAPSHOT = { mrn: 'MRN-000102', policyId: 'POL-0011' };

/**
 * Today, hand-written. [mrn, type, department, doctorId, hoursFromNow, policyId,
 *  extras] — a negative offset opened that many hours ago, a positive one is
 * booked for later. `policyId` null is the self-pay decision.
 */
const TODAY = [
  // Yesterday's admission, still in intensive care: the reason the board's
  // Today scope is "today's work" and not "today's start times".
  ['MRN-000105', 'IP', 'Cardiology', 'DR-0005', -30, 'POL-0009',
    { ward: 'Intensive care unit', bedClass: 'ICU', expectedLos: 5,
      visitReason: 'Chest pain, troponin rise — coronary care' }],
  // Theatre has already billed against this one, which is what makes the
  // cancellation guard reachable: a front-desk role sees Cancel disabled here.
  // Admitted on the fund's own agreement, which asks for a referral on
  // everything but a consultation — and nobody has one. It is what the board's
  // clearance tooltip and the encounter's Referral row open on.
  ['MRN-000101', 'IP', 'General Surgery', 'DR-0006', -6, 'POL-0004',
    { ward: 'Ward 3B — Surgical', bedClass: 'Semi-Private', expectedLos: 3,
      visitReason: 'Laparoscopic cholecystectomy', chargesPosted: true,
      referralMissing: true }],
  ['MRN-000110', 'ER', 'Emergency', 'DR-0014', -5, null,
    { visitReason: 'Fall from scaffolding, right wrist deformity' }],
  ['MRN-000103', 'OP', 'Internal Medicine', 'DR-0002', -3.5, 'POL-0001', {}],
  // Seen in the clinic this morning and admitted from it — the same patient
  // twice in a day, which is what the duplicate warning is careful about.
  //
  // Its clearance is the one stamp this seed writes, and it is written as of
  // yesterday: nothing had been paid then, so the desk's answer was Blocked.
  // The deposit that arrived this morning is in data/seed/payments.js, so the
  // sweep on load moves it to Conditionally Cleared and the trail carries the
  // transition — which is the whole claim of a computed clearance, demonstrated
  // rather than asserted.
  ['MRN-000103', 'IP', 'General Surgery', 'DR-0007', -3, 'POL-0002',
    { ward: 'Ward 3B — Surgical', bedClass: 'Private', expectedLos: 2,
      visitReason: 'Appendicectomy, admitted from clinic',
      priorClearance: 'Blocked' }],
  ['MRN-000111', 'OP', 'Cardiology', 'DR-0004', -2, 'POL-0012', {}],
  ['MRN-000116', 'OP', 'Paediatrics', 'DR-0010', -1.5, null, {}],
  ['MRN-000108', 'OP', 'Obstetrics & Gynaecology', 'DR-0012', 3, 'POL-0008', {}],
  // Persistent cough on the fund's second-class plan: the CT the payer refused,
  // and the resubmission still sitting in drafts. It is the visit whose
  // clearance opens on a denied authorisation.
  ['MRN-000113', 'OP', 'Internal Medicine', 'DR-0001', -2.5, 'POL-0014',
    { visitReason: 'Persistent cough, eight weeks — for CT chest' }],
  // A self-funded admission nobody has quoted yet: no estimate to acknowledge
  // and no patient share to take a deposit against, which is two blocking items
  // out of one omission.
  ['MRN-000117', 'IP', 'General Surgery', 'DR-0007', -4, null,
    { ward: 'Ward 3B — Surgical', bedClass: 'General', expectedLos: 2,
      visitReason: 'Elective inguinal hernia repair, self-funded' }],
];

/** The patients with cover on file — what a generated visit draws from first. */
const INSURED = ['MRN-000101', 'MRN-000102', 'MRN-000103', 'MRN-000105', 'MRN-000108', 'MRN-000111'];

const REASONS = {
  IP: ['Elective admission', 'Pneumonia, oxygen dependent', 'Total knee replacement',
    'Observation after collapse', 'Cellulitis, intravenous antibiotics'],
  ER: ['Road traffic accident', 'Abdominal pain, vomiting', 'High fever in a child',
    'Chest pain', 'Laceration to the forearm'],
  OP: [''],
};

/** Fixed-seed PRNG — the same register in every tab. */
function mulberry32(seed) {
  return function random() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const at = (daysAgo, hour, minute = 0) => {
  const when = new Date(`${todayIso()}T00:00:00.000Z`);
  when.setUTCDate(when.getUTCDate() - daysAgo);
  when.setUTCHours(hour, minute, 0, 0);
  return when.toISOString();
};

const fromNow = (hours) => new Date(Date.now() + hours * 3600000).toISOString();

/**
 * The classification a seeded visit carries. A policy on the chain brings its
 * newest passing snapshot with it; a patient with no cover is the self-pay
 * decision, recorded as one.
 */
function classify(mrn, policyId, by, atIso) {
  const policy = policyId ? policies.get(policyId) : null;
  // The check is chosen by cover and then by answer: the newest snapshot on
  // that cover that the payer actually answered for, and only if there is none,
  // the newest of any answer. A refusal is an attempt, not a classification —
  // Ahmad Al-Sayed's cascade is the worked case, where the encounter carries
  // the Self-Pay decision that closed the chain and the refused Bankers check
  // above it stays unlinked, with `attemptOf` still joining the two.
  const onCover = eligibility
    .byPatient(mrn)
    .filter((row) => (row.policyId || null) === (policy ? policy.id : null));
  const snapshot = onCover.find(
    (row) => eligibility.isPass(row.finalResult) || row.finalResult === 'Self-Pay',
  ) || onCover[0] || null;
  return {
    financial: {
      policyId: policy ? policy.id : null,
      payerId: policy ? policy.payerId : null,
      planId: policy ? policy.planId : null,
      snapshotRef: snapshot ? snapshot.ref : null,
      classifiedAt: atIso,
      classifiedBy: by,
      reason: null,
      overrideRef: snapshot?.override ? snapshot.ref : null,
    },
    snapshot,
  };
}

/**
 * A visit's clearance is not seeded: data/repositories/clearance.js computes it
 * from the eligibility snapshot, the referral, the authorisations, the estimate
 * and the money taken, and stamps every open encounter on load. Writing a
 * status here would be writing down an answer nobody derived.
 *
 * The one exception is `priorClearance` — a stamp as it stood *before* today,
 * so the first sweep has something to move from and the move lands in the
 * trail. It carries no items on purpose: what the desk saw yesterday is a
 * status, and the reasons are recomputed.
 */
const clearanceStamp = (spec) =>
  (spec.priorClearance
    ? {
      status: spec.priorClearance,
      items: [],
      blocking: [],
      pendingSince: null,
      computedAt: at(1, 17),
    }
    : { status: 'Not started', items: [], blocking: [] });

function row(spec) {
  const { snapshot, financial } = classify(spec.patientMrn, spec.policyId, spec.by, spec.startAt);
  return {
    row: {
      no: spec.no,
      patientMrn: spec.patientMrn,
      type: spec.type,
      department: spec.department,
      doctorId: spec.doctorId,
      visitReason: spec.visitReason || '',
      ward: spec.ward || '',
      bedClass: spec.bedClass || '',
      expectedLos: spec.expectedLos ?? null,
      startAt: spec.startAt,
      endAt: spec.endAt || null,
      status: spec.status,
      cancelReason: spec.cancelReason || '',
      los: spec.los ?? null,
      financial,
      financialHistory: [],
      chargesPosted: Boolean(spec.chargesPosted),
      clearance: clearanceStamp(spec),
      // The payer asked for a referral on this visit and there was none: the
      // flag the referral feature clears, and the extra line the clearance
      // tooltip carries until it does.
      flags: { referralMissing: Boolean(spec.referralMissing) },
      linked: { referralId: null, preAuthIds: [], clearanceId: null, estimateIds: [], accountId: null },
      // A visit booked for later was created before it starts, not at it: the
      // trail reads in order, and Planned is a decision taken at the desk now.
      createdAt: spec.createdAt || spec.startAt,
      updatedAt: spec.endAt || spec.startAt,
    },
    snapshot,
  };
}

export function buildEncounters() {
  const year = new Date().getFullYear();
  const no = (i) => `ENC-${year}-${String(FIRST + i).padStart(6, '0')}`;
  const random = mulberry32(20260909);
  const specs = [];

  // --- the last thirty days, generated ---------------------------------------
  const pool = patients.all().filter((p) => p.status === 'Active').map((p) => p.mrn);
  const selfPay = pool.filter((mrn) => !INSURED.includes(mrn));

  for (let i = 0; i < 17; i += 1) {
    // Oldest first, so the numbers run with the calendar the way a register does.
    const daysAgo = 30 - i;
    const insured = random() < 0.55;
    const mrn = insured
      ? INSURED[Math.floor(random() * INSURED.length)]
      : selfPay[Math.floor(random() * selfPay.length)];
    const chain = policies.chain(mrn);
    const policyId = insured && chain.length ? chain[0].id : null;
    const roll = random();
    const type = roll < 0.6 ? 'OP' : roll < 0.85 ? 'IP' : 'ER';
    const doctor = DOCTORS[Math.floor(random() * DOCTORS.length)];
    const startAt = at(daysAgo, 8 + Math.floor(random() * 9), Math.floor(random() * 4) * 15);
    const stay = 1 + Math.floor(random() * 4);
    // One visit in the set was cancelled — the shape the board's Cancelled
    // filter and the encounter page's terminal state need.
    const cancelled = i === 4;

    specs.push({
      no: no(i),
      patientMrn: mrn,
      type,
      department: doctor.department,
      doctorId: doctor.id,
      policyId,
      visitReason: REASONS[type][Math.floor(random() * REASONS[type].length)],
      ward: type === 'IP' ? (random() < 0.25 ? 'Intensive care unit' : 'Ward 2A — Medical') : '',
      bedClass: type === 'IP' ? ['General', 'Semi-Private', 'Private'][Math.floor(random() * 3)] : '',
      expectedLos: type === 'IP' ? stay : null,
      startAt,
      status: cancelled ? 'Cancelled' : type === 'OP' ? 'Completed' : 'Discharged',
      cancelReason: cancelled ? 'Patient did not attend' : '',
      endAt: cancelled ? startAt : type === 'OP' ? at(daysAgo, 23) : at(daysAgo - stay, 11),
      los: cancelled || type === 'OP' ? null : stay,
      chargesPosted: !cancelled,
      by: random() < 0.5 ? NURSE : CODER,
    });
  }

  // --- the admission the seeded Auto-Registration check was run for ----------
  const linked = eligibility
    .byPatient(LINKED_SNAPSHOT.mrn)
    .find((r) => r.policyId === LINKED_SNAPSHOT.policyId && r.encounterId);
  specs.push({
    no: linked?.encounterId || no(specs.length),
    patientMrn: LINKED_SNAPSHOT.mrn,
    type: 'IP',
    department: 'Internal Medicine',
    doctorId: 'DR-0001',
    visitReason: 'Decompensated heart failure',
    ward: 'Ward 2A — Medical',
    bedClass: 'General',
    expectedLos: 3,
    startAt: at(7, 9, 30),
    endAt: at(4, 10, 0),
    status: 'Discharged',
    los: 3,
    clearance: 'Cleared',
    chargesPosted: true,
    policyId: LINKED_SNAPSHOT.policyId,
    by: NURSE,
  });

  // --- today, hand-written ---------------------------------------------------
  TODAY.forEach(([mrn, type, department, doctorId, hours, policyId, extras], i) => {
    const startAt = fromNow(hours);
    specs.push({
      no: no(18 + i),
      patientMrn: mrn,
      type,
      department,
      doctorId,
      policyId,
      startAt,
      createdAt: fromNow(hours < 0 ? hours : -0.5),
      status: hours > 0 ? 'Planned' : 'Active',
      by: NURSE,
      ...extras,
    });
  });

  // --- one visit from last year (amendment 44) -------------------------------
  // A completed clinic visit dated December 2025 with nothing posted against
  // it, so the coding workspace can be opened on a date of service the 2025
  // ICD-10-CM release covers — the era-correct lookup demonstrated on a real
  // chart rather than asserted. Self-pay and unbilled by design: no ledger
  // row, no account, no claim and no coding-pool entry hang off it, so nothing
  // another seed picks by rule can land on it. Numbered in its own year, which
  // nextNo() ignores. Reached from the patient's Encounters tab or by URL.
  specs.push({
    no: 'ENC-2025-000388',
    patientMrn: 'MRN-000150',
    type: 'OP',
    department: 'Internal Medicine',
    doctorId: 'DR-0001',
    policyId: null,
    visitReason: 'Cough and fever, ten days',
    startAt: '2025-12-16T09:15:00.000Z',
    endAt: '2025-12-16T23:00:00.000Z',
    status: 'Completed',
    chargesPosted: false,
    by: NURSE,
  });

  const out = [];
  for (const spec of specs) {
    const built = row(spec);
    out.push(built.row);
    // The trail's other half: a snapshot registration consumed names the
    // encounter it was consumed by, which is what the worklist's Linked
    // encounter column reads. A snapshot already pointing at one is left alone —
    // it belongs to that encounter.
    if (built.snapshot && !built.snapshot.encounterId && built.row.status !== 'Cancelled') {
      built.snapshot.encounterId = built.row.no;
    }
  }
  return out;
}

/**
 * The trail behind the seeded register. An encounter that was opened, closed
 * and discharged before the demo started still has a history, and the History
 * tab and the View history sheet are read on exactly those rows — so the events
 * are written out here with the times they happened at, rather than stamped
 * with now the moment a screen first reads the table.
 */
export function buildEncounterTrail(rows) {
  const out = [];
  for (const row of rows) {
    const by = row.financial.classifiedBy || NURSE;
    out.push({
      entity: 'encounters',
      entityId: row.no,
      action: 'Created',
      user: by,
      at: row.createdAt,
      details: `${TYPE_WORDS[row.type]} — ${row.department}, ${coverWords(row)}`,
    });
    if (row.status === 'Discharged') {
      out.push({
        entity: 'encounters',
        entityId: row.no,
        action: 'Discharged',
        user: by,
        at: row.endAt,
        details: `Discharged ${String(row.endAt).slice(0, 16).replace('T', ' ')} — ${row.los} day${row.los === 1 ? '' : 's'}`,
      });
    }
    if (row.status === 'Completed') {
      out.push({
        entity: 'encounters',
        entityId: row.no,
        action: 'Completed',
        user: 'System',
        at: row.endAt,
        details: 'Outpatient visit closed automatically at 23:00',
      });
    }
    if (row.status === 'Cancelled') {
      out.push({
        entity: 'encounters',
        entityId: row.no,
        action: 'Cancelled',
        user: CODER,
        at: row.endAt,
        details: row.cancelReason,
      });
    }
  }
  return out;
}

const TYPE_WORDS = { OP: 'Outpatient', IP: 'Inpatient', ER: 'Emergency' };

const coverWords = (row) => {
  const policy = row.financial.policyId ? policies.get(row.financial.policyId) : null;
  return policy ? policies.label(policy) : 'Self-Pay';
};
