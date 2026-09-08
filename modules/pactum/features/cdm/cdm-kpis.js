// The rail over the CDM list. Each card selects the rows it counts: the card
// sets the list's filters, so the number on the card and the row count under it
// are one figure, and a second click on the pressed card clears them again.
//
// It lives beside the list rather than in it the way home-kpis.js does, so the
// cards, the slices they select and the list are each one readable file.

import * as cdm from '../../../../data/repositories/cdm.js';
import { metricRailHtml, kpiFilter } from '../../../../shared/metric-card.js';

/** Card key -> the filter state that card selects. `all` is the cleared state. */
export const KPI = {
  all: { q: '', kind: '', category: '', status: '' },
  active: { status: 'Active' },
  inactive: { status: 'Inactive' },
  bundles: { kind: 'bundle' },
};

export function railHtml(state) {
  const { showing } = kpiFilter(state, KPI);
  const c = cdm.counts();
  return metricRailHtml([
    { value: c.total, label: 'Charge lines', key: 'all', pressed: showing('all'),
      title: 'Items and bundles on file — select to clear the filters' },
    { value: c.active, label: 'Active', key: 'active', pressed: showing('active'),
      title: 'Lines that can be billed today — select to list them' },
    { value: c.inactive, label: 'Inactive', key: 'inactive', pressed: showing('inactive'),
      tone: c.inactive > 4 ? 'warning' : '',
      title: 'Kept on file, excluded from pickers — select to list them' },
    { value: c.bundles, label: 'Bundles', key: 'bundles', pressed: showing('bundles'),
      tone: c.flagged ? 'critical' : '',
      title: `${c.flagged} flagged for review — select to list the bundles, or open the Bundles screen for their components` },
  ]);
}

/** Apply the card's slice, or clear back to the whole catalogue. */
export const selectKpi = (state, key) => kpiFilter(state, KPI).select(key);
