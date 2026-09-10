// Seed — clearance-side payments. Owner: modules/frontis.
//
// Two deposits, and both are computed rather than written down: the amount is
// the share of the patient share the config asks for, read off the estimate the
// clearance engine would read, so a contract change moves the seeded receipt
// the same way it moves the checklist. A hand-written figure would be a record
// of a payment nobody could have been asked for.
//
// One of the two is deliberately short. Rami Haddad's admission was paid in
// full before theatre; Nour Baalbaki's was half-paid at the desk this morning,
// which — with the stamp data/seed/encounters.js writes as of yesterday — is
// what moves that visit from Blocked to Conditionally Cleared on load, with the
// transition in the trail.
//
// data/store.js does not import this file, and neither does the payments
// repository any more: these two rows are migrated into the ledger by
// data/seed/ledger.js, which is where the money now lives. What is written here
// is still the clearance desk's own record of what it took — the amount, the
// method, the receipt and who took it — and the ledger seed turns each into the
// transaction its visit's payment mode calls for. The trail is written there
// too, on the account, because that is the entity the money belongs to.

import * as encounters from '../repositories/encounters.js';
import * as estimates from '../repositories/estimates.js';
import { CONFIG } from '../../shared/config.js';
import { ROLES } from '../../shared/roles.js';

const NURSE = ROLES.find((r) => r.id === 'nurse').name;
const CODER = ROLES.find((r) => r.id === 'coder').name;

/** The first receipt this desk hands out. Sequential from there. */
const FIRST = 501;

/**
 * One row each. `share` is how much of the required deposit was actually taken
 * — 1 is paid in full, 0.5 is half at the desk. `visit` finds the encounter on
 * the board rather than naming a number.
 */
const ROWS = [
  { visit: { mrn: 'MRN-000101', type: 'IP', department: 'General Surgery' },
    share: 1, hours: -5.25, method: 'Card', reference: 'AUTH 448-2201', by: CODER,
    note: 'Taken at the admissions desk before theatre.' },

  { visit: { mrn: 'MRN-000103', type: 'IP', department: 'General Surgery' },
    share: 0.5, hours: -1.5, method: 'Cash', reference: '', by: NURSE,
    note: 'Part payment; the family will bring the balance this afternoon.' },
];

const fromNow = (hours) => new Date(Date.now() + hours * 3600000).toISOString();

const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

const encounterFor = ({ mrn, type, department }) =>
  encounters.byPatient(mrn).find((row) => row.type === type && row.department === department) || null;

/** The same rule data/engines/clearance-engine.js reads an estimate by. */
const TYPE_OF_VISIT = { Outpatient: 'OP', Inpatient: 'IP', Emergency: 'ER', 'Day Case': 'OP' };

const estimateFor = (enc) =>
  estimates.validForClearance(enc.patientMrn).find((row) => {
    const context = row.context || {};
    if (context.department && context.department !== enc.department) return false;
    return TYPE_OF_VISIT[context.visitType] === enc.type;
  }) || null;

/** What the desk was entitled to ask for on this visit, in the engine's terms. */
function requiredFor(enc, estimate) {
  const mode = CONFIG.clearance.paymentMode[enc.type] || 'None';
  if (mode === 'None') return 0;
  const pct = mode === 'Upfront Settlement'
    ? 1
    : enc.type === 'IP'
      ? (enc.financial?.payerId ? CONFIG.clearance.depositPct.insuredIP : CONFIG.clearance.depositPct.selfPayIP)
      : CONFIG.clearance.depositPct.OP;
  return money((estimate?.result?.totals?.patientShare || 0) * pct);
}

export function buildPayments() {
  const year = new Date().getFullYear();
  const out = [];

  ROWS.forEach((spec) => {
    const enc = encounterFor(spec.visit);
    if (!enc) return;
    const estimate = estimateFor(enc);
    const amount = money(requiredFor(enc, estimate) * spec.share);
    if (amount <= 0) return;
    const seq = out.length;
    out.push({
      id: `PMT-${String(seq + 1).padStart(4, '0')}`,
      receiptNo: `RCP-${year}-${String(FIRST + seq).padStart(6, '0')}`,
      encounterNo: enc.no,
      patientMrn: enc.patientMrn,
      kind: 'Deposit',
      amount,
      method: spec.method,
      reference: spec.reference || '',
      note: spec.note || '',
      receivedBy: spec.by,
      at: fromNow(spec.hours),
      migratedToAccount: false,
    });
  });

  return out;
}

