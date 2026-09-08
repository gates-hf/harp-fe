// Payer Performance — #/pactum/performance. Read-only analytics: one row per
// payer with claims, sorted worst score first, because the reason to open this
// screen is to find the payer costing the hospital money.
//
// Every figure comes out of data/engines/performance-engine.js. This file
// decides nothing about what a metric means; it draws what the engine returns.
//
// The screen also owns the contract deep link, #/pactum/performance/contracts/<id>,
// and hands the mount over the way the contracts list does.

import * as perf from '../../../../data/engines/performance-engine.js';
import { usd, int, esc } from '../../../../shared/format.js';
import { denialBar, denialTone, deltaArrow, scoreTone, sparkline, pct } from './perf-charts.js';

export const meta = { title: 'Performance' };

export async function render(mount, ctx) {
  if (ctx.params[0] === 'contracts') {
    return (await import('./contract-performance.js')).render(mount, ctx);
  }

  const res = await fetch(new URL('./payer-performance.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load payer-performance.html (${res.status})`);
  mount.innerHTML = await res.text();

  // Worst first: a table sorted by score ascending answers the question the
  // screen exists for before anything is clicked.
  const state = { sort: 'score', dir: 'asc', onlyFlagged: ctx.query?.flagged === '1' };
  const $ = (sel) => mount.querySelector(sel);

  function draw() {
    const rows = perf.allPayers();
    const totals = perf.globalRollup();
    drawKpis(totals);
    $('#pf-period').title = periodTitle();

    const shown = sortRows(state.onlyFlagged ? rows.filter((r) => r.metrics.underpaymentsFlagged > 0) : rows);
    $('#pf-rows').innerHTML = shown.map(rowHtml).join('');
    $('#pf-count').textContent = `${shown.length} of ${rows.length} payer${rows.length === 1 ? '' : 's'} tracked · ${int(rows.reduce((n, r) => n + r.metrics.claims, 0))} claims year to date`;

    const filter = $('#pf-filter');
    filter.hidden = !state.onlyFlagged;
    $('#pf-filter-text').textContent = `Payers with flagged underpayments only — ${shown.length} of ${rows.length}`;

    const empty = $('#pf-empty');
    empty.hidden = shown.length > 0;
    mount.querySelector('.tbl').hidden = shown.length === 0;
    if (!shown.length) empty.innerHTML = emptyHtml(rows.length);
    markSort();
  }

  function drawKpis(t) {
    const last = perf.globalRollup('lastQuarter');
    const denialDelta = t.denialRate - last.denialRate;
    const overTarget = t.daysToPay > perf.CONFIG.targets.daysToPay;

    $('#pf-kpis').innerHTML = [
      card({
        value: t.payersTracked,
        label: 'Payers tracked',
        sub: `${int(t.claims)} claims year to date`,
        title: 'Payers holding at least one contract that carried a claim this year',
      }),
      card({
        value: `${pct(t.denialRate)} ${deltaArrow(denialDelta)}`,
        label: 'Avg denial rate',
        sub: deltaWords(denialDelta),
        tone: denialTone(t.denialRate) === 'critical' ? 'critical' : denialTone(t.denialRate) === 'warning' ? 'warning' : '',
        title: `Denied claims over adjudicated claims. Last quarter ${pct(last.denialRate)}`,
      }),
      card({
        value: Math.round(t.daysToPay),
        label: 'Avg days to pay',
        sub: overTarget
          ? `${Math.round(t.daysToPay - perf.CONFIG.targets.daysToPay)} over the ${perf.CONFIG.targets.daysToPay}-day target`
          : `inside the ${perf.CONFIG.targets.daysToPay}-day target`,
        tone: overTarget ? 'warning' : '',
        title: 'Mean days from submission to payment, over paid claims',
      }),
      card({
        value: usd(t.varianceRecovered),
        label: 'Variance recovered',
        sub: `${t.recoveredHandoffs} hand-off${t.recoveredHandoffs === 1 ? '' : 's'} recovered`,
        title: 'Recovered on hand-offs Defensio has closed, year to date',
      }),
      card({
        value: t.underpaymentsFlagged,
        label: 'Underpayments flagged',
        sub: `across ${t.payersWithFlags} payer${t.payersWithFlags === 1 ? '' : 's'} — select to filter`,
        tone: t.underpaymentsFlagged ? 'warning' : '',
        title: `Claims paid more than ${usd(perf.CONFIG.flag.floor)} and more than ${pct(perf.CONFIG.flag.pct, 0)} below the contracted amount`,
        act: 'flagged',
        pressed: state.onlyFlagged,
      }),
    ].join('');
  }

  function card({ value, label, sub, title, tone = '', act = '', pressed = false }) {
    const cls = `metric-rail-card${tone ? ` metric-rail-card--${tone}` : ''}`;
    // `value` carries an inline SVG arrow on the denial card, so it is composed
    // rather than escaped; everything in it is a number this file formatted.
    const inner = `<span class="metric-rail-card__value">${value}</span>`
      + `<span class="metric-rail-card__label">${esc(label)}</span>`
      + `<span class="metric-rail-card__sub">${esc(sub)}</span>`;
    if (!act) return `<div class="${cls}" title="${esc(title)}">${inner}</div>`;
    return `<button class="${cls}" data-act="${act}" aria-pressed="${pressed}" title="${esc(title)}">${inner}</button>`;
  }

  function rowHtml(row) {
    const m = row.metrics;
    const target = row.openContract;
    return `
      <tr data-contract="${esc(target?.id || '')}" tabindex="0"
          title="${target ? `Open contract performance for ${esc(target.name)}` : 'No contract to open'}">
        <td>${esc(row.name)}<br><span class="t-mono-sm">${esc(row.code)}</span></td>
        <td class="num t-mono-sm">${row.activeContracts}</td>
        <td class="num t-mono-sm">${esc(usd(m.netRevenue))}</td>
        <td>${denialBar(m.denialRate)}</td>
        <td class="num t-mono-sm" title="Target ${perf.CONFIG.targets.daysToPay} days">${Math.round(m.daysToPay)}</td>
        <td class="num t-mono-sm" title="${esc(usd(m.variance))} short of the contracted amount on paid claims">${pct(m.variancePct)}</td>
        <td class="num">${scoreChip(m)}</td>
        <td>${sparkline(row.sparkline, { label: `${row.name} — monthly denial rate` })}</td>
      </tr>`;
  }

  function scoreChip(m) {
    const inputs = perf.scoreInputs(m)
      .map((i) => `${i.label} ${i.value} of ${i.ceiling} at weight ${i.weight}`)
      .join(' · ');
    return `<span class="badge badge--${scoreTone(m.score)}" title="100 minus the weighted penalty — ${esc(inputs)}"><span class="dot"></span>${m.score}</span>`;
  }

  function sortRows(rows) {
    const sign = state.dir === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => {
      if (state.sort === 'name') return a.name.localeCompare(b.name) * sign;
      if (state.sort === 'activeContracts') return (a.activeContracts - b.activeContracts) * sign;
      return ((a.metrics[state.sort] || 0) - (b.metrics[state.sort] || 0)) * sign;
    });
  }

  function markSort() {
    for (const btn of mount.querySelectorAll('.sort-btn')) {
      const on = btn.dataset.sort === state.sort;
      btn.querySelector('.icon').textContent = on
        ? (state.dir === 'asc' ? 'arrow_upward' : 'arrow_downward')
        : 'unfold_more';
      btn.closest('th').setAttribute('aria-sort', on ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    }
  }

  function periodTitle() {
    const { from, to } = perf.periodRange('YTD');
    return `Every figure covers ${from} to ${to}`;
  }

  function emptyHtml(total) {
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">${total ? 'filter_alt_off' : 'monitoring'}</span></div>
        <div class="state-view__title">${total ? 'No payer has a flagged underpayment' : 'No claims to report on'}</div>
        <p class="state-view__body">${total
          ? 'Every tracked payer is paying what the contract says. Clear the filter to see them all.'
          : 'Performance reads claims against contract configuration. Activate a contract and the analytics follow.'}</p>
        <div class="state-view__actions">
          ${total
            ? '<button class="btn btn--secondary" data-act="clear-filter">Show every payer</button>'
            : '<a class="btn btn--primary" href="#/pactum/contracts">Go to Contracts</a>'}
        </div>
      </div>`;
  }

  // --- events ---------------------------------------------------------------

  mount.addEventListener('click', (e) => {
    const sort = e.target.closest('.sort-btn');
    if (sort) {
      state.dir = state.sort === sort.dataset.sort && state.dir === 'asc' ? 'desc' : 'asc';
      state.sort = sort.dataset.sort;
      draw();
      return;
    }
    if (e.target.closest('[data-act="flagged"]')) {
      state.onlyFlagged = !state.onlyFlagged;
      draw();
      return;
    }
    if (e.target.closest('[data-act="clear-filter"]')) {
      state.onlyFlagged = false;
      draw();
      return;
    }
    const row = e.target.closest('tr[data-contract]');
    if (row?.dataset.contract) ctx.navigate(`/pactum/performance/contracts/${row.dataset.contract}`);
  });

  mount.addEventListener('keydown', (e) => {
    const row = e.target.closest('tr[data-contract]');
    if (row?.dataset.contract && e.target === row && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      ctx.navigate(`/pactum/performance/contracts/${row.dataset.contract}`);
    }
  });

  // A hand-off raised on the contract screen moves Variance recovered here.
  ctx.onData(draw);
  draw();
}

const deltaWords = (delta) =>
  Math.abs(delta) < 0.0005
    ? 'unchanged since last quarter'
    : `${pct(Math.abs(delta))} ${delta < 0 ? 'better' : 'worse'} than last quarter`;
