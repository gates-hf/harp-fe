// Rejections worklist at #/claima/submission/rejections — every claim the
// payer sent back and the desk has not yet taken up: the code and reason, the
// cycle, the batch, how long it has waited, and Fix & Resubmit, which shows
// the routed fix and confirms. The rail's cards are the codes' fix routes, so
// a card selects the rows worked the same way.

import * as batches from '../../../../data/repositories/batches.js';
import * as claims from '../../../../data/repositories/claims.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as payers from '../../../../data/repositories/payers.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { date, esc, usd } from '../../../../shared/format.js';
import { metricRailHtml, metricKey, kpiFilter } from '../../../../shared/metric-card.js';
import { FIX_ROUTES } from '../../../../data/seed/rejection-reasons.js';
import { cycleStripHtml, payerName } from './batch-chips.js';
import { askFixAndResubmit } from './fix-dialog.js';

export const meta = { title: 'Rejections' };

const KPI = {
  all: { q: '', payerId: '', code: '', route: '' },
  Policy: { route: 'Policy' },
  Refresh: { route: 'Refresh' },
  Recode: { route: 'Recode' },
  other: { route: 'other' },
};

export async function render(mount, ctx) {
  const res = await fetch(new URL('./rejections-worklist.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load rejections-worklist.html (${res.status})`);
  mount.innerHTML = await res.text();

  ctx.setCrumb([
    { label: 'Claima', path: '/claima/submission' },
    { label: 'Submission', path: '/claima/submission' },
    { label: 'Rejections' },
  ]);

  const state = { ...KPI.all };
  const $ = (sel) => mount.querySelector(sel);
  const search = $('#rw-search');
  const payerSel = $('#rw-payer');
  const codeSel = $('#rw-code');
  const routeSel = $('#rw-route');

  payerSel.innerHTML = `<option value="">Any payer</option>${
    payers.all().map((p) => `<option value="${esc(p.id)}">${esc(p.nameEn)}</option>`).join('')}`;
  codeSel.innerHTML = `<option value="">Any code</option>${
    batches.REJECTION_REASONS.map((r) => `<option value="${esc(r.code)}">${esc(r.code)} — ${esc(r.label)}</option>`).join('')}`;
  routeSel.innerHTML = `<option value="">Any fix</option>${
    FIX_ROUTES.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}<option value="other">Contract or Review</option>`;

  const routeOf = (c) => batches.fixRouteOf(c.rejection?.code);
  const found = () => {
    const needle = state.q.trim().toLowerCase();
    return claims.rejectionsWorklist().filter((c) => {
      if (state.payerId && c.payerId !== state.payerId) return false;
      if (state.code && c.rejection?.code !== state.code) return false;
      if (state.route === 'other' ? !['Contract', 'Review'].includes(routeOf(c)) : state.route && routeOf(c) !== state.route) return false;
      if (!needle) return true;
      const patient = patients.get(c.patientMrn);
      return [c.claimNo, c.patientMrn, patient?.nameEn, c.rejection?.batchNo].some((v) => String(v || '').toLowerCase().includes(needle));
    });
  };

  function syncFilters() {
    search.value = state.q;
    payerSel.value = state.payerId;
    codeSel.value = state.code;
    routeSel.value = state.route;
  }

  function draw() {
    const rows = found();
    $('#rw-metrics').innerHTML = railHtml();
    $('#rw-count').textContent = String(rows.length);
    $('#rw-body').innerHTML = rows.length ? tableHtml(rows) : emptyHtml();
  }

  function railHtml() {
    const { showing } = kpiFilter(state, KPI);
    const all = claims.rejectionsWorklist();
    const n = (route) => all.filter((c) => (route === 'other' ? ['Contract', 'Review'].includes(routeOf(c)) : routeOf(c) === route)).length;
    return metricRailHtml([
      { value: n('Policy'), label: 'Fix: policy', key: 'Policy', pressed: showing('Policy'), tone: n('Policy') ? 'critical' : '',
        sub: 'member ID or plan dates', title: 'Rejections corrected on the patient’s Insurance tab' },
      { value: n('Refresh'), label: 'Fix: refresh', key: 'Refresh', pressed: showing('Refresh'), tone: n('Refresh') ? 'warning' : '',
        sub: 're-assemble from the visit', title: 'Rejections answered by re-assembling the claim and scrubbing it again' },
      { value: n('Recode'), label: 'Fix: recode', key: 'Recode', pressed: showing('Recode'), tone: n('Recode') ? 'warning' : '',
        sub: 'ask the coder', title: 'Rejections that raise a recode request on the chart' },
      { value: n('other'), label: 'Fix: review', key: 'other', pressed: showing('other'),
        sub: 'contract or a reading', title: 'Rejections read on the claim or checked on the contract' },
    ]);
  }

  function tableHtml(rows) {
    const role = currentRole();
    return `
      <table class="tbl">
        <thead>
          <tr>
            <th scope="col">Claim</th>
            <th scope="col">Patient</th>
            <th scope="col">Payer</th>
            <th scope="col">Code · reason</th>
            <th scope="col">Cycle</th>
            <th scope="col">Batch</th>
            <th scope="col">Value</th>
            <th scope="col">Age</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>${rows.map((c) => rowHtml(c, role)).join('')}</tbody>
      </table>`;
  }

  function rowHtml(c, role) {
    const patient = patients.view(patients.get(c.patientMrn), role);
    const r = c.rejection || {};
    const reason = batches.rejectionReason(r.code);
    const age = claims.rejectionAge(c);
    const tone = age > 14 ? 'critical' : age > 7 ? 'warning' : '';
    return `
      <tr data-claim="${esc(c.claimNo)}">
        <td><a class="crumb-link t-mono-sm" href="#/claima/claims/${esc(c.claimNo)}">${esc(c.claimNo)}</a></td>
        <td>${patient ? `<a class="crumb-link" href="#/frontis/patients/${esc(c.patientMrn)}">${esc(patient.nameEn)}</a><br><span class="t-mono-sm">${esc(c.patientMrn)}</span>` : esc(c.patientMrn || '—')}</td>
        <td>${patient?.masked ? '<span class="badge">withheld</span>' : esc(payerName(c.payerId))}</td>
        <td><span class="badge badge--critical" title="${esc(reason?.label || '')}">${esc(r.code || '—')}</span> ${esc(r.reason || '')}
          <br><span class="t-body-sm"><span class="badge badge--accent">${esc(reason?.fixRoute || 'Review')}</span> ${esc(reason?.fixLabel || '')}</span></td>
        <td>${cycleStripHtml(c)}</td>
        <td>${r.batchNo ? `<a class="crumb-link t-mono-sm" href="#/claima/submission/${esc(r.batchNo)}/rejections">${esc(r.batchNo)}</a>` : '—'}</td>
        <td>${patient?.masked ? '<span class="badge">withheld</span>' : `<span class="t-mono-sm">${esc(usd(c.totals.payerShare))}</span>`}</td>
        <td><span class="badge${tone ? ` badge--${tone}` : ''}" title="Rejected ${esc(date(r.at))}">${age} d</span></td>
        <td>
          <button class="btn btn--primary btn--sm" data-act="fix"${patient?.masked ? ' disabled title="Your role reads this record masked and cannot act on its claims"' : ' title="Show the routed fix and resubmit"'}>
            <span class="icon icon--sm">build</span>Fix & resubmit</button>
          <a class="btn btn--ghost btn--sm" href="#/claima/claims/${esc(c.claimNo)}" title="Open the claim"><span class="icon icon--sm">visibility</span>Open claim</a>
        </td>
      </tr>`;
  }

  function emptyHtml() {
    const filtered = state.q || state.payerId || state.code || state.route;
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">${filtered ? 'search_off' : 'task_alt'}</span></div>
        <div class="state-view__title">${filtered ? 'No rejections match' : 'Nothing sent back'}</div>
        <p class="state-view__body">${filtered
    ? 'Change the search text or clear the filters to see every rejection.'
    : 'Every rejected claim has been taken up. A claim lands here when a batch’s acknowledgment rejects it, or a rejection is recorded on the batch.'}</p>
        <div class="state-view__actions">${filtered ? '<button class="btn btn--secondary" data-act="clear">Clear filters</button>' : ''}</div>
      </div>`;
  }

  // --- events ---------------------------------------------------------------

  search.addEventListener('input', () => { state.q = search.value; draw(); });
  for (const [el, key] of [[payerSel, 'payerId'], [codeSel, 'code'], [routeSel, 'route']]) {
    el.addEventListener('change', () => { state[key] = el.value; syncFilters(); draw(); });
  }
  mount.addEventListener('click', async (e) => {
    if (e.target.closest('a')) return;
    const kpi = metricKey(e);
    if (kpi) {
      kpiFilter(state, KPI).select(kpi);
      syncFilters();
      return draw();
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'clear') {
      Object.assign(state, KPI.all);
      syncFilters();
      return draw();
    }
    const claimNo = e.target.closest('tr[data-claim]')?.dataset.claim;
    if (act === 'fix' && claimNo) await askFixAndResubmit(claimNo, { navigate: ctx.navigate });
  });

  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));
  if (ctx.query?.route && (FIX_ROUTES.includes(ctx.query.route) || ctx.query.route === 'other')) state.route = ctx.query.route;
  syncFilters();
  draw();
}
