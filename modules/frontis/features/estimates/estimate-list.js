// The estimates list at #/frontis/estimates — every quotation the desk has
// priced, newest first. Reads go through data/repositories/estimates.js and
// nowhere else.
//
// This feature also owns the deeper links and hands the mount over on each:
// /new is the builder, and anything else is an estimate number — which opens
// the builder while it is still a Draft and the document once it is not.

import * as estimates from '../../../../data/repositories/estimates.js';
import * as payers from '../../../../data/repositories/payers.js';
import { dateTime, esc, usd } from '../../../../shared/format.js';
import { metricKey } from '../../../../shared/metric-card.js';
import { ROLES, current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { blank, railHtml, selectKpi } from './estimate-kpis.js';
import { isWithheld, statusHtml, subjectHtml, validityHtml } from './estimate-chips.js';
import { handleAction } from './estimate-actions.js';

export const meta = { title: 'Cost estimates' };

const PAGE_SIZE = 12;

export async function render(mount, ctx) {
  const [first] = ctx.params;
  if (first === 'new') return (await import('./estimate-builder.js')).render(mount, ctx);
  if (first) {
    const row = estimates.get(first);
    if (!row) throw new Error(`No estimate ${first}`);
    const screen = estimates.isDraft(row) ? './estimate-builder.js' : './estimate-view.js';
    return (await import(screen)).render(mount, ctx);
  }

  const res = await fetch(new URL('./estimate-list.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load estimate-list.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { ...blank(), page: 0 };
  const $ = (sel) => mount.querySelector(sel);

  const search = $('#el-search');
  const statusSel = $('#el-status');
  const payerSel = $('#el-payer');
  const creatorSel = $('#el-creator');
  const fromInput = $('#el-from');
  const toInput = $('#el-to');

  statusSel.innerHTML = `<option value="">All statuses</option>${
    estimates.STATUSES.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}`;
  payerSel.innerHTML = `<option value="">All payers</option>${
    payers.findActive().map((p) => `<option value="${esc(p.id)}">${esc(p.nameEn)}</option>`).join('')}`;
  creatorSel.innerHTML = `<option value="">Anyone</option>${
    ROLES.map((r) => `<option value="${esc(r.name)}">${esc(r.name)}</option>`).join('')}`;

  function syncFilters() {
    search.value = state.q;
    statusSel.value = state.status;
    payerSel.value = state.payerId;
    creatorSel.value = state.creator;
    fromInput.value = state.from;
    toInput.value = state.to;
  }

  function draw() {
    $('#el-metrics').innerHTML = railHtml(state);
    drawBanner();
    drawRows();
  }

  /** The three date-shaped slices have no select of their own to speak for them. */
  function drawBanner() {
    const banner = $('#el-banner');
    const words = state.live ? 'issued and still inside their validity'
      : state.expiring ? `valid for ${estimates.EXPIRING_DAYS} more days or less`
        : state.convertedMonth ? 'accepted and converted into an encounter this month' : '';
    banner.hidden = !words;
    banner.innerHTML = words
      ? `<div class="alert alert--info">
           <span class="icon">filter_alt</span>
           <div>Showing estimates ${esc(words)}. Clear filters to see every quotation.</div>
         </div>`
      : '';
  }

  function drawRows() {
    const all = estimates.search(state.q, state);
    const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    const start = state.page * PAGE_SIZE;
    const page = all.slice(start, start + PAGE_SIZE);
    const role = currentRole();

    $('#el-rows').innerHTML = page.map((row) => rowHtml(row, role)).join('');

    const empty = $('#el-empty');
    empty.hidden = all.length > 0;
    mount.querySelector('.tbl').hidden = all.length === 0;
    if (!all.length) empty.innerHTML = emptyHtml();

    $('#el-range').textContent = all.length ? `${start + 1}–${start + page.length} of ${all.length}` : '0 of 0';
    setPager('prev', state.page === 0, 'You are on the first page');
    setPager('next', state.page >= pages - 1, 'You are on the last page');
  }

  function rowHtml(row, role) {
    const live = estimates.isLive(row);
    const totals = row.result?.totals;
    // A restricted record's cover and money are withheld here the way the
    // encounter board withholds its financial class: what was quoted is the
    // part a role without VIP access does not read.
    const withheld = isWithheld(row, role);
    const hidden = `<span class="badge" title="A restricted record's cover is read by roles with VIP access only">withheld</span>`;
    return `
      <tr data-no="${esc(row.no)}" tabindex="0" title="Open ${esc(row.no)}">
        <td class="t-mono-sm">${esc(row.no)}</td>
        <td>${subjectHtml(row, role)}</td>
        <td>${withheld ? hidden : esc(estimates.coverLabel(row))}</td>
        <td class="t-body-sm">${esc(estimates.servicesLabel(row))}</td>
        <td class="num t-mono-sm">${withheld ? '—' : totals ? usd(totals.allowed) : '—'}</td>
        <td class="num t-mono-sm"><b>${withheld ? '—' : totals ? usd(totals.patientShare) : '—'}</b></td>
        <td>${validityHtml(row)}</td>
        <td>${statusHtml(row)}</td>
        <td>${esc(row.createdBy)}<br><span class="t-body-sm">${dateTime(row.createdAt)}</span></td>
        <td>${row.encounterNo
          ? `<a class="crumb-link t-mono-sm" href="#/frontis/encounters/${esc(row.encounterNo)}">${esc(row.encounterNo)}</a>`
          : '<span class="t-mono-sm">—</span>'}</td>
        <td>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="open" title="Open ${esc(row.no)}">
            <span class="icon icon--sm">visibility</span>
          </button>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="duplicate" title="Copy this estimate into a new draft">
            <span class="icon icon--sm">content_copy</span>
          </button>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="print"${estimates.isDraft(row) ? ' disabled' : ''}
                  title="${esc(estimates.isDraft(row) ? 'A draft has nothing to print yet — issue it first' : 'Open and print the document')}">
            <span class="icon icon--sm">print</span>
          </button>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="convert"${live ? '' : ' disabled'}
                  title="${esc(live ? 'Open the encounter this estimate was quoted for' : 'Only an issued estimate inside its validity converts')}">
            <span class="icon icon--sm">move_up</span>
          </button>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="history" title="View history">
            <span class="icon icon--sm">history</span>
          </button>
        </td>
      </tr>`;
  }

  function emptyHtml() {
    const filtered = state.q || state.status || state.payerId || state.creator || state.from || state.to
      || state.live || state.expiring || state.convertedMonth;
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">${filtered ? 'search_off' : 'calculate'}</span></div>
        <div class="state-view__title">No estimates found</div>
        <p class="state-view__body">${
          filtered
            ? 'No estimates match. Change the search text or clear the filters to see every quotation.'
            : 'Nothing has been quoted yet. Price a visit before it happens and hand the patient the number.'
        }</p>
        <div class="state-view__actions">
          ${filtered ? '<button class="btn btn--secondary" data-act="clear">Clear filters</button>' : ''}
          <a class="btn btn--primary" href="#/frontis/estimates/new">New estimate</a>
        </div>
      </div>`;
  }

  function setPager(which, disabled, why) {
    const btn = mount.querySelector(`[data-page="${which}"]`);
    btn.disabled = disabled;
    btn.title = disabled ? why : '';
  }

  /** A card elsewhere opens this list already filtered: estimates?status=… */
  function applyQuery(q = {}) {
    if (estimates.STATUSES.includes(q.status)) state.status = q.status;
    if (q.payerId) state.payerId = q.payerId;
    if (q.live === '1') state.live = true;
    if (q.expiring === '1') state.expiring = true;
    syncFilters();
  }

  // --- events ---------------------------------------------------------------

  search.addEventListener('input', () => {
    state.q = search.value;
    state.page = 0;
    draw();
  });

  for (const [el, key] of [[statusSel, 'status'], [payerSel, 'payerId'], [creatorSel, 'creator'],
    [fromInput, 'from'], [toInput, 'to']]) {
    el.addEventListener('change', () => {
      state[key] = el.value;
      state.page = 0;
      draw();
    });
  }

  mount.addEventListener('click', async (e) => {
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

    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'clear') {
      Object.assign(state, blank(), { page: 0 });
      syncFilters();
      draw();
      return;
    }

    const tr = e.target.closest('tr[data-no]');
    if (!tr) return;
    if (!act || act === 'open') return ctx.navigate(`/frontis/estimates/${tr.dataset.no}`);
    await handleAction(act, tr.dataset.no, ctx);
  });

  mount.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-no]');
    if (tr && e.target === tr && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      ctx.navigate(`/frontis/estimates/${tr.dataset.no}`);
    }
  });

  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));

  applyQuery(ctx.query);
  draw();
}
