// Denials worklist at #/claima/denials — every denial on file, untriaged
// first then by amount, with the rail's five slices, the search and the
// nine filters, bulk triage over a same-reason selection and assign on each
// row. Reads go through data/repositories/denials.js and nowhere else.
//
// This feature also owns the deeper links and hands the mount over on them:
// /analytics is the analytics screen, anything else a denial id.

import * as denials from '../../../../data/repositories/denials.js';
import * as payers from '../../../../data/repositories/payers.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { esc } from '../../../../shared/format.js';
import { metricKey } from '../../../../shared/metric-card.js';
import { KPI, applySlice, blank, railHtml, selectKpi } from './denial-kpis.js';
import { emptyHtml, pagerHtml, tableHtml } from './worklist-rows.js';
import { openAssignDialog, openBulkTriageDialog } from './denial-actions.js';

export const meta = { title: 'Denials' };

const PAGE_SIZE = 15;

export async function render(mount, ctx) {
  if (ctx.params[0] === 'analytics') return (await import('./denial-analytics.js')).render(mount, ctx);
  if (ctx.params[0]) return (await import('./denial-view.js')).render(mount, ctx);

  const res = await fetch(new URL('./denials-worklist.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load denials-worklist.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { ...blank(), page: 0, selected: new Set() };
  const $ = (sel) => mount.querySelector(sel);
  const opts = denials.filterOptions();
  const fields = {
    q: $('#dn-search'), payerId: $('#dn-payer'), status: $('#dn-status'), class: $('#dn-class'), code: $('#dn-code'),
    rootCauseId: $('#dn-cause'), route: $('#dn-route'), band: $('#dn-band'), from: $('#dn-from'), to: $('#dn-to'),
    deadline: $('#dn-deadline'), assignee: $('#dn-assignee'),
  };
  fields.payerId.innerHTML = `<option value="">Any payer</option>${
    payers.all().map((p) => `<option value="${esc(p.id)}">${esc(p.nameEn)}</option>`).join('')}`;
  fields.status.innerHTML = `<option value="">All statuses</option>${opts.statuses.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}`;
  fields.class.innerHTML = `<option value="">Any class</option>${opts.classes.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}`;
  fields.code.innerHTML = `<option value="">Any payer reason</option>${opts.codes.map((c) => `<option value="${esc(c.code)}">${esc(c.code)} · ${esc(c.label)}</option>`).join('')}`;
  fields.rootCauseId.innerHTML = `<option value="">Any root cause</option>${opts.rootCauses.map((g) => `
    <optgroup label="${esc(g.group)}">${g.causes.map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join('')}</optgroup>`).join('')}`;
  fields.route.innerHTML = `<option value="">Any route</option>${opts.routes.map((r) => `<option value="${r.kind}">${esc(r.label)}</option>`).join('')}`;
  fields.band.innerHTML = `<option value="">Any amount</option>${opts.bands.map((b) => `<option value="${b.key}">${esc(b.label)}</option>`).join('')}`;

  function syncFilters() {
    for (const [key, el] of Object.entries(fields)) el.value = state[key] || '';
  }

  const found = () => applySlice(denials.search(state.q, state), state.slice);

  function draw() {
    $('#dn-metrics').innerHTML = railHtml(state);
    drawBody();
    drawBulk();
  }

  function drawBody() {
    const role = currentRole();
    const rows = found();
    const body = $('#dn-body');
    for (const id of [...state.selected]) if (!rows.some((d) => d.id === id)) state.selected.delete(id);
    const filtered = Object.keys(KPI.all).some((k) => state[k] !== KPI.all[k]);
    if (!rows.length) return void (body.innerHTML = emptyHtml(filtered));
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    const start = state.page * PAGE_SIZE;
    const page = rows.slice(start, start + PAGE_SIZE);
    body.innerHTML = tableHtml(page, role, state) + pagerHtml(start, page.length, rows.length, state.page, pages);
  }

  /** Bulk triage needs a selection with one payer reason — the button says which it has. */
  function drawBulk() {
    const picked = [...state.selected].map((id) => denials.get(id)).filter((d) => d && denials.isOpen(d));
    const codes = new Set(picked.map((d) => d.payerReason?.code || d.code));
    const triage = $('#dn-bulk-triage');
    triage.disabled = !picked.length || codes.size > 1;
    triage.title = !picked.length ? 'Tick the open denials to triage together'
      : codes.size > 1 ? `The selection spans ${codes.size} payer reasons — a triage reads one` : `Triage ${picked.length} denial${picked.length === 1 ? '' : 's'} denied ${[...codes][0]}`;
    triage.lastChild.textContent = `Triage selection${picked.length ? ` (${picked.length})` : ''}`;
    const assign = $('#dn-bulk-assign');
    assign.disabled = !picked.length;
    assign.title = picked.length ? `Assign ${picked.length} denial${picked.length === 1 ? '' : 's'}` : 'Tick the open denials to assign';
  }

  // --- events -----------------------------------------------------------------

  for (const [key, el] of Object.entries(fields)) {
    el.addEventListener(key === 'q' ? 'input' : 'change', () => {
      state[key] = el.value;
      if (key === 'status' && el.value) { state.slice = ''; state.open = false; state.resolvedFrom = ''; }
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
    if (act === 'bulk-triage') return void (await openBulkTriageDialog([...state.selected]));
    if (act === 'bulk-assign') {
      for (const id of state.selected) denials.assign(id, 'me');
      return undefined;
    }
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return undefined;
    if (act === 'assign') return void (await openAssignDialog([tr.dataset.id]));
    return ctx.navigate(`/claima/denials/${tr.dataset.id}`);
  });

  mount.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr && e.target === tr && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      ctx.navigate(`/claima/denials/${tr.dataset.id}`);
    }
  });

  // A triage here, a remittance posted elsewhere or a hand-off marked
  // recovered on Pactum's performance screen all redraw the list without a
  // reload; a change of demo role re-reads the masking and the Mine filter.
  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));
  denials.peersReady.then(() => { if (mount.isConnected) draw(); });

  // Deep links: ?status=, ?payerId=, ?deadline=, ?rootCauseId=, ?route=, ?assignee=me.
  for (const key of ['status', 'payerId', 'deadline', 'rootCauseId', 'route', 'assignee', 'class', 'code']) {
    if (ctx.query?.[key]) state[key] = ctx.query[key];
  }
  if (ctx.query?.slice && KPI[ctx.query.slice]) selectKpi(state, ctx.query.slice);
  syncFilters();
  draw();
}
