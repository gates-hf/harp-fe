// The daily transaction report at #/claima/dtr — today's, live — and at
// #/claima/dtr/<date>, which is the same screen on another day: computed
// live while the day is open or reopened, read from the frozen version once
// it is closed and never recomputed. The header carries the date, the status,
// the DTR number and version, and Close day / Reopen behind their roles; the
// checks strip sits over the five sections and the sessions panel. Nothing on
// the page edits a figure — every cell drills to the transactions behind it.
// /archive and /archive/<date> hand the mount over.

import * as businessDays from '../../../../data/repositories/business-days.js';
import * as cashSessions from '../../../../data/repositories/cash-sessions.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { toast } from '../../../../shared/toast.js';
import { date as fmtDate, dateTime, esc, todayIso } from '../../../../shared/format.js';
import { metricKey } from '../../../../shared/metric-card.js';
import { closedLine, dayStatusHtml, versionChipHtml } from './dtr-chips.js';
import { checkDetailHtml, checksRailHtml } from './dtr-checks.js';
import { drillOf, sectionsHtml } from './dtr-sections.js';
import { openDrill } from './dtr-drill.js';
import { openNewSession, openSessionReceipts, sessionsPanelHtml } from './dtr-sessions.js';
import { openCloseSession } from './session-close-dialog.js';
import { closeDayDialog, documentExceptionDialog, reopenDayDialog } from './day-actions.js';

export const meta = { title: 'Daily transaction report' };

export async function render(mount, ctx) {
  if (ctx.params[0] === 'archive') return (await import('./dtr-archive.js')).render(mount, ctx);
  await businessDays.ready;

  const date = /^\d{4}-\d{2}-\d{2}$/.test(ctx.params[0] || '') ? ctx.params[0] : businessDays.current().date;
  if (!businessDays.get(date)) {
    mount.innerHTML = `
      <div class="state-view state-view--tall">
        <div class="state-view__glyph"><span class="icon">event_busy</span></div>
        <div class="state-view__title">No business day ${esc(date)}</div>
        <p class="state-view__body">The register holds a row for every day it was worked. Open the archive for the days on record, or today's report.</p>
        <div class="state-view__actions">
          <a class="btn btn--secondary" href="#/claima/dtr/archive">Archive</a>
          <a class="btn btn--primary" href="#/claima/dtr">Today's report</a>
        </div>
      </div>`;
    return;
  }

  const res = await fetch(new URL('./dtr-today.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load dtr-today.html (${res.status})`);
  mount.innerHTML = await res.text();
  const $ = (sel) => mount.querySelector(sel);
  const state = { check: '' };

  function draw() {
    const role = currentRole();
    const day = businessDays.get(date);
    const report = businessDays.report(date);
    const live = day.status !== 'Closed';
    const isToday = date === todayIso();

    ctx.setHeader(`DTR ${fmtDate(date)}`);
    ctx.setCrumb([{ label: 'Claima', path: '/claima/dtr' }, { label: 'Daily report', path: '/claima/dtr' }, { label: fmtDate(date) }]);

    $('#dtr-title').textContent = `Daily transaction report — ${fmtDate(date)}`;
    $('#dtr-meta').innerHTML = `
      ${dayStatusHtml(day.status)}
      ${versionChipHtml(report.dtrNo || businessDays.latestVersion(day)?.dtrNo, { title: report.frozen ? `Frozen ${dateTime(report.closedAt)} by ${report.closedBy}` : '' })}
      ${day.versions.length ? `<span class="t-body-sm" title="Every version is kept; the archive reads any of them">${day.versions.length} version${day.versions.length === 1 ? '' : 's'}</span>` : ''}
      <span>·</span>
      <span class="t-body-sm">${closedLine(day)}</span>
      ${report.frozen ? '' : `<span>·</span><span class="t-body-sm" title="Recomputed from the registers on every change">live · computed ${dateTime(report.computedAt)}</span>`}`;
    $('#dtr-actions').innerHTML = actionsHtml(day, role, isToday);
    $('#dtr-banners').innerHTML = bannersHtml(day, report);

    $('#dtr-checks').innerHTML = checksRailHtml(report, state.check);
    const check = report.checks.find((c) => c.key === state.check);
    $('#dtr-check-detail-host').innerHTML = check ? checkDetailHtml(check, { live, role, date }) : '';

    const open = [...mount.querySelectorAll('details[data-section][open]')].map((d) => d.dataset.section);
    $('#dtr-sections').innerHTML = sectionsHtml(report, { drillable: true, open });
    $('#dtr-sessions-host').innerHTML = sessionsPanelHtml(report, { live });
  }

  mount.addEventListener('click', async (e) => {
    if (e.target.closest('a')) return;
    const kpi = metricKey(e);
    if (kpi) {
      state.check = state.check === kpi ? '' : kpi;
      draw();
      if (state.check) $('#dtr-check-detail')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    const drill = drillOf(e);
    if (drill) return void openDrill(drill.drill, drill.title);
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    if (act === 'close-detail') { state.check = ''; return draw(); }
    if (act === 'close-day') return void closeDayDialog(date);
    if (act === 'reopen-day') return void reopenDayDialog(date);
    if (act === 'document') {
      const current = businessDays.get(date)?.exceptions.find((x) => x.checkKey === btn.dataset.check) || null;
      return void documentExceptionDialog(date, btn.dataset.check, current);
    }
    if (act === 'attach') {
      const { error, session } = cashSessions.attachOrOpen(btn.dataset.tx);
      if (error) toast(error, 'critical');
      else toast(`Receipt attached to ${session.id} (${session.cashier})`);
      return;
    }
    if (act === 'close-session') return void openCloseSession(btn.dataset.session);
    if (act === 'view-session') return void openSessionReceipts(btn.dataset.session);
    if (act === 'open-session') return void openNewSession(date);
  });

  mount.addEventListener('keydown', (e) => {
    const drill = (e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[data-drill]') ? drillOf(e) : null;
    if (drill) { e.preventDefault(); openDrill(drill.drill, drill.title); }
  });

  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));
  draw();
}

function actionsHtml(day, role, isToday) {
  const closeWhy = businessDays.closeBlocker(day.date, role);
  const reopenWhy = businessDays.reopenBlocker(day.date, role);
  const prev = businessDays.list().find((d) => d.date < day.date);
  const next = [...businessDays.list()].reverse().find((d) => d.date > day.date);
  return `
    ${prev ? `<a class="btn btn--ghost btn--sm" href="#/claima/dtr/${esc(prev.date)}" title="${esc(prev.date)} · ${esc(prev.status)}"><span class="icon icon--sm">chevron_left</span>${esc(fmtDate(prev.date))}</a>` : ''}
    ${next ? `<a class="btn btn--ghost btn--sm" href="#/claima/dtr/${esc(next.date)}" title="${esc(next.date)} · ${esc(next.status)}">${esc(fmtDate(next.date))}<span class="icon icon--sm">chevron_right</span></a>` : ''}
    ${!isToday ? '<a class="btn btn--ghost btn--sm" href="#/claima/dtr"><span class="icon icon--sm">today</span>Today</a>' : ''}
    <a class="btn btn--secondary btn--sm" href="#/claima/dtr/archive"><span class="icon icon--sm">inventory_2</span>Archive</a>
    ${day.status === 'Closed'
      ? `<a class="btn btn--secondary btn--sm" href="#/claima/dtr/archive/${esc(day.date)}"><span class="icon icon--sm">print</span>Export</a>
         <button class="btn btn--primary btn--sm" data-act="reopen-day"${reopenWhy ? ` disabled title="${esc(reopenWhy)}"` : ' title="Unlock the day with a reason; the next close writes the next version"'}><span class="icon icon--sm">lock_open</span>Reopen</button>`
      : `<button class="btn btn--primary btn--sm" data-act="close-day"${closeWhy ? ` disabled title="${esc(closeWhy)}"` : ' title="Freeze the report and lock the day"'}><span class="icon icon--sm">lock</span>${day.versions.length ? `Close day as v${day.versions.length + 1}` : 'Close day'}</button>`}`;
}

function bannersHtml(day, report) {
  const out = [];
  if (day.status === 'Reopened') {
    const ev = day.reopenEvents[day.reopenEvents.length - 1];
    out.push(`<div class="alert alert--warning"><span class="icon">lock_open</span><div><div class="title">Reopened by ${esc(ev?.by)} · ${dateTime(ev?.at)}</div>${esc(ev?.reason || '')} — the report is live again; closing writes v${day.versions.length + 1} with this reason on it.</div></div>`);
  }
  if (day.status === 'Closed') {
    out.push(`<div class="alert alert--info"><span class="icon">lock</span><div><div class="title">${esc(report.dtrNo)} — frozen ${dateTime(report.closedAt)} by ${esc(report.closedBy)}</div>What is on this page is the stored version, never recomputed. A posting dated on this day now lands on the next open day, flagged prior-day.${report.reopenReason ? ` Re-closed after a reopen: ${esc(report.reopenReason)}` : ''}</div></div>`);
  } else if (report.undocumentedReds) {
    out.push(`<div class="alert alert--critical"><span class="icon">error</span><div><div class="title">${report.undocumentedReds} RED check${report.undocumentedReds === 1 ? '' : 's'} to fix or document before the day can close</div>Select a card to read the offending transactions and the action that answers each.</div></div>`);
  } else if (report.redCount) {
    out.push(`<div class="alert alert--warning"><span class="icon">edit_note</span><div><div class="title">${report.redCount} RED check${report.redCount === 1 ? '' : 's'} documented</div>The day can close over ${report.redCount === 1 ? 'it' : 'them'}; the notes freeze into the version.</div></div>`);
  }
  return out.join('');
}
