// Aging at #/claima/aging — the board's claims as a table of status × days in
// status, count and value in every cell, the 60+ column painted. A cell opens
// the board narrowed to that column and that band, and the footer says whether
// the table's grand total is the board's — both read the same engine over the
// same filters, and the line asserts it rather than assuming it.

import * as lifecycle from '../../../../data/engines/claim-events.js';
import * as payers from '../../../../data/repositories/payers.js';
import { esc, usd } from '../../../../shared/format.js';

export const meta = { title: 'Aging' };

export async function render(mount, ctx) {
  const state = { payerId: '' };

  mount.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <span>Aging</span>
        <span class="badge" id="ag-total" title="Every claim on the board and its payer share"></span>
        <span class="spacer"></span>
        <label class="field">
          <span class="icon icon--sm">apartment</span>
          <select id="ag-payer" aria-label="Payer"></select>
        </label>
        <a class="btn btn--secondary btn--sm" href="#/claima/pipeline" title="The same claims as columns">
          <span class="icon icon--sm">view_kanban</span>Pipeline
        </a>
      </div>
      <div class="panel-body">
        <p class="t-body-sm">Days in the current status, bucketed. A cell opens the pipeline board narrowed to that
          status and that band; the 60+ column on an open status is what is worth a call today.</p>
        <div id="ag-table"></div>
        <div id="ag-check"></div>
      </div>
    </div>`;
  const $ = (sel) => mount.querySelector(sel);
  $('#ag-payer').innerHTML = `<option value="">Any payer</option>${
    payers.all().map((p) => `<option value="${esc(p.id)}">${esc(p.nameEn)}</option>`).join('')}`;

  function draw() {
    const filters = { payerId: state.payerId };
    const aging = lifecycle.aging(filters);
    const board = lifecycle.board(filters);
    $('#ag-total').textContent = `${aging.grand.count} · ${usd(aging.grand.value)}`;
    $('#ag-table').innerHTML = tableHtml(aging, state);
    $('#ag-check').innerHTML = checkHtml(aging, board);
  }

  $('#ag-payer').addEventListener('change', (e) => { state.payerId = e.target.value; draw(); });

  mount.addEventListener('click', (e) => {
    const cell = e.target.closest('[data-status]');
    if (!cell || e.target.closest('a')) return;
    const q = new URLSearchParams();
    if (cell.dataset.status !== '*') q.set('status', cell.dataset.status);
    if (cell.dataset.bucket && cell.dataset.bucket !== '*') q.set('bucket', cell.dataset.bucket);
    if (state.payerId) q.set('payerId', state.payerId);
    const query = q.toString();
    ctx.navigate(`/claima/pipeline${query ? `?${query}` : ''}`);
  });
  mount.addEventListener('keydown', (e) => {
    const cell = e.target.closest('[data-status]');
    if (cell && e.target === cell && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      cell.click();
    }
  });

  ctx.onData(draw);
  lifecycle.peersReady.then(() => { if (mount.isConnected) draw(); });
  if (ctx.query?.payerId && payers.get(ctx.query.payerId)) {
    state.payerId = ctx.query.payerId;
    $('#ag-payer').value = state.payerId;
  }
  draw();
}

function tableHtml(aging, state) {
  const head = aging.buckets.map((b) => `<th scope="col"${b.id === 'b4' ? ' title="More than sixty days in one status"' : ''}>${esc(b.label)} d</th>`).join('');
  const rows = aging.rows.map((row) => `
    <tr>
      <th scope="row">${esc(row.status)}</th>
      ${row.cells.map((cell) => cellHtml(row.status, cell)).join('')}
      ${totalCell(`${row.status}`, '*', row.count, row.value, `Every ${row.status} claim`)}
    </tr>`).join('');
  const foot = aging.totals.map((t) => totalCell('*', t.bucket.id, t.count, t.value, `Every claim ${t.bucket.label} days in its status`)).join('');
  return `
    <table class="tbl">
      <thead>
        <tr><th scope="col">Status</th>${head}<th scope="col">Total</th></tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <th scope="row">Total</th>
          ${foot}
          ${totalCell('*', '*', aging.grand.count, aging.grand.value, `Every claim on the board${state.payerId ? ' for this payer' : ''}`)}
        </tr>
      </tfoot>
    </table>`;
}

/**
 * A cell is a control when it holds something; an empty one is a dash. The
 * 60+ column is painted on a status somebody is still waiting on — a claim
 * paid in March has sat in Paid for months, and that is age, not delay.
 */
function cellHtml(status, cell) {
  if (!cell.count) return '<td><span class="t-body-sm">—</span></td>';
  const old = cell.bucket.id === 'b4' && !lifecycle.SETTLED.includes(status);
  return `
    <td>
      <button class="btn btn--${old ? 'tint' : 'ghost'} btn--sm" data-status="${esc(status)}" data-bucket="${cell.bucket.id}"
              title="Open the board on ${esc(status)} claims ${esc(cell.bucket.label)} days in status">
        ${old ? '<span class="icon icon--sm">warning</span>' : ''}${cell.count}
        <span class="t-mono-sm">${esc(usd(cell.value))}</span>
      </button>
    </td>`;
}

function totalCell(status, bucket, count, value, title) {
  if (!count) return '<td><span class="t-body-sm">—</span></td>';
  return `
    <td>
      <button class="btn btn--ghost btn--sm" data-status="${esc(status)}" data-bucket="${bucket}" title="${esc(title)}">
        <strong>${count}</strong> <span class="t-mono-sm">${esc(usd(value))}</span>
      </button>
    </td>`;
}

/** The reconciliation the amendment asks for, asserted on every draw. */
function checkHtml(aging, board) {
  const same = aging.grand.count === board.total.count && Math.abs(aging.grand.value - board.total.value) < 0.01;
  const columns = aging.rows.every((row) => {
    const col = board.columns.find((c) => c.status === row.status);
    return col && col.count === row.count && Math.abs(col.value - row.value) < 0.01;
  });
  if (same && columns) {
    return `<p class="t-body-sm"><span class="icon icon--sm">check_circle</span> Reconciles with the pipeline board:
      ${board.total.count} claims, ${esc(usd(board.total.value))}, every column equal.</p>`;
  }
  return `
    <div class="alert alert--critical">
      <span class="icon">error</span>
      <div><div class="title">Does not reconcile with the board</div>
        Aging counts ${aging.grand.count} claims (${esc(usd(aging.grand.value))}); the board ${board.total.count} (${esc(usd(board.total.value))}).</div>
    </div>`;
}
