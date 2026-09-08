// The rail over the bundles list. Each card selects the rows it counts: the
// card sets the list's filters, so the number on the card and the row count
// under it are one figure, and a second click on the pressed card clears them.
//
// "Nested" has no select of its own — the card is its own control, and Clear
// filters clears it with the rest.

import * as cdm from '../../../../data/repositories/cdm.js';
import { metricRailHtml, kpiFilter } from '../../../../shared/metric-card.js';

/** Card key -> the filter state that card selects. `all` is the cleared state. */
export const KPI = {
  all: { q: '', type: '', status: '', flagged: '', nested: false },
  active: { status: 'Active' },
  flagged: { flagged: '1' },
  nested: { nested: true },
};

/** A bundle that holds another bundle — what the Nested card counts and lists. */
export const isNested = (b) => b.components.some((x) => cdm.isBundle(cdm.get(x.refId)));

export function railHtml(state) {
  const { showing } = kpiFilter(state, KPI);
  const all = cdm.list({ kind: 'bundle' });
  const flagged = cdm.counts().flagged;
  return metricRailHtml([
    { value: all.length, label: 'Bundles', key: 'all', pressed: showing('all'),
      title: 'Promotional offers and procedure compositions — select to clear the filters' },
    { value: all.filter((b) => b.status === 'Active').length, label: 'Active', key: 'active',
      pressed: showing('active'), title: 'Bundles that can be sold today — select to list them' },
    { value: flagged, label: 'Flagged', key: 'flagged', pressed: showing('flagged'),
      tone: flagged ? 'critical' : '',
      title: 'A component changed — select to list the bundles waiting for a look' },
    { value: all.filter(isNested).length, label: 'Nested', key: 'nested', pressed: showing('nested'),
      title: 'Bundles that hold another bundle — select to list them' },
  ]);
}

/** Apply the card's slice, or clear back to every bundle. */
export const selectKpi = (state, key) => kpiFilter(state, KPI).select(key);
