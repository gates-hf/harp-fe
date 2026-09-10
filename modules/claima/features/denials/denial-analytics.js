// Denial analytics at #/claima/denials/analytics — a period, the monthly
// trend, payer reasons beside root causes, the four breakdowns, the repeat
// patterns and the prevention feed, with a CSV export and a footnote that
// reconciles the register with Pactum Performance's denial figures. Every
// number is data/repositories/denials.js's analytics() over one range;
// Performance's are read from its own engine for the footnote and never
// restated.

import * as denials from '../../../../data/repositories/denials.js';
import * as claims from '../../../../data/repositories/claims.js';
import * as performance from '../../../../data/engines/performance-engine.js';
import { esc, todayIso, usd } from '../../../../shared/format.js';
import { metricRailHtml } from '../../../../shared/metric-card.js';
import { toast } from '../../../../shared/toast.js';
import { columnsLegend, monthColumns, pct } from './denial-charts.js';
import { csvOf, download, groupTableHtml, preventionHtml, repeatsHtml } from './analytics-tables.js';

export const meta = { title: 'Denial analytics' };

/** Performance's two periods, then two the desk works in. */
const PERIODS = [
  { id: 'YTD', label: 'Year to date' },
  { id: 'lastQuarter', label: 'Last quarter' },
  { id: 'last90', label: 'Last 90 days' },
  { id: 'last30', label: 'Last 30 days' },
];

function rangeOf(period) {
  if (performance.PERIODS.includes(period)) return performance.periodRange(period);
  const days = period === 'last30' ? 30 : 90;
  const d = new Date(`${todayIso()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return { from: d.toISOString().slice(0, 10), to: todayIso() };
}

export async function render(mount, ctx) {
  const res = await fetch(new URL('./denial-analytics.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load denial-analytics.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { period: PERIODS.some((p) => p.id === ctx.query?.period) ? ctx.query.period : 'YTD', by: 'byPayer' };
  const $ = (sel) => mount.querySelector(sel);
  let current = null;

  function draw() {
    const range = rangeOf(state.period);
    const a = denials.analytics(range);
    current = a;
    $('#da-period').innerHTML = PERIODS.map((p) => `<button data-period="${p.id}" aria-pressed="${p.id === state.period}">${p.label}</button>`).join('');
    for (const btn of mount.querySelectorAll('[data-by]')) btn.setAttribute('aria-pressed', String(btn.dataset.by === state.by));
    $('#da-metrics').innerHTML = metricRailHtml([
      { value: a.totals.count, label: 'Denials', href: '#/claima/denials', sub: `on ${a.totals.claims} claim${a.totals.claims === 1 ? '' : 's'}`, title: 'Denials that landed in the period — opens the worklist' },
      { value: usd(a.totals.amount), label: 'Denied', tone: a.totals.amount ? 'critical' : '', sub: 'what the payers refused', title: 'The denied amount over those denials' },
      { value: pct(a.totals.amount ? a.totals.recovered / a.totals.amount : 0), label: 'Recovery rate', tone: a.totals.recovered ? 'success' : '', sub: `${usd(a.totals.recovered)} recovered`, title: 'Recovered ÷ denied, on the denials of the period' },
      { value: usd(a.totals.open), label: 'Still open', tone: a.totals.open ? 'warning' : '', href: '#/claima/denials?slice=open', sub: 'unresolved from this period', title: 'What is still open on the period’s denials — opens the worklist on the open slice' },
    ]);
    $('#da-trend').innerHTML = trendHtml(a);
    $('#da-reasons').innerHTML = groupTableHtml(a.reasons, { first: 'Payer reason', link: (g) => `#/claima/denials?code=${encodeURIComponent(g.key)}` });
    $('#da-causes').innerHTML = groupTableHtml(a.rootCauses, { first: 'Root cause', link: (g) => (g.key === 'untriaged' ? '#/claima/denials?status=Untriaged' : `#/claima/denials?rootCauseId=${encodeURIComponent(g.key)}`) });
    $('#da-breakdown').innerHTML = groupTableHtml(a[state.by], {
      first: { byPayer: 'Payer', byDepartment: 'Department', byServiceLine: 'Service line', byDoctor: 'Doctor' }[state.by],
      link: state.by === 'byPayer' ? (g) => `#/claima/denials?payerId=${encodeURIComponent(g.key)}` : null,
    });
    $('#da-repeats').innerHTML = repeatsHtml(a.repeats);
    $('#da-prevention').innerHTML = preventionHtml(a.prevention);
    $('#da-footnote').innerHTML = footnoteHtml(a, range);
  }

  function trendHtml(a) {
    const rows = a.months.map((m, i) => ({
      label: m.label,
      count: a.rows.filter((d) => String(d.createdAt).slice(0, 7) === m.key).length,
      denied: a.rows.filter((d) => String(d.createdAt).slice(0, 7) === m.key).reduce((n, d) => n + d.amounts.denied, 0),
      recovered: a.rows.filter((d) => String(d.createdAt).slice(0, 7) === m.key).reduce((n, d) => n + d.amounts.recovered, 0),
      i,
    }));
    if (!rows.some((r) => r.count)) return '<p class="t-body-sm">No denial landed in this period.</p>';
    return `
      <div class="toolbar">
        <span class="t-title-sm">By month</span>
        <span class="spacer"></span>
        ${columnsLegend()}
      </div>
      ${monthColumns(rows)}`;
  }

  /**
   * The reconciliation: Performance counts denied claims by date of service;
   * this register counts denial records by the day they landed. The
   * footnote says how the two overlap rather than pretending they are one
   * figure, and reads the register's own self-check beside it.
   */
  function footnoteHtml(a, range) {
    const perf = claims.list(range).filter(claims.isDenied);
    const registerClaims = new Set(denials.all().filter((d) => d.status !== 'Reversed').map((d) => d.claimNo));
    const covered = perf.filter((c) => registerClaims.has(c.claimNo)).length;
    const moved = [...registerClaims].filter((no) => { const c = claims.get(no); return c && !claims.isDenied(c); }).length;
    const check = denials.selfCheck();
    return `
      <p class="t-body-sm">
        <strong>Reconciliation with Pactum Performance.</strong> Performance counts ${perf.length} denied claim${perf.length === 1 ? '' : 's'} with a date of service in this period
        (${pct(performance.globalRollup(performance.PERIODS.includes(state.period) ? state.period : 'YTD').denialRate, 1)} denial rate over adjudicated claims); this register holds a denial record on ${covered} of them, plus ${moved} on claim${moved === 1 ? '' : 's'}
        Performance no longer counts as denied — routed back out on a new cycle, or paid since. The rest are generated claims no remittance has posted a refused line for.
        Self-check: ${check.pass ? `every one of ${denials.all().filter((d) => d.status !== 'Reversed').length} denials adds up — denied = recovered + lost + written off + open over each chain` : `<span class="badge badge--critical">${check.failures.length} failure${check.failures.length === 1 ? '' : 's'}</span> ${esc(check.failures[0] || '')}`}.
      </p>`;
  }

  mount.addEventListener('click', (e) => {
    const period = e.target.closest('[data-period]');
    if (period) { state.period = period.dataset.period; return draw(); }
    const by = e.target.closest('[data-by]');
    if (by) { state.by = by.dataset.by; return draw(); }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'export' && current) {
      const label = PERIODS.find((p) => p.id === state.period)?.label || state.period;
      download(`denial-analytics-${state.period}-${todayIso()}.csv`, csvOf(current, label));
      toast('Denial analytics exported');
    }
    return undefined;
  });

  ctx.setCrumb([{ label: 'Claima', path: '/claima/denials' }, { label: 'Denials', path: '/claima/denials' }, { label: 'Analytics' }]);
  ctx.onData(draw);
  denials.peersReady.then(() => { if (mount.isConnected) draw(); });
  draw();
}
