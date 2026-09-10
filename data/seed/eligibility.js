// Seed — eligibility snapshots. Owner: modules/frontis.
//
// The outcomes are hand-written as a table of intents — this patient, on this
// policy, this many days ago, with these anticipated services — and the engine
// is what produces each snapshot's steps, conditions and coverage summary. A
// snapshot is a record of what the platform answered, so writing those answers
// out by hand would be writing a record of something that never ran: the seeded
// trail would drift from the contracts the moment either changed.
//
// Reference numbers and timestamps are generated. Dates are offsets from today,
// so the worklist always opens with checks made today and the 7-day reuse
// window F4 reads is always demonstrable, whatever day the demo runs.
//
// data/store.js does not import this file: it reads the contracts, the charge
// master and the register to exist. data/repositories/eligibility.js builds on
// first read of an empty table, which is also how a reset rebuilds it — the
// same shape data/seed/claims.js already uses.

import * as patients from '../repositories/patients.js';
import * as policies from '../repositories/policies.js';
import * as cdm from '../repositories/cdm.js';
import { verify, SELF_PAY } from '../engines/eligibility-engine.js';
import { ROLES } from '../../shared/roles.js';
import { todayIso } from '../../shared/format.js';

/** Who ran each check. Registration is a front-desk job, so the nurse leads. */
const NURSE = ROLES.find((r) => r.id === 'nurse').name;
const CODER = ROLES.find((r) => r.id === 'coder').name;
const PHYSICIAN = ROLES.find((r) => r.id === 'physician').name;

/**
 * [key, mrn, policyId | SELF_PAY, daysAgo, checkType, visitType, [charge codes],
 *  checkedBy, extras]
 *
 * `extras.cascadeOf` names an earlier key: the snapshot is the next policy tried
 * after that one failed, and carries its reference as `attemptOf`.
 */
const ROWS = [
  // Nour Baalbaki, the three-policy chain. The NSSF check today names an MRI,
  // which the contract's pre-auth ladder always requires — the worked
  // "Eligible with Conditions".
  ['nour-nssf', 'MRN-000103', 'POL-0001', 0, 'Manual', 'Outpatient', ['RAD-0001', 'CON-0002'], NURSE, {}],
  ['nour-axa', 'MRN-000103', 'POL-0002', 1, 'Re-check', 'Outpatient', ['LAB-0001'], NURSE, {}],
  ['nour-bank', 'MRN-000103', 'POL-0003', 5, 'Manual', null, [], CODER, {}],

  // Rami Haddad's cascade: the suspended AXA policy is tried first and fails on
  // validity, so the clerk runs the NSSF cover underneath it and lands.
  ['rami-axa', 'MRN-000101', 'POL-0005', 4, 'Manual', 'Inpatient', ['RNB-0001', 'PRF-0001'], NURSE, {}],
  ['rami-nssf', 'MRN-000101', 'POL-0004', 4, 'Manual', 'Inpatient', ['RNB-0001', 'PRF-0001'], NURSE, { cascadeOf: 'rami-axa' }],
  ['rami-medgulf', 'MRN-000101', 'POL-0006', 10, 'Manual', 'Outpatient', [], CODER, {}],

  // Ahmad Al-Sayed: the only cover on file ran out, so the chain is exhausted
  // and the second attempt records the self-pay decision.
  ['ahmad-bank', 'MRN-000110', 'POL-0007', 6, 'Manual', 'Emergency', ['RAD-0002'], NURSE, {}],
  ['ahmad-self', 'MRN-000110', SELF_PAY, 6, 'Manual', 'Emergency', ['RAD-0002'], NURSE, { cascadeOf: 'ahmad-bank' }],

  // Carla Gemayel: ISF dependants cover on a plan no Pactum contract names.
  // The check refuses, and the payer confirmed the cover by phone — the
  // override the snapshot page shows beside the system answer.
  ['carla-isf', 'MRN-000108', 'POL-0008', 3, 'Manual', 'Day Case', ['SUR-0001'], NURSE, {
    override: {
      result: 'Eligible',
      reason: 'Payer phone confirmation',
      payerRef: '4471',
      contact: 'Rania Chidiac, ISF claims desk',
      note: 'Cover confirmed verbally; the contract renewal is with legal.',
      by: CODER,
    },
  }],

  // The blocked record. Its cover is live, but the check refuses at step 1 —
  // the worked example of a failure that has nothing to do with the payer.
  ['sami-blocked', 'MRN-000107', 'POL-0010', 2, 'Manual', 'Outpatient', ['RAD-0003'], NURSE, {}],
  ['sami-self', 'MRN-000107', SELF_PAY, 9, 'Manual', 'Outpatient', [], CODER, {}],

  // Registration ran this one inline — the Auto-Registration shape F4 creates,
  // linked to the encounter that consumed it.
  ['georges-moph', 'MRN-000102', 'POL-0011', 7, 'Auto-Registration', 'Inpatient', ['RNB-0001'], NURSE, {
    encounterId: 'ENC-2026-000418',
  }],

  // The rest of the single-policy records, the VIP among them.
  ['leila-bupa', 'MRN-000105', 'POL-0009', 0, 'Manual', 'Day Case', ['SUR-0002', 'PRF-0001'], PHYSICIAN, {}],
  ['hiba-sna', 'MRN-000111', 'POL-0012', 8, 'Manual', 'Outpatient', ['LAB-0002', 'CON-0001'], NURSE, {}],
  ['nour-nssf-2', 'MRN-000103', 'POL-0001', 0, 'Re-check', 'Day Case', ['RAD-0003'], CODER, {}],
];

/** Deterministic clock: the same offsets produce the same trail on every load. */
function stamp(daysAgo, seq) {
  const at = new Date(`${todayIso()}T00:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() - daysAgo);
  at.setUTCHours(8 + (seq % 9), (seq * 13) % 60, 0, 0);
  return at.toISOString();
}

export function buildEligibility() {
  const year = new Date().getFullYear();
  const refs = new Map();
  const out = [];

  ROWS.forEach(([key, mrn, policyId, daysAgo, checkType, visitType, codes, checkedBy, extras], i) => {
    const patient = patients.get(mrn);
    const policy = policyId === SELF_PAY ? SELF_PAY : policies.get(policyId);
    if (!patient || !policy) return;

    const checkedAt = stamp(daysAgo, i);
    const on = checkedAt.slice(0, 10);
    const services = codes
      .map((code) => cdm.getByCode(code))
      .filter(Boolean)
      .map((item) => ({ itemId: item.id, qty: item.uom === 'Night' ? 2 : 1 }));

    // No authorisation lookup while seeding: the pre-auth register's seed reads
    // back through the estimates and the encounters to this table.
    const answer = verify({ patient, policy, date: on, visitType, services }, { authorizations: false });
    const ref = `ELG-${year}-${String(i + 1).padStart(6, '0')}`;
    refs.set(key, ref);

    const override = extras.override
      ? { ...extras.override, at: stamp(daysAgo, i + 100) }
      : null;

    out.push({
      ref,
      patientMrn: mrn,
      policyId: policyId === SELF_PAY ? null : policyId,
      payerId: policyId === SELF_PAY ? null : policy.payerId,
      planId: policyId === SELF_PAY ? null : policy.planId,
      checkType,
      visitType,
      services,
      checkedAt,
      checkedBy,
      systemResult: answer.result,
      steps: answer.steps,
      conditions: answer.conditions,
      failureReasons: answer.failureReasons,
      coverageSummary: answer.coverageSummary,
      contract: answer.contract,
      override,
      finalResult: override?.result || answer.result,
      encounterId: extras.encounterId || null,
      attemptOf: extras.cascadeOf ? refs.get(extras.cascadeOf) || null : null,
    });
  });

  return out;
}
