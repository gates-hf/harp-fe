// Patient accounts at #/frontis/accounts — every account money has moved on,
// worst balance first, because the biggest outstanding sum is the one a desk
// opens. Reads go through data/repositories/accounts.js and nowhere else.
//
// This feature also owns the deeper links and hands the mount over on each: an
// MRN is the account page, and the encounter board's Post charges link comes
// back through here too.

import * as accounts from '../../../../data/repositories/accounts.js';
import * as patients from '../../../../data/repositories/patients.js';
import { dateTime, esc, relativeTime, usd } from '../../../../shared/format.js';
import { metricKey } from '../../../../shared/metric-card.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { blank, railHtml, selectKpi } from './accounts-kpis.js';

export const meta = { title: 'Patient accounts' };

const PAGE_SIZE = 12;

export async function render(mount, ctx) {
  const [first] = ctx.params;
  if (first) {
    if (!accounts.get(first) && !patients.get(first)) throw new Error(`No account ${first}`);
    return (await import('./account-view.js')).render(mount, ctx);
  }

  const res = await fetch(new URL('./accounts-list.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load accounts-list.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { ...blank(), page: 0 };
  const $ = (sel) => mount.querySelector(sel);

  const search = $('#al-search');
  const outstandingSel = $('#al-outstanding');
  const flagSel = $('#al-flag');
  const fromInput = $('#al-from');
  const toInput = $('#al-to');

  outstandingSel.innerHTML = accounts.OUTSTANDING_FILTERS
    .map((f) => `<option value="${esc(f.id)}">${esc(f.label)}</option>`).join('');

  function syncFilters() {
    search.value = state.q;
    outstandingSel.value = state.outstanding;
    flagSel.value = state.flag;
    fromInput.value = state.from;
    toInput.value = state.to;
  }

  function draw() {
    const flags = accounts.flagsInUse();
    flagSel.innerHTML = `<option value="">Any flag</option>${
      flags.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join('')}`;
    flagSel.value = state.flag;
    flagSel.disabled = flags.length === 0;
    flagSel.title = flags.length ? '' : 'No account carries a flag yet';
    $('#al-metrics').innerHTML = railHtml(state);
    drawBanner();
    drawRows();
  }

  /** The two card-only slices have no select of their own to speak for them. */
  function drawBanner() {
    const banner = $('#al-banner');
    const words = state.holdingDeposit ? 'holding a deposit that has not been applied'
      : state.activeToday ? 'money was taken on today' : '';
    banner.hidden = !words;
    banner.innerHTML = words
      ? `<div class="alert alert--info">
           <span class="icon">filter_alt</span>
           <div>Showing accounts ${esc(words)}. Clear filters to see every account.</div>
         </div>`
      : '';
  }

  function drawRows() {
    const all = accounts.search(state.q, state);
    const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    const start = state.page * PAGE_SIZE;
    const page = all.slice(start, start + PAGE_SIZE);
    const role = currentRole();
    // Read once for the page rather than once per row: counts() walks the whole
    // ledger, and a row only needs the number it compares against.
    const threshold = accounts.counts().threshold;

    $('#al-rows').innerHTML = page.map((row) => rowHtml(row, role, threshold)).join('');

    const empty = $('#al-empty');
    empty.hidden = all.length > 0;
    mount.querySelector('.tbl').hidden = all.length === 0;
    if (!all.length) empty.innerHTML = emptyHtml();

    $('#al-range').textContent = all.length ? `${start + 1}–${start + page.length} of ${all.length}` : '0 of 0';
    setPager('prev', state.page === 0, 'You are on the first page');
    setPager('next', state.page >= pages - 1, 'You are on the last page');
  }

  function rowHtml(row, role, threshold) {
    const patient = patients.view(row.patient, role);
    // What a restricted record owes names the cover that left it owing, so the
    // money is withheld here the way the encounter board withholds the
    // financial class. That an account exists is not the part under restriction.
    const withheld = Boolean(patient?.masked);
    const b = row.balances;
    const over = b.outstanding > threshold;
    const money = (n, bold = false) => (withheld
      ? '<span class="t-mono-sm">—</span>'
      : `<span class="t-mono-sm">${bold ? `<b>${usd(n)}</b>` : usd(n)}</span>`);
    return `
      <tr data-mrn="${esc(row.mrn)}" tabindex="0" title="Open the account for ${esc(patient?.nameEn || row.mrn)}">
        <td>
          <div>${esc(patient?.nameEn || row.mrn)}</div>
          <span class="t-mono-sm">${esc(row.mrn)}</span>
        </td>
        <td>${row.openCount
          ? `<span class="badge badge--accent">${row.openCount}</span>
             <span class="t-body-sm">${esc(row.openTypes.join(' · '))}</span>`
          : '<span class="t-body-sm">none open</span>'}</td>
        <td class="num">${money(b.totalCharges)}</td>
        <td class="num">${money(b.patientShare)}</td>
        <td class="num">${money(b.paid + b.depositsApplied)}</td>
        <td class="num">${money(b.depositsHeld)}</td>
        <td class="num">${withheld
          ? '<span class="t-mono-sm">—</span>'
          : over
            ? `<span class="badge badge--critical t-mono-sm"
                     title="Over the ${esc(usd(threshold))} follow-up threshold">
                 <b>${usd(b.outstanding)}</b></span>`
            : `<span class="t-mono-sm"><b>${usd(b.outstanding)}</b></span>`}</td>
        <td>${row.last
          ? `<span title="${esc(dateTime(row.last.at))}">${esc(relativeTime(row.last.at))}</span>
             <br><span class="t-body-sm">${esc(row.last.type)}</span>`
          : '<span class="t-body-sm">—</span>'}</td>
        <td>${(row.flags || []).map((f) => `<span class="badge badge--warning">${esc(f)}</span>`).join(' ')
          || '<span class="t-body-sm">—</span>'}</td>
        <td>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="open" title="Open the account">
            <span class="icon icon--sm">visibility</span>
          </button>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="pay"${withheld ? ' disabled' : ''}
                  title="${esc(withheld ? 'A restricted record is read by roles with VIP access only' : 'Record a payment')}">
            <span class="icon icon--sm">payments</span>
          </button>
        </td>
      </tr>`;
  }

  function emptyHtml() {
    const filtered = state.q || state.outstanding !== 'any' || state.flag || state.from || state.to
      || state.holdingDeposit || state.activeToday;
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">${filtered ? 'search_off' : 'account_balance_wallet'}</span></div>
        <div class="state-view__title">No accounts found</div>
        <p class="state-view__body">${
          filtered
            ? 'No accounts match. Change the search text or clear the filters to see every account.'
            : 'No money has moved yet. An account opens the first time a visit is charged or a payment is taken.'
        }</p>
        <div class="state-view__actions">
          ${filtered ? '<button class="btn btn--secondary" data-act="clear">Clear filters</button>' : ''}
          <a class="btn btn--primary" href="#/frontis/encounters">Open the encounter board</a>
        </div>
      </div>`;
  }

  function setPager(which, disabled, why) {
    const btn = mount.querySelector(`[data-page="${which}"]`);
    btn.disabled = disabled;
    btn.title = disabled ? why : '';
  }

  /** A card elsewhere opens this list already filtered: accounts?outstanding=… */
  function applyQuery(q = {}) {
    if (accounts.OUTSTANDING_FILTERS.some((f) => f.id === q.outstanding)) state.outstanding = q.outstanding;
    if (q.deposits === '1') state.holdingDeposit = true;
    if (q.today === '1') state.activeToday = true;
    syncFilters();
  }

  // --- events ---------------------------------------------------------------

  search.addEventListener('input', () => {
    state.q = search.value;
    state.page = 0;
    draw();
  });

  for (const [el, key] of [[outstandingSel, 'outstanding'], [flagSel, 'flag'],
    [fromInput, 'from'], [toInput, 'to']]) {
    el.addEventListener('change', () => {
      state[key] = el.value;
      state.page = 0;
      draw();
    });
  }

  mount.addEventListener('click', async (e) => {
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

    const tr = e.target.closest('tr[data-mrn]');
    if (!tr) return;
    if (act === 'pay') {
      const { openPaymentForm } = await import('./payment-form.js');
      await openPaymentForm({ mrn: tr.dataset.mrn });
      return;
    }
    ctx.navigate(`/frontis/accounts/${tr.dataset.mrn}`);
  });

  mount.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-mrn]');
    if (tr && e.target === tr && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      ctx.navigate(`/frontis/accounts/${tr.dataset.mrn}`);
    }
  });

  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));

  applyQuery(ctx.query);
  draw();
}
