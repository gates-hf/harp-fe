// A frozen DTR at #/claima/dtr/archive/<date>: the stored version rendered
// from its JSON and nothing else — a version switcher when the day was
// closed more than once, the checks with their documented exceptions, the
// five sections, the sessions as they stood — with Export PDF (the page
// prints itself; the chrome and the buttons carry data-print="hide") and
// Export Excel (a CSV built from the snapshot alone, so the file and the page
// are one document). Every cell still drills, and the drawer says the list
// is read from the register live.

import * as businessDays from '../../../../data/repositories/business-days.js';
import { date as fmtDate, dateTime, esc } from '../../../../shared/format.js';
import { metricKey } from '../../../../shared/metric-card.js';
import { dayStatusHtml, versionChipHtml } from './dtr-chips.js';
import { checkDetailHtml, checksRailHtml } from './dtr-checks.js';
import { drillOf, sectionsHtml } from './dtr-sections.js';
import { openDrill } from './dtr-drill.js';
import { openSessionReceipts, sessionsPanelHtml } from './dtr-sessions.js';

export const meta = { title: 'DTR snapshot' };

export async function render(mount, ctx) {
  await businessDays.ready;
  const date = ctx.params[1];
  const day = businessDays.get(date);
  if (!day || !day.versions.length) {
    mount.innerHTML = `
      <div class="state-view state-view--tall">
        <div class="state-view__glyph"><span class="icon">inventory_2</span></div>
        <div class="state-view__title">No frozen report for ${esc(date)}</div>
        <p class="state-view__body">A version is written when the day is closed. ${day ? `This day is ${esc(day.status.toLowerCase())}.` : 'The register holds no such day.'}</p>
        <div class="state-view__actions">
          <a class="btn btn--secondary" href="#/claima/dtr/archive">Archive</a>
          ${day ? `<a class="btn btn--primary" href="#/claima/dtr/${esc(date)}">Live report</a>` : ''}
        </div>
      </div>`;
    return;
  }

  const state = { version: Number(ctx.query?.v) || day.versions.length, check: '' };
  mount.innerHTML = `
    <div class="detail-banner">
      <div class="detail-banner__id">
        <h1 id="sn-title"></h1>
        <div class="detail-banner__meta" id="sn-meta"></div>
      </div>
      <div class="detail-banner__actions" id="sn-actions" data-print="hide"></div>
    </div>
    <div id="sn-banner"></div>
    <div class="metric-rail" id="sn-checks"></div>
    <div id="sn-check-detail-host" data-print="hide"></div>
    <div id="sn-sections"></div>
    <div id="sn-sessions"></div>`;
  const $ = (sel) => mount.querySelector(sel);

  function current() {
    return day.versions.find((v) => v.version === state.version) || day.versions[day.versions.length - 1];
  }

  function draw() {
    const v = current();
    const report = { ...v.snapshot, dtrNo: v.dtrNo, frozen: true };
    ctx.setHeader(v.dtrNo);
    ctx.setCrumb([{ label: 'Claima', path: '/claima/dtr' }, { label: 'Daily report', path: '/claima/dtr' }, { label: 'Archive', path: '/claima/dtr/archive' }, { label: v.dtrNo }]);
    $('#sn-title').textContent = `Daily transaction report — ${fmtDate(date)}`;
    $('#sn-meta').innerHTML = `
      ${versionChipHtml(v.dtrNo)}
      ${dayStatusHtml(day.status)}
      <span>·</span>
      <span class="t-body-sm">Frozen ${dateTime(v.closedAt)} by ${esc(v.closedBy)}</span>
      ${v.exceptions.length ? `<span>·</span><span class="badge badge--warning">${v.exceptions.length} exception${v.exceptions.length === 1 ? '' : 's'}</span>` : ''}`;
    $('#sn-actions').innerHTML = `
      ${day.versions.length > 1 ? `
        <div class="segmented" role="group" aria-label="Version">
          ${day.versions.map((x) => `<button data-version="${x.version}" aria-pressed="${x.version === v.version}" title="${esc(x.dtrNo)} · frozen ${dateTime(x.closedAt)}">v${x.version}</button>`).join('')}
        </div>` : ''}
      <a class="btn btn--ghost btn--sm" href="#/claima/dtr/archive"><span class="icon icon--sm">arrow_back</span>Archive</a>
      <a class="btn btn--ghost btn--sm" href="#/claima/dtr/${esc(date)}"><span class="icon icon--sm">event</span>Day page</a>
      <button class="btn btn--secondary btn--sm" data-act="excel"><span class="icon icon--sm">table_view</span>Export Excel</button>
      <button class="btn btn--primary btn--sm" data-act="print"><span class="icon icon--sm">print</span>Export PDF</button>`;
    $('#sn-banner').innerHTML = `
      <div class="alert alert--info"><span class="icon">lock</span><div>
        <div class="title">${esc(v.dtrNo)} — rendered from the stored version</div>
        Nothing on this page is recomputed. ${v.reopenReason ? `Re-closed after a reopen: ${esc(v.reopenReason)}. ` : ''}${
        day.versions.length > 1 ? `The day was closed ${day.versions.length} times; every version is kept.` : ''}
      </div></div>`;
    $('#sn-checks').innerHTML = checksRailHtml(report, state.check);
    const check = report.checks.find((c) => c.key === state.check);
    $('#sn-check-detail-host').innerHTML = check ? checkDetailHtml(check, { live: false, date }) : '';
    const open = [...mount.querySelectorAll('details[data-section][open]')].map((d) => d.dataset.section);
    $('#sn-sections').innerHTML = sectionsHtml(report, { drillable: true, open: open.length ? open : report.sections.map((s) => s.key) });
    $('#sn-sessions').innerHTML = sessionsPanelHtml(report, { live: false });
  }

  mount.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const kpi = metricKey(e);
    if (kpi) { state.check = state.check === kpi ? '' : kpi; return draw(); }
    const ver = e.target.closest('[data-version]');
    if (ver) { state.version = Number(ver.dataset.version); return draw(); }
    const drill = drillOf(e);
    if (drill) return void openDrill(drill.drill, `${drill.title} (register read live)`);
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    if (btn.dataset.act === 'print') return void window.print();
    if (btn.dataset.act === 'close-detail') { state.check = ''; return draw(); }
    if (btn.dataset.act === 'view-session') return void openSessionReceipts(btn.dataset.session);
    if (btn.dataset.act === 'excel') {
      const v = current();
      download(`${v.dtrNo}.csv`, businessDays.csvOf(v.snapshot, { dtrNo: v.dtrNo, status: day.status, closedBy: v.closedBy, closedAt: v.closedAt }));
    }
  });

  ctx.onData(draw);
  draw();
  if (ctx.query?.print === '1') setTimeout(() => window.print(), 0);
}

/** Hands the browser the CSV. Copied rather than imported: a module never reaches into another module's files. */
function download(fileName, text) {
  // The byte-order mark keeps Excel reading the file as UTF-8.
  const url = URL.createObjectURL(new Blob([String.fromCharCode(0xfeff), text], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
