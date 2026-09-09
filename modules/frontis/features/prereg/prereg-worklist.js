// Expected Arrivals at #/frontis/prereg — what the desk is expecting, and how
// much of each arrival is already answered. Reads go through
// data/repositories/prereg.js and nowhere else.
//
// This feature also owns the deeper links and hands the mount over on each:
// /new and any pre-reg number open the form, and /<no>/convert the conversion
// screen — the shape the encounter board already uses.

import * as prereg from '../../../../data/repositories/prereg.js';
import { DEPARTMENTS, doctorName } from '../../../../data/seed/reference.js';
import { esc } from '../../../../shared/format.js';
import { metricKey } from '../../../../shared/metric-card.js';
import { KPI, blank, railHtml, selectKpi } from './prereg-kpis.js';
import { completenessCell } from './prereg-completeness.js';
import { arrivalHtml, patientHtml, precheckHtml, statusHtml } from './prereg-chips.js';
import { askCancel } from './prereg-actions.js';
import { openPreregHistory } from './prereg-history.js';

export const meta = { title: 'Expected arrivals' };

const PAGE_SIZE = 12;

export async function render(mount, ctx) {
  const [first, second] = ctx.params;
  if (second === 'convert') return (await import('./prereg-convert.js')).render(mount, ctx);
  if (first) return (await import('./prereg-form.js')).render(mount, ctx);

  const res = await fetch(new URL('./prereg-worklist.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load prereg-worklist.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { ...blank(), page: 0 };
  const $ = (sel) => mount.querySelector(sel);

  const search = $('#pw-search');
  const statusSel = $('#pw-status');
  const typeSel = $('#pw-type');
  const departmentSel = $('#pw-department');
  const fromInput = $('#pw-from');
  const toInput = $('#pw-to');

  statusSel.innerHTML = `<option value="">All statuses</option>${
    prereg.STATUSES.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}`;
  typeSel.innerHTML = `<option value="">All visit types</option>${
    prereg.VISIT_TYPES.map((t) => `<option value="${esc(t)}">${esc(prereg.typeLabel(t))}</option>`).join('')}`;
  departmentSel.innerHTML = `<option value="">All departments</option>${
    DEPARTMENTS.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}`;

  function syncFilters() {
    search.value = state.q;
    statusSel.value = state.status;
    typeSel.value = state.type;
    departmentSel.value = state.department;
    fromInput.value = state.from;
    toInput.value = state.to;
    for (const btn of mount.querySelectorAll('[data-scope]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.scope === state.scope));
    }
  }

  const scoped = () => prereg.search('', {}, { upcomingOnly: state.scope !== 'all' });
  const rows = () => prereg.search(state.q, state, { upcomingOnly: state.scope !== 'all' });

  function draw() {
    $('#pw-metrics').innerHTML = railHtml(state, scoped());
    drawBanner();
    drawRows();
  }

  /** The one filter with no control of its own says so over the table. */
  function drawBanner() {
    const banner = $('#pw-banner');
    banner.hidden = !state.precheck;
    banner.innerHTML = state.precheck
      ? `<div class="alert alert--critical">
           <span class="icon">gpp_maybe</span>
           <div>Showing arrivals whose eligibility pre-check was refused. Open the snapshot on the row to see
             which step failed, then attach another cover or record an override.</div>
         </div>`
      : '';
  }

  function drawRows() {
    const found = rows();
    const pages = Math.max(1, Math.ceil(found.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    const start = state.page * PAGE_SIZE;
    const page = found.slice(start, start + PAGE_SIZE);

    $('#pw-rows').innerHTML = page.map(rowHtml).join('');

    const empty = $('#pw-empty');
    empty.hidden = found.length > 0;
    mount.querySelector('.tbl').hidden = found.length === 0;
    if (!found.length) empty.innerHTML = emptyHtml();

    $('#pw-range').textContent = found.length ? `${start + 1}–${start + page.length} of ${found.length}` : '0 of 0';
    setPager('prev', state.page === 0, 'You are on the first page');
    setPager('next', state.page >= pages - 1, 'You are on the last page');
  }

  function setPager(which, disabled, why) {
    const btn = mount.querySelector(`[data-page="${which}"]`);
    btn.disabled = disabled;
    btn.title = disabled ? why : '';
  }

  function rowHtml(row) {
    const open = prereg.isOpen(row);
    return `
      <tr data-no="${esc(row.no)}" tabindex="0" title="Open ${esc(row.no)}">
        <td class="t-mono-sm">${esc(row.no)}</td>
        <td>${patientHtml(row)}</td>
        <td>${arrivalHtml(row)}</td>
        <td><span class="badge${row.visit.type === 'IP' ? ' badge--accent' : row.visit.type === 'ER' ? ' badge--critical' : ''}"
                 title="${esc(prereg.typeLabel(row.visit.type))}">${esc(row.visit.type)}</span></td>
        <td>${esc(row.visit.department)}<br><span class="t-body-sm">${esc(doctorName(row.visit.doctorId))}</span></td>
        <td>${completenessCell(row)}</td>
        <td>${precheckHtml(row)}</td>
        <td>${statusHtml(row)}</td>
        <td>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="open" title="Open ${esc(row.no)}">
            <span class="icon icon--sm">${open ? 'edit' : 'visibility'}</span>
          </button>
          ${action('convert', 'move_up', open,
            open ? `Convert ${row.no} into a patient and an encounter` : `A ${row.status.toLowerCase()} pre-registration cannot be converted`)}
          ${action('cancel', 'cancel', open,
            open ? `Cancel ${row.no}` : `This pre-registration is already ${row.status.toLowerCase()}`)}
          <button class="btn btn--ghost btn--icon btn--sm" data-act="history" title="View history">
            <span class="icon icon--sm">history</span>
          </button>
        </td>
      </tr>`;
  }

  const action = (act, icon, allowed, why) => `
    <button class="btn btn--ghost btn--icon btn--sm" data-act="${act}"${allowed ? '' : ' disabled'} title="${esc(why)}">
      <span class="icon icon--sm">${icon}</span>
    </button>`;

  function emptyHtml() {
    const filtered = state.q || state.status || state.type || state.department
      || state.from || state.to || state.precheck;
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">${filtered ? 'search_off' : 'event_upcoming'}</span></div>
        <div class="state-view__title">${filtered ? 'No pre-registrations found' : 'Nothing expected'}</div>
        <p class="state-view__body">${filtered
          ? 'No arrival matches. Change the search text or clear the filters to see the whole worklist.'
          : 'Nobody is booked in. A pre-registration captures what is known before the patient arrives, so registration is a hand-off and not a re-typing.'}</p>
        <div class="state-view__actions">
          ${filtered ? '<button class="btn btn--secondary" data-act="clear">Clear filters</button>' : ''}
          ${state.scope === 'upcoming' ? '<button class="btn btn--secondary" data-scope="all">Show the whole register</button>' : ''}
          <a class="btn btn--primary" href="#/frontis/prereg/new">New pre-registration</a>
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
    [statusSel, 'status'], [typeSel, 'type'], [departmentSel, 'department'],
    [fromInput, 'from'], [toInput, 'to'],
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

    const scope = e.target.closest('[data-scope]');
    if (scope) {
      state.scope = scope.dataset.scope;
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
    if (act === 'history') return void openPreregHistory(no);
    if (act === 'cancel') return void (await askCancel(no));
    if (act === 'convert') return ctx.navigate(`/frontis/prereg/${no}/convert`);
    ctx.navigate(`/frontis/prereg/${no}`);
  });

  mount.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-no]');
    if (tr && e.target === tr && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      ctx.navigate(`/frontis/prereg/${tr.dataset.no}`);
    }
  });

  // A pre-check run in the form, a conversion finished on another screen and the
  // expiry sweep all land here without a reload.
  ctx.onData(draw);

  // A card on a dashboard opens the worklist pre-filtered:
  // #/frontis/prereg?status=Ready&scope=all.
  applyQuery(ctx.query);
  syncFilters();
  draw();

  function applyQuery(q = {}) {
    if (q.scope === 'all' || q.scope === 'upcoming') state.scope = q.scope;
    if (prereg.STATUSES.includes(q.status)) state.status = q.status;
    if (prereg.VISIT_TYPES.includes(q.type)) state.type = q.type;
    if (DEPARTMENTS.includes(q.department)) state.department = q.department;
    if (q.precheck === 'Failed' || q.precheck === 'Pending' || q.precheck === 'Done') state.precheck = q.precheck;
  }
}
