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
import { buildAccounts } from '../seed/accounts.js';
import { current as currentRole } from '../../shared/roles.js';
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

// --- internals -------------------------------------------------------------------

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

function touch(mrn) {
  const row = get(mrn);
  if (!row) return;
  row.updatedAt = new Date().toISOString();
  store.commit('account.touch');
}

function log(mrn, action, details) {
  audit.log({ entity: ENTITY, entityId: mrn, action, details, user: currentRole().name });
}
