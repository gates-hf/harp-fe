// The rail over Standard Codes. Each card selects the rows it counts: the card
// sets the list's filters, so the number on the card and the row count under it
// are one figure, and a second click on the pressed card clears them again.
//
// "No current version" is the highlight the amendment asks for: an active
// system nobody can resolve on cleanly, painted critical while there is one.
// It has no select of its own — the card is its own control, and Clear filters
// clears it with the rest. Codes in force is a plain number: nothing on this
// list is a code.

import * as codes from '../../../../data/repositories/standard-codes.js';
import { metricRailHtml, kpiFilter } from '../../../../shared/metric-card.js';

/** Card key -> the filter state that card selects. `all` is the cleared state. */
export const KPI = {
  all: { q: '', systemType: '', status: '', noCurrent: false },
  active: { status: 'Active' },
  inactive: { status: 'Inactive' },
  noCurrent: { noCurrent: true },
};

export function railHtml(state) {
  const { showing } = kpiFilter(state, KPI);
  const c = codes.systemCounts();
  return metricRailHtml([
    { value: c.total, label: 'Code systems', key: 'all', pressed: showing('all'),
      title: 'Every code system on file, active and inactive — select to clear the filters' },
    { value: c.active, label: 'Active', key: 'active', pressed: showing('active'),
      title: 'Systems a lookup may resolve on — select to list them' },
    { value: c.inactive, label: 'Inactive', key: 'inactive', pressed: showing('inactive'),
      title: 'Retired systems, still readable here — select to list them' },
    { value: c.noCurrent, label: 'No current version', key: 'noCurrent', pressed: showing('noCurrent'),
      tone: c.noCurrent ? 'critical' : '',
      sub: c.noCurrent ? 'lookups fall back with a warning' : 'every active system resolves',
      title: 'Active systems with no version marked current — a lookup falls back to the newest active version and warns, or finds nothing. Select to list them' },
    { value: c.codesInForce, label: 'Codes in force', sub: `across ${c.currentVersions} current version${c.currentVersions === 1 ? '' : 's'}`,
      title: 'Active codes on the current versions — what a lookup with no date answers from' },
  ]);
}

/** Apply the card's slice, or clear back to every system. */
export const selectKpi = (state, key) => kpiFilter(state, KPI).select(key);
