// Standard Codes — the landing at #/pactum/standard-codes: every code system
// with its current version, and the rail that says which of them nobody can
// resolve on. Reads and writes go through data/repositories/ and nowhere else.
//
// This feature also owns the deeper links: #/pactum/standard-codes/<id> is the
// system page (versions, codes, history) and /<id>/import its bulk importer,
// so the list hands the mount over on both, the way Payer Master does.

import * as systems from '../../../../data/repositories/code-systems.js';
import * as codes from '../../../../data/repositories/standard-codes.js';
import { date, dateTime, esc } from '../../../../shared/format.js';
import { metricKey } from '../../../../shared/metric-card.js';
import { toast } from '../../../../shared/toast.js';
import { confirm } from '../../../../shared/modal.js';
import { openSystemForm } from './system-form.js';
import { openSystemHistory } from './tab-history.js';
import { KPI, railHtml, selectKpi } from './standard-codes-kpis.js';

export const meta = { title: 'Standard Codes' };

const PAGE_SIZE = 12;

export async function render(mount, ctx) {
  if (ctx.params[0]) {
    const view = await import('./code-system-view.js');
    return view.render(mount, ctx);
  }

  const res = await fetch(new URL('./standard-codes.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load standard-codes.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { q: '', systemType: '', status: '', noCurrent: false, sort: 'name', dir: 'asc', page: 0 };
  const $ = (sel) => mount.querySelector(sel);

  const search = $('#sc-search');
  const typeSel = $('#sc-type');
  const statusSel = $('#sc-status');

  typeSel.innerHTML =
    '<option value="">All types</option>' +
    systems.TYPES.map((t) => `<option value="${t}">${systems.typeLabel(t)}</option>`).join('');
  statusSel.innerHTML =
    '<option value="">All statuses</option>' +
    systems.STATUSES.map((s) => `<option value="${s}">${s}</option>`).join('');

  function drawMetrics() {
    $('#sc-metrics').innerHTML = railHtml(state);
  }

  function syncFilters() {
    search.value = state.q;
    typeSel.value = state.systemType;
    statusSel.value = state.status;
  }

  function drawRows() {
    const all = codes.systemRows(state);
    const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    const start = state.page * PAGE_SIZE;
    const page = all.slice(start, start + PAGE_SIZE);

    $('#sc-rows').innerHTML = page.map(rowHtml).join('');

    const empty = $('#sc-empty');
    empty.hidden = all.length > 0;
    mount.querySelector('.tbl').hidden = all.length === 0;
    if (!all.length) empty.innerHTML = emptyHtml(state);

    $('#sc-range').textContent = all.length ? `${start + 1}–${start + page.length} of ${all.length}` : '0 of 0';
    setPager('prev', state.page === 0, 'You are on the first page');
    setPager('next', state.page >= pages - 1, 'You are on the last page');
  }

  function emptyHtml(s) {
    const filtered = s.q || s.systemType || s.status || s.noCurrent;
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">${filtered ? 'search_off' : 'menu_book'}</span></div>
        <div class="state-view__title">No code systems found</div>
        <p class="state-view__body">${filtered
          ? 'Change the search text or clear the filters to see the full list.'
          : "Click 'Add system' to register the first vocabulary."}</p>
        <div class="state-view__actions">
          ${filtered ? '<button class="btn btn--secondary" data-action="clear">Clear filters</button>' : ''}
          <button class="btn btn--primary" data-action="new">Add system</button>
        </div>
      </div>`;
  }

  function setPager(which, disabled, why) {
    const btn = mount.querySelector(`[data-page="${which}"]`);
    btn.disabled = disabled;
    btn.title = disabled ? why : '';
  }

  function currentHtml({ system, current }) {
    if (current) return `<span class="badge badge--accent">${esc(current.versionLabel)}</span> <span class="t-body-sm">from ${date(current.validFrom)}</span>`;
    if (system.status !== 'Active') return '<span class="t-body-sm">—</span>';
    return '<span class="badge badge--critical" title="Lookups fall back to the newest active version and warn, or find nothing"><span class="dot"></span>None</span>';
  }

  function rowHtml(r) {
    const { system: s } = r;
    const active = s.status === 'Active';
    return `
      <tr data-id="${s.id}" tabindex="0" title="Open ${esc(s.name)}">
        <td>${esc(s.name)}<br><span class="t-mono-sm">${esc(s.id)}</span></td>
        <td>${esc(systems.typeLabel(s.systemType))}</td>
        <td>${currentHtml(r)}</td>
        <td class="t-mono-sm">${r.versions}</td>
        <td class="t-mono-sm">${r.codes}</td>
        <td class="t-mono-sm">${date(s.validFrom)}${s.validTo ? ` – ${date(s.validTo)}` : ' onward'}</td>
        <td><span class="badge${active ? ' badge--success' : ''}"><span class="dot"></span>${s.status}</span></td>
        <td class="t-mono-sm">${dateTime(r.updatedAt)}</td>
        <td>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="open" title="Open ${esc(s.name)}">
            <span class="icon icon--sm">open_in_new</span>
          </button>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="edit" title="Edit ${esc(s.name)}">
            <span class="icon icon--sm">edit</span>
          </button>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="toggle" title="${active ? 'Deactivate' : 'Activate'} ${esc(s.name)}">
            <span class="icon icon--sm">${active ? 'toggle_on' : 'toggle_off'}</span>
          </button>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="history" title="View history">
            <span class="icon icon--sm">history</span>
          </button>
        </td>
      </tr>`;
  }

  function markSort() {
    for (const btn of mount.querySelectorAll('.sort-btn')) {
      const on = btn.dataset.sort === state.sort;
      btn.querySelector('.icon').textContent = on ? (state.dir === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more';
      btn.closest('th').setAttribute('aria-sort', on ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    }
  }

  function draw() {
    drawMetrics();
    drawRows();
  }

  /** #/pactum/standard-codes?systemType=LAB&status=Active lands filtered; the controls move with the state. */
  function applyQuery(q = {}) {
    if (systems.TYPES.includes(q.systemType)) typeSel.value = state.systemType = q.systemType;
    if (systems.STATUSES.includes(q.status)) statusSel.value = state.status = q.status;
    if (q.noCurrent === '1') state.noCurrent = true;
  }

  // --- actions --------------------------------------------------------------

  async function add() {
    const row = await openSystemForm(null);
    draw();
    if (row) toast(`${row.name} added`, 'success');
  }

  async function edit(id) {
    const row = await openSystemForm(id);
    draw();
    if (row) toast(`${row.name} saved`, 'success');
  }

  async function toggle(id) {
    const system = systems.get(id);
    if (!system) return;
    const next = system.status === 'Active' ? 'Inactive' : 'Active';
    if (next === 'Inactive') {
      const ok = await confirm({
        title: 'Deactivate code system',
        body: `${system.name} stays on file with its versions and codes, and drops out of every lookup in the platform.`,
        confirmLabel: 'Deactivate',
        icon: 'toggle_off',
      });
      if (!ok) return;
    }
    systems.setStatus(id, next);
    draw();
    toast(`${system.name} ${next === 'Active' ? 'activated' : 'deactivated'}`, 'success');
  }

  // --- events ---------------------------------------------------------------

  search.addEventListener('input', () => {
    state.q = search.value;
    state.page = 0;
    draw();
  });

  for (const [el, key] of [[typeSel, 'systemType'], [statusSel, 'status']]) {
    el.addEventListener('change', () => {
      state[key] = el.value;
      state.page = 0;
      draw();
    });
  }

  mount.addEventListener('click', (e) => {
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

    const kpi = metricKey(e);
    if (kpi) {
      selectKpi(state, kpi);
      state.page = 0;
      syncFilters();
      draw();
      return;
    }

    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'clear') {
      Object.assign(state, { ...KPI.all, page: 0 });
      syncFilters();
      draw();
      return;
    }
    if (action === 'new') return void add();

    const row = e.target.closest('tr[data-id]');
    if (!row) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'edit') return void edit(row.dataset.id);
    if (act === 'toggle') return void toggle(row.dataset.id);
    if (act === 'history') return void openSystemHistory(row.dataset.id);
    ctx.navigate(`/pactum/standard-codes/${row.dataset.id}`);
  });

  mount.addEventListener('keydown', (e) => {
    const row = e.target.closest('tr[data-id]');
    if (row && e.target === row && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      ctx.navigate(`/pactum/standard-codes/${row.dataset.id}`);
    }
  });

  // The list is live: a version made current from the system page lands here
  // without a reload.
  ctx.onData(draw);

  applyQuery(ctx.query);
  markSort();
  draw();
}
