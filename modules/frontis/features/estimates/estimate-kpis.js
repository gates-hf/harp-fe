// The rail over the estimates list. Each card selects the rows it counts, so
// the number on the card and the row count under it are one figure, and a
// second click on the pressed card clears the filters again.
//
// Three of the four slices are facts about today rather than fields on the row
// — still valid, about to lapse, converted this month — so the map is built on
// demand and the search carries them as its own flags: a demo left open
// overnight must not go on filtering to the day it started.

import * as estimates from '../../../../data/repositories/estimates.js';
import { metricRailHtml, kpiFilter } from '../../../../shared/metric-card.js';

export const blank = () => ({
  q: '', status: '', payerId: '', creator: '', from: '', to: '',
  live: false, expiring: false, convertedMonth: false,
});

/** Card key -> the filter state that card selects. `all` is the cleared state. */
export const kpiMap = () => ({
  all: blank(),
  live: { live: true },
  drafts: { status: 'Draft' },
  expiring: { expiring: true },
  converted: { convertedMonth: true },
});

export function railHtml(state) {
  const { showing } = kpiFilter(state, kpiMap());
  const c = estimates.counts();
  return metricRailHtml([
    { value: c.live, label: 'Issued and valid', key: 'live', pressed: showing('live'),
      sub: 'quotations in force',
      title: 'Estimates issued and still inside their validity — select to list them' },
    { value: c.drafts, label: 'Drafts', key: 'drafts', pressed: showing('drafts'),
      tone: c.drafts ? 'warning' : '', sub: 'priced, not yet issued',
      title: 'Estimates still being worked on at the desk — select to list them' },
    { value: c.expiring, label: `Expiring in ${estimates.EXPIRING_DAYS} days`, key: 'expiring',
      pressed: showing('expiring'), tone: c.expiring ? 'warning' : '', sub: 'reissue before they lapse',
      title: `Valid estimates with ${estimates.EXPIRING_DAYS} days or less left — select to list them` },
    { value: c.converted, label: 'Converted this month', key: 'converted', pressed: showing('converted'),
      sub: 'became an encounter',
      title: 'Estimates the patient accepted and the desk opened a visit from — select to list them' },
  ]);
}

/** Apply the card's slice, or clear back to every estimate. */
export const selectKpi = (state, key) => kpiFilter(state, kpiMap()).select(key);
