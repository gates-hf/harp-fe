// The rail over the accounts list. Each card selects the accounts it counts, so
// the figure on the card and the rows under it are the same set, and a second
// click on the pressed card clears the filters again.
//
// Two of the four say money rather than a row count — an outstanding total and
// the deposits held are sums, not headcounts — so their sub-line names the
// number of accounts under them. That is the pairing the design system's card
// already has: the value is what the desk is looking at, the footer line says
// what it is a sum over.

import * as accounts from '../../../../data/repositories/accounts.js';
import { metricRailHtml, kpiFilter } from '../../../../shared/metric-card.js';
import { usd } from '../../../../shared/format.js';

export const blank = () => ({
  q: '', outstanding: 'any', flag: '', from: '', to: '', holdingDeposit: false, activeToday: false,
});

/** Card key -> the filter state that card selects. `all` is the cleared state. */
export const kpiMap = () => ({
  all: blank(),
  outstanding: { outstanding: 'owing' },
  over: { outstanding: 'over' },
  deposits: { holdingDeposit: true },
  today: { activeToday: true },
});

export function railHtml(state) {
  const { showing } = kpiFilter(state, kpiMap());
  const c = accounts.counts();
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return metricRailHtml([
    { value: usd(c.outstanding), label: 'Outstanding', key: 'outstanding', pressed: showing('outstanding'),
      tone: c.outstanding > 0 ? 'warning' : '', sub: `${plural(c.withOutstanding, 'account')} owing`,
      title: 'What patients still owe across every account — select the accounts carrying it' },
    { value: c.overThreshold, label: `Over ${usd(c.threshold)}`, key: 'over', pressed: showing('over'),
      tone: c.overThreshold ? 'critical' : '', sub: 'past the follow-up threshold',
      title: `Accounts owing more than ${usd(c.threshold)} — select to list them` },
    { value: usd(c.depositsHeld), label: 'Deposits held', key: 'deposits', pressed: showing('deposits'),
      sub: `${plural(c.holdingDeposit, 'account')} holding one`,
      title: 'Money taken and not yet applied to a charge — select the accounts holding it' },
    { value: usd(c.paymentsToday), label: 'Taken today', key: 'today', pressed: showing('today'),
      sub: `${plural(c.paymentsTodayCount, 'receipt')} issued`,
      title: 'Payments and deposits taken today — select the accounts they were taken on' },
  ]);
}

/** Apply the card's slice, or clear back to every account. */
export const selectKpi = (state, key) => kpiFilter(state, kpiMap()).select(key);
