// Referrals at #/frontis/referrals — the questions doctors have asked, in and
// out, and which of them are still worth an appointment. Reads go through
// data/repositories/referrals.js and nowhere else.
//
// This feature also owns the deeper links and hands the mount over on each:
// /new and any referral number open the form, and /<no>/view the read-only page
// — the shape the encounter board and the expected-arrivals worklist use.

import * as referrals from '../../../../data/repositories/referrals.js';
import * as sources from '../../../../data/repositories/referral-sources.js';
import { SPECIALTIES } from '../../../../data/seed/reference.js';
import { date, esc } from '../../../../shared/format.js';
import { metricKey } from '../../../../shared/metric-card.js';
import { KPI, blank, railHtml, selectKpi } from './referral-kpis.js';
import {
  directionHtml, encountersHtml, patientHtml, statusHtml, validHtml, visitsHtml,
} from './referral-chips.js';
import { askCancel, askExtend, askLink, askReject } from './referral-actions.js';
import { openReferralHistory } from './referral-history.js';

export const meta = { title: 'Referrals' };

const PAGE_SIZE = 12;

export async function render(mount, ctx) {
  const [first, second] = ctx.params;
  if (second === 'view') return (await import('./referral-view.js')).render(mount, ctx);
  if (first) return (await import('./referral-form.js')).render(mount, ctx);

  const res = await fetch(new URL('./referral-worklist.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load referral-worklist.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { ...blank(), page: 0 };
  const $ = (sel) => mount.querySelector(sel);

  const search = $('#rw-search');
  const directionSel = $('#rw-direction');
  const statusSel = $('#rw-status');
  const specialtySel = $('#rw-specialty');
  const sourceSel = $('#rw-source');
  const fromInput = $('#rw-from');
  const toInput = $('#rw-to');

  directionSel.innerHTML = `<option value="">Both directions</option>${
    referrals.DIRECTIONS.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}`;
  statusSel.innerHTML = `<option value="">All statuses</option>${
    referrals.STATUSES.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}`;
  specialtySel.innerHTML = `<option value="">All specialties</option>${
    SPECIALTIES.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}`;
  sourceSel.innerHTML = `<option value="">Any facility or doctor</option>${
    [...sources.search('Facility'), ...sources.search('Doctor')]
      .map((s) => `<option value="${esc(s.id)}">${esc(sources.label(s.id))}</option>`).join('')}`;

  function syncFilters() {
    search.value = state.q;
    directionSel.value = state.direction;
    statusSel.value = state.status;
    specialtySel.value = state.specialty;
    sourceSel.value = state.sourceId;
    fromInput.value = state.from;
    toInput.value = state.to;
    for (const btn of mount.querySelectorAll('[data-view]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.view === state.view));
    }
  }

  const rows = () => referrals.search(state.q, state);

  function draw() {
    $('#rw-metrics').innerHTML = railHtml(state);
    drawBanner();
    drawRows();
  }

  /** The one filter with no control of its own says so over the table. */
  function drawBanner() {
    const banner = $('#rw-banner');
    banner.hidden = !state.expiring;
    banner.innerHTML = state.expiring
      ? `<div class="alert alert--warning">
           <span class="icon">schedule</span>
           <div>Showing referrals that lapse within ${referrals.CONFIG.expiringDays} days. They are still good —
             book them first, or extend the validity from the row.</div>
         </div>`
      : '';
  }

  function drawRows() {
    const found = rows();
    const pages = Math.max(1, Math.ceil(found.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    const start = state.page * PAGE_SIZE;
    const page = found.slice(start, start + PAGE_SIZE);

    $('#rw-rows').innerHTML = page.map(rowHtml).join('');

    const empty = $('#rw-empty');
    empty.hidden = found.length > 0;
    mount.querySelector('.tbl').hidden = found.length === 0;
    if (!found.length) empty.innerHTML = emptyHtml();

    $('#rw-range').textContent = found.length ? `${start + 1}–${start + page.length} of ${found.length}` : '0 of 0';
    setPager('prev', state.page === 0, 'You are on the first page');
    setPager('next', state.page >= pages - 1, 'You are on the last page');
  }

  function setPager(which, disabled, why) {
    const btn = mount.querySelector(`[data-page="${which}"]`);
    btn.disabled = disabled;
    btn.title = disabled ? why : '';
  }

  function rowHtml(row) {
    const open = referrals.isOpen(row);
    const spendable = open && referrals.remaining(row) > 0 && row.direction === 'Inbound' && row.patientMrn;
    return `
      <tr data-no="${esc(row.no)}" tabindex="0" title="Open ${esc(row.no)}">
        <td class="t-mono-sm">${esc(row.no)}</td>
        <td>${directionHtml(row)}</td>
        <td>${patientHtml(row)}</td>
        <td>${esc(referrals.partiesLabel(row))}</td>
        <td>${esc(referrals.specialtyOf(row) || '—')}</td>
        <td class="t-mono-sm">${date(row.referralDate)}</td>
        <td>${validHtml(row)}</td>
        <td>${visitsHtml(row)}</td>
        <td>${statusHtml(row)}</td>
        <td>${encountersHtml(row)}</td>
        <td>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="open" title="${
            open ? `Edit ${esc(row.no)}` : `Open ${esc(row.no)}`}">
            <span class="icon icon--sm">${open ? 'edit' : 'visibility'}</span>
          </button>
          ${action('link', 'link', spendable, spendable
            ? `Open an encounter against ${row.no}`
            : row.direction === 'Outbound' ? 'An outbound referral is not spent on our own encounters'
              : !row.patientMrn ? 'Register the patient first — this referral has no record to hang a visit off'
                : `A ${row.status.toLowerCase()} referral cannot be linked`)}
          ${action('reject', 'thumb_down', open, open
            ? `Reject ${row.no}`
            : `This referral is already ${row.status.toLowerCase()}`)}
          ${action('cancel', 'cancel', open, open
            ? `Cancel ${row.no}`
            : `This referral is already ${row.status.toLowerCase()}`)}
          ${action('extend', 'more_time', row.status === 'Expired', row.status === 'Expired'
            ? `Give ${row.no} more time and put it back on the worklist`
            : 'Extending validity is offered on an expired referral — open it to change the date')}
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
    const filtered = state.q || state.direction || state.status || state.specialty
      || state.sourceId || state.expiring || state.from || state.to;
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">${filtered ? 'search_off' : 'forward'}</span></div>
        <div class="state-view__title">${filtered ? 'No referrals found' : 'Nothing referred'}</div>
        <p class="state-view__body">${filtered
          ? 'No referral matches. Change the search text or clear the filters to see the whole register.'
          : 'Nobody has been referred in or out. A referral is a doctor’s question, and it is spent by the visit that answers it.'}</p>
        <div class="state-view__actions">
          ${filtered ? '<button class="btn btn--secondary" data-act="clear">Clear filters</button>' : ''}
          ${state.view !== 'all' ? '<button class="btn btn--secondary" data-view="all">Show the whole register</button>' : ''}
          <a class="btn btn--primary" href="#/frontis/referrals/new?direction=Inbound">New inbound referral</a>
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
    [directionSel, 'direction'], [statusSel, 'status'], [specialtySel, 'specialty'],
    [sourceSel, 'sourceId'], [fromInput, 'from'], [toInput, 'to'],
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
    if (act === 'history') return void openReferralHistory(no);
    if (act === 'link') return void (await askLink(no, ctx));
    if (act === 'reject') return void (await askReject(no));
    if (act === 'cancel') return void (await askCancel(no));
    if (act === 'extend') return void (await askExtend(no));
    ctx.navigate(referrals.isOpen(referrals.get(no)) ? `/frontis/referrals/${no}` : `/frontis/referrals/${no}/view`);
  });

  mount.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-no]');
    if (tr && e.target === tr && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      ctx.navigate(`/frontis/referrals/${tr.dataset.no}/view`);
    }
  });

  // A referral linked on the registration flow, a schedule taken on the form
  // and the expiry sweep all land here without a reload.
  ctx.onData(draw);

  // A card on a dashboard opens the worklist pre-filtered:
  // #/frontis/referrals?view=all&status=Expired.
  applyQuery(ctx.query);
  syncFilters();
  draw();

  function applyQuery(q = {}) {
    if (['inbound', 'all', 'outbound'].includes(q.view)) state.view = q.view;
    if (referrals.DIRECTIONS.includes(q.direction)) state.direction = q.direction;
    if (referrals.STATUSES.includes(q.status)) state.status = q.status;
    if (SPECIALTIES.includes(q.specialty)) state.specialty = q.specialty;
    if (q.expiring === '1') Object.assign(state, KPI.expiring);
  }
}
