// Seed — the patient ledger. Owner: modules/frontis.
//
// Nothing here writes a balance, and nothing writes a split. Every charge is
// priced by data/engines/account-engine.js, which runs the same billing
// evaluation a live posting runs, so the seeded money is what the contracts in
// force actually answer — a hand-written ledger would drift from them the
// moment either changed.
//
// The charges follow the register rather than a list of their own: an encounter
// the board already stamps `chargesPosted` is an encounter whose charges have
// been posted, so those are exactly the visits that carry them. A visit the
// register says was never billed has no rows here, and the two can never
// disagree.
//
// The payments are a short table of intents — this patient, this much, this
// purpose, this many days after the visit — chosen so the list opens with one
// of each answer a desk has to deal with: settled in full, part paid, unpaid
// with money held against it, and an upfront settlement still carrying credit.
//
// data/store.js does not import this file: it reads the encounter board, the
// estimates and the charge master to exist. data/repositories/ledger.js builds
// on first read of an empty table — the shape data/seed/claims.js uses.

import * as encounters from '../repositories/encounters.js';
import * as estimates from '../repositories/estimates.js';
import * as cdm from '../repositories/cdm.js';
import * as patients from '../repositories/patients.js';
import { postCharge, openCharges, allocate, autoApplyUpfront, isUpfront, reconcileRows } from '../engines/account-engine.js';
import { buildPayments } from './payments.js';
import { ROLES } from '../../shared/roles.js';

const CASHIER = ROLES.find((r) => r.id === 'nurse').name;
const CODER = ROLES.find((r) => r.id === 'coder').name;

/** What a visit is charged for when no estimate priced it, by department. */
const BY_TYPE = {
  OP: [['CON-0002', 1], ['LAB-0001', 1]],
  ER: [['CON-0001', 1], ['RAD-0002', 1], ['PHA-0001', 2]],
  IP: [['RNB-0001', null], ['CON-0002', 1], ['LAB-0001', 2]],
};

/** A department that bills something of its own on top. */
const BY_DEPARTMENT = {
  Cardiology: [['RAD-0003', 1]],
  Radiology: [['RAD-0002', 1]],
  'General Surgery': [['PRF-0001', 2]],
  'Internal Medicine': [['LAB-0002', 1]],
  Paediatrics: [['CON-0001', 1]],
};

/**
 * The visits written by hand, because each is the demo's one example of
 * something: a package billed past its limits, and the admission whose money
 * was taken before the care was given.
 *
 * [mrn, type, hoursFromNow window, lines] — matched against the board rather
 * than by number, since the register hands the numbers out.
 */
const PACKAGE_VISIT = { mrn: 'MRN-000101', type: 'IP' };

/** Charges the appendectomy package with the overrun its limits are worth reading for. */
const PACKAGE_LINE = {
  itemId: 'PKG-APP-001',
  qty: 1,
  consumption: [['RNB-0001', 'qty', 5], ['CNS-0002', 'amount', 210], ['PHA-0002', 'amount', 126]],
};

/**
 * The money taken, written as the answers a desk has to be able to show rather
 * than as a list of patients: settled in full, part paid, money held and never
 * applied, money held and half spent, and something taken this morning.
 *
 * Each intent names the *role* and the builder picks the account that fits it —
 * because who owes what is the contracts' answer, not this file's. Naming
 * patients here worked until the register started classifying its visits: an
 * agreement that covers a visit in full leaves that patient owing nothing, and
 * an intent aimed at them would quietly do nothing at all.
 *
 * [key, scope, purpose, how much, method, when, by]
 *
 * `scope` is 'account' for money put against whatever is oldest and open, or
 * 'ip' for money taken on an admission. `how much` is a fraction of what is
 * outstanding in that scope, or an amount in dollars for a round sum taken at a
 * desk. `when` is days from the visit closing, or 'today'.
 *
 * Nothing here touches the three visits the clearance seed takes money on
 * (ENC-2026-000419, -000420 and -000423): those rows are migrated into this
 * ledger from the clearance feature's own payments, and taking money twice on
 * one visit would be a demo that does not reconcile. The upfront settlement and
 * the credit it leaves behind come from that migration, not from here.
 */
const PAYMENTS = [
  // Held against an admission and never applied: the Deposits tab's Held row,
  // on an account that still owes all of it. Claimed first, because it is the
  // only intent that needs an admission.
  ['deposit-held', 'ip', 'Deposit', 300, 'Card', -1, CASHIER],
  // Settled in full the day after the visit closed — the account that owes
  // nothing, which is what the Settled filter and a zero balance are for.
  ['fully-paid', 'account', 'Balance payment', 1, 'Card', 1, CASHIER],
  // Part paid. The rest is what the accounts list opens on.
  ['part-paid', 'account', 'Balance payment', 0.4, 'Cash', 1, CASHIER],
  // Held, then half of it spent: the lifecycle row worth reading, where a
  // deposit is neither untouched nor finished with.
  ['deposit-part', 'account', 'Deposit', 150, 'Cash', -1, CASHIER],
  // Taken at the desk this morning, so the rail's Taken today card has
  // something under it whatever day the demo runs.
  ['taken-today', 'account', 'Balance payment', 100, 'Cash', 'today', CASHIER],
];

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;

const codeId = (code) => cdm.getByCode(code)?.id || code;

export function buildLedger() {
  const rows = [];
  let n = 0;
  const id = () => `LDG-${String((n += 1)).padStart(4, '0')}`;

  // --- charges ---------------------------------------------------------------
  const posted = encounters.all()
    .filter((enc) => enc.chargesPosted && enc.status !== 'Cancelled')
    .sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)));

  for (const enc of posted) {
    const at = postingTime(enc);
    for (const line of linesFor(enc)) {
      const { rows: priced } = postCharge(enc, line, at);
      for (const row of priced) {
        rows.push({ ...row, id: id(), by: enc.by || CODER, status: 'Posted', reversesTxId: null, reason: null });
      }
    }
  }

  // --- the money financial clearance already took --------------------------------
  // The desk collected against these visits before there was an account to
  // collect into. It is the same money, so it is migrated here rather than left
  // in a register of its own: one ledger, one receipt sequence, and the
  // clearance checklist reads its answer off the account like everything else.
  //
  // How it lands is the visit's own payment mode, not the word the desk used: a
  // visit that settles up front takes a Settlement payment, which is applied to
  // its charges as they are posted, and everything else is a deposit held.
  const claimed = new Set();

  for (const row of buildPayments()) {
    const enc = encounters.get(row.encounterNo);
    if (!enc) continue;
    const upfront = row.kind === 'Settlement' || isUpfront(enc);
    rows.push({
      id: id(),
      at: row.at,
      by: row.receivedBy,
      patientMrn: row.patientMrn,
      encounterNo: row.encounterNo,
      type: upfront ? 'Payment' : 'DepositHeld',
      amount: row.amount,
      side: 'patient',
      detail: upfront
        ? { purpose: 'Settlement', method: row.method, reference: row.reference, note: row.note, allocations: [], credit: row.amount }
        : { purpose: 'Deposit', method: row.method, reference: row.reference, note: row.note, appliedTo: [] },
      reversesTxId: null,
      reason: null,
      status: 'Posted',
    });
    // The account has money on it already, so an intent below would be taking
    // it twice on one visit.
    claimed.add(row.patientMrn);
  }

  // Money settled up front answers the charges that were already posted, the
  // way it will answer them at the desk: the payment is not edited, and what it
  // answered is recorded beside it.
  for (const enc of posted) {
    if (!isUpfront(enc)) continue;
    const paidAt = rows
      .filter((row) => row.encounterNo === enc.no && row.type === 'Payment')
      .map((row) => row.at).sort().pop();
    if (!paidAt) continue;
    for (const row of autoApplyUpfront(enc, enc.patientMrn, rows, paidAt)) {
      rows.push({ ...row, id: id(), status: 'Posted', reversesTxId: null, reason: null });
    }
  }

  // --- payments and deposits --------------------------------------------------
  // Each intent takes the account that fits it and no account takes two, so the
  // five answers land on five different patients however the contracts price.

  for (const [key, scope, purpose, howMuch, method, when, by] of PAYMENTS) {
    const subject = pickAccount(rows, posted, scope, claimed);
    if (!subject) continue;
    claimed.add(subject.mrn);
    const { mrn, enc } = subject;

    const at = when === 'today' ? hoursAgo(3) : shift(postingTime(enc), when);
    // A payment on the account answers whatever is oldest; one taken on a visit
    // answers that visit.
    const mine = rows.filter((r) => r.patientMrn === mrn);
    const charges = openCharges(mine, scope === 'account' ? '' : enc.no);
    const owed = cents(charges.reduce((sum, c) => sum + c.remaining, 0));
    const amount = howMuch <= 1 ? cents(owed * howMuch) : cents(Math.min(howMuch, owed));
    if (amount <= 0) continue;

    if (purpose === 'Deposit') {
      const deposit = {
        id: id(), at, by, patientMrn: mrn, encounterNo: enc.no, type: 'DepositHeld',
        amount, side: 'patient', detail: { purpose, method, reference: '', appliedTo: [] },
        reversesTxId: null, reason: null, status: 'Posted',
      };
      rows.push(deposit);
      // Half of one of them has since been spent against the charges.
      if (key === 'deposit-part') {
        const { allocations } = allocate(cents(amount / 2), charges);
        if (allocations.length) {
          rows.push({
            id: id(), at: shift(at, 2), by, patientMrn: mrn, encounterNo: enc.no,
            type: 'DepositApplied',
            amount: cents(allocations.reduce((sum, a) => sum + a.amount, 0)), side: 'patient',
            detail: { sourceTxId: deposit.id, sourceReceiptNo: '', appliedTo: allocations },
            reversesTxId: null, reason: null, status: 'Posted',
          });
        }
      }
      continue;
    }

    const { allocations, credit } = allocate(amount, charges);
    rows.push({
      id: id(), at, by, patientMrn: mrn,
      encounterNo: scope === 'account' ? null : enc.no,
      type: 'Payment',
      amount, side: 'patient', detail: { purpose, method, reference: '', allocations, credit },
      reversesTxId: null, reason: null, status: 'Posted',
    });
  }

  // --- one correction ---------------------------------------------------------
  // A charge posted on the wrong visit and put right the way this ledger puts
  // anything right: the row stays, marked Reversed, and the row that answers it
  // sits underneath. Without one seeded, the struck-through row and the
  // Corrections filter would be code nobody had ever seen run.
  const wrong = rows.find((row) => row.type === 'Charge'
    && !row.detail.isOverage
    && row.detail.patientShare > 0
    && !isAnswered(rows, row.id)
    && !claimedByPayments(rows, row.patientMrn));
  if (wrong) {
    wrong.status = 'Reversed';
    rows.push({
      id: id(),
      at: shift(wrong.at, 1),
      by: CODER,
      patientMrn: wrong.patientMrn,
      encounterNo: wrong.encounterNo,
      type: 'Reversal',
      amount: wrong.amount,
      side: 'patient',
      detail: { ...wrong.detail, reversedType: 'Charge' },
      reversesTxId: wrong.id,
      reason: 'Posted on the wrong visit',
      status: 'Posted',
    });
  }

  // --- part B: settlement, an excess each way, an adjustment, a re-classification ---
  seedSettlementStates(rows, posted, claimed, id);

  // The ledger's order is the order the money moved in.
  rows.sort((a, b) => String(a.at).localeCompare(String(b.at)) || a.id.localeCompare(b.id));
  rows.forEach((row, i) => { row.seq = i + 1; });
  return rows;
}

/**
 * A receipt for every row that took or gave back money, numbered in date order.
 *
 * The sequence starts where the clearance desk's own book started, because
 * after the migration above there is only one book: a receipt handed over at
 * the clearance desk and one handed over at the cashier come out of the same
 * register, which is the whole reason F9's payments were folded in here.
 */
const FIRST_RECEIPT = 501;

export function buildReceipts(rows) {
  const year = new Date().getFullYear();
  let n = FIRST_RECEIPT - 1;
  const receipts = [];
  for (const row of rows) {
    if (!['Payment', 'DepositHeld', 'DepositRefund', 'Refund'].includes(row.type)) continue;
    n += 1;
    const receiptNo = `RCP-${year}-${String(n).padStart(6, '0')}`;
    row.detail = { ...row.detail, receiptNo };
    receipts.push({ receiptNo, txId: row.id, at: row.at, printedAt: [] });
  }
  // A deposit's child rows name the receipt the money arrived on.
  for (const row of rows) {
    if (!row.detail?.sourceTxId) continue;
    const source = rows.find((r) => r.id === row.detail.sourceTxId);
    if (source?.detail?.receiptNo) row.detail.sourceReceiptNo = source.detail.receiptNo;
  }
  return receipts;
}

/**
 * The register's own trail, written with the times the events happened at
 * rather than through audit.log(), which would stamp every one of them with now
 * and with whoever is signed in — the call every seeded trail in the platform
 * makes.
 *
 * A visit's charges are one entry, not one per line, because posting them was
 * one act: it is `appendBatch` that the live screen calls, and a history that
 * read differently after a reload than it did the moment the money moved would
 * be a history of the seed rather than of the account.
 */
export function buildLedgerTrail(rows) {
  const entries = [];
  const postings = new Map();

  for (const row of rows) {
    if (row.type === 'Charge') {
      const key = `${row.patientMrn}|${row.encounterNo}`;
      const found = postings.get(key);
      if (found) {
        found.lines += 1;
        found.allowed = cents(found.allowed + row.detail.allowed);
        found.patient = cents(found.patient + row.detail.patientShare);
      } else {
        postings.set(key, {
          mrn: row.patientMrn, encounterNo: row.encounterNo, at: row.at, by: row.by,
          lines: 1, allowed: cents(row.detail.allowed), patient: cents(row.detail.patientShare),
        });
      }
      continue;
    }
    entries.push({
      entity: ENTITY,
      entityId: row.patientMrn,
      action: row.type,
      user: row.by,
      at: row.at,
      details: describeRow(row),
    });
  }

  for (const p of postings.values()) {
    entries.push({
      entity: ENTITY,
      entityId: p.mrn,
      action: 'Charge',
      user: p.by,
      at: p.at,
      details: `${p.lines} charge${p.lines === 1 ? '' : 's'} posted on ${p.encounterNo} — `
        + `${money(p.allowed)} allowed, ${money(p.patient)} patient`,
    });
  }

  return entries.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/** The trail is keyed on the account, whose id is the patient's MRN. */
const ENTITY = 'account';

const money = (n) => `$${cents(n).toFixed(2)}`;

function describeRow(row) {
  const d = row.detail || {};
  if (row.type === 'Payment') return `${d.purpose} ${money(row.amount)} by ${d.method}${d.receiptNo ? ` · ${d.receiptNo}` : ''}`;
  if (row.type === 'DepositHeld') return `Deposit ${money(row.amount)} held${d.receiptNo ? ` · ${d.receiptNo}` : ''}`;
  if (row.type === 'DepositApplied') return `Deposit ${money(row.amount)} applied to charges`;
  if (row.type === 'Reversal') return `Reversed ${d.reversedType || 'transaction'} ${money(row.amount)} — ${row.reason}`;
  if (row.type === 'Adjustment') return `${money(row.amount)} adjusted off the patient share — ${d.reason || row.reason || 'adjustment'}`;
  if (row.type === 'Refund') return `Refund ${money(row.amount)} by ${d.method || '—'}${d.receiptNo ? ` · ${d.receiptNo}` : ''} — ${row.reason || ''}`;
  if (row.type === 'Settlement') return `Settled at ${money(row.amount)}${d.consent ? ` · ${money(d.consent.amount)} held as credit with consent` : ''}`;
  return `${row.type} ${money(row.amount)}`;
}

// --- amendment 22: the settlement states -------------------------------------------
// Each is the demo's one example of an answer part B has to show: an excess
// the patient left on the account, an excess given back with a voucher, a
// duplicate posting adjusted off, a visit reposted under a cover produced
// late, and every closed or up-front visit that reconciles to nothing stamped
// Settled — the way the completion and continuous triggers would have.

/** What a visit's live charges leave with the patient, off the rows built so far. */
const shareOf = (rows, enc) => cents(rows
  .filter((r) => r.encounterNo === enc.no && r.type === 'Charge' && r.status !== 'Reversed')
  .reduce((n, r) => n + cents(r.detail.patientShare), 0));

function seedSettlementStates(rows, posted, claimed, id) {
  // A restricted record's money is withheld from the default demo roles, so
  // the states worth showing are seeded on patients everyone can read.
  const untouched = (enc) => !claimed.has(enc.patientMrn)
    && !patients.get(enc.patientMrn)?.vip
    && !rows.some((r) => r.patientMrn === enc.patientMrn && ['Payment', 'DepositHeld', 'Reversal'].includes(r.type));
  const pick = (pred) => posted.find((enc) => untouched(enc) && pred(enc));

  // 1. Excess, held as credit with the patient's consent: an admission settled
  //    up front against a quotation that came out higher than the charges.
  const closed = (enc) => ['Discharged', 'Completed'].includes(enc.status);
  const consentEnc = pick((enc) => enc.type === 'IP' && closed(enc) && shareOf(rows, enc) > 0)
    || pick((enc) => closed(enc) && shareOf(rows, enc) > 0);
  if (consentEnc) {
    claimed.add(consentEnc.patientMrn);
    const share = shareOf(rows, consentEnc);
    const over = 40;
    const at = shift(consentEnc.startAt, -0.1);
    const payment = settlementPayment(rows, consentEnc, share + over, 'Card', at, id);
    const name = patients.get(consentEnc.patientMrn)?.nameEn || consentEnc.patientMrn;
    const consent = { name, method: 'Verbal (documented)', amount: over, at: shift(postingTime(consentEnc), 0.2), by: CASHIER };
    consentEnc.settlement = { status: 'Excess', at: consent.at, by: CASHIER, consent };
    stampSettled(rows, consentEnc, id, shift(postingTime(consentEnc), 0.25), CASHIER, { consent, paymentId: payment.id });
  }

  // 2. Excess given back: the same over-collection, refunded with a voucher.
  const refundEnc = pick((enc) => enc.type === 'IP' && shareOf(rows, enc) > 0)
    || pick((enc) => closed(enc) && shareOf(rows, enc) > 0);
  if (refundEnc) {
    claimed.add(refundEnc.patientMrn);
    const share = shareOf(rows, refundEnc);
    const over = 25;
    const at = shift(refundEnc.startAt, -0.1);
    const payment = settlementPayment(rows, refundEnc, share + over, 'Cash', at, id);
    const refundAt = shift(postingTime(refundEnc), 0.3);
    rows.push({
      id: id(), at: refundAt, by: CASHIER, patientMrn: refundEnc.patientMrn, encounterNo: refundEnc.no,
      type: 'Refund', amount: over, side: 'patient',
      detail: { sourceTxId: payment.id, sourceReceiptNo: '', method: 'Cash', reference: '', purpose: 'Refund' },
      reversesTxId: null, reason: 'Over-collected at the desk', status: 'Posted',
    });
    stampSettled(rows, refundEnc, id, shift(refundAt, 0.05), CASHIER, { paymentId: payment.id });
  }

  // 3. A duplicate posting adjusted off: the second line of a clinic visit.
  const dupEnc = pick((enc) => enc.type === 'OP' && rows.filter((r) => r.encounterNo === enc.no && r.type === 'Charge' && r.detail.patientShare > 0).length >= 2);
  if (dupEnc) {
    claimed.add(dupEnc.patientMrn);
    const line = rows.filter((r) => r.encounterNo === dupEnc.no && r.type === 'Charge' && r.detail.patientShare > 0)[1];
    const amount = cents(line.detail.patientShare);
    rows.push({
      id: id(), at: shift(line.at, 1), by: CODER, patientMrn: dupEnc.patientMrn, encounterNo: dupEnc.no,
      type: 'Adjustment', amount, side: 'patient',
      detail: { chargeTxId: line.id, reason: 'Duplicate posting', note: `${line.detail.description} was posted twice on the visit`, purpose: 'Adjustment', allocations: [{ chargeTxId: line.id, amount }] },
      reversesTxId: null, reason: 'Duplicate posting', status: 'Posted',
    });
  }

  // 4. A visit opened as Self-Pay and re-classified when the card turned up:
  //    the self-pay lines stand reversed, and the lines the main loop priced
  //    under the cover are the repost — a pair the Transactions tab reads
  //    together. The register keeps what the visit opened under.
  const reclassEnc = pick((enc) => enc.financial?.payerId && enc.type !== 'OP' && rows.some((r) => r.encounterNo === enc.no && r.type === 'Charge'))
    || pick((enc) => enc.financial?.payerId && rows.some((r) => r.encounterNo === enc.no && r.type === 'Charge'));
  if (reclassEnc) {
    claimed.add(reclassEnc.patientMrn);
    const at = postingTime(reclassEnc);
    const before = {
      policyId: null, payerId: null, planId: null, snapshotRef: null,
      classifiedAt: reclassEnc.startAt, classifiedBy: CASHIER, reason: null, overrideRef: null,
    };
    const reason = `Re-classification — Self-Pay → ${reclassEnc.financial.payerId} / ${reclassEnc.financial.planId || '—'}: Card produced at the desk after admission`;
    const current = rows.filter((r) => r.encounterNo === reclassEnc.no && r.type === 'Charge');
    for (const row of current) {
      const priced = postCharge({ ...reclassEnc, financial: before }, { itemId: row.detail.itemId, qty: row.detail.qty || 1, consumption: row.detail.consumption || [] }, at);
      const selfPay = priced.rows.find((p) => !p.detail.isOverage);
      if (!selfPay) continue;
      const old = { ...selfPay, id: id(), by: CASHIER, status: 'Reversed', reversesTxId: null, reason: null };
      rows.push(old);
      rows.push({
        id: id(), at: shift(at, 0.02), by: CASHIER, patientMrn: reclassEnc.patientMrn, encounterNo: reclassEnc.no,
        type: 'Reversal', amount: old.amount, side: 'patient',
        detail: { ...old.detail, reversedType: 'Charge' }, reversesTxId: old.id, reason, status: 'Posted',
      });
      row.at = shift(at, 0.04);
      row.reason = reason;
      row.detail = { ...row.detail, reclassification: { from: 'Self-Pay', to: `${reclassEnc.financial.payerId} / ${reclassEnc.financial.planId || '—'}`, reason: 'Card produced at the desk after admission', replaces: old.id } };
    }
    reclassEnc.financialHistory = [...(reclassEnc.financialHistory || []), before];
    reclassEnc.financial = { ...reclassEnc.financial, reason: 'Card produced at the desk after admission', classifiedAt: shift(at, 0.03), classifiedBy: CASHIER };
  }

  // 5. Settled ✓: every visit that settles up front and reconciles, and every
  //    closed visit that reconciles, wears the stamp the triggers would have put
  //    on it — with the Settlement row where anything was owed at all.
  for (const enc of posted) {
    if (enc.settlement?.status === 'Settled') continue;
    const closed = ['Discharged', 'Completed'].includes(enc.status);
    if (!closed && !isUpfront(enc)) continue;
    const r = reconcileRows(rows, enc.no, null);
    if (r.outcome !== 'Settled' || !r.chargeCount) continue;
    const last = rows.filter((row) => row.encounterNo === enc.no).map((row) => row.at).sort().pop();
    stampSettled(rows, enc, id, shift(last || postingTime(enc), 0.01), 'System', {});
  }
}

/** Money settled up front on the visit, applied to its charges the way the desk's is. */
function settlementPayment(rows, enc, amount, method, at, id) {
  const mine = rows.filter((r) => r.patientMrn === enc.patientMrn);
  const { allocations, credit } = allocate(amount, openCharges(mine, enc.no));
  const payment = {
    id: id(), at, by: CASHIER, patientMrn: enc.patientMrn, encounterNo: enc.no, type: 'Payment', amount: cents(amount), side: 'patient',
    detail: { purpose: 'Settlement', method, reference: '', note: 'Settled up front against the quotation', allocations, credit },
    reversesTxId: null, reason: null, status: 'Posted',
  };
  rows.push(payment);
  return payment;
}

/** The stamp on the visit and the Settlement row — nothing owed leaves only the stamp. */
function stampSettled(rows, enc, id, at, by, { consent = null, paymentId = null } = {}) {
  const r = reconcileRows(rows, enc.no, null);
  const stamp = { status: 'Settled', at, by, manual: false, txId: null, consent: consent || enc.settlement?.consent || null, amount: r.actualShare };
  if (r.actualShare > 0) {
    const row = {
      id: id(), at, by, patientMrn: enc.patientMrn, encounterNo: enc.no, type: 'Settlement', amount: r.actualShare, side: 'patient',
      detail: {
        estimatedShare: null, actualShare: r.actualShare, paid: r.paid, difference: r.difference,
        reconcilingTxIds: r.reconcilingTxIds, manual: false, mode: isUpfront(enc) ? 'Upfront Settlement' : 'None', consent: stamp.consent, paymentId,
      },
      reversesTxId: null, reason: null, status: 'Posted',
    };
    rows.push(row);
    stamp.txId = row.id;
  }
  enc.settlement = stamp;
}

// --- internals -----------------------------------------------------------------

/**
 * What a visit was charged for: the estimate that quoted it when there is one,
 * the package when it is the hand-written example, and otherwise a short set
 * chosen by visit type and department.
 */
function linesFor(enc) {
  if (enc.patientMrn === PACKAGE_VISIT.mrn && enc.type === PACKAGE_VISIT.type) {
    return [{
      itemId: codeId(PACKAGE_LINE.itemId),
      qty: PACKAGE_LINE.qty,
      consumption: PACKAGE_LINE.consumption.map(([code, unit, value]) => ({
        componentId: codeId(code), [unit]: value,
      })),
    }];
  }

  const quoted = estimates.byEncounter(enc.no).find((row) => (row.lines || []).length);
  if (quoted) return quoted.lines.map((line) => ({ ...line, consumption: (line.consumption || []).map((c) => ({ ...c })) }));

  const nights = Math.max(1, Number(enc.los) || 1);
  return [...BY_TYPE[enc.type] || [], ...BY_DEPARTMENT[enc.department] || []]
    .map(([code, qty]) => ({ itemId: codeId(code), qty: qty === null ? nights : qty, consumption: [] }))
    .filter((line) => cdm.get(line.itemId));
}

/** Charges are posted when the visit closes; an open one is posted as it runs. */
const postingTime = (enc) => enc.endAt || enc.startAt;

const shift = (at, days) => new Date(Date.parse(at) + days * 86400000).toISOString();

/**
 * The account an intent lands on: the one owing most that has not been claimed
 * already, and — for an intent taken on an admission — one that has an
 * admission to take it on. Worst first, so the money in the demo is where a
 * desk would actually be chasing it.
 */
function pickAccount(rows, posted, scope, claimed) {
  const owedBy = new Map();
  for (const row of rows) {
    if (row.type !== 'Charge') continue;
    owedBy.set(row.patientMrn, cents((owedBy.get(row.patientMrn) || 0) + row.detail.patientShare));
  }
  const ranked = [...owedBy.entries()]
    .filter(([mrn, owed]) => owed > 0 && !claimed.has(mrn))
    .sort((a, b) => b[1] - a[1]);

  for (const [mrn] of ranked) {
    const mine = posted.filter((enc) => enc.patientMrn === mrn);
    const enc = scope === 'ip' ? mine.find((e) => e.type === 'IP') : mine[0];
    if (enc) return { mrn, enc };
  }
  return null;
}

/** Whether any money has been put against this charge yet. */
const isAnswered = (rows, txId) => rows.some((row) =>
  (row.detail?.allocations || row.detail?.appliedTo || []).some((a) => a.chargeTxId === txId));

/** Whether this patient is one of the five the payment intents landed on. */
const claimedByPayments = (rows, mrn) => rows.some((row) =>
  row.patientMrn === mrn && ['Payment', 'DepositHeld'].includes(row.type));

const hoursAgo = (n) => new Date(Date.now() - n * 3600000).toISOString();
