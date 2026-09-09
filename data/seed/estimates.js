// Seed — cost estimates. Owner: modules/frontis.
//
// Written as a table of intents — this subject, this cover, these services,
// issued this many days ago — and the pricing engine is what produces each
// frozen result. An issued estimate is a record of what the configuration
// answered at a moment, so writing those numbers out by hand would be writing a
// record of something that never ran: it would drift from the contracts the
// moment either changed.
//
// Dates are offsets from today, so the list always opens with live estimates,
// the "expiring within three days" card always has something under it, and the
// expiry sweep always has one row to retire, whatever day the demo runs.
//
// data/store.js does not import this file: it reads the register, the policy
// chains, the charge master, the contracts and the encounter board to exist.
// data/repositories/estimates.js builds on first read of an empty table — the
// shape data/seed/eligibility.js and data/seed/encounters.js already use.

import * as patients from '../repositories/patients.js';
import * as policies from '../repositories/policies.js';
import * as cdm from '../repositories/cdm.js';
import * as encounters from '../repositories/encounters.js';
import { priceEstimate } from '../engines/estimate-pricing.js';
import { CONFIG } from '../../shared/config.js';
import { ROLES } from '../../shared/roles.js';
import { todayIso } from '../../shared/format.js';

const NURSE = ROLES.find((r) => r.id === 'nurse').name;
const CODER = ROLES.find((r) => r.id === 'coder').name;

/** The first number this register hands out. Sequential from there. */
const FIRST = 24;

/** Passed as the cover when the patient is paying for themselves. */
const SELF = 'SELF';

const id = (code) => cdm.getByCode(code)?.id || code;

/**
 * [key, subject, cover, createdDaysAgo, issuedDaysAgo | null, visitType,
 *  department, [[charge code, qty, consumption?], …], createdBy, extras]
 *
 * `issuedDaysAgo` null leaves the row a Draft; a row issued longer ago than the
 * validity window is what the expiry sweep retires on load. `extras.supersededBy`
 * names a later key; `extras.convertPatient` names whose encounter it became.
 */
const ROWS = [
  // Ahmad Al-Sayed — his only cover ran out, so the desk quoted him self-pay.
  // Issued a month ago on a fortnight's validity: expireEstimates() retires it
  // on the first load, which shows the rule working rather than its result.
  ['ahmad-self', { kind: 'patient', mrn: 'MRN-000110' }, SELF, 30, 30, 'Emergency', 'Emergency',
    [['RAD-0002', 1], ['CON-0001', 1], ['PRC-0001', 2]], NURSE, {}],

  // Leila Frem's cataract, quoted twice: the first price is superseded by the
  // second over exactly the same services, which is what issuing does. The
  // survivor was issued twelve days ago, so it is the row two days off lapsing
  // that the Expiring card counts.
  ['leila-v1', { kind: 'patient', mrn: 'MRN-000105' }, 'POL-0009', 21, 20, 'Day Case', 'General Surgery',
    [['SUR-0002', 1], ['PRF-0001', 2]], CODER, { supersededBy: 'leila-v2' }],
  ['leila-v2', { kind: 'patient', mrn: 'MRN-000105' }, 'POL-0009', 13, 12, 'Day Case', 'General Surgery',
    [['SUR-0002', 1], ['PRF-0001', 3]], CODER, { supersedes: 'leila-v1' }],

  // Georges Khoury's admission — quoted, accepted, and converted into the
  // encounter that eligibility's Auto-Registration snapshot already points at.
  ['georges-moph', { kind: 'patient', mrn: 'MRN-000102' }, 'POL-0011', 8, 8, 'Inpatient', 'Internal Medicine',
    [['RNB-0001', 3], ['CON-0002', 1], ['LAB-0001', 2]], NURSE, { convertPatient: 'MRN-000102', convertedDaysAgo: 7 }],

  // Rami Haddad's appendectomy package, quoted with the overrun the desk
  // expects: three nights past the two it covers, and both allowances spent
  // over. This is the estimate whose limits block is worth reading.
  ['rami-package', { kind: 'patient', mrn: 'MRN-000101' }, 'POL-0004', 3, 3, 'Inpatient', 'General Surgery',
    [['PKG-APP-001', 1, [['RNB-0001', 'qty', 5], ['CNS-0002', 'amount', 210], ['PHA-0002', 'amount', 126]]]],
    NURSE, {}],

  // Nour Baalbaki's MRI — NSSF requires pre-authorisation on MRI brain outright,
  // so the document carries the flag the patient has to be told about, and the
  // report copy she asked for is the one line the plan names and refuses.
  ['nour-mri', { kind: 'patient', mrn: 'MRN-000103' }, 'POL-0001', 2, 2, 'Outpatient', 'Internal Medicine',
    [['RAD-0001', 1], ['CON-0002', 1], ['NCL-0001', 1]], NURSE, {}],

  // A walk-in who asked the price before registering: no record, no policy on
  // file, the cover read off the card at the counter.
  ['rita-prospect', { kind: 'prospect', name: 'Rita Sfeir', phone: '+961 3 552118' }, 'PL-0001', 1, 1,
    'Day Case', 'Obstetrics & Gynaecology', [['LAB-0002', 1], ['RAD-0002', 1], ['CON-0002', 1]], NURSE, {}],

  // Today's draft, still being priced at the desk.
  ['nour-draft', { kind: 'patient', mrn: 'MRN-000103' }, 'POL-0002', 0, null, 'Outpatient', 'Cardiology',
    [['RAD-0003', 1], ['LAB-0001', 1]], NURSE, {}],
];

/** Deterministic clock: the same offsets produce the same register every load. */
function stamp(daysAgo, hour, minute = 0) {
  const when = new Date(`${todayIso()}T00:00:00.000Z`);
  when.setUTCDate(when.getUTCDate() - daysAgo);
  when.setUTCHours(hour, minute, 0, 0);
  return when.toISOString();
}

const day = (daysAgo) => stamp(daysAgo, 0).slice(0, 10);

const addDays = (from, n) => {
  const when = new Date(`${from}T00:00:00.000Z`);
  when.setUTCDate(when.getUTCDate() + n);
  return when.toISOString().slice(0, 10);
};

/** The cover as the entity holds it: a policy on the chain, a plan, or none. */
function coverOf(cover) {
  if (cover === SELF) return { policyId: null, payerId: null, planId: null, selfPay: true };
  const policy = policies.get(cover);
  if (policy) return { policyId: policy.id, payerId: policy.payerId, planId: policy.planId, selfPay: false };
  // A prospect names a plan and no policy — the payer is looked up from it.
  const payer = policies.payerOfPlan(cover);
  return { policyId: null, payerId: payer?.id || null, planId: cover, selfPay: false };
}

export function buildEstimates() {
  const year = new Date().getFullYear();
  const numbers = new Map();
  const out = [];

  ROWS.forEach(([key], i) => numbers.set(key, `EST-${year}-${String(FIRST + i).padStart(6, '0')}`));

  ROWS.forEach(([key, subject, cover, createdDaysAgo, issuedDaysAgo, visitType, department, lines, by, extras], i) => {
    const createdAt = stamp(createdDaysAgo, 9, 10 + i);
    const row = {
      no: numbers.get(key),
      status: 'Draft',
      subject: { ...subject },
      policy: coverOf(cover),
      context: {
        visitType,
        department,
        // Quoted for the day it was asked about; a live estimate is priced on
        // today, so the demo's contracts are the ones that answered.
        dateOfService: issuedDaysAgo === null ? todayIso() : day(issuedDaysAgo),
      },
      lines: lines.map(([code, qty, consumption]) => ({
        itemId: id(code),
        qty,
        consumption: (consumption || []).map(([componentCode, unit, value]) => ({
          componentId: id(componentCode), [unit]: value,
        })),
      })),
      result: null,
      issuedAt: null,
      issuedBy: null,
      validUntil: null,
      supersededBy: null,
      supersedes: extras.supersedes ? numbers.get(extras.supersedes) : null,
      encounterNo: null,
      convertedAt: null,
      cancelReason: '',
      createdAt,
      createdBy: by,
      updatedAt: createdAt,
    };

    if (issuedDaysAgo !== null) {
      const patient = subject.kind === 'patient' ? patients.get(subject.mrn) : null;
      const issuedAt = stamp(issuedDaysAgo, 11, 5 + i);
      row.result = priceEstimate(row, { patient, disclaimer: CONFIG.estimateDisclaimer });
      row.result.computedAt = issuedAt;
      row.status = 'Issued';
      row.issuedAt = issuedAt;
      row.issuedBy = by;
      row.validUntil = addDays(day(issuedDaysAgo), CONFIG.estimateValidityDays);
      row.updatedAt = issuedAt;
    }

    if (extras.supersededBy) {
      row.status = 'Superseded';
      row.supersededBy = numbers.get(extras.supersededBy);
    }

    if (extras.convertPatient) {
      // The encounter is read back off the board rather than assumed: its
      // numbers are handed out by the register, not written here.
      const encounter = encounters.byPatient(extras.convertPatient)[0];
      if (encounter) {
        row.status = 'Converted';
        row.encounterNo = encounter.no;
        row.convertedAt = stamp(extras.convertedDaysAgo ?? issuedDaysAgo, 12, 30);
        row.updatedAt = row.convertedAt;
        // The estimate registers itself on the encounter the way the live
        // conversion does — this is the row the Linked Records tab lists.
        const ids = encounter.linked?.estimateIds || [];
        if (!ids.includes(row.no)) encounter.linked.estimateIds = [...ids, row.no];
      }
    }

    out.push(row);
  });

  return out;
}

/**
 * The seeded trail, with the times the events happened at. audit.log() would
 * stamp every one of them with now and with whoever is signed in, which is not
 * what a history is.
 */
export function buildEstimateTrail(rows) {
  const trail = [];
  const entry = (row, at, action, details) => trail.push({
    entity: 'estimate', entityId: row.no, action, details, user: row.createdBy, at,
  });

  for (const row of rows) {
    entry(row, row.createdAt, 'Created',
      `${row.subject.kind === 'prospect' ? row.subject.name : row.subject.mrn} — ${row.lines.length} service${
        row.lines.length === 1 ? '' : 's'}`);
    if (row.issuedAt) {
      const priced = row.result?.contract
        ? `${row.result.contract.no} v${row.result.contract.version}`
        : 'Self-Pay';
      entry(row, row.issuedAt, 'Issued',
        `${priced} — patient share ${(row.result?.totals.patientShare || 0).toFixed(2)}, valid to ${row.validUntil}`);
    }
    if (row.supersedes) entry(row, row.issuedAt, 'Supersedes', `Replaces ${row.supersedes}`);
    if (row.supersededBy) entry(row, row.updatedAt, 'Superseded', `Replaced by ${row.supersededBy} over the same services`);
    if (row.convertedAt) entry(row, row.convertedAt, 'Converted', `Encounter ${row.encounterNo}`);
  }
  return trail;
}
