// Breakdowns — one dimension at a time: payer, department, service line,
// doctor or encounter type. The engine builds a world per slice value and
// runs the same definitions over it, so a row's figures reconcile with the
// overview's; the top-N chart under the table ranks the slices by denied
// value. A payer cell drills to the worklist narrowed to the payer; the
// other dimensions are not filters the worklist reads yet, so their links
// open it on the period's true denials and say so.

import * as engine from '../../../../data/engines/denial-analytics.js';
import { esc, usd } from '../../../../shared/format.js';
import { rankedBars } from './analytics-charts.js';
import { captionHtml, emptyHtml } from './analytics-format.js';

const COLUMNS = ['denialRateValue', 'denialRateCount', 'recoveryRate', 'avgResolutionDays', 'netDenialLoss', 'openExposure'];
const TOP_N = 8;

export function render(host, { range, period, payerId, slice, setSlice }) {
  const sliceBy = engine.SLICES.some((s) => s.key === slice) ? slice : 'payer';
  const r = engine.compute(COLUMNS, { period, payerId, sliceBy });
  const rows = r.slices || [];
  const top = rows.slice(0, TOP_N);
  host.innerHTML = `
    <div class="panel" id="db-panel">
      <div class="panel-header">
        <span>By ${esc(engine.SLICES.find((s) => s.key === sliceBy).label.toLowerCase())}</span>
        <span class="spacer"></span>
        <div class="segmented" role="group" aria-label="Slice by">
          ${engine.SLICES.map((s) => `<button type="button" data-slice="${s.key}" aria-pressed="${s.key === sliceBy}">${esc(s.label)}</button>`).join('')}
        </div>
      </div>
      ${rows.length ? `
      <table class="tbl">
        <thead>
          <tr>
            <th scope="col">${esc(engine.SLICES.find((s) => s.key === sliceBy).label)}</th>
            <th scope="col" class="num">Denials</th>
            <th scope="col" class="num">Denied</th>
            ${COLUMNS.map((k) => `<th scope="col" class="num" title="${esc(engine.metric(k).hint)}">${esc(engine.metric(k).short)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>${rows.map((s) => `
          <tr>
            <td>${link(s, sliceBy, `#/defensio/denials?separation=True${sliceBy === 'payer' ? `&payerId=${encodeURIComponent(s.key)}` : payerId ? `&payerId=${payerId}` : ''}`, esc(s.label))}</td>
            <td class="num">${s.count}</td>
            <td class="num t-mono-sm">${esc(usd(s.denied))}</td>
            ${COLUMNS.map((k) => { const f = s.figures[k]; return `<td class="num t-mono-sm">${link(s, sliceBy, f.href, esc(f.text), `${f.label}: ${f.count} record${f.count === 1 ? '' : 's'}`)}</td>`; }).join('')}
          </tr>`).join('')}</tbody>
      </table>` : `<div class="panel-body">${emptyHtml('Nothing to break down', 'No denial landed in this period for the payer chosen above.')}</div>`}
    </div>
    ${top.length ? `
    <div class="panel">
      <div class="panel-header"><span>Top ${top.length} by denied value</span><span class="spacer"></span><span class="t-body-sm">${esc(range.from)} → ${esc(range.to)}</span></div>
      <div class="panel-body">
        ${rankedBars(top.map((s) => ({ label: s.label, value: s.denied, text: usd(s.denied), href: sliceBy === 'payer' ? `#/defensio/denials?separation=True&payerId=${encodeURIComponent(s.key)}` : '' })))}
      </div>
    </div>` : ''}`;

  // The picker's listener rides on the panel it sits in, so it retires with the panel when the next view draws.
  host.querySelector('#db-panel').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-slice]');
    if (btn && btn.dataset.slice !== sliceBy) setSlice(btn.dataset.slice);
  });

  const csv = [
    [engine.SLICES.find((s) => s.key === sliceBy).label, 'Denials', 'Denied', ...COLUMNS.map((k) => engine.metric(k).label)],
    ...rows.map((s) => [s.label, s.count, s.denied, ...COLUMNS.map((k) => (s.figures[k].value == null ? '' : s.figures[k].value))]),
  ];
  return { csv, name: `denial-analytics-by-${sliceBy}-${range.from}-${range.to}.csv`, caption: captionHtml(r.boundaries, `${rows.length} ${esc(engine.SLICES.find((s) => s.key === sliceBy).label.toLowerCase())} slice${rows.length === 1 ? '' : 's'} with a denial in the period`) };
}

/** A cell as a link: narrowed to the payer when the slice is one; otherwise the worklist on the period's true denials, with the caveat in the tooltip. */
function link(s, sliceBy, href, text, what = '') {
  const title = sliceBy === 'payer' ? `${what ? `${what} — ` : ''}open the worklist on ${s.label}` : `${what ? `${what} — ` : ''}opens the worklist on the period's true denials; ${engine.SLICES.find((x) => x.key === sliceBy).label.toLowerCase()} is not a filter it reads yet`;
  return `<a class="crumb-link" href="${esc(href)}" title="${esc(title)}">${text}</a>`;
}
