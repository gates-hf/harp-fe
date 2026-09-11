// Engine — prevention-plan effectiveness (amendment 40, Defensio F5). A
// leaf: it imports nothing from data/ and works over rows handed in, so
// data/repositories/prevention-plans.js can wrap it without a cycle.
//
// A plan freezes a baseline the day it is activated — how many denials its
// targets drew in the window before, and what they were worth — and is
// measured over the same length of window from the day measurement starts.
// The verdict compares the measured value with the baseline's: at or below
// `effectiveBelowPct` of change (−50% by default) is Effective, anything
// below zero is Partial, anything else Ineffective. What the plan is
// credited with preventing is the baseline value less the measured value,
// never below zero, and it is an estimate: the register never learns what
// would have been denied, so the figure carries the label and is written to
// no ledger.
//
// fact = { id, landedAt (ISO date), denied } — the repository resolves them.

export const DEFAULTS = { windowDays: 90, effectiveBelowPct: -50 };
export const VERDICTS = ['Effective', 'Partial', 'Ineffective'];
export const ESTIMATE_LABEL = 'estimate';

export const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** The window a measurement runs over: from the day it starts, `windowDays` long. */
export function windowOf(startedAt, windowDays = DEFAULTS.windowDays) {
  const from = String(startedAt || '').slice(0, 10);
  return { from, to: daysAfter(from, Number(windowDays) || DEFAULTS.windowDays), days: Number(windowDays) || DEFAULTS.windowDays };
}

export function isPastWindow(startedAt, windowDays, on) {
  const today = on || new Date().toISOString().slice(0, 10);
  return Boolean(startedAt) && windowOf(startedAt, windowDays).to <= today;
}

/** Whole days left in the window, negative once it has passed. */
export function daysLeft(startedAt, windowDays, on) {
  const today = on || new Date().toISOString().slice(0, 10);
  return daysBetween(today, windowOf(startedAt, windowDays).to);
}

/** Count and denied value over a set of facts. */
export function summarize(facts = []) {
  return { count: facts.length, value: cents(facts.reduce((n, f) => n + (Number(f.denied) || 0), 0)) };
}

/** The facts that landed inside [from, to], both ends inclusive. */
export const between = (facts = [], from, to) => facts.filter((f) => f.landedAt && (!from || f.landedAt >= from) && (!to || f.landedAt <= to));

/** baselineOf(facts, on, windowDays) → the frozen figure: what the targets drew in the window ending `on`. */
export function baselineOf(facts = [], on, windowDays = DEFAULTS.windowDays) {
  const today = on || new Date().toISOString().slice(0, 10);
  const days = Number(windowDays) || DEFAULTS.windowDays;
  const from = daysAfter(today, -days);
  const rows = between(facts, from, today);
  return { ...summarize(rows), computedAt: today, windowDays: days, from, to: today, denialIds: rows.map((f) => f.id) };
}

/** Percentage change of `now` against `was`; +100 when there was nothing before and something now. */
export function deltaPct(was, now) {
  if (!(was > 0)) return now > 0 ? 100 : 0;
  return Math.round(((now - was) / was) * 1000) / 10;
}

export function verdictOf(pct, effectiveBelowPct = DEFAULTS.effectiveBelowPct) {
  if (pct <= Number(effectiveBelowPct)) return 'Effective';
  if (pct < 0) return 'Partial';
  return 'Ineffective';
}

/** What the plan is credited with: the baseline's value less the measured, never negative — an estimate, labelled as one. */
export function preventedEstimate(baseline, measured) {
  return {
    value: cents(Math.max(0, (Number(baseline?.value) || 0) - (Number(measured?.value) || 0))),
    count: Math.max(0, (Number(baseline?.count) || 0) - (Number(measured?.count) || 0)),
    label: ESTIMATE_LABEL,
  };
}

/**
 * measure({ baseline, facts, from, to, on, effectiveBelowPct }) → the
 * result: what the targets drew between `from` and `to` (capped at `on`
 * while the window is still running), the change against the baseline on
 * value and on count, the verdict and the prevented estimate.
 */
export function measure({ baseline, facts = [], from, to, on, effectiveBelowPct = DEFAULTS.effectiveBelowPct } = {}) {
  const today = on || new Date().toISOString().slice(0, 10);
  const until = to && to < today ? to : today;
  const rows = between(facts, from, until);
  const measured = summarize(rows);
  const pct = deltaPct(baseline?.value || 0, measured.value);
  const countPct = deltaPct(baseline?.count || 0, measured.count);
  return {
    ...measured,
    from,
    to: until,
    complete: Boolean(to) && to <= today,
    deltaPct: pct,
    deltaCountPct: countPct,
    verdict: verdictOf(pct, effectiveBelowPct),
    prevented: preventedEstimate(baseline, measured),
    denialIds: rows.map((f) => f.id),
    computedAt: today,
  };
}

export const daysBetween = (a, b) => Math.round((Date.parse(String(b).slice(0, 10)) - Date.parse(String(a).slice(0, 10))) / 86400000);

export function daysAfter(isoDate, n) {
  const d = new Date(`${String(isoDate || '').slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
