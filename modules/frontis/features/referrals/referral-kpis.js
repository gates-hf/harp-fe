// The rail over the Referrals worklist. Each card selects the rows it counts,
// so the number on the card and the row count under it are one figure, and a
// second click on the pressed card clears the filters again.
//
// The view toggle is a filter here rather than a scope beside them: two of the
// four cards are about the inbound work and two are not, so a card that could
// not move the toggle would count rows the screen refuses to show.

import * as referrals from '../../../../data/repositories/referrals.js';
import { metricRailHtml, kpiFilter } from '../../../../shared/metric-card.js';
import { todayIso } from '../../../../shared/format.js';

const monthStart = () => `${todayIso().slice(0, 7)}-01`;

const monthEnd = () => {
  const when = new Date(`${monthStart()}T00:00:00Z`);
  when.setUTCMonth(when.getUTCMonth() + 1);
  when.setUTCDate(0);
  return when.toISOString().slice(0, 10);
};

/** Card key -> the filter state that card selects. `all` is the cleared state. */
export const KPI = {
  all: {
    q: '', view: 'inbound', direction: '', status: '', specialty: '', sourceId: '',
    expiring: '', from: '', to: '',
  },
  // The screen's own default view, so this card is the cleared state itself.
  inbound: {},
  expiring: { view: 'all', expiring: '1' },
  scheduled: { view: 'all', status: 'Scheduled' },
  outbound: { view: 'outbound', from: monthStart(), to: monthEnd() },
};

export const blank = () => ({ ...KPI.all });

export function railHtml(state) {
  const { showing } = kpiFilter(state, KPI);
  const c = referrals.counts(referrals.all());
  return metricRailHtml([
    { value: c.inbound, label: 'Active inbound', key: 'inbound', pressed: showing('inbound'),
      title: 'Referrals sent to us that are still worth acting on — New or Scheduled' },
    { value: c.expiring, label: 'Expiring soon', key: 'expiring', pressed: showing('expiring'),
      tone: c.expiring ? 'warning' : '',
      sub: `Valid for ${referrals.CONFIG.expiringDays} more days or less`,
      title: `Still good, and the ones to book first — ${referrals.CONFIG.expiringDays} days or less left` },
    { value: c.scheduled, label: 'Scheduled', key: 'scheduled', pressed: showing('scheduled'),
      title: 'Holding a place on an expected arrival — select to list them' },
    { value: c.outboundMonth, label: 'Outbound this month', key: 'outbound', pressed: showing('outbound'),
      title: 'Referrals this hospital wrote itself, this calendar month' },
  ]);
}

/** Apply the card's slice, or clear back to the whole worklist. */
export const selectKpi = (state, key) => kpiFilter(state, KPI).select(key);
