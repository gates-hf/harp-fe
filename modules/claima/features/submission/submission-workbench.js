// Submission workbench at #/claima/submission — the ready queue by payer and
// the batches, with the rail over both. Reads go through
// data/repositories/batches.js and nowhere else.
//
// This feature also owns the deeper links and hands the mount over on them:
// /rejections is the rejections worklist, and a batch number opens the batch
// page, with a tab id after it.

import * as batches from '../../../../data/repositories/batches.js';
import * as payers from '../../../../data/repositories/payers.js';
import { esc } from '../../../../shared/format.js';
import { metricKey } from '../../../../shared/metric-card.js';
import { KPI, blank, railHtml, selectKpi } from './submission-kpis.js';
import { queueHtml } from './queue-panel.js';
import { batchesTableHtml } from './batches-table.js';
import { askAdd, askCreate, askReject, askSubmit, runGenerate } from './batch-actions.js';
import { askAcknowledge } from './acknowledge-dialog.js';
import { openBatchHistory } from './batch-history.js';

export const meta = { title: 'Submission' };

export async function render(mount, ctx) {
  if (ctx.params[0] === 'rejections') return (await import('./rejections-worklist.js')).render(mount, ctx);
  if (ctx.params[0]) return (await import('./batch-view.js')).render(mount, ctx);

  const res = await fetch(new URL('./submission-workbench.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load submission-workbench.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = blank();
  const $ = (sel) => mount.querySelector(sel);

  const search = $('#sw-search');
  const payerSel = $('#sw-payer');
  const statusSel = $('#sw-status');
  const fromInput = $('#sw-from');
  const toInput = $('#sw-to');

  payerSel.innerHTML = `<option value="">Any payer</option>${
    payers.all().map((p) => `<option value="${esc(p.id)}">${esc(p.nameEn)}</option>`).join('')}`;
  statusSel.innerHTML = `<option value="">All statuses</option><option value="open">Open or Generated</option>${
    batches.STATUSES.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}`;

  function syncFilters() {
    search.value = state.q;
    payerSel.value = state.payerId;
    statusSel.value = state.status;
    fromInput.value = state.from;
    toInput.value = state.to;
  }

  function draw() {
    $('#sw-metrics').innerHTML = railHtml(state);
    drawQueue();
    drawBatches();
  }

  function drawQueue() {
    const rows = batches.readyQueueByPayer().filter((r) => !state.due || r.dueToday);
    const total = rows.reduce((n, r) => n + r.count, 0);
    $('#sw-queue-count').textContent = String(total);
    $('#sw-queue-note').textContent = state.due
      ? `${rows.length} payer${rows.length === 1 ? '' : 's'} due today`
      : rows.length ? `${rows.length} payer${rows.length === 1 ? '' : 's'} with claims waiting` : '';
    $('#sw-queue').innerHTML = queueHtml(rows, state);
  }

  function drawBatches() {
    const rows = batches.search(state.q, state);
    $('#sw-batch-count').textContent = String(rows.length);
    $('#sw-body').innerHTML = batchesTableHtml(rows, state);
  }

  // --- events ---------------------------------------------------------------

  search.addEventListener('input', () => {
    state.q = search.value;
    drawBatches();
  });
  for (const [el, key] of [[payerSel, 'payerId'], [statusSel, 'status'], [fromInput, 'from'], [toInput, 'to']]) {
    el.addEventListener('change', () => {
      state[key] = el.value;
      syncFilters();
      draw();
    });
  }

  mount.addEventListener('click', async (e) => {
    if (e.target.closest('a')) return;
    const kpi = metricKey(e);
    if (kpi === 'ready') {
      const panel = $('#sw-queue-panel');
      panel.focus({ preventScroll: true });
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (kpi) {
      selectKpi(state, kpi);
      syncFilters();
      return draw();
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'clear') {
      Object.assign(state, KPI.all);
      syncFilters();
      return draw();
    }

    const queueRow = e.target.closest('tr[data-payer]');
    if (queueRow) {
      const payerId = queueRow.dataset.payer;
      if (act === 'create') {
        const row = await askCreate(payerId);
        if (row) ctx.navigate(`/claima/submission/${row.batchNo}`);
      } else if (act === 'add') {
        const open = batches.openBatchFor(payerId);
        if (open) await askAdd(open.batchNo);
      }
      return;
    }

    const tr = e.target.closest('tr[data-no]');
    if (!tr) return;
    const no = tr.dataset.no;
    if (act === 'history') return void openBatchHistory(no);
    if (act === 'generate') return void runGenerate(no, { navigate: ctx.navigate });
    if (act === 'submit') return void (await askSubmit(no));
    if (act === 'acknowledge') return void (await askAcknowledge(no));
    if (act === 'rejections') {
      const batch = batches.get(no);
      if (batch?.rejections.length) return ctx.navigate(`/claima/submission/${no}/rejections`);
      return void (await askReject(no));
    }
    ctx.navigate(`/claima/submission/${no}`);
  });

  mount.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-no]');
    if (tr && e.target === tr && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      ctx.navigate(`/claima/submission/${tr.dataset.no}`);
    }
  });

  // A finalize on the portfolio, a rejection recorded on a batch page, a
  // resubmission — all land here without a reload.
  ctx.onData(draw);

  // A card on a dashboard opens the workbench pre-filtered:
  // #/claima/submission?status=open, ?payerId=PY-0001, ?due=1.
  applyQuery(ctx.query);
  syncFilters();
  draw();

  function applyQuery(q = {}) {
    if (q.status === 'open' || batches.STATUSES.includes(q.status)) state.status = q.status;
    if (q.payerId && payers.get(q.payerId)) state.payerId = q.payerId;
    if (q.due === '1') state.due = '1';
  }
}
