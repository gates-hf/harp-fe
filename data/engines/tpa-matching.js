// TPA fee matching engine (amendment 42, Defensio F7). A leaf: it reads the
// config and nothing in data/, so the accrual repository can import it
// without a cycle. Pure — no DOM, no writes — over rows handed in.
//
// A third-party administrator withholds its fee from the remittance it
// passes on. Claima posts that withholding as a denied line, the desk
// separates the denial as a TPA fee, and the separation lands here as an
// accrual: what the administrator actually took (`actual`) against what its
// fee schedule says it may take (`expected`). The expected fee is always read
// from the schedule version in force on the remittance date — never the
// current one — with the most specific scope winning (a service-group rate
// over the schedule's base rate) and the caps applied. Inside the tolerance
// the accrual is Matched; past it Overcharged or Undercharged; with no
// version covering the date, Unscheduled.
//
// The ledger every accrual holds, asserted by the repository's selfCheck():
//
//   actual = agreed + recovered + writtenOff + openDisputed + openUndisputed
//          + unscheduled + amendmentNet
//
// where `agreed` is the part both sides accept (the expected fee, or the
// whole actual when it is inside tolerance or under what the schedule
// allows), the overcharge is split by what the dispute on it has done, an
// Unscheduled fee is its own bucket until a schedule covers it, and a
// restated accrual carries the difference between what was agreed before
// the amendment and after as `amendmentNet` — the correction the amendment
// posted — with its overcharge frozen at the pre-amendment figure, so the
// snapshot and the dispute raised on it stay true.

import { CONFIG } from '../../shared/config.js';
import { iso } from '../../shared/format.js';

export const BASES = ['pctPaid', 'pctBilled', 'flatClaim', 'flatRemit'];
export const BASIS_LABELS = {
  pctPaid: '% of paid', pctBilled: '% of billed', flatClaim: 'Flat per claim', flatRemit: 'Flat per remittance',
};
export const SCOPE_LEVELS = ['all', 'serviceGroup'];
export const MATCH_STATES = ['Matched', 'Overcharged', 'Undercharged', 'Unscheduled'];
export const OVERLAY_STATES = ['Disputed', 'Settled', 'Amended'];
export const STATES = ['Accrued', ...MATCH_STATES, ...OVERLAY_STATES];

export const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;
const cfg = () => CONFIG.defensio?.tpa || {};

export const basisLabel = (basis) => BASIS_LABELS[basis] || basis || '—';
export const isPct = (basis) => basis === 'pctPaid' || basis === 'pctBilled';

/** max(pct × expected, floor) — the amendment's max(1%, $5). */
export function tolerance(expected) {
  const t = cfg().tolerance || { pct: 0.01, floor: 5 };
  return cents(Math.max((Number(t.pct) || 0) * (Number(expected) || 0), Number(t.floor) || 0));
}

/** Whether a version's term covers a date; an open-ended `effectiveTo` runs on. */
export function covers(version, date) {
  const on = iso(date);
  if (!on || !version) return false;
  if (version.effectiveFrom && on < iso(version.effectiveFrom)) return false;
  if (version.effectiveTo && on > iso(version.effectiveTo)) return false;
  return true;
}

/**
 * The version in force on a date: a posted retrospective restatement first
 * (the newest posted one when several restate the same day), then the
 * standing version. A retrospective version not yet posted is invisible —
 * an amendment in draft restates nothing. Null when nothing covers the date.
 */
export function versionAt(versions = [], date) {
  const hits = versions.filter((v) => covers(v, date));
  const restated = hits.filter((v) => v.retrospective && v.posted).sort((a, b) => String(b.postedAt || '').localeCompare(String(a.postedAt || '')));
  if (restated.length) return restated[0];
  return hits.find((v) => !v.retrospective) || null;
}

/** The most specific scope for a service group: its own row when the version names one, else the base rate. */
export function scopeFor(version, serviceGroup) {
  const rows = version?.scopes || [];
  const narrow = serviceGroup ? rows.find((s) => s.level === 'serviceGroup' && s.ref === serviceGroup && s.rate != null) : null;
  if (narrow) return { level: 'serviceGroup', ref: serviceGroup, rate: Number(narrow.rate) };
  const base = rows.find((s) => s.level === 'all' && s.rate != null);
  return { level: 'all', ref: null, rate: Number(base ? base.rate : version?.rate) || 0 };
}

/**
 * expectedFor(version, { paid, billed, serviceGroup, remitIndex, periodUsed })
 * → { amount, rate, scope, basis, capped } or null with no version. The
 * basis picks what the rate is read against; a flat-per-remittance fee is
 * owed once, on the first accrual of that remittance (remitIndex 0). The
 * per-claim cap trims the fee, the per-period cap what is left of the
 * period's allowance after `periodUsed`.
 */
export function expectedFor(version, { paid = 0, billed = 0, serviceGroup = null, remitIndex = 0, periodUsed = 0 } = {}) {
  if (!version) return null;
  const scope = scopeFor(version, serviceGroup);
  let amount;
  if (version.basis === 'pctPaid') amount = (Number(paid) || 0) * scope.rate / 100;
  else if (version.basis === 'pctBilled') amount = (Number(billed) || 0) * scope.rate / 100;
  else if (version.basis === 'flatClaim') amount = scope.rate;
  else if (version.basis === 'flatRemit') amount = remitIndex === 0 ? scope.rate : 0;
  else amount = 0;
  amount = cents(Math.max(0, amount));
  let capped = null;
  if (version.capPerClaim != null && amount > Number(version.capPerClaim)) { amount = cents(version.capPerClaim); capped = 'claim'; }
  if (version.capPerPeriod != null) {
    const left = cents(Math.max(0, Number(version.capPerPeriod) - (Number(periodUsed) || 0)));
    if (amount > left) { amount = left; capped = 'period'; }
  }
  return { amount, rate: scope.rate, scope: scope.level === 'all' ? 'all' : scope.ref, basis: version.basis, capped, versionRef: version.ref };
}

/** Matched inside tolerance, Overcharged above it, Undercharged below, Unscheduled with no expected. */
export function stateOf(actual, expected) {
  if (expected == null) return 'Unscheduled';
  const diff = cents(actual - expected.amount);
  const tol = tolerance(expected.amount);
  if (Math.abs(diff) <= tol) return 'Matched';
  return diff > 0 ? 'Overcharged' : 'Undercharged';
}

/**
 * match(actual, version, ctx) → { expected, variance, tolerance, matchState }
 * — one accrual against one version. `variance` is actual − expected
 * (positive: the administrator took more than the schedule allows).
 */
export function match(actual, version, ctx = {}) {
  const expected = expectedFor(version, ctx);
  const variance = expected ? cents(actual - expected.amount) : cents(actual);
  return { expected, variance, tolerance: expected ? tolerance(expected.amount) : 0, matchState: stateOf(actual, expected) };
}

/** What both sides agree on under a match: the expected fee on an overcharge, the whole actual otherwise, nothing when unscheduled. */
export function agreedOf(actual, expected, matchState) {
  if (matchState === 'Unscheduled' || !expected) return 0;
  if (matchState === 'Overcharged') return cents(expected.amount);
  return cents(actual);
}

/**
 * bucketsOf(row) → the ledger line of one accrual: { actual, agreed,
 * overcharge, recovered, writtenOff, openDisputed, openUndisputed,
 * unscheduled, amendmentNet, holds }. The row carries its dispute's answer
 * (`dispute { status, recovered, writtenOff }`) and its amendment's snapshot
 * (`preAmendmentSnapshot { agreed }`), so no other register is read.
 */
export function bucketsOf(row) {
  const actual = cents(row?.actual?.amount ?? row?.amount ?? 0);
  const state = row?.matchState || 'Unscheduled';
  const amended = row?.state === 'Amended' && row.preAmendmentSnapshot;
  let agreed = agreedOf(actual, row?.expected, state);
  let unscheduled = state === 'Unscheduled' ? actual : 0;
  let overcharge = state === 'Overcharged' ? cents(actual - agreed) : 0;
  let amendmentNet = 0;
  if (amended) {
    // Frozen at the snapshot: what was agreed then, and the overcharge the dispute (if any) was raised on.
    const agreedOld = cents(row.preAmendmentSnapshot.agreed ?? 0);
    overcharge = cents(row.preAmendmentSnapshot.overcharge ?? 0);
    unscheduled = 0;
    amendmentNet = cents(agreedOld - agreed);
  }
  const d = row?.dispute || null;
  let recovered = 0;
  let writtenOff = 0;
  let openDisputed = 0;
  let openUndisputed = 0;
  if (overcharge > 0) {
    if (!d) openUndisputed = overcharge;
    else if (d.status === 'Settled') {
      recovered = cents(Math.min(overcharge, d.recovered || 0));
      writtenOff = cents(Math.min(overcharge - recovered, d.writtenOff || 0));
      openDisputed = cents(overcharge - recovered - writtenOff);
    } else if (d.status === 'WrittenOff') writtenOff = overcharge;
    else openDisputed = overcharge;
  }
  const sum = cents(agreed + recovered + writtenOff + openDisputed + openUndisputed + unscheduled + amendmentNet);
  return { actual, agreed, overcharge, recovered, writtenOff, openDisputed, openUndisputed, unscheduled, amendmentNet, holds: Math.abs(sum - actual) < 0.005 };
}

/** ledgerOf(rows) → the register's totals over bucketsOf, with the rows that fail the identity. */
export function ledgerOf(rows = []) {
  const keys = ['actual', 'agreed', 'overcharge', 'recovered', 'writtenOff', 'openDisputed', 'openUndisputed', 'unscheduled', 'amendmentNet'];
  const out = Object.fromEntries(keys.map((k) => [k, 0]));
  const problems = [];
  for (const row of rows) {
    const b = bucketsOf(row);
    for (const k of keys) out[k] = cents(out[k] + b[k]);
    if (!b.holds) problems.push(`${row.id}: ${b.actual} ≠ ${b.agreed} + ${b.recovered} + ${b.writtenOff} + ${b.openDisputed} + ${b.openUndisputed} + ${b.unscheduled} ± ${b.amendmentNet}`);
  }
  out.expected = cents(rows.reduce((n, r) => n + (r.expected?.amount || 0), 0));
  out.count = rows.length;
  out.holds = !problems.length;
  out.problems = problems;
  return out;
}

/**
 * The standing version a candidate's term overlaps, or null. Retrospective
 * versions restate a period and are allowed to sit on top of the one they
 * supersede; two standing versions never share a day.
 */
export function overlapOf(versions = [], candidate, { excludeRef = null } = {}) {
  const from = iso(candidate?.effectiveFrom);
  const to = iso(candidate?.effectiveTo);
  return versions.find((v) => {
    if (v.retrospective || v.ref === excludeRef) return false;
    const vFrom = iso(v.effectiveFrom);
    const vTo = iso(v.effectiveTo);
    const startsAfter = vTo && from && from > vTo;
    const endsBefore = to && vFrom && to < vFrom;
    return !(startsAfter || endsBefore);
  }) || null;
}

/** "3% of paid · Lab 2% · cap $30/claim" — one line for a version. */
export function describeVersion(version, usd = (n) => `$${cents(n)}`) {
  if (!version) return '—';
  const base = scopeFor(version, null).rate;
  const parts = [isPct(version.basis) ? `${base}% ${version.basis === 'pctPaid' ? 'of paid' : 'of billed'}` : `${usd(base)} ${version.basis === 'flatClaim' ? 'per claim' : 'per remittance'}`];
  for (const s of (version.scopes || []).filter((x) => x.level === 'serviceGroup' && x.rate != null)) {
    parts.push(`${s.ref} ${isPct(version.basis) ? `${s.rate}%` : usd(s.rate)}`);
  }
  if (version.capPerClaim != null) parts.push(`cap ${usd(version.capPerClaim)}/claim`);
  if (version.capPerPeriod != null) parts.push(`cap ${usd(version.capPerPeriod)}/${cfg().periodCap || 'month'}`);
  return parts.join(' · ');
}

/** The period key a per-period cap counts over — the remittance date's month. */
export const periodKeyOf = (date) => iso(date).slice(0, 7);
