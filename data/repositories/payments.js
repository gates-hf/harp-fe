// Repository — clearance-side payments. Owner: modules/frontis.
//
// It owns no table any more. Money taken at the desk before the service is a
// transaction on the patient's account like every other movement of money, so
// what is left here is the shape financial clearance already reads it in: the
// same API over rows that live in data/repositories/ledger.js.
//
// The migration is the point. Two registers of receipts for one hospital is one
// register too many — a receipt handed over at the clearance desk and one
// handed over at the cashier have to come out of the same book, and a deposit
// collected before theatre has to be the deposit the account applies to the
// charges afterwards. data/seed/ledger.js folds the seeded rows in, and this
// file writes new ones through the account.
//
// What a collection lands as is the visit's own payment mode, not the word the
// desk used: an admission settles up front, so its money is a Settlement
// payment that answers the charges as they post; everything else is a deposit
// held until somebody applies it.

import * as accounts from './accounts.js';
import * as ledger from './ledger.js';
import * as encounters from './encounters.js';
import { isUpfront } from '../engines/account-engine.js';
import { compareDates, todayIso } from '../../shared/format.js';

/** How money arrives at a Lebanese hospital desk. */
export const METHODS = ['Cash', 'Card', 'Bank transfer', 'Cheque'];

/**
 * What the money is for. Deposit is the only kind clearance asks about;
 * Settlement is the whole patient share taken before the service on a visit
 * type that settles up front.
 */
export const KINDS = ['Deposit', 'Settlement'];

/** The ledger rows that are money taken against a visit before the service. */
const isDeskMoney = (row) => row.encounterNo && row.status !== 'Reversed'
  && (row.type === 'DepositHeld' || (row.type === 'Payment' && row.detail?.purpose === 'Settlement'));

/**
 * One ledger row in the shape clearance reads. It is a view, not a copy:
 * nothing is stored in this shape, so it cannot fall out of step with the
 * transaction under it.
 */
const view = (row) => ({
  id: row.id,
  receiptNo: row.detail?.receiptNo || '',
  encounterNo: row.encounterNo,
  patientMrn: row.patientMrn,
  kind: row.type === 'DepositHeld' ? 'Deposit' : 'Settlement',
  amount: row.amount,
  method: row.detail?.method || '',
  reference: row.detail?.reference || '',
  note: row.detail?.note || '',
  receivedBy: row.by,
  at: row.at,
  // The rows are the account's now. The flag is kept because the shape is.
  migratedToAccount: true,
  txId: row.id,
});

export const all = () => ledger.all().filter(isDeskMoney).map(view);

export const get = (receiptNo) => all().find((row) => row.receiptNo === receiptNo) || null;

/** One encounter's payments, oldest first — the order a receipt list reads in. */
export const byEncounter = (no) =>
  ledger.byEncounter(no).filter(isDeskMoney).map(view);

export const byPatient = (mrn) =>
  ledger.byPatient(mrn).filter(isDeskMoney).map(view).reverse();

/**
 * What has been taken against one visit, net of anything given back — the
 * figure clearance reads. It goes through the account rather than adding the
 * rows up here, so the checklist and the account page cannot disagree.
 */
export const receivedFor = (no) =>
  Math.round((accounts.depositsFor(no) + accounts.settlementFor(no)) * 100) / 100;

/** Everything taken today, whatever it was for — the desk's own running total. */
export const takenOn = (day = todayIso()) =>
  all().filter((row) => String(row.at).slice(0, 10) === day);

/**
 * Next receipt in this year's sequence. It stays exported because it was the
 * one place the sequence was read from; it now reads the ledger's register,
 * which is the single book the whole platform issues out of.
 */
export const nextReceiptNo = (year = new Date().getFullYear()) => ledger.nextReceiptNo(year);

// --- writes -------------------------------------------------------------------

/**
 * Take one payment. The API financial clearance already calls, delegating to
 * the account: the receipt, the allocation, the trail and the balance are all
 * the account's job, and this decides only what the money is called.
 */
export function create(data = {}) {
  const amount = Math.round((Number(data.amount) || 0) * 100) / 100;
  const enc = encounters.get(data.encounterNo);
  if (!enc || amount <= 0) return null;

  const purpose = data.kind === 'Settlement' || isUpfront(enc) ? 'Settlement' : 'Deposit';
  const { error, tx } = accounts.recordPayment({
    mrn: data.patientMrn || enc.patientMrn,
    encounterNo: enc.no,
    amount,
    purpose,
    method: METHODS.includes(data.method) ? data.method : METHODS[0],
    reference: String(data.reference || '').trim(),
    note: String(data.note || '').trim(),
    at: data.at,
  });
  return error || !tx ? null : view(tx);
}

/** Kept for the screens that ask "was this taken on or after X?". */
export const takenOnOrAfter = (row, day) =>
  compareDates(String(row.at).slice(0, 10), day) >= 0;
