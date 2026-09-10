// Financial clearance at #/frontis/clearance — who is waiting on money, and on
// what. Reads go through data/repositories/clearance.js, which is also what
// recomputes every stamp on the screen; nothing here decides anything.
//
// The list is ordered the way the desk works it: blocked first, then
// conditional, then cleared, and inside each the one that has been waiting
// longest. A row opens the encounter's Clearance tab, which is where the five
// items are answered.

import * as clearance from '../../../../data/repositories/clearance.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as payers from '../../../../data/repositories/payers.js';
import { DEPARTMENTS } from '../../../../data/seed/reference.js';
import { CONFIG } from '../../../../shared/config.js';
import { dateTime, esc, relativeTime } from '../../../../shared/format.js';
import { metricKey } from '../../../../shared/metric-card.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { KPI, blank, railHtml, selectKpi } from './clearance-kpis.js';

export const meta = { title: 'Financial clearance' };

const PAGE_SIZE = 12;

export async function render(mount, ctx) {
  const res = await fetch(new URL('./clearance-worklist.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load clearance-worklist.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { ...blank(), page: 0 };
  const $ = (sel) => mount.querySelector(sel);

  const search = $('#cw-search');
  const statusSel = $('#cw-status');
  const itemSel = $('#cw-item');
  const typeSel = $('#cw-type');
  const departmentSel = $('#cw-department');
  const financialSel = $('#cw-financial');
  const fromInput = $('#cw-from');
  const toInput = $('#cw-to');

  statusSel.innerHTML = `<option value="">All clearance statuses</option>${
    clearance.STATUSES.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}`;
  itemSel.innerHTML = `<option value="">Any outstanding item</option>${
    clearance.ITEM_KEYS.map((k) =>
      `<option value="${esc(k)}">${esc(clearance.ITEM_LABELS[k])} outstanding</option>`).join('')}`;
  typeSel.innerHTML = `<option value="">All types</option>${
    encounters.TYPES.map((t) => `<option value="${t}">${esc(encounters.typeLabel(t))}</option>`).join('')}`;
  departmentSel.innerHTML = `<option value="">All departments</option>${
    DEPARTMENTS.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}`;
  financialSel.innerHTML = `<option value="">All financial classes</option><option value="self">Self-Pay</option>${
    payers.findActive().map((p) => `<option value="${esc(p.id)}">${esc(p.nameEn)}</option>`).join('')}`;

  function syncFilters() {
    search.value = state.q;
    statusSel.value = state.status;
    itemSel.value = state.item;
    typeSel.value = state.type;
    departmentSel.value = state.department;
    financialSel.value = state.financial;
    fromInput.value = state.from;
    toInput.value = state.to;
    for (const btn of mount.querySelectorAll('[data-scope]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.scope === state.scope));
    }
  }

  function draw() {
    $('#cw-metrics').innerHTML = railHtml(state);
    drawBanner();
    drawRows();
  }

  /** The one filter with no control of its own says so over the table. */
  function drawBanner() {
    const banner = $('#cw-banner');
    banner.hidden = !state.overdue;
    banner.innerHTML = state.overdue
      ? `<div class="alert alert--warning">
           <span class="icon">schedule</span>
           <div>Showing visits with an item outstanding for more than ${CONFIG.clearance.pendingAgeWarnHours}
             hours. The clock runs from the oldest unsettled item, not from the visit.</div>
         </div>`
      : '';
  }

  function drawRows() {
    const found = clearance.search(state.q, state);
    const pages = Math.max(1, Math.ceil(found.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    const start = state.page * PAGE_SIZE;
    const page = found.slice(start, start + PAGE_SIZE);
    const role = currentRole();

    $('#cw-rows').innerHTML = page.map((enc) => rowHtml(enc, role)).join('');

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

  function rowHtml(enc, role) {
    // The patient reads through view(), so a restricted record is named by its
    // initials here too — and its cover is withheld, the line the encounter
    // board already draws.
    const patient = patients.view(patients.get(enc.patientMrn), role);
    const indicator = clearance.indicator(enc);
    const stamp = clearance.stampOf(enc);
    const overdue = clearance.isOverdue(enc);
    return `
      <tr data-no="${esc(enc.no)}" tabindex="0" title="Open the clearance for ${esc(enc.no)}">
        <td>${esc(patient?.nameEn || enc.patientMrn)}${
          patient?.vip && !patient?.masked ? ' <span class="badge badge--accent">VIP</span>' : ''}
          <br><span class="t-mono-sm">${esc(enc.patientMrn)}</span></td>
        <td><span class="t-mono-sm">${esc(enc.no)}</span>
          <span class="badge${enc.type === 'ER' ? ' badge--critical' : enc.type === 'IP' ? ' badge--accent' : ''}"
                title="${esc(encounters.typeLabel(enc.type))}">${esc(enc.type)}</span></td>
        <td>${esc(enc.department)}</td>
        <td class="t-mono-sm">${dateTime(enc.startAt)}</td>
        <td>${patient?.masked
          ? '<span class="badge" title="A restricted record’s cover is read by roles with VIP access only">withheld</span>'
          : `<span title="${esc(encounters.financialTitle(enc))}">${esc(encounters.financialLabel(enc))}</span>`}</td>
        <td><span class="badge${indicator.tone ? ` badge--${indicator.tone}` : ''}" title="${esc(indicator.label)}">
              <span class="dot"></span>${esc(indicator.short)}</span></td>
        <td>${blockingHtml(stamp)}</td>
        <td>${stamp.pendingSince
          ? overdue
            // The design system tints a badge and not a line of text, so a wait
            // past the desk's patience is a critical chip rather than red type.
            ? `<span class="badge badge--critical"
                     title="Outstanding since ${esc(dateTime(stamp.pendingSince))} — past ${
              CONFIG.clearance.pendingAgeWarnHours} hours"><span class="dot"></span>${
              esc(relativeTime(stamp.pendingSince))}</span>`
            : `<span class="t-body-sm" title="Outstanding since ${esc(dateTime(stamp.pendingSince))}">${
              esc(relativeTime(stamp.pendingSince))}</span>`
          : '<span class="t-body-sm">—</span>'}</td>
        <td>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="open" title="Open the clearance for ${esc(enc.no)}">
            <span class="icon icon--sm">visibility</span>
          </button>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="encounter" title="Open the encounter">
            <span class="icon icon--sm">event_available</span>
          </button>
        </td>
      </tr>`;
  }

  /** Two chips and a count: a row says what is holding it, not why. */
  function blockingHtml(stamp) {
    const items = stamp.blocking || [];
    if (!items.length) return '<span class="t-body-sm">Nothing outstanding</span>';
    const shown = items.slice(0, 2).map((label) => `<span class="badge">${esc(label)}</span>`).join(' ');
    const rest = items.length - 2;
    return rest > 0
      ? `${shown} <span class="badge" title="${esc(items.slice(2).join('; '))}">+${rest}</span>`
      : shown;
  }

  function emptyHtml() {
    const filtered = state.q || state.status || state.type || state.department
      || state.financial || state.from || state.to || state.overdue;
    if (!filtered && state.scope === 'attention') {
      return `
        <div class="state-view">
          <div class="state-view__glyph"><span class="icon">check_circle</span></div>
          <div class="state-view__title">Everything is cleared</div>
          <p class="state-view__body">No patient is waiting on a financial blocker. Clearance is recomputed on
            every change, so this screen fills itself the moment one appears.</p>
          <div class="state-view__actions">
            <button class="btn btn--secondary" data-scope="all">Show the whole board</button>
          </div>
        </div>`;
    }
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">search_off</span></div>
        <div class="state-view__title">No visits found</div>
        <p class="state-view__body">No open encounter matches. Change the search text or clear the filters to see
          every visit on the board.</p>
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
    [statusSel, 'status'], [itemSel, 'item'], [typeSel, 'type'], [departmentSel, 'department'],
    [financialSel, 'financial'], [fromInput, 'from'], [toInput, 'to'],
  ]) {
    el.addEventListener('change', () => {
      state[key] = el.value;
      state.page = 0;
      draw();
    });
  }

  mount.addEventListener('click', (e) => {
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
    ctx.navigate(act === 'encounter' ? `/frontis/encounters/${no}` : `/frontis/encounters/${no}/clearance`);
  });

  mount.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-no]');
    if (tr && e.target === tr && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      ctx.navigate(`/frontis/encounters/${tr.dataset.no}/clearance`);
    }
  });

  // A deposit taken anywhere in the session, a decision captured on a pre-auth,
  // a check re-run — all of them recompute the stamps and land here.
  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));

  // A card on a dashboard opens the worklist pre-filtered:
  // #/frontis/clearance?status=Blocked&scope=all.
  applyQuery(ctx.query);
  syncFilters();
  draw();

  function applyQuery(q = {}) {
    if (q.scope === 'all' || q.scope === 'attention') state.scope = q.scope;
    if (clearance.STATUSES.includes(q.status)) Object.assign(state, { scope: 'all', status: q.status });
    // #/frontis/clearance?item=eligibility — the dashboard's "Pending
    // eligibility" card, which counts the rows this shows.
    if (clearance.ITEM_KEYS.includes(q.item)) Object.assign(state, { scope: 'all', item: q.item });
    if (encounters.TYPES.includes(q.type)) state.type = q.type;
    if (DEPARTMENTS.includes(q.department)) state.department = q.department;
    if (q.overdue === '1') Object.assign(state, KPI.overdue);
  }
}
