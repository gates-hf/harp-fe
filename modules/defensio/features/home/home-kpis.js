// The six numbers at the top of the Defensio dashboard. Each is the return of
// a helper the owning feature published in COORDINATION.md and links to the
// screen holding the rows it counted — the headline and the row count under
// the link are the same query, which home-reconcile.js asserts on every draw.
//
// Nothing here computes a rule of its own. The thresholds a card paints by
// are the owners' config values read through their helpers (the 7-day
// filing band, the 5-day response warning, the 45-day recovery aging mark),
// never literals; the win rate is amendment 41's overturn rate over the
// month, read and never recomputed. Every helper is feature-detected — a
// function that is not on the register renders its card as "Pending" rather
// than a number nobody produced.

import * as denials from '../../../../data/repositories/denials.js';
import * as tracking from '../../../../data/repositories/appeal-tracking.js';
import * as analytics from '../../../../data/engines/denial-analytics.js';
import * as accruals from '../../../../data/repositories/tpa-fee-accruals.js';
import * as denialPatterns from '../../../../data/repositories/denial-patterns.js';
import * as riskRules from '../../../../data/repositories/risk-rules.js';
import * as rcaCases from '../../../../data/repositories/rca-cases.js';
import * as preventionPlans from '../../../../data/repositories/prevention-plans.js';
import { CONFIG } from '../../../../shared/config.js';
import { metricCardHtml, metricRailHtml } from '../../../../shared/metric-card.js';
import { usd } from '../../../../shared/format.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const has = (mod, name) => typeof mod?.[name] === 'function';

/** The card a helper that is not on disk yet gets: a word, not a number. */
const pending = (id, label, owner) => ({
  id, value: 'Pending', text: true, label, sub: `${owner} not on this tree`,
  title: `${owner}'s helper is not published on this tree yet; the card reads it the moment it is`,
});

/** The filing band the denial worklist paints by — amendment 36's own config. */
export const filingWarnDays = () => Number(CONFIG.claima?.denials?.deadlineWarnDays) || 7;

/** Every register the cards read has settled its first-read seed. */
export const whenSettled = () => Promise.allSettled([
  denials.seedReady, tracking.seedReady, rcaCases.seedReady, denialPatterns.seedReady,
  riskRules.seedReady, preventionPlans.seedReady, accruals.seedReady,
].filter(Boolean));

// --- the cards ------------------------------------------------------------------

export function cards() {
  return [untriagedCard(), filingCard(), inFlightCard(), recoveredCard(), winRateCard(), tpaHalf(), preventionHalf()];
}

/** 1 — denials nobody has triaged; red once one of them is inside the filing band. */
function untriagedCard() {
  if (!has(denials, 'counts') || !has(denials, 'nearDeadline')) return pending('untriaged', 'Untriaged denials', 'A36');
  const c = denials.counts();
  const near = denials.nearDeadline().filter((d) => d.status === 'Untriaged').length;
  return {
    id: 'untriaged',
    value: c.untriaged,
    label: 'Untriaged denials',
    sub: near ? `${near} inside the ${filingWarnDays()}-day filing band` : `${usd(c.openValue)} open in all`,
    tone: near ? 'critical' : c.untriaged ? 'warning' : '',
    href: '#/defensio/denials?status=Untriaged',
    title: `${plural(c.untriaged, 'denial')} nobody has separated, tiered and classed yet${
      near ? `, ${near} of them with the appeal window closing inside ${filingWarnDays()} days` : ''}. Opens the worklist on them, largest open amount first`,
  };
}

/**
 * 2 — open denials whose appeal window closes inside the band; red once one
 * has passed. The worklist reads one deadline filter at a time, so the card
 * counts the band and names the passed ones in its sub-line — and when the
 * band is empty and a window has passed, it counts and opens those instead,
 * rather than a zero that opens an empty list. `query` is what it links to,
 * which is also what home-reconcile.js reads it against.
 */
function filingCard() {
  if (!has(denials, 'nearDeadline') || !has(denials, 'search')) return pending('filing', 'Filing deadlines', 'A36');
  const near = denials.nearDeadline();
  const passed = denials.search('', { deadline: 'passed' });
  const soonest = near[0] ? denials.deadline(near[0]).daysLeft : null;
  const showPassed = !near.length && passed.length > 0;
  return {
    id: 'filing',
    query: { deadline: showPassed ? 'passed' : 'week' },
    value: showPassed ? passed.length : near.length,
    label: 'Filing deadlines',
    sub: showPassed ? 'passed, money still open'
      : passed.length ? `${plural(passed.length, 'window')} already passed` : soonest == null ? `none inside ${filingWarnDays()} d` : `soonest in ${soonest} d`,
    tone: passed.length ? 'critical' : near.length ? 'warning' : '',
    href: `#/defensio/denials?deadline=${showPassed ? 'passed' : 'week'}`,
    title: showPassed
      ? `${plural(passed.length, 'open denial')} whose appeal window has passed with the money still open, and none closing inside ${filingWarnDays()} days. Opens the worklist on them`
      : `${plural(near.length, 'open denial')} with the appeal window closing inside ${filingWarnDays()} days${
        passed.length ? `; ${passed.length} more passed it with the money still open` : ''}. Opens the worklist on the band, soonest first`,
  };
}

/** 3 — appeals with the payer; red once one is past its response window. */
function inFlightCard() {
  if (!has(tracking, 'counts') || !has(tracking, 'getF4HomeFlags')) return pending('inFlight', 'Appeals in flight', 'A39');
  const c = tracking.counts();
  const f = tracking.getF4HomeFlags();
  return {
    id: 'inFlight',
    value: c.inFlight,
    label: 'Appeals in flight',
    sub: f.overdue.length ? `${f.overdue.length} past the payer's window · ${usd(f.overdueValue)}` : `${usd(c.inFlightValue)} with the payers`,
    tone: f.overdue.length ? 'critical' : c.inFlight ? 'info' : '',
    href: '#/defensio/appeal-tracking?slice=inFlight',
    title: `${plural(c.inFlight, 'appeal')} submitted and not yet answered, ${usd(c.inFlightValue)} in dispute${
      f.overdue.length ? `; ${f.overdue.length} past the payer's response window` : ''}. Opens the tracking worklist on them, response deadline first`,
  };
}

/** 4 — conceded money that landed this month; amber while conceded money is aging unpaid. */
function recoveredCard() {
  if (!has(tracking, 'counts') || !has(tracking, 'getF4HomeFlags')) return pending('recovered', 'Recovered MTD', 'A39');
  const c = tracking.counts();
  const f = tracking.getF4HomeFlags();
  return {
    id: 'recovered',
    value: usd(c.recoveredMtd.amount),
    label: 'Recovered MTD',
    sub: f.aging.length ? `${usd(f.agingValue)} aging past ${tracking.recoveryAgingDays()} d` : `${plural(c.recoveredMtd.count, 'case')} paid this month`,
    tone: f.aging.length ? 'warning' : c.recoveredMtd.amount ? 'success' : '',
    href: '#/defensio/appeal-tracking?slice=recovered',
    title: `Conceded on appeal and paid this month, matched to a remittance posting${
      f.aging.length ? `; ${plural(f.aging.length, 'conceded amount')} has waited past ${tracking.recoveryAgingDays()} days unpaid` : ''}. Opens the tracking worklist on the cases recovered this month`,
  };
}

/** 5 — amendment 41's overturn rate over the month, read and never recomputed. */
function winRateCard() {
  if (!has(analytics, 'getDenialMetrics')) return pending('winRate', 'Win rate MTD', 'A41');
  const m = analytics.getDenialMetrics('', 'MTD').byKey.overturnRate;
  if (!m || m.pending) return pending('winRate', 'Win rate MTD', 'A41');
  const d = m.detail || {};
  const delta = m.deltaText && m.delta != null ? ` · ${m.deltaText} vs prior` : '';
  return {
    id: 'winRate',
    value: m.count ? m.text : '—',
    text: !m.count,
    label: 'Win rate MTD',
    sub: m.count ? `${d.overturned} of ${plural(m.count, 'appeal')} decided${delta}` : 'no appeal decided this month',
    tone: m.count ? (m.improved === false ? 'warning' : m.improved ? 'success' : '') : '',
    href: m.href,
    title: `${m.hint} Read from the analytics engine over the month to date and never recomputed here. Opens the tracking worklist on the appeals decided this month`,
  };
}

/** 6a — overcharges nobody has raised with the administrator; the split card's first half. */
function tpaHalf() {
  if (!has(accruals, 'counts') || !has(accruals, 'getTpaFeeSummary')) return { ...pending('tpa', 'TPA overcharge', 'A42'), half: true };
  const c = accruals.counts();
  const s = accruals.getTpaFeeSummary('all');
  // The open overcharge (A42's summary) counts what is already in dispute;
  // the card counts what is not, so the sub-line says which it is naming.
  const sub = c.overcharged ? `${usd(c.overchargeUndisputed)} to dispute`
    : s.overchargeOpen ? `${usd(s.overchargeOpen)} open, all in dispute`
      : c.unscheduled ? `${plural(c.unscheduled, 'fee')} unscheduled` : 'nothing waiting';
  return {
    id: 'tpa', half: true,
    value: c.overcharged,
    label: 'TPA fees',
    sub,
    tone: c.overcharged ? 'critical' : c.unscheduled ? 'warning' : '',
    href: '#/defensio/tpa?slice=overcharged',
    title: `${plural(c.overcharged, 'accrual')} overcharged and not yet disputed; ${usd(s.overchargeOpen)} of overcharge open across the register, ${
      usd(c.disputedValue)} of it already with the administrator${
      c.unscheduled ? `; ${plural(c.unscheduled, 'fee')} with no schedule version to read against` : ''}. Opens the TPA ledger on the ones to dispute`,
  };
}

/** 6b — patterns nobody has acknowledged; the split card's second half. */
function preventionHalf() {
  if (!has(denialPatterns, 'counts') || !has(denialPatterns, 'rankedCauses') || !has(riskRules, 'counts')) {
    return { ...pending('prevention', 'Prevention gaps', 'A40'), half: true };
  }
  const p = denialPatterns.counts();
  const noPlan = denialPatterns.rankedCauses().filter((c) => c.noPlanFlag).length;
  const r = riskRules.counts();
  const waiting = r.flagged + r.proposed;
  return {
    id: 'prevention', half: true,
    value: p.attention,
    label: 'Prevention',
    sub: noPlan ? `${plural(noPlan, 'cause')} with no plan` : waiting ? `${plural(waiting, 'rule')} waiting on a decision` : `${p.underPlan} under plan`,
    tone: p.attention ? 'critical' : noPlan || waiting ? 'warning' : '',
    href: '#/defensio/prevention?slice=attention',
    title: `${plural(p.attention, 'pattern')} nobody has acknowledged — new, or back after fading${
      noPlan ? `; ${plural(noPlan, 'cause')} worth ${usd(denialPatterns.noPlanFlagValue())} or more in the window with no plan in force` : ''}${
      waiting ? `; ${plural(waiting, 'risk rule')} flagged for retirement or proposed for suspension` : ''}. Opens the prevention dashboard on the patterns to acknowledge`,
  };
}

// --- markup -------------------------------------------------------------------------

/**
 * The rail: five cards, then the split card — one track holding a two-column
 * rail of its own, the design system's `--2` modifier for a rail inside a
 * column, so each half is a real card with its own tone bar and its own href.
 * A half is narrow, so its label is one word or two and the sentence rides
 * in `title`, which is what the system says to do when a label truncates.
 */
export function railHtml(list = cards()) {
  const whole = list.filter((c) => !c.half);
  const halves = list.filter((c) => c.half);
  return metricRailHtml(whole)
    + `<div class="metric-rail metric-rail--2" title="Two halves, two screens: the TPA ledger and the prevention dashboard">${
      halves.map((c) => metricCardHtml(c)).join('')}</div>`;
}
