// The rail over the root-cause worklist: open cases, overdue, in analysis,
// concluded and awaiting close, individual findings. Every card selects the
// rows it counts, so the number on the card and the row count under it are
// one figure; a second click on the pressed card clears back to the list.

import * as rcaCases from '../../../../data/repositories/rca-cases.js';
import { metricRailHtml, kpiFilter } from '../../../../shared/metric-card.js';

/** Card key -> the filter state that card selects. `all` is the cleared state. */
export const KPI = {
  all: { q: '', status: '', trigger: '', nature: '', analyst: '', overdue: false, open: false, payerId: '', from: '', to: '', concludedFrom: '' },
  open: { open: true },
  overdue: { overdue: true },
  inAnalysis: { status: 'InAnalysis' },
  concluded: { status: 'Concluded' },
  individual: { nature: 'individual' },
};

export const blank = () => ({ ...KPI.all });

export function railHtml(state) {
  const { showing } = kpiFilter(state, KPI);
  const c = rcaCases.counts();
  return metricRailHtml([
    { value: c.open, label: 'Open cases', key: 'open', pressed: showing('open'), tone: c.open ? 'warning' : '',
      sub: c.unassigned ? `${c.unassigned} unassigned` : 'every case has an analyst',
      title: 'Cases opened by a trigger or by hand and not yet concluded' },
    { value: c.overdue, label: 'Overdue', key: 'overdue', pressed: showing('overdue'), tone: c.overdue ? 'critical' : '',
      sub: `${rcaCases.targetDays()}-day target`,
      title: 'Open cases past the target the config sets from the day they opened' },
    { value: c.inAnalysis, label: 'In analysis', key: 'inAnalysis', pressed: showing('inAnalysis'), tone: c.inAnalysis ? 'accent' : '',
      sub: 'whys started', title: 'Cases whose analyst has started the whys' },
    { value: c.concluded, label: 'Awaiting close', key: 'concluded', pressed: showing('concluded'), tone: c.concluded ? 'info' : '',
      sub: `${c.concludedMtd} concluded this month`,
      title: 'Concluded cases whose corrective actions are not all verified, or whose accountability case is still to be decided' },
    { value: c.individual, label: 'Individual', key: 'individual', pressed: showing('individual'), tone: c.individual ? 'warning' : '',
      sub: `${c.accountabilityOpen} accountability case${c.accountabilityOpen === 1 ? '' : 's'} open`,
      title: 'Cases whose confirmed cause was one person’s act — each opens an accountability case at conclusion' },
  ]);
}

export const selectKpi = (state, key) => kpiFilter(state, KPI).select(key);
