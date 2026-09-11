// The rail over the appeals workbench — four figures: the cases still to
// file and what they dispute, the ones inside the warning window or past
// it, the reviews waiting on the signed-in role, and what went to the payer
// this month. Every card selects the rows it counts, so the number on the
// card and the row count under it are one figure; a second click clears.

import * as appealCases from '../../../../data/repositories/appeal-cases.js';
import { metricRailHtml, kpiFilter } from '../../../../shared/metric-card.js';
import { todayIso, usd } from '../../../../shared/format.js';

/** Card key -> the filter state that card selects. `all` is the cleared state. */
export const KPI = {
  all: { q: '', payerId: '', status: '', level: '', tier: '', deadline: '', preparer: '', from: '', to: '', scope: 'active', slice: '' },
  active: { scope: 'active' },
  due: { scope: 'active', slice: 'due' },
  mine: { scope: 'active', status: 'InReview', slice: 'mine' },
  submitted: { scope: 'submitted', from: `${todayIso().slice(0, 7)}-01` },
};

export const blank = () => ({ ...KPI.all });

export function railHtml(state) {
  const { showing } = kpiFilter(state, KPI);
  const c = appealCases.counts();
  return metricRailHtml([
    { value: c.active, label: 'Cases to file', key: 'active', pressed: showing('active'),
      sub: `${usd(c.activeValue)} disputed`,
      title: 'Cases not yet with the payer — drafts, returned, in review and approved' },
    { value: c.dueSoon, label: 'Due soon', key: 'due', pressed: showing('due'),
      tone: c.dueSoon ? 'critical' : '',
      sub: c.dueSoon ? `${usd(c.dueSoonValue)} inside ${appealCases.warnDays()} days or past` : `nothing inside ${appealCases.warnDays()} days`,
      title: 'Cases to file whose deadline is inside the warning window, or already past' },
    { value: c.awaitingMe, label: 'Awaiting my review', key: 'mine', pressed: showing('mine'),
      tone: c.awaitingMe ? 'warning' : '',
      sub: `${c.inReview} in review in all`,
      title: 'Cases in review the signed-in role can sign — at its tier, and not its own' },
    { value: c.submittedMtd.count, label: 'Submitted MTD', key: 'submitted', pressed: showing('submitted'),
      tone: c.submittedMtd.count ? 'info' : '',
      sub: `${usd(c.submittedMtd.amount)} disputed · ${c.submitted} with the payer in all`,
      title: 'Cases filed with a payer this month' },
  ]);
}

export const selectKpi = (state, key) => kpiFilter(state, KPI).select(key);

/** The slices the repository has no single filter for, applied over its rows. */
export function applySlice(rows, slice, role) {
  if (slice === 'due') return rows.filter((a) => { const dl = appealCases.deadlineOf(a); return dl.warn || dl.passed; });
  if (slice === 'mine') return rows.filter((a) => appealCases.canReview(a, role).ok);
  return rows;
}
