// The eligibility worklist at #/frontis/eligibility — every check the platform
// has run, newest first. Reads go through data/repositories/eligibility.js and
// nowhere else.
//
// This feature also owns the deeper links and hands the mount over on each:
// /new is the check screen and anything else is a reference, which opens the
// snapshot page.

import * as eligibility from '../../../../data/repositories/eligibility.js';
import * as payers from '../../../../data/repositories/payers.js';
import * as patients from '../../../../data/repositories/patients.js';
import { dateTime, esc } from '../../../../shared/format.js';
import { metricKey } from '../../../../shared/metric-card.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { resultBadge } from './eligibility-panel.js';
import { blank, railHtml, selectKpi } from './eligibility-kpis.js';

export const meta = { title: 'Eligibility' };

const PAGE_SIZE = 12;

export async function render(mount, ctx) {
  const [first] = ctx.params;
  if (first === 'new') return (await import('./eligibility-check.js')).render(mount, ctx);
  if (first) return (await import('./eligibility-result.js')).render(mount, ctx);

  const res = await fetch(new URL('./eligibility-worklist.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load eligibility-worklist.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { ...blank(), page: 0 };
  const $ = (sel) => mount.querySelector(sel);

  const search = $('#ew-search');
  const resultSel = $('#ew-result');
  const payerSel = $('#ew-payer');
  const fromInput = $('#ew-from');
  const toInput = $('#ew-to');

  resultSel.innerHTML = `<option value="">All results</option>${
    eligibility.RESULTS.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}`;
  payerSel.innerHTML = `<option value="">All payers</option>${
    payers.findActive().map((p) => `<option value="${esc(p.id)}">${esc(p.nameEn)}</option>`).join('')}`;

  function syncFilters() {
    search.value = state.q;
    resultSel.value = state.result;
    payerSel.value = state.payerId;
    fromInput.value = state.from;
    toInput.value = state.to;
  }

  function draw() {
    $('#ew-metrics').innerHTML = railHtml(state);
    drawBanner();
    drawRows();
  }

  /** Overridden has no control of its own, so the banner is what names it. */
  function drawBanner() {
    const banner = $('#ew-banner');
    banner.hidden = !state.overridden;
    banner.innerHTML = state.overridden
      ? `<div class="alert alert--info">
           <span class="icon">flag</span>
           <div>Showing checks a supervisor answered beside the system result. The system's own answer is
             on each snapshot, beside the override.</div>
         </div>`
      : '';
  }

  function drawRows() {
    const all = eligibility.list(state);
    const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    const start = state.page * PAGE_SIZE;
    const page = all.slice(start, start + PAGE_SIZE);
    const role = currentRole();

    $('#ew-rows').innerHTML = page.map((row) => rowHtml(row, role)).join('');

    const empty = $('#ew-empty');
    empty.hidden = all.length > 0;
    mount.querySelector('.tbl').hidden = all.length === 0;
    if (!all.length) empty.innerHTML = emptyHtml();

    $('#ew-range').textContent = all.length ? `${start + 1}–${start + page.length} of ${all.length}` : '0 of 0';
    setPager('prev', state.page === 0, 'You are on the first page');
    setPager('next', state.page >= pages - 1, 'You are on the last page');
  }

  function rowHtml(row, role) {
    // The patient reads through view(), so a restricted record is named by its
    // initials here too — the check itself is not what unmasks it.
    const patient = patients.view(patients.get(row.patientMrn), role);
    // A pre-registration check may have run before anyone was registered, so
    // the row names the pre-registration it belongs to instead of an MRN, and
    // the two actions that need a record are withheld.
    const orphan = !row.patientMrn && Boolean(row.preregNo);
    const why = 'This check ran before the patient was registered — open the pre-registration it belongs to';
    return `
      <tr data-ref="${esc(row.ref)}" tabindex="0" title="Open ${esc(row.ref)}">
        <td>${orphan
          ? `<span class="badge">Not registered</span><br>
             <a class="crumb-link t-mono-sm" href="#/frontis/prereg/${esc(row.preregNo)}">${esc(row.preregNo)}</a>`
          : `${esc(patient?.nameEn || row.patientMrn)}<br><span class="t-mono-sm">${esc(row.patientMrn)}</span>`}</td>
        <td>${esc(eligibility.coverLabel(row))}</td>
        <td>${esc(row.checkType)}</td>
        <td>${resultBadge(row)}</td>
        <td class="t-mono-sm">${esc(row.ref)}</td>
        <td>${esc(row.checkedBy)}<br><span class="t-body-sm">${dateTime(row.checkedAt)}</span></td>
        <td>${row.encounterId ? `<a class="crumb-link t-mono-sm" href="#/frontis/encounters/${esc(row.encounterId)}">${esc(row.encounterId)}</a>` : '<span class="t-mono-sm">—</span>'}</td>
        <td>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="view" title="View result">
            <span class="icon icon--sm">visibility</span>
          </button>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="recheck"${orphan ? ' disabled' : ''}
                  title="${esc(orphan ? why : 'Re-check this patient on this cover')}">
            <span class="icon icon--sm">refresh</span>
          </button>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="history"${orphan ? ' disabled' : ''}
                  title="${esc(orphan ? why : 'View this patient’s check history')}">
            <span class="icon icon--sm">history</span>
          </button>
        </td>
      </tr>`;
  }

  function emptyHtml() {
    const filtered = state.q || state.result || state.payerId || state.from || state.to || state.overridden;
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">${filtered ? 'search_off' : 'verified_user'}</span></div>
        <div class="state-view__title">No checks found</div>
        <p class="state-view__body">${
          filtered
            ? 'No checks match. Change the search text or clear the filters to see every check.'
            : 'Nothing has been verified yet. Run the first check to record what the payer covers.'
        }</p>
        <div class="state-view__actions">
          ${filtered ? '<button class="btn btn--secondary" data-act="clear">Clear filters</button>' : ''}
          <a class="btn btn--primary" href="#/frontis/eligibility/new">New check</a>
        </div>
      </div>`;
  }

  function setPager(which, disabled, why) {
    const btn = mount.querySelector(`[data-page="${which}"]`);
    btn.disabled = disabled;
    btn.title = disabled ? why : '';
  }

  /** A card elsewhere opens this list already filtered: eligibility?result=… */
  function applyQuery(q = {}) {
    if (eligibility.RESULTS.includes(q.result)) state.result = q.result;
    if (q.payerId) state.payerId = q.payerId;
    if (q.from) state.from = q.from;
    if (q.to) state.to = q.to;
    if (q.overridden === '1') state.overridden = true;
    syncFilters();
  }

  // --- events ---------------------------------------------------------------

  search.addEventListener('input', () => {
    state.q = search.value;
    state.page = 0;
    draw();
  });

  for (const [el, key] of [[resultSel, 'result'], [payerSel, 'payerId'], [fromInput, 'from'], [toInput, 'to']]) {
    el.addEventListener('change', () => {
      state[key] = el.value;
      state.page = 0;
      draw();
    });
  }

  mount.addEventListener('click', (e) => {
    const pager = e.target.closest('[data-page]');
    if (pager && !pager.disabled) {
      state.page += pager.dataset.page === 'next' ? 1 : -1;
      drawRows();
      return;
    }

    const kpi = metricKey(e);
    if (kpi) {
      selectKpi(state, kpi);
      state.page = 0;
      syncFilters();
      draw();
      return;
    }

    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'clear') {
      Object.assign(state, blank(), { page: 0 });
      syncFilters();
      draw();
      return;
    }

    const tr = e.target.closest('tr[data-ref]');
    if (!tr) return;
    const row = eligibility.get(tr.dataset.ref);
    if (!row) return;
    if (act === 'history') return ctx.navigate(`/frontis/patients/${row.patientMrn}/eligibility`);
    if (act === 'recheck') return ctx.navigate(recheckPath(row));
    ctx.navigate(`/frontis/eligibility/${row.ref}`);
  });

  mount.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-ref]');
    if (tr && e.target === tr && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      ctx.navigate(`/frontis/eligibility/${tr.dataset.ref}`);
    }
  });

  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));

  applyQuery(ctx.query);
  draw();
}

/** Re-check opens the check screen on the same patient and the same cover. */
export const recheckPath = (row) =>
  `/frontis/eligibility/new?mrn=${row.patientMrn}&policyId=${row.policyId || 'SELF_PAY'}&type=Re-check`;
