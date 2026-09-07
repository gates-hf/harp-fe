// Contracts — every active contract in the platform, across payers. Reads go
// through data/repositories/contracts.js and nowhere else.
//
// This feature also owns the contract page deep links: #/pactum/contracts/<id>
// is the contract page and /fee-report its fee schedule report, both the same
// screen in the manifest, so the list hands the mount over.

import * as contracts from '../../../../data/repositories/contracts.js';
import * as payers from '../../../../data/repositories/payers.js';
import { date, dateTime, esc } from '../../../../shared/format.js';

export const meta = { title: 'Contracts' };

export async function render(mount, ctx) {
  if (ctx.params[0]) {
    const feature = ctx.params[1] === 'fee-report' ? './fee-report.js' : './contract-view.js';
    return (await import(feature)).render(mount, ctx);
  }

  const res = await fetch(new URL('./contracts-global.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load contracts-global.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { q: '', payerType: '', expiring: '' };
  const $ = (sel) => mount.querySelector(sel);

  const search = $('#cg-search');
  const typeSel = $('#cg-type');
  const expiringSel = $('#cg-expiring');

  typeSel.innerHTML =
    '<option value="">All payer types</option>' +
    payers.TYPES.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  expiringSel.innerHTML =
    '<option value="">Expiring: any</option>' +
    contracts.EXPIRY_WINDOWS.map((d) => `<option value="${d}">Expiring within ${d} days</option>`).join('');

  function drawMetrics() {
    const c = contracts.counts();
    $('#cg-metrics').innerHTML = [
      metric('Active', c.active, '', 'Contracts in force today'),
      metric('Expiring ≤30d', c.expiring30, c.expiring30 ? 'warning' : '', 'Active contracts ending within 30 days'),
      metric('Draft', c.draft, '', 'Drafted, not yet activated'),
      metric('Payers covered', c.payers, '', 'Payers with at least one active contract'),
    ].join('');
  }

  function metric(label, value, tone, title) {
    return `
      <div class="metric-rail-card${tone ? ` metric-rail-card--${tone}` : ''}" title="${esc(title)}">
        <span class="metric-rail-card__value">${esc(value)}</span>
        <span class="metric-rail-card__label">${esc(label)}</span>
      </div>`;
  }

  function draw() {
    drawMetrics();
    // Soonest to expire first: the list exists to catch a contract running out.
    const rows = contracts.list({ ...state, onlyActive: true, sort: 'endDate', dir: 'asc' });
    $('#cg-rows').innerHTML = rows.map(rowHtml).join('');

    const empty = $('#cg-empty');
    empty.hidden = rows.length > 0;
    mount.querySelector('.tbl').hidden = rows.length === 0;
    if (!rows.length) empty.innerHTML = emptyHtml();
  }

  function emptyHtml() {
    const filtered = state.q || state.payerType || state.expiring;
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">${filtered ? 'search_off' : 'contract'}</span></div>
        <div class="state-view__title">No active contracts found</div>
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
        <td class="num t-mono-sm">${c.rules.length}</td>
        <td class="t-mono-sm">${dateTime(c.updatedAt)}</td>
      </tr>`;
  }

  // --- events ---------------------------------------------------------------

  search.addEventListener('input', () => {
    state.q = search.value;
    draw();
  });

  for (const [el, key] of [[typeSel, 'payerType'], [expiringSel, 'expiring']]) {
    el.addEventListener('change', () => {
      state[key] = el.value;
      draw();
    });
  }

  mount.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="clear"]')) {
      Object.assign(state, { q: '', payerType: '', expiring: '' });
      search.value = '';
      typeSel.value = '';
      expiringSel.value = '';
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

  draw();
}
