// The transaction list behind a cell, in the shared drawer: the repository
// re-runs the row's own selector, so what opens is what was counted. Each
// line links to the record it came from — the account, the visit's capture
// pool, the batch, the remittance, the denial, the write-off, the
// nullification, the contract's hand-offs — and a prior-day line says so.

import * as businessDays from '../../../../data/repositories/business-days.js';
import { open as openDrawer } from '../../../../shared/drawer.js';
import { dateTime, esc, usd } from '../../../../shared/format.js';
import { moneyHtml } from './dtr-chips.js';

const REPO_LABEL = {
  ledger: 'Patient ledger', charges: 'Charge capture', batches: 'Submission batches', nullifications: 'Nullifications',
  remittances: 'Remittances', unapplied: 'Unapplied cash', denials: 'Denials', handoffs: 'Defensio hand-offs',
  writeoffs: 'Write-offs', sessions: 'Cash sessions',
};

/** openDrill(drill, title) — the drawer. Resolves when it closes. */
export function openDrill(drill, title = '') {
  const txs = businessDays.drill(drill);
  const total = Math.round(txs.reduce((n, t) => n + (Number(t.amount) || 0), 0) * 100) / 100;
  const sheet = openDrawer({
    title: title || 'Transactions',
    sub: `${REPO_LABEL[drill?.repo] || drill?.repo || 'Register'} · ${drill?.filter?.date || ''} · ${txs.length} row${txs.length === 1 ? '' : 's'} · ${usd(total)}`,
    icon: 'receipt_long',
    body: listHtml(txs),
  });
  return sheet.closed;
}

export function listHtml(txs) {
  if (!txs.length) {
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">search_off</span></div>
        <div class="state-view__title">Nothing behind this cell</div>
        <p class="state-view__body">The row counted no transaction on this day.</p>
      </div>`;
  }
  return `
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">When</th>
          <th scope="col">Transaction</th>
          <th scope="col" class="num">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${txs.map((t) => `
          <tr>
            <td class="t-mono-sm">${dateTime(t.at)}</td>
            <td>
              ${t.href ? `<a class="crumb-link" href="${esc(t.href)}">${esc(t.label)}</a>` : esc(t.label)}
              ${t.priorDay ? '<span class="badge badge--warning" title="Posted after an earlier day closed">Prior-day</span>' : ''}
              ${t.sub ? `<br><span class="t-body-sm">${esc(t.sub)}</span>` : ''}
            </td>
            <td class="num">${moneyHtml(t.amount, { zero: usd(0) })}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}
