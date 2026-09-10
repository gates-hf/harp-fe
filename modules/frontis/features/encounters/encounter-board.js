// The encounter board at #/frontis/encounters — who is in the building, and
// who is booked. Reads go through data/repositories/encounters.js and nowhere
// else.
//
// This feature also owns the deeper links and hands the mount over on each:
// /new is the registration flow, anything else is an encounter number and opens
// the encounter page.

import * as encounters from '../../../../data/repositories/encounters.js';
import * as clearance from '../../../../data/repositories/clearance.js';
import * as accounts from '../../../../data/repositories/accounts.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as payers from '../../../../data/repositories/payers.js';
import { DEPARTMENTS, DOCTORS, doctorName } from '../../../../data/seed/reference.js';
import { dateTime, esc } from '../../../../shared/format.js';
import { metricKey } from '../../../../shared/metric-card.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { KPI, blank, railHtml, selectKpi } from './encounter-kpis.js';
import { askCancel, askDischarge, askEdit } from './encounter-actions.js';
import { openEncounterHistory } from './encounter-history.js';

export const meta = { title: 'Encounters' };

const PAGE_SIZE = 12;

export async function render(mount, ctx) {
  const [first, second] = ctx.params;
  if (first === 'new') return (await import('./encounter-new.js')).render(mount, ctx);
  // Posting a visit's charges is the account's screen rather than the board's,
  // but it hangs off an encounter number, so the board hands the mount over the
  // way it already does for the encounter page.
  if (second === 'post-charges') return (await import('../accounts/post-charges.js')).render(mount, ctx);
  if (first) return (await import('./encounter-view.js')).render(mount, ctx);

  const res = await fetch(new URL('./encounter-board.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load encounter-board.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { ...blank(), page: 0 };
  const $ = (sel) => mount.querySelector(sel);

  const search = $('#eb-search');
  const typeSel = $('#eb-type');
  const statusSel = $('#eb-status');
  const departmentSel = $('#eb-department');
  const doctorSel = $('#eb-doctor');
  const financialSel = $('#eb-financial');
  const fromInput = $('#eb-from');
  const toInput = $('#eb-to');

  typeSel.innerHTML = `<option value="">All types</option>${
    encounters.TYPES.map((t) => `<option value="${t}">${esc(encounters.typeLabel(t))}</option>`).join('')}`;
  statusSel.innerHTML = `<option value="">All statuses</option>${
    encounters.STATUSES.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
    <option value="unsettled">Unsettled completed</option>`;
  departmentSel.innerHTML = `<option value="">All departments</option>${
    DEPARTMENTS.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}`;
  doctorSel.innerHTML = `<option value="">All doctors</option>${
    DOCTORS.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')}`;
  financialSel.innerHTML = `<option value="">All financial classes</option><option value="self">Self-Pay</option>${
    payers.findActive().map((p) => `<option value="${esc(p.id)}">${esc(p.nameEn)}</option>`).join('')}`;

  function syncFilters() {
    search.value = state.q;
    typeSel.value = state.type;
    statusSel.value = state.status;
    departmentSel.value = state.department;
    doctorSel.value = state.doctorId;
    financialSel.value = state.financial;
    fromInput.value = state.from;
    toInput.value = state.to;
    for (const btn of mount.querySelectorAll('[data-scope]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.scope === state.scope));
    }
  }

  function rows() {
    // "Unsettled completed" is a settlement answer rather than a status: the
    // status filter is cleared for the search and the reconciliation decides.
    const unsettled = state.status === 'unsettled';
    const found = encounters.search(state.q, unsettled ? { ...state, status: '' } : state);
    const narrowed = unsettled
      ? found.filter((row) => ['Discharged', 'Completed'].includes(row.status) && accounts.reconcile(row.no)?.outcome === 'Unsettled')
      : found;
    return state.notCleared ? narrowed.filter(encounters.needsClearance) : narrowed;
  }

  function draw() {
    $('#eb-metrics').innerHTML = railHtml(state);
    drawBanner();
    drawRows();
  }

  /** The one filter with no control of its own says so over the table. */
  function drawBanner() {
    const banner = $('#eb-banner');
    banner.hidden = !state.notCleared;
    banner.innerHTML = state.notCleared
      ? `<div class="alert alert--warning">
           <span class="icon">assignment_late</span>
           <div>Showing encounters whose financial clearance is blocked or only conditionally cleared. The
             answer is computed on every change, and the items behind it sit in the tooltip on each row —
             the whole checklist is on the encounter's Clearance tab.</div>
         </div>`
      : '';
  }

  function drawRows() {
    const all = rows();
    const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    const start = state.page * PAGE_SIZE;
    const page = all.slice(start, start + PAGE_SIZE);
    const role = currentRole();

    $('#eb-rows').innerHTML = page.map((row) => rowHtml(row, role)).join('');

    const empty = $('#eb-empty');
    empty.hidden = all.length > 0;
    mount.querySelector('.tbl').hidden = all.length === 0;
    if (!all.length) empty.innerHTML = emptyHtml();

    $('#eb-range').textContent = all.length ? `${start + 1}–${start + page.length} of ${all.length}` : '0 of 0';
    setPager('prev', state.page === 0, 'You are on the first page');
    setPager('next', state.page >= pages - 1, 'You are on the last page');
  }

  function setPager(which, disabled, why) {
    const btn = mount.querySelector(`[data-page="${which}"]`);
    btn.disabled = disabled;
    btn.title = disabled ? why : '';
  }

  function rowHtml(row, role) {
    // The patient reads through view(), so a restricted record is named by its
    // initials here too — a board is read across a desk.
    const patient = patients.view(patients.get(row.patientMrn), role);
    const stamp = clearance.indicator(row);
    const open = encounters.isOpen(row);
    const bedded = row.type !== 'OP';
    return `
      <tr data-no="${esc(row.no)}" tabindex="0" title="Open ${esc(row.no)}">
        <td class="t-mono-sm">${esc(row.no)}</td>
        <td>${esc(patient?.nameEn || row.patientMrn)}${patient?.vip && !patient?.masked ? ' <span class="badge badge--accent">VIP</span>' : ''}
          <br><span class="t-mono-sm">${esc(row.patientMrn)}</span></td>
        <td><span class="badge${row.type === 'ER' ? ' badge--critical' : row.type === 'IP' ? ' badge--accent' : ''}"
                 title="${esc(encounters.typeLabel(row.type))}">${esc(row.type)}</span></td>
        <td>${esc(row.department)}</td>
        <td>${esc(doctorName(row.doctorId))}</td>
        <td>${patient?.masked
          ? '<span class="badge" title="A restricted record’s cover is read by roles with VIP access only">withheld</span>'
          : `<span title="${esc(encounters.financialTitle(row))}">${esc(encounters.financialLabel(row))}</span>`}</td>
        <td><span class="badge${encounters.statusTone(row.status) ? ` badge--${encounters.statusTone(row.status)}` : ''}">
              <span class="dot"></span>${esc(row.status)}</span>
          ${row.settlement?.status === 'Settled'
            ? `<span class="badge badge--success" title="${esc(`Settled ${dateTime(row.settlement.at)} by ${row.settlement.by}`)}">✓ Settled</span>` : ''}</td>
        <td><span class="badge${stamp.tone ? ` badge--${stamp.tone}` : ''}" data-act="clearance"
                  title="${esc(stamp.label)} — open the checklist">
              <span class="dot"></span>${esc(stamp.short)}</span></td>
        <td class="t-mono-sm">${dateTime(row.startAt)}</td>
        <td>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="open" title="Open ${esc(row.no)}">
            <span class="icon icon--sm">visibility</span>
          </button>
          ${action('edit', 'edit', open, open ? `Edit the visit details of ${row.no}` : `A ${row.status.toLowerCase()} encounter cannot be edited`)}
          ${action('discharge', 'logout', open && bedded && row.status === 'Active',
            bedded ? (row.status === 'Active' ? `Discharge ${row.no}` : 'Only an active admission is discharged')
              : 'An outpatient visit completes on its own')}
          ${action('cancel', 'cancel', !encounters.cancelBlocked(row, role),
            encounters.cancelBlocked(row, role) || `Cancel ${row.no}`)}
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
    const filtered = state.q || state.type || state.status || state.department || state.doctorId
      || state.from || state.to || state.financial || state.notCleared;
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">${filtered ? 'search_off' : 'event_available'}</span></div>
        <div class="state-view__title">No encounters${state.scope === 'today' && !filtered ? ' today' : ' found'}</div>
        <p class="state-view__body">${filtered
          ? 'No encounter matches. Change the search text or clear the filters to see the whole board.'
          : 'Nothing has opened today. An encounter starts from here, or from the patient record.'}</p>
        <div class="state-view__actions">
          ${filtered ? '<button class="btn btn--secondary" data-act="clear">Clear filters</button>' : ''}
          ${state.scope === 'today' ? '<button class="btn btn--secondary" data-scope="all">Show the whole register</button>' : ''}
          <a class="btn btn--primary" href="#/frontis/encounters/new">New encounter</a>
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
    [typeSel, 'type'], [statusSel, 'status'], [departmentSel, 'department'],
    [doctorSel, 'doctorId'], [financialSel, 'financial'], [fromInput, 'from'], [toInput, 'to'],
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
    if (act === 'clearance') return ctx.navigate(`/frontis/encounters/${no}/clearance`);
    if (act === 'history') return void openEncounterHistory(no);
    if (act === 'edit') return void (await askEdit(no));
    if (act === 'cancel') return void (await askCancel(no));
    if (act === 'discharge') return void (await askDischarge(no));
    ctx.navigate(`/frontis/encounters/${no}`);
  });

  mount.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-no]');
    if (tr && e.target === tr && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      ctx.navigate(`/frontis/encounters/${tr.dataset.no}`);
    }
  });

  // The board is live on both axes: an encounter opened, discharged or
  // cancelled anywhere in the session lands here, and switching demo role
  // re-reads the masking on every patient name.
  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));

  // A card on a dashboard, or the patient record, opens the board pre-filtered:
  // #/frontis/encounters?status=Active&scope=all.
  applyQuery(ctx.query);
  syncFilters();
  draw();

  function applyQuery(q = {}) {
    if (q.scope === 'all' || q.scope === 'today') state.scope = q.scope;
    if (encounters.STATUSES.includes(q.status) || q.status === 'unsettled') state.status = q.status;
    if (encounters.TYPES.includes(q.type)) state.type = q.type;
    if (DEPARTMENTS.includes(q.department)) state.department = q.department;
    if (q.notCleared === '1') state.notCleared = true;
  }
}
