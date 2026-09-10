// Pre-authorisations at #/frontis/preauth — every request the desk has raised,
// and which of them still owes somebody something. Reads go through
// data/repositories/preauth-requests.js and nowhere else.
//
// This feature also owns the deeper links and hands the mount over on each:
// /new and a draft's number open the form, any other number the request page —
// the shape the estimates list already uses, because a draft is a working
// document and everything else is evidence.

import * as preauth from '../../../../data/repositories/preauth-requests.js';
import * as payers from '../../../../data/repositories/payers.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { esc } from '../../../../shared/format.js';
import { metricKey } from '../../../../shared/metric-card.js';
import { KPI, blank, railHtml, selectKpi } from './preauth-kpis.js';
import {
  authNumberHtml, isWithheld, patientHtml, pendingHtml, priorityHtml, servicesHtml, statusHtml, validityHtml,
} from './preauth-chips.js';
import { askCancel, askSubmit } from './preauth-actions.js';
import { askDecision } from './preauth-decision.js';
import { openPreauthHistory } from './preauth-history.js';

export const meta = { title: 'Pre-authorisations' };

const PAGE_SIZE = 12;

/** The three windows the Expiring within filter offers. */
const WINDOWS = [7, 14, 30];

export async function render(mount, ctx) {
  const first = ctx.params[0];
  if (first === 'new' || (first && preauth.isDraft(preauth.get(first)))) {
    return (await import('./preauth-form.js')).render(mount, ctx);
  }
  if (first) return (await import('./preauth-view.js')).render(mount, ctx);

  const res = await fetch(new URL('./preauth-worklist.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load preauth-worklist.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { ...blank(), page: 0 };
  const $ = (sel) => mount.querySelector(sel);

  const search = $('#pw-search');
  const statusSel = $('#pw-status');
  const payerSel = $('#pw-payer');
  const expiringSel = $('#pw-expiring');
  const fromInput = $('#pw-from');
  const toInput = $('#pw-to');

  statusSel.innerHTML = `<option value="">All statuses</option>${
    preauth.STATUSES.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}`;
  payerSel.innerHTML = `<option value="">Any payer</option>${
    payers.findActive().map((p) => `<option value="${esc(p.id)}">${esc(p.nameEn)}</option>`).join('')}`;
  expiringSel.innerHTML = `<option value="">Any validity</option>${
    WINDOWS.map((d) => `<option value="${d}">Expiring within ${d} days</option>`).join('')}`;

  function syncFilters() {
    search.value = state.q;
    statusSel.value = state.status;
    payerSel.value = state.payerId;
    expiringSel.value = state.expiring;
    fromInput.value = state.from;
    toInput.value = state.to;
    for (const btn of mount.querySelectorAll('[data-view]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.view === state.view));
    }
  }

  function draw() {
    $('#pw-metrics').innerHTML = railHtml(state);
    drawBanner();
    drawRows();
  }

  /** The one filter with no control of its own says so over the table. */
  function drawBanner() {
    const banner = $('#pw-banner');
    const overdue = preauth.all().filter(preauth.isOverdue).length;
    banner.hidden = !overdue;
    banner.innerHTML = overdue
      ? `<div class="alert alert--critical">
           <span class="icon">priority_high</span>
           <div>${overdue} urgent request${overdue === 1 ? ' has' : 's have'} been with the payer for more than
             ${preauth.CONFIG.urgentChaseDays} days with no answer. Chase them by phone and log the call on the
             request — the log is what a payer dispute is argued from.</div>
         </div>`
      : '';
  }

  function drawRows() {
    const role = currentRole();
    const found = preauth.search(state.q, state);
    const pages = Math.max(1, Math.ceil(found.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    const start = state.page * PAGE_SIZE;
    const page = found.slice(start, start + PAGE_SIZE);

    $('#pw-rows').innerHTML = page.map((row) => rowHtml(row, role)).join('');

    const empty = $('#pw-empty');
    empty.hidden = found.length > 0;
    mount.querySelector('.tbl').hidden = found.length === 0;
    if (!found.length) empty.innerHTML = emptyHtml();

    $('#pw-range').textContent = found.length ? `${start + 1}–${start + page.length} of ${found.length}` : '0 of 0';
    setPager('prev', state.page === 0, 'You are on the first page');
    setPager('next', state.page >= pages - 1, 'You are on the last page');
  }

  function setPager(which, disabled, why) {
    const btn = mount.querySelector(`[data-page="${which}"]`);
    btn.disabled = disabled;
    btn.title = disabled ? why : '';
  }

  /**
   * A restricted record's request names its payer, its plan and its money, so
   * those three cells are withheld and the rest of the row is not — the line
   * the encounter board already draws.
   */
  function rowHtml(row, role) {
    const masked = isWithheld(row, role);
    const draft = preauth.isDraft(row);
    const pending = preauth.isPending(row);
    const open = draft || pending;
    return `
      <tr data-no="${esc(row.no)}" tabindex="0" title="Open ${esc(row.no)}">
        <td class="t-mono-sm">${esc(row.no)}</td>
        <td>${patientHtml(row, role)}</td>
        <td>${masked ? withheldCell() : esc(preauth.coverLabel(row))}</td>
        <td>${masked ? withheldCell() : servicesHtml(row)}</td>
        <td>${statusHtml(row)}${row.priority === 'Urgent' ? `<br>${priorityHtml(row)}` : ''}</td>
        <td>${pendingHtml(row)}</td>
        <td>${masked ? withheldCell() : authNumberHtml(row)}</td>
        <td>${validityHtml(row)}</td>
        <td>${row.encounterNo
          ? `<a class="crumb-link t-mono-sm" href="#/frontis/encounters/${esc(row.encounterNo)}">${esc(row.encounterNo)}</a>`
          : '<span class="t-body-sm">—</span>'}</td>
        <td>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="open"
                  title="${draft ? `Edit ${esc(row.no)}` : `Open ${esc(row.no)}`}">
            <span class="icon icon--sm">${draft ? 'edit' : 'visibility'}</span>
          </button>
          ${action('submit', 'send', draft && !masked, draft
            ? (masked ? 'Your role reads this record masked and cannot send its request' : `Send ${row.no} to the payer`)
            : `A ${row.status.toLowerCase()} request has already been sent`)}
          ${action('decide', 'fact_check', pending && !masked, pending
            ? (masked ? 'Your role reads this record masked and cannot record an answer' : `Record the payer's answer on ${row.no}`)
            : draft ? 'Send it first — there is no answer to record yet'
              : `${row.no} has already been answered`)}
          ${action('cancel', 'cancel', open, open
            ? `Withdraw ${row.no}`
            : `A ${row.status.toLowerCase()} request cannot be withdrawn`)}
          <button class="btn btn--ghost btn--icon btn--sm" data-act="history" title="View history">
            <span class="icon icon--sm">history</span>
          </button>
        </td>
      </tr>`;
  }

  const withheldCell = () =>
    '<span class="badge" title="A restricted record’s cover, services and money are read by roles with VIP access only">withheld</span>';

  const action = (act, icon, allowed, why) => `
    <button class="btn btn--ghost btn--icon btn--sm" data-act="${act}"${allowed ? '' : ' disabled'} title="${esc(why)}">
      <span class="icon icon--sm">${icon}</span>
    </button>`;

  function emptyHtml() {
    const filtered = state.q || state.status || state.payerId || state.expiring || state.from || state.to;
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">${filtered ? 'search_off' : 'gpp_maybe'}</span></div>
        <div class="state-view__title">${filtered ? 'No requests found'
          : state.view === 'action' ? 'Nothing outstanding' : 'Nothing raised yet'}</div>
        <p class="state-view__body">${filtered
          ? 'No request matches. Change the search text or clear the filters to see the whole register.'
          : state.view === 'action'
            ? 'Every request has been sent, answered and is still in force. A pre-authorisation turns up here the moment it is drafted, sent or a week from lapsing.'
            : 'Nobody has asked a payer to approve anything. A request starts life on a flag — from an eligibility check, a cost estimate or the visit itself.'}</p>
        <div class="state-view__actions">
          ${filtered ? '<button class="btn btn--secondary" data-act="clear">Clear filters</button>' : ''}
          ${state.view !== 'all' ? '<button class="btn btn--secondary" data-view="all">Show the whole register</button>' : ''}
          <a class="btn btn--primary" href="#/frontis/preauth/new">New request</a>
        </div>
      </div>`;
  }

  // --- events ---------------------------------------------------------------

  search.addEventListener('input', () => {
    state.q = search.value;
    state.page = 0;
    draw();
  });

  for (const [el, key] of [
    [statusSel, 'status'], [payerSel, 'payerId'], [expiringSel, 'expiring'],
    [fromInput, 'from'], [toInput, 'to'],
  ]) {
    el.addEventListener('change', () => {
      state[key] = el.value;
      state.page = 0;
      draw();
    });
  }

  mount.addEventListener('click', async (e) => {
    const kpi = metricKey(e);
    if (kpi) {
      selectKpi(state, kpi);
      state.page = 0;
      syncFilters();
      return draw();
    }

    const view = e.target.closest('[data-view]');
    if (view) {
      state.view = view.dataset.view;
      state.page = 0;
      syncFilters();
      return draw();
    }

    const pager = e.target.closest('[data-page]');
    if (pager && !pager.disabled) {
      state.page += pager.dataset.page === 'next' ? 1 : -1;
      return drawRows();
    }

    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'clear') {
      Object.assign(state, KPI.all, { page: 0 });
      syncFilters();
      return draw();
    }

    const tr = e.target.closest('tr[data-no]');
    if (!tr) return;
    const no = tr.dataset.no;
    if (act === 'history') return void openPreauthHistory(no);
    if (act === 'submit') return void (await askSubmit(no, ctx));
    if (act === 'decide') return void (await askDecision(no));
    if (act === 'cancel') return void (await askCancel(no));
    ctx.navigate(`/frontis/preauth/${no}`);
  });

  mount.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-no]');
    if (tr && e.target === tr && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      ctx.navigate(`/frontis/preauth/${tr.dataset.no}`);
    }
  });

  // A decision captured in the dialog, a request sent from the page and the
  // expiry sweep all land here without a reload; switching demo role re-reads
  // the masking.
  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));

  // A card on a dashboard opens the worklist pre-filtered:
  // #/frontis/preauth?view=all&status=Denied.
  applyQuery(ctx.query);
  syncFilters();
  draw();

  function applyQuery(q = {}) {
    // `needs-action` is the dashboard's spelling of the same view.
    if (q.view === 'all' || q.view === 'action') state.view = q.view;
    if (q.view === 'needs-action') state.view = 'action';
    if (preauth.STATUSES.includes(q.status)) state.status = q.status;
    if (q.payerId && payers.get(q.payerId)) state.payerId = q.payerId;
    if (WINDOWS.includes(Number(q.expiring))) Object.assign(state, { view: 'all', expiring: String(Number(q.expiring)) });
  }
}
