// The Accruals tab of the TPA ledger: the register, largest open overcharge
// first, with search, administrator / payer / state / remittance-date
// filters and a sort, a checkbox per row for the header's bulk dispute, and
// Open (the drawer) and Dispute on each row. The toolbar is drawn once when
// the tab mounts and only the table redraws on a change, so a half-typed
// search survives the commit that a dispute raised elsewhere caused.

import * as accruals from '../../../../data/repositories/tpa-fee-accruals.js';
import { esc } from '../../../../shared/format.js';
import { openRaiseDisputeDialog } from './tpa-dialogs.js';
import { basisHtml, claimHtml, expectedHtml, linkHtml, matchStateHtml, moneyHtml, remittanceHtml, separationsHtml, stateHtml, varianceHtml } from './tpa-chips.js';
import { KPI } from './tpa-kpis.js';

const PAGE_SIZE = 12;

export function render(host, { state, role, redraw, openAccrual, onSelection }) {
  const opts = accruals.filterOptions();
  host.innerHTML = `
    <div class="toolbar">
      <label class="field field--grow">
        <span class="icon icon--sm">search</span>
        <input type="search" id="ta-search" placeholder="Search accrual, claim, denial, remittance or administrator" aria-label="Search accruals">
      </label>
      <label class="field">
        <span class="icon icon--sm">apartment</span>
        <select id="ta-tpa" aria-label="Administrator"><option value="">Any administrator</option>${opts.tpas.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select>
      </label>
      <label class="field">
        <span class="icon icon--sm">account_balance</span>
        <select id="ta-payer" aria-label="Payer"><option value="">Any payer</option>${opts.payers.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>
      </label>
      <label class="field">
        <span class="icon icon--sm">filter_list</span>
        <select id="ta-state" aria-label="State"><option value="">Any state</option>${opts.states.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select>
      </label>
    </div>
    <div class="toolbar">
      <label class="field">
        <span class="icon icon--sm">event</span>
        <input type="date" id="ta-from" aria-label="Remittance from">
      </label>
      <label class="field">
        <span class="icon icon--sm">event</span>
        <input type="date" id="ta-to" aria-label="Remittance to">
      </label>
      <label class="field">
        <span class="icon icon--sm">sort</span>
        <select id="ta-sort" aria-label="Sort">
          <option value="overcharge">Open overcharge first</option>
          <option value="variance">Widest variance first</option>
          <option value="actual">Largest fee first</option>
          <option value="newest">Newest remittance first</option>
        </select>
      </label>
      <span class="spacer"></span>
      <button class="btn btn--ghost btn--sm" data-act="clear">Clear filters</button>
    </div>
    <div id="ta-body"></div>`;

  const $ = (sel) => host.querySelector(sel);
  const fields = { q: $('#ta-search'), tpaId: $('#ta-tpa'), payerId: $('#ta-payer'), state: $('#ta-state'), from: $('#ta-from'), to: $('#ta-to'), sort: $('#ta-sort') };
  const syncFilters = () => { for (const [key, el] of Object.entries(fields)) el.value = state[key] || (key === 'sort' ? 'overcharge' : ''); };

  function drawBody() {
    const rows = accruals.search(state.q, state);
    for (const id of [...state.selected]) if (!rows.some((a) => a.id === id)) state.selected.delete(id);
    const body = $('#ta-body');
    const filtered = Object.keys(KPI.all).some((k) => (state[k] || KPI.all[k]) !== KPI.all[k]);
    if (!rows.length) { body.innerHTML = emptyHtml(filtered); onSelection(); return; }
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    const start = state.page * PAGE_SIZE;
    const page = rows.slice(start, start + PAGE_SIZE);
    body.innerHTML = tableHtml(page, role, state) + pagerHtml(start, page.length, rows.length, state.page, pages);
    onSelection();
  }

  for (const [key, el] of Object.entries(fields)) {
    el.addEventListener(key === 'q' ? 'input' : 'change', () => {
      state[key] = el.value;
      if (key === 'state' && el.value) state.slice = '';
      state.page = 0;
      redraw();
    });
  }

  host.addEventListener('change', (e) => {
    const box = e.target.closest('[data-select]');
    if (!box) return;
    if (box.dataset.select === 'all') {
      for (const row of host.querySelectorAll('input[data-select]:not([data-select="all"])')) {
        row.checked = box.checked;
        if (box.checked) state.selected.add(row.dataset.select); else state.selected.delete(row.dataset.select);
      }
    } else if (box.checked) state.selected.add(box.dataset.select);
    else state.selected.delete(box.dataset.select);
    onSelection();
  });

  host.addEventListener('click', async (e) => {
    if (e.target.closest('a') || e.target.closest('input')) return;
    const pager = e.target.closest('[data-page]');
    if (pager && !pager.disabled) { state.page += pager.dataset.page === 'next' ? 1 : -1; return drawBody(); }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'clear') { Object.assign(state, { ...KPI.all, page: 0 }); syncFilters(); return redraw(); }
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return undefined;
    if (act === 'dispute') return void (await openRaiseDisputeDialog([tr.dataset.id]));
    return openAccrual(tr.dataset.id);
  });

  host.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr && e.target === tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openAccrual(tr.dataset.id); }
  });

  syncFilters();
  drawBody();
  return { redraw: drawBody, syncFilters };
}

function tableHtml(rows, role, state) {
  const allSelected = rows.length > 0 && rows.every((a) => state.selected.has(a.id));
  return `
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col"><input type="checkbox" data-select="all" aria-label="Select every row"${allSelected ? ' checked' : ''}></th>
          <th scope="col">Accrual</th>
          <th scope="col">Claim</th>
          <th scope="col">Payer</th>
          <th scope="col">Administrator</th>
          <th scope="col" title="The remittance the fee was withheld from and its date — the date the schedule version is read on">Remittance</th>
          <th scope="col" title="What the rate is read against">Basis</th>
          <th scope="col" title="What the administrator withheld — the separations' sum">Actual</th>
          <th scope="col" title="What the schedule version in force on the remittance date allows">Expected</th>
          <th scope="col" title="Actual − expected, against the tolerance">Variance</th>
          <th scope="col">State</th>
          <th scope="col" title="The dispute or the amendment on the accrual">Record</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>${rows.map((a) => rowHtml(a, role, state)).join('')}</tbody>
    </table>`;
}

function rowHtml(a, role, state) {
  const disputable = accruals.isDisputable(a);
  return `
    <tr data-id="${esc(a.id)}" tabindex="0" title="Open ${esc(a.id)}">
      <td><input type="checkbox" data-select="${esc(a.id)}" aria-label="Select ${esc(a.id)}"${state.selected.has(a.id) ? ' checked' : ''}${disputable ? '' : ' disabled title="Only an overcharged accrual nobody has disputed can be raised"'}></td>
      <td><a class="crumb-link t-mono-sm" href="#/defensio/tpa/accruals/${esc(a.id)}">${esc(a.id)}</a><br>${separationsHtml(a)}</td>
      <td>${claimHtml(a, role)}</td>
      <td>${esc(accruals.payerName(a))}</td>
      <td>${a.tpaId ? esc(accruals.tpaName(a)) : '<span class="badge badge--warning" title="No administrator linked to the payer on the remittance date">none linked</span>'}</td>
      <td>${remittanceHtml(a)}</td>
      <td>${basisHtml(a)}</td>
      <td>${moneyHtml(a.actual.amount, `${a.actual.separationRefs.length} separation${a.actual.separationRefs.length === 1 ? '' : 's'}`)}</td>
      <td>${expectedHtml(a)}</td>
      <td>${varianceHtml(a)}</td>
      <td>${stateHtml(a)} ${matchStateHtml(a)}</td>
      <td>${linkHtml(a)}</td>
      <td>
        <button class="btn btn--secondary btn--sm" data-act="open" title="Read the accrual — its basis, the version applied and its ledger line"><span class="icon icon--sm">open_in_new</span>Open</button>
        ${disputable ? '<button class="btn btn--primary btn--sm" data-act="dispute" title="Raise the overcharge with the administrator"><span class="icon icon--sm">gavel</span>Dispute</button>' : ''}
      </td>
    </tr>`;
}

export function pagerHtml(start, shown, total, page, pages) {
  return `
    <div class="tbl-foot">
      <span class="range">${start + 1}–${start + shown} of ${total}</span>
      <span class="pager">
        <button class="btn btn--secondary btn--sm" data-page="prev"${page === 0 ? ' disabled title="You are on the first page"' : ''}><span class="icon icon--sm">chevron_left</span>Previous</button>
        <button class="btn btn--secondary btn--sm" data-page="next"${page >= pages - 1 ? ' disabled title="You are on the last page"' : ''}>Next<span class="icon icon--sm">chevron_right</span></button>
      </span>
    </div>`;
}

export function emptyHtml(filtered) {
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">${filtered ? 'search_off' : 'task_alt'}</span></div>
      <div class="state-view__title">${filtered ? 'Nothing matches' : 'No accruals on file'}</div>
      <p class="state-view__body">${filtered
        ? 'No accrual matches these filters. Clear them to see the whole register.'
        : 'An accrual lands when a denial is separated as a TPA fee on the Denials worklist — the administrator’s withholding, read against its schedule.'}</p>
      ${filtered ? '<div class="state-view__actions"><button class="btn btn--secondary" data-act="clear">Clear filters</button></div>' : ''}
    </div>`;
}
