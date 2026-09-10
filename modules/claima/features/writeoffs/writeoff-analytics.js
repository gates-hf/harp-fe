// Write-off analytics at #/claima/writeoffs/analytics — what was posted in
// the period and why: the contractual / discretionary split first, then the
// breakdowns by reason, payer, department, service line and requester, the
// month trend, the approval statistics, the repeat patterns, and the
// reconciliation footnote against the denials register. Everything is
// computed on every read from the same rows, so the split, the breakdowns and
// the trend never disagree; the rail's cards jump to the panel that breaks
// their number down, the Contract Performance pattern.

import * as writeoffs from '../../../../data/repositories/writeoffs.js';
import { esc, usd } from '../../../../shared/format.js';
import { metricKey, metricRailHtml } from '../../../../shared/metric-card.js';
import { bar, legend, monthColumns, splitBar } from './writeoff-charts.js';

export const meta = { title: 'Write-off analytics' };

const PERIOD_LABELS = { MTD: 'Month to date', QTD: 'Quarter to date', YTD: 'Year to date' };

export async function render(mount, ctx) {
  const res = await fetch(new URL('./writeoff-analytics.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load writeoff-analytics.html (${res.status})`);
  mount.innerHTML = await res.text();

  ctx.setCrumb([
    { label: 'Claima', path: '/claima/writeoffs' },
    { label: 'Write-offs', path: '/claima/writeoffs' },
    { label: 'Analytics' },
  ]);

  const state = { period: writeoffs.PERIODS.includes(ctx.query?.period) ? ctx.query.period : 'YTD' };
  const $ = (sel) => mount.querySelector(sel);
  $('#wa-period').innerHTML = writeoffs.PERIODS.map((p) =>
    `<button data-period="${p}" aria-pressed="${p === state.period}">${PERIOD_LABELS[p]}</button>`).join('');

  function draw() {
    const a = writeoffs.analytics(state.period);
    for (const btn of mount.querySelectorAll('[data-period]')) btn.setAttribute('aria-pressed', String(btn.dataset.period === state.period));
    $('#wa-metrics').innerHTML = railHtml(a);
    $('#wa-split').innerHTML = splitHtml(a);
    // Two rows of three: the grid fits as many 280px columns as it is given,
    // and six panels in one row would be six — the Frontis dashboard's call.
    $('#wa-breakdowns').innerHTML = [
      breakdownHtml('reason', 'By reason', a.byReason, a.totals.total),
      breakdownHtml('payer', 'By payer', a.byPayer, a.totals.total),
      breakdownHtml('department', 'By department', a.byDepartment, a.totals.total),
    ].join('');
    $('#wa-breakdowns-2').innerHTML = [
      breakdownHtml('service', 'By service line', a.byServiceLine, a.totals.total),
      breakdownHtml('requester', 'By requester', a.byRequester, a.totals.total),
      approvalsHtml(a),
    ].join('');
    $('#wa-legend').innerHTML = legend();
    $('#wa-trend').innerHTML = a.trend.some((m) => m.total) ? monthColumns(a.trend) : emptyHtml('show_chart', 'Nothing posted in six months', 'The trend fills as write-offs are posted.');
    $('#wa-lower').innerHTML = repeatsHtml(a.repeats);
    $('#wa-foot').innerHTML = footHtml(a);
  }

  function railHtml(a) {
    const t = a.totals;
    return metricRailHtml([
      { value: usd(t.total), label: 'Posted', key: 'trend', sub: `${t.count} write-off${t.count === 1 ? '' : 's'} · ${a.range.label.toLowerCase()}`,
        title: 'Posted inside the period and standing — a reversed write-off is out. Opens the trend.' },
      { value: usd(t.contractual), label: 'Contractual', key: 'reason', sub: `${Math.round((a.split[0].share) * 100)}% of posted`,
        title: 'Money the agreement never allowed. Opens the breakdown by reason.' },
      { value: usd(t.discretionary), label: 'Discretionary', key: 'reason', tone: a.split[1].share > 0.5 ? 'warning' : '',
        sub: `${Math.round((a.split[1].share) * 100)}% of posted`,
        title: 'Money the hospital chose to let go — the share worth watching. Opens the breakdown by reason.' },
      { value: `${Math.round(a.approvals.rate * 100)}%`, label: 'Approval rate', key: 'approvals',
        tone: a.approvals.rejected && a.approvals.rate < 0.5 ? 'warning' : '',
        sub: `${a.approvals.approved} approved · ${a.approvals.rejected} rejected`,
        title: 'Approved over decided, for requests raised in the period. Opens the approval statistics.' },
      { value: usd(t.payer), label: 'Payer side', key: 'payer', sub: `${usd(t.patient)} patient side`,
        title: 'Written off claims’ open balances, against what was written off patient accounts. Opens the breakdown by payer.' },
    ]);
  }

  function splitHtml(a) {
    const [c, d] = a.split;
    return `
      <div class="toolbar">
        <span class="t-title-sm">Contractual vs discretionary</span>
        <span class="spacer"></span>
        <span class="t-body-sm">${esc(usd(c.value))} contractual (${c.count}) · ${esc(usd(d.value))} discretionary (${d.count})</span>
      </div>
      ${a.totals.total ? splitBar(c.value, d.value) : '<p class="t-body-sm">Nothing posted in the period.</p>'}
      <p class="t-body-sm">Contractual is what the agreement never allowed — the residual after a remittance, a balance below the statement floor. Discretionary is what the hospital chose to let go: hardship, bad debt, a filing window missed, an error it owns. The second share is the one a signature was asked for.</p>`;
  }

  function breakdownHtml(key, title, rows, total) {
    const max = Math.max(1, ...rows.map((r) => r.value));
    return `
      <div class="panel" id="wa-${key}" tabindex="-1">
        <div class="panel-header"><span>${esc(title)}</span><span class="spacer"></span><span class="badge">${rows.length}</span></div>
        <div class="panel-body">
          ${rows.length ? `
            <table class="tbl">
              <thead><tr><th scope="col">${esc(title.replace('By ', ''))}</th><th scope="col">Count</th><th scope="col">Posted</th><th scope="col">Share</th></tr></thead>
              <tbody>${rows.slice(0, 8).map((r) => `
                <tr>
                  <td>${esc(r.label)}${r.discretionary && r.contractual ? `<br><span class="t-body-sm">${esc(usd(r.contractual))} contractual · ${esc(usd(r.discretionary))} discretionary</span>` : ''}</td>
                  <td>${r.count}</td>
                  <td><span class="t-mono-sm">${esc(usd(r.value))}</span></td>
                  <td>${bar({ value: r.value, max, tone: r.discretionary > r.contractual ? 'discretionary' : 'contractual', label: `${r.label} ${usd(r.value)}` })} <span class="t-body-sm">${total ? Math.round((r.value / total) * 100) : 0}%</span></td>
                </tr>`).join('')}</tbody>
            </table>${rows.length > 8 ? `<p class="t-body-sm">${rows.length - 8} more in the export.</p>` : ''}`
            : '<p class="muted">Nothing posted in the period.</p>'}
        </div>
      </div>`;
  }

  function approvalsHtml(a) {
    const s = a.approvals;
    return `
      <div class="panel" id="wa-approvals" tabindex="-1">
        <div class="panel-header"><span>Approvals</span><span class="spacer"></span><span class="t-body-sm">requests raised in the period</span></div>
        <div class="panel-body">
          <dl class="dl dl--narrow">
            <dt>Requested</dt><dd>${s.requested} · <span class="t-mono-sm">${esc(usd(s.requestedValue))}</span></dd>
            <dt>Approval rate</dt><dd>${bar({ value: s.rate, max: 1, label: `Approval rate ${Math.round(s.rate * 100)}%` })} <span class="t-mono-sm">${Math.round(s.rate * 100)}%</span></dd>
            <dt>Decided</dt><dd>${s.approved} approved · ${s.rejected} rejected · ${s.pending} still waiting</dd>
            <dt>Rejected value</dt><dd><span class="t-mono-sm">${esc(usd(s.rejectedValue))}</span></dd>
            <dt>Decision time</dt><dd>${s.avgDecisionDays.toFixed(1)} days on average</dd>
            <dt>Capped at posting</dt><dd>${s.capped} <span class="t-body-sm">— posted below the amount requested because the balance had shrunk</span></dd>
          </dl>
        </div>
      </div>`;
  }

  function repeatsHtml(r) {
    const table = (rows, head) => (rows.length ? `
      <table class="tbl">
        <thead><tr><th scope="col">${esc(head)}</th><th scope="col">Write-offs</th><th scope="col">Value</th></tr></thead>
        <tbody>${rows.slice(0, 8).map((x) => `
          <tr><td>${esc(x.label)}</td><td>${x.count}</td><td><span class="t-mono-sm">${esc(usd(x.value))}</span></td></tr>`).join('')}</tbody>
      </table>` : '<p class="muted">Nothing comes back twice.</p>');
    return `
      <div class="panel">
        <div class="panel-header"><span>Repeat accounts</span><span class="spacer"></span><span class="badge">${r.accounts.length}</span></div>
        <div class="panel-body"><p class="lead">Patients with two or more write-offs raised, whatever their state — a pattern worth a conversation before the next one.</p>${table(r.accounts, 'Patient')}</div>
      </div>
      <div class="panel">
        <div class="panel-header"><span>Repeat payer reasons</span><span class="spacer"></span><span class="badge">${r.payerReasons.length}</span></div>
        <div class="panel-body"><p class="lead">The same payer written off for the same reason twice or more — the contract or the desk process to look at.</p>${table(r.payerReasons, 'Payer · reason')}</div>
      </div>`;
  }

  function footHtml(a) {
    const r = a.reconciliation;
    if (r.pass === null) return `Reconciliation: posted payer-side write-offs sourced from denials total ${esc(usd(r.mine))} in the period; the denials register’s written-off total could not be read (${esc(r.source)}).`;
    return `Reconciliation ${r.pass ? 'holds' : 'fails'}: posted write-offs sourced from denials total ${esc(usd(r.mine))} and the denials register says ${esc(usd(r.theirs))} was written off on them (${esc(r.source)})${r.pass ? '.' : ' — the two should be one figure.'}${
      r.unresolvable ? ` ${r.unresolvable} denial-sourced write-off${r.unresolvable === 1 ? ' names' : 's name'} no denial record and sit${r.unresolvable === 1 ? 's' : ''} outside the check.` : ''}`;
  }

  // --- events ---------------------------------------------------------------

  mount.addEventListener('click', (e) => {
    const period = e.target.closest('[data-period]');
    if (period) { state.period = period.dataset.period; return draw(); }
    const kpi = metricKey(e);
    if (kpi) {
      const target = $(`#wa-${kpi}`) || $('#wa-trend-panel');
      if (target) { target.focus({ preventScroll: true }); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      return;
    }
    if (e.target.closest('[data-act]')?.dataset.act === 'export') {
      download(`write-offs-${state.period.toLowerCase()}.csv`, writeoffs.exportCsv(state.period));
    }
  });

  ctx.onData(draw);
  writeoffs.peersReady.then(() => { if (mount.isConnected) draw(); });
  draw();
}

function emptyHtml(icon, title, body) {
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">${icon}</span></div>
      <div class="state-view__title">${esc(title)}</div>
      <p class="state-view__body">${esc(body)}</p>
    </div>`;
}

function download(name, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
