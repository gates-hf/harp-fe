// The rail over Payer Master. Each card selects the rows it counts: the card
// sets the list's filters, so the number on the card and the row count under it
// are one figure, and a second click on the pressed card clears them again.
//
// "With active plans" has no select of its own — the card is its own control,
// and Clear filters clears it with the rest.

import * as payers from '../../../../data/repositories/payers.js';
import { metricRailHtml, kpiFilter } from '../../../../shared/metric-card.js';

/** Card key -> the filter state that card selects. `all` is the cleared state. */
export const KPI = {
  all: { q: '', type: '', status: '', plans: false },
  active: { status: 'Active' },
  inactive: { status: 'Inactive' },
  plans: { plans: true },
};

export function railHtml(state) {
  const { showing } = kpiFilter(state, KPI);
  const c = payers.counts();
  return metricRailHtml([
    { value: c.total, label: 'Payers', key: 'all', pressed: showing('all'),
      title: 'Payers on file, active and inactive — select to clear the filters' },
    { value: c.active, label: 'Active', key: 'active', pressed: showing('active'),
      title: 'Payers other modules can bill — select to list them' },
    { value: c.inactive, label: 'Inactive', key: 'inactive', pressed: showing('inactive'),
      tone: c.inactive > 2 ? 'warning' : '',
      title: 'Excluded from pickers, still editable here — select to list them' },
    { value: c.withPlans, label: 'With active plans', key: 'plans', pressed: showing('plans'),
      title: `Payers carrying at least one active plan, ${c.activePlans} plans between them — select to list them` },
  ]);
}

/** Apply the card's slice, or clear back to every payer. */
export const selectKpi = (state, key) => kpiFilter(state, KPI).select(key);
