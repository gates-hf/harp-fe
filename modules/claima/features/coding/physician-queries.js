// The physician's queue at #/claima/coding/queries — every CDI query still
// waiting for an answer, oldest first, because the one raised a week ago is
// the one holding a chart past its SLA. A row opens the thread, where a
// physician role answers; every other role reads it.
//
// The demo's physician role is not one of the attending doctors on the
// reference list, so the queue shows every physician's queries with a filter
// rather than one doctor's alone — the Answer button is what the role gates.

import * as coding from '../../../../data/repositories/coding.js';
import { DOCTORS } from '../../../../data/seed/reference.js';
import { esc } from '../../../../shared/format.js';
import { metricKey, metricRailHtml } from '../../../../shared/metric-card.js';
import { subscribe as onRole } from '../../../../shared/roles.js';
import { openQueryThread, queryRowHtml } from './cdi-queries.js';

export const meta = { title: 'Physician queries' };

export async function render(mount, ctx) {
  const res = await fetch(new URL('./physician-queries.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load physician-queries.html (${res.status})`);
  mount.innerHTML = await res.text();

  // `slice` is the rail card pressed, if any: a status the scope toggle cannot
  // name on its own.
  const state = { scope: 'open', q: '', physician: '', type: '', slice: '' };
  const $ = (sel) => mount.querySelector(sel);
  const search = $('#pq-search');
  const physicianSel = $('#pq-physician');
  const typeSel = $('#pq-type');

  ctx.setHeader(meta.title);
  ctx.setCrumb([{ label: 'Claima', path: '/claima/home' }, { label: 'Coding', path: '/claima/coding' }, { label: 'Queries' }]);

  physicianSel.innerHTML = `<option value="">Every physician</option>${
    DOCTORS.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')}`;
  typeSel.innerHTML = `<option value="">All types</option>${
    coding.QUERY_TYPES.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}`;

  const inSlice = (q) => (state.slice === 'open' ? q.status === 'Open'
    : state.slice === 'late' ? q.status === 'Open' && coding.queryTat(q) >= 3
      : state.slice === 'answered' ? q.status === 'Answered' : true);

  function rows() {
    const needle = state.q.trim().toLowerCase();
    return coding.queriesForPhysician(state.physician, { openOnly: state.scope === 'open' })
      .filter((q) => !state.type || q.type === state.type)
      .filter(inSlice)
      .filter((q) => !needle || q.id.toLowerCase().includes(needle) || q.encounterNo.toLowerCase().includes(needle)
        || q.question.toLowerCase().includes(needle));
  }

  function syncFilters() {
    search.value = state.q;
    physicianSel.value = state.physician;
    typeSel.value = state.type;
    for (const btn of mount.querySelectorAll('[data-scope]')) btn.setAttribute('aria-pressed', String(btn.dataset.scope === state.scope));
  }

  function draw() {
    const all = coding.queriesAll();
    const open = all.filter((q) => q.status === 'Open');
    const answered = all.filter((q) => q.status === 'Answered');
    const late = open.filter((q) => coding.queryTat(q) >= 3);
    const answeredEver = all.filter((q) => q.answeredAt);
    const avg = answeredEver.length ? answeredEver.reduce((s, q) => s + coding.queryTat(q), 0) / answeredEver.length : null;
    $('#pq-metrics').innerHTML = metricRailHtml([
      { value: open.length, label: 'Waiting for an answer', key: 'open', pressed: state.slice === 'open',
        tone: open.length ? 'warning' : '', sub: 'With the physician now',
        title: 'Queries no physician has answered yet — select to list them' },
      { value: late.length, label: 'Over 3 days', key: 'late', pressed: state.slice === 'late', tone: late.length ? 'critical' : '',
        sub: 'Waiting longer than three days', title: 'Open queries raised more than three days ago — select to list them' },
      { value: answered.length, label: 'Answered, unresolved', key: 'answered', pressed: state.slice === 'answered',
        sub: 'Back with the coder', title: 'Answered queries the coder has not yet resolved — select to list them' },
      { value: avg === null ? '—' : `${avg.toFixed(1)} d`, label: 'Average answer time', sub: 'Raised to answered, all time',
        title: 'Mean days from a query being raised to the physician answering it' },
    ]);

    const found = rows();
    $('#pq-rows').innerHTML = found.map((q) => queryRowHtml(q, { showEncounter: true })).join('');
    const empty = $('#pq-empty');
    empty.hidden = found.length > 0;
    mount.querySelector('.tbl').hidden = found.length === 0;
    if (!found.length) {
      empty.innerHTML = `
        <div class="state-view">
          <div class="state-view__glyph"><span class="icon">${state.scope === 'open' && !state.q && !state.physician && !state.type ? 'check_circle' : 'search_off'}</span></div>
          <div class="state-view__title">${state.scope === 'open' && !state.q && !state.physician && !state.type ? 'Nothing is waiting' : 'No queries found'}</div>
          <p class="state-view__body">${state.scope === 'open' && !state.q && !state.physician && !state.type
            ? 'Every query a coder has raised has been answered. A new one lands here the moment it is sent.'
            : 'No query matches. Change the search text or clear the filters.'}</p>
          <div class="state-view__actions"><button class="btn btn--secondary" data-act="clear">Clear filters</button></div>
        </div>`;
    }
  }

  search.addEventListener('input', () => { state.q = search.value; draw(); });
  physicianSel.addEventListener('change', () => { state.physician = physicianSel.value; draw(); });
  typeSel.addEventListener('change', () => { state.type = typeSel.value; draw(); });

  mount.addEventListener('click', async (e) => {
    const kpi = metricKey(e);
    if (kpi) {
      // A card widens the scope to every query and narrows to its own status;
      // a second click clears it.
      Object.assign(state, { scope: 'all', type: '', q: '', physician: '', slice: state.slice === kpi ? '' : kpi });
      syncFilters();
      return draw();
    }
    const scope = e.target.closest('[data-scope]');
    if (scope) {
      Object.assign(state, { scope: scope.dataset.scope, slice: '' });
      syncFilters();
      return draw();
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'clear') {
      Object.assign(state, { scope: 'open', q: '', physician: '', type: '', slice: '' });
      syncFilters();
      return draw();
    }
    const tr = e.target.closest('tr[data-query]');
    if (tr) return void (await openQueryThread(tr.dataset.query));
  });

  mount.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-query]');
    if (tr && e.target === tr && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openQueryThread(tr.dataset.query);
    }
  });

  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));
  if (DOCTORS.some((d) => d.id === ctx.query?.physician)) state.physician = ctx.query.physician;
  syncFilters();
  draw();
}
