// Contracts — every active contract in the platform, across payers. Reads go
// through data/repositories/contracts.js and nowhere else.
//
// This feature also owns the contract page deep links: #/pactum/contracts/<id>
// is the contract page, /fee-report its fee schedule report and /rules/<id> the
// rule wizard — all the same screen in the manifest, so the list hands the
// mount over.

import * as contracts from '../../../../data/repositories/contracts.js';
import * as payers from '../../../../data/repositories/payers.js';
import { date, dateTime, esc } from '../../../../shared/format.js';
import { metricKey } from '../../../../shared/metric-card.js';
import { KPI, railHtml, selectKpi } from './contracts-kpis.js';

export const meta = { title: 'Contracts' };

export async function render(mount, ctx) {
  if (ctx.params[0]) {
    // /rules on its own is the contract page opened on the Rules tab; /rules/new
    // and /rules/<id> are the wizard, a page of its own.
    const feature = ctx.params[1] === 'fee-report' ? './fee-report.js'
      : ctx.params[1] === 'rules' && ctx.params[2] ? '../rules/rule-wizard.js'
        : './contract-view.js';
    return (await import(feature)).render(mount, ctx);
  }

  const res = await fetch(new URL('./contracts-global.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load contracts-global.html (${res.status})`);
  mount.innerHTML = await res.text();

  // The list opens on the contracts in force — the reason to come here — and
  // the status filter widens it to a draft or a closed version on request.
  const state = { q: '', payerType: '', expiring: '', status: 'Active' };
  const $ = (sel) => mount.querySelector(sel);

  const search = $('#cg-search');
  const typeSel = $('#cg-type');
  const expiringSel = $('#cg-expiring');
  const statusSel = $('#cg-status');

  typeSel.innerHTML =
    '<option value="">All payer types</option>' +
    payers.TYPES.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  statusSel.innerHTML =
    '<option value="">All statuses</option>' +
    contracts.STATUSES.map((st) => `<option value="${esc(st)}">${esc(st)}</option>`).join('');
  expiringSel.innerHTML =
    '<option value="">Expiring: any</option>' +
    contracts.EXPIRY_WINDOWS.map((d) => `<option value="${d}">Expiring within ${d} days</option>`).join('');

  function drawMetrics() {
    $('#cg-metrics').innerHTML = railHtml(state);
  }

  function syncFilters() {
    search.value = state.q;
    typeSel.value = state.payerType;
    expiringSel.value = state.expiring;
    statusSel.value = state.status;
  }

  function draw() {
    drawMetrics();
    // Soonest to expire first: the list exists to catch a contract running out.
    const rows = contracts.list({ ...state, sort: 'endDate', dir: 'asc' });
    $('#cg-title').textContent = state.status ? `${state.status} contracts` : 'All contracts';
    $('#cg-rows').innerHTML = rows.map(rowHtml).join('');

    const empty = $('#cg-empty');
    empty.hidden = rows.length > 0;
    mount.querySelector('.tbl').hidden = rows.length === 0;
    if (!rows.length) empty.innerHTML = emptyHtml();
  }

  function emptyHtml() {
    const filtered = state.q || state.payerType || state.expiring || state.status !== 'Active';
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">${filtered ? 'search_off' : 'contract'}</span></div>
        <div class="state-view__title">No ${esc(state.status ? `${state.status.toLowerCase()} contracts` : 'contracts')} found</div>
        <p class="state-view__body">${filtered
          ? 'No contracts match. Change the search text or clear the filters to see them all.'
          : 'A contract is added from the payer it belongs to. Open a payer and choose Contracts.'}</p>
        <div class="state-view__actions">
          ${filtered ? '<button class="btn btn--secondary" data-action="clear">Clear filters</button>' : ''}
          <a class="btn btn--primary" href="#/pactum/payers">Go to Payer Master</a>
        </div>
      </div>`;
  }

  function rowHtml(c) {
    const days = contracts.daysLeft(c);
    const soon = days != null && days >= 0 && days <= 90;
    return `
      <tr data-id="${c.id}" tabindex="0" title="Open ${esc(c.name)}">
        <td>${esc(contracts.payerName(c))}<br><span class="t-body-sm">${esc(contracts.payerOf(c)?.type || '')}</span></td>
        <td>${esc(c.name)}</td>
        <td class="t-mono-sm">${esc(c.contractNo)}</td>
        <td class="num t-mono-sm">v${c.version}</td>
        <td class="t-mono-sm">${date(c.startDate)}</td>
        <td class="t-mono-sm">${date(c.endDate)}
          ${soon ? `<span class="badge badge--warning" title="Ends ${esc(date(c.endDate))}"><span class="dot"></span>expires in ${days} day${days === 1 ? '' : 's'}</span>` : ''}
        </td>
        <td class="num t-mono-sm">${contracts.activeRuleCount(c)}</td>
        <td class="t-mono-sm">${dateTime(c.updatedAt)}</td>
      </tr>`;
  }

  // --- events ---------------------------------------------------------------

  search.addEventListener('input', () => {
    state.q = search.value;
    draw();
  });

  for (const [el, key] of [[typeSel, 'payerType'], [expiringSel, 'expiring'], [statusSel, 'status']]) {
    el.addEventListener('change', () => {
      state[key] = el.value;
      draw();
    });
  }

  mount.addEventListener('click', (e) => {
    const kpi = metricKey(e);
    if (kpi) {
      selectKpi(state, kpi);
      syncFilters();
      draw();
      return;
    }

    // Clear filters returns to the contracts in force, which is what the screen
    // opens on; the All contracts card is the one that widens it to every row.
    if (e.target.closest('[data-action="clear"]')) {
      Object.assign(state, { ...KPI.all, status: 'Active' });
      syncFilters();
      draw();
      return;
    }
    const row = e.target.closest('tr[data-id]');
    if (row) ctx.navigate(`/pactum/contracts/${row.dataset.id}`);
  });

  mount.addEventListener('keydown', (e) => {
    const row = e.target.closest('tr[data-id]');
    if (row && e.target === row && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      ctx.navigate(`/pactum/contracts/${row.dataset.id}`);
    }
  });

  // The list is live: a contract activated or terminated anywhere in the
  // session lands here without a reload.
  ctx.onData(draw);

  // A dashboard card opens this list already filtered:
  // #/pactum/contracts?status=Draft, #/pactum/contracts?expiring=60.
  if (contracts.STATUSES.includes(ctx.query?.status) || ctx.query?.status === '') {
    state.status = ctx.query.status;
  }
  if (contracts.EXPIRY_WINDOWS.includes(Number(ctx.query?.expiring))) {
    state.expiring = String(Number(ctx.query.expiring));
  }
  if (payers.TYPES.includes(ctx.query?.payerType)) state.payerType = ctx.query.payerType;
  statusSel.value = state.status;
  expiringSel.value = state.expiring;
  typeSel.value = state.payerType;

  draw();
}
