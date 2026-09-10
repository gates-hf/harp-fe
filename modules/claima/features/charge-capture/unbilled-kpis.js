// The rail over the unbilled worklist. Two of the four cards are slices of the
// table under them — every visit, and the held lines — so their numbers are
// the row counts they select; the other two are figures nothing on this screen
// can select (a line count and a sum of money over the same rows), and they
// stay the plain numbers the design system reserves for that.

import * as charges from '../../../../data/repositories/charges.js';
import { metricRailHtml, kpiFilter } from '../../../../shared/metric-card.js';
import { usd } from '../../../../shared/format.js';

/** Card key -> the filter state that card selects. `all` is the cleared state. */
export const KPI = {
  all: { q: '', department: '', status: '', flag: '', source: '', from: '', to: '' },
  encounters: {},
  held: { status: 'Held' },
  late: { flag: 'Late' },
};

export const blank = () => ({ ...KPI.all });

export function railHtml(state) {
  const { showing } = kpiFilter(state, KPI);
  const c = charges.counts();
  return metricRailHtml([
    { value: c.encounters, label: 'Encounters unreleased', key: 'encounters', pressed: showing('encounters'),
      sub: `${c.lines} line${c.lines === 1 ? '' : 's'} waiting`,
      title: 'Visits still holding lines nobody has released to billing — select to list every one' },
    { value: c.lines, label: 'Lines', sub: 'unreleased and held',
      title: 'Every unreleased or held capture line, over every visit on this screen' },
    { value: usd(c.gross), label: 'Gross unreleased', text: true, sub: 'at the standard price',
      title: 'What the unreleased lines are worth at the charge master’s price, before any agreement' },
    { value: c.held, label: 'Held', key: 'held', pressed: showing('held'), tone: c.held ? 'warning' : '',
      sub: c.late ? `${c.late} late` : 'nothing waiting on a reason',
      title: 'Lines on hold with a reason — a late charge awaiting approval among them — select to list them' },
  ]);
}

/** Apply the card's slice, or clear back to the whole worklist. */
export const selectKpi = (state, key) => kpiFilter(state, KPI).select(key);
