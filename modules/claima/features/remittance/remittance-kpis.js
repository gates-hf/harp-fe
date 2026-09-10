// The rail over the remittance workbench. Unposted selects the rows it counts
// and Unposted value is the same slice read as money; Exceptions open selects
// the remittances still carrying one; Unapplied cash opens the screen that
// holds it, since the rows it counts are not on this table.

import * as remittances from '../../../../data/repositories/remittances.js';
import { metricRailHtml, kpiFilter } from '../../../../shared/metric-card.js';
import { usd } from '../../../../shared/format.js';

/** Card key -> the filter state that card selects. `all` is the cleared state. */
export const KPI = {
  all: { q: '', payerId: '', status: '', from: '', to: '', unapplied: '', exceptions: '' },
  unposted: { status: 'Unposted' },
  exceptions: { exceptions: '1' },
};

export const blank = () => ({ ...KPI.all });

export function railHtml(state) {
  const { showing } = kpiFilter(state, KPI);
  const c = remittances.counts();
  return metricRailHtml([
    { value: c.unposted, label: 'Unposted', key: 'unposted', pressed: showing('unposted'),
      tone: c.unposted ? 'warning' : '',
      sub: 'captured, waiting to be posted',
      title: 'Remittances captured from a file or by hand and not yet posted — select to list them' },
    { value: usd(c.unpostedValue), label: 'Unposted value', key: 'unposted', pressed: showing('unposted'),
      sub: 'payer cash not yet on a claim',
      title: 'The payment totals of every unposted remittance' },
    { value: c.exceptionsOpen, label: 'Exceptions open', key: 'exceptions', pressed: showing('exceptions'),
      tone: c.exceptionsOpen ? 'critical' : '',
      sub: `on ${c.withExceptions} remittance${c.withExceptions === 1 ? '' : 's'}`,
      title: 'Ambiguous or unmatched rows and overpayments still to resolve — select the remittances carrying one' },
    { value: usd(c.unappliedCash), label: 'Unapplied cash', href: '#/claima/remittances/unapplied',
      tone: c.unappliedCash ? 'warning' : '',
      sub: `${c.unappliedRows} row${c.unappliedRows === 1 ? '' : 's'} held — open`,
      title: 'Cash no claim accounts for, held by payer — opens the unapplied cash screen' },
  ]);
}

export const selectKpi = (state, key) => kpiFilter(state, KPI).select(key);
