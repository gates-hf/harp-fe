// The DTR archive at #/claima/dtr/archive: every closed day, newest first —
// its number, its versions, who closed it and when, how many exceptions it
// closed over and how often it was reopened — each row opening the frozen
// snapshot at /archive/<date>. Under it the month-to-date roll-up: the
// month's snapshots summed per section and category, latest version each,
// labelled informational because a sum of frozen reports is not a report.

import * as businessDays from '../../../../data/repositories/business-days.js';
import { date as fmtDate, dateTime, esc, usd } from '../../../../shared/format.js';
import { dayStatusHtml, moneyHtml } from './dtr-chips.js';

export const meta = { title: 'DTR archive' };

export async function render(mount, ctx) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(ctx.params[1] || '')) return (await import('./dtr-snapshot.js')).render(mount, ctx);
  await businessDays.ready;

  const res = await fetch(new URL('./dtr-archive.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load dtr-archive.html (${res.status})`);
  mount.innerHTML = await res.text();
  const $ = (sel) => mount.querySelector(sel);

  function draw() {
    ctx.setCrumb([{ label: 'Claima', path: '/claima/dtr' }, { label: 'Daily report', path: '/claima/dtr' }, { label: 'Archive' }]);
    const rows = businessDays.archive();
    $('#ar-count').textContent = `${rows.length} day${rows.length === 1 ? '' : 's'}`;
    $('#ar-body').innerHTML = rows.length ? tableHtml(rows) : `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">inventory_2</span></div>
        <div class="state-view__title">No day closed yet</div>
        <p class="state-view__body">Close today's report and its first version lands here.</p>
        <div class="state-view__actions"><a class="btn btn--primary" href="#/claima/dtr">Today's report</a></div>
      </div>`;
    const m = businessDays.mtd();
    $('#mtd-range').textContent = m.days ? `${m.days} closed day${m.days === 1 ? '' : 's'} · ${fmtDate(m.from)} – ${fmtDate(m.to)}` : `No closed day in ${m.month} yet`;
    $('#mtd-body').innerHTML = mtdHtml(m);
  }

  mount.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const tr = e.target.closest('tr[data-date]');
    if (tr) ctx.navigate(`/claima/dtr/archive/${tr.dataset.date}`);
  });
  mount.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-date]');
    if (tr && e.target === tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); ctx.navigate(`/claima/dtr/archive/${tr.dataset.date}`); }
  });

  ctx.onData(draw);
  draw();
}

function tableHtml(rows) {
  return `
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">Date</th>
          <th scope="col">DTR no.</th>
          <th scope="col">Status</th>
          <th scope="col" class="num">Versions</th>
          <th scope="col">Closed by / at</th>
          <th scope="col" class="num" title="RED checks the latest version was closed over with a note">Exceptions</th>
          <th scope="col">Reopen history</th>
          <th scope="col" class="num">Net patient cash</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((d) => {
          const v = d.latest;
          const cash = v.snapshot.sections.find((s) => s.key === 'patientCash');
          return `
            <tr data-date="${esc(d.date)}" tabindex="0" title="Open the frozen ${esc(v.dtrNo)}">
              <td>${esc(fmtDate(d.date))}</td>
              <td><a class="crumb-link t-mono-sm" href="#/claima/dtr/archive/${esc(d.date)}">${esc(v.dtrNo)}</a></td>
              <td>${dayStatusHtml(d.status)}</td>
              <td class="num t-mono-sm" title="${esc(d.versions.map((x) => x.dtrNo).join(', '))}">${d.versions.length}</td>
              <td>${esc(v.closedBy)}<br><span class="t-body-sm">${dateTime(v.closedAt)}</span></td>
              <td class="num">${v.exceptions.length ? `<span class="badge badge--warning" title="${esc(v.exceptions.map((x) => `${x.checkKey}: ${x.note}`).join('\n'))}">${v.exceptions.length}</span>` : '<span class="t-mono-sm">0</span>'}</td>
              <td>${d.reopenEvents.length ? d.reopenEvents.map((ev) => `<span class="t-body-sm" title="${esc(ev.reason)}">${dateTime(ev.at)} · ${esc(ev.by)}</span>`).join('<br>') : '<span class="t-body-sm">never reopened</span>'}</td>
              <td class="num">${moneyHtml(cash?.total, { zero: usd(0) })}</td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

function mtdHtml(m) {
  if (!m.days) return '<p class="t-body-sm">The roll-up sums the month\'s closed snapshots; none is on record yet.</p>';
  return `
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">Section</th>
          <th scope="col">Category</th>
          <th scope="col" class="num">Count</th>
          <th scope="col" class="num">Movement</th>
        </tr>
      </thead>
      <tbody>
        ${m.sections.map((s) => `
          ${s.categories.map((c) => `
            <tr>
              <td>${esc(s.label)}</td>
              <td>${esc(c.label)}</td>
              <td class="num t-mono-sm">${c.count}</td>
              <td class="num">${moneyHtml(c.movement)}</td>
            </tr>`).join('')}
          <tr>
            <th scope="row">${esc(s.label)}</th>
            <th scope="row">${esc(s.totalLabel)}</th>
            <td class="num t-mono-sm">${s.count}</td>
            <td class="num">${moneyHtml(s.total, { zero: usd(0) })}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    <p class="t-body-sm">Informational: the sum of ${m.days} frozen snapshot${m.days === 1 ? '' : 's'}, latest version each. A day reopened and re-closed counts once, at its newest version.</p>`;
}
