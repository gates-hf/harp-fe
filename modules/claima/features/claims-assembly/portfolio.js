// Claim portfolio at #/claima/claims — every claim still on the desk, by
// payer, by status or flat, with the scrub, finalize and refresh actions on
// each row and the two bulk actions over a selection. Reads go through
// data/repositories/claims.js and nowhere else.
//
// This feature also owns the deeper link and hands the mount over on it: a
// claim number opens the claim page, with a tab id after it.

import * as claims from '../../../../data/repositories/claims.js';
import * as payers from '../../../../data/repositories/payers.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { esc, usd } from '../../../../shared/format.js';
import { metricKey } from '../../../../shared/metric-card.js';
import { KPI, blank, railHtml, selectKpi } from './claim-kpis.js';
import { rowsTableHtml, groupHtml, emptyHtml } from './portfolio-rows.js';
import { askFinalize, bulkFinalize, bulkScrub, runScrub } from './claim-actions.js';
import { askRefresh } from './claim-refresh.js';
import { openClaimHistory } from './claim-history.js';

export const meta = { title: 'Claims' };

const PAGE_SIZE = 15;

export async function render(mount, ctx) {
  if (ctx.params[0]) return (await import('./claim-view.js')).render(mount, ctx);

  const res = await fetch(new URL('./portfolio.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load portfolio.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { ...blank(), group: 'payer', page: 0, selected: new Set() };
  const $ = (sel) => mount.querySelector(sel);

  const search = $('#cp-search');
  const payerSel = $('#cp-payer');
  const statusSel = $('#cp-status');
  const scrubSel = $('#cp-scrub');
  const bandSel = $('#cp-band');
  const ageSel = $('#cp-age');
  const fromInput = $('#cp-from');
  const toInput = $('#cp-to');

  payerSel.innerHTML = `<option value="">Any payer</option>${
    payers.all().map((p) => `<option value="${esc(p.id)}">${esc(p.nameEn)}</option>`).join('')}`;
  statusSel.innerHTML = `<option value="">All statuses</option>${
    claims.STATUSES.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}`;
  scrubSel.innerHTML = `<option value="">Any scrub result</option>${
    claims.SCRUB_RESULTS.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')
  }<option value="none">Not run</option><option value="voided">Voided</option>`;
  bandSel.innerHTML = `<option value="">Any value</option>${
    claims.VALUE_BANDS.map((b) => `<option value="${b.id}">${esc(b.label)}</option>`).join('')}`;
  ageSel.innerHTML = `<option value="">Any age</option>${
    claims.AGE_BANDS.map((b) => `<option value="${b.id}">${esc(b.label)}</option>`).join('')}`;

  function syncFilters() {
    search.value = state.q;
    payerSel.value = state.payerId;
    statusSel.value = state.status;
    scrubSel.value = state.scrub;
    bandSel.value = state.band;
    ageSel.value = state.age;
    fromInput.value = state.from;
    toInput.value = state.to;
    for (const btn of mount.querySelectorAll('[data-scope]')) btn.setAttribute('aria-pressed', String(btn.dataset.scope === state.view));
    for (const btn of mount.querySelectorAll('[data-group]')) btn.setAttribute('aria-pressed', String(btn.dataset.group === state.group));
  }

  const found = () => {
    const rows = claims.portfolio(state.q, state);
    return state.sort === 'age' && state.dir === 'asc' ? rows.reverse() : rows;
  };

  function draw() {
    $('#cp-metrics').innerHTML = railHtml(state);
    drawBanner();
    drawBody();
    drawBulk();
  }

  /** The Stale count is the one thing worth saying over the table. */
  function drawBanner() {
    const banner = $('#cp-banner');
    const stale = claims.inAssembly().filter(claims.isStale).length;
    const peers = claims.peerStatus();
    const missing = ['charges', 'coding', 'clinicalDocs'].filter((k) => !peers[k]);
    banner.innerHTML = `${stale && !state.stale
      ? `<div class="alert alert--warning">
           <span class="icon">sync_problem</span>
           <div>${stale} claim${stale === 1 ? ' has' : 's have'} gone stale — the coding or the charges behind ${stale === 1 ? 'it' : 'them'}
             moved after assembly. Refresh re-assembles a claim and shows what changed.</div>
         </div>` : ''}${missing.length
      ? `<div class="alert alert--info">
           <span class="icon">info</span>
           <div>Not loaded yet: ${missing.join(', ')}. Assembly reads the ledger's posted charges and keeps each claim's coding
             snapshot until those repositories exist.</div>
         </div>` : ''}`;
  }

  function drawBody() {
    const role = currentRole();
    const rows = found();
    const body = $('#cp-body');
    for (const id of [...state.selected]) if (!rows.some((c) => c.id === id)) state.selected.delete(id);
    if (!rows.length) {
      body.innerHTML = emptyHtml(state);
      return;
    }
    if (state.group === 'flat') {
      const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
      state.page = Math.min(state.page, pages - 1);
      const start = state.page * PAGE_SIZE;
      const page = rows.slice(start, start + PAGE_SIZE);
      body.innerHTML = `
        ${rowsTableHtml(page, role, state)}
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
      return;
    }
    const groups = new Map();
    const keyOf = (c) => (state.group === 'payer' ? c.payerId : c.status);
    for (const c of rows) (groups.get(keyOf(c)) || groups.set(keyOf(c), []).get(keyOf(c))).push(c);
    const ordered = [...groups.entries()].sort(([a], [b]) => (state.group === 'status'
      ? claims.STATUSES.indexOf(a) - claims.STATUSES.indexOf(b)
      : (payers.get(a)?.nameEn || a).localeCompare(payers.get(b)?.nameEn || b)));
    body.innerHTML = ordered.map(([key, list]) => groupHtml({
      title: state.group === 'payer' ? (payers.get(key)?.nameEn || key) : key,
      rows: list,
      role,
      state,
    })).join('');
  }

  function drawBulk() {
    const n = state.selected.size;
    const scrub = $('#cp-bulk-scrub');
    const fin = $('#cp-bulk-finalize');
    const drafts = [...state.selected].map((id) => claims.get(id)).filter((c) => c?.status === 'Draft');
    const passing = drafts.filter((c) => claims.canFinalize(c).ok);
    scrub.disabled = !drafts.length;
    scrub.title = drafts.length ? `Run the scrub on ${drafts.length} draft${drafts.length === 1 ? '' : 's'}` : 'Tick the drafts to scrub';
    scrub.lastChild.textContent = `Scrub selection${drafts.length ? ` (${drafts.length})` : ''}`;
    fin.disabled = !passing.length;
    fin.title = passing.length
      ? `Finalize ${passing.length} claim${passing.length === 1 ? '' : 's'} worth ${usd(passing.reduce((s, c) => s + c.totals.payerShare, 0))}`
      : n ? 'Nothing selected passes its scrub yet' : 'Tick the claims to finalize';
    fin.lastChild.textContent = `Finalize all passing${passing.length ? ` (${passing.length})` : ''}`;
  }

  // --- events ---------------------------------------------------------------

  search.addEventListener('input', () => {
    state.q = search.value;
    state.page = 0;
    draw();
  });

  for (const [el, key] of [
    [payerSel, 'payerId'], [statusSel, 'status'], [scrubSel, 'scrub'], [bandSel, 'band'], [ageSel, 'age'],
    [fromInput, 'from'], [toInput, 'to'],
  ]) {
    el.addEventListener('change', () => {
      state[key] = el.value;
      if (key === 'status' && el.value && !claims.UNSUBMITTED.includes(el.value)) state.view = 'all';
      state.page = 0;
      syncFilters();
      draw();
    });
  }

  mount.addEventListener('change', (e) => {
    const box = e.target.closest('[data-select]');
    if (!box) return;
    if (box.dataset.select === 'all') {
      const scope = box.closest('table');
      for (const row of scope.querySelectorAll('input[data-select]:not([data-select="all"])')) {
        row.checked = box.checked;
        if (box.checked) state.selected.add(row.dataset.select); else state.selected.delete(row.dataset.select);
      }
    } else if (box.checked) state.selected.add(box.dataset.select);
    else state.selected.delete(box.dataset.select);
    drawBulk();
  });

  mount.addEventListener('click', async (e) => {
    if (e.target.closest('a') || e.target.closest('input')) return;
    const kpi = metricKey(e);
    if (kpi) {
      selectKpi(state, kpi);
      state.page = 0;
      syncFilters();
      return draw();
    }
    const scope = e.target.closest('[data-scope]');
    if (scope) {
      state.view = scope.dataset.scope;
      if (state.view === 'assembly' && state.status && !claims.UNSUBMITTED.includes(state.status)) state.status = '';
      state.page = 0;
      syncFilters();
      return draw();
    }
    const group = e.target.closest('[data-group]');
    if (group) {
      state.group = group.dataset.group;
      state.page = 0;
      syncFilters();
      return drawBody();
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
    if (act === 'bulk-scrub') return void bulkScrub([...state.selected]);
    if (act === 'bulk-finalize') return void (await bulkFinalize([...state.selected]));

    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const id = tr.dataset.id;
    if (act === 'history') return void openClaimHistory(id);
    if (act === 'scrub') return void runScrub(id);
    if (act === 'finalize') return void (await askFinalize(id));
    if (act === 'refresh') return void (await askRefresh(id));
    ctx.navigate(`/claima/claims/${claims.get(id).claimNo}`);
  });

  mount.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr && e.target === tr && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      ctx.navigate(`/claima/claims/${claims.get(tr.dataset.id).claimNo}`);
    }
  });

  // A scrub, a finalize, a refresh, a late charge or a recode elsewhere all
  // land here without a reload; switching demo role re-reads the masking and
  // which buttons are the reader's.
  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));
  claims.peersReady.then(() => { if (mount.isConnected) draw(); });

  // A card on a dashboard opens the portfolio pre-filtered:
  // #/claima/claims?status=Ready, ?stale=1, ?view=all&status=Denied.
  applyQuery(ctx.query);
  syncFilters();
  draw();

  function applyQuery(q = {}) {
    if (q.view === 'all' || q.view === 'assembly') state.view = q.view;
    if (claims.STATUSES.includes(q.status)) {
      state.status = q.status;
      if (!claims.UNSUBMITTED.includes(q.status)) state.view = 'all';
    }
    if (q.payerId && payers.get(q.payerId)) state.payerId = q.payerId;
    if (q.stale === '1') state.stale = '1';
    if (['payer', 'status', 'flat'].includes(q.group)) state.group = q.group;
    if (claims.SCRUB_RESULTS.includes(q.scrub) || q.scrub === 'none' || q.scrub === 'voided') state.scrub = q.scrub;
  }
}
