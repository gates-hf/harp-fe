// Defensio appeal tracking worklist at #/defensio/appeal-tracking — every
// appeal case submitted to a payer, the response deadline soonest first
// with overdue ones painted, the recovery state beside the outcome, the
// rail's five stats, search and filters, a same-payer bulk follow-up and a
// follow-up on each row. Reads go through data/repositories/appeal-tracking.js.
// A row opens the case's Tracking & outcome tab — the one this feature
// registers in modules/defensio/tabs.js for amendment 38's case view, drawn
// here by its own host (tracking-page.js): anything after /appeal-tracking is
// a case id and the mount is handed over.

import * as tracking from '../../../../data/repositories/appeal-tracking.js';
import * as payers from '../../../../data/repositories/payers.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { esc } from '../../../../shared/format.js';
import { metricKey } from '../../../../shared/metric-card.js';
import { KPI, applySlice, blank, railHtml, selectKpi } from './tracking-kpis.js';
import { emptyHtml, pagerHtml, tableHtml } from './tracking-rows.js';
import { openFollowUpDialog } from './tracking-dialogs.js';

export const meta = { title: 'Appeal tracking' };

const PAGE_SIZE = 15;
const caseHref = (id) => `/defensio/appeal-tracking/${id}`;

export async function render(mount, ctx) {
  if (ctx.params[0]) return (await import('./tracking-page.js')).render(mount, ctx);

  const res = await fetch(new URL('./appeal-tracking.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load appeal-tracking.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { ...blank(), page: 0, selected: new Set() };
  const $ = (sel) => mount.querySelector(sel);
  const fields = {
    q: $('#at-search'), payerId: $('#at-payer'), status: $('#at-status'), outcome: $('#at-outcome'), recoveryState: $('#at-recovery'),
    from: $('#at-from'), to: $('#at-to'),
  };
  fields.payerId.innerHTML = `<option value="">Any payer</option>${payers.all().map((p) => `<option value="${esc(p.id)}">${esc(p.nameEn)}</option>`).join('')}`;
  fields.status.innerHTML = `<option value="">All statuses</option>${['Submitted', ...tracking.F4_STATUSES].map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}`;
  fields.outcome.innerHTML = `<option value="">Any outcome</option>${tracking.OUTCOMES.map((o) => `<option value="${o}">${esc(tracking.outcomeLabel(o))}</option>`).join('')}`;
  fields.recoveryState.innerHTML = `<option value="">Any recovery state</option>${[...tracking.RECOVERY_STATES, 'NothingExpected'].map((s) => `<option value="${s}">${esc(tracking.recoveryStateLabel(s))}</option>`).join('')}`;

  function syncFilters() {
    for (const [key, el] of Object.entries(fields)) el.value = state[key] || '';
  }

  const found = () => applySlice(tracking.search(state.q, state), state.slice);

  function draw() {
    $('#at-metrics').innerHTML = railHtml(state);
    drawBody();
    drawBulk();
  }

  function drawBody() {
    const role = currentRole();
    const rows = found();
    const body = $('#at-body');
    for (const id of [...state.selected]) if (!rows.some((c) => c.id === id)) state.selected.delete(id);
    const filtered = Object.keys(KPI.all).some((k) => state[k] !== KPI.all[k]);
    if (!rows.length) return void (body.innerHTML = emptyHtml(filtered));
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    const start = state.page * PAGE_SIZE;
    const page = rows.slice(start, start + PAGE_SIZE);
    body.innerHTML = tableHtml(page, role, state) + pagerHtml(start, page.length, rows.length, state.page, pages);
  }

  /** A bulk follow-up is one payer's desk being called about several cases — the button says which it has. */
  function drawBulk() {
    const picked = [...state.selected].map((id) => tracking.get(id)).filter((c) => c && tracking.isTracked(c));
    const payerIds = new Set(picked.map((c) => c.payerId));
    const btn = $('#at-bulk-followup');
    btn.disabled = !picked.length || payerIds.size > 1;
    btn.title = !picked.length ? 'Tick the cases to follow up together'
      : payerIds.size > 1 ? `The selection spans ${payerIds.size} payers — one call reaches one desk` : `Log one follow-up on ${picked.length} case${picked.length === 1 ? '' : 's'} with ${payers.get([...payerIds][0])?.nameEn || 'the payer'}`;
    btn.lastChild.textContent = `Follow up selection${picked.length ? ` (${picked.length})` : ''}`;
  }

  // --- events -----------------------------------------------------------------

  for (const [key, el] of Object.entries(fields)) {
    el.addEventListener(key === 'q' ? 'input' : 'change', () => {
      state[key] = el.value;
      if (key === 'status' && el.value) { state.slice = ''; state.overdue = false; state.decidedFrom = ''; }
      state.page = 0;
      draw();
    });
  }

  mount.addEventListener('change', (e) => {
    const box = e.target.closest('[data-select]');
    if (!box) return;
    if (box.dataset.select === 'all') {
      for (const row of mount.querySelectorAll('input[data-select]:not([data-select="all"])')) {
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
    if (act === 'bulk-followup') return void (await openFollowUpDialog([...state.selected]));
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return undefined;
    if (act === 'followup') return void (await openFollowUpDialog([tr.dataset.id]));
    return ctx.navigate(caseHref(tr.dataset.id));
  });

  mount.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr && e.target === tr && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      ctx.navigate(caseHref(tr.dataset.id));
    }
  });

  // A decision captured on the case page, a remittance posted in Claima or a
  // level-2 case opened by the appeal feature all redraw the list; a change of
  // demo role re-reads the masking.
  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));
  tracking.seedReady.then(() => { if (mount.isConnected) draw(); });

  // Deep links: ?payerId=, ?status=, ?outcome=, ?recoveryState=, ?slice=inFlight|overdue|decided|recovered|awaiting.
  for (const key of ['payerId', 'status', 'outcome', 'recoveryState']) if (ctx.query?.[key]) state[key] = ctx.query[key];
  if (ctx.query?.slice && KPI[ctx.query.slice]) selectKpi(state, ctx.query.slice);
  syncFilters();
  draw();
}
