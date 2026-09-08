// Engine — payer and contract performance. Pure metrics over the claims and
// hand-off repositories: no DOM, no writes, no screen state.
//
// This is the only place a performance definition lives. Both screens read
// their numbers from here, which is why the payer table, the contract cards,
// the service-line footer and the underpayment list reconcile by construction
// rather than by two people agreeing on a formula. `selfCheck()` asserts that
// on load.

import * as claims from '../repositories/claims.js';
import * as contracts from '../repositories/contracts.js';
import * as payers from '../repositories/payers.js';
import * as handoffs from '../repositories/handoffs.js';
import { todayIso } from '../../shared/format.js';

/**
 * The calibration, exported so the score's tooltip can name it rather than
 * repeat it. `ceilings` is where each input reaches its full penalty: a 25%
 * denial rate, 90 days to pay and 20% variance each score zero on their axis.
 */
export const CONFIG = {
  weights: { denialRate: 0.4, daysToPay: 0.3, variancePct: 0.3 },
  ceilings: { denialRate: 0.25, daysToPay: 90, variancePct: 0.2 },
  targets: { daysToPay: 30 },
  // An underpayment worth flagging: more than $25 and more than 5% off.
  flag: { floor: 25, pct: 0.05 },
  // Where the denial-rate bar changes colour.
  denialBands: { good: 0.08, warn: 0.15 },
};

export const PERIODS = ['YTD', 'lastQuarter'];

/** { from, to } for a period name. YTD is 1 January to today. */
export function periodRange(period = 'YTD') {
  const today = todayIso();
  const year = Number(today.slice(0, 4));
  if (period !== 'lastQuarter') return { from: `${year}-01-01`, to: today };
  // The last full calendar quarter — what "vs last quarter" compares against.
  const q = Math.floor((Number(today.slice(5, 7)) - 1) / 3);
  const y = q === 0 ? year - 1 : year;
  const prev = q === 0 ? 3 : q - 1;
  const start = prev * 3 + 1;
  const end = start + 2;
  return { from: `${y}-${pad(start)}-01`, to: lastDayOf(y, end) };
}

// --- the definitions ---------------------------------------------------------

/**
 * Every metric over one set of claims. Each rate says which rows it counts:
 * a Pending claim the payer has not answered counts in no rate but its own.
 */
export function rollup(rows, { handoffRows = [] } = {}) {
  const adjudicated = rows.filter(claims.isAdjudicated);
  const denied = rows.filter((c) => c.status === 'Denied');
  const paid = rows.filter(claims.isPaid);

  const grossBilled = sum(rows, (c) => c.grossBilled);
  const allowedExpected = sum(rows, (c) => c.allowedExpected);
  const allowedPaid = sum(rows, (c) => c.allowedPaid);
  // Underpayment dollars: only where the payer paid less than the contract said.
  const variance = sum(paid, (c) => Math.max(0, c.allowedExpected - c.allowedPaid));
  // Both rates read the claims the payer has answered. A claim still in flight
  // is not evidence about the rate a payer pays, and counting it would report
  // every fast-growing contract as underperforming its own target.
  const adjudicatedBilled = sum(adjudicated, (c) => c.grossBilled);
  const paidExpected = sum(paid, (c) => c.allowedExpected);

  const metrics = {
    claims: rows.length,
    adjudicated: adjudicated.length,
    denied: denied.length,
    pending: rows.filter((c) => c.status === 'Pending').length,
    paidCount: paid.length,
    denialRate: ratio(denied.length, adjudicated.length),
    daysToPay: paid.length ? sum(paid, (c) => days(c.submittedAt, c.paidAt)) / paid.length : 0,
    grossBilled,
    allowedExpected,
    allowedPaid,
    adjudicatedBilled,
    effectiveRate: ratio(sum(adjudicated, (c) => c.allowedPaid), adjudicatedBilled),
    // What the configuration says the contract should yield on those charges.
    targetRate: ratio(sum(adjudicated, (c) => c.allowedExpected), adjudicatedBilled),
    variance,
    // Variance is measurable only where the payer has paid, so its percentage
    // is read against what those same claims were expected to allow.
    variancePct: ratio(variance, paidExpected),
    netRevenue: allowedPaid,
    underpaymentsFlagged: rows.filter(isFlagged).length,
    varianceCaptured: sum(
      rows.filter((c) => handoffRows.some((h) => h.claimId === c.id)),
      (c) => Math.max(0, c.allowedExpected - c.allowedPaid),
    ),
    varianceRecovered: sum(handoffRows.filter((h) => h.status === 'Recovered'), (h) => h.recoveredAmount),
    handoffs: handoffRows.length,
  };
  metrics.score = calibratedScore(metrics);
  return metrics;
}

/** An underpayment worth chasing: past both the floor and the percentage. */
export function isFlagged(claim) {
  if (!claims.isPaid(claim)) return false;
  const gap = claim.allowedExpected - claim.allowedPaid;
  return gap > CONFIG.flag.floor && gap > claim.allowedExpected * CONFIG.flag.pct;
}

/**
 * 100 minus the weighted penalty of the three inputs, each normalised linearly
 * against its ceiling. The weights sum to 1, so the penalty is read as
 * percentage points — a payer at every ceiling scores 0.
 */
export function calibratedScore(m) {
  const { weights: w, ceilings: c } = CONFIG;
  const penalty =
    w.denialRate * norm(m.denialRate, c.denialRate) +
    w.daysToPay * norm(m.daysToPay, c.daysToPay) +
    w.variancePct * norm(m.variancePct, c.variancePct);
  return Math.round(clamp(100 - 100 * penalty, 0, 100));
}

/** The three inputs behind a score, for its tooltip. */
export function scoreInputs(m) {
  const { weights: w, ceilings: c } = CONFIG;
  return [
    { label: 'Denial rate', value: pct(m.denialRate), weight: w.denialRate, ceiling: pct(c.denialRate) },
    { label: 'Days to pay', value: `${Math.round(m.daysToPay)} days`, weight: w.daysToPay, ceiling: `${c.daysToPay} days` },
    { label: 'Variance', value: pct(m.variancePct), weight: w.variancePct, ceiling: pct(c.variancePct) },
  ];
}

// --- rollups -----------------------------------------------------------------

export function payerRollup(payerId, period = 'YTD') {
  const range = periodRange(period);
  return rollup(claims.byPayer(payerId, range), { handoffRows: handoffs.byPayer(payerId) });
}

export function contractRollup(contractId, period = 'YTD') {
  const range = periodRange(period);
  return rollup(claims.byContract(contractId, range), { handoffRows: handoffs.byContract(contractId) });
}

/** One row per tracked payer, with the columns the payer table draws. */
export function allPayers(period = 'YTD') {
  return claims.trackedPayerIds().map((payerId) => {
    const payer = payers.get(payerId);
    const metrics = payerRollup(payerId, period);
    const contractRows = contracts.byPayer(payerId);
    return {
      payerId,
      payer,
      name: payer?.nameEn || payerId,
      code: payer?.licenseNo || '—',
      type: payer?.type || '',
      activeContracts: contractRows.filter((c) => c.status === 'Active').length,
      openContract: openContractFor(payerId, contractRows),
      metrics,
      sparkline: sparkline(payerId),
    };
  });
}

/** Where a payer row opens: its first active contract, else the newest tracked one. */
function openContractFor(payerId, contractRows = contracts.byPayer(payerId)) {
  const tracked = new Set(claims.byPayer(payerId).map((c) => c.contractId));
  return (
    contractRows.find((c) => c.status === 'Active' && tracked.has(c.id)) ||
    contractRows.find((c) => c.status === 'Active') ||
    claims.trackedContracts(payerId)[0] ||
    contractRows[0] ||
    null
  );
}

/** Totals per service line for one contract. They sum to the contract rollup. */
export function serviceLines(contractId, period = 'YTD') {
  const range = periodRange(period);
  const rows = claims.byContract(contractId, range);
  const handoffRows = handoffs.byContract(contractId);
  const groups = [...new Set(rows.map((c) => c.serviceGroup))].sort();
  return groups
    .map((serviceGroup) => ({
      serviceGroup,
      metrics: rollup(rows.filter((c) => c.serviceGroup === serviceGroup), { handoffRows }),
    }))
    .sort((a, b) => b.metrics.grossBilled - a.metrics.grossBilled);
}

/** Charged and paid by calendar month, year to date — the column chart. */
export function monthlyBilled(contractId, period = 'YTD') {
  const { from, to } = periodRange(period);
  const rows = claims.byContract(contractId, { from, to });
  const first = Number(from.slice(5, 7));
  const last = Number(to.slice(5, 7));
  const out = [];
  for (let m = first; m <= last; m += 1) {
    const key = `${from.slice(0, 4)}-${pad(m)}`;
    const mine = rows.filter((c) => c.dateOfService.slice(0, 7) === key);
    out.push({
      month: key,
      label: MONTHS[m - 1],
      grossBilled: sum(mine, (c) => c.grossBilled),
      allowedPaid: sum(mine, (c) => c.allowedPaid),
      claims: mine.length,
    });
  }
  return out;
}

/** Denial reasons ranked with their share of the denials in scope. */
export function denialReasons(scope = {}, period = 'YTD') {
  const rows = claims
    .list({ ...periodRange(period), ...scope })
    .filter((c) => c.status === 'Denied' && c.denialReasonCode);
  const tally = new Map();
  for (const claim of rows) {
    const entry = tally.get(claim.denialReasonCode) || { code: claim.denialReasonCode, count: 0, amount: 0 };
    entry.count += 1;
    entry.amount += claim.allowedExpected;
    tally.set(claim.denialReasonCode, entry);
  }
  return [...tally.values()]
    .map((entry) => ({ ...entry, label: claims.denialLabel(entry.code), share: ratio(entry.count, rows.length) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Monthly denial rate for one payer, year to date — the trend sparkline. */
export function sparkline(payerId) {
  const { from, to } = periodRange('YTD');
  const rows = claims.byPayer(payerId, { from, to });
  const out = [];
  for (let m = 1; m <= Number(to.slice(5, 7)); m += 1) {
    const key = `${from.slice(0, 4)}-${pad(m)}`;
    const mine = rows.filter((c) => c.dateOfService.slice(0, 7) === key && claims.isAdjudicated(c));
    out.push(ratio(mine.filter((c) => c.status === 'Denied').length, mine.length));
  }
  return out;
}

/** The flagged underpayments on one contract, largest first. */
export function underpayments(contractId, period = 'YTD') {
  return claims
    .byContract(contractId, periodRange(period))
    .filter(isFlagged)
    .map((claim) => ({
      claim,
      variance: round2(claim.allowedExpected - claim.allowedPaid),
      handoff: handoffs.forClaim(claim.id),
    }))
    .sort((a, b) => b.variance - a.variance);
}

/** Recovered dollars, for a payer or across every payer. */
export const varianceRecovered = (payerId = '') =>
  sum(
    (payerId ? handoffs.byPayer(payerId) : handoffs.all()).filter((h) => h.status === 'Recovered'),
    (h) => h.recoveredAmount,
  );

/** The headline rail on the payer screen — one object, so the cards reconcile. */
export function globalRollup(period = 'YTD') {
  const rows = allPayers(period);
  const weightedDenial = ratio(
    sum(rows, (r) => r.metrics.denied),
    sum(rows, (r) => r.metrics.adjudicated),
  );
  const paidCount = sum(rows, (r) => r.metrics.paidCount);
  return {
    payersTracked: rows.length,
    claims: sum(rows, (r) => r.metrics.claims),
    denialRate: weightedDenial,
    // Weighted by paid claims, so a payer with six remittances cannot move the
    // platform's average as far as one with three hundred.
    daysToPay: paidCount ? sum(rows, (r) => r.metrics.daysToPay * r.metrics.paidCount) / paidCount : 0,
    varianceRecovered: varianceRecovered(),
    recoveredHandoffs: handoffs.all().filter((h) => h.status === 'Recovered').length,
    underpaymentsFlagged: sum(rows, (r) => r.metrics.underpaymentsFlagged),
    payersWithFlags: rows.filter((r) => r.metrics.underpaymentsFlagged > 0).length,
  };
}

// --- self-check --------------------------------------------------------------

/**
 * The reconciliation the amendment asks for, asserted rather than promised: for
 * every payer, the contract rollups sum to the payer rollup, and for every
 * contract the service lines sum to its totals. Returns { pass, failures }.
 */
export function selfCheck(period = 'YTD') {
  const failures = [];
  const near = (a, b) => Math.abs(a - b) < 0.01;

  for (const payerId of claims.trackedPayerIds()) {
    const payerMetrics = payerRollup(payerId, period);
    const contractIds = [...new Set(claims.byPayer(payerId, periodRange(period)).map((c) => c.contractId))];
    const parts = contractIds.map((id) => contractRollup(id, period));
    for (const key of ['grossBilled', 'allowedPaid', 'variance', 'denied']) {
      const total = parts.reduce((n, m) => n + m[key], 0);
      if (!near(total, payerMetrics[key])) {
        failures.push(`${payerId} ${key}: contracts ${round2(total)} vs payer ${round2(payerMetrics[key])}`);
      }
    }
    for (const contractId of contractIds) {
      const contractMetrics = contractRollup(contractId, period);
      const lines = serviceLines(contractId, period);
      for (const key of ['grossBilled', 'allowedPaid', 'variance', 'denied']) {
        const total = lines.reduce((n, l) => n + l.metrics[key], 0);
        if (!near(total, contractMetrics[key])) {
          failures.push(`${contractId} ${key}: lines ${round2(total)} vs contract ${round2(contractMetrics[key])}`);
        }
      }
    }
  }
  return { pass: failures.length === 0, failures };
}

// --- internals ---------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const sum = (rows, of) => rows.reduce((n, row) => n + (Number(of(row)) || 0), 0);
const ratio = (a, b) => (b ? a / b : 0);
const norm = (value, ceiling) => clamp(value / ceiling, 0, 1);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');
const pct = (n) => `${(n * 100).toFixed(1)}%`;
const days = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
const lastDayOf = (year, month) => new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

// One line on load: the reconciliation stories are the reason this engine
// exists, so a broken one should announce itself before a demo does.
const check = selfCheck();
console[check.pass ? 'info' : 'error'](
  `[performance] self-check ${check.pass ? 'pass' : `FAIL — ${check.failures.join('; ')}`}`,
);
