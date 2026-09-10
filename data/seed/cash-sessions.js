// Seed — cash sessions (Claima, amendment 34). Builds on first read of an
// empty table rather than through data/store.js: it reads the ledger to know
// which receipts each cashier took today. Written as intents: three sessions
// on the day the demo runs — one closed short and countersigned, one open
// with the morning's receipts on it, one open with nothing yet — and the two
// receipts a new cashier keyed in that the ledger's own seed never took,
// which are what give yesterday's report its documented exception and today's
// its prior-day row.
//
// The two payments are pushed straight into the ledger with the next ids and
// sequence numbers, the way data/seed/ledger.js writes its own — a seed never
// commits — against accounts the ledger seed left owing and untouched, so no
// Frontis story moves: the account simply owes a little less.

import { store } from '../store.js';
import * as audit from '../repositories/audit.js';
import * as accounts from '../repositories/accounts.js';
import * as encounters from '../repositories/encounters.js';
import * as patients from '../repositories/patients.js';
import { allocate } from '../engines/account-engine.js';
import { cashEffect, isCashRow, ledgerDay } from '../engines/dtr-engine.js';
import { ROLES } from '../../shared/roles.js';
import { todayIso, usd } from '../../shared/format.js';

/** The night-desk cashier. Never signs in, so a session she closed can be read beside one the demo closes. */
export const NIGHT_CASHIER = 'Rima Nassar';
const DAY_CASHIER = ROLES.find((r) => r.id === 'nurse').name;
const PHARMACY = ROLES.find((r) => r.id === 'pharmacy').name;
const CMO = ROLES.find((r) => r.id === 'exec').name;

const SEED_TAG = 'A34';

/** The hour, Beirut time, yesterday's report was closed at — the two receipts sit either side of it. */
export const DAY_CLOSE_UTC = 'T15:30:00.000Z';

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;
const hoursAgo = (n) => new Date(Date.now() - n * 3600000).toISOString();

export function daysAgo(n, on = todayIso()) {
  const d = new Date(`${on}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * The two receipts Rima Nassar keyed in, once. Idempotent: a reload that
 * kept the ledger and lost this table finds them by their tag.
 * Returns [yesterdayRow, priorDayRow].
 */
export function ensureNightReceipts(ledger) {
  const rows = ledger.all();
  const today = todayIso();
  const yesterday = daysAgo(1, today);
  const specs = [
    // Taken at the desk yesterday afternoon by a cashier who had not opened a
    // session — the receipt yesterday's report could only close over with a note.
    { tag: `${SEED_TAG}:yesterday`, at: `${yesterday}T13:10:00.000Z`, priorDay: null },
    // Taken by the night desk after yesterday's report was closed and keyed
    // in this morning: the report carries it today, flagged prior-day.
    { tag: `${SEED_TAG}:prior-day`, at: `${yesterday}T16:40:00.000Z`, priorDay: { postedOn: today, originalDate: yesterday } },
  ];
  const out = specs.map((spec) => rows.find((r) => r.detail?.seedTag === spec.tag) || null);
  if (out.every(Boolean)) return out;

  const targets = candidates(rows);
  specs.forEach((spec, i) => {
    if (out[i]) return;
    const mrn = targets.shift();
    if (!mrn) return;
    const charges = accounts.openCharges(mrn);
    const owed = cents(charges.reduce((sum, c) => sum + c.remaining, 0));
    const amount = cents(Math.min(owed, 120));
    if (amount <= 0) return;
    const { allocations, credit } = allocate(amount, charges);
    const row = {
      id: store.nextId('ledger', 'LDG-'),
      seq: rows.reduce((n, r) => Math.max(n, Number(r.seq) || 0), 0) + 1,
      at: spec.at, by: NIGHT_CASHIER, patientMrn: mrn, encounterNo: null,
      type: 'Payment', amount, side: 'patient',
      detail: { purpose: 'Balance payment', method: 'Cash', reference: '', note: 'Keyed in by the night desk', allocations, credit, seedTag: spec.tag },
      reversesTxId: null, reason: null, status: 'Posted',
    };
    if (spec.priorDay) row.priorDay = spec.priorDay;
    rows.push(row);
    const receipt = { receiptNo: ledger.nextReceiptNo(Number(spec.at.slice(0, 4))), txId: row.id, at: row.at, printedAt: [] };
    ledger.receipts().push(receipt);
    row.detail.receiptNo = receipt.receiptNo;
    audit.all().push({
      id: store.nextId('audit', 'AU-'), entity: 'account', entityId: mrn, action: 'Payment',
      details: `Balance payment ${usd(amount)} by Cash · ${receipt.receiptNo}`, user: NIGHT_CASHIER, at: row.at,
    });
    out[i] = row;
  });
  return out;
}

/**
 * Accounts owing something with no money taken yet — nobody's story. Those
 * whose visits are all closed come first; an account with a visit still open
 * is taken only when there are not two of the first kind.
 */
function candidates(rows) {
  const mrns = [...new Set(rows.map((r) => r.patientMrn).filter(Boolean))].sort();
  const untouched = mrns.filter((mrn) => {
    const p = patients.get(mrn);
    if (!p || p.vip) return false;
    const mine = rows.filter((r) => r.patientMrn === mrn);
    if (mine.some((r) => r.type !== 'Charge' && r.type !== 'Allocation')) return false;
    return accounts.balances(mrn).outstanding > 0;
  });
  const closedOnly = (mrn) => ![...new Set(rows.filter((r) => r.patientMrn === mrn).map((r) => r.encounterNo).filter(Boolean))]
    .map((no) => encounters.get(no)).some((e) => e && !['Completed', 'Discharged', 'Cancelled'].includes(e.status));
  return [...untouched.filter(closedOnly), ...untouched.filter((mrn) => !closedOnly(mrn))];
}

/**
 * buildCashSessions({ rows, nextId, ledger }) — fills `rows` (the empty table).
 * Today's receipts attach to their cashier's session by the ledger's own
 * `by`; whatever a cashier with no session took stays loose, which is the
 * deliberate cash-integrity RED the demo fixes.
 */
export function buildCashSessions({ rows, nextId, ledger }) {
  const today = todayIso();
  const [, priorDayRow] = ensureNightReceipts(ledger);
  const year = Number(today.slice(0, 4));
  const trail = audit.all();
  const entry = (session, action, details, at, user) => trail.push({
    id: store.nextId('audit', 'AU-'), entity: 'cashSessions', entityId: session.id, action, details, user, at,
  });
  const blank = (cashier, openedAt) => ({
    id: nextId(year), date: today, cashier, openedAt, closedAt: null, status: 'Open',
    systemTotals: null, declared: null, variance: null, varianceReason: null, countersign: null, txIds: [], receiptNos: [],
  });
  const attach = (session, row, at) => {
    session.txIds.push(row.id);
    if (row.detail?.receiptNo) session.receiptNos.push(row.detail.receiptNo);
    entry(session, 'Receipt attached', `${row.detail?.receiptNo || row.id} · ${usd(cashEffect(row))}${row.priorDay ? ` · taken ${row.priorDay.originalDate}` : ''}`, at, session.cashier);
  };

  // The night desk's handover session: opened first thing, holding the one
  // receipt keyed in from last night, and closed short by exactly that much
  // — the cash is in the night safe — with the CMO's countersignature.
  const night = blank(NIGHT_CASHIER, hoursAgo(4));
  rows.push(night);
  entry(night, 'Opened', `${NIGHT_CASHIER} · ${today}`, night.openedAt, NIGHT_CASHIER);
  if (priorDayRow) attach(night, priorDayRow, hoursAgo(3.8));
  const system = { Cash: priorDayRow ? priorDayRow.amount : 0, Card: 0, Transfer: 0, Cheque: 0 };
  night.systemTotals = system;
  night.declared = { Cash: 0, Card: 0, Transfer: 0, Cheque: 0 };
  night.variance = { Cash: cents(-system.Cash), Card: 0, Transfer: 0, Cheque: 0, total: cents(-system.Cash) };
  night.varianceReason = system.Cash
    ? `Receipt keyed in for money the night desk took on ${daysAgo(1, today)}; the cash is in the night safe, not in this drawer`
    : null;
  night.countersign = Math.abs(night.variance.total) > 50 ? { by: CMO, at: hoursAgo(1.6) } : null;
  night.closedAt = hoursAgo(1.6);
  night.status = 'Closed';
  entry(night, 'Closed', `${usd(system.Cash)} system · ${usd(0)} declared · variance ${usd(night.variance.total)}${
    night.varianceReason ? ` — ${night.varianceReason}` : ''}${night.countersign ? ` · countersigned by ${CMO}` : ''}`, night.closedAt, NIGHT_CASHIER);

  // The day cashier's drawer, open, with the morning's receipts on it.
  const day = blank(DAY_CASHIER, hoursAgo(4.2));
  rows.push(day);
  entry(day, 'Opened', `${DAY_CASHIER} · ${today}`, day.openedAt, DAY_CASHIER);
  for (const row of ledger.all().filter((r) => isCashRow(r) && ledgerDay(r) === today && r.by === DAY_CASHIER && !r.priorDay)) {
    attach(day, row, row.at);
  }

  // The pharmacy counter: opened, nothing taken yet.
  const pharmacy = blank(PHARMACY, hoursAgo(2));
  rows.push(pharmacy);
  entry(pharmacy, 'Opened', `${PHARMACY} · ${today}`, pharmacy.openedAt, PHARMACY);

  return rows;
}
