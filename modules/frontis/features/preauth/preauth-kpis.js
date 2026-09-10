// The rail over the Pre-Auths worklist. Each card selects the rows it counts,
// so the number on the card and the row count under it are one figure, and a
// second click on the pressed card clears the filters again.
//
// The view toggle is part of a card's slice rather than a scope beside it: two
// of the four cards are about work outstanding and two are not, so a card that
// could not move the toggle would count rows the screen refuses to show.

import * as preauth from '../../../../data/repositories/preauth-requests.js';
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
  all: { q: '', view: 'action', status: '', payerId: '', expiring: '', from: '', to: '' },
  // The screen's own default view, so this card is the cleared state itself.
  action: {},
  submitted: { view: 'all', status: 'Submitted' },
  expiring: { view: 'all', expiring: String(preauth.CONFIG.expiringDays) },
  // Denied this month is read on the date the payer answered, which is what the
  // list is sorted and filtered by — the request may have been raised earlier.
  denied: { view: 'all', status: 'Denied', from: monthStart(), to: monthEnd() },
};

export const blank = () => ({ ...KPI.all });

export function railHtml(state) {
  const { showing } = kpiFilter(state, KPI);
  const c = preauth.counts(preauth.all());
  return metricRailHtml([
    { value: c.action, label: 'Needs action', key: 'action', pressed: showing('action'),
      tone: c.action ? 'warning' : '',
      sub: 'drafts, pending answers and renewals',
      title: 'Everything the desk still owes somebody — a draft to send, an answer to chase, or an approval to renew' },
    { value: c.submitted, label: 'With the payer', key: 'submitted', pressed: showing('submitted'),
      sub: 'submitted, no answer yet',
      title: 'Sent and waiting. An urgent request past three days is shown red on its row' },
    { value: c.expiring, label: 'Expiring soon', key: 'expiring', pressed: showing('expiring'),
      tone: c.expiring ? 'warning' : '',
      sub: `${preauth.CONFIG.expiringDays} days left or fewer`,
      title: `Approvals still in force with ${preauth.CONFIG.expiringDays} days or less to run — renew before they lapse` },
    { value: c.denied, label: 'Denied this month', key: 'denied', pressed: showing('denied'),
      tone: c.denied ? 'critical' : '',
      sub: 'answered no this calendar month',
      title: 'Refused by the payer this calendar month — each one can be resubmitted' },
  ]);
}

/** Apply the card's slice, or clear back to the whole worklist. */
export const selectKpi = (state, key) => kpiFilter(state, KPI).select(key);
