// Defensio scorecard archive at #/defensio/scorecard/archive — every saved
// snapshot, newest first, with search and a payer filter — and the frozen
// document at #/defensio/scorecard/<no>, the print view: rendered from the
// row's own `figures` and nothing else, with Export PDF (the page printed
// with everything but the document hidden) and Export Excel (a CSV built
// from the snapshot). This file imports no engine, which is what keeps
// "never recomputed" true by construction; the render asserts it reads a
// frozen figures object as well.

import * as scorecards from '../../../../data/repositories/scorecards.js';
import * as payers from '../../../../data/repositories/payers.js';
import { metricRailHtml } from '../../../../shared/metric-card.js';
import { date, dateTime, esc } from '../../../../shared/format.js';
import { csvOf, download, emptyHtml } from './analytics-format.js';
import { docCsv, docHtml } from './scorecard-doc.js';

export const meta = { title: 'Scorecard archive' };

export async function render(mount, ctx) {
  if (ctx.params[0] && ctx.params[0] !== 'archive') return renderSnapshot(mount, ctx, ctx.params[0]);

  const res = await fetch(new URL('./scorecard-archive.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load scorecard-archive.html (${res.status})`);
  mount.innerHTML = await res.text();

  const $ = (sel) => mount.querySelector(sel);
  const state = { q: '', payerId: ctx.query?.payerId || '' };
  $('#sa-payer').innerHTML = `<option value="">Any payer</option>${payers.all().map((p) => `<option value="${esc(p.id)}">${esc(p.nameEn)}</option>`).join('')}`;
  $('#sa-payer').value = state.payerId;

  function draw() {
    const c = scorecards.counts();
    $('#sa-metrics').innerHTML = metricRailHtml([
      { value: c.total, label: 'Scorecards', key: 'all', pressed: !state.q && !state.payerId, title: 'Every snapshot on the register' },
      { value: c.payers, label: 'Payers scored', title: 'Payers with at least one scorecard' },
      { value: c.thisMonth, label: 'Generated this month', title: 'Snapshots generated this calendar month' },
      { value: c.versions, label: 'Re-issued', title: 'Snapshots that are a second or later version of the same payer and period' },
    ]);
    const rows = scorecards.search(state.q, { payerId: state.payerId });
    $('#sa-body').innerHTML = rows.length ? tableHtml(rows) : emptyHtml(state.q || state.payerId ? 'No scorecard matches' : 'No scorecard yet', state.q || state.payerId ? 'Clear the filters to see the whole archive.' : 'Generate one from the Payer scorecard screen.');
  }

  $('#sa-search').addEventListener('input', (e) => { state.q = e.target.value; draw(); });
  $('#sa-payer').addEventListener('change', (e) => { state.payerId = e.target.value; draw(); });
  mount.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const kpi = e.target.closest('[data-kpi]');
    if (kpi) { state.q = ''; state.payerId = ''; $('#sa-search').value = ''; $('#sa-payer').value = ''; return draw(); }
    const act = e.target.closest('[data-act]')?.dataset.act;
    const tr = e.target.closest('tr[data-no]');
    if (act === 'clear') { state.q = ''; state.payerId = ''; $('#sa-search').value = ''; $('#sa-payer').value = ''; return draw(); }
    if (act === 'excel' && tr) { const row = scorecards.get(tr.dataset.no); return download(`${row.scorecardNo}-v${row.version}.csv`, csvOf(docCsv(row.figures, row))); }
    if (tr) return ctx.navigate(`/defensio/scorecard/${tr.dataset.no}`);
    return undefined;
  });
  mount.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-no]');
    if (tr && e.target === tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); ctx.navigate(`/defensio/scorecard/${tr.dataset.no}`); }
  });

  ctx.onData(draw);
  draw();
}

function tableHtml(rows) {
  return `
    <table class="tbl">
      <thead><tr><th scope="col">Scorecard</th><th scope="col">Payer</th><th scope="col">Period</th><th scope="col">Version</th><th scope="col">Generated</th><th scope="col">Notes</th><th scope="col">Actions</th></tr></thead>
      <tbody>${rows.map((s) => `
        <tr data-no="${esc(s.scorecardNo)}" tabindex="0" title="Open ${esc(s.scorecardNo)}">
          <td><a class="crumb-link t-mono-sm" href="#/defensio/scorecard/${esc(s.scorecardNo)}">${esc(s.scorecardNo)}</a></td>
          <td>${esc(scorecards.payerName(s))}</td>
          <td>${esc(s.period.label)}<br><span class="t-body-sm">${esc(s.period.from)} → ${esc(s.period.to)}</span></td>
          <td><span class="badge${s.version > 1 ? ' badge--info' : ''}" title="${s.version > 1 ? 'A later version of a payer and period scored before' : 'First version'}">v${s.version}</span></td>
          <td>${esc(dateTime(s.generatedAt))}<br><span class="t-body-sm">${esc(s.generatedBy)}</span></td>
          <td class="t-body-sm" title="${esc(s.notes)}">${esc(s.notes.length > 80 ? `${s.notes.slice(0, 80)}…` : s.notes || '—')}</td>
          <td>
            <button class="btn btn--secondary btn--sm" data-act="open"><span class="icon icon--sm">open_in_new</span>Open</button>
            <button class="btn btn--secondary btn--sm" data-act="excel" title="Download the snapshot as a CSV file"><span class="icon icon--sm">download</span>Excel</button>
          </td>
        </tr>`).join('')}</tbody>
    </table>`;
}

/** The frozen document — the print view. Nothing here reads a register but the row itself. */
async function renderSnapshot(mount, ctx, no) {
  const row = scorecards.get(no);
  if (!row) {
    mount.innerHTML = `<div class="panel"><div class="panel-body">${emptyHtml('No such scorecard', `${no} is not on the archive.`)}<div class="state-view__actions"><a class="btn btn--secondary" href="#/defensio/scorecard/archive">Back to the archive</a></div></div></div>`;
    return;
  }
  // The archive renders a snapshot from its frozen figures only — never the engine.
  console.assert(row.figures && Array.isArray(row.figures.headline) && Array.isArray(row.figures.trend), '[scorecards] archived render without frozen figures', row.scorecardNo);
  const versions = scorecards.versionsOf(row.payerId, row.period);
  mount.innerHTML = `
    <div class="panel" data-print="hide">
      <div class="panel-header">
        <span>${esc(row.scorecardNo)}</span>
        <span class="badge${row.version > 1 ? ' badge--info' : ''}">v${row.version} of ${versions.length}</span>
        <span class="t-body-sm">frozen ${esc(date(row.generatedAt))} · rendered from the snapshot, never recomputed</span>
        <span class="spacer"></span>
        ${versions.length > 1 ? `<div class="segmented" role="group" aria-label="Version">${versions.map((v) => `<button type="button" data-go="/defensio/scorecard/${esc(v.scorecardNo)}" aria-pressed="${v.id === row.id}">v${v.version}</button>`).join('')}</div>` : ''}
        <a class="btn btn--secondary btn--sm" href="#/defensio/scorecard/archive"><span class="icon icon--sm">arrow_back</span>Archive</a>
        <a class="btn btn--secondary btn--sm" href="#/defensio/scorecard?payerId=${esc(row.payerId)}&period=${esc(row.period.kind === 'month' ? row.period.from.slice(0, 7) : row.period.key === 'custom' ? 'lastMonth' : row.period.key)}" title="Generate this payer and period again as the next version"><span class="icon icon--sm">refresh</span>Generate new</a>
        <button class="btn btn--secondary btn--sm" data-act="excel" title="Download the snapshot as a CSV file"><span class="icon icon--sm">download</span>Export Excel</button>
        <button class="btn btn--primary btn--sm" data-act="print" title="Print the document alone"><span class="icon icon--sm">print</span>Export PDF</button>
      </div>
    </div>
    ${docHtml(row.figures, row)}`;

  mount.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const go = e.target.closest('[data-go]');
    if (go) return ctx.navigate(go.dataset.go);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'print') window.print();
    if (act === 'excel') download(`${row.scorecardNo}-v${row.version}.csv`, csvOf(docCsv(row.figures, row)));
    return undefined;
  });
  ctx.onData(() => { if (!scorecards.get(no) && mount.isConnected) ctx.navigate('/defensio/scorecard/archive'); });
}
