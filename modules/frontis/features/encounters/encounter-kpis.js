// The rail over the encounter board. Each card selects the rows it counts, so
// the number on the card and the row count under it are one figure, and a
// second click on the pressed card clears the filters again.
//
// The type split is the one card that selects nothing: it carries three numbers,
// not one slice, so it stays the plain number the design system reserves a
// <div> for. The Type filter beside the table is what narrows to one of them.

import * as encounters from '../../../../data/repositories/encounters.js';
import { metricRailHtml, kpiFilter } from '../../../../shared/metric-card.js';

/** Card key -> the filter state that card selects. `all` is the cleared state. */
export const KPI = {
  all: {
    q: '', type: '', status: '', department: '', doctorId: '',
    from: '', to: '', financial: '', notCleared: false,
  },
  active: { status: 'Active' },
  planned: { status: 'Planned' },
  notCleared: { notCleared: true },
};

/**
 * The board's blank state. `scope` is deliberately outside KPI.all: Today | All
 * is the question the whole board is asked, not a filter a card clears.
 */
export const blank = () => ({ scope: 'today', ...KPI.all });

export function railHtml(state) {
  const { showing } = kpiFilter(state, KPI);
  const scoped = state.scope === 'all' ? encounters.all() : encounters.today();
  const c = encounters.counts(scoped);
  const word = state.scope === 'all' ? 'on the register' : 'on the board';
  return metricRailHtml([
    { value: c.active, label: 'Active now', key: 'active', pressed: showing('active'),
      title: `Encounters open right now ${word} — select to list them` },
    { value: `${c.op} · ${c.ip} · ${c.er}`, label: 'OP · IP · ER today',
      title: `Started today: ${c.op} outpatient, ${c.ip} inpatient, ${c.er} emergency. Narrow to one with the Type filter` },
    { value: c.planned, label: 'Planned', key: 'planned', pressed: showing('planned'),
      title: 'Booked and not yet arrived — select to list them' },
    { value: c.notCleared, label: 'Not cleared', key: 'notCleared', pressed: showing('notCleared'),
      tone: c.notCleared ? 'warning' : '',
      title: 'Financial clearance pending or blocked — select to list them' },
  ]);
}

/** Apply the card's slice, or clear back to the whole board. */
export const selectKpi = (state, key) => kpiFilter(state, KPI).select(key);
