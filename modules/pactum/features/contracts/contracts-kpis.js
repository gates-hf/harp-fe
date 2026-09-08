// The rail over the global contracts list. Each card selects the rows it
// counts: the card sets the list's filters, so the number on the card and the
// row count under it are one figure, and a second click on the pressed card
// clears them again.
//
// "Payers covered" counts payers rather than contracts, so it is the one card
// that navigates instead of filtering — it opens Payer Master, which is where
// those rows live.

import * as contracts from '../../../../data/repositories/contracts.js';
import { metricRailHtml, kpiFilter } from '../../../../shared/metric-card.js';

/** Card key -> the filter state that card selects. `all` is the cleared state. */
export const KPI = {
  all: { q: '', payerType: '', expiring: '', status: '' },
  active: { status: 'Active' },
  expiring: { status: 'Active', expiring: '30' },
  draft: { status: 'Draft' },
};

export function railHtml(state) {
  const { showing } = kpiFilter(state, KPI);
  const c = contracts.counts();
  return metricRailHtml([
    { value: c.total, label: 'All contracts', key: 'all', pressed: showing('all'),
      title: 'Every version on file, drafts and closed ones included — select to clear the filters' },
    { value: c.active, label: 'Active', key: 'active', pressed: showing('active'),
      title: 'Contracts in force today — select to list them' },
    { value: c.expiring30, label: 'Expiring ≤30d', key: 'expiring', pressed: showing('expiring'),
      tone: c.expiring30 ? 'warning' : '',
      title: 'Active contracts ending within 30 days — select to list them' },
    { value: c.draft, label: 'Draft', key: 'draft', pressed: showing('draft'),
      title: 'Drafted, not yet activated — select to list them' },
    { value: c.payers, label: 'Payers covered', href: '#/pactum/payers',
      title: 'Payers holding at least one active contract — opens Payer Master' },
  ]);
}

/** Apply the card's slice, or clear back to every contract. */
export const selectKpi = (state, key) => kpiFilter(state, KPI).select(key);
