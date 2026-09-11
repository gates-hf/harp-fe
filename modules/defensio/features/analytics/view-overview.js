// Overview — the ten definitions as cards, each with its delta against the
// period before and a link into the records behind it, and the monthly
// trend: what landed against what came back in cash, month by month, with
// the figures under the chart. Everything is the engine's.

import * as engine from '../../../../data/engines/denial-analytics.js';
import { metricRailHtml } from '../../../../shared/metric-card.js';
import { esc, usd } from '../../../../shared/format.js';
import { deltaArrow, legend, monthColumns } from './analytics-charts.js';
import { captionHtml, pct } from './analytics-format.js';

const TONE = { critical: 'critical', warning: 'warning' };

export function render(host, { period, compare, payerId, range }) {
  const r = engine.compute(engine.METRIC_KEYS, { period, compare: compare ? 'prior' : null, payerId });
  const months = Math.max(6, engine.monthsOf(range).length);
  const trend = engine.trend({ months, to: range.to, payerId });
  const cards = engine.METRIC_KEYS.map((key) => card(r.figures[key], compare));
  host.innerHTML = `
    <div class="metric-rail">${metricRailHtml(cards.slice(0, 5))}</div>
    <div class="metric-rail">${metricRailHtml(cards.slice(5))}</div>
    <div class="panel">
      <div class="panel-header">
        <span>Monthly trend</span>
        <span class="t-body-sm">${legend('Denied (intake)', 'Recovered (cash)')}</span>
        <span class="spacer"></span>
        <span class="t-body-sm">${months} months to ${esc(range.to)}</span>
      </div>
      <div class="panel-body">
        ${monthColumns(trend.map((m) => ({ label: m.label, a: m.deniedValue, b: m.recovered, title: `${m.label} — ${m.deniedCount} denial${m.deniedCount === 1 ? '' : 's'} worth ${usd(m.deniedValue)}, ${usd(m.recovered)} recovered in cash, ${m.reclassifiedCount} separated out` })))}
      </div>
      <div class="panel-body">
        <table class="tbl">
          <thead><tr><th scope="col">Month</th><th scope="col" class="num">Denials</th><th scope="col" class="num">Denied</th><th scope="col" class="num">Denial rate $</th><th scope="col" class="num">Recovered (cash)</th><th scope="col" class="num">Lost + written off</th><th scope="col" class="num">Separated out</th></tr></thead>
          <tbody>${trend.map((m) => `
            <tr>
              <td>${esc(m.label)} ${esc(m.key.slice(0, 4))}</td>
              <td class="num">${m.deniedCount}</td>
              <td class="num t-mono-sm">${esc(usd(m.deniedValue))}</td>
              <td class="num t-mono-sm" title="${esc(`${usd(m.deniedValue)} over ${usd(m.adjudicatedValue)} answered on ${m.adjudicatedCount} claims`)}">${pct(m.denialRateValue)}</td>
              <td class="num t-mono-sm">${esc(usd(m.recovered))}</td>
              <td class="num t-mono-sm">${esc(usd(m.lost))}</td>
              <td class="num t-mono-sm">${m.reclassifiedCount ? `${m.reclassifiedCount} · ${esc(usd(m.reclassifiedValue))}` : '—'}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>`;

  const csv = [
    ['Metric', 'Boundary', 'Value', 'Records', 'Prior', 'Delta', 'Period from', 'Period to', 'Payer'],
    ...engine.METRIC_KEYS.map((key) => { const f = r.figures[key]; return [f.label, f.dateBoundary, f.text, f.count, f.prior?.text || '', f.deltaText || '', range.from, range.to, payerId || 'All']; }),
    [],
    ['Month', 'Denials', 'Denied', 'Denial rate $', 'Recovered (cash)', 'Lost + written off', 'Separated out', 'Separated value'],
    ...trend.map((m) => [m.key, m.deniedCount, m.deniedValue, m.denialRateValue == null ? '' : m.denialRateValue, m.recovered, m.lost, m.reclassifiedCount, m.reclassifiedValue]),
  ];
  return { csv, name: `denial-analytics-overview-${range.from}-${range.to}.csv`, caption: captionHtml(r.boundaries, `${compare ? `deltas against ${esc(r.prior.label)} · ` : ''}denial rates by intake date — Pactum Performance reports by date of service, so its year-to-date figure is a different clock, not a different register`) };
}

/** One card: the figure with its arrow, the delta under the label, the drill href on the card. A pending figure says which amendment it waits on. */
function card(f, compare) {
  if (f.pending) {
    return { value: 'Pending', text: true, label: f.short, sub: `arrives with amendment ${f.pending}`, title: `${f.label} — ${f.hint}`, href: f.href };
  }
  const value = compare && f.delta != null ? `${esc(f.text)} ${deltaArrow(f.delta, { goodWhenUp: engine.GOOD_WHEN_UP.has(f.key) })}` : esc(f.text);
  const sub = compare ? (f.delta == null ? `${f.count} record${f.count === 1 ? '' : 's'} · nothing before` : `${f.deltaText} vs ${f.prior.text}`) : `${f.count} record${f.count === 1 ? '' : 's'}`;
  const tone = compare && f.improved === false ? TONE.warning : '';
  return { value, raw: true, label: f.short, sub, tone, href: f.href, title: `${f.label} (${f.dateBoundary}) — ${f.hint}${compare && f.prior ? ` Before: ${f.prior.text} over ${f.prior.count} record${f.prior.count === 1 ? '' : 's'}.` : ''} Opens the records behind it.` };
}
