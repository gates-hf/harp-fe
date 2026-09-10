// The coding worklist at #/claima/coding — every closed visit whose charges
// have been released, and how long each has waited for a coder. Reads go
// through data/repositories/coding.js and nowhere else.
//
// This feature also owns the deeper links and hands the mount over on each:
// /queries is the physician's queue, /metrics the four panels, and any other
// segment an encounter number opening the workspace.

import * as coding from '../../../../data/repositories/coding.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import { DEPARTMENTS, doctorName } from '../../../../data/seed/reference.js';
import { dateTime, esc, usd } from '../../../../shared/format.js';
import { metricKey } from '../../../../shared/metric-card.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { toast } from '../../../../shared/toast.js';
import { KPI, blank, railHtml, selectKpi } from './coding-kpis.js';
import { ageHtml, coderHtml, patientHtml, requestHtml, statusHtml, typeHtml } from './coding-chips.js';
import { askAssign } from './coding-assign.js';
import { openCodingHistory } from './coding-history.js';

export const meta = { title: 'Coding' };

const PAGE_SIZE = 12;

export async function render(mount, ctx) {
  const first = ctx.params[0];
  if (first === 'queries') return (await import('./physician-queries.js')).render(mount, ctx);
  if (first === 'metrics') return (await import('./coding-metrics.js')).render(mount, ctx);
  if (first) return (await import('./coding-workspace.js')).render(mount, ctx);

  const res = await fetch(new URL('./coding-worklist.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load coding-worklist.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { ...blank(), page: 0 };
  const $ = (sel) => mount.querySelector(sel);

  const search = $('#cw-search');
  const statusSel = $('#cw-status');
  const coderSel = $('#cw-coder');
  const departmentSel = $('#cw-department');
  const typeSel = $('#cw-type');
  const bandSel = $('#cw-band');
  const fromInput = $('#cw-from');
  const toInput = $('#cw-to');

  statusSel.innerHTML = `<option value="">All statuses</option>${
    coding.STATUSES.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}`;
  coderSel.innerHTML = `<option value="">Any coder</option>${
    coding.coders().map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}`;
  departmentSel.innerHTML = `<option value="">All departments</option>${
    DEPARTMENTS.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}`;
  typeSel.innerHTML = `<option value="">All types</option>${
    encounters.TYPES.map((t) => `<option value="${t}">${esc(encounters.typeLabel(t))}</option>`).join('')}`;
  bandSel.innerHTML = `<option value="">Any age</option>${
    coding.bandLabels().map((label, i) => `<option value="${i}">${esc(label)}</option>`).join('')}`;

  function syncFilters() {
    search.value = state.q;
    statusSel.value = state.status;
    coderSel.value = state.coder;
    departmentSel.value = state.department;
    typeSel.value = state.type;
    bandSel.value = state.band;
    fromInput.value = state.from;
    toInput.value = state.to;
    for (const btn of mount.querySelectorAll('[data-view]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.view === state.view));
    }
  }

  function draw() {
    $('#cw-metrics').innerHTML = railHtml(state);
    drawBanner();
    drawRows();
  }

  /** The three slices with no control of their own say so over the table. */
  function drawBanner() {
    const banner = $('#cw-banner');
    const text = state.beyondSla
      ? 'Showing open charts older than their SLA. The clock runs from the release of the charges — or from the recode request, on a chart sent back.'
      : state.awaiting
        ? 'Showing charts nobody has started: unassigned, or assigned and not yet drafted.'
        : state.working
          ? 'Showing charts with a draft in hand, and coded charts sent back for recode.'
          : '';
    banner.hidden = !text;
    banner.innerHTML = text
      ? `<div class="alert alert--info"><span class="icon">info</span><div>${esc(text)}</div></div>`
      : '';
  }

  function drawRows() {
    const found = coding.search(state.q, state);
    const pages = Math.max(1, Math.ceil(found.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    const start = state.page * PAGE_SIZE;
    const page = found.slice(start, start + PAGE_SIZE);
    const role = currentRole();

    $('#cw-rows').innerHTML = page.map((row) => rowHtml(row, role)).join('');

    const empty = $('#cw-empty');
    empty.hidden = found.length > 0;
    mount.querySelector('.tbl').hidden = found.length === 0;
    if (!found.length) empty.innerHTML = emptyHtml();

    $('#cw-range').textContent = found.length ? `${start + 1}–${start + page.length} of ${found.length}` : '0 of 0';
    setPager('prev', state.page === 0, 'You are on the first page');
    setPager('next', state.page >= pages - 1, 'You are on the last page');
  }

  function setPager(which, disabled, why) {
    const btn = mount.querySelector(`[data-page="${which}"]`);
    btn.disabled = disabled;
    btn.title = disabled ? why : '';
  }

  function rowHtml(row, role) {
    const assignWhy = coding.assignBlocked(row.record, role);
    const selfWhy = coding.selfAssignBlocked(row.record, role);
    return `
      <tr data-no="${esc(row.no)}" tabindex="0" title="Open the coding workspace for ${esc(row.no)}">
        <td><span class="t-mono-sm">${esc(row.no)}</span><br>${patientHtml(row.patientMrn, role)}</td>
        <td>${typeHtml(row.type)}</td>
        <td>${esc(row.department)}<br><span class="t-body-sm">${esc(doctorName(row.doctorId))}</span></td>
        <td class="t-mono-sm">${dateTime(row.completedAt)}</td>
        <td title="Released ${esc(dateTime(row.releasedAt))}">${row.lines.count} line${row.lines.count === 1 ? '' : 's'}
          <br><span class="t-mono-sm">${esc(usd(row.lines.value))}</span></td>
        <td>${statusHtml(row.status)} ${requestHtml(row.record)}</td>
        <td>${coderHtml(row.assignedTo)}</td>
        <td>${ageHtml(row)}</td>
        <td>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="assign" ${assignWhy ? `disabled title="${esc(assignWhy)}"` : 'title="Assign to a coder"'}>
            <span class="icon icon--sm">person_add</span>
          </button>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="self" ${selfWhy ? `disabled title="${esc(selfWhy)}"` : 'title="Take this chart"'}>
            <span class="icon icon--sm">front_hand</span>
          </button>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="open" title="Open the workspace">
            <span class="icon icon--sm">edit_document</span>
          </button>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="history" title="View history">
            <span class="icon icon--sm">history</span>
          </button>
        </td>
      </tr>`;
  }

  function emptyHtml() {
    if (state.view === 'mine' && !state.q && !state.status && !state.beyondSla && !state.awaiting && !state.working) {
      return `
        <div class="state-view">
          <div class="state-view__glyph"><span class="icon">inbox</span></div>
          <div class="state-view__title">Nothing assigned to you</div>
          <p class="state-view__body">Take a chart from the pool with the hand button on its row, or ask a supervisor
            to assign one. Charts you save a draft on become yours.</p>
          <div class="state-view__actions">
            <button class="btn btn--secondary" data-view="all">Show all charts</button>
          </div>
        </div>`;
    }
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">search_off</span></div>
        <div class="state-view__title">No charts found</div>
        <p class="state-view__body">No released chart matches. Change the search text or clear the filters to see
          the whole worklist.</p>
        <div class="state-view__actions">
          <button class="btn btn--secondary" data-act="clear">Clear filters</button>
        </div>
      </div>`;
  }

  // --- events ---------------------------------------------------------------

  search.addEventListener('input', () => {
    state.q = search.value;
    state.page = 0;
    draw();
  });

  for (const [el, key] of [
    [statusSel, 'status'], [coderSel, 'coder'], [departmentSel, 'department'], [typeSel, 'type'],
    [bandSel, 'band'], [fromInput, 'from'], [toInput, 'to'],
  ]) {
    el.addEventListener('change', () => {
      state[key] = el.value;
      state.page = 0;
      draw();
    });
  }

  mount.addEventListener('click', async (e) => {
    const kpi = metricKey(e);
    if (kpi) {
      selectKpi(state, kpi);
      state.page = 0;
      syncFilters();
      return draw();
    }

    const view = e.target.closest('[data-view]');
    if (view) {
      state.view = view.dataset.view;
      state.page = 0;
      syncFilters();
      return draw();
    }

    const pager = e.target.closest('[data-page]');
    if (pager && !pager.disabled) {
      state.page += pager.dataset.page === 'next' ? 1 : -1;
      return drawRows();
    }

    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'clear') {
      Object.assign(state, KPI.all, { page: 0 });
      syncFilters();
      return draw();
    }

    const tr = e.target.closest('tr[data-no]');
    if (!tr) return;
    const no = tr.dataset.no;
    if (act === 'assign') return void (await askAssign(no));
    if (act === 'self') {
      const rec = coding.selfAssign(no);
      if (rec) toast(`${no} is yours`, 'success');
      return;
    }
    if (act === 'history') return void (await openCodingHistory(no));
    ctx.navigate(`/claima/coding/${no}`);
  });

  mount.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-no]');
    if (tr && e.target === tr && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      ctx.navigate(`/claima/coding/${tr.dataset.no}`);
    }
  });

  // A draft saved in the workspace, a query answered by the physician, a
  // release from charge capture — all of them move a row here.
  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));

  // A card on a dashboard opens the worklist pre-filtered:
  // #/claima/coding?status=Query%20Pending, ?beyondSla=1, ?view=mine.
  applyQuery(ctx.query);
  syncFilters();
  draw();

  function applyQuery(q = {}) {
    if (q.view === 'mine' || q.view === 'all') state.view = q.view;
    if (coding.STATUSES.includes(q.status)) state.status = q.status;
    if (q.beyondSla === '1') Object.assign(state, KPI.beyondSla);
    if (q.awaiting === '1') Object.assign(state, KPI.awaiting);
    if (coding.coders().some((c) => c.id === q.coder)) state.coder = q.coder;
    if (DEPARTMENTS.includes(q.department)) state.department = q.department;
    if (encounters.TYPES.includes(q.type)) state.type = q.type;
  }
}
