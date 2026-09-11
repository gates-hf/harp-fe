// The numbers-reconcile rule made executable. Every KPI card on the Defensio
// home opens a worklist on the rows it counts; this file re-reads that
// worklist's dataset through the same helper and the same filter state the
// target screen uses on arrival (its KPI map and its slice post-filter,
// imported from the feature that owns it — one module, one definition of a
// slice) and console.asserts the card says the same thing. A mismatch names
// the card. Development-only: it writes nothing and paints nothing.

import * as denials from '../../../../data/repositories/denials.js';
import * as tracking from '../../../../data/repositories/appeal-tracking.js';
import * as analytics from '../../../../data/engines/denial-analytics.js';
import * as accruals from '../../../../data/repositories/tpa-fee-accruals.js';
import * as denialPatterns from '../../../../data/repositories/denial-patterns.js';
import { KPI as DENIAL_KPI, applySlice as denialSlice } from '../denials/denial-kpis.js';
import { KPI as TRACKING_KPI, applySlice as trackingSlice } from '../appeal-tracking/tracking-kpis.js';
import { KPI as TPA_KPI } from '../tpa/tpa-kpis.js';
import { KPI as PATTERN_KPI } from '../prevention/prevention-kpis.js';

/** The target screen's rows for the state its deep link lands it in. */
const denialRows = (state) => denialSlice(denials.search('', { ...DENIAL_KPI.all, ...state }), state.slice || '');
const trackingRows = (state) => trackingSlice(tracking.search('', { ...TRACKING_KPI.all, ...state }), state.slice || '');

/**
 * Card id → what the screen behind its href shows, `{ actual }` as a row
 * count, with `claim` naming the card's own count when its headline is a
 * sum or a rate over those rows. Missing ids are cards no target can be
 * read for (a pending card).
 */
const TARGETS = {
  untriaged: () => ({ actual: denialRows({ status: 'Untriaged' }).length }),
  filing: (card) => ({ actual: denialRows(card.query || { deadline: 'week' }).length }),
  inFlight: () => ({ actual: trackingRows(TRACKING_KPI.inFlight).length }),
  // The card's headline is money and its sub-line the cases paid this month
  // — the rows the slice lists — so the count is what reconciles, read off
  // the same helper the card read.
  recovered: () => ({ actual: trackingRows(TRACKING_KPI.recovered).length, claim: tracking.counts().recoveredMtd.count }),
  winRate: () => ({ actual: trackingRows(TRACKING_KPI.decided).length, claim: analytics.getDenialMetrics('', 'MTD').byKey.overturnRate?.count ?? null }),
  tpa: () => ({ actual: accruals.search('', { ...TPA_KPI.all, ...TPA_KPI.overcharged }).length }),
  prevention: () => ({ actual: denialPatterns.search('', { ...PATTERN_KPI.all, ...PATTERN_KPI.attention }).length }),
};

/** What the card claims, in the target's unit: the count behind a sum or a rate, else its own number. */
function claimed(card, target) {
  if (target.claim != null) return target.claim;
  return Number(card.value);
}

/**
 * reconcile(cards) → { pass, problems[] }, asserting each card against its
 * target and logging one line naming any card that does not reconcile. A
 * card rendered "Pending" has no target and is skipped.
 */
let lastReport = null;

export function reconcile(cards = []) {
  const problems = [];
  for (const card of cards) {
    const target = TARGETS[card.id];
    if (!target || card.value === 'Pending') continue;
    let t;
    try { t = target(card); } catch (e) { problems.push(`${card.id}: target threw ${e.message}`); continue; }
    const says = claimed(card, t);
    const ok = says === t.actual;
    console.assert(ok, `[defensio home] card ${card.id} does not reconcile: card says ${says}, ${card.href} holds ${t.actual}`);
    if (!ok) problems.push(`${card.id} (${says} vs ${t.actual})`);
  }
  // One line per change of answer, not one per redraw — the registers seed
  // through commits and the dashboard redraws on each of them.
  const report = problems.length ? `[defensio home] reconcile FAIL — ${problems.join('; ')}` : `[defensio home] reconcile pass — ${cards.length} cards`;
  if (report !== lastReport) { (problems.length ? console.warn : console.log)(report); lastReport = report; }
  return { pass: !problems.length, problems };
}
