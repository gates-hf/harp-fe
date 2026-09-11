// Defensio root-cause worklist at #/defensio/rca — every case on file, open
// first with the overdue ones at the top, the rail's five slices, the search
// and the filters, and New RCA case (a manual case over any set of denials).
// Reads go through data/repositories/rca-cases.js and nowhere else. This
// feature also owns the deeper link and hands the mount over on it: anything
// after /rca is a case id (with a tab id after that).

import * as rcaCases from '../../../../data/repositories/rca-cases.js';
import * as payers from '../../../../data/repositories/payers.js';
import { STAFF } from '../../../../data/seed/staff.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { date, esc } from '../../../../shared/format.js';
import { metricKey } from '../../../../shared/metric-card.js';
import { KPI, blank, railHtml, selectKpi } from './rca-kpis.js';
import { analystHtml, causeHtml, causerHtml, denialsHtml, natureHtml, payersHtml, statusHtml, targetHtml, triggerHtml } from './rca-chips.js';
import { openNewCaseDialog } from './rca-dialogs.js';

export const meta = { title: 'Root cause' };

const PAGE_SIZE = 15;

export async function render(mount, ctx) {
  if (ctx.params[0]) return (await import('./rca-case.js')).render(mount, ctx);

  const res = await fetch(new URL('./rca-worklist.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load rca-worklist.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { ...blank(), page: 0 };
  const $ = (sel) => mount.querySelector(sel);
  const fields = {
    q: $('#rc-search'), status: $('#rc-status'), trigger: $('#rc-trigger'), nature: $('#rc-nature'),
    analyst: $('#rc-analyst'), payerId: $('#rc-payer'), from: $('#rc-from'), to: $('#rc-to'),
  };
  fields.status.innerHTML = `<option value="">All statuses</option>${rcaCases.STATUSES.map((s) => `<option value="${s}">${esc(rcaCases.statusLabel(s))}</option>`).join('')}`;
  fields.trigger.innerHTML = `<option value="">Any trigger</option>${rcaCases.TRIGGERS.map((t) => `<option value="${t}">${esc(rcaCases.triggerLabel(t))}</option>`).join('')}`;
  fields.nature.innerHTML = `<option value="">Any nature</option>${rcaCases.NATURES.map((n) => `<option value="${n}">${esc(rcaCases.natureLabel(n))}</option>`).join('')}`;
  fields.analyst.innerHTML = `<option value="">Any analyst</option><option value="me">Mine</option>${
    STAFF.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}`;
  fields.payerId.innerHTML = `<option value="">Any payer</option>${payers.all().map((p) => `<option value="${esc(p.id)}">${esc(p.nameEn)}</option>`).join('')}`;

  function syncFilters() {
    for (const [key, el] of Object.entries(fields)) el.value = state[key] || '';
  }

  const found = () => rcaCases.search(state.q, state);

  function draw() {
    $('#rc-metrics').innerHTML = railHtml(state);
    drawBody();
  }

  function drawBody() {
    const role = currentRole();
    const rows = found();
    const body = $('#rc-body');
    const filtered = Object.keys(KPI.all).some((k) => state[k] !== KPI.all[k]);
    if (!rows.length) return void (body.innerHTML = emptyHtml(filtered));
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    const start = state.page * PAGE_SIZE;
    const page = rows.slice(start, start + PAGE_SIZE);
    body.innerHTML = tableHtml(page, role) + pagerHtml(start, page.length, rows.length, state.page, pages);
  }

  // --- events -----------------------------------------------------------------

  for (const [key, el] of Object.entries(fields)) {
    el.addEventListener(key === 'q' ? 'input' : 'change', () => {
      state[key] = el.value;
      if (key === 'status' && el.value) { state.open = false; state.overdue = false; }
      state.page = 0;
      draw();
    });
  }

  mount.addEventListener('click', async (e) => {
    if (e.target.closest('a')) return undefined;
    const kpi = metricKey(e);
    if (kpi) {
      selectKpi(state, kpi);
      state.page = 0;
      syncFilters();
      return draw();
    }
    const pager = e.target.closest('[data-page]');
    if (pager && !pager.disabled) {
      state.page += pager.dataset.page === 'next' ? 1 : -1;
      return drawBody();
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'clear') {
      Object.assign(state, blank(), { page: 0 });
      syncFilters();
      return draw();
    }
    if (act === 'new') {
      const made = await openNewCaseDialog();
      if (made?.id) ctx.navigate(`/defensio/rca/${made.id}`);
      return undefined;
    }
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return undefined;
    return ctx.navigate(`/defensio/rca/${tr.dataset.id}`);
  });

  mount.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr && e.target === tr && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      ctx.navigate(`/defensio/rca/${tr.dataset.id}`);
    }
  });

  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));
  rcaCases.seedReady.then(() => { if (mount.isConnected) draw(); });

  // Deep links: ?status=, ?trigger=, ?nature=, ?analyst=me, ?payerId=, ?overdue=1, ?slice=.
  for (const key of ['status', 'trigger', 'nature', 'analyst', 'payerId']) if (ctx.query?.[key]) state[key] = ctx.query[key];
  if (ctx.query?.overdue) state.overdue = true;
  if (ctx.query?.slice && KPI[ctx.query.slice]) selectKpi(state, ctx.query.slice);
  syncFilters();
  draw();
}

function tableHtml(rows, role) {
  return `
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">Case</th>
          <th scope="col" title="What opened the case">Trigger</th>
          <th scope="col">Denials</th>
          <th scope="col">Payer</th>
          <th scope="col" title="The confirmed cause, or the tag the denials carry until the analysis confirms one">Root cause</th>
          <th scope="col">Nature</th>
          <th scope="col" title="Named on an individual finding; read unmasked by the authorised roles only">Person</th>
          <th scope="col">Analyst</th>
          <th scope="col">Status</th>
          <th scope="col">Opened</th>
          <th scope="col" title="Days to the target — red once passed">Target</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>${rows.map((c) => `
        <tr data-id="${esc(c.id)}" tabindex="0" title="Open ${esc(c.id)}"${rcaCases.isOverdue(c) ? ' aria-current="true"' : ''}>
          <td><a class="crumb-link t-mono-sm" href="#/defensio/rca/${esc(c.id)}">${esc(c.id)}</a><br><span class="t-body-sm">${esc(String(c.detail || '').slice(0, 56))}${String(c.detail || '').length > 56 ? '…' : ''}</span></td>
          <td>${triggerHtml(c)}</td>
          <td>${denialsHtml(c)}</td>
          <td>${payersHtml(c)}</td>
          <td>${causeHtml(c)}</td>
          <td>${natureHtml(c)}</td>
          <td>${causerHtml(c, role)}</td>
          <td>${analystHtml(c)}</td>
          <td>${statusHtml(c)}</td>
          <td><span class="t-body-sm">${date(c.openedAt)}</span></td>
          <td>${targetHtml(c)}</td>
          <td>
            <button class="btn btn--${rcaCases.isOpen(c) && !c.analystId ? 'primary' : 'secondary'} btn--sm" data-act="open" title="Open the case">
              <span class="icon icon--sm">${rcaCases.isOpen(c) ? 'troubleshoot' : 'open_in_new'}</span>${rcaCases.isOpen(c) ? 'Work' : 'Open'}
            </button>
          </td>
        </tr>`).join('')}</tbody>
    </table>`;
}

function pagerHtml(start, shown, total, page, pages) {
  return `
    <div class="tbl-foot">
      <span class="range">${start + 1}–${start + shown} of ${total}</span>
      <span class="pager">
        <button class="btn btn--secondary btn--sm" data-page="prev"${page === 0 ? ' disabled title="You are on the first page"' : ''}>
          <span class="icon icon--sm">chevron_left</span>Previous
        </button>
        <button class="btn btn--secondary btn--sm" data-page="next"${page >= pages - 1 ? ' disabled title="You are on the last page"' : ''}>
          Next<span class="icon icon--sm">chevron_right</span>
        </button>
      </span>
    </div>`;
}

function emptyHtml(filtered) {
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">${filtered ? 'search_off' : 'troubleshoot'}</span></div>
      <div class="state-view__title">${filtered ? 'Nothing matches' : 'No root-cause cases'}</div>
      <p class="state-view__body">${filtered
        ? 'No case matches these filters. Clear them to see the whole list.'
        : 'A case opens when a denial reaches the amount threshold, the same cause repeats inside the window or an appeal is lost — or by hand, over any set of denials.'}</p>
      <div class="state-view__actions">${filtered ? '<button class="btn btn--secondary" data-act="clear">Clear filters</button>' : '<button class="btn btn--primary" data-act="new">New RCA case</button>'}</div>
    </div>`;
}
