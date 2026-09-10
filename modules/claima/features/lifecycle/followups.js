// Follow-up queue at #/claima/followups — every Submitted or Acknowledged
// claim the payer has been silent on past its threshold, longest silence
// first, with the last call made and the next one due. Log follow-up on a row
// or on a same-payer selection; a row leaves the queue on its own the moment
// the payer speaks, because the queue is computed and never stored.

import * as lifecycle from '../../../../data/engines/claim-events.js';
import * as followups from '../../../../data/repositories/followups.js';
import * as claims from '../../../../data/repositories/claims.js';
import * as payers from '../../../../data/repositories/payers.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { compareDates, date, esc, todayIso, usd } from '../../../../shared/format.js';
import { metricKey } from '../../../../shared/metric-card.js';
import { KPI, blank, railHtml, selectKpi } from './followup-kpis.js';
import {
  coverLabel, escalatedFlag, isWithheld, kindChip, patientHtml, silentChip, statusHtml, withheldCell,
} from './lifecycle-chips.js';
import { openLogDialog } from './followup-dialog.js';

export const meta = { title: 'Follow-ups' };

const PAGE_SIZE = 20;

export async function render(mount, ctx) {
  const res = await fetch(new URL('./followups.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load followups.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { ...blank(), page: 0, selected: new Set() };
  const $ = (sel) => mount.querySelector(sel);
  const search = $('#fq-search');
  const payerSel = $('#fq-payer');
  payerSel.innerHTML = `<option value="">Any payer</option>${
    payers.all().map((p) => `<option value="${esc(p.id)}">${esc(p.nameEn)}</option>`).join('')}`;

  function syncFilters() {
    search.value = state.q;
    payerSel.value = state.payerId;
  }

  /** The queue, narrowed by the pressed card and the search text. */
  function found() {
    const needle = state.q.trim();
    const due = new Set(followups.dueOn());
    // The repository's own text match, run once — it reads names the row does not carry.
    const hits = needle ? new Set(claims.search(needle, { payerId: state.payerId }).map((c) => c.id)) : null;
    return lifecycle.silent(state.payerId)
      .filter((a) => (state.slice === 'escalated' ? a.escalated : state.slice === 'due' ? due.has(a.claim.claimNo) : true))
      .filter((a) => !hits || hits.has(a.claim.id));
  }

  function draw() {
    $('#fq-metrics').innerHTML = railHtml(state);
    drawBody();
    drawBulk();
  }

  function drawBody() {
    const role = currentRole();
    const rows = found();
    const body = $('#fq-body');
    for (const no of [...state.selected]) if (!rows.some((a) => a.claim.claimNo === no)) state.selected.delete(no);
    if (!rows.length) return void (body.innerHTML = emptyHtml(state));
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    const start = state.page * PAGE_SIZE;
    const page = rows.slice(start, start + PAGE_SIZE);
    body.innerHTML = `
      ${tableHtml(page, role, state)}
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

  /** Bulk log needs a selection with one payer — the button says which it has. */
  function drawBulk() {
    const btn = $('#fq-bulk');
    const picked = [...state.selected].map((no) => claims.get(no)).filter(Boolean);
    const payerIds = new Set(picked.map((c) => c.payerId));
    btn.disabled = !picked.length || payerIds.size > 1;
    btn.title = !picked.length ? 'Tick the claims to log one call against'
      : payerIds.size > 1 ? `The selection spans ${payerIds.size} payers — a call is made to one desk`
        : `Log one call against ${picked.length} claim${picked.length === 1 ? '' : 's'} with ${payers.get([...payerIds][0])?.nameEn || 'the payer'}`;
    btn.lastChild.textContent = `Log follow-up for selection${picked.length ? ` (${picked.length})` : ''}`;
  }

  // --- events -----------------------------------------------------------------

  search.addEventListener('input', () => { state.q = search.value; state.page = 0; draw(); });
  payerSel.addEventListener('change', () => { state.payerId = payerSel.value; state.page = 0; draw(); });

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
    if (act === 'bulk-log') return void (await openLogDialog([...state.selected]));
    const tr = e.target.closest('tr[data-no]');
    if (!tr) return;
    if (act === 'log') return void (await openLogDialog([tr.dataset.no]));
    ctx.navigate(`/claima/timeline/${tr.dataset.no}`);
  });

  mount.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-no]');
    if (tr && e.target === tr && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      ctx.navigate(`/claima/timeline/${tr.dataset.no}`);
    }
  });

  // A follow-up logged here, or a remittance posted elsewhere, redraws the
  // queue without a reload; a change of demo role re-reads the masking.
  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));
  lifecycle.peersReady.then(() => { if (mount.isConnected) draw(); });

  if (ctx.query?.payerId && payers.get(ctx.query.payerId)) state.payerId = ctx.query.payerId;
  if (['escalated', 'due'].includes(ctx.query?.slice)) state.slice = ctx.query.slice;
  syncFilters();
  draw();
}

function tableHtml(rows, role, state) {
  const allSelected = rows.length > 0 && rows.every((a) => state.selected.has(a.claim.claimNo));
  return `
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col"><input type="checkbox" data-select="all" aria-label="Select every row"${allSelected ? ' checked' : ''}></th>
          <th scope="col">Claim no.</th>
          <th scope="col">Patient</th>
          <th scope="col">Payer / plan</th>
          <th scope="col">Status</th>
          <th scope="col">Value</th>
          <th scope="col" title="Days since the payer last spoke — since submission when it never has">Silent</th>
          <th scope="col">Last follow-up</th>
          <th scope="col">Next due</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>${rows.map((a) => rowHtml(a, role, state)).join('')}</tbody>
    </table>`;
}

function rowHtml(a, role, state) {
  const { claim } = a;
  const masked = isWithheld(claim, role);
  const last = followups.latest(claim.claimNo);
  const due = followups.nextDue(claim.claimNo);
  const dueTone = due ? (compareDates(due, todayIso()) < 0 ? 'critical' : compareDates(due, todayIso()) === 0 ? 'warning' : '') : '';
  return `
    <tr data-no="${esc(claim.claimNo)}" tabindex="0" title="Open the timeline of ${esc(claim.claimNo)}">
      <td><input type="checkbox" data-select="${esc(claim.claimNo)}" aria-label="Select ${esc(claim.claimNo)}"${
        state.selected.has(claim.claimNo) ? ' checked' : ''}></td>
      <td><a class="crumb-link t-mono-sm" href="#/claima/claims/${esc(claim.claimNo)}" title="Open the claim">${esc(claim.claimNo)}</a> ${kindChip(claim)} ${escalatedFlag(a)}</td>
      <td>${masked ? withheldCell() : patientHtml(claim, role)}</td>
      <td>${masked ? withheldCell() : esc(coverLabel(claim))}</td>
      <td>${statusHtml(claim)}</td>
      <td>${masked ? withheldCell() : `<span class="t-mono-sm">${esc(usd(claim.totals?.payerShare))}</span>`}</td>
      <td>${silentChip(a)}</td>
      <td>${last ? `${date(last.at)}<br><span class="t-body-sm" title="${esc(last.note)}">${esc(last.method)} · ${esc(last.contact || last.by)}</span>` : '<span class="t-body-sm">Never</span>'}</td>
      <td>${due ? `<span class="badge${dueTone ? ` badge--${dueTone}` : ''}" title="${dueTone === 'critical' ? 'Overdue' : dueTone === 'warning' ? 'Due today' : 'Booked'}">${date(due)}</span>`
        : '<span class="t-body-sm">Not booked</span>'}</td>
      <td>
        <button class="btn btn--secondary btn--sm" data-act="log" title="Log a call about this claim">
          <span class="icon icon--sm">call</span>Log follow-up
        </button>
      </td>
    </tr>`;
}

function emptyHtml(state) {
  const filtered = state.q || state.payerId || state.slice;
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">${filtered ? 'search_off' : 'task_alt'}</span></div>
      <div class="state-view__title">${filtered ? 'Nothing matches' : 'Nothing is silent'}</div>
      <p class="state-view__body">${filtered
        ? 'No silent claim matches. Clear the filters to see the whole queue.'
        : 'Every claim with a payer has been answered inside its threshold. A claim joins this queue on its own the day the payer’s silence passes it.'}</p>
      ${filtered ? '<div class="state-view__actions"><button class="btn btn--secondary" data-act="clear">Clear filters</button></div>' : ''}
    </div>`;
}
