// The account page at #/frontis/accounts/<mrn>, and any tab id after it: what
// this patient has been charged, what has been paid, what is held and what is
// still owed — with the transactions that make up every one of those figures.
//
// Nothing here computes money. Every figure comes from
// data/repositories/accounts.js, which asks the engine, which reads the ledger.

import * as accounts from '../../../../data/repositories/accounts.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import * as modal from '../../../../shared/modal.js';
import { esc } from '../../../../shared/format.js';
import { metricKey } from '../../../../shared/metric-card.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { railHtml, metaHtml, actionsHtml, bannersHtml } from './account-header.js';
import { transactionsHtml, byEncounterHtml } from './account-tabs.js';
import { depositsHtml, receiptsHtml } from './account-receipts.js';
import { accountHistoryHtml } from './account-history.js';

export const meta = { title: 'Account' };

const TABS = [
  { id: 'transactions', label: 'Transactions' },
  { id: 'encounters', label: 'By encounter' },
  { id: 'deposits', label: 'Deposits' },
  { id: 'receipts', label: 'Receipts & documents' },
  { id: 'history', label: 'History' },
];

/**
 * What each card does. Two of them name a slice of the ledger and hold their
 * pressed state; the rest jump to the tab that breaks the figure down, which is
 * the answer Contract Performance already gives for a number with no list of
 * its own under it.
 */
const CARD_ACTIONS = {
  charges: { tab: 'transactions', filter: { type: 'Charge' } },
  paid: { tab: 'transactions', filter: { type: 'Payment' } },
  payer: { tab: 'encounters' },
  patient: { tab: 'encounters' },
  deposits: { tab: 'deposits' },
  outstanding: { tab: 'encounters' },
};

export async function render(mount, ctx) {
  const mrn = ctx.params[0];
  const patient = patients.get(mrn);
  if (!patient) throw new Error(`No patient ${mrn}`);

  const res = await fetch(new URL('./account-view.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load account-view.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = {
    tab: TABS.some((t) => t.id === ctx.params[1]) ? ctx.params[1] : TABS[0].id,
    tx: { type: '', encounterNo: '', from: '', to: '' },
    expanded: [],
    historyFilter: 'all',
  };
  const $ = (sel) => mount.querySelector(sel);

  function draw() {
    const role = currentRole();
    const view = patients.view(patients.get(mrn), role);
    const account = accounts.get(mrn);
    const b = accounts.balances(mrn);

    ctx.setHeader(`Account — ${view?.nameEn || mrn}`);
    ctx.setCrumb([
      { label: 'Frontis', path: '/frontis/patients' },
      { label: 'Accounts', path: '/frontis/accounts' },
      { label: mrn },
    ]);

    $('#av-name').textContent = view?.nameEn || mrn;
    $('#av-meta').innerHTML = metaHtml(mrn, view, account, b);
    $('#av-actions').innerHTML = actionsHtml(mrn, view, accounts.postableEncounters(mrn));
    $('#av-banners').innerHTML = bannersHtml(view, b);
    // A restricted record's money is withheld the way the encounter board
    // withholds its financial class: the account exists, and that is all a role
    // without VIP access reads of it.
    $('#av-metrics').innerHTML = view?.masked ? '' : railHtml(b, showingSlice);
    $('#av-tabs').innerHTML = TABS.map((t) => `
      <button class="sections__tab${t.id === state.tab ? ' is-active' : ''}" role="tab"
              aria-selected="${t.id === state.tab}" data-tab="${t.id}">${t.label}</button>`).join('');
    drawPanel(view, role);
  }

  /** Redraw only the tab body — what a filter or an expander moves. */
  function redrawPanel() {
    const role = currentRole();
    drawPanel(patients.view(patients.get(mrn), role), role);
  }

  function drawPanel(view, role) {
    const panel = $('#av-panel');
    if (view?.masked) {
      panel.innerHTML = `
        <div class="perm-banner">
          <span class="icon">lock</span>
          <div>This record is restricted. What it has been charged and what it owes are read by roles
            with VIP access only.</div>
        </div>`;
      return;
    }
    if (state.tab === 'encounters') return void (panel.innerHTML = byEncounterHtml(mrn, state.expanded));
    if (state.tab === 'deposits') return void (panel.innerHTML = depositsHtml(mrn, role));
    if (state.tab === 'receipts') return void (panel.innerHTML = receiptsHtml(mrn));
    if (state.tab === 'history') return void (panel.innerHTML = accountHistoryHtml(mrn, state.historyFilter));
    panel.innerHTML = transactionsHtml(mrn, state.tx);
  }

  /** Whether the transactions tab is showing exactly this slice and no other. */
  function showingSlice(filter) {
    return state.tab === 'transactions'
      && Object.entries(filter).every(([k, v]) => state.tx[k] === v);
  }

  /** The Post charges menu: whichever of this patient's visits can take them. */
  async function askPostCharges() {
    const rows = accounts.postableEncounters(mrn);
    if (rows.length === 1) return ctx.navigate(`/frontis/encounters/${rows[0].no}/post-charges`);
    const sheet = modal.open({
      title: 'Post charges',
      sub: 'Choose the visit the charges belong to',
      icon: 'post_add',
      body: `
        <ul class="menu" role="listbox">
          ${rows.map((enc) => `
            <li><button role="option" data-enc="${esc(enc.no)}">
              <span class="icon">event_available</span>
              <span>
                <span class="t-mono-sm">${esc(enc.no)}</span> ${esc(encounters.typeLabel(enc.type))} ·
                ${esc(enc.department)}
                <br><span class="t-body-sm">${esc(enc.status)}${enc.chargesPosted ? ' · charges already posted' : ''}</span>
              </span>
            </button></li>`).join('')}
        </ul>`,
      foot: '<button class="btn btn--secondary" data-close>Cancel</button>',
    });
    sheet.el.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-enc]');
      if (!btn) return;
      sheet.close(null);
      ctx.navigate(`/frontis/encounters/${btn.dataset.enc}/post-charges`);
    });
    return sheet.closed;
  }

  // --- events ---------------------------------------------------------------

  mount.addEventListener('click', async (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) {
      state.tab = tab.dataset.tab;
      draw();
      return;
    }

    const kpi = metricKey(e);
    if (kpi && CARD_ACTIONS[kpi]) {
      const { tab: target, filter } = CARD_ACTIONS[kpi];
      if (filter) {
        const on = state.tab === 'transactions'
          && Object.entries(filter).every(([k, v]) => state.tx[k] === v);
        state.tx = { type: '', encounterNo: '', from: '', to: '', ...(on ? {} : filter) };
      }
      state.tab = target;
      draw();
      return;
    }

    // The history strip's chips are buttons carrying data-filter; the
    // transactions filters are selects and inputs, and the change handler below
    // owns those.
    const chip = e.target.closest('button[data-filter]');
    if (chip) {
      state.historyFilter = chip.dataset.filter;
      redrawPanel();
      return;
    }

    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'clear-tx') {
      state.tx = { type: '', encounterNo: '', from: '', to: '' };
      redrawPanel();
      return;
    }
    if (act === 'expand') {
      const encNo = e.target.closest('[data-enc]').dataset.enc;
      state.expanded = state.expanded.includes(encNo)
        ? state.expanded.filter((x) => x !== encNo)
        : [...state.expanded, encNo];
      redrawPanel();
      return;
    }
    if (act === 'post') return void await askPostCharges();
    if (act === 'pay') {
      const { openPaymentForm } = await import('./payment-form.js');
      return void await openPaymentForm({ mrn });
    }
    if (act === 'receipt') {
      const { openReceipt } = await import('./receipt-view.js');
      return void await openReceipt(e.target.closest('[data-receipt]').dataset.receipt);
    }
    if (act === 'apply-deposit' || act === 'refund-deposit') {
      const txId = e.target.closest('[data-tx]').dataset.tx;
      const actions = await import('./deposit-actions.js');
      return void await (act === 'apply-deposit' ? actions.askApply(txId) : actions.askRefund(txId));
    }
  });

  mount.addEventListener('change', (e) => {
    const el = e.target.closest('[data-filter]');
    if (!el || !(el.dataset.filter in state.tx)) return;
    state.tx = { ...state.tx, [el.dataset.filter]: el.value };
    redrawPanel();
  });

  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));
  draw();
}
