// The patient account engine: what a ledger adds up to, what a payment answers,
// and what a charge costs when it is posted. Pure — no DOM, no writes, and it
// does not read the ledger either: every balance is a function of the rows it
// is handed. data/repositories/accounts.js is what reads them out of
// data/repositories/ledger.js and what appends whatever comes back.
//
// That is why the rows are passed in rather than fetched: the seed prices its
// charges through postCharge() before a single ledger row exists, and an engine
// that read the ledger would have to be imported by the file that builds it.
//
// Nothing here is stored. A balance is always recomputed from the transactions
// under it, so a figure on a screen can be traced to the rows that made it —
// which is the whole reason the ledger is append-only.
//
// Posting reuses the billing evaluation rather than repeating it: a charge is
// priced by the same five steps the simulator and the cost estimate are priced
// by, so what the patient was quoted and what the patient is billed can only
// differ where the contract or the visit differs. Manual entry of a payer or
// patient split is not possible anywhere — the split is the engine's answer.

import * as contracts from '../repositories/contracts.js';
import * as cdm from '../repositories/cdm.js';
import * as patients from '../repositories/patients.js';
import { VISIT_TYPE_OF } from '../repositories/encounters.js';
import { evaluateCharge } from './billing-engine.js';
import { ADMISSION_OF } from './eligibility-engine.js';
import { CONFIG } from '../../shared/config.js';

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * The per-encounter-type payment mode. It is read defensively because the
 * clearance feature owns the knob: an encounter type it does not name asks for
 * nothing, which is the safe answer for a screen that only reports.
 */
export const paymentModeOf = (encounter) =>
  CONFIG.clearance?.paymentMode?.[encounter?.type] || 'None';

export const isUpfront = (encounter) => paymentModeOf(encounter) === 'Upfront Settlement';

export const outstandingThreshold = () => CONFIG.accounts?.outstandingThreshold ?? 500;

// --- what a row does to the account -------------------------------------------

const ZERO = {
  totalCharges: 0, payerShare: 0, patientShare: 0, undecided: 0, paid: 0, depositsHeld: 0, depositsApplied: 0,
  // A33: what has been written off the patient's share. Its own bucket rather
  // than a cut in patientShare, so charges = payer + patient + undecided stays
  // true and a statement can still say what was owed before it was let go.
  adjustments: 0,
};

/**
 * One row's contribution to every bucket. A Reversal contributes the exact
 * negative of the row it reverses, which is why nothing is ever filtered out:
 * the reversed row and its answer both stay in the trail and cancel.
 */
export function effect(row) {
  if (row.type === 'Reversal') {
    const inner = effect({ ...row, type: row.detail?.reversedType || 'Charge' });
    return Object.fromEntries(Object.entries(inner).map(([k, v]) => [k, -v]));
  }
  const d = row.detail || {};
  if (row.type === 'Charge') {
    const allowed = cents(d.allowed ?? row.amount);
    const payer = cents(d.payerShare);
    const patient = cents(d.patientShare);
    // A line held for approval has an amount and no split: the overage engine
    // computes what it is worth and leaves who carries it to the payer's
    // answer. Keeping that difference in a bucket of its own is what makes
    // charges = payer + patient + undecided true on every screen.
    return { ...ZERO,
      totalCharges: allowed,
      payerShare: payer,
      patientShare: patient,
      undecided: cents(allowed - payer - patient) };
  }
  if (row.type === 'Payment') return { ...ZERO, paid: row.amount };
  if (row.type === 'DepositHeld') return { ...ZERO, depositsHeld: row.amount };
  if (row.type === 'DepositApplied') return { ...ZERO, depositsHeld: -row.amount, depositsApplied: row.amount };
  if (row.type === 'DepositRefund') return { ...ZERO, depositsHeld: -row.amount };
  // A29: a remittance moving part of the payer's share onto the patient. The
  // charges do not change; the two shares move by the same amount in opposite
  // directions, which keeps charges = payer + patient + undecided true.
  if (row.type === 'PortionShift') return { ...ZERO, payerShare: cents(d.payerShare), patientShare: cents(d.patientShare) };
  // A33: a write-off posted against the patient's balance (Claima's
  // write-off feature, detail.origin naming the request). It answers the
  // balance the way a payment does without being money.
  if (row.type === 'Adjustment') return { ...ZERO, adjustments: row.amount };
  // A22: money given back out of a payment's unallocated credit. It is paid
  // money leaving again, so the paid bucket falls by it; a Settlement row is a
  // marker and moves nothing.
  if (row.type === 'Refund') return { ...ZERO, paid: -row.amount };
  // An Allocation moves credit already paid onto a named charge. It says what
  // the money answered; it is not more money, so it moves no bucket.
  return { ...ZERO };
}

/** What the patient's running balance does at this row — the Transactions column. */
export const patientDelta = (row) => {
  const e = effect(row);
  return cents(e.patientShare - e.paid - e.depositsApplied - e.adjustments);
};

const sum = (rows) => rows.reduce((acc, row) => {
  const e = effect(row);
  for (const key of Object.keys(ZERO)) acc[key] = cents(acc[key] + e[key]);
  return acc;
}, { ...ZERO });

/**
 * The six figures the account header carries, and the one that explains them.
 * `outstanding` is what the patient still owes: their share of the charges,
 * less what they have paid and less what a deposit has already answered. Money
 * held as a deposit and not yet applied is not a payment — it is reported
 * beside the balance, never inside it.
 *
 * `undecided` is the part of the charges nobody carries yet, because the line
 * is held for the payer's approval — the account page calls it "Pending
 * approval". It is what keeps the arithmetic honest:
 * totalCharges === payerShare + patientShare + undecided, always.
 */
export function balances(rows = []) {
  const totals = sum(rows);
  return {
    ...totals,
    credit: cents(unallocatedCredit(rows)),
    outstanding: cents(totals.patientShare - totals.paid - totals.depositsApplied - totals.adjustments),
  };
}

/** The same six over one visit, plus what an upfront settlement has covered. */
export function encounterBalance(allRows = [], encounterNo) {
  const rows = allRows.filter((row) => row.encounterNo === encounterNo);
  const totals = sum(rows);
  const upfrontPaid = cents(rows
    .filter((row) => row.type === 'Payment' && row.detail?.purpose === 'Settlement')
    .reduce((n, row) => n + row.amount, 0));
  return {
    ...totals,
    encounterNo,
    upfrontPaid,
    credit: cents(unallocatedCredit(rows)),
    unpaid: cents(totals.patientShare - totals.paid - totals.depositsApplied - totals.adjustments),
  };
}

/** One row per visit the account has ever charged against, newest visit first. */
export function byEncounter(rows = []) {
  const nos = [...new Set(rows.map((row) => row.encounterNo).filter(Boolean))];
  return nos.map((no) => encounterBalance(rows, no)).reverse();
}

// --- charges and what has answered them ---------------------------------------

/** Money taken that no charge has claimed yet — the credit a posting draws on. */
function unallocatedCredit(rows) {
  const credits = rows.filter((row) => row.type === 'Payment');
  return credits.reduce((n, row) => n + row.amount - allocatedFrom(rows, row.id), 0);
}

const allocatedFrom = (rows, txId) => rows
  .filter((row) => (row.type === 'Allocation' || row.type === 'DepositApplied' || row.type === 'Refund')
    && row.detail?.sourceTxId === txId && row.status !== 'Reversed')
  .reduce((n, row) => n + row.amount, 0)
  + rows.filter((row) => row.id === txId)
    .reduce((n, row) => n + (row.detail?.allocations || []).reduce((m, a) => m + (Number(a.amount) || 0), 0), 0);

/** What is left of one payment after its allocations and refunds — what a refund may give back. */
export const paymentCredit = (rows, txId) => {
  const row = rows.find((r) => r.id === txId);
  if (!row || row.type !== 'Payment' || row.status === 'Reversed') return 0;
  return cents(row.amount - allocatedFrom(rows, txId));
};

/** What has been put against one charge, from any source. */
export function answeredOn(rows, chargeTxId) {
  const direct = rows.reduce((n, row) => {
    const list = row.detail?.allocations || row.detail?.appliedTo || [];
    return n + list.filter((a) => a.chargeTxId === chargeTxId)
      .reduce((m, a) => m + (Number(a.amount) || 0), 0);
  }, 0);
  return cents(direct);
}

/**
 * The patient-side charges still carrying a remainder, oldest first — which is
 * the order a payment is proposed against them, because the oldest debt is the
 * one a desk chases.
 */
export function openCharges(rows = [], encounterNo = '') {
  return rows
    .filter((row) => row.type === 'Charge' && row.status !== 'Reversed')
    .filter((row) => !encounterNo || row.encounterNo === encounterNo)
    .map((row) => {
      const owed = cents(row.detail?.patientShare);
      const answered = answeredOn(rows, row.id);
      return {
        txId: row.id,
        at: row.at,
        encounterNo: row.encounterNo,
        description: row.detail?.description || row.detail?.itemId,
        chargeCode: row.detail?.chargeCode || '',
        isOverage: Boolean(row.detail?.isOverage),
        owed,
        answered,
        remaining: cents(owed - answered),
      };
    })
    .filter((row) => row.remaining > 0);
}

/**
 * Oldest first unless the desk named the charges itself. Whatever the amount
 * does not reach stays as credit on the account — a payment is never refused
 * for being more than the charges on the day it was taken.
 */
export function allocate(paymentAmount, charges = [], selection = null) {
  let left = cents(paymentAmount);
  const targets = selection
    ? charges.filter((c) => selection.includes(c.txId))
    : charges;
  const allocations = [];
  for (const charge of targets) {
    if (left <= 0) break;
    const amount = cents(Math.min(left, charge.remaining));
    if (amount <= 0) continue;
    allocations.push({ chargeTxId: charge.txId, amount });
    left = cents(left - amount);
  }
  return { allocations, credit: cents(left) };
}

// --- deposits ------------------------------------------------------------------

export const DEPOSIT_STATUSES = ['Held', 'Partially applied', 'Applied', 'Refunded'];

/** Each deposit taken, with what has become of it. */
export function depositLifecycle(rows = []) {
  return rows.filter((row) => row.type === 'DepositHeld' && row.status !== 'Reversed').map((row) => {
    const children = rows.filter((r) => r.detail?.sourceTxId === row.id);
    const applied = cents(children.filter((r) => r.type === 'DepositApplied').reduce((n, r) => n + r.amount, 0));
    const refunded = cents(children.filter((r) => r.type === 'DepositRefund').reduce((n, r) => n + r.amount, 0));
    const remaining = cents(row.amount - applied - refunded);
    return {
      tx: row,
      receiptNo: row.detail?.receiptNo || '',
      encounterNo: row.encounterNo,
      amount: row.amount,
      applied,
      refunded,
      remaining,
      children,
      status: refunded >= row.amount ? 'Refunded'
        : remaining <= 0 ? 'Applied'
          : applied > 0 ? 'Partially applied' : 'Held',
    };
  });
}

/** What is still held and free to apply or refund, over the whole account. */
export const depositsAvailable = (rows = []) =>
  depositLifecycle(rows).filter((d) => d.remaining > 0);

/** What the clearance engine's item 5 reads: held less refunded, for one visit. */
export function depositsFor(rows = []) {
  const held = rows.filter((r) => r.type === 'DepositHeld' && r.status !== 'Reversed')
    .reduce((n, r) => n + r.amount, 0);
  const refunded = rows.filter((r) => r.type === 'DepositRefund').reduce((n, r) => n + r.amount, 0);
  return cents(held - refunded);
}

/** The other half of item 5: what has been settled upfront on one visit. */
export function settlementFor(rows = []) {
  return cents(rows
    .filter((r) => r.type === 'Payment' && r.detail?.purpose === 'Settlement' && r.status !== 'Reversed')
    .reduce((n, r) => n + r.amount, 0));
}

// --- posting -------------------------------------------------------------------

/**
 * One line through the billing engine, as the ledger rows it would become.
 * Pure: nothing is written, so the posting screen's preview and the posting
 * itself are the same call and cannot disagree.
 *
 * A bundle produces one row for the package plus one row per component that ran
 * past its limit, each flagged `isOverage` and carrying its `componentId` —
 * which is what the overage engine already answers per component. The
 * consumption entered rides on the package's own row, so the visit can be read
 * back with the numbers it was posted from.
 */
export function postCharge(encounter, line, at = new Date().toISOString()) {
  const on = String(at).slice(0, 10);
  const item = cdm.get(line?.itemId);
  if (!item) return { error: 'No charge chosen', rows: [], trace: null };

  const financial = encounter?.financial || {};
  const contract = financial.payerId && financial.planId
    ? contracts.contractForService(financial.payerId, financial.planId, on)
    : null;

  if (!contract) return { error: '', trace: null, selfPay: true, rows: [selfPayRow(encounter, item, line, at)] };

  const trace = evaluateCharge(contract, financial.planId, patientCtxOf(encounter), {
    dateOfService: on,
    department: encounter.department || '',
    admissionType: admissionOf(encounter),
    lengthOfStay: encounter.los ?? undefined,
    attendingDoctor: encounter.doctorId,
  }, line);
  if (!trace) return { error: 'This charge could not be priced', rows: [], trace: null };

  const rows = [chargeRow(encounter, at, {
    itemId: item.id,
    chargeCode: item.chargeCode,
    description: cdm.label(item),
    qty: trace.qty,
    gross: cents((Number(item.standardPrice) || 0) * trace.qty),
    allowed: trace.result.allowed,
    payerShare: trace.result.payerShare,
    patientShare: trace.result.patientShare,
    status: trace.result.status,
    preAuthRequired: trace.result.preAuthRequired,
    isOverage: false,
    consumption: (line.consumption || []).map((c) => ({ ...c })),
    contractId: contract.id,
    contractNo: contract.contractNo,
    version: contract.version,
  })];

  for (const over of trace.result.overageLines) {
    rows.push(chargeRow(encounter, at, {
      itemId: over.componentId || item.id,
      chargeCode: over.chargeCode,
      description: over.description,
      qty: 1,
      qtyLabel: over.qtyLabel,
      gross: null,
      allowed: over.amount,
      payerShare: over.payer,
      patientShare: over.patient,
      status: over.status,
      preAuthRequired: false,
      isOverage: true,
      componentId: over.componentId,
      parentItemId: item.id,
      action: over.action,
      source: over.source,
      contractId: contract.id,
      contractNo: contract.contractNo,
      version: contract.version,
    }));
  }

  return { error: '', trace, selfPay: false, rows };
}

/** Every line of a visit at once, with the totals the preview reads. */
export function postCharges(encounter, lines = [], at = new Date().toISOString()) {
  const results = lines.filter((line) => line.itemId).map((line) => postCharge(encounter, line, at));
  const rows = results.flatMap((r) => r.rows);
  return {
    results,
    rows,
    error: results.find((r) => r.error)?.error || '',
    totals: {
      lines: rows.length,
      allowed: cents(rows.reduce((n, r) => n + (r.detail.allowed || 0), 0)),
      payer: cents(rows.reduce((n, r) => n + (r.detail.payerShare || 0), 0)),
      patient: cents(rows.reduce((n, r) => n + (r.detail.patientShare || 0), 0)),
      overage: cents(rows.filter((r) => r.detail.isOverage).reduce((n, r) => n + (r.detail.allowed || 0), 0)),
      held: rows.filter((r) => r.detail.status === 'Held for approval').length,
      notBillable: rows.filter((r) => r.detail.status === 'Not billable').length,
    },
  };
}

/**
 * Upfront settlement: money taken before the care was given answers the charges
 * as they land, without anybody allocating it by hand. Returns the Allocation
 * rows to append — the payment is not touched, because a ledger row is never
 * edited; what the money answered is recorded beside it.
 */
export function autoApplyUpfront(encounter, mrn, rows = [], at = new Date().toISOString()) {
  if (!isUpfront(encounter)) return [];
  const charges = openCharges(rows, encounter.no);
  const payments = rows
    .filter((row) => row.type === 'Payment' && row.encounterNo === encounter.no
      && row.detail?.purpose === 'Settlement' && row.status !== 'Reversed')
    .map((row) => ({ row, left: cents(row.amount - allocatedFrom(rows, row.id)) }))
    .filter((p) => p.left > 0);
  if (!payments.length) return [];

  const out = [];
  const open = charges.map((c) => ({ ...c }));
  for (const payment of payments) {
    const { allocations } = allocate(payment.left, open.filter((c) => c.remaining > 0));
    if (!allocations.length) continue;
    for (const a of allocations) {
      const target = open.find((c) => c.txId === a.chargeTxId);
      if (target) target.remaining = cents(target.remaining - a.amount);
    }
    out.push({
      at,
      patientMrn: mrn,
      encounterNo: encounter.no,
      type: 'Allocation',
      amount: cents(allocations.reduce((n, a) => n + a.amount, 0)),
      side: 'patient',
      detail: {
        sourceTxId: payment.row.id,
        purpose: 'Settlement',
        receiptNo: payment.row.detail?.receiptNo || '',
        appliedTo: allocations,
        allocations,
      },
    });
  }
  return out;
}

// --- settlement arithmetic (amendment 22) ---------------------------------------
// What one visit was charged, what has answered it, and the difference — over
// rows handed in, so the ledger seed can settle a visit while it is still
// building and data/engines/settlement-engine.js can read the same answer off
// the live ledger. Estimates never settle: the quoted share is carried beside
// the figures for the strip and the drivers, never taken into the difference.

/** The tone a screen paints an outcome in. */
export const outcomeTone = (outcome) =>
  ({ Settled: 'success', Unsettled: 'critical', Excess: 'warning', Pending: '' }[outcome] || '');

/**
 * reconcileRows(allRows, encounterNo, quoted) → { actualShare, paid,
 * difference, outcome, drivers, reconcilingTxIds, chargeCount, estimatedShare }.
 *   actualShare = Σ patient share of the live Charge rows + Σ PortionShift
 *                 rows − Σ Adjustment rows on the visit
 *   paid        = payments less refunds on the visit, deposits applied to it,
 *                 and money from elsewhere on the account allocated to its
 *                 charges (a payment on the visit counts once, by its amount)
 *   outcome     = Pending (no charge) | Settled (0) | Unsettled (> 0) | Excess (< 0)
 */
export function reconcileRows(allRows = [], encounterNo, quoted = null) {
  const live = (row) => row.status !== 'Reversed';
  const mine = allRows.filter((row) => row.encounterNo === encounterNo);
  const charges = mine.filter((row) => row.type === 'Charge' && live(row));
  const actualShare = cents(
    charges.reduce((n, row) => n + cents(row.detail?.patientShare), 0)
    + mine.filter((row) => row.type === 'PortionShift' && live(row)).reduce((n, row) => n + cents(row.detail?.patientShare), 0)
    - mine.filter((row) => row.type === 'Adjustment' && live(row)).reduce((n, row) => n + row.amount, 0),
  );
  const direct = mine.filter(live).reduce((n, row) => {
    if (row.type === 'Payment') return n + row.amount;
    if (row.type === 'Refund') return n - row.amount;
    if (row.type === 'DepositApplied') return n + row.amount;
    if (row.type === 'Reversal' && ['Payment', 'DepositApplied'].includes(row.detail?.reversedType)) return n - row.amount;
    if (row.type === 'Reversal' && row.detail?.reversedType === 'Refund') return n + row.amount;
    return n;
  }, 0);
  const ids = new Set(charges.map((row) => row.id));
  const fromElsewhere = allRows
    .filter((row) => row.encounterNo !== encounterNo && live(row))
    .reduce((n, row) => n + (row.detail?.allocations || row.detail?.appliedTo || [])
      .filter((a) => ids.has(a.chargeTxId)).reduce((m, a) => m + (Number(a.amount) || 0), 0), 0);
  const paid = cents(direct + fromElsewhere);
  const difference = cents(actualShare - paid);
  const outcome = !charges.length ? 'Pending'
    : Math.abs(difference) < 0.005 ? 'Settled'
      : difference > 0 ? 'Unsettled' : 'Excess';
  return {
    encounterNo,
    estimateNo: quoted?.no || null,
    estimatedShare: quoted ? cents(quoted.result?.totals?.patientShare) : null,
    actualShare,
    paid,
    difference,
    outcome,
    drivers: driversOf(charges, quoted),
    reconcilingTxIds: mine.filter(live).map((row) => row.id),
    chargeCount: charges.length,
    depositsHeld: depositsFor(mine),
  };
}

/**
 * The lines behind an estimate-versus-actual gap: every live charge beside
 * what the acknowledged estimate quoted for the same charge code, overage
 * rows first, then the widest gap. With no estimate every line is a driver
 * with nothing to compare against, and says so.
 */
export function driversOf(charges, quoted) {
  const quotedRows = quoted?.result?.rows || [];
  const estimatedFor = (code) => (quoted
    ? cents(quotedRows.filter((r) => r.chargeCode === code && !r.isOverage).reduce((n, r) => n + cents(r.patient), 0))
    : null);
  const inEstimate = (code) => quotedRows.some((r) => r.chargeCode === code);
  return charges.map((row) => {
    const d = row.detail || {};
    const estimated = d.isOverage ? (quoted ? 0 : null) : estimatedFor(d.chargeCode);
    const actual = cents(d.patientShare);
    return {
      chargeTxId: row.id,
      chargeCode: d.chargeCode || '',
      item: d.description || d.itemId || row.id,
      estimated,
      actual,
      delta: estimated === null ? null : cents(actual - estimated),
      isOverage: Boolean(d.isOverage),
      inEstimate: quoted ? inEstimate(d.chargeCode) : null,
    };
  }).sort((a, b) => Number(b.isOverage) - Number(a.isOverage) || Math.abs(b.delta || 0) - Math.abs(a.delta || 0));
}

// --- internals ------------------------------------------------------------------

const chargeRow = (encounter, at, detail) => ({
  at,
  patientMrn: encounter.patientMrn,
  encounterNo: encounter.no,
  type: 'Charge',
  amount: cents(detail.allowed),
  side: 'patient',
  detail,
});

/**
 * No plan, no contract, no split: the charge master's price is the price and
 * the patient carries all of it. The engine is not run at all — there is
 * nothing for it to resolve — which is what "Self-Pay is not faked as a
 * contract case" already means on a cost estimate.
 */
function selfPayRow(encounter, item, line, at) {
  const qty = Math.max(1, Number(line.qty) || 1);
  const amount = cents((Number(item.standardPrice) || 0) * qty);
  return chargeRow(encounter, at, {
    itemId: item.id,
    chargeCode: item.chargeCode,
    description: cdm.label(item),
    qty,
    gross: amount,
    allowed: amount,
    payerShare: 0,
    patientShare: amount,
    status: 'Priced',
    preAuthRequired: false,
    isOverage: false,
    selfPay: true,
    consumption: (line.consumption || []).map((c) => ({ ...c })),
  });
}

/**
 * The board's two-letter code, read through the visit type the eligibility
 * engine already maps: Emergency and Day Case are the only two admission types
 * a visit can be sure of, and an inpatient stay's is a claim-time fact nobody
 * at the desk has chosen yet.
 */
const admissionOf = (encounter) => ADMISSION_OF[VISIT_TYPE_OF[encounter?.type]] || null;

/**
 * The rule engine's patient context, read off the register raw — masking is a
 * rule about who may look at a record, not about what a rule may match on, the
 * call data/engines/estimate-pricing.js already made.
 */
function patientCtxOf(encounter) {
  const patient = patients.get(encounter?.patientMrn);
  if (!patient) return {};
  const born = Date.parse(patient.dob);
  return {
    age: Number.isFinite(born) ? Math.floor((Date.now() - born) / (365.25 * 86400000)) : undefined,
    gender: patient.gender,
    nationality: patient.nationality,
    memberSince: patient.createdAt ? String(patient.createdAt).slice(0, 10) : undefined,
  };
}
