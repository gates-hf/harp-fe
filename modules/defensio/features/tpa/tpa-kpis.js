// The rail over the TPA ledger — what the administrators withheld against
// what their schedules allow, and the three slices the desk works: the
// open overcharge nobody has disputed yet, what is with an administrator on
// a dispute, and the fees no schedule version covers (the Unscheduled chip
// the amendment names). A card selects the rows it counts on the Accruals
// tab, so the number on the card and the row count under it are one
// figure; the two sums are plain numbers, since a total selects nothing.

import * as accruals from '../../../../data/repositories/tpa-fee-accruals.js';
import { metricRailHtml, kpiFilter } from '../../../../shared/metric-card.js';
import { usd } from '../../../../shared/format.js';

/** Card key -> the filter state that card selects on the Accruals tab. `all` is the cleared state. */
export const KPI = {
  all: { q: '', tpaId: '', payerId: '', state: '', from: '', to: '', slice: '', sort: 'overcharge' },
  variance: { slice: 'variance' },
  overcharged: { slice: 'overcharged' },
  disputed: { slice: 'disputed' },
  unscheduled: { slice: 'unscheduled' },
};

export const blank = () => ({ ...KPI.all });

export function railHtml(state, tab) {
  const { showing } = kpiFilter(state, KPI);
  const on = (key) => tab === 'accruals' && showing(key);
  const c = accruals.counts();
  return metricRailHtml([
    { value: usd(c.actual), label: 'Withheld by TPAs',
      sub: `${c.total} accrual${c.total === 1 ? '' : 's'} · expected ${usd(c.expected)}`,
      title: 'Every fee an administrator withheld, over the whole register, beside what the schedules allow for the same remittances' },
    { value: usd(c.variance), label: 'Variance', key: 'variance', pressed: on('variance'),
      tone: c.variance > 0 ? 'warning' : '',
      sub: `${c.overcharged + c.undercharged + c.disputed + c.settled + c.amended} past tolerance`,
      title: 'Withheld less expected across the register — the rows whose matching found an overcharge or an undercharge' },
    { value: usd(c.overchargeUndisputed), label: 'Overcharge open', key: 'overcharged', pressed: on('overcharged'),
      tone: c.overchargeUndisputed ? 'critical' : '',
      sub: c.overcharged ? `${c.overcharged} to dispute` : 'nothing waiting',
      title: 'Overcharged accruals nobody has raised with the administrator yet — tick them and dispute the selection' },
    { value: usd(c.disputedValue), label: 'In dispute', key: 'disputed', pressed: on('disputed'),
      tone: c.disputedValue ? 'warning' : '',
      sub: `${c.disputed} accrual${c.disputed === 1 ? '' : 's'} with the administrator`,
      title: 'Overcharge on a dispute raised or acknowledged and not yet settled' },
    { value: c.unscheduled, label: 'Unscheduled', key: 'unscheduled', pressed: on('unscheduled'),
      tone: c.unscheduled ? 'warning' : '',
      sub: c.unscheduled ? `${usd(c.unscheduledValue)} with no version to read against` : 'every fee has a version',
      title: 'Fees withheld on a date no schedule version covers — an amendment restating the period is what reads them' },
  ]);
}

export const selectKpi = (state, key) => kpiFilter(state, KPI).select(key);
