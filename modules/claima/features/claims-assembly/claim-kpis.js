// The rail over the claim portfolio. Three of the four cards select the rows
// they count — everything in assembly, what is Ready, what is Stale — so the
// number on the card and the row count under it are one figure, and a second
// click on the pressed card clears the filters. Average age summarises a
// column rather than a slice, so that card sorts the table by age instead.

import * as claims from '../../../../data/repositories/claims.js';
import { metricRailHtml, kpiFilter } from '../../../../shared/metric-card.js';
import { usd } from '../../../../shared/format.js';

/** Card key -> the filter state that card selects. `all` is the cleared state. */
export const KPI = {
  all: {
    q: '', view: 'assembly', status: '', payerId: '', scrub: '', band: '', age: '', kind: '', stale: '', from: '', to: '',
    sort: 'age', dir: 'desc',
  },
  assembly: {},
  ready: { status: 'Ready' },
  stale: { stale: '1' },
};

export const blank = () => ({ ...KPI.all });

export function railHtml(state) {
  const { showing } = kpiFilter(state, KPI);
  const s = claims.assemblyStats();
  return metricRailHtml([
    { value: usd(s.value), label: 'Value in assembly', key: 'assembly', pressed: showing('assembly'),
      sub: `${s.count} claim${s.count === 1 ? '' : 's'} not yet submitted`,
      title: 'Payer share of every Draft and Ready claim — the money still on the desk' },
    { value: s.readyCount, label: 'Ready', key: 'ready', pressed: showing('ready'),
      tone: s.readyCount ? 'success' : '',
      sub: `${usd(s.readyValue)} ready to submit`,
      title: 'Finalized and waiting for a submission batch' },
    { value: s.stale, label: 'Stale', key: 'stale', pressed: showing('stale'),
      tone: s.stale ? 'warning' : '',
      sub: 'changed since assembly — refresh',
      title: 'Claims whose coding or charges moved after they were assembled; refresh re-assembles them' },
    { value: `${s.avgAge} d`, label: 'Avg age', key: 'age-sort', pressed: state.sort === 'age',
      tone: s.avgAge > 14 ? 'warning' : '',
      sub: 'days since assembly, oldest first',
      title: 'Average days since assembly across everything in assembly — sorts the table by age' },
  ]);
}

/** Apply the card's slice, or clear back to the whole portfolio. */
export function selectKpi(state, key) {
  if (key === 'age-sort') {
    if (state.sort === 'age') state.dir = state.dir === 'desc' ? 'asc' : 'desc';
    else Object.assign(state, { sort: 'age', dir: 'desc' });
    return;
  }
  kpiFilter(state, KPI).select(key);
}
