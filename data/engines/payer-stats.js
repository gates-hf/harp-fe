// Engine — payer statistics. Owner: modules/claima (amendment 30). Pure
// reads over the claims, no DOM, no writes.
//
// The definitions Pactum's Performance already owns are called, not copied:
// the claim-level denial rate and submit-to-payment days come out of
// performance-engine.rollup() over the same rows, and `selfCheck()` asserts on
// load that this file's figure for every payer equals Performance's for the
// same scope — the footnote on the payer statistics screen reads the answer.
// What is new here is what Performance never asked: how long a payer takes
// to acknowledge, how much it rejects at the door, how much comes back
// resubmitted, and what is silent or escalated with it right now.

import * as claims from '../repositories/claims.js';
import * as payers from '../repositories/payers.js';
import * as perf from './performance-engine.js';
import * as lifecycle from './claim-events.js';
import { iso } from '../../shared/format.js';

export const PERIODS = perf.PERIODS;
export const periodRange = perf.periodRange;

export const COLUMNS = [
  { key: 'submitted', label: 'Submitted', hint: 'Claims sent to the payer in the period (by date of service)' },
  { key: 'submitToAckDays', label: 'Submit → Ack', unit: 'days', hint: 'Average days from submission to the payer’s acknowledgment, over the claims that carry one' },
  { key: 'submitToPayDays', label: 'Submit → Payment', unit: 'days', hint: 'Average days from submission to the first payment — Performance’s days-to-pay' },
  { key: 'rejectionRate', label: 'Rejection rate', unit: 'pct', hint: 'Rejected at the door ÷ submitted' },
  { key: 'resubmissionRate', label: 'Resubmission rate', unit: 'pct', hint: 'Claims that are a resubmission of an earlier cycle ÷ submitted' },
  { key: 'denialRate', label: 'Denial rate', unit: 'pct', hint: 'Denied ÷ adjudicated — Performance’s own definition' },
  { key: 'silentCount', label: 'Silent now', hint: 'Submitted or Acknowledged claims past the payer’s silence threshold, today' },
  { key: 'silentValue', label: 'Silent value', unit: 'usd', hint: 'Payer share of the silent claims' },
  { key: 'escalated', label: 'Escalated', hint: 'Silent claims past the escalation threshold, today' },
];

/**
 * summary(period) → one row per tracked payer, worst silence first:
 * { payerId, name, type, submitted, acknowledged, submitToAckDays, submitToPayDays,
 *   rejected, rejectionRate, resubmitted, resubmissionRate, denialRate,
 *   silentCount, silentValue, escalated, sparkline, metrics }.
 */
export function summary(period = 'YTD') {
  const range = periodRange(period);
  const index = lifecycle.auditIndex();
  return claims.trackedPayerIds().map((payerId) => {
    const payer = payers.get(payerId);
    const rows = claims.byPayer(payerId, range);
    const metrics = perf.rollup(rows);
    const submitted = rows.filter(wasSubmitted);
    const acks = submitted.map((c) => ackDays(c, index)).filter((d) => d != null);
    const rejected = submitted.filter((c) => c.status === 'Rejected');
    const resubmitted = submitted.filter(isResubmission);
    const silent = lifecycle.silent(payerId);
    return {
      payerId,
      name: payer?.nameEn || payerId,
      type: payer?.type || '',
      submitted: submitted.length,
      acknowledged: acks.length,
      submitToAckDays: acks.length ? acks.reduce((n, d) => n + d, 0) / acks.length : 0,
      submitToPayDays: metrics.daysToPay,
      rejected: rejected.length,
      rejectionRate: ratio(rejected.length, submitted.length),
      resubmitted: resubmitted.length,
      resubmissionRate: ratio(resubmitted.length, submitted.length),
      denialRate: metrics.denialRate,
      silentCount: silent.length,
      silentValue: cents(silent.reduce((n, a) => n + (Number(a.claim.totals?.payerShare) || 0), 0)),
      escalated: silent.filter((a) => a.escalated).length,
      sparkline: perf.sparkline(payerId),
      metrics,
    };
  }).sort((a, b) => b.silentCount - a.silentCount || b.denialRate - a.denialRate || a.name.localeCompare(b.name));
}

/**
 * trend(payerId, months) → the last `months` calendar months, oldest first:
 * [{ key, label, submitted, adjudicated, denied, denialRate, daysToPay, rejected, paid }].
 * Months are by date of service, the axis Performance's own sparkline uses.
 */
export function trend(payerId, months = 6) {
  const keys = lastMonths(months);
  const rows = claims.byPayer(payerId);
  return keys.map(({ key, label }) => {
    const mine = rows.filter((c) => String(c.dateOfService).slice(0, 7) === key);
    const m = perf.rollup(mine);
    return {
      key,
      label,
      submitted: mine.filter(wasSubmitted).length,
      adjudicated: m.adjudicated,
      denied: m.denied,
      denialRate: m.denialRate,
      daysToPay: m.daysToPay,
      paid: m.paidCount,
      rejected: mine.filter((c) => c.status === 'Rejected').length,
    };
  });
}

/** The summary as CSV — what Export to Excel hands the browser. */
export function exportCsv(period = 'YTD') {
  const head = ['Payer', 'Type', ...COLUMNS.map((c) => c.label + (c.unit === 'days' ? ' (days)' : c.unit === 'pct' ? ' (%)' : c.unit === 'usd' ? ' (USD)' : ''))];
  const lines = [head.map(quote).join(',')];
  for (const row of summary(period)) {
    lines.push([row.name, row.type, ...COLUMNS.map((c) => cell(row[c.key], c.unit))].map(quote).join(','));
  }
  return lines.join('\r\n');
}

/**
 * The reconciliation, asserted: for every payer, this file's denial rate and
 * days to pay equal performance-engine's for the same payer and period.
 * Returns { pass, failures }.
 */
export function selfCheck(period = 'YTD') {
  const failures = [];
  for (const row of summary(period)) {
    const theirs = perf.payerRollup(row.payerId, period);
    if (Math.abs(theirs.denialRate - row.denialRate) >= 0.0001) {
      failures.push(`${row.payerId} denial rate: stats ${pct(row.denialRate)} vs performance ${pct(theirs.denialRate)}`);
    }
    if (Math.abs(theirs.daysToPay - row.submitToPayDays) >= 0.01) {
      failures.push(`${row.payerId} days to pay: stats ${row.submitToPayDays.toFixed(1)} vs performance ${theirs.daysToPay.toFixed(1)}`);
    }
  }
  return { pass: failures.length === 0, failures };
}

// --- definitions ------------------------------------------------------------------

/**
 * Ever sent, whatever the status is now: the submission stamp, or a closed
 * cycle — a rejected claim back in draft for a fix was still submitted once.
 */
const wasSubmitted = (c) =>
  Boolean(c.submission?.at || c.submittedAt || (c.cycles || []).length || Number(c.cycle) > 1);

/** A later cycle of an earlier claim — the submission feature's chain. */
const isResubmission = (c) => Boolean(c.previousCycleNo) || (Number(c.cycle) || 1) > 1;

/**
 * Days from submission to acknowledgment, or null where the claim carries no
 * acknowledgment at all. Read the way the timeline reads it — the stamp, the
 * trail, or the SLA that made a seeded claim Acknowledged — so the table and
 * the timeline never disagree about the same claim.
 */
function ackDays(claim, index) {
  const sent = iso(claim.submission?.at || claim.submittedAt);
  if (!sent) return null;
  const ack = lifecycle.byClaim(claim.claimNo, index).find((e) => e.type === 'Acknowledged');
  if (!ack) return null;
  return Math.max(0, Math.round((Date.parse(`${iso(ack.at)}T00:00:00Z`) - Date.parse(`${sent}T00:00:00Z`)) / 86400000));
}

// --- internals --------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function lastMonths(n) {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push({ key: d.toISOString().slice(0, 7), label: MONTHS[d.getUTCMonth()] });
  }
  return out;
}

const ratio = (a, b) => (b ? a / b : 0);
const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pct = (n) => `${((Number(n) || 0) * 100).toFixed(1)}%`;
const quote = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const cell = (v, unit) => (unit === 'pct' ? ((Number(v) || 0) * 100).toFixed(1)
  : unit === 'days' ? (Number(v) || 0).toFixed(1)
    : unit === 'usd' ? (Number(v) || 0).toFixed(2) : String(v ?? ''));

// The reconciliation is the reason the footnote exists, so a broken one should
// announce itself on load, the way Performance's does. The silence figures need
// the peer registers, which load beside this file — the check reads only the
// two rates Performance defines, so it is answered here and now.
const check = selfCheck();
console[check.pass ? 'info' : 'error'](
  `[payer-stats] self-check ${check.pass ? 'pass' : `FAIL — ${check.failures.join('; ')}`}`,
);
