// Unbilled charges at #/claima/charges — every visit still holding capture
// lines nobody has released, and the lines under each. Reads go through
// data/repositories/charges.js; every act on a line is a dialog in
// charge-line-actions.js, the manual entry is manual-charge.js, and the feeds
// run through feed-simulator.js. Nothing here decides anything.
//
// #/claima/charges/health is the capture health screen: this file hands the
// mount over on the deeper path, the way the eligibility worklist hands its
// check and its snapshot over.

import * as charges from '../../../../data/repositories/charges.js';
import * as patients from '../../../../data/repositories/patients.js';
import { DEPARTMENTS } from '../../../../data/seed/reference.js';
import { esc } from '../../../../shared/format.js';
import { metricKey } from '../../../../shared/metric-card.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { toast } from '../../../../shared/toast.js';
import { KPI, blank, railHtml, selectKpi } from './unbilled-kpis.js';
import { groupHtml } from './unbilled-rows.js';
import { openManualCharge } from './manual-charge.js';
import { runFeedsNow } from './feed-simulator.js';
import * as actions from './charge-line-actions.js';
import { openChargeHistory } from './charge-history.js';

export const meta = { title: 'Charges' };

export async function render(mount, ctx) {
  if (ctx.params[0] === 'health') {
    const health = await import('./capture-health.js');
    return health.render(mount, ctx);
  }

  const res = await fetch(new URL('./unbilled-worklist.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load unbilled-worklist.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { ...blank(), open: new Set() };
  const $ = (sel) => mount.querySelector(sel);

  const search = $('#uw-search');
  const departmentSel = $('#uw-department');
  const statusSel = $('#uw-status');
  const flagSel = $('#uw-flag');
  const sourceSel = $('#uw-source');
  const fromInput = $('#uw-from');
  const toInput = $('#uw-to');

  departmentSel.innerHTML = `<option value="">All departments</option>${
    DEPARTMENTS.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}`;
  statusSel.innerHTML = `<option value="">Unreleased and held</option>${
    ['Unreleased', 'Held'].map((s) => `<option value="${s}">${s}</option>`).join('')}`;
  flagSel.innerHTML = `<option value="">Any flag</option>${
    charges.FLAGS.map((f) => `<option value="${f}">${esc(charges.FLAG_LABELS[f])}</option>`).join('')}`;
  sourceSel.innerHTML = `<option value="">All sources</option>${
    charges.SOURCE_TYPES.map((s) => `<option value="${s}">${s}</option>`).join('')}`;

  function syncFilters() {
    search.value = state.q;
    departmentSel.value = state.department;
    statusSel.value = state.status;
    flagSel.value = state.flag;
    sourceSel.value = state.source;
    fromInput.value = state.from;
    toInput.value = state.to;
  }

  function draw() {
    $('#uw-metrics').innerHTML = railHtml(state);
    drawRows();
  }

  function drawRows() {
    const groups = charges.unbilledGrouped(state.q, state);
    const role = currentRole();
    $('#uw-rows').innerHTML = groups.map((group) => groupHtml(group, {
      patient: patients.view(patients.get(group.encounter.patientMrn), role),
      open: state.open.has(group.encounterNo),
      role,
    })).join('');

    const empty = $('#uw-empty');
    empty.hidden = groups.length > 0;
    mount.querySelector('.tbl').hidden = groups.length === 0;
    if (!groups.length) empty.innerHTML = emptyHtml();
  }

  function emptyHtml() {
    const filtered = state.q || state.department || state.status || state.flag || state.source || state.from || state.to;
    if (!filtered) {
      return `
        <div class="state-view">
          <div class="state-view__glyph"><span class="icon">check_circle</span></div>
          <div class="state-view__title">Everything is released</div>
          <p class="state-view__body">No visit is holding an unreleased charge. Lines land here as the feeds
            deliver them and as charges are entered by hand.</p>
          <div class="state-view__actions">
            <button class="btn btn--secondary" data-act="run-feeds">Run feeds now</button>
            <button class="btn btn--primary" data-act="manual">Manual charge</button>
          </div>
        </div>`;
    }
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">search_off</span></div>
        <div class="state-view__title">No charges found</div>
        <p class="state-view__body">No unreleased line matches. Change the search text or clear the filters to see
          every visit waiting.</p>
        <div class="state-view__actions">
          <button class="btn btn--secondary" data-act="clear">Clear filters</button>
        </div>
      </div>`;
  }

  // --- events ---------------------------------------------------------------

  search.addEventListener('input', () => {
    state.q = search.value;
    draw();
  });

  for (const [el, key] of [
    [departmentSel, 'department'], [statusSel, 'status'], [flagSel, 'flag'], [sourceSel, 'source'],
    [fromInput, 'from'], [toInput, 'to'],
  ]) {
    el.addEventListener('change', () => {
      state[key] = el.value;
      draw();
    });
  }

  mount.addEventListener('click', async (e) => {
    const kpi = metricKey(e);
    if (kpi) {
      selectKpi(state, kpi);
      syncFilters();
      return draw();
    }

    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;

    if (act === 'clear') {
      Object.assign(state, KPI.all);
      syncFilters();
      return draw();
    }
    if (act === 'manual') return openManualCharge({}, { onDone: draw });
    if (act === 'run-feeds') return runFeedsNow();

    const no = e.target.closest('tr[data-no]')?.dataset.no;
    if (act === 'expand' && no) {
      if (state.open.has(no)) state.open.delete(no);
      else state.open.add(no);
      return drawRows();
    }
    if (act === 'release-encounter' && no) return actions.releaseEncounter(no);

    const id = e.target.closest('tr[data-id]')?.dataset.id;
    const line = id ? charges.get(id) : null;
    if (!line) return;
    if (act === 'edit') return actions.askEdit(line);
    if (act === 'replace') return actions.askReplace(line);
    if (act === 'cancel') return actions.askCancel(line);
    if (act === 'hold') return actions.askHold(line);
    if (act === 'unhold') return actions.liftHold(line);
    if (act === 'approve-late') return actions.askApproveLate(line);
    if (act === 'release-line') return actions.releaseLine(line);
    if (act === 'history') return openChargeHistory(line.id);
    return undefined;
  });

  // A capture, a hold, a release, a feed run — every one commits, and the
  // groups and the rail redraw off it.
  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));

  // #/claima/charges?status=Held&flag=Late&encounter=ENC-… — a card on a
  // dashboard or a link from the health screen opens the list pre-filtered,
  // with the named visit expanded.
  applyQuery(ctx.query);
  syncFilters();
  draw();
  if (ctx.query.encounter && !charges.unbilledGrouped(state.q, state).some((g) => g.encounterNo === ctx.query.encounter)) {
    toast(`${ctx.query.encounter} has no unreleased charges`, 'warning');
  }

  function applyQuery(q = {}) {
    if (['Unreleased', 'Held'].includes(q.status)) state.status = q.status;
    if (charges.FLAGS.includes(q.flag)) state.flag = q.flag;
    if (charges.SOURCE_TYPES.includes(q.source)) state.source = q.source;
    if (DEPARTMENTS.includes(q.department)) state.department = q.department;
    if (q.encounter) {
      state.q = q.encounter;
      state.open.add(q.encounter);
    }
  }
}
