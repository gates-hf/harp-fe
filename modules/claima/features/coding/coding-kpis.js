// The rail over the coding worklist. Each card selects the rows it counts, so
// the number on the card and the row count under it are one figure, and a
// second click on the pressed card clears the filters again. Every card widens
// the scope to the whole worklist first, because My work would hide the charts
// a supervisor's card is counting.

import * as coding from '../../../../data/repositories/coding.js';
import { metricRailHtml, kpiFilter } from '../../../../shared/metric-card.js';

/** Card key -> the filter state that card selects. `all` is the cleared state. */
export const KPI = {
  all: {
    q: '', view: 'all', status: '', coder: '', department: '', type: '', band: '', from: '', to: '',
    beyondSla: false, awaiting: false, working: false,
  },
  awaiting: { view: 'all', awaiting: true },
  beyondSla: { view: 'all', beyondSla: true },
  inProgress: { view: 'all', working: true },
  queryPending: { view: 'all', status: 'Query Pending' },
};

export const blank = () => ({ ...KPI.all });

export function railHtml(state) {
  const { showing } = kpiFilter(state, KPI);
  const c = coding.counts();
  return metricRailHtml([
    { value: c.awaiting, label: 'Awaiting', key: 'awaiting', pressed: showing('awaiting'),
      sub: 'Released, nobody has started',
      title: 'Charts released for coding that are unassigned or assigned and untouched — select to list them' },
    { value: c.beyondSla, label: 'Beyond SLA', key: 'beyondSla', pressed: showing('beyondSla'),
      tone: c.beyondSla ? 'critical' : '',
      sub: 'Open longer than the SLA allows',
      title: 'Open charts older than their SLA (3 days outpatient and emergency, 5 days inpatient) — select to list them' },
    { value: c.inProgress, label: 'In progress', key: 'inProgress', pressed: showing('inProgress'),
      sub: 'Drafted, or sent back for recode',
      title: 'Charts a coder has saved a draft on, and coded charts sent back for recode — select to list them' },
    { value: c.queryPending, label: 'Query pending', key: 'queryPending', pressed: showing('queryPending'),
      tone: c.queryPending ? 'warning' : '',
      sub: 'Waiting on a physician',
      title: 'Charts with a CDI query open with the physician — select to list them' },
  ]);
}

/** Apply the card's slice, or clear back to the whole worklist. */
export const selectKpi = (state, key) => kpiFilter(state, KPI).select(key);
