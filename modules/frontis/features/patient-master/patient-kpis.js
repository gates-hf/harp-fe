// The rail over Patient Master. Each card selects the rows it counts: the card
// sets the list's filters, so the number on the card and the row count under it
// are one figure, and a second click on the pressed card clears them again.
//
// The VIP card is drawn for the roles that may read a restricted record. A role
// without `canViewVip` can still find those patients in the list — it reads
// them masked — but a card counting them would be naming what it hides.

import * as patients from '../../../../data/repositories/patients.js';
import { metricRailHtml, kpiFilter } from '../../../../shared/metric-card.js';

/** Card key -> the filter state that card selects. `all` is the cleared state. */
export const KPI = {
  all: { q: '', status: '', gender: '', nationality: '', created: '', vip: false, includeMerged: false },
  active: { status: 'Active' },
  vip: { vip: true },
  blocked: { status: 'Blocked' },
  merged: { status: 'Merged', includeMerged: true },
};

export function railHtml(state, role) {
  const { showing } = kpiFilter(state, KPI);
  const c = patients.counts();
  const cards = [
    { value: c.total, label: 'Patients', key: 'all', pressed: showing('all'),
      sub: 'Registered, merged records aside',
      title: 'Every record in the register except the ones merged away — select to clear the filters' },
    { value: c.active, label: 'Active', key: 'active', pressed: showing('active'),
      sub: 'Can start an encounter',
      title: 'Records an encounter can be opened against — select to list them' },
  ];

  if (role?.canViewVip) {
    cards.push({ value: c.vip, label: 'VIP', key: 'vip', pressed: showing('vip'),
      sub: 'Restricted to your role',
      title: 'Records masked for roles without VIP access — select to list them' });
  }

  cards.push(
    { value: c.blocked, label: 'Blocked', key: 'blocked', pressed: showing('blocked'),
      tone: c.blocked ? 'warning' : '', sub: 'Registration to refer on',
      title: 'Records barred from registration until the block is lifted — select to list them' },
    { value: c.merged, label: 'Merged', key: 'merged', pressed: showing('merged'),
      sub: 'Folded into a survivor',
      title: 'Records merged into another MRN — select to list them with merged records shown' },
  );

  return metricRailHtml(cards);
}

/** Apply the card's slice, or clear back to every patient. */
export const selectKpi = (state, key) => kpiFilter(state, KPI).select(key);
