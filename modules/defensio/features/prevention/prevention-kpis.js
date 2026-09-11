// The rail over the prevention dashboard: the patterns over the threshold,
// the ones nobody has acknowledged, the ones under a plan — each selecting
// the slice of the pattern table it counts, so the number on the card and
// the rows under it are one figure — then the plans in force and what they
// are credited with this month (an estimate, and the card says so), which
// jump to the plans panel, and the active risk rules, which open their
// screen.

import * as denialPatterns from '../../../../data/repositories/denial-patterns.js';
import * as preventionPlans from '../../../../data/repositories/prevention-plans.js';
import * as riskRules from '../../../../data/repositories/risk-rules.js';
import { metricRailHtml, kpiFilter } from '../../../../shared/metric-card.js';
import { usd } from '../../../../shared/format.js';

/** Card key -> the filter state that card selects. `all` is the cleared state. */
export const KPI = {
  all: { q: '', status: '', payerId: '', causeId: '', level: '', active: false, attention: false },
  active: { active: true },
  attention: { attention: true },
  underPlan: { status: 'UnderPlan' },
};

export const blank = () => ({ ...KPI.all });

export function railHtml(state) {
  const { showing } = kpiFilter(state, KPI);
  const p = denialPatterns.counts();
  const pl = preventionPlans.counts();
  const r = riskRules.counts();
  return metricRailHtml([
    { value: p.active, label: 'Active patterns', key: 'active', pressed: showing('active'), tone: p.active ? 'warning' : '',
      sub: `${usd(p.activeValue)} denied in the window`, title: `Patterns whose ${denialPatterns.windowDays()}-day window holds the threshold (${denialPatterns.threshold()})` },
    { value: p.attention, label: 'Needs acknowledgment', key: 'attention', pressed: showing('attention'), tone: p.attention ? 'critical' : '',
      sub: p.accelerating ? `${p.accelerating} accelerating` : 'none accelerating', title: 'New patterns, and faded ones back over the threshold, that nobody has acknowledged' },
    { value: p.underPlan, label: 'Under plan', key: 'underPlan', pressed: showing('underPlan'), tone: p.underPlan ? 'accent' : '',
      sub: `${p.faded} faded`, title: 'Patterns a plan in force targets' },
    { value: pl.inForce, label: 'Plans in force', key: 'plans', tone: pl.overdue ? 'critical' : pl.inForce ? 'info' : '',
      sub: pl.overdue ? `${pl.overdue} with an overdue action` : pl.readyToClose ? `${pl.readyToClose} ready to close` : `${pl.byStatus.Draft} draft${pl.byStatus.Draft === 1 ? '' : 's'}`,
      title: 'Active plans and plans in measurement — jumps to the plans panel' },
    { value: usd(pl.preventedValueEstimateMTD), label: 'Prevented (estimate)', key: 'plans', tone: pl.preventedValueEstimateMTD ? 'success' : '',
      sub: `MTD · ${pl.closedEffectiveMtd} closed effective`, title: 'Month to date: baseline value less measured value across the plans measured this month — an estimate, written to no ledger' },
    { value: r.active, label: 'Active risk rules', href: '#/defensio/prevention/rules', tone: r.flagged + r.proposed ? 'warning' : '',
      sub: r.flagged + r.proposed ? `${r.flagged + r.proposed} waiting on a decision` : `${r.firedTotal} warnings raised`, title: 'Rules warning at the claim scrub — opens the rules screen' },
  ]);
}

export const selectKpi = (state, key) => kpiFilter(state, KPI).select(key);
