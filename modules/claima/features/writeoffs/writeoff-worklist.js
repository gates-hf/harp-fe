// Write-off worklist at #/claima/writeoffs — every request, newest first,
// with the rail's cards selecting the slices they count and "Pending my
// approval" turning the table into the signer's queue, oldest first. The
// deeper paths hand the mount over: /new is the request screen, /analytics
// the breakdown, anything else a request's decision page.

import * as writeoffs from '../../../../data/repositories/writeoffs.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { dateTime, esc } from '../../../../shared/format.js';
import { metricKey } from '../../../../shared/metric-card.js';
import { KPI, blank, railHtml, selectKpi } from './writeoff-kpis.js';
import {
  amountHtml, approverHtml, isWithheld, patientHtml, reasonHtml, sideHtml, sourceHtml, statusHtml, tierHtml, withheldCell,
} from './writeoff-chips.js';

export const meta = { title: 'Write-offs' };

const PAGE_SIZE = 20;

export async function render(mount, ctx) {
  if (ctx.params[0] === 'new') return (await import('./writeoff-request.js')).render(mount, ctx);
  if (ctx.params[0] === 'analytics') return (await import('./writeoff-analytics.js')).render(mount, ctx);
  if (ctx.params[0]) return (await import('./writeoff-view.js')).render(mount, ctx);

  const res = await fetch(new URL('./writeoff-worklist.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load writeoff-worklist.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { ...blank(), page: 0 };
  const $ = (sel) => mount.querySelector(sel);
  const fields = {
    q: $('#wo-search'), status: $('#wo-status'), source: $('#wo-source'), reasonCode: $('#wo-reason'),
    classification: $('#wo-class'), band: $('#wo-band'), side: $('#wo-side'), from: $('#wo-from'), to: $('#wo-to'),
  };
  const options = (list, any) => `<option value="">${any}</option>${list.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}`;
  fields.status.innerHTML = options(writeoffs.STATUSES.map((s) => [s, s]), 'Any status');
  fields.source.innerHTML = options(writeoffs.SOURCE_KINDS.map((k) => [k, writeoffs.SOURCE_LABELS[k]]), 'Any source');
  fields.reasonCode.innerHTML = options(writeoffs.WRITEOFF_REASONS.map((r) => [r.code, `${r.code} ${r.label}`]), 'Any reason');
  fields.classification.innerHTML = options(writeoffs.CLASSIFICATIONS.map((c) => [c, c]), 'Any classification');
  fields.band.innerHTML = options([...writeoffs.AMOUNT_BANDS, null].map((_, i) => [String(i), writeoffs.bandLabel(i)]), 'Any amount');
  fields.side.innerHTML = options(writeoffs.SIDES.map((s) => [s, s]), 'Either side');

  function syncFilters() {
    for (const [key, el] of Object.entries(fields)) el.value = state[key];
    for (const btn of mount.querySelectorAll('[data-scope]')) btn.setAttribute('aria-pressed', String((btn.dataset.scope === 'mine') === state.mine));
  }

  function found() {
    return writeoffs.search(state.q, state);
  }

  function draw() {
    $('#wo-metrics').innerHTML = railHtml(state);
    const role = currentRole();
    const mine = writeoffs.pendingFor(role).length;
    const btn = $('#wo-mine');
    btn.textContent = `Pending my approval${mine ? ` (${mine})` : ''}`;
    btn.title = mine ? `${mine} request${mine === 1 ? '' : 's'} at a tier ${role.name} signs, raised by somebody else`
      : `Nothing is waiting on ${role.name} — a request at a tier your role signs, raised by somebody else, would be here`;
    drawBody();
  }

  function drawBody() {
    const role = currentRole();
    const rows = found();
    const body = $('#wo-body');
    if (!rows.length) return void (body.innerHTML = emptyHtml(state));
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    const start = state.page * PAGE_SIZE;
    const page = rows.slice(start, start + PAGE_SIZE);
    body.innerHTML = `
      ${tableHtml(page, role)}
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

  // --- events -----------------------------------------------------------------

  fields.q.addEventListener('input', () => { state.q = fields.q.value; state.page = 0; draw(); });
  for (const [key, el] of Object.entries(fields)) {
    if (key === 'q') continue;
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
    const scope = e.target.closest('[data-scope]');
    if (scope) {
      state.mine = scope.dataset.scope === 'mine';
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
      Object.assign(state, blank(), { page: 0 });
      syncFilters();
      return draw();
    }
    const tr = e.target.closest('tr[data-id]');
    if (tr) ctx.navigate(`/claima/writeoffs/${tr.dataset.id}`);
  });

  mount.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr && e.target === tr && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      ctx.navigate(`/claima/writeoffs/${tr.dataset.id}`);
    }
  });

  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));
  writeoffs.peersReady.then(() => { if (mount.isConnected) draw(); });

  // Deep links: a card or a dashboard names the slice.
  const q = ctx.query || {};
  if (q.status && writeoffs.STATUSES.includes(q.status)) state.status = q.status;
  if (q.source && writeoffs.SOURCE_KINDS.includes(q.source)) state.source = q.source;
  if (q.classification && writeoffs.CLASSIFICATIONS.includes(q.classification)) state.classification = q.classification;
  if (q.view === 'mine') state.mine = true;
  if (q.kpi && KPI[q.kpi]) selectKpi(state, q.kpi);
  syncFilters();
  draw();
}

function tableHtml(rows, role) {
  return `
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">Request</th>
          <th scope="col">Source</th>
          <th scope="col">Patient</th>
          <th scope="col">Side</th>
          <th scope="col">Amount</th>
          <th scope="col">Reason</th>
          <th scope="col">Status</th>
          <th scope="col">Requester</th>
          <th scope="col" title="The tier a signature is waiting at, or the tier the request needed">Tier</th>
          <th scope="col">Approver</th>
        </tr>
      </thead>
      <tbody>${rows.map((w) => rowHtml(w, role)).join('')}</tbody>
    </table>`;
}

function rowHtml(w, role) {
  const masked = isWithheld(w, role);
  return `
    <tr data-id="${esc(w.id)}" tabindex="0" title="Open ${esc(w.id)}">
      <td><span class="t-mono-sm">${esc(w.id)}</span><br><span class="t-body-sm">${dateTime(w.at)}</span></td>
      <td>${masked ? `<span class="badge">${esc(writeoffs.SOURCE_LABELS[w.source.kind] || w.source.kind)}</span> ${withheldCell()}` : sourceHtml(w)}</td>
      <td>${masked ? withheldCell() : patientHtml(w, role)}</td>
      <td>${sideHtml(w.side)}</td>
      <td>${masked ? withheldCell() : amountHtml(w)}</td>
      <td>${reasonHtml(w)}</td>
      <td>${statusHtml(w)}</td>
      <td>${esc(w.requestedBy)}</td>
      <td>${tierHtml(w)}</td>
      <td>${approverHtml(w)}</td>
    </tr>`;
}

function emptyHtml(state) {
  const filtered = state.q || state.status || state.source || state.reasonCode || state.classification || state.band !== '' || state.side || state.from || state.to;
  if (state.mine) {
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">task_alt</span></div>
        <div class="state-view__title">Nothing waits on you</div>
        <p class="state-view__body">A request appears here when it is at a tier your role signs and somebody else raised it. Switch to All to read the whole register.</p>
      </div>`;
  }
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">${filtered ? 'search_off' : 'money_off'}</span></div>
      <div class="state-view__title">${filtered ? 'Nothing matches' : 'No write-offs yet'}</div>
      <p class="state-view__body">${filtered
        ? 'No request matches these filters. Clear them to see the whole register.'
        : 'Raise the first request from a denial, a claim residual, an aged claim or a patient balance.'}</p>
      <div class="state-view__actions">${filtered
        ? '<button class="btn btn--secondary" data-act="clear">Clear filters</button>'
        : '<a class="btn btn--primary" href="#/claima/writeoffs/new">New request</a>'}</div>
    </div>`;
}
