// Repository — patient accounts. Owner: modules/frontis.
//
// An account is a header and nothing more: one per patient, opened the first
// time money moves. Every figure it is read for — charges, shares, payments,
// deposits, the outstanding balance — is computed from the ledger by
// data/engines/account-engine.js, so there is no stored total anywhere that
// could disagree with the transactions under it.
//
// This file is also where the acts live that write money: posting a visit's
// charges, taking a payment, applying or refunding a deposit. Each one is a
// short function that asks the engine what the rows should be and hands them to
// the ledger — the only write path. The screens never build a transaction.
//
// The one-way arrow is the shape data/repositories/estimates.js already makes
// to its own engine: this file reads account-engine.js, and account-engine.js
// reads the ledger and the charge master and never reads this file back.
//
// The dataset seeds itself on first read (data/seed/accounts.js), which derives
// an account from the ledger rows that exist.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as ledger from './ledger.js';
import * as patients from './patients.js';
import * as encounters from './encounters.js';
import * as accountEngine from '../engines/account-engine.js';
// Amendment 22: the settlement engine reads the ledger, the register, the
// estimates and the acknowledgments and writes nothing; this file is where its
// answer is written — the stamp on the visit and the Settlement row.
import * as settlementEngine from '../engines/settlement-engine.js';
import { buildAccounts } from '../seed/accounts.js';
import { current as currentRole } from '../../shared/roles.js';
import { CONFIG } from '../../shared/config.js';
import { compareDates, iso, usd } from '../../shared/format.js';

const TABLE = 'accounts';

/** The trail is keyed on the account, whose id is the patient's MRN. */
const ENTITY = 'account';

export const STATUSES = ['Open', 'Closed'];

export function all() {
  const rows = store.table(TABLE);
  if (!rows.length) rows.push(...buildAccounts());
  return rows;
}

export const get = (mrn) => all().find((row) => row.mrn === mrn) || null;

/** The account exists from the first transaction; nothing opens one by hand. */
export function ensure(mrn) {
  const found = get(mrn);
  if (found) return found;
  const now = new Date().toISOString();
  const row = { mrn, openedAt: now, status: 'Open', flags: [], updatedAt: now };
  all().push(row);
  store.commit('account.open');
  log(mrn, 'Opened', `Account opened for ${mrn}`);
  return row;
}

// --- reading -------------------------------------------------------------------

export const transactions = (mrn) => ledger.byPatient(mrn);

export const balances = (mrn) => accountEngine.balances(transactions(mrn));

export const byEncounter = (mrn) => accountEngine.byEncounter(transactions(mrn));

export const openCharges = (mrn, encounterNo = '') =>
  accountEngine.openCharges(transactions(mrn), encounterNo);

export const deposits = (mrn) => accountEngine.depositLifecycle(transactions(mrn));

/** What one visit has taken, which is what the clearance engine's item 5 asks. */
export const depositsFor = (encounterNo) => accountEngine.depositsFor(ledger.byEncounter(encounterNo));

export const settlementFor = (encounterNo) => accountEngine.settlementFor(ledger.byEncounter(encounterNo));

/** The balances of one visit, for the encounter page's Account row. */
export const encounterBalance = (mrn, encounterNo) =>
  accountEngine.encounterBalance(transactions(mrn), encounterNo);

export const lastTransaction = (mrn) => transactions(mrn).slice(-1)[0] || null;

/** The visits still open, which is what the account's Post charges menu offers. */
export const openEncounters = (mrn) =>
  encounters.byPatient(mrn).filter((enc) => encounters.isOpen(enc));

export const postableEncounters = (mrn) =>
  encounters.byPatient(mrn).filter((enc) => enc.status !== 'Cancelled');

/** One row of the accounts list: the header, the balances and the visit count. */
export function view(row) {
  const patient = patients.get(row.mrn);
  const open = openEncounters(row.mrn);
  return {
    ...row,
    flags: refreshFlags(row.mrn),
    patient,
    balances: balances(row.mrn),
    openCount: open.length,
    openTypes: [...new Set(open.map((enc) => enc.type))],
    last: lastTransaction(row.mrn),
  };
}

export const OUTSTANDING_FILTERS = [
  { id: 'any', label: 'Any balance' },
  { id: 'owing', label: 'Owing' },
  { id: 'over', label: 'Over threshold' },
  { id: 'zero', label: 'Settled' },
];

/**
 * The list, worst first: the biggest outstanding balance is the account a desk
 * opens. `outstanding` is one of OUTSTANDING_FILTERS; `holdingDeposit` and
 * `activeToday` are the two slices the rail selects that have no control of
 * their own, the way Payer Master's "With active plans" card does.
 */
export function search(q = '', {
  outstanding = 'any', flag = '', from = '', to = '', holdingDeposit = false, activeToday = false,
} = {}) {
  const needle = q.trim().toLowerCase();
  const threshold = accountEngine.outstandingThreshold();
  const today = new Date().toISOString().slice(0, 10);
  return all()
    .map(view)
    .filter((row) => {
      if (needle) {
        const hay = `${row.patient?.nameEn || ''} ${row.patient?.nameAr || ''} ${row.mrn}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      if (outstanding === 'owing' && row.balances.outstanding <= 0) return false;
      if (outstanding === 'over' && row.balances.outstanding <= threshold) return false;
      if (outstanding === 'zero' && row.balances.outstanding > 0) return false;
      if (holdingDeposit && row.balances.depositsHeld <= 0) return false;
      if (activeToday && !transactions(row.mrn).some((tx) => iso(tx.at) === today)) return false;
      if (flag && !(row.flags || []).includes(flag)) return false;
      const at = row.last ? iso(row.last.at) : '';
      if (from && (!at || compareDates(at, from) < 0)) return false;
      if (to && (!at || compareDates(at, to) > 0)) return false;
      return true;
    })
    .sort((a, b) => b.balances.outstanding - a.balances.outstanding);
}

/** Every flag any account carries — the Flags filter's options. Part B fills them. */
export const flagsInUse = () => [...new Set(all().flatMap((row) => row.flags || []))].sort();

/** The rail. Every figure is over the whole register, not the page on screen. */
export function counts(rows = all().map(view)) {
  const threshold = accountEngine.outstandingThreshold();
  const today = new Date().toISOString().slice(0, 10);
  const paidToday = ledger.all().filter((tx) =>
    (tx.type === 'Payment' || tx.type === 'DepositHeld') && iso(tx.at) === today);
  return {
    accounts: rows.length,
    outstanding: round(rows.reduce((n, row) => n + row.balances.outstanding, 0)),
    overThreshold: rows.filter((row) => row.balances.outstanding > threshold).length,
    depositsHeld: round(rows.reduce((n, row) => n + row.balances.depositsHeld, 0)),
    holdingDeposit: rows.filter((row) => row.balances.depositsHeld > 0).length,
    paymentsToday: round(paidToday.reduce((n, tx) => n + tx.amount, 0)),
    paymentsTodayCount: paidToday.length,
    activeToday: new Set(paidToday.map((tx) => tx.patientMrn)).size,
    withOutstanding: rows.filter((row) => row.balances.outstanding > 0).length,
    threshold,
  };
}

// --- writes: the acts that move money -------------------------------------------

/**
 * Post a visit's charges. The engine prices every line through the billing
 * evaluation and hands back the rows; they are appended as one act, the visit
 * is stamped, and an upfront settlement already taken is applied to them
 * immediately — which is the point of taking it upfront.
 */
export function postCharges(encounterNo, lines = [], at = new Date().toISOString()) {
  const encounter = encounters.get(encounterNo);
  if (!encounter) return { error: `No encounter ${encounterNo}`, rows: [] };
  const priced = accountEngine.postCharges(encounter, lines, at);
  if (!priced.rows.length) return { error: priced.error || 'Nothing to post', rows: [] };

  ensure(encounter.patientMrn);
  const rows = ledger.appendBatch(priced.rows,
    `${priced.rows.length} charge${priced.rows.length === 1 ? '' : 's'} posted on ${encounterNo} — ${usd(priced.totals.allowed)} allowed, ${usd(priced.totals.patient)} patient`);

  encounters.markChargesPosted(encounterNo);
  encounters.linkRecord(encounterNo, 'account', encounter.patientMrn);

  const applied = ledger.appendBatch(
    accountEngine.autoApplyUpfront(encounter, encounter.patientMrn, transactions(encounter.patientMrn), at),
    `Upfront settlement applied to ${encounterNo}`);

  touch(encounter.patientMrn);
  return { error: '', rows, applied, totals: priced.totals };
}

/**
 * Take money. A deposit is held against the visit and answers nothing yet; a
 * settlement or a balance payment is allocated to the charges the desk named,
 * or oldest first, and whatever is left over stays as credit.
 */
export function recordPayment({
  mrn, encounterNo = null, amount, purpose = 'Balance payment', method = '', reference = '',
  note = '', selection = null, at = new Date().toISOString(),
} = {}) {
  const value = Number(amount);
  if (!mrn || !Number.isFinite(value) || value <= 0) return { error: 'Enter an amount', tx: null };
  ensure(mrn);

  if (purpose === 'Deposit') {
    const tx = ledger.append({
      at, patientMrn: mrn, encounterNo, type: 'DepositHeld', amount: value, side: 'patient',
      detail: { purpose, method, reference, note, appliedTo: [] },
    });
    const receipt = ledger.issueReceipt(tx.id, at);
    touch(mrn);
    return { error: '', tx, receipt };
  }

  const charges = openCharges(mrn, purpose === 'Settlement' ? encounterNo || '' : '');
  const { allocations, credit } = accountEngine.allocate(value, charges, selection);
  const tx = ledger.append({
    at, patientMrn: mrn, encounterNo, type: 'Payment', amount: value, side: 'patient',
    detail: { purpose, method, reference, note, allocations, credit },
  });
  const receipt = ledger.issueReceipt(tx.id, at);
  touch(mrn);
  return { error: '', tx, receipt, allocations, credit };
}

/** Put a deposit already held against charges. Oldest first unless named. */
export function applyDeposit(depositTxId, selection = null, at = new Date().toISOString()) {
  const deposit = ledger.get(depositTxId);
  if (!deposit) return { error: 'No such deposit', tx: null };
  const held = deposits(deposit.patientMrn).find((d) => d.tx.id === depositTxId);
  if (!held || held.remaining <= 0) return { error: 'This deposit has nothing left to apply', tx: null };

  const charges = openCharges(deposit.patientMrn);
  const { allocations } = accountEngine.allocate(held.remaining, charges, selection);
  if (!allocations.length) return { error: 'No open charge to apply it to', tx: null };

  const amount = allocations.reduce((n, a) => n + a.amount, 0);
  const tx = ledger.append({
    at,
    patientMrn: deposit.patientMrn,
    encounterNo: deposit.encounterNo,
    type: 'DepositApplied',
    amount,
    side: 'patient',
    detail: { sourceTxId: deposit.id, sourceReceiptNo: deposit.detail?.receiptNo || '', appliedTo: allocations },
  });
  touch(deposit.patientMrn);
  return { error: '', tx, allocations };
}

/** Give a deposit back. The role gate is the caller's; the reason is required. */
export function refundDeposit(depositTxId, { reason = '', method = '', reference = '', at = new Date().toISOString() } = {}) {
  const deposit = ledger.get(depositTxId);
  if (!deposit) return { error: 'No such deposit', tx: null };
  if (!reason.trim()) return { error: 'Say why it is being refunded', tx: null };
  const held = deposits(deposit.patientMrn).find((d) => d.tx.id === depositTxId);
  if (!held || held.remaining <= 0) return { error: 'This deposit has nothing left to refund', tx: null };

  const tx = ledger.append({
    at,
    patientMrn: deposit.patientMrn,
    encounterNo: deposit.encounterNo,
    type: 'DepositRefund',
    amount: held.remaining,
    side: 'patient',
    detail: { sourceTxId: deposit.id, sourceReceiptNo: deposit.detail?.receiptNo || '', method, reference },
    reason: reason.trim(),
  });
  const receipt = ledger.issueReceipt(tx.id, at);
  touch(deposit.patientMrn);
  return { error: '', tx, receipt };
}

export function close(mrn, reason = '') {
  const row = ensure(mrn);
  if (row.status === 'Closed') return row;
  if (balances(mrn).outstanding > 0) return row;
  row.status = 'Closed';
  row.updatedAt = new Date().toISOString();
  store.commit('account.close');
  log(mrn, 'Closed', reason || 'Account closed with nothing outstanding');
  return row;
}

export const history = (mrn) => audit.forEntity(ENTITY, mrn);

// --- merge ----------------------------------------------------------------------

/**
 * Money follows the patient when two records are folded together: every ledger
 * row re-points, and the two accounts become one. The survivor's account is
 * whichever was opened first, so its history starts where the money did.
 */
patients.relinkHooks.push({
  label: 'Account transactions',
  count: (mrn) => ledger.byPatient(mrn).length,
  relink: (fromMrn, toMrn) => {
    const moving = ledger.byPatient(fromMrn);
    for (const row of moving) row.patientMrn = toMrn;
    const from = get(fromMrn);
    const to = ensure(toMrn);
    if (from) {
      if (compareDates(from.openedAt, to.openedAt) < 0) to.openedAt = from.openedAt;
      to.flags = [...new Set([...(to.flags || []), ...(from.flags || [])])];
      all().splice(all().indexOf(from), 1);
    }
    if (moving.length) log(toMrn, 'Re-linked', `${moving.length} transactions moved from ${fromMrn}`);
    return moving.length;
  },
});

// --- settlement (amendment 22) ---------------------------------------------------
// Reconciliation is the engine's; what is written here is the answer: a
// Settlement row and the stamp on the visit when a visit settles, the stamp
// coming back off it when a later posting unsettles it, the deposits applied
// at completion, and the consent that resolves an excess without money moving.

export const OUTCOMES = settlementEngine.OUTCOMES;
export const outcomeTone = settlementEngine.outcomeTone;
export const outcomeLabel = settlementEngine.outcomeLabel;

/** The reconciliation of one visit, computed on every call. */
export const reconcile = (encounterNo) => settlementEngine.reconcile(encounterNo);

/**
 * Why a visit cannot be settled now, or ''. Only a visit whose difference is
 * zero — or whose excess the patient has agreed to leave on the account — is
 * settled; a residual is paid or written off first, an excess refunded or
 * consented to.
 */
export function settleBlocker(encounterNo) {
  const r = reconcile(encounterNo);
  if (!r) return `No encounter ${encounterNo}`;
  if (r.outcome === 'Pending') return 'Nothing has been charged on this visit yet';
  if (r.outcome === 'Unsettled') return `${usd(r.difference)} is still owed — take a payment or write it off first`;
  if (r.outcome === 'Excess' && !r.consent) return `${usd(-r.difference)} more than the share was taken — refund it, or record the patient’s consent to hold it as credit`;
  if (r.stamp?.status === 'Settled') return 'This visit is already settled';
  return '';
}

/**
 * settle(no, { manual, at, by }) → { error, row, tx }. The stamp goes on the
 * visit first, then the Settlement row — the row's own append hook reads the
 * stamp and finds nothing left to do. A visit that settled at nothing owed
 * gets the stamp and no row: a settlement of nothing is not a transaction.
 */
export function settle(encounterNo, { manual = false, at = null, by = null } = {}) {
  const enc = encounters.get(encounterNo);
  const blocker = settleBlocker(encounterNo);
  if (blocker) return { error: blocker, row: enc, tx: null };
  const r = reconcile(encounterNo);
  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  const stamp = { status: 'Settled', at: when, by: who, manual, txId: null, consent: enc.settlement?.consent || null, amount: r.actualShare };
  encounters.setSettlement(encounterNo, stamp, { details: `${outcomeLabel(r)} at ${usd(r.actualShare)}${manual ? ' — settled by hand' : ''}` });
  let tx = null;
  if (r.actualShare > 0) {
    tx = ledger.append({
      at: when, by: who, patientMrn: enc.patientMrn, encounterNo, type: 'Settlement', amount: r.actualShare, side: 'patient',
      detail: {
        estimatedShare: r.estimatedShare, actualShare: r.actualShare, paid: r.paid, difference: r.difference,
        reconcilingTxIds: r.reconcilingTxIds, manual, mode: r.mode, consent: r.consent,
      },
    }, { silent: true });
    encounters.setSettlement(encounterNo, { ...stamp, txId: tx.id });
  }
  log(enc.patientMrn, 'Settlement', `${encounterNo} settled at ${usd(r.actualShare)}${manual ? ' by hand' : ''}${r.consent ? ` · ${usd(-r.difference)} held as credit with consent` : ''}`, who, when);
  touch(enc.patientMrn);
  return { error: '', row: encounters.get(encounterNo), tx };
}

/**
 * The trigger behind every row and every closing: re-derive the visit and
 * write what changed. A settled visit that no longer reconciles is reverted
 * (audited); a visit that settles up front and now reconciles is marked on
 * its own. Anything else waits for a hand — Settle now on the panel.
 */
export function syncSettlement(encounterNo, { at = null, by = null } = {}) {
  const r = reconcile(encounterNo);
  const enc = encounters.get(encounterNo);
  if (!r || !enc) return null;
  const stamp = enc.settlement;
  if (stamp?.status === 'Settled' && !r.resolved) {
    const status = r.outcome === 'Excess' ? 'Excess' : 'Unsettled';
    encounters.setSettlement(encounterNo, { ...stamp, status, revertedAt: at || new Date().toISOString(), revertedBy: by || currentRole().name },
      { details: `reverted — ${outcomeLabel(r)} after a later posting` });
    log(enc.patientMrn, 'Settlement', `${encounterNo} back to ${status} — ${outcomeLabel(r)} after a later posting`, by, at);
    return r;
  }
  if (stamp?.status !== 'Settled' && r.resolved && r.chargeCount && (r.runsContinuously || settling.has(encounterNo))) {
    settle(encounterNo, { at, by });
  }
  return r;
}

/** Visits being closed right now: completion settles any mode, not only the continuous one. */
const settling = new Set();

/**
 * At completion: the deposits held on the visit are applied to its open
 * charges oldest first, then the visit is reconciled — Settled when nothing is
 * left, else left Unsettled with the residual for the desk to chase.
 */
export function onClosed(enc) {
  if (!enc?.no) return null;
  const applied = [];
  settling.add(enc.no);
  try {
    for (const d of deposits(enc.patientMrn).filter((x) => x.encounterNo === enc.no && x.remaining > 0)) {
      if (!openCharges(enc.patientMrn, enc.no).length) break;
      const result = applyDeposit(d.tx.id, null);
      if (!result.error) applied.push(result.tx);
    }
    const r = syncSettlement(enc.no);
    return { applied, reconciliation: reconcile(enc.no) || r };
  } finally {
    settling.delete(enc.no);
  }
}

/**
 * The patient agrees to leave an excess on the account rather than take it
 * back. Nothing moves; the consent is recorded on the visit's stamp with who
 * gave it and how, and the visit can then settle.
 */
export function holdAsCredit(encounterNo, { name = '', method = '', at = null, by = null } = {}) {
  const enc = encounters.get(encounterNo);
  const r = reconcile(encounterNo);
  if (!enc || !r) return { error: `No encounter ${encounterNo}` };
  if (r.outcome !== 'Excess') return { error: 'There is no excess on this visit to hold' };
  if (!name.trim() || !method.trim()) return { error: 'Say who consented and how' };
  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  const consent = { name: name.trim(), method: method.trim(), amount: cents(-r.difference), at: when, by: who };
  encounters.setSettlement(encounterNo, { ...(enc.settlement || { at: when, by: who }), status: enc.settlement?.status === 'Settled' ? 'Settled' : 'Excess', consent },
    { details: `Patient consented to hold ${usd(consent.amount)} as credit — ${consent.name}, ${consent.method}` });
  log(enc.patientMrn, 'Consent', `${encounterNo}: patient consented to hold ${usd(consent.amount)} as credit — ${consent.name}, ${consent.method}`, who, when);
  settling.add(encounterNo);
  try { syncSettlement(encounterNo, { at, by }); } finally { settling.delete(encounterNo); }
  touch(enc.patientMrn);
  return { error: '', row: encounters.get(encounterNo) };
}

// --- adjustments and refunds (amendment 22) ----------------------------------------

export const ADJUSTMENT_REASONS = CONFIG.accounts?.adjustmentReasons || ['Other'];
export const REFUND_REASONS = CONFIG.accounts?.refundReasons || ['Other'];

/**
 * adjust({ mrn, chargeTxId, amount, reason, note }) → { error, tx }. Writes an
 * Adjustment against one charge, no more than its remaining patient portion;
 * the row carries the allocation, so the charge's remainder falls with the
 * account's balance. The role gate is the caller's and checked here as well.
 */
export function adjust({ mrn, chargeTxId, amount, reason = '', note = '', at = null, by = null } = {}) {
  if (!currentRole().canAdjust && !by) return { error: 'Adjusting needs a role with the adjustment permission', tx: null };
  const charge = ledger.get(chargeTxId);
  if (!charge || charge.type !== 'Charge' || charge.patientMrn !== mrn) return { error: 'Pick the charge being adjusted', tx: null };
  if (charge.status === 'Reversed') return { error: 'That charge has been reversed already', tx: null };
  const open = openCharges(mrn).find((c) => c.txId === chargeTxId);
  const remaining = open ? open.remaining : 0;
  const value = cents(amount);
  if (!reason.trim()) return { error: 'Pick a reason', tx: null };
  if (!(value > 0)) return { error: 'Enter an amount above zero', tx: null };
  if (value > remaining + 0.005) return { error: `${usd(remaining)} is all that is left on that charge`, tx: null };
  ensure(mrn);
  const tx = ledger.append({
    at: at || new Date().toISOString(), by: by || currentRole().name, patientMrn: mrn, encounterNo: charge.encounterNo,
    type: 'Adjustment', amount: value, side: 'patient',
    detail: { chargeTxId, reason: reason.trim(), note: note.trim(), purpose: 'Adjustment', allocations: [{ chargeTxId, amount: value }] },
    reason: reason.trim(),
  });
  touch(mrn);
  return { error: '', tx };
}

/**
 * refund({ mrn, paymentTxId, amount, reason, method, reference }) → { error,
 * tx, receipt }. Gives back part of a payment's unallocated credit and issues
 * the voucher for it. A deposit is refunded through refundDeposit, which has
 * its own row type; this is for money paid and never needed.
 */
export function refund({ mrn, paymentTxId, amount, reason = '', method = '', reference = '', at = null, by = null } = {}) {
  if (!currentRole().canRefund && !by) return { error: 'Refunding needs a role with the refund permission', tx: null };
  const payment = ledger.get(paymentTxId);
  if (!payment || payment.type !== 'Payment' || payment.patientMrn !== mrn) return { error: 'Pick the payment being refunded', tx: null };
  const available = accountEngine.paymentCredit(transactions(mrn), paymentTxId);
  const value = cents(amount);
  if (!reason.trim()) return { error: 'Pick a reason', tx: null };
  if (!(value > 0)) return { error: 'Enter an amount above zero', tx: null };
  if (value > available + 0.005) return { error: `${usd(available)} of that payment is unallocated and can be refunded`, tx: null };
  const when = at || new Date().toISOString();
  const tx = ledger.append({
    at: when, by: by || currentRole().name, patientMrn: mrn, encounterNo: payment.encounterNo,
    type: 'Refund', amount: value, side: 'patient',
    detail: { sourceTxId: payment.id, sourceReceiptNo: payment.detail?.receiptNo || '', method, reference, purpose: 'Refund' },
    reason: reason.trim(),
  });
  const receipt = ledger.issueReceipt(tx.id, when);
  touch(mrn);
  return { error: '', tx, receipt };
}

/**
 * The cover changed after the charges were posted: every line nothing has
 * answered yet is reversed and reposted under the new classification, as a
 * pair the Transactions tab reads together. A line money has already been
 * put against stays as posted — what was paid was paid for that line — and
 * the pair carries the reason both ways.
 */
export function reclassifyCharges(enc, before) {
  if (!enc?.no) return { reposted: [], kept: 0 };
  const rows = transactions(enc.patientMrn);
  const charges = rows.filter((r) => r.type === 'Charge' && r.encounterNo === enc.no && r.status !== 'Reversed');
  const parents = charges.filter((r) => !r.detail?.isOverage);
  const reason = `Re-classification — ${coverWord(before)} → ${coverWord(enc.financial)}${enc.financial?.reason ? `: ${enc.financial.reason}` : ''}`;
  const at = new Date().toISOString();
  const reposted = [];
  let kept = 0;
  for (const parent of parents) {
    const family = [parent, ...charges.filter((r) => r.detail?.isOverage && r.detail?.parentItemId === parent.detail?.itemId && r.at === parent.at)];
    if (family.some((r) => accountEngine.answeredOn(rows, r.id) > 0)) { kept += 1; continue; }
    for (const r of family) ledger.reverse(r.id, reason);
    const line = { itemId: parent.detail.itemId, qty: parent.detail.qty || 1, consumption: parent.detail.consumption || [] };
    const priced = accountEngine.postCharge(enc, line, at);
    for (const row of priced.rows) {
      row.detail = { ...row.detail, reclassification: { from: coverWord(before), to: coverWord(enc.financial), reason: enc.financial?.reason || '', replaces: parent.id } };
      reposted.push(ledger.append({ ...row, reason }, { silent: true }));
    }
  }
  if (reposted.length) {
    log(enc.patientMrn, 'Charge', `${reposted.length} charge${reposted.length === 1 ? '' : 's'} reposted on ${enc.no} — ${reason}${kept ? ` · ${kept} paid line${kept === 1 ? '' : 's'} kept` : ''}`);
    touch(enc.patientMrn);
  }
  return { reposted, kept };
}

const coverWord = (financial) => (financial?.payerId ? `${financial.payerId} / ${financial.planId || '—'}` : 'Self-Pay');

// --- flags (amendment 22) ---------------------------------------------------------

export const FLAGS = ['OutstandingOverThreshold', 'UnsettledCompleted', 'UnappliedDeposit', 'ExcessToResolve'];

/**
 * The flags one account earns right now, computed from the ledger and the
 * register and never stored anywhere but on the account they describe.
 */
export function computeFlags(mrn) {
  const b = balances(mrn);
  const out = [];
  if (b.outstanding > accountEngine.outstandingThreshold()) out.push('OutstandingOverThreshold');
  const visits = encounters.byPatient(mrn).filter((enc) => enc.chargesPosted && enc.status !== 'Cancelled');
  const recs = visits.map((enc) => [enc, reconcile(enc.no)]);
  if (recs.some(([enc, r]) => settlementEngine.unsettledTooLong(enc, r))) out.push('UnsettledCompleted');
  if (deposits(mrn).some((d) => d.remaining > 0 && (
    !d.encounterNo || !openCharges(mrn, d.encounterNo).length || !encounters.isOpen(encounters.get(d.encounterNo))))) out.push('UnappliedDeposit');
  if (recs.some(([, r]) => r && r.outcome === 'Excess' && !r.consent)) out.push('ExcessToResolve');
  return out;
}

/**
 * Recompute and store one account's flags; a change is one commit. The
 * account's visits are reconciled first, so a row a seed pushed straight into
 * the ledger — which fires no append hook — still moves the stamp and the
 * flags the next time anything reads the account.
 */
export function refreshFlags(mrn) {
  const row = get(mrn);
  if (!row) return [];
  for (const enc of encounters.byPatient(mrn)) {
    if (enc.chargesPosted && enc.status !== 'Cancelled') syncSettlement(enc.no);
  }
  const next = computeFlags(mrn);
  const same = next.length === (row.flags || []).length && next.every((f) => (row.flags || []).includes(f));
  if (same) return next;
  row.flags = next;
  row.updatedAt = new Date().toISOString();
  store.commit('account.flags');
  return next;
}

export function refreshAllFlags() {
  for (const row of all()) refreshFlags(row.mrn);
}

/** The accounts carrying a flag — one kind, or any — as list rows, worst first. Refreshed on the way out. */
export function flagged(kind = '') {
  refreshAllFlags();
  return all().filter((row) => (row.flags || []).length && (!kind || row.flags.includes(kind)))
    .map(view).sort((a, b) => b.balances.outstanding - a.balances.outstanding);
}

// --- wiring ------------------------------------------------------------------------
// Every ledger row recomputes the account it landed on and reconciles the
// visit it landed on; a visit closing applies its deposits and reconciles; a
// re-classification reposts the unanswered lines. The arrows run from the
// ledger and the register into here, never back.

ledger.afterAppendHooks.push((row) => {
  if (row.type !== 'Settlement' && row.encounterNo) syncSettlement(row.encounterNo);
  if (row.patientMrn) refreshFlags(row.patientMrn);
});
encounters.afterCloseHooks.push((enc) => {
  onClosed(enc);
  refreshFlags(enc.patientMrn);
});
encounters.afterReclassifyHooks.push((enc, before) => {
  reclassifyCharges(enc, before);
  syncSettlement(enc.no);
  refreshFlags(enc.patientMrn);
});

/**
 * One sweep on load and after a reset: a visit that settles up front and
 * reconciles is marked, a stale Settled stamp comes off, and every account's
 * flags are what the ledger says. Runs after the derived seeds have built.
 */
export function sweep() {
  for (const enc of encounters.all()) {
    if (enc.chargesPosted && enc.status !== 'Cancelled') syncSettlement(enc.no, { by: 'System' });
  }
  refreshAllFlags();
}
setTimeout(sweep, 0);
store.subscribe((why) => { if (why === 'reset') setTimeout(sweep, 0); });

// --- internals -------------------------------------------------------------------

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

function touch(mrn) {
  const row = get(mrn);
  if (!row) return;
  row.updatedAt = new Date().toISOString();
  store.commit('account.touch');
}

function log(mrn, action, details, user = null, at = null) {
  const row = audit.log({ entity: ENTITY, entityId: mrn, action, details, user: user || currentRole().name });
  if (at) row.at = at;
  return row;
}

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;
