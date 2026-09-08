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
import { metricRailHtml, metricKey } from '../../../../shared/metric-card.js';
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
  const state = { sort: 'score', dir: 'asc', filter: ctx.query?.flagged === '1' ? 'flagged' : '' };
  const $ = (sel) => mount.querySelector(sel);

  /**
   * The two cards that name a set of payers rather than an average. Each one
   * filters the table to the payers behind its number, and the banner over the
   * rows says which set is on screen.
   */
  const FILTERS = {
    flagged: {
      test: (r) => r.metrics.underpaymentsFlagged > 0,
      words: 'Payers with flagged underpayments only',
    },
    recovered: {
      test: (r) => r.metrics.varianceRecovered > 0,
      words: 'Payers with a recovered hand-off only',
    },
  };

  function draw() {
    const rows = perf.allPayers();
    const totals = perf.globalRollup();
    drawKpis(totals);
    $('#pf-period').title = periodTitle();

    const only = FILTERS[state.filter];
    const shown = sortRows(only ? rows.filter(only.test) : rows);
    $('#pf-rows').innerHTML = shown.map(rowHtml).join('');
    $('#pf-count').textContent = `${shown.length} of ${rows.length} payer${rows.length === 1 ? '' : 's'} tracked · ${int(rows.reduce((n, r) => n + r.metrics.claims, 0))} claims year to date`;

    const filter = $('#pf-filter');
    filter.hidden = !only;
    if (only) $('#pf-filter-text').textContent = `${only.words} — ${shown.length} of ${rows.length}`;

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

    // Every card acts on the table: the two that name a set of payers filter it,
    // the two averages sort by the column they summarise, and the total clears
    // the filter. `raw` keeps the denial card's inline arrow — everything in
    // that value is a number this file formatted.
    $('#pf-kpis').innerHTML = metricRailHtml([
      {
        value: t.payersTracked,
        label: 'Payers tracked',
        sub: `${int(t.claims)} claims year to date`,
        title: 'Payers holding at least one contract that carried a claim this year — select to show them all',
        key: 'all',
        pressed: !state.filter,
      },
      {
        value: `${pct(t.denialRate)} ${deltaArrow(denialDelta)}`,
        raw: true,
        label: 'Avg denial rate',
        sub: deltaWords(denialDelta),
        tone: denialTone(t.denialRate) === 'critical' ? 'critical' : denialTone(t.denialRate) === 'warning' ? 'warning' : '',
        title: `Denied claims over adjudicated claims. Last quarter ${pct(last.denialRate)} — select to sort by denial rate`,
        key: 'denialRate',
        pressed: state.sort === 'denialRate',
      },
      {
        value: Math.round(t.daysToPay),
        label: 'Avg days to pay',
        sub: overTarget
          ? `${Math.round(t.daysToPay - perf.CONFIG.targets.daysToPay)} over the ${perf.CONFIG.targets.daysToPay}-day target`
          : `inside the ${perf.CONFIG.targets.daysToPay}-day target`,
        tone: overTarget ? 'warning' : '',
        title: 'Mean days from submission to payment, over paid claims — select to sort by days to pay',
        key: 'daysToPay',
        pressed: state.sort === 'daysToPay',
      },
      {
        value: usd(t.varianceRecovered),
        label: 'Variance recovered',
        sub: `${t.recoveredHandoffs} hand-off${t.recoveredHandoffs === 1 ? '' : 's'} recovered`,
        title: 'Recovered on hand-offs Defensio has closed, year to date — select to list the payers it came from',
        key: 'recovered',
        pressed: state.filter === 'recovered',
      },
      {
        value: t.underpaymentsFlagged,
        label: 'Underpayments flagged',
        sub: `across ${t.payersWithFlags} payer${t.payersWithFlags === 1 ? '' : 's'} — select to filter`,
        tone: t.underpaymentsFlagged ? 'warning' : '',
        title: `Claims paid more than ${usd(perf.CONFIG.flag.floor)} and more than ${pct(perf.CONFIG.flag.pct, 0)} below the contracted amount`,
        key: 'flagged',
        pressed: state.filter === 'flagged',
      },
    ]);
  }

  /**
   * A card that names a set of payers toggles the filter; one that summarises a
   * column sorts by it, worst first, and turns the order round on a second
   * click the way the column header does.
   */
  function selectKpi(key) {
    if (key === 'all') state.filter = '';
    else if (FILTERS[key]) state.filter = state.filter === key ? '' : key;
    else {
      state.dir = state.sort === key && state.dir === 'desc' ? 'asc' : 'desc';
      state.sort = key;
    }
    draw();
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
        <div class="state-view__title">${total ? 'No payer in that slice' : 'No claims to report on'}</div>
        <p class="state-view__body">${total
          ? `${esc(FILTERS[state.filter]?.words || 'The filter')}: nothing in the reporting period lands there. Clear the filter to see every tracked payer.`
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
    const kpi = metricKey(e);
    if (kpi) return selectKpi(kpi);

    if (e.target.closest('[data-act="clear-filter"]')) {
      state.filter = '';
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
