// The rail over the Defensio denial worklist — the five figures the
// amendment names: open, untriaged, recovered this month, written off this
// month, separated out this month. Every card selects the rows it counts, so
// the number on the card and the row count under it are one figure, and a
// second click on the pressed card clears back to the whole list.

import * as denials from '../../../../data/repositories/denials.js';
import { metricRailHtml, kpiFilter } from '../../../../shared/metric-card.js';
import { todayIso, usd } from '../../../../shared/format.js';

/** Card key -> the filter state that card selects. `all` is the cleared state. */
export const KPI = {
  all: {
    q: '', payerId: '', status: '', class: '', code: '', rootCauseId: '', route: '', band: '', from: '', to: '',
    deadline: '', assignee: '', tier: '', category: '', separation: '', open: false, resolvedFrom: '', slice: '',
  },
  open: { open: true, slice: 'open' },
  untriaged: { status: 'Untriaged' },
  recovered: { slice: 'recovered', resolvedFrom: `${todayIso().slice(0, 7)}-01` },
  writtenOff: { status: 'Written Off', resolvedFrom: `${todayIso().slice(0, 7)}-01` },
  reclassified: { status: 'Reclassified', resolvedFrom: `${todayIso().slice(0, 7)}-01` },
};

export const blank = () => ({ ...KPI.all });

export function railHtml(state) {
  const { showing } = kpiFilter(state, KPI);
  const c = denials.counts();
  return metricRailHtml([
    { value: usd(c.openValue), label: 'Open value', key: 'open', pressed: showing('open'),
      tone: c.openValue ? 'warning' : '',
      sub: `${c.open} open denial${c.open === 1 ? '' : 's'}`,
      title: 'What is still open across every unresolved denial — the rows a triage or a route can still move' },
    { value: c.untriaged, label: 'Untriaged', key: 'untriaged', pressed: showing('untriaged'),
      tone: c.untriaged ? 'critical' : '',
      sub: c.nearDeadline ? `${c.nearDeadline} near the appeal deadline` : 'none near the appeal deadline',
      title: 'Denials nobody has separated, tiered and classed yet — they sit first on the list' },
    { value: usd(c.recoveredMtd.amount), label: 'Recovered MTD', key: 'recovered', pressed: showing('recovered'),
      tone: c.recoveredMtd.amount ? 'success' : '',
      sub: `${c.recoveredMtd.count} resolved this month`,
      title: 'Money recovered on denials resolved this month — in full or in part' },
    { value: usd(c.writtenOffMtd.amount), label: 'Written off MTD', key: 'writtenOff', pressed: showing('writtenOff'),
      tone: c.writtenOffMtd.amount ? 'critical' : '',
      sub: `${c.writtenOffMtd.count} written off this month`,
      title: 'Denials written off this month — approved through the write-off tiers' },
    { value: usd(c.reclassifiedMtd.amount), label: 'Separated out MTD', key: 'reclassified', pressed: showing('reclassified'),
      tone: c.reclassifiedMtd.amount ? 'info' : '',
      sub: `${c.reclassifiedMtd.count} reclassified this month`,
      title: 'Contractual adjustments and TPA fees separated out this month — money that was never a denial' },
  ]);
}

export const selectKpi = (state, key) => kpiFilter(state, KPI).select(key);

/** The slices the repository has no single filter for, applied over its rows. */
export function applySlice(rows, slice) {
  if (slice === 'progress') return rows.filter((d) => d.status === 'Routed' || d.status === 'In Progress');
  if (slice === 'recovered') return rows.filter((d) => d.status === 'Recovered' || d.status === 'Partially Recovered');
  return rows;
}
