// Remittance workbench at #/claima/remittances — every remittance captured,
// Unposted first and oldest first, with the rail, the filters and the three
// ways in: Upload ERA, Manual entry and Unapplied cash. Reads go through
// data/repositories/remittances.js and nowhere else.
//
// This feature also owns the deeper paths and hands the mount over on them:
// /upload, /new, /unapplied, and a remittance number (with a tab id after it).

import * as remittances from '../../../../data/repositories/remittances.js';
import * as payers from '../../../../data/repositories/payers.js';
import { esc } from '../../../../shared/format.js';
import { metricKey } from '../../../../shared/metric-card.js';
import { KPI, blank, railHtml, selectKpi } from './remittance-kpis.js';
import { capturedHtml, matchSummary, money, paymentHtml, payerName, statusHtml } from './remittance-chips.js';
import { openRemittanceHistory } from './remittance-history.js';

export const meta = { title: 'Remittances' };

const PAGE_SIZE = 15;

const DEEPER = {
  upload: () => import('./era-upload.js'),
  new: () => import('./manual-entry.js'),
  unapplied: () => import('./unapplied-cash.js'),
};

export async function render(mount, ctx) {
  const first = ctx.params[0];
  if (DEEPER[first]) return (await DEEPER[first]()).render(mount, ctx);
  if (first) return (await import('./remittance-view.js')).render(mount, ctx);

  const res = await fetch(new URL('./workbench.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load workbench.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { ...blank(), page: 0 };
  const $ = (sel) => mount.querySelector(sel);
  const search = $('#rw-search');
  const payerSel = $('#rw-payer');
  const statusSel = $('#rw-status');
  const fromInput = $('#rw-from');
  const toInput = $('#rw-to');
  const unappliedSel = $('#rw-unapplied');

  payerSel.innerHTML = `<option value="">Any payer</option>${
    payers.all().map((p) => `<option value="${esc(p.id)}">${esc(p.nameEn)}</option>`).join('')}`;
  statusSel.innerHTML = `<option value="">All statuses</option>${
    remittances.STATUSES.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}`;

  function syncFilters() {
    search.value = state.q;
    payerSel.value = state.payerId;
    statusSel.value = state.status;
    fromInput.value = state.from;
    toInput.value = state.to;
    unappliedSel.value = state.unapplied;
  }

  const found = () => remittances.search(state.q, state)
    .filter((r) => !state.exceptions || remittances.openExceptions(r).length);

  function draw() {
    $('#rw-metrics').innerHTML = railHtml(state);
    drawBody();
  }

  function drawBody() {
    const rows = found();
    const body = $('#rw-body');
    if (!rows.length) return void (body.innerHTML = emptyHtml());
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    const start = state.page * PAGE_SIZE;
    const page = rows.slice(start, start + PAGE_SIZE);
    body.innerHTML = `
      <table class="tbl">
        <thead>
          <tr>
            <th scope="col">Remittance</th>
            <th scope="col">Payer</th>
            <th scope="col">Payment</th>
            <th scope="col">Total</th>
            <th scope="col">Claims</th>
            <th scope="col">Matching</th>
            <th scope="col">Posting</th>
            <th scope="col">Unapplied</th>
            <th scope="col">Captured</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>${page.map(rowHtml).join('')}</tbody>
      </table>
      <div class="tbl-foot">
        <span class="range">${start + 1}–${start + page.length} of ${rows.length}</span>
        <span class="pager">
          <button class="btn btn--secondary btn--sm" data-page="prev"${state.page === 0 ? ' disabled title="You are on the first page"' : ''}>
            <span class="icon icon--sm">chevron_left</span>Previous
          </button>
          <button class="btn btn--secondary btn--sm" data-page="next"${state.page >= pages - 1 ? ' disabled title="You are on the last page"' : ''}>
            Next<span class="icon icon--sm">chevron_right</span>
          </button>
        </span>
      </div>`;
  }

  function rowHtml(rem) {
    const open = remittances.openExceptions(rem).length;
    const unposted = rem.status === 'Unposted';
    return `
      <tr data-no="${esc(rem.remittanceNo)}" tabindex="0" title="Open ${esc(rem.remittanceNo)}">
        <td><span class="t-mono-sm">${esc(rem.remittanceNo)}</span></td>
        <td>${esc(payerName(rem.payerId))}</td>
        <td>${paymentHtml(rem)}</td>
        <td>${money(rem.payment.total)}</td>
        <td>${rem.claims.length}</td>
        <td><span class="t-body-sm">${esc(matchSummary(rem))}</span></td>
        <td>${statusHtml(rem)}${open ? ` <span class="badge badge--critical" title="${open} exception${open === 1 ? '' : 's'} open">${open}</span>` : ''}</td>
        <td>${rem.unapplied > 0 ? money(rem.unapplied) : '<span class="t-body-sm">—</span>'}</td>
        <td>${capturedHtml(rem)}</td>
        <td>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="open" title="${unposted ? 'Open — match and post' : 'Open'}">
            <span class="icon icon--sm">${unposted ? 'rule' : 'visibility'}</span>
          </button>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="history" title="View history">
            <span class="icon icon--sm">history</span>
          </button>
        </td>
      </tr>`;
  }

  function emptyHtml() {
    const filtered = state.q || state.payerId || state.status || state.from || state.to || state.unapplied || state.exceptions;
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">${filtered ? 'search_off' : 'payments'}</span></div>
        <div class="state-view__title">${filtered ? 'No remittances found' : 'Nothing captured yet'}</div>
        <p class="state-view__body">${filtered
          ? 'No remittance matches. Change the search text or clear the filters to see them all.'
          : 'A remittance arrives as the payer’s ERA file, or is typed in from its paper advice. Upload one, or enter one by hand.'}</p>
        <div class="state-view__actions">
          ${filtered ? '<button class="btn btn--secondary" data-act="clear">Clear filters</button>'
            : '<a class="btn btn--primary" href="#/claima/remittances/upload">Upload ERA</a>'}
        </div>
      </div>`;
  }

  // --- events ---------------------------------------------------------------

  search.addEventListener('input', () => { state.q = search.value; state.page = 0; draw(); });
  for (const [el, key] of [[payerSel, 'payerId'], [statusSel, 'status'], [fromInput, 'from'], [toInput, 'to'], [unappliedSel, 'unapplied']]) {
    el.addEventListener('change', () => { state[key] = el.value; state.page = 0; draw(); });
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
    const pager = e.target.closest('[data-page]');
    if (pager && !pager.disabled) {
      state.page += pager.dataset.page === 'next' ? 1 : -1;
      return drawBody();
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'clear') {
      Object.assign(state, KPI.all, { page: 0 });
      syncFilters();
      return draw();
    }
    const tr = e.target.closest('tr[data-no]');
    if (!tr) return undefined;
    if (act === 'history') return void openRemittanceHistory(tr.dataset.no);
    return ctx.navigate(`/claima/remittances/${tr.dataset.no}`);
  });

  mount.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-no]');
    if (tr && e.target === tr && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      ctx.navigate(`/claima/remittances/${tr.dataset.no}`);
    }
  });

  ctx.onData(draw);

  // A card on a dashboard opens the workbench pre-filtered:
  // #/claima/remittances?status=Unposted, ?exceptions=1, ?payerId=PY-0001.
  if (remittances.STATUSES.includes(ctx.query?.status)) state.status = ctx.query.status;
  if (ctx.query?.payerId && payers.get(ctx.query.payerId)) state.payerId = ctx.query.payerId;
  if (ctx.query?.exceptions === '1') state.exceptions = '1';
  if (ctx.query?.unapplied === '1') state.unapplied = '1';
  syncFilters();
  draw();
}
