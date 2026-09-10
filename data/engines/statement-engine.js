// The statement engine: what a statement of account says, computed once and
// frozen. Pure — no DOM, no writes. It reads the ledger, the register, the
// patients and the accounts' reconciliation, and is read by
// data/repositories/soa.js (which freezes and stores what it returns) and by
// data/seed/soa.js (which freezes two of them at seed time), so there is one
// copy of what a statement contains.
//
// A statement is a partition of the ledger: every row in scope lands in the
// block of the visit it was written on, or in the account block when it was
// written on none, and the totals are the same engine sum over the same rows.
// That is what the reconciliation check at generation asserts — the blocks
// must add up to the balances the account page shows for the same rows — and
// it refuses to freeze a statement that does not.

import * as ledger from '../repositories/ledger.js';
import * as encounters from '../repositories/encounters.js';
import * as patients from '../repositories/patients.js';
import * as accounts from '../repositories/accounts.js';
import * as accountEngine from './account-engine.js';
import { compareDates, iso } from '../../shared/format.js';

export const SCOPES = ['Account', 'Encounters', 'Period'];
export const DETAILS = ['Summary', 'Detailed'];
export const LANGUAGES = ['EN', 'AR'];

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** The rows a statement's parameters select, in ledger order. */
export function rowsInScope(mrn, params = {}) {
  const all = ledger.byPatient(mrn);
  if (params.scope === 'Encounters') {
    const wanted = new Set(params.encounterNos || []);
    return all.filter((row) => wanted.has(row.encounterNo));
  }
  if (params.scope === 'Period') {
    return all.filter((row) => {
      const day = iso(row.at);
      if (params.from && compareDates(day, params.from) < 0) return false;
      if (params.to && compareDates(day, params.to) > 0) return false;
      return true;
    });
  }
  return all;
}

/**
 * buildStatement(mrn, params, { at, by }) → the frozen document, or
 * { error } when the parameters select nothing or the blocks do not add up.
 * params = { scope, encounterNos, from, to, detail, language }.
 */
export function buildStatement(mrn, params = {}, { at = new Date().toISOString(), by = '' } = {}) {
  const patient = patients.get(mrn);
  if (!patient) return { error: `No patient ${mrn}` };
  const rows = rowsInScope(mrn, params);
  if (!rows.length) return { error: 'Nothing on the account falls inside that scope' };

  const nos = [...new Set(rows.map((row) => row.encounterNo).filter(Boolean))];
  const blocks = nos.map((no) => block(no, rows, params));
  const loose = rows.filter((row) => !row.encounterNo);
  const account = loose.length ? { ...accountEngine.balances(loose), rows: loose.length, movements: movements(loose) } : null;
  const totals = accountEngine.balances(rows);
  const check = reconcileBlocks(blocks, account, totals);
  if (!check.ok) return { error: `The statement does not reconcile: ${check.problems.join('; ')}` };

  return {
    mrn,
    params: {
      scope: params.scope || 'Account',
      encounterNos: params.scope === 'Encounters' ? [...(params.encounterNos || [])] : [],
      from: params.scope === 'Period' ? params.from || '' : '',
      to: params.scope === 'Period' ? params.to || '' : '',
      detail: DETAILS.includes(params.detail) ? params.detail : 'Summary',
      language: LANGUAGES.includes(params.language) ? params.language : 'EN',
    },
    generatedAt: at,
    by,
    snapshot: {
      header: {
        name: patient.nameEn,
        nameAr: patient.nameAr || '',
        mrn,
        phone: patient.phone || '',
        openedAt: accounts.get(mrn)?.openedAt || rows[0].at,
        rowCount: rows.length,
        firstAt: rows[0].at,
        lastAt: rows[rows.length - 1].at,
      },
      encounters: blocks,
      account,
      totals: { ...totals, refunds: refundsOf(rows), depositsRefunded: depositRefundsOf(rows) },
      balanceDue: cents(totals.outstanding),
      reconciled: check,
    },
  };
}

/** One visit's block: its figures, its settlement, and its lines when the detail asks for them. */
function block(no, rows, params) {
  const enc = encounters.get(no);
  const mine = rows.filter((row) => row.encounterNo === no);
  const b = accountEngine.encounterBalance(rows, no);
  const r = accounts.reconcile(no);
  const detailed = params.detail === 'Detailed';
  return {
    no,
    type: enc?.type || '—',
    typeLabel: enc ? encounters.typeLabel(enc.type) : '—',
    department: enc?.department || '',
    startAt: enc?.startAt || mine[0]?.at || null,
    endAt: enc?.endAt || null,
    status: enc?.status || '—',
    charges: b.totalCharges,
    payerShare: b.payerShare,
    patientShare: b.patientShare,
    undecided: b.undecided,
    payments: b.paid,
    deposits: b.depositsApplied,
    depositsHeld: b.depositsHeld,
    adjustments: b.adjustments,
    refunds: refundsOf(mine),
    unpaid: b.unpaid,
    settlementStatus: r ? r.outcome : 'Pending',
    settlementLabel: r ? accounts.outcomeLabel(r) : '—',
    settledAt: enc?.settlement?.status === 'Settled' ? enc.settlement.at : null,
    lines: detailed ? mine.filter((row) => row.type === 'Charge').map(lineOf) : undefined,
    movements: detailed ? movements(mine.filter((row) => row.type !== 'Charge')) : undefined,
  };
}

const lineOf = (row) => {
  const d = row.detail || {};
  return {
    txId: row.id,
    at: row.at,
    code: d.chargeCode || '',
    description: d.description || d.itemId || '',
    qty: d.qtyLabel || d.qty || 1,
    allowed: cents(d.allowed ?? row.amount),
    payer: cents(d.payerShare),
    patient: cents(d.patientShare),
    isOverage: Boolean(d.isOverage),
    reversed: row.status === 'Reversed',
  };
};

/** The money rows in words — what a detailed statement prints under the lines. */
const movements = (rows) => rows.map((row) => ({
  txId: row.id,
  at: row.at,
  type: row.type,
  amount: row.amount,
  description: ledger.describe(row),
  reversed: row.status === 'Reversed',
}));

const refundsOf = (rows) => cents(rows.filter((row) => row.type === 'Refund' && row.status !== 'Reversed').reduce((n, row) => n + row.amount, 0));
const depositRefundsOf = (rows) => cents(rows.filter((row) => row.type === 'DepositRefund' && row.status !== 'Reversed').reduce((n, row) => n + row.amount, 0));

/**
 * The check: the blocks and the account block must add up to the engine's
 * balances over the same rows on every figure a statement prints. They are
 * the same sums over a partition of the same rows, so a difference is a bug
 * worth refusing on rather than a rounding to shrug at.
 */
export function reconcileBlocks(blocks, account, totals) {
  const sum = (key) => cents(blocks.reduce((n, b) => n + (Number(b[key]) || 0), 0) + (account ? Number(account[key === 'charges' ? 'totalCharges' : key === 'payments' ? 'paid' : key === 'deposits' ? 'depositsApplied' : key]) || 0 : 0));
  const pairs = [
    ['charges', totals.totalCharges], ['payerShare', totals.payerShare], ['patientShare', totals.patientShare],
    ['payments', totals.paid], ['deposits', totals.depositsApplied], ['adjustments', totals.adjustments],
  ];
  const problems = pairs.filter(([key, whole]) => Math.abs(sum(key) - cents(whole)) >= 0.005)
    .map(([key, whole]) => `${key}: blocks ${sum(key).toFixed(2)} vs account ${cents(whole).toFixed(2)}`);
  const due = cents(blocks.reduce((n, b) => n + b.unpaid, 0) + (account ? account.outstanding : 0));
  if (Math.abs(due - cents(totals.outstanding)) >= 0.005) problems.push(`balance due: blocks ${due.toFixed(2)} vs account ${cents(totals.outstanding).toFixed(2)}`);
  return { ok: problems.length === 0, problems, checkedAt: new Date().toISOString() };
}

/** "Account" / "Encounters ENC-…, ENC-…" / "1 Jan – 10 Sept 2026" — the scope in words. */
export function scopeLabel(params = {}) {
  if (params.scope === 'Encounters') return `Encounter${(params.encounterNos || []).length === 1 ? '' : 's'} ${(params.encounterNos || []).join(', ')}`;
  if (params.scope === 'Period') return `${params.from || '…'} – ${params.to || '…'}`;
  return 'Whole account';
}
