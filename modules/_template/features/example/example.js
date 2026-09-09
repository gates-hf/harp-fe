// Example feature — the shape every feature copies: fetch its .html, fill it
// from a repository, wire every control. Reads and writes go through
// data/repositories/patients.js and nowhere else.

import * as patients from '../../../../data/repositories/patients.js';
import { date, esc } from '../../../../shared/format.js';
import { metricRailHtml, metricKey, kpiFilter } from '../../../../shared/metric-card.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { toast } from '../../../../shared/toast.js';
import { openDetail, openNew } from '../../components/patient-dialogs.js';

export const meta = { title: 'Example screen' };

const PAGE_SIZE = 12;

export async function render(mount, ctx) {
  const url = new URL('./example.html', import.meta.url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Cannot load example.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { q: '', status: '', city: '', sort: 'nameEn', dir: 'asc', page: 0 };

  const $ = (sel) => mount.querySelector(sel);
  const search = $('#ex-search');
  const statusSel = $('#ex-status');
  const citySel = $('#ex-city');

  statusSel.innerHTML =
    '<option value="">All statuses</option>' +
    patients.STATUSES.map((s) => `<option value="${s}">${s}</option>`).join('');
  citySel.innerHTML =
    '<option value="">All cities</option>' +
    patients.cities().map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');

  function rows() {
    return patients.search(state.q, state, { includeMerged: state.status === 'Merged' });
  }

  // A KPI card is a control, not a label: it selects the rows it counts, so the
  // number on the card and the row count under it are one figure, and a second
  // click on the pressed card clears the filters again. A card that summarises
  // a column instead of naming a slice sorts by it — see Seen before.
  const KPI = {
    all: { q: '', status: '', city: '' },
    active: { status: 'Active' },
    blocked: { status: 'Blocked' },
  };

  const { showing, select } = kpiFilter(state, KPI);

  function drawMetrics() {
    const c = patients.counts();
    $('#ex-metrics').innerHTML = metricRailHtml([
      { value: c.total, label: 'Patients', key: 'all', pressed: showing('all'),
        title: `${c.total} patients in the register — select to clear the filters` },
      { value: c.active, label: 'Active', key: 'active', pressed: showing('active'),
        title: 'Records an encounter can be opened against — select to list them' },
      { value: c.blocked, label: 'Blocked', key: 'blocked', pressed: showing('blocked'),
        tone: c.blocked ? 'warning' : '',
        title: 'Records barred from registration — select to list them' },
      { value: c.withVisit, label: 'Seen before', key: 'lastVisitAt',
        pressed: state.sort === 'lastVisitAt',
        title: 'Patients with a recorded visit — select to sort by last visit' },
    ]);
  }

  function selectKpi(key) {
    if (KPI[key]) select(key);
    else {
      // A sort card puts the rows driving its number on top, and turns the
      // order round on a second click the way the column header does.
      state.dir = state.sort === key && state.dir === 'desc' ? 'asc' : 'desc';
      state.sort = key;
      markSort();
    }
    state.page = 0;
    syncFilters();
    draw();
  }

  function syncFilters() {
    search.value = state.q;
    statusSel.value = state.status;
    citySel.value = state.city;
  }

  function drawRows() {
    const all = rows();
    const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    const start = state.page * PAGE_SIZE;
    const page = all.slice(start, start + PAGE_SIZE);

    $('#ex-rows').innerHTML = page.map((p) => rowHtml(patients.view(p, currentRole()))).join('');

    const empty = $('#ex-empty');
    empty.hidden = all.length > 0;
    mount.querySelector('.tbl').hidden = all.length === 0;
    if (!all.length) {
      empty.innerHTML = `
        <div class="state-view">
          <div class="state-view__glyph"><span class="icon">search_off</span></div>
          <div class="state-view__title">No patients match</div>
          <p class="state-view__body">Change the search text or clear the filters to see the full list.</p>
          <div class="state-view__actions">
            <button class="btn btn--secondary" data-action="clear">Clear filters</button>
          </div>
        </div>`;
    }

    $('#ex-range').textContent = all.length
      ? `${start + 1}–${start + page.length} of ${all.length}`
      : '0 of 0';

    setPager('prev', state.page === 0, 'You are on the first page');
    setPager('next', state.page >= pages - 1, 'You are on the last page');
  }

  function setPager(which, disabled, why) {
    const btn = mount.querySelector(`[data-page="${which}"]`);
    btn.disabled = disabled;
    btn.title = disabled ? why : '';
  }

  function rowHtml(p) {
    const tone = patients.statusTone(p.status);
    return `
      <tr data-mrn="${p.mrn}" tabindex="0" title="Open ${esc(p.nameEn)}">
        <td>${esc(p.nameEn)} · <span class="t-mono-sm">${esc(p.gender[0])}</span></td>
        <td class="t-mono-sm">${esc(p.mrn)}</td>
        <td><span class="badge${tone ? ` badge--${tone}` : ''}"><span class="dot"></span>${p.status}</span></td>
        <td>${esc(p.nationality)}</td>
        <td>${esc(p.city)}</td>
        <td class="t-mono-sm">${p.phone ? esc(p.phone) : '—'}</td>
        <td class="t-mono-sm">${date(p.lastVisitAt)}</td>
      </tr>`;
  }

  function draw() {
    drawMetrics();
    drawRows();
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

  // --- events ---------------------------------------------------------------

  search.addEventListener('input', () => {
    state.q = search.value;
    state.page = 0;
    draw();
  });

  statusSel.addEventListener('change', () => {
    state.status = statusSel.value;
    state.page = 0;
    draw();
  });

  citySel.addEventListener('change', () => {
    state.city = citySel.value;
    state.page = 0;
    draw();
  });

  mount.addEventListener('click', async (e) => {
    const kpi = metricKey(e);
    if (kpi) return selectKpi(kpi);

    const sort = e.target.closest('.sort-btn');
    if (sort) {
      const key = sort.dataset.sort;
      state.dir = state.sort === key && state.dir === 'asc' ? 'desc' : 'asc';
      state.sort = key;
      markSort();
      drawRows();
      return;
    }

    const pager = e.target.closest('[data-page]');
    if (pager && !pager.disabled) {
      state.page += pager.dataset.page === 'next' ? 1 : -1;
      drawRows();
      return;
    }

    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'clear') {
      Object.assign(state, { ...KPI.all, page: 0 });
      syncFilters();
      draw();
      return;
    }
    if (action === 'export') {
      toast(`Export queued — ${rows().length} patients`, 'info');
      return;
    }
    if (action === 'new') {
      const created = await openNew();
      if (created) {
        draw();
        toast(`${created.nameEn} added as ${created.mrn}`, 'success');
      }
      return;
    }

    const row = e.target.closest('tr[data-mrn]');
    if (row) show(row.dataset.mrn);
  });

  mount.addEventListener('keydown', (e) => {
    const row = e.target.closest('tr[data-mrn]');
    if (row && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      show(row.dataset.mrn);
    }
  });

  // The modal is transient state, so it stays out of the hash — changing the
  // hash re-runs the route and would tear this screen down underneath it.
  // Deep links still land on a patient (see below); they just do not survive
  // closing the dialog.
  async function show(mrn) {
    await openDetail(mrn);
    draw();
  }

  // The list is live: a patient registered or blocked anywhere in the session
  // lands here without a reload.
  ctx.onData(draw);

  markSort();
  draw();

  // Deep link: #/template/example/MRN-000101 opens that patient.
  if (ctx.params[0] && patients.get(ctx.params[0])) {
    openDetail(ctx.params[0]).then(draw);
  }
}
