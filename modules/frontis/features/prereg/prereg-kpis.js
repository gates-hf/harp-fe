// The rail over the Expected Arrivals worklist. Each card selects the rows it
// counts, so the number on the card and the row count under it are one figure,
// and a second click on the pressed card clears the filters again.

import * as prereg from '../../../../data/repositories/prereg.js';
import { metricRailHtml, kpiFilter } from '../../../../shared/metric-card.js';
import { todayIso } from '../../../../shared/format.js';

/** Card key -> the filter state that card selects. `all` is the cleared state. */
export const KPI = {
  all: { q: '', status: '', department: '', type: '', precheck: '', from: '', to: '' },
  today: { from: todayIso(), to: todayIso() },
  ready: { status: 'Ready' },
  pending: { status: 'Pending' },
  failed: { precheck: 'Failed' },
};

/**
 * The worklist's blank state. `scope` sits outside KPI.all: Today + upcoming |
 * All is the question the whole screen is asked, not a filter a card clears.
 */
export const blank = () => ({ scope: 'upcoming', ...KPI.all });

export function railHtml(state, rows) {
  const { showing } = kpiFilter(state, KPI);
  const c = prereg.counts(rows);
  const word = state.scope === 'all' ? 'in the register' : 'in scope';
  return metricRailHtml([
    { value: c.today, label: 'Expected today', key: 'today', pressed: showing('today'),
      title: `Arrivals booked for today ${word} — select to list them` },
    { value: c.ready, label: 'Ready', key: 'ready', pressed: showing('ready'),
      tone: '', title: 'Everything captured — these convert without another question' },
    { value: c.pending, label: 'Pending follow-up', key: 'pending', pressed: showing('pending'),
      tone: c.pending ? 'warning' : '',
      title: 'Something is still missing before conversion — select to list them' },
    { value: c.failed, label: 'Pre-check failed', key: 'failed', pressed: showing('failed'),
      tone: c.failed ? 'critical' : '',
      title: 'The payer refused the cover on the pre-check — select to list them' },
  ]);
}

/** Apply the card's slice, or clear back to the whole worklist. */
export const selectKpi = (state, key) => kpiFilter(state, KPI).select(key);
