// Denial analytics engine — the one place a Defensio analytics figure is
// computed (amendment 41, F6). Every view of the analytics screen and the
// payer scorecard call this file and do no arithmetic of their own; an
// archived scorecard never calls it at all — it renders the figures frozen
// on its row. Reads denials, claims, expected recoveries, appeal cases,
// root-cause cases, corrective actions, write-offs, remittances, payers and
// encounters, and feature-detects amendment 40's prevention registers by
// dynamic import; read by no repository (the billing engine's position in
// the layering). The definitions themselves — the formula, the date
// boundary, the format — live in data/engines/metric-definitions.js, a
// leaf; this file builds the world those formulas run over and hands back
// the figures with the record ids behind each one, which is what a figure
// element's drill-through carries.
//
// Baked in, not switchable: a Reclassified denial is in no denial rate and
// only in misclassificationRate; recovered is cash-confirmed only — an
// expected recovery in state Recovered, or a denial a remittance posting
// resolved outright (never an appealed denial's paper win while its cash
// is still awaited); nobody is ever named — the governance figures group
// an individual finding by job title and never carry a person id.
//
// Published: getDenialMetrics(payerId?, period) — the definitions-table
// object Pactum's Performance denial columns read from here on.

import * as denials from '../repositories/denials.js';
import * as claims from '../repositories/claims.js';
import * as recoveries from '../repositories/expected-recoveries.js';
import * as appealCases from '../repositories/appeal-cases.js';
import * as tracking from '../repositories/appeal-tracking.js';
import * as rcaCases from '../repositories/rca-cases.js';
import * as correctiveActions from '../repositories/corrective-actions.js';
import * as writeoffs from '../repositories/writeoffs.js';
import * as remittances from '../repositories/remittances.js';
import * as payers from '../repositories/payers.js';
import * as encounters from '../repositories/encounters.js';
import { doctorName } from '../seed/reference.js';
import { staff } from '../seed/staff.js';
import { defaultRootCause } from './denial-router.js';
import { METRICS, METRIC_KEYS, BOUNDARIES, metric, boundariesFor } from './metric-definitions.js';
import { compareDates, iso, todayIso, usd } from '../../shared/format.js';

export { METRICS, METRIC_KEYS, BOUNDARIES, metric, boundariesFor };

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;
const sum = (rows, f) => cents(rows.reduce((n, r) => n + (Number(f(r)) || 0), 0));
const days = (from, to) => Math.round((Date.parse(iso(to) || todayIso()) - Date.parse(iso(from) || todayIso())) / 86400000);
const within = (on, range) => Boolean(on) && compareDates(on, range.from) >= 0 && compareDates(on, range.to) <= 0;

// --- amendment 40, feature-detected ----------------------------------------------------------

const peers = { prevention: null, riskRules: null, patterns: null };
export const peerStatus = () => ({ prevention: Boolean(peers.prevention?.getPreventionSummary), riskRules: Boolean(peers.riskRules), patterns: Boolean(peers.patterns) });
/** Settled once the three prevention registers have been tried; absent ones stay null and their figures read "pending A40". */
export const peersReady = Promise.allSettled([
  import('../repositories/prevention-plans.js').then((m) => { peers.prevention = m; }).catch(() => {}),
  import('../repositories/risk-rules.js').then((m) => { peers.riskRules = m; }).catch(() => {}),
  import('../repositories/denial-patterns.js').then((m) => { peers.patterns = m; }).catch(() => {}),
]);
/** A40's summary, whichever register publishes it, or null. */
function preventionSummary(range) {
  for (const m of [peers.prevention, peers.patterns, peers.riskRules]) {
    if (typeof m?.getPreventionSummary === 'function') { try { return m.getPreventionSummary(range) || null; } catch { return null; } }
  }
  return null;
}
/** A40's risk-rule statistics, by whichever name the register gives them, or null. */
function ruleStats(range) {
  const m = peers.riskRules;
  for (const name of ['getRiskRuleStats', 'ruleStats', 'stats', 'quality']) {
    if (typeof m?.[name] === 'function') { try { return m[name](range) || null; } catch { return null; } }
  }
  return null;
}

// --- periods ----------------------------------------------------------------------------------

export const PERIODS = [
  { key: 'last30', label: 'Last 30 days' },
  { key: 'last90', label: 'Last 90 days' },
  { key: 'MTD', label: 'Month to date' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'QTD', label: 'Quarter to date' },
  { key: 'lastQuarter', label: 'Last quarter' },
  { key: 'YTD', label: 'Year to date' },
];

const pad = (n) => String(n).padStart(2, '0');
const lastDayOf = (y, m) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
const shift = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
const monthLabel = (key) => new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * periodRange(period, on) → { key, kind, label, from, to }. `period` is a
 * key from PERIODS, a month ('2026-08'), or { from, to } already.
 */
export function periodRange(period = 'last30', on = todayIso()) {
  const y = Number(on.slice(0, 4));
  const m = Number(on.slice(5, 7));
  if (period && typeof period === 'object' && period.from) {
    const from = iso(period.from);
    const to = iso(period.to) || on;
    return { key: 'custom', kind: 'custom', label: `${from} → ${to}`, from, to };
  }
  const key = String(period || 'last30');
  if (/^\d{4}-\d{2}$/.test(key)) {
    const [yy, mm] = key.split('-').map(Number);
    return { key, kind: 'month', label: monthLabel(key), from: `${key}-01`, to: lastDayOf(yy, mm) };
  }
  if (key === 'last30' || key === 'last90') { const n = key === 'last30' ? 30 : 90; return { key, kind: 'days', label: PERIODS.find((p) => p.key === key).label, from: shift(on, -(n - 1)), to: on }; }
  if (key === 'MTD') return { key, kind: 'MTD', label: 'Month to date', from: `${on.slice(0, 7)}-01`, to: on };
  if (key === 'lastMonth') { const py = m === 1 ? y - 1 : y; const pm = m === 1 ? 12 : m - 1; const k = `${py}-${pad(pm)}`; return { key, kind: 'month', label: `Last month (${monthLabel(k)})`, from: `${k}-01`, to: lastDayOf(py, pm) }; }
  const q = Math.floor((m - 1) / 3);
  if (key === 'QTD') return { key, kind: 'QTD', label: 'Quarter to date', from: `${y}-${pad(q * 3 + 1)}-01`, to: on };
  if (key === 'lastQuarter') { const py = q === 0 ? y - 1 : y; const pq = q === 0 ? 3 : q - 1; return { key, kind: 'quarter', label: `Last quarter (Q${pq + 1} ${py})`, from: `${py}-${pad(pq * 3 + 1)}-01`, to: lastDayOf(py, pq * 3 + 3) }; }
  return { key: 'YTD', kind: 'YTD', label: 'Year to date', from: `${y}-01-01`, to: on };
}

/** The period before: the previous month for a month, the same span a period back for a to-date one, the same number of days otherwise. */
export function priorRange(range) {
  if (!range) return null;
  const y = Number(range.from.slice(0, 4));
  const m = Number(range.from.slice(5, 7));
  if (range.kind === 'month') { const py = m === 1 ? y - 1 : y; const pm = m === 1 ? 12 : m - 1; return { key: 'prior', kind: 'month', label: monthLabel(`${py}-${pad(pm)}`), from: `${py}-${pad(pm)}-01`, to: lastDayOf(py, pm) }; }
  if (range.kind === 'MTD') { const py = m === 1 ? y - 1 : y; const pm = m === 1 ? 12 : m - 1; const to = `${py}-${pad(pm)}-${pad(Math.min(Number(range.to.slice(8, 10)), Number(lastDayOf(py, pm).slice(8, 10))))}`; return { key: 'prior', kind: 'MTD', label: `${monthLabel(`${py}-${pad(pm)}`)} to the same day`, from: `${py}-${pad(pm)}-01`, to }; }
  if (range.kind === 'quarter' || range.kind === 'QTD') {
    const q = Math.floor((m - 1) / 3); const py = q === 0 ? y - 1 : y; const pq = q === 0 ? 3 : q - 1;
    const from = `${py}-${pad(pq * 3 + 1)}-01`;
    const to = range.kind === 'quarter' ? lastDayOf(py, pq * 3 + 3) : shift(from, days(range.from, range.to));
    return { key: 'prior', kind: range.kind, label: `Q${pq + 1} ${py}${range.kind === 'QTD' ? ' to the same day' : ''}`, from, to };
  }
  if (range.kind === 'YTD') return { key: 'prior', kind: 'YTD', label: `${y - 1} to the same day`, from: `${y - 1}-01-01`, to: `${y - 1}${range.to.slice(4)}` };
  const span = days(range.from, range.to);
  const to = shift(range.from, -1);
  return { key: 'prior', kind: 'days', label: `the ${span + 1} days before`, from: shift(to, -span), to };
}

/** The calendar months a range covers, oldest first. */
export function monthsOf(range) {
  const out = [];
  let d = new Date(`${range.from.slice(0, 7)}-01T00:00:00Z`);
  const end = new Date(`${range.to.slice(0, 7)}-01T00:00:00Z`);
  while (d <= end && out.length < 24) {
    const key = d.toISOString().slice(0, 7);
    out.push({ key, label: d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }) });
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  }
  return out;
}

// --- the world ---------------------------------------------------------------------------------

export const SLICES = [
  { key: 'payer', label: 'Payer' },
  { key: 'department', label: 'Department' },
  { key: 'serviceLine', label: 'Service line' },
  { key: 'doctor', label: 'Doctor' },
  { key: 'encounterType', label: 'Encounter type' },
];

const isReversed = (d) => d.status === 'Reversed';
/** A true denial: separated out as nothing, still a denial to pursue or one that was. */
export const isTrue = (d) => !isReversed(d) && d.status !== 'Reclassified' && d.separation !== 'Contractual' && d.separation !== 'TPA';
export const isReclassified = (d) => !isReversed(d) && (d.status === 'Reclassified' || d.separation === 'Contractual' || d.separation === 'TPA');
const landedOn = (d) => iso(d.createdAt);
const resolvedOn = (d) => iso(d.resolvedAt);

const encounterOf = (claim, d) => { const no = d?.encounterNo || claim?.encounterNo; return no ? encounters.get(no) : null; };

/** The dimension a claim (and the denial on it) falls under for a breakdown: { key, label }. */
export function dimOfClaim(claim, sliceBy, d = null) {
  const enc = encounterOf(claim, d);
  switch (sliceBy) {
    case 'payer': { const id = d?.payerId || claim?.payerId || '—'; return { key: id, label: payers.get(id)?.nameEn || id }; }
    case 'department': { const k = enc?.department || 'Not on a visit'; return { key: k, label: k }; }
    case 'serviceLine': { const k = claim?.serviceGroup || claims.itemOf(claim)?.serviceGroup || '—'; return { key: k, label: k }; }
    case 'doctor': { const k = enc?.doctorId || 'none'; return { key: k, label: k === 'none' ? 'No attending on record' : doctorName(k) }; }
    case 'encounterType': { const k = enc?.type || 'none'; return { key: k, label: k === 'none' ? 'No visit' : encounters.typeLabel(k) }; }
    default: return { key: 'all', label: 'All' };
  }
}
export const dimOf = (d, sliceBy) => dimOfClaim(denials.claimOf(d), sliceBy, d);

const cashOn = (r) => iso(remittances.get(r.remittanceRef)?.payment?.date) || iso(r.updatedAt);
const decidedOn = (c) => iso(c.decidedAt || c.outcome?.decisionDate);
const submittedOn = (c) => iso(c.submittedAt || c.submission?.submittedAt);

/** All the denial records, live — the appeal register asked for first so its seed has settled before a case is read. */
function registers() {
  tracking.tracked();
  return { rows: denials.all().filter((d) => !isReversed(d)), cases: appealCases.all() };
}

/**
 * When the payer answered a claim: the payment date, else the day its first
 * denial landed, else the day it was sent — the generated dataset stamps
 * no answer day on a refusal, and the submission is the nearest date it holds.
 */
function adjudicatedOn(claim, firstDenial) {
  return iso(claim.paidAt) || firstDenial.get(claim.claimNo) || iso(claim.submittedAt) || iso(claim.dateOfService);
}

/**
 * worldFor(range, { payerId, sliceBy, sliceValue }) → what the formulas read
 * for one period and one slice. Built once per call; a breakdown builds one
 * per slice value.
 */
export function worldFor(range, { payerId = '', sliceBy = '', sliceValue = '' } = {}) {
  const { rows, cases } = registers();
  const firstDenial = new Map();
  for (const d of rows) { const on = landedOn(d); if (!firstDenial.has(d.claimNo) || compareDates(on, firstDenial.get(d.claimNo)) < 0) firstDenial.set(d.claimNo, on); }
  const inSlice = (d) => (!payerId || d.payerId === payerId) && (!sliceBy || dimOf(d, sliceBy).key === sliceValue);
  const mine = rows.filter(inSlice);
  const byId = new Map(mine.map((d) => [d.id, d]));
  const trueRows = mine.filter(isTrue);
  const landed = trueRows.filter((d) => within(landedOn(d), range));
  const reclassified = mine.filter(isReclassified).filter((d) => within(landedOn(d), range));
  const adjudicated = claims.all()
    .filter((c) => claims.isAdjudicated(c) && c.status !== 'Void' && (!payerId || c.payerId === payerId) && (!sliceBy || dimOfClaim(c, sliceBy).key === sliceValue))
    .filter((c) => within(adjudicatedOn(c, firstDenial), range))
    .map((c) => ({ id: c.id, claimNo: c.claimNo, payerId: c.payerId, payerShare: c.totals?.payerShare ?? 0 }));
  // Cash-confirmed recoveries, two doors and never both on one denial: an
  // expected recovery the remittance paid (an appeal's conceded share), and
  // a denial a remittance posting resolved outright (a resubmission paid
  // back — `resolution.kind` Remittance, which the register only writes when
  // the cash posted in Claima). An appealed denial whose expected recovery
  // is still awaiting is in neither: a paper win is not cash.
  const withExpected = new Set(recoveries.all().map((r) => r.denialId));
  const recovered = [
    ...recoveries.all()
      .filter((r) => r.state === 'Recovered' && byId.has(r.denialId) && within(cashOn(r), range))
      .map((r) => ({ id: r.id, source: 'appeal', denialId: r.denialId, claimNo: r.claimNo, recoveredAmount: r.recoveredAmount, ref: r.remittanceRef, cashOn: cashOn(r) })),
    ...trueRows
      .filter((d) => d.resolution?.kind === 'Remittance' && d.amounts.recovered > 0 && !withExpected.has(d.id))
      .map((d) => ({ id: d.id, source: 'remittance', denialId: d.id, claimNo: d.claimNo, recoveredAmount: d.amounts.recovered, ref: d.resolution.ref, cashOn: iso(remittances.get(d.resolution.ref)?.payment?.date) || resolvedOn(d) }))
      .filter((r) => within(r.cashOn, range)),
  ];
  const decided = cases
    .filter((c) => c.outcome && tracking.denialIdsOf(c).some((id) => byId.has(id)) && within(decidedOn(c), range))
    .map((c) => ({ ...c, decidedOn: decidedOn(c), submittedOn: submittedOn(c), turnaroundDays: submittedOn(c) ? days(submittedOn(c), decidedOn(c)) : null }));
  const resolved = trueRows.filter((d) => d.resolvedAt && within(resolvedOn(d), range)).map((d) => ({ ...d, resolutionDays: days(landedOn(d), resolvedOn(d)) }));
  const openNow = trueRows.filter((d) => denials.isOpen(d) && compareDates(landedOn(d), range.to) <= 0);
  const posted = writeoffs.all().filter((w) => w.status === 'Posted' && w.posting?.at && within(iso(w.posting.at), range));
  const writtenOff = {
    denialSourced: sum(posted.filter((w) => w.source?.kind === 'Denial' && byId.has(w.source.ref)), (w) => w.amountPosted ?? w.amountRequested),
    appealLoop: sum(posted.filter((w) => w.origin === 'appealLost' && (w.denialIds || []).some((id) => byId.has(id))), (w) => w.amountPosted ?? w.amountRequested),
  };
  return { range, payerId, sliceBy, sliceValue, denials: landed, reclassified, adjudicated, recoveries: recovered, decided, resolved, openNow, writtenOff, prevention: preventionSummary(range) };
}

// --- figures ----------------------------------------------------------------------------------

/** A figure's text, in its own format. */
export function formatValue(format, value) {
  if (value == null || Number.isNaN(value)) return '—';
  if (format === 'pct') return `${(value * 100).toFixed(1)}%`;
  if (format === 'usd') return usd(value);
  if (format === 'days') return `${Number(value).toFixed(value % 1 ? 1 : 0)} d`;
  return String(Math.round(value));
}

/** The delta as text: points for a rate, money for money, days for days. */
export function formatDelta(format, delta) {
  if (delta == null || Number.isNaN(delta)) return '—';
  const sign = delta > 0 ? '+' : '';
  if (format === 'pct') return `${sign}${(delta * 100).toFixed(1)} pts`;
  if (format === 'usd') return `${sign}${usd(delta)}`;
  if (format === 'days') return `${sign}${Number(delta).toFixed(1)} d`;
  return `${sign}${Math.round(delta)}`;
}

/** Up is bad on every metric but these three. */
export const GOOD_WHEN_UP = new Set(['recoveryRate', 'overturnRate', 'firstPassPrevention']);

/** Where a figure's records are read: the worklist that lists them, narrowed as far as its filters go. */
export function drillHref(key, { payerId = '', sliceBy = '', sliceValue = '' } = {}) {
  const payer = payerId || (sliceBy === 'payer' ? sliceValue : '');
  const q = (o) => { const p = Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&'); return p ? `?${p}` : ''; };
  switch (key) {
    case 'recoveryRate': return `#/defensio/denials${q({ payerId: payer, status: 'Recovered' })}`;
    case 'overturnRate': case 'appealTurnaround': return `#/defensio/appeal-tracking${q({ payerId: payer, slice: 'decided' })}`;
    case 'misclassificationRate': return `#/defensio/denials${q({ payerId: payer, status: 'Reclassified' })}`;
    case 'openExposure': return `#/defensio/denials${q({ payerId: payer, slice: 'open', separation: 'True' })}`;
    case 'firstPassPrevention': return '#/defensio/prevention';
    default: return `#/defensio/denials${q({ payerId: payer, separation: 'True' })}`;
  }
}

function runFormulas(keys, world) {
  const out = {};
  for (const key of keys) {
    const def = metric(key);
    if (!def) continue;
    const r = def.formula(world);
    out[key] = {
      key, label: def.label, short: def.short, format: def.format, dateBoundary: def.dateBoundary, hint: def.hint,
      value: r.value, text: formatValue(def.format, r.value), count: r.count, ids: r.ids, detail: r.detail,
      href: drillHref(key, world), pending: r.detail?.pending || null,
    };
  }
  return out;
}

/**
 * compute(metricKeys, { period, compare, sliceBy, payerId }) → { range,
 * prior, boundaries, figures, slices, peers }. `figures` is one entry per
 * key with the value, its text, the record ids behind it and its drill
 * href; with `compare` each carries `prior` and `delta`; with `sliceBy`
 * `slices` is one row per dimension value present in the period, each with
 * its own figures.
 */
export function compute(metricKeys = METRIC_KEYS, { period = 'last30', compare = null, sliceBy = '', payerId = '' } = {}) {
  const keys = metricKeys?.length ? metricKeys : METRIC_KEYS;
  const range = periodRange(period);
  const prior = compare ? priorRange(range) : null;
  const base = worldFor(range, { payerId });
  const figures = runFormulas(keys, base);
  if (prior) {
    const before = runFormulas(keys, worldFor(prior, { payerId }));
    for (const key of keys) {
      const f = figures[key];
      const p = before[key];
      f.prior = { value: p.value, text: p.text, count: p.count };
      f.delta = f.value != null && p.value != null ? cents(f.value - p.value) : null;
      f.deltaText = formatDelta(f.format, f.delta);
      f.improved = f.delta == null ? null : GOOD_WHEN_UP.has(key) ? f.delta > 0 : f.delta < 0;
    }
  }
  let slices = null;
  if (sliceBy) {
    const seen = new Map();
    for (const d of [...base.denials, ...base.reclassified]) { const dim = dimOf(d, sliceBy); if (!seen.has(dim.key)) seen.set(dim.key, dim); }
    slices = [...seen.values()].map((dim) => {
      const w = worldFor(range, { payerId, sliceBy, sliceValue: dim.key });
      return { key: dim.key, label: dim.label, denied: sum(w.denials, (d) => d.amounts.denied), count: w.denials.length, open: sum(w.openNow, (d) => d.amounts.open), figures: runFormulas(keys, w) };
    }).sort((a, b) => b.denied - a.denied || b.count - a.count || a.label.localeCompare(b.label));
  }
  return { range, prior, boundaries: boundariesFor(keys), figures, slices, payerId, sliceBy, peers: peerStatus() };
}

/** getDenialMetrics(payerId?, period) → the definitions-table object — what Pactum's Performance denial columns read. */
export function getDenialMetrics(payerId = '', period = 'last30') {
  const r = compute(METRIC_KEYS, { period, compare: 'prior', payerId });
  return {
    source: 'defensio A41', payerId: payerId || null, range: r.range, prior: r.prior, boundaries: BOUNDARIES,
    metrics: METRIC_KEYS.map((key) => r.figures[key]),
    byKey: r.figures,
  };
}

// --- time series ------------------------------------------------------------------------------

/** trend({ months, to, payerId }) → one row per calendar month: what landed (intake), what was separated out, what cash came (cash), what was lost (decision). */
export function trend({ months = 6, to = todayIso(), payerId = '' } = {}) {
  const end = to.slice(0, 7);
  const [ey, em] = end.split('-').map(Number);
  const start = new Date(Date.UTC(ey, em - months, 1)).toISOString().slice(0, 7);
  return monthsOf({ from: `${start}-01`, to }).map(({ key, label }) => {
    const w = worldFor(periodRange(key), { payerId });
    return {
      key, label,
      deniedCount: w.denials.length, deniedValue: sum(w.denials, (d) => d.amounts.denied),
      reclassifiedCount: w.reclassified.length, reclassifiedValue: sum(w.reclassified, (d) => d.amounts.reclassified || d.amounts.denied),
      recovered: sum(w.recoveries, (r) => r.recoveredAmount), lost: cents(sum(w.resolved, (d) => d.amounts.lost) + sum(w.resolved, (d) => d.amounts.writtenOff)),
      adjudicatedValue: sum(w.adjudicated, (c) => c.payerShare), adjudicatedCount: w.adjudicated.length,
      denialRateValue: w.adjudicated.length ? cents(sum(w.denials, (d) => d.amounts.denied) / Math.max(0.01, sum(w.adjudicated, (c) => c.payerShare))) : null,
    };
  });
}

// --- reasons vs causes -------------------------------------------------------------------------

function grouped(rows, keyOf, labelOf, amountOf = (d) => d.amounts.denied) {
  const total = sum(rows, amountOf);
  const map = new Map();
  for (const d of rows) {
    const key = keyOf(d) || '—';
    const g = map.get(key) || { key, label: labelOf(key, d), count: 0, amount: 0, open: 0, ids: [] };
    g.count += 1; g.amount = cents(g.amount + amountOf(d)); g.open = cents(g.open + (d.amounts.open || 0)); g.ids.push(d.id);
    map.set(key, g);
  }
  return [...map.values()].map((g) => ({ ...g, share: total ? g.amount / total : 0 })).sort((a, b) => b.amount - a.amount || b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * reasonsVsCauses(range, { payerId }) → { reasons[], causes[], divergence[] }:
 * the payer's codes ranked beside the desk's root causes, and the pairs
 * where the two disagree — the desk found a cause the payer's code does
 * not usually come down to.
 */
export function reasonsVsCauses(range, { payerId = '' } = {}) {
  const w = worldFor(range, { payerId });
  const rows = w.denials;
  const reasons = grouped(rows, (d) => d.payerReason?.code || d.code, (k) => denials.denialCodeLabel(k)).map((g) => ({ ...g, href: `#/defensio/denials?code=${encodeURIComponent(g.key)}${payerId ? `&payerId=${payerId}` : ''}` }));
  const causes = grouped(rows, (d) => d.rootCauseId || 'untriaged', (k) => (k === 'untriaged' ? 'Not yet triaged' : denials.rootCauseLabel(k)))
    .map((g) => ({ ...g, group: denials.rootCause(g.key)?.group || 'Untriaged', href: g.key === 'untriaged' ? `#/defensio/denials?status=Untriaged${payerId ? `&payerId=${payerId}` : ''}` : `#/defensio/denials?rootCauseId=${g.key}${payerId ? `&payerId=${payerId}` : ''}` }));
  const pairs = new Map();
  for (const d of rows) {
    if (!d.rootCauseId) continue;
    const expected = defaultRootCause(d);
    if (expected === d.rootCauseId) continue;
    const code = d.payerReason?.code || d.code || '—';
    const key = `${code}|${d.rootCauseId}`;
    const g = pairs.get(key) || { key, code, codeLabel: denials.denialCodeLabel(code), rootCauseId: d.rootCauseId, cause: denials.rootCauseLabel(d.rootCauseId), expectedId: expected, expected: denials.rootCauseLabel(expected), count: 0, amount: 0, ids: [], href: `#/defensio/denials?code=${encodeURIComponent(code)}&rootCauseId=${d.rootCauseId}${payerId ? `&payerId=${payerId}` : ''}` };
    g.count += 1; g.amount = cents(g.amount + d.amounts.denied); g.ids.push(d.id);
    pairs.set(key, g);
  }
  return { range, total: { count: rows.length, amount: sum(rows, (d) => d.amounts.denied), triaged: rows.filter((d) => d.rootCauseId).length }, reasons, causes, divergence: [...pairs.values()].sort((a, b) => b.amount - a.amount) };
}

// --- the appeal funnel -------------------------------------------------------------------------

/**
 * funnel(range, { payerId }) → the stages a denial passes on its way to
 * cash, the leakage between them, wins by ground and by level, turnaround
 * by payer and the shortfall aging.
 */
export function funnel(range, { payerId = '' } = {}) {
  const w = worldFor(range, { payerId });
  const { cases } = registers();
  const mine = (c) => !payerId || c.payerId === payerId;
  const landedIds = new Set(w.denials.map((d) => d.id));
  const appealable = w.denials.filter((d) => d.class === 'Appealable');
  const opened = cases.filter((c) => mine(c) && within(iso(c.createdAt), range));
  const submitted = cases.filter((c) => mine(c) && within(submittedOn(c), range));
  const decided = w.decided;
  const overturned = decided.filter((c) => c.outcome.type !== 'Lost');
  const stage = (label, rows, amountOf, href) => ({ label, count: rows.length, amount: sum(rows, amountOf), ids: rows.map((r) => r.id), href });
  const q = payerId ? `&payerId=${payerId}` : '';
  const stages = [
    stage('True denials landed', w.denials, (d) => d.amounts.denied, `#/defensio/denials?separation=True${q}`),
    stage('Appealable', appealable, (d) => d.amounts.denied, `#/defensio/denials?class=Appealable${q}`),
    stage('Appeal opened', opened, (c) => c.disputedAmount, `#/defensio/appeals?scope=all${q}`),
    stage('Submitted', submitted, (c) => c.disputedAmount, `#/defensio/appeals?scope=submitted${q}`),
    stage('Decided', decided, (c) => c.disputedAmount, `#/defensio/appeal-tracking?slice=decided${q}`),
    stage('Overturned', overturned, (c) => c.outcome.concededTotal, `#/defensio/appeal-tracking?slice=decided${q}`),
    stage('Cash recovered', w.recoveries.filter((r) => r.source === 'appeal'), (r) => r.recoveredAmount, `#/defensio/appeal-tracking?recoveryState=Recovered${q}`),
  ];
  const withCase = (d) => appealCases.byDenial(d.id).length > 0;
  const neverAppealed = appealable.filter((d) => !withCase(d));
  const leakage = {
    appealableNeverAppealed: {
      count: neverAppealed.length, amount: sum(neverAppealed, (d) => d.amounts.denied), ids: neverAppealed.map((d) => d.id),
      open: neverAppealed.filter(denials.isOpen).length, resolved: neverAppealed.filter((d) => !denials.isOpen(d)).length,
      deadlinePassed: neverAppealed.filter((d) => d.status === 'Deadline Passed' || denials.deadline(d).passed).length,
      otherRoute: neverAppealed.filter((d) => d.route && d.route.kind !== 'Appeal').length,
      href: `#/defensio/denials?class=Appealable&appeal=no${q}`,
    },
    openedNotSubmitted: { count: opened.filter((c) => !submittedOn(c) && c.status !== 'Withdrawn').length, withdrawn: opened.filter((c) => c.status === 'Withdrawn').length, href: `#/defensio/appeals?scope=active${q}` },
    decidedNotRecovered: { count: overturned.filter((c) => recoveries.byCase(c.id).some((r) => r.state !== 'Recovered')).length, amount: sum(recoveries.all().filter((r) => overturned.some((c) => c.id === r.appealCaseId) && r.state !== 'Recovered'), (r) => cents(r.concededAmount - r.recoveredAmount)), href: `#/defensio/appeal-tracking?recoveryState=AwaitingRemittance${q}` },
  };
  const winBy = (keyOf, labelOf) => {
    const map = new Map();
    for (const c of decided) {
      const key = keyOf(c) || '—';
      const g = map.get(key) || { key, label: labelOf(key), decided: 0, won: 0, disputed: 0, conceded: 0, ids: [] };
      g.decided += 1; if (c.outcome.type !== 'Lost') g.won += 1; g.disputed = cents(g.disputed + c.disputedAmount); g.conceded = cents(g.conceded + (c.outcome.concededTotal || 0)); g.ids.push(c.id);
      map.set(key, g);
    }
    return [...map.values()].map((g) => ({ ...g, rate: g.decided ? g.won / g.decided : null })).sort((a, b) => b.decided - a.decided || b.conceded - a.conceded);
  };
  const turnaroundByPayer = [...new Set([...decided, ...submitted].map((c) => c.payerId))].map((id) => {
    const rows = decided.filter((c) => c.payerId === id && Number.isFinite(c.turnaroundDays));
    const flight = submitted.filter((c) => c.payerId === id && !c.outcome);
    return { payerId: id, label: payers.get(id)?.nameEn || id, decided: rows.length, avgDays: rows.length ? Math.round(rows.reduce((n, c) => n + c.turnaroundDays, 0) / rows.length) : null, window: tracking.responseWindowDays(id), inFlight: flight.length, overdue: flight.filter((c) => tracking.clockOf(c).overdue).length, href: `#/defensio/appeal-tracking?payerId=${id}` };
  }).sort((a, b) => (b.avgDays || 0) - (a.avgDays || 0));
  const shortfallAging = recoveries.all()
    .filter((r) => (r.state === 'Shortfall' || r.state === 'AwaitingRemittance') && (!payerId || appealCases.get(r.appealCaseId)?.payerId === payerId))
    .map((r) => ({ id: r.id, caseId: r.appealCaseId, denialId: r.denialId, claimNo: r.claimNo, conceded: r.concededAmount, recovered: r.recoveredAmount, gap: cents(r.concededAmount - r.recoveredAmount), state: r.state, days: r.state === 'AwaitingRemittance' ? recoveries.recoveryAge(r) : days(r.agingFrom, r.updatedAt), aging: recoveries.isAging(r), answered: r.shortfall ? (r.shortfall.how === 'accept' ? 'Accepted' : 'Write-off loop') : null, href: `#/defensio/appeal-tracking/${r.appealCaseId}` }))
    .sort((a, b) => b.days - a.days || b.gap - a.gap);
  return {
    range, stages, leakage, winByGround: winBy((c) => c.grounds?.primary, (k) => (k === '—' ? 'No ground recorded' : appealCases.groundLabel(k))), winByLevel: winBy((c) => `L${c.level || 1}`, (k) => `Level ${k.slice(1)}`),
    turnaroundByPayer, shortfallAging, landed: landedIds.size,
  };
}

// --- governance ---------------------------------------------------------------------------------

/**
 * governance(range) → root-cause throughput, the nature split, individual
 * findings by role in failure (never by person), corrective actions by
 * status and type, and amendment 40's plan verdicts, prevented value and
 * rule quality where that register is on disk.
 */
export function governance(range) {
  const cases = rcaCases.all();
  const opened = cases.filter((c) => within(iso(c.openedAt), range));
  const concluded = cases.filter((c) => c.concludedAt && within(iso(c.concludedAt), range));
  const closed = cases.filter((c) => c.closedAt && within(iso(c.closedAt), range));
  const open = cases.filter(rcaCases.isOpen);
  const overdue = open.filter((c) => rcaCases.isOverdue(c));
  const concludeDays = concluded.map((c) => days(c.openedAt, c.concludedAt));
  const natureOf = (c) => c.analysis?.causeNature || 'undetermined';
  const natureSplit = ['systemic', 'individual', 'payerSide', 'undetermined'].map((n) => ({ key: n, label: n === 'undetermined' ? 'Not yet determined' : rcaCases.natureLabel(n), count: cases.filter((c) => natureOf(c) === n).length, concluded: concluded.filter((c) => natureOf(c) === n).length, href: n === 'undetermined' ? '#/defensio/rca?slice=open' : `#/defensio/rca?nature=${n}` }));
  // By role only: the person named on a case is resolved to a job title here
  // and nothing else about them leaves this function — no id, no name. What
  // they did (the analyst's "role in failure") rides along as the failures.
  const roles = new Map();
  for (const c of cases.filter((x) => natureOf(x) === 'individual' && x.causer)) {
    const role = staff(c.causer.personId)?.title || 'Role not recorded';
    const g = roles.get(role) || { role, count: 0, concluded: 0, denied: 0, failures: [] };
    g.count += 1; if (rcaCases.isConcluded(c)) g.concluded += 1; g.denied = cents(g.denied + rcaCases.deniedTotal(c));
    if (c.causer.roleInFailure) g.failures.push(String(c.causer.roleInFailure));
    roles.set(role, g);
  }
  const actions = correctiveActions.all();
  const byStatus = correctiveActions.STATUSES.map((s) => ({ key: s, label: s, count: actions.filter((a) => a.status === s).length, overdue: s === 'Open' ? actions.filter(correctiveActions.isOverdue).length : 0 }));
  const byType = correctiveActions.TYPES.map((t) => ({ key: t, label: correctiveActions.typeLabel(t), count: actions.filter((a) => a.type === t).length, verified: actions.filter((a) => a.type === t && a.status === 'Verified').length })).filter((r) => r.count);
  const prevention = preventionSummary(range);
  const plans = Array.isArray(prevention?.plans) ? prevention.plans : Array.isArray(prevention?.verdicts) ? prevention.verdicts : null;
  const rules = ruleStats(range);
  return {
    range,
    rca: { opened: opened.length, concluded: concluded.length, closed: closed.length, open: open.length, overdue: overdue.length, avgDaysToConclude: concludeDays.length ? Math.round(concludeDays.reduce((a, b) => a + b, 0) / concludeDays.length) : null, target: rcaCases.targetDays(), openedIds: opened.map((c) => c.id), concludedIds: concluded.map((c) => c.id) },
    natureSplit,
    causerByRole: [...roles.values()].sort((a, b) => b.count - a.count || a.role.localeCompare(b.role)),
    actions: { total: actions.length, byStatus, byType, overdue: actions.filter(correctiveActions.isOverdue).length },
    prevention: prevention ? { preventedValue: Number(prevention.preventedValue) || 0, preventedCount: Number(prevention.preventedCount) || 0, estimate: true, plans, raw: prevention } : null,
    rules: rules && typeof rules === 'object' ? rules : null,
    peers: peerStatus(),
  };
}

// --- misclassification --------------------------------------------------------------------------

/** misclassification(range, { payerId }) → the separated-out rows: totals, the contractual / TPA split, by payer, and the monthly trend. */
export function misclassification(range, { payerId = '' } = {}) {
  const w = worldFor(range, { payerId });
  const amountOf = (d) => d.amounts.reclassified || d.amounts.denied;
  const rows = w.reclassified;
  const landed = w.denials.length + rows.length;
  const split = ['Contractual', 'TPA'].map((s) => { const mine = rows.filter((d) => d.separation === s); return { key: s, label: denials.separationLabel(s), count: mine.length, amount: sum(mine, amountOf), ids: mine.map((d) => d.id), href: `#/defensio/denials?separation=${s}${payerId ? `&payerId=${payerId}` : ''}` }; });
  const byPayerMap = new Map();
  for (const d of [...rows, ...w.denials]) {
    const g = byPayerMap.get(d.payerId) || { payerId: d.payerId, label: payers.get(d.payerId)?.nameEn || d.payerId, landed: 0, count: 0, amount: 0, contractual: 0, tpa: 0, ids: [], href: `#/defensio/denials?status=Reclassified&payerId=${d.payerId}` };
    g.landed += 1;
    if (isReclassified(d)) { g.count += 1; g.amount = cents(g.amount + amountOf(d)); g.ids.push(d.id); if (d.separation === 'TPA') g.tpa += 1; else g.contractual += 1; }
    byPayerMap.set(d.payerId, g);
  }
  const byPayer = [...byPayerMap.values()].map((g) => ({ ...g, rate: g.landed ? g.count / g.landed : 0 })).filter((g) => g.count).sort((a, b) => b.amount - a.amount);
  const list = rows.map((d) => ({ id: d.id, payerId: d.payerId, payer: payers.get(d.payerId)?.nameEn || d.payerId, claimNo: d.claimNo, code: d.payerReason?.code || d.code, separation: d.separation, amount: amountOf(d), landedOn: landedOn(d), ref: d.reclassification?.ref || null, note: d.reclassification?.note || '', href: `#/defensio/denials/${d.id}` })).sort((a, b) => b.amount - a.amount);
  return { range, total: { count: rows.length, amount: sum(rows, amountOf), landed, rate: landed ? rows.length / landed : null }, split, byPayer, rows: list, trend: trend({ months: Math.max(3, monthsOf(range).length), to: range.to, payerId }) };
}

// --- the scorecard ------------------------------------------------------------------------------

/**
 * scorecard(payerId, period, { compare }) → the whole document as figures,
 * the shape data/repositories/scorecards.js freezes: the headline metrics
 * against the prior period and every payer, the reasons-and-causes profile
 * with its divergence, the appeal record, the misclassification, the
 * financial summary and a six-month trend. A saved scorecard is rendered
 * from this object alone and never recomputed.
 */
export function scorecard(payerId, period, { compare = true } = {}) {
  const r = compute(METRIC_KEYS, { period, compare: compare ? 'prior' : null, payerId });
  const all = compute(METRIC_KEYS, { period, payerId: '' });
  const range = r.range;
  const w = worldFor(range, { payerId });
  const profile = reasonsVsCauses(range, { payerId });
  const f = funnel(range, { payerId });
  const mis = misclassification(range, { payerId });
  const headline = METRIC_KEYS.map((key) => {
    const fig = r.figures[key];
    return { key, label: fig.label, short: fig.short, format: fig.format, dateBoundary: fig.dateBoundary, value: fig.value, text: fig.text, count: fig.count, prior: fig.prior || null, delta: fig.delta ?? null, deltaText: fig.deltaText || '—', improved: fig.improved ?? null, allPayers: { value: all.figures[key].value, text: all.figures[key].text }, pending: fig.pending };
  });
  const decided = f.stages[4];
  return {
    payerId, payer: payers.get(payerId)?.nameEn || payerId, range, prior: r.prior, generated: todayIso(),
    boundaries: Object.values(BOUNDARIES).map((b) => ({ key: b.key, label: b.label, caption: b.caption })),
    headline,
    profile: { reasons: profile.reasons.slice(0, 8).map(strip), causes: profile.causes.slice(0, 8).map(strip), divergence: profile.divergence.slice(0, 6).map(strip), triaged: profile.total.triaged, count: profile.total.count },
    appeals: {
      opened: f.stages[2].count, submitted: f.stages[3].count, decided: decided.count, overturned: f.stages[5].count, conceded: f.stages[5].amount, recovered: f.stages[6].amount,
      overturnRate: r.figures.overturnRate.value, turnaroundDays: r.figures.appealTurnaround.value, responseWindow: tracking.responseWindowDays(payerId),
      byOutcome: tracking.OUTCOMES.map((o) => ({ key: o, label: tracking.outcomeLabel(o), count: w.decided.filter((c) => c.outcome.type === o).length })),
      neverAppealed: f.leakage.appealableNeverAppealed.count, awaiting: f.shortfallAging.filter((x) => x.state === 'AwaitingRemittance').length, shortfalls: f.shortfallAging.filter((x) => x.state === 'Shortfall').length,
    },
    misclassification: { count: mis.total.count, amount: mis.total.amount, rate: mis.total.rate, contractual: { count: mis.split[0].count, amount: mis.split[0].amount }, tpa: { count: mis.split[1].count, amount: mis.split[1].amount } },
    financial: {
      adjudicatedCount: w.adjudicated.length, adjudicatedValue: sum(w.adjudicated, (c) => c.payerShare),
      deniedCount: w.denials.length, denied: sum(w.denials, (d) => d.amounts.denied), recovered: sum(w.recoveries, (x) => x.recoveredAmount),
      lost: sum(w.resolved, (d) => d.amounts.lost), writtenOff: sum(w.resolved, (d) => d.amounts.writtenOff), reclassified: mis.total.amount, open: sum(w.openNow, (d) => d.amounts.open),
    },
    trend: trend({ months: 6, to: range.to, payerId }),
  };
}

/** A grouped row without its id list — a frozen document keeps the figures, not the drill-through. */
const strip = ({ ids, href, ...rest }) => rest;

/** The one line a screen writes under its figures: which boundary each family is read on. */
export const boundaryCaption = (keys = METRIC_KEYS) => boundariesFor(keys).map((b) => `${b.label}: ${b.caption.toLowerCase()}`).join(' · ');

/** The payers with anything on the register, most denials first — the scorecard form's default is the first. */
export function payersWithDenials() {
  const tally = new Map();
  for (const d of registers().rows) tally.set(d.payerId, (tally.get(d.payerId) || 0) + 1);
  return [...tally.entries()].map(([id, count]) => ({ id, count, label: payers.get(id)?.nameEn || id })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
