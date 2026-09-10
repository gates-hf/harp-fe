// The rail over the write-off worklist. Three cards select the rows they
// count — pending approval, approved and not yet posted, posted this month —
// so the number on the card and the row count under it are one figure; the
// fourth is the discretionary share of the year's postings, which is a rate
// over the whole register rather than a slice, so it opens the analytics that
// break it down.

import * as writeoffs from '../../../../data/repositories/writeoffs.js';
import { metricRailHtml, kpiFilter } from '../../../../shared/metric-card.js';
import { usd } from '../../../../shared/format.js';

const thisMonth = () => writeoffs.periodRange('MTD').from;

/** Card key -> the filter state that card selects. `all` is the cleared state. */
export const KPI = {
  all: { q: '', status: '', source: '', reasonCode: '', classification: '', band: '', side: '', from: '', to: '', mine: false },
  pending: { status: 'Pending Approval' },
  approved: { status: 'Approved' },
  posted: { status: 'Posted', from: thisMonth() },
};

export const blank = () => ({ ...KPI.all });

export function railHtml(state) {
  const { showing } = kpiFilter(state, KPI);
  const c = writeoffs.counts();
  return metricRailHtml([
    { value: usd(c.pendingValue), label: 'Pending approval', key: 'pending', pressed: showing('pending'),
      tone: c.pending ? 'warning' : '',
      sub: `${c.pending} request${c.pending === 1 ? '' : 's'}${c.mine ? ` · ${c.mine} for you` : ''}`,
      title: 'Requests waiting for a signature — the value asked for, over every tier' },
    { value: usd(c.approvedValue), label: 'Approved, unposted', key: 'approved', pressed: showing('approved'),
      tone: c.approved ? 'info' : '',
      sub: `${c.approved} to post`,
      title: 'Signed at every tier and not yet posted to the claim or the ledger' },
    { value: usd(c.postedMtdValue), label: 'Posted MTD', key: 'posted', pressed: showing('posted'),
      sub: `${c.postedMtd} this month`,
      title: 'Posted since the first of the month and standing — a reversed write-off is out' },
    { value: `${Math.round(c.discretionaryPct * 100)}%`, label: 'Discretionary', href: '#/claima/writeoffs/analytics',
      tone: c.discretionaryPct > 0.5 ? 'warning' : '',
      sub: `${usd(c.discretionaryValue)} of ${usd(c.postedYtdValue)} YTD`,
      title: 'The share of the year’s postings the hospital chose to let go rather than never had — opens the analytics' },
  ]);
}

export const selectKpi = (state, key) => kpiFilter(state, KPI).select(key);
