// Repository — the patient ledger. Owner: modules/frontis.
//
// Append-only, and the only financial write path in the platform: a charge, a
// payment, a deposit, an adjustment or a refund is a transaction appended here
// and never edited. There is no update and no delete — a mistake is corrected
// by a Reversal row that points at what it reverses, so the trail says what
// happened and then what was done about it, which is what a ledger is for.
//
// Balances are never stored. data/engines/account-engine.js computes them from
// these rows, so a figure on a screen can always be traced back to the
// transactions under it. Nothing here decides what a charge costs either: the
// engine runs the billing evaluation and hands back the rows to append.
//
// The dataset seeds itself on first read (data/seed/ledger.js) rather than
// through data/store.js: it reads the encounter board, the estimates and the
// charge master to exist — the shape data/seed/claims.js already uses.

import { store } from '../store.js';
import * as audit from './audit.js';
import { buildLedger, buildReceipts, buildLedgerTrail } from '../seed/ledger.js';
import { current as currentRole } from '../../shared/roles.js';
import { usd } from '../../shared/format.js';

const TABLE = 'ledger';
const RECEIPTS = 'receipts';

/** The trail is keyed on the account, so one query returns a patient's whole
 *  financial history whatever entity wrote it. */
const ENTITY = 'account';

export const TYPES = [
  'Charge', 'Payment', 'Allocation', 'DepositHeld', 'DepositApplied', 'DepositRefund',
  'Adjustment', 'Refund', 'Reversal',
  // A29 (Claima): a payer's remittance moving part of its share onto the
  // patient — a PR-* adjustment. `detail.payerShare` is negative, and
  // `detail.patientShare` the same amount positive, so the charges never change
  // and only who carries them does; `detail.origin` names the remittance, the
  // claim and the line that did it.
  'PortionShift',
  // Amendment 22: the marker a reconciled visit is closed with — amount is the
  // patient share it settled at, detail names the rows that reconciled — and
  // money given back out of a payment's unallocated credit.
  'Settlement',
];

/** What a payment was taken for. Settlement is the upfront one. */
export const PURPOSES = ['Settlement', 'Deposit', 'Balance payment'];

/** The types that move money onto the account rather than off it. */
export const CREDIT_TYPES = ['Payment', 'DepositHeld'];

/**
 * Functions called with every row the moment it is appended — one call per
 * row, batch or not. What a feature hangs off a posting without this file
 * learning what it is: the account flags recompute on it (amendment 22), the
 * daily transaction report attaches receipts to cash sessions on it (Claima
 * A34). A hook that throws is logged and skipped, so a subscriber can never
 * break a posting.
 */
export const afterAppendHooks = [];

export function all() {
  const rows = store.table(TABLE);
  if (!rows.length) {
    const built = buildLedger();
    rows.push(...built);
    // The receipts are numbered off the built rows and stamped back onto
    // them, so the trail below can name the receipt the money arrived on.
    store.table(RECEIPTS).push(...buildReceipts(built));
    const trail = audit.all();
    for (const entry of buildLedgerTrail(built)) {
      trail.push({ id: store.nextId('audit', 'AU-'), ...entry });
    }
  }
  return rows;
}

export const receipts = () => {
  all();
  return store.table(RECEIPTS);
};

export const get = (id) => all().find((row) => row.id === id) || null;

/** Oldest first — a ledger reads in the order it was written. */
export const byPatient = (mrn) => all().filter((row) => row.patientMrn === mrn).sort(bySeq);

export const byEncounter = (no) => all().filter((row) => row.encounterNo === no).sort(bySeq);

export const byType = (mrn, type) => byPatient(mrn).filter((row) => row.type === type);

const bySeq = (a, b) => a.seq - b.seq;

/** A row a Reversal has already answered is out of every balance. */
export const isLive = (row) => row.status !== 'Reversed';

export const reversalOf = (txId) =>
  all().find((row) => row.type === 'Reversal' && row.reversesTxId === txId) || null;

/** Next in the global sequence. It is the ledger's own order, not a date. */
const nextSeq = () => all().reduce((n, row) => Math.max(n, Number(row.seq) || 0), 0) + 1;

export function nextReceiptNo(year = new Date().getFullYear()) {
  const prefix = `RCP-${year}-`;
  const max = receipts().reduce((n, row) => {
    if (!String(row.receiptNo).startsWith(prefix)) return n;
    const digits = Number(String(row.receiptNo).slice(prefix.length));
    return Number.isFinite(digits) && digits > n ? digits : n;
  }, 0);
  return prefix + String(max + 1).padStart(6, '0');
}

// --- writes -------------------------------------------------------------------

/**
 * The one write. `tx` carries the type, the amount, the side and the detail;
 * this assigns the sequence, the id, the time and who did it, and audits.
 *
 * `silent` skips the trail entry for a row written as part of a batch that
 * logs once for the batch — posting a visit's charges is one act, not eleven.
 */
export function append(tx = {}, { silent = false } = {}) {
  const now = new Date().toISOString();
  const row = {
    id: store.nextId(TABLE, 'LDG-'),
    seq: nextSeq(),
    at: tx.at || now,
    by: tx.by || currentRole().name,
    patientMrn: tx.patientMrn || '',
    encounterNo: tx.encounterNo || null,
    type: tx.type,
    amount: cents(tx.amount),
    side: tx.side || 'patient',
    detail: tx.detail || {},
    reversesTxId: tx.reversesTxId || null,
    reason: tx.reason || null,
    status: 'Posted',
  };
  all().push(row);
  store.commit('ledger.append');
  if (!silent) log(row, describe(row));
  for (const fn of afterAppendHooks) {
    try { fn(row); } catch (err) { console.warn('[ledger] afterAppend hook failed', err); }
  }
  return row;
}

/** Several rows as one act: one commit, one trail entry naming the batch. */
export function appendBatch(txs = [], details = '') {
  const rows = txs.map((tx) => append(tx, { silent: true }));
  const first = rows[0];
  if (first) log(first, details || `${rows.length} transactions posted`);
  return rows;
}

/**
 * The correction. A ledger row is never edited: this marks the row Reversed and
 * appends the opposite row pointing back at it, so both stay readable and the
 * balance is right.
 */
export function reverse(txId, reason = '') {
  const row = get(txId);
  if (!row || !reason || row.status === 'Reversed') return null;
  row.status = 'Reversed';
  const undo = append({
    at: new Date().toISOString(),
    patientMrn: row.patientMrn,
    encounterNo: row.encounterNo,
    type: 'Reversal',
    amount: row.amount,
    side: row.side,
    detail: { ...row.detail, reversedType: row.type },
    reversesTxId: row.id,
    reason,
  }, { silent: true });
  store.commit('ledger.reverse');
  log(row, `Reversed ${row.type} ${usd(row.amount)} — ${reason}`);
  return undo;
}

/** A receipt is the printable face of a payment or a deposit, numbered in order. */
export function issueReceipt(txId, at = null) {
  const tx = get(txId);
  if (!tx) return null;
  const existing = receiptOf(txId);
  if (existing) return existing;
  const row = {
    receiptNo: nextReceiptNo(new Date(at || tx.at).getFullYear()),
    txId,
    at: at || tx.at,
    printedAt: [],
  };
  receipts().push(row);
  tx.detail = { ...tx.detail, receiptNo: row.receiptNo };
  store.commit('ledger.receipt');
  return row;
}

export const receiptOf = (txId) => receipts().find((row) => row.txId === txId) || null;

export const receipt = (no) => receipts().find((row) => row.receiptNo === no) || null;

/** Printing is a fact about a receipt worth keeping: a second copy was handed out. */
export function markPrinted(no) {
  const row = receipt(no);
  if (!row) return null;
  row.printedAt = [...(row.printedAt || []), new Date().toISOString()];
  store.commit('ledger.receipt.print');
  return row;
}

// --- internals ----------------------------------------------------------------

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** What the trail says a row was. The detail decides the words, not the caller. */
export function describe(row) {
  const d = row.detail || {};
  if (row.type === 'Charge') return `${d.description || d.itemId} ×${d.qty || 1} — ${usd(row.amount)}${d.isOverage ? ' (overage)' : ''}`;
  if (row.type === 'Payment') return `${d.purpose || 'Payment'} ${usd(row.amount)} by ${d.method || '—'}${d.receiptNo ? ` · ${d.receiptNo}` : ''}`;
  if (row.type === 'DepositHeld') return `Deposit ${usd(row.amount)} held${d.receiptNo ? ` · ${d.receiptNo}` : ''}`;
  if (row.type === 'DepositApplied') return `Deposit ${usd(row.amount)} applied to charges`;
  if (row.type === 'DepositRefund') return `Deposit ${usd(row.amount)} refunded${row.reason ? ` — ${row.reason}` : ''}`;
  if (row.type === 'Allocation') return `${usd(row.amount)} allocated to charges`;
  if (row.type === 'Reversal') return `Reversed ${d.reversedType || 'transaction'} ${usd(row.amount)}`;
  if (row.type === 'PortionShift') return `${usd(row.amount)} moved to the patient — ${d.adjCode || 'payer adjustment'}${d.origin?.remittanceNo ? ` · ${d.origin.remittanceNo}` : ''}`;
  if (row.type === 'Adjustment') return `${usd(row.amount)} adjusted off the patient share — ${d.reason || row.reason || 'adjustment'}${d.origin?.writeoffId ? ` · ${d.origin.writeoffId}` : ''}`;
  if (row.type === 'Refund') return `Refund ${usd(row.amount)} by ${d.method || '—'}${d.receiptNo ? ` · ${d.receiptNo}` : ''}${row.reason ? ` — ${row.reason}` : ''}`;
  if (row.type === 'Settlement') return `Settled at ${usd(row.amount)}${d.manual ? ' — settled by hand' : ''}`;
  return `${row.type} ${usd(row.amount)}`;
}

function log(row, details) {
  audit.log({ entity: ENTITY, entityId: row.patientMrn, action: row.type, details, user: row.by });
}
