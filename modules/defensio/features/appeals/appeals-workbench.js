// Defensio appeals workbench at #/defensio/appeals — every appeal case,
// deadline ascending for the ones still to file, with the rail's four
// slices, the Active | Submitted | All scope, the search and the filters.
// Reads go through data/repositories/appeal-cases.js and nowhere else.
//
// This feature also owns the deeper links and hands the mount over on them:
// /appeals/<case id> is the case page (a tab id after it), and
// /appeals/<case id>/package the printable package.

import * as appealCases from '../../../../data/repositories/appeal-cases.js';
import * as payers from '../../../../data/repositories/payers.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { esc } from '../../../../shared/format.js';
import { metricKey } from '../../../../shared/metric-card.js';
import { KPI, applySlice, blank, railHtml, selectKpi } from './appeal-kpis.js';
import { emptyHtml, pagerHtml, tableHtml } from './appeal-rows.js';

export const meta = { title: 'Appeals' };

const PAGE_SIZE = 15;

export async function render(mount, ctx) {
  if (ctx.params[0] && ctx.params[1] === 'package') return (await import('./appeal-package.js')).render(mount, ctx);
  if (ctx.params[0]) return (await import('./appeal-case.js')).render(mount, ctx);

  const res = await fetch(new URL('./appeals-workbench.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load appeals-workbench.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { ...blank(), page: 0 };
  const $ = (sel) => mount.querySelector(sel);
  const fields = {
    q: $('#ap-search'), payerId: $('#ap-payer'), status: $('#ap-status'), level: $('#ap-level'), tier: $('#ap-tier'),
    deadline: $('#ap-deadline'), preparer: $('#ap-preparer'), from: $('#ap-from'), to: $('#ap-to'),
  };
  fields.payerId.innerHTML = `<option value="">Any payer</option>${
    payers.all().map((p) => `<option value="${esc(p.id)}">${esc(p.nameEn)}</option>`).join('')}`;

  function drawStatusOptions() {
    const keep = fields.status.value;
    fields.status.innerHTML = `<option value="">All statuses</option>${
      appealCases.filterOptions().statuses.map((s) => `<option value="${esc(s)}">${esc(appealCases.statusLabel(s))}</option>`).join('')}`;
    fields.status.value = keep;
  }

  function syncFilters() {
    for (const [key, el] of Object.entries(fields)) el.value = state[key] || '';
    for (const b of mount.querySelectorAll('#ap-scope [data-scope]')) b.setAttribute('aria-pressed', String(b.dataset.scope === (state.scope || 'all')));
  }

  const found = () => applySlice(appealCases.search(state.q, state), state.slice, currentRole());

  function draw() {
    drawStatusOptions();
    $('#ap-metrics').innerHTML = railHtml(state);
    drawBody();
  }

  function drawBody() {
    const rows = found();
    const body = $('#ap-body');
    const filtered = Object.keys(KPI.all).some((k) => (state[k] || '') !== (KPI.all[k] || ''));
    if (!rows.length) return void (body.innerHTML = emptyHtml(filtered));
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    const start = state.page * PAGE_SIZE;
    const page = rows.slice(start, start + PAGE_SIZE);
    body.innerHTML = tableHtml(page, currentRole()) + pagerHtml(start, page.length, rows.length, state.page, pages);
  }

  // --- events -----------------------------------------------------------------

  for (const [key, el] of Object.entries(fields)) {
    el.addEventListener(key === 'q' ? 'input' : 'change', () => {
      state[key] = el.value;
      if (key === 'status' && el.value) { state.slice = ''; state.scope = 'all'; }
      state.page = 0;
      syncFilters();
      draw();
    });
  }

  mount.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const kpi = metricKey(e);
    if (kpi) {
      selectKpi(state, kpi);
      state.page = 0;
      syncFilters();
      return draw();
    }
    const scope = e.target.closest('#ap-scope [data-scope]');
    if (scope) {
      state.scope = scope.dataset.scope;
      state.slice = '';
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
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return undefined;
    return ctx.navigate(`/defensio/appeals/${tr.dataset.id}`);
  });

  mount.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr && e.target === tr && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      ctx.navigate(`/defensio/appeals/${tr.dataset.id}`);
    }
  });

  // A citation added on a case page, a review signed, a submission — every
  // commit redraws the list; a change of demo role re-reads the masking and
  // the Awaiting my review card.
  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));
  appealCases.peersReady.then(() => { if (mount.isConnected) draw(); });

  // Deep links: ?status=, ?payerId=, ?level=, ?tier=, ?deadline=, ?preparer=me, ?scope=, ?slice=.
  for (const key of ['status', 'payerId', 'level', 'tier', 'deadline', 'preparer', 'scope']) {
    if (ctx.query?.[key]) state[key] = ctx.query[key];
  }
  if (ctx.query?.status) state.scope = 'all';
  if (ctx.query?.slice && KPI[ctx.query.slice]) selectKpi(state, ctx.query.slice);
  syncFilters();
  draw();
}
