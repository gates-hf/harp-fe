// The per-line entry grid: one table per claim row on an unposted remittance,
// with the payer's answer typed against each of our lines — paid, adjustment
// and its code, denied and its code — and the row's running figures under it.
// Manual entry draws it for every row; the remittance page draws it for a row
// that still needs entering. `readLines` reads the inputs back for
// remittances.updateLines.

import * as remittances from '../../../../data/repositories/remittances.js';
import * as denials from '../../../../data/repositories/denials.js';
import { esc, usd } from '../../../../shared/format.js';
import { matchHtml, money } from './remittance-chips.js';

const codeOptions = (list, chosen) =>
  `<option value="">No code</option>${list.map((c) =>
    `<option value="${esc(c.code)}"${c.code === chosen ? ' selected' : ''}>${esc(c.code)} · ${esc(c.label)}</option>`).join('')}`;

/** One claim row's grid. `removable` offers the remove button (an unposted row only). */
export function entryTableHtml(row, { removable = true } = {}) {
  const sum = (key) => row.lines.reduce((n, l) => n + (Number(l[key]) || 0), 0);
  const expected = sum('expected');
  const key = remittances.keyOf(row);
  return `
    <div class="panel" data-entry="${esc(key)}">
      <div class="panel-header">
        <span class="t-mono-sm">${esc(row.claimNo || row.payerClaimRef)}</span>
        ${matchHtml(row.matchStatus, row.matchStatus === 'Ambiguous' ? `${row.candidates.length} candidates` : '')}
        <span class="t-body-sm">payer ref ${esc(row.payerClaimRef || '—')}</span>
        <span class="spacer"></span>
        <span class="t-body-sm">expected ${esc(usd(expected))}</span>
        ${removable ? `<button class="btn btn--ghost btn--icon btn--sm" data-act="remove-row" data-key="${esc(key)}" title="Take this claim off the remittance">
          <span class="icon icon--sm">delete</span></button>` : ''}
      </div>
      <table class="tbl">
        <thead>
          <tr>
            <th scope="col">Line</th>
            <th scope="col">Charge</th>
            <th scope="col">Billed</th>
            <th scope="col">Expected</th>
            <th scope="col">Paid</th>
            <th scope="col">Adjustment · code</th>
            <th scope="col">Denied · code</th>
          </tr>
        </thead>
        <tbody>${row.lines.map((l) => lineHtml(l, row.matchStatus === 'Matched')).join('')}</tbody>
      </table>
    </div>`;
}

function lineHtml(l, matched) {
  const id = l.claimLineId || l.lineRef || '';
  const off = matched && l.claimLineId ? '' : ' disabled title="Match the row to a claim before entering its lines"';
  return `
    <tr data-line="${esc(id)}">
      <td class="t-mono-sm">${esc(l.lineRef || l.claimLineId || '—')}${l.claimLineId ? '' : ' <span class="badge badge--critical" title="No line on the claim answers this one">unmatched</span>'}</td>
      <td class="t-mono-sm">${esc(l.chargeCode || '—')}</td>
      <td>${money(l.billed)}</td>
      <td>${money(l.expected)}</td>
      <td><label class="field"><input type="number" step="0.01" min="0" name="paid" value="${num(l.paid)}" aria-label="Paid"${off}></label></td>
      <td>
        <label class="field"><input type="number" step="0.01" min="0" name="adjustment" value="${num(l.adjustment)}" placeholder="Amount" aria-label="Adjustment"${off}></label>
        <label class="field"><select name="adjCode" aria-label="Adjustment code"${off}>${codeOptions(remittances.adjCodes(), l.adjCode)}</select></label>
      </td>
      <td>
        <label class="field"><input type="number" step="0.01" min="0" name="denied" value="${num(l.denied)}" placeholder="Amount" aria-label="Denied"${off}></label>
        <label class="field"><select name="denialCode" aria-label="Denial code"${off}>${codeOptions(denials.DENIAL_CODES, l.denialCode)}</select></label>
      </td>
    </tr>`;
}

const num = (n) => (Number(n) ? String(Number(n)) : '');

/** The inputs of one grid, read back as line patches. */
export function readLines(table) {
  return [...table.querySelectorAll('tr[data-line]')].map((tr) => {
    const v = (name) => tr.querySelector(`[name="${name}"]`)?.value;
    return {
      claimLineId: tr.dataset.line, lineRef: tr.dataset.line,
      paid: Number(v('paid')) || 0, adjustment: Number(v('adjustment')) || 0, adjCode: v('adjCode') || null,
      denied: Number(v('denied')) || 0, denialCode: v('denialCode') || null,
    };
  });
}

/** What the grid says is wrong before it is saved — the first reason, or ''. */
export function entryError(lines) {
  for (const l of lines) {
    if (l.adjustment > 0 && !l.adjCode) return `${l.lineRef}: an adjustment needs its reason code`;
    if (l.denied > 0 && !l.denialCode) return `${l.lineRef}: a denied amount needs its denial code`;
    if (l.paid < 0 || l.adjustment < 0 || l.denied < 0) return `${l.lineRef}: amounts cannot be negative`;
  }
  return '';
}

/**
 * The strip under the grids: what the rows account for against the payment.
 * `over` is the one thing that blocks posting, so it is the one thing painted.
 */
export function controlStripHtml(rem) {
  const c = remittances.control(rem);
  const tone = c.over ? 'critical' : c.unapplied > 0 ? 'warning' : 'success';
  return `
    <div class="alert alert--${tone}" id="control-strip">
      <span class="icon">${c.over ? 'error' : c.unapplied > 0 ? 'account_balance_wallet' : 'check_circle'}</span>
      <div>
        <div class="title">${c.over
          ? `Over by ${esc(usd(c.over))} — the rows say more was paid than the payment carries`
          : c.unapplied > 0 ? `${esc(usd(c.unapplied))} not accounted for — held as unapplied cash when posted`
            : 'The rows account for the whole payment'}</div>
        Payment ${esc(usd(c.total))} · paid on the rows ${esc(usd(c.paid))} · adjusted ${esc(usd(c.adjusted))} · denied ${esc(usd(c.denied))}
        · entered ${esc(usd(c.entered))} · remaining ${esc(usd(c.unapplied))}
      </div>
    </div>`;
}
