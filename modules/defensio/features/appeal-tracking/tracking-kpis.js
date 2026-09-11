// The rail over the appeal tracking worklist — the header stats the
// amendment names: in flight, overdue, decided this month (by outcome in the
// tooltip), recovered this month, and the value still awaiting recovery.
// Every card selects the rows it counts, so the number on the card and the
// row count under it are one figure; a second click clears back.

import * as tracking from '../../../../data/repositories/appeal-tracking.js';
import { metricRailHtml, kpiFilter } from '../../../../shared/metric-card.js';
import { todayIso, usd } from '../../../../shared/format.js';

const monthStart = () => `${todayIso().slice(0, 7)}-01`;

/** Card key -> the filter state that card selects. `all` is the cleared state. */
export const KPI = {
  all: { q: '', payerId: '', status: '', outcome: '', recoveryState: '', overdue: false, from: '', to: '', decidedFrom: '', recoveredFrom: '', slice: '' },
  inFlight: { slice: 'inFlight' },
  overdue: { overdue: true, slice: 'inFlight' },
  decided: { slice: 'decided', decidedFrom: monthStart() },
  // The cases a remittance matched cash to this month — decided whenever; the card is about the cash.
  recovered: { recoveredFrom: monthStart() },
  awaiting: { recoveryState: 'AwaitingRemittance' },
};

export const blank = () => ({ ...KPI.all });

export function railHtml(state) {
  const { showing } = kpiFilter(state, KPI);
  const c = tracking.counts();
  const byOutcome = Object.entries(c.byOutcome).filter(([, n]) => n).map(([o, n]) => `${n} ${tracking.outcomeLabel(o).toLowerCase()}`).join(', ');
  return metricRailHtml([
    { value: c.inFlight, label: 'In flight', key: 'inFlight', pressed: showing('inFlight'),
      tone: c.inFlight ? 'info' : '', sub: `${usd(c.inFlightValue)} with the payers`,
      title: 'Appeals submitted and not yet answered — under review or waiting' },
    { value: c.overdue, label: 'Overdue', key: 'overdue', pressed: showing('overdue'),
      tone: c.overdue ? 'critical' : '', sub: c.overdue ? 'past the response window' : 'none past the response window',
      title: 'Submitted appeals whose payer has not answered inside its response window' },
    { value: c.decidedMtd, label: 'Decided MTD', key: 'decided', pressed: showing('decided'),
      tone: c.decidedMtd ? 'accent' : '', sub: byOutcome || 'none decided this month',
      title: `Decisions captured this month${byOutcome ? ` — ${byOutcome}` : ''}` },
    { value: usd(c.recoveredMtd.amount), label: 'Recovered MTD', key: 'recovered', pressed: showing('recovered'),
      tone: c.recoveredMtd.amount ? 'success' : '', sub: `${c.recoveredMtd.count} case${c.recoveredMtd.count === 1 ? '' : 's'} · ${c.recoveredMtd.remittances} remittance${c.recoveredMtd.remittances === 1 ? '' : 's'} matched`,
      title: 'Conceded money that landed this month, matched to a remittance posting by the hook' },
    { value: usd(c.awaitingValue), label: 'Awaiting recovery', key: 'awaiting', pressed: showing('awaiting'),
      tone: c.aging ? 'critical' : c.awaitingValue ? 'warning' : '',
      sub: c.aging ? `${c.aging} aging past ${tracking.recoveryAgingDays()} d` : `${c.awaiting} expected recover${c.awaiting === 1 ? 'y' : 'ies'} open`,
      title: 'Conceded on appeal and not yet paid — Defensio never posts cash; the remittance does' },
  ]);
}

export const selectKpi = (state, key) => kpiFilter(state, KPI).select(key);

/** The slices the repository has no single filter for. */
export function applySlice(rows, slice) {
  if (slice === 'inFlight') return rows.filter(tracking.isInFlight);
  if (slice === 'decided') return rows.filter((c) => Boolean(c.outcome));
  return rows;
}
