// The rail over the eligibility worklist. Each card selects the rows it counts,
// so the number on the card and the row count under it are one figure, and a
// second click on the pressed card clears the filters again.
//
// The map is built on demand rather than held as a constant: the Checked today
// card names today's date, and a demo left open overnight would otherwise
// filter to the day it started.

import * as eligibility from '../../../../data/repositories/eligibility.js';
import { metricRailHtml, kpiFilter } from '../../../../shared/metric-card.js';
import { todayIso } from '../../../../shared/format.js';

export const blank = () => ({ q: '', result: '', payerId: '', from: '', to: '', overridden: false });

/** Card key -> the filter state that card selects. `all` is the cleared state. */
export function kpiMap() {
  const today = todayIso();
  return {
    all: blank(),
    today: { from: today, to: today },
    eligible: { result: 'Eligible' },
    conditions: { result: 'Eligible with Conditions' },
    notEligible: { result: 'Not Eligible' },
    overridden: { overridden: true },
  };
}

export function railHtml(state) {
  const { showing } = kpiFilter(state, kpiMap());
  const c = eligibility.counts();
  return metricRailHtml([
    { value: c.today, label: 'Checked today', key: 'today', pressed: showing('today'),
      sub: 'Verified at the desk',
      title: 'Checks recorded today — select to list them' },
    { value: c.eligible, label: 'Eligible', key: 'eligible', pressed: showing('eligible'),
      sub: 'Cover confirmed outright',
      title: 'Checks whose final result is Eligible — select to list them' },
    { value: c.conditions, label: 'With conditions', key: 'conditions', pressed: showing('conditions'),
      tone: c.conditions ? 'warning' : '', sub: 'Pre-auth or an exclusion',
      title: 'Checks that passed but raised conditions to act on — select to list them' },
    { value: c.notEligible, label: 'Not eligible', key: 'notEligible', pressed: showing('notEligible'),
      tone: c.notEligible ? 'critical' : '', sub: 'Cascade or self-pay',
      title: 'Checks the cover failed — the next policy or Self-Pay follows — select to list them' },
    { value: c.overridden, label: 'Overridden', key: 'overridden', pressed: showing('overridden'),
      sub: 'Answered beside the system',
      title: 'Checks a supervisor answered beside the system result — select to list them' },
  ]);
}

/** Apply the card's slice, or clear back to every check. */
export const selectKpi = (state, key) => kpiFilter(state, kpiMap()).select(key);
