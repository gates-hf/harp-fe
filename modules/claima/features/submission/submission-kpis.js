// The rail over the submission workbench. Every card is a control: Ready
// value jumps to the queue panel it totals, Due today narrows the queue to
// the payers whose cycle falls today, Open batches narrows the batches table
// to what has not gone out, and Rejected opens the worklist that holds them —
// a card equals the rows under it, or links to the screen that does.

import * as batches from '../../../../data/repositories/batches.js';
import { metricRailHtml, kpiFilter } from '../../../../shared/metric-card.js';
import { usd } from '../../../../shared/format.js';

/** Card key -> the filter state that card selects. `all` is the cleared state. */
export const KPI = {
  all: { q: '', payerId: '', status: '', from: '', to: '', due: '' },
  due: { due: '1' },
  open: { status: 'open' },
};

export const blank = () => ({ ...KPI.all });

export function railHtml(state) {
  const { showing } = kpiFilter(state, KPI);
  const c = batches.counts();
  return metricRailHtml([
    { value: usd(c.readyValue), label: 'Ready value', key: 'ready', tone: c.readyCount ? 'info' : '',
      sub: `${c.readyCount} claim${c.readyCount === 1 ? '' : 's'} waiting for a batch`,
      title: 'Payer share of every Ready claim in no open batch — opens the queue' },
    { value: c.dueToday, label: 'Due today', key: 'due', pressed: showing('due'),
      tone: c.dueToday ? 'warning' : '',
      sub: 'payers whose cycle falls today',
      title: 'Payers with claims waiting whose submission cycle falls today' },
    { value: c.open, label: 'Open batches', key: 'open', pressed: showing('open'),
      sub: 'created or generated, not yet sent',
      title: 'Batches still on the desk — Open or Generated' },
    { value: c.rejected, label: 'Rejected', href: '#/claima/submission/rejections',
      tone: c.rejected ? 'critical' : '',
      sub: 'claims sent back, still to fix',
      title: 'Claims the payer sent back unprocessed — opens the rejections worklist' },
  ]);
}

/** Apply the card's slice, or clear back to the whole screen. */
export function selectKpi(state, key) {
  kpiFilter(state, KPI).select(key);
}
