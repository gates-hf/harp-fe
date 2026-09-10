// The rail over the clearance worklist. Each card selects the rows it counts,
// so the number on the card and the row count under it are one figure, and a
// second click on the pressed card clears the filters again.
//
// Every card widens the scope to the whole board before narrowing it, because
// three of the four count something the Needs attention view deliberately hides
// — a cleared visit is not attention, and a card that could not move the toggle
// would count rows the screen refuses to show.

import * as clearance from '../../../../data/repositories/clearance.js';
import { metricRailHtml, kpiFilter } from '../../../../shared/metric-card.js';
import { CONFIG } from '../../../../shared/config.js';
import { todayIso } from '../../../../shared/format.js';

/** Card key -> the filter state that card selects. `all` is the cleared state. */
export const KPI = {
  all: {
    q: '', scope: 'attention', status: '', type: '', department: '', financial: '',
    item: '', from: '', to: '', overdue: false,
  },
  blocked: { scope: 'all', status: 'Blocked' },
  conditional: { scope: 'all', status: 'Conditionally Cleared' },
  clearedToday: { scope: 'all', status: 'Cleared', from: todayIso(), to: todayIso() },
  overdue: { scope: 'all', overdue: true },
};

export const blank = () => ({ ...KPI.all });

export function railHtml(state) {
  const { showing } = kpiFilter(state, KPI);
  const rows = clearance.openEncounters();
  const c = clearance.counts(rows);
  const hours = CONFIG.clearance.pendingAgeWarnHours;
  return metricRailHtml([
    { value: c.blocked, label: 'Blocked', key: 'blocked', pressed: showing('blocked'),
      tone: c.blocked ? 'critical' : '',
      sub: 'A payer, a signature or a deposit is missing',
      title: 'Visits that cannot go ahead financially until something is answered — select to list them' },
    { value: c.conditional, label: 'Conditionally cleared', key: 'conditional', pressed: showing('conditional'),
      tone: c.conditional ? 'warning' : '',
      sub: 'Nothing failed, something is outstanding',
      title: 'Nothing has failed, but at least one item is still outstanding — select to list them' },
    { value: c.clearedToday, label: 'Cleared today', key: 'clearedToday', pressed: showing('clearedToday'),
      sub: 'Arriving today with every item settled',
      title: 'Visits arriving today whose five items are all passed or not required — select to list them' },
    { value: c.overdue, label: `Pending over ${hours}h`, key: 'overdue', pressed: showing('overdue'),
      tone: c.overdue ? 'warning' : '',
      sub: 'The oldest item, not the visit',
      title: `Something has been outstanding for more than ${hours} hours — the age is the oldest unsettled item, not the visit` },
  ]);
}

/** Apply the card's slice, or clear back to the whole worklist. */
export const selectKpi = (state, key) => kpiFilter(state, KPI).select(key);
