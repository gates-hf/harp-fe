// Payer statistics at #/claima/payer-stats — one row per payer over a period:
// how long it takes to acknowledge and to pay, what it rejects and what comes
// back resubmitted, its denial rate, and what is silent or escalated with it
// today. A row drills to that payer's monthly trend; Export to Excel hands the
// table over as CSV. Every figure comes from data/engines/payer-stats.js,
// which reuses Performance's definitions and asserts that it does.

import * as stats from '../../../../data/engines/payer-stats.js';
import * as lifecycle from '../../../../data/engines/claim-events.js';
import { esc, usd } from '../../../../shared/format.js';
import { toast } from '../../../../shared/toast.js';
import { denialTone, pct, rateBar, sparkline, trendColumns, trendLegend } from './lifecycle-charts.js';

export const meta = { title: 'Payer statistics' };

const PERIOD_LABELS = { YTD: 'Year to date', lastQuarter: 'Last quarter' };
const MONTH_CHOICES = [6, 12];

export async function render(mount, ctx) {
  const state = { period: 'YTD', payerId: '', months: 6, sort: 'silentCount', dir: 'desc' };

  mount.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <span>Payer statistics</span>
        <span class="spacer"></span>
        <div class="segmented" role="group" aria-label="Period" id="ps-period">
          ${stats.PERIODS.map((p) => `<button data-period="${p}" aria-pressed="${p === state.period}">${PERIOD_LABELS[p] || p}</button>`).join('')}
        </div>
        <button class="btn btn--secondary btn--sm" data-act="export" title="Download the table as a CSV file Excel opens">
          <span class="icon icon--sm">download</span>Export to Excel
        </button>
        <a class="btn btn--ghost btn--sm" href="#/pactum/performance" title="Pactum’s Performance screen, whose definitions these are">
          <span class="icon icon--sm">open_in_new</span>Performance
        </a>
      </div>
      <div class="panel-body">
        <div id="ps-table"></div>
        <p class="t-body-sm" id="ps-foot"></p>
      </div>
    </div>
    <div class="panel" id="ps-drill" hidden>
      <div class="panel-header">
        <span id="ps-drill-title">Trend</span>
        <span class="spacer"></span>
        <div class="segmented" role="group" aria-label="Months" id="ps-months">
          ${MONTH_CHOICES.map((m) => `<button data-months="${m}" aria-pressed="${m === state.months}">${m} months</button>`).join('')}
        </div>
        <a class="btn btn--ghost btn--sm" id="ps-drill-queue" href="#/claima/followups">
          <span class="icon icon--sm">call</span>Follow-ups
        </a>
      </div>
      <div class="panel-body" id="ps-drill-body"></div>
    </div>`;
  const $ = (sel) => mount.querySelector(sel);

  function draw() {
    const rows = sorted(stats.summary(state.period));
    $('#ps-table').innerHTML = tableHtml(rows, state);
    for (const btn of mount.querySelectorAll('[data-period]')) btn.setAttribute('aria-pressed', String(btn.dataset.period === state.period));
    const check = stats.selfCheck(state.period);
    $('#ps-foot').innerHTML = `Same definitions as Pactum Performance — denial rate is denied ÷ adjudicated and submit → payment is its days to pay,
      both read through <span class="t-mono-sm">performance-engine.rollup()</span>. Self-check: ${check.pass
      ? `<span class="badge badge--success">pass</span> every payer’s denial rate and days to pay equal Performance’s for ${esc(PERIOD_LABELS[state.period].toLowerCase())}.`
      : `<span class="badge badge--critical">fail</span> ${esc(check.failures.join('; '))}`}`;
    drawDrill(rows);
  }

  function drawDrill(rows = stats.summary(state.period)) {
    const panel = $('#ps-drill');
    const row = rows.find((r) => r.payerId === state.payerId);
    panel.hidden = !row;
    if (!row) return;
    const trend = stats.trend(row.payerId, state.months);
    $('#ps-drill-title').textContent = `${row.name} — the last ${state.months} months`;
    $('#ps-drill-queue').href = `#/claima/followups?payerId=${row.payerId}`;
    for (const btn of mount.querySelectorAll('[data-months]')) btn.setAttribute('aria-pressed', String(Number(btn.dataset.months) === state.months));
    $('#ps-drill-body').innerHTML = `
      <div class="toolbar">${trendLegend()}<span class="spacer"></span>
        <span class="t-body-sm">By date of service — the axis Performance’s sparkline uses.</span></div>
      ${trendColumns(trend)}
      <table class="tbl">
        <thead><tr><th scope="col">Month</th><th scope="col">Submitted</th><th scope="col">Adjudicated</th><th scope="col">Denied</th>
          <th scope="col">Denial rate</th><th scope="col">Rejected</th><th scope="col">Days to pay</th></tr></thead>
        <tbody>${trend.map((m) => `
          <tr><th scope="row">${esc(m.label)} ${esc(m.key.slice(0, 4))}</th><td>${m.submitted}</td><td>${m.adjudicated}</td><td>${m.denied}</td>
            <td>${m.adjudicated ? rateBar(m.denialRate, { label: 'Denial rate' }) : '<span class="t-body-sm">—</span>'}</td>
            <td>${m.rejected}</td><td>${m.paid ? `${m.daysToPay.toFixed(1)} d` : '<span class="t-body-sm">—</span>'}</td></tr>`).join('')}</tbody>
      </table>`;
  }

  function sorted(rows) {
    const dir = state.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = a[state.sort];
      const y = b[state.sort];
      if (typeof x === 'string') return x.localeCompare(y) * dir;
      return ((x || 0) - (y || 0)) * dir || a.name.localeCompare(b.name);
    });
  }

  mount.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const period = e.target.closest('[data-period]');
    if (period) { state.period = period.dataset.period; return draw(); }
    const months = e.target.closest('[data-months]');
    if (months) { state.months = Number(months.dataset.months); return drawDrill(); }
    const sort = e.target.closest('th[data-sort]');
    if (sort) {
      const key = sort.dataset.sort;
      if (state.sort === key) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
      else Object.assign(state, { sort: key, dir: key === 'name' ? 'asc' : 'desc' });
      return draw();
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'export') {
      download(`payer-statistics-${state.period.toLowerCase()}.csv`, stats.exportCsv(state.period));
      return void toast('Payer statistics exported as CSV', 'info');
    }
    const tr = e.target.closest('tr[data-payer]');
    if (tr) {
      state.payerId = state.payerId === tr.dataset.payer ? '' : tr.dataset.payer;
      draw();
      if (state.payerId) {
        const panel = $('#ps-drill');
        panel.setAttribute('tabindex', '-1');
        panel.focus({ preventScroll: true });
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  });

  mount.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-payer]');
    if (tr && e.target === tr && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      tr.click();
    }
  });

  ctx.onData(draw);
  lifecycle.peersReady.then(() => { if (mount.isConnected) draw(); });
  if (ctx.query?.payerId) state.payerId = ctx.query.payerId;
  if (stats.PERIODS.includes(ctx.query?.period)) state.period = ctx.query.period;
  draw();
}

function tableHtml(rows, state) {
  const th = (key, label, title = '') => `
    <th scope="col" data-sort="${key}" aria-sort="${state.sort === key ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none'}"
        title="${esc(title || `Sort by ${label.toLowerCase()}`)}">
      ${esc(label)}${state.sort === key ? `<span class="icon icon--sm">${state.dir === 'asc' ? 'arrow_upward' : 'arrow_downward'}</span>` : ''}
    </th>`;
  const hint = (key) => stats.COLUMNS.find((c) => c.key === key)?.hint || '';
  return `
    <table class="tbl">
      <thead>
        <tr>
          ${th('name', 'Payer')}
          ${th('submitted', 'Submitted', hint('submitted'))}
          ${th('submitToAckDays', 'Submit → Ack', hint('submitToAckDays'))}
          ${th('submitToPayDays', 'Submit → Payment', hint('submitToPayDays'))}
          ${th('rejectionRate', 'Rejection', hint('rejectionRate'))}
          ${th('resubmissionRate', 'Resubmission', hint('resubmissionRate'))}
          ${th('denialRate', 'Denial rate', hint('denialRate'))}
          <th scope="col" title="Monthly denial rate, year to date">Trend</th>
          ${th('silentCount', 'Silent', hint('silentCount'))}
          ${th('silentValue', 'Silent value', hint('silentValue'))}
          ${th('escalated', 'Escalated', hint('escalated'))}
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => `
          <tr data-payer="${esc(r.payerId)}" tabindex="0" aria-selected="${r.payerId === state.payerId}"
              title="${r.payerId === state.payerId ? 'Close the trend' : `Open the monthly trend for ${esc(r.name)}`}">
            <th scope="row">${esc(r.name)}<br><span class="t-body-sm">${esc(r.type)}</span></th>
            <td>${r.submitted}</td>
            <td>${r.acknowledged ? `${r.submitToAckDays.toFixed(1)} d <span class="t-body-sm">(${r.acknowledged})</span>` : '<span class="t-body-sm">—</span>'}</td>
            <td>${r.metrics.paidCount ? `${r.submitToPayDays.toFixed(1)} d` : '<span class="t-body-sm">—</span>'}</td>
            <td>${r.submitted ? rateBar(r.rejectionRate, { max: 0.2, tone: r.rejectionRate > 0.1 ? 'critical' : r.rejectionRate > 0.05 ? 'warning' : 'success', label: 'Rejection rate' }) : '—'}</td>
            <td>${r.submitted ? `<span class="t-mono-sm">${pct(r.resubmissionRate)}</span> <span class="t-body-sm">(${r.resubmitted})</span>` : '—'}</td>
            <td>${r.metrics.adjudicated ? rateBar(r.denialRate, { label: 'Denial rate', tone: denialTone(r.denialRate) }) : '<span class="t-body-sm">—</span>'}</td>
            <td>${sparkline(r.sparkline, { label: `${r.name} monthly denial rate` })}</td>
            <td>${r.silentCount ? `<span class="badge badge--warning">${r.silentCount}</span>` : '<span class="t-body-sm">0</span>'}</td>
            <td><span class="t-mono-sm">${esc(usd(r.silentValue))}</span></td>
            <td>${r.escalated ? `<span class="badge badge--critical">⚑ ${r.escalated}</span>` : '<span class="t-body-sm">0</span>'}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

/** Hand the browser a file — the same six lines every export in the platform uses. */
function download(name, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
