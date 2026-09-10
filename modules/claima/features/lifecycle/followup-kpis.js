// The rail over the follow-up queue. All three cards select the rows they
// count — everything silent, what is escalated, what is due today — so the
// number on the card and the row count under it are one figure, and a second
// click on the pressed card clears back to the whole queue.

import * as lifecycle from '../../../../data/engines/claim-events.js';
import { metricRailHtml, kpiFilter } from '../../../../shared/metric-card.js';
import { usd } from '../../../../shared/format.js';

/**
 * Card key -> the filter state that card selects. `all` is the cleared state.
 * The payer is not in it: the rail counts within the payer on screen, so a
 * card narrows the queue for that payer rather than throwing the payer away.
 */
export const KPI = {
  all: { q: '', slice: '' },
  silent: {},
  escalated: { slice: 'escalated' },
  due: { slice: 'due' },
};

export const blank = () => ({ ...KPI.all, payerId: '' });

export function railHtml(state) {
  const { showing } = kpiFilter(state, KPI);
  const s = lifecycle.queueStats(state.payerId);
  return metricRailHtml([
    { value: s.silentCount, label: 'Silent', key: 'silent', pressed: showing('silent'),
      tone: s.silentCount ? 'warning' : '',
      sub: `${usd(s.silentValue)} waiting on the payer`,
      title: 'Submitted or Acknowledged claims past their payer’s silence threshold — the whole queue' },
    { value: s.escalated, label: 'Escalated', key: 'escalated', pressed: showing('escalated'),
      tone: s.escalated ? 'critical' : '',
      sub: `${usd(s.escalatedValue)} past the escalation threshold`,
      title: 'Silent claims past the escalation threshold as well — computed on every read, never stored' },
    { value: s.dueToday, label: 'Due today', key: 'due', pressed: showing('due'),
      tone: s.dueToday ? 'warning' : '',
      sub: 'follow-up calls booked for today',
      title: 'Claims whose last follow-up booked its next call for today' },
  ]);
}

export const selectKpi = (state, key) => kpiFilter(state, KPI).select(key);
