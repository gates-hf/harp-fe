// The remittance page at #/claima/remittances/<no>, and any tab id after it:
// the payment and its status, the match & reconcile grid with Post, the
// exceptions and their way out, the postings with Reverse, the stored file
// and the trail. Each tab draws into a node of its own inside the panel, so a
// tab that owns buttons binds its listener there and it retires when the tab
// is redrawn.

import * as remittances from '../../../../data/repositories/remittances.js';
import * as unapplied from '../../../../data/repositories/unapplied.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { date, dateTime, esc, usd } from '../../../../shared/format.js';
import { capturedHtml, matchSummary, payerName, statusHtml } from './remittance-chips.js';
import { gridHtml } from './reconcile-grid.js';
import { chooseClaim } from './matcher.js';
import { exceptionsHtml, resolveOverpayment } from './exceptions-panel.js';
import { askReverse, fileHtml, postingsHtml } from './postings-tab.js';
import { historyHtml } from './remittance-history.js';
import { askPost } from './post-dialog.js';

export const meta = { title: 'Remittance' };

const TABS = [
  { id: 'reconcile', label: 'Match & reconcile' },
  { id: 'exceptions', label: 'Exceptions' },
  { id: 'postings', label: 'Postings' },
  { id: 'file', label: 'File' },
  { id: 'history', label: 'History' },
];

export async function render(mount, ctx) {
  const no = ctx.params[0];
  if (!remittances.get(no)) throw new Error(`No remittance ${no}`);

  const res = await fetch(new URL('./remittance-view.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load remittance-view.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { tab: TABS.some((t) => t.id === ctx.params[1]) ? ctx.params[1] : 'reconcile', filter: 'all' };
  const $ = (sel) => mount.querySelector(sel);

  function draw() {
    const rem = remittances.get(no);
    if (!rem) return;
    ctx.setHeader(`${rem.remittanceNo} — ${payerName(rem.payerId)}`);
    ctx.setCrumb([
      { label: 'Claima', path: '/claima/remittances' },
      { label: 'Remittances', path: '/claima/remittances' },
      { label: rem.remittanceNo },
    ]);
    $('#rv-no').textContent = rem.remittanceNo;
    $('#rv-meta').innerHTML = metaHtml(rem);
    $('#rv-actions').innerHTML = actionsHtml(rem);
    $('#rv-banners').innerHTML = bannersHtml(rem);
    $('#rv-summary').innerHTML = summaryHtml(rem);
    const tabs = TABS.filter((t) => t.id !== 'file' || rem.capture.mode === 'File');
    if (!tabs.some((t) => t.id === state.tab)) state.tab = 'reconcile';
    $('#rv-tabs').innerHTML = tabs.map((t) => `
      <button class="sections__tab${t.id === state.tab ? ' is-active' : ''}" role="tab" aria-selected="${t.id === state.tab}" data-tab="${t.id}">
        ${t.label}${tabCount(rem, t.id)}
      </button>`).join('');
    $('#rv-panel-title').textContent = tabs.find((t) => t.id === state.tab)?.label || '';
    drawPanel(rem);
  }

  function tabCount(rem, tab) {
    const n = tab === 'reconcile' ? rem.claims.length
      : tab === 'exceptions' ? remittances.openExceptions(rem).length
        : tab === 'postings' ? rem.postings.length
          : tab === 'file' ? (rem.capture.parseReport?.failed || []).length : 0;
    return n ? ` <span class="badge${tab === 'exceptions' ? ' badge--critical' : ''}">${n}</span>` : '';
  }

  function drawPanel(rem) {
    const panel = $('#rv-panel');
    const host = document.createElement('div');
    panel.replaceChildren(host);
    if (state.tab === 'exceptions') host.innerHTML = exceptionsHtml(rem);
    else if (state.tab === 'postings') host.innerHTML = postingsHtml(rem);
    else if (state.tab === 'file') host.innerHTML = fileHtml(rem);
    else if (state.tab === 'history') host.innerHTML = historyHtml(rem.remittanceNo, state.filter);
    else host.innerHTML = gridHtml(rem);
  }

  function metaHtml(rem) {
    return `
      <span class="t-mono-sm">${esc(rem.remittanceNo)}</span>
      ${statusHtml(rem)}
      <span>·</span>
      <span>${esc(payerName(rem.payerId))}</span>
      <span>·</span>
      <span class="t-mono-sm">${esc(rem.payment.reference)}</span>
      <span class="t-body-sm">${esc(date(rem.payment.date))} · ${esc(rem.payment.method)} · ${esc(usd(rem.payment.total))}</span>
      <span>·</span>
      <span class="t-body-sm">${esc(matchSummary(rem))}</span>`;
  }

  function actionsHtml(rem) {
    if (rem.status === 'Closed') return `<span class="badge badge--success" title="Closed ${esc(dateTime(rem.closedAt))}"><span class="dot"></span>Closed</span>`;
    const plan = remittances.planFor(rem);
    const postable = !plan.blocked && plan.entries.length > 0;
    const blocker = remittances.closeBlocker(rem);
    const unposted = remittances.unpostedRows(rem).length;
    return `
      ${unposted ? `<a class="btn btn--secondary btn--sm" href="#/claima/remittances/new?no=${esc(rem.remittanceNo)}" title="Enter or correct the payer's answer on the rows not yet posted">
        <span class="icon icon--sm">edit_note</span>Enter lines</a>` : ''}
      <button class="btn btn--primary btn--sm" data-act="post"${postable ? '' : ' disabled'} title="${esc(postable
        ? `Post ${plan.entries.length} claim${plan.entries.length === 1 ? '' : 's'} — the rest wait as exceptions`
        : plan.blocked || (unposted ? 'No row is ready — match the rows first' : 'Everything is posted'))}">
        <span class="icon icon--sm">publish</span>Post${plan.entries.length ? ` (${plan.entries.length})` : ''}</button>
      <button class="btn btn--secondary btn--sm" data-act="close"${blocker ? ' disabled' : ''} title="${esc(blocker || 'Close — everything posted, nothing open')}">
        <span class="icon icon--sm">lock</span>Close</button>`;
  }

  function bannersHtml(rem) {
    const out = [];
    const open = remittances.openExceptions(rem);
    const c = remittances.control(rem);
    if (rem.status === 'Unposted' && c.over) {
      out.push(alert('critical', 'error', `Over by ${usd(c.over)}`, 'The rows say more was paid than the payment carries. Posting is blocked until the lines or the total are corrected.'));
    }
    if (open.length) {
      out.push(alert('warning', 'priority_high', `${open.length} exception${open.length === 1 ? '' : 's'} open`,
        `${open.map((e) => `${e.kind === 'AmbiguousMatch' ? 'Ambiguous match' : e.kind} on ${e.ref} (${usd(e.amount)})`).join(' · ')}. Resolve each on the Exceptions tab; the remittance closes once none is open.`));
    }
    const held = unapplied.byRemittance(rem.remittanceNo).filter((r) => r.status === 'Held');
    if (held.length) {
      out.push(alert('info', 'account_balance_wallet', `${usd(held.reduce((n, r) => n + r.amount, 0))} held as unapplied cash`,
        'Cash on this payment that no claim accounts for. Apply it to a claim, refund it or adjust it on the unapplied cash screen.',
        '<a class="btn btn--secondary btn--sm" href="#/claima/remittances/unapplied"><span class="icon icon--sm">open_in_new</span>Unapplied cash</a>'));
    }
    return out.join('');
  }

  const alert = (tone, icon, title, body, action = '') => `
    <div class="alert alert--${tone}">
      <span class="icon">${icon}</span>
      <div><div class="title">${esc(title)}</div>${esc(body)}</div>
      ${action ? `<span class="spacer"></span>${action}` : ''}
    </div>`;

  function summaryHtml(rem) {
    const c = remittances.control(rem);
    const live = remittances.livePostings(rem);
    return `
      <dl class="dl dl--narrow">
        <dt>Payer</dt><dd>${esc(payerName(rem.payerId))}</dd>
        <dt>Payment</dt><dd><span class="t-mono-sm">${esc(rem.payment.reference)}</span><br><span class="t-body-sm">${esc(date(rem.payment.date))} · ${esc(rem.payment.method)}</span></dd>
        <dt>Total</dt><dd><span class="t-mono-sm">${esc(usd(c.total))}</span></dd>
        <dt>On the rows</dt><dd><span class="t-mono-sm">${esc(usd(c.paid))}</span> paid<br><span class="t-body-sm">${esc(usd(c.adjusted))} adjusted · ${esc(usd(c.denied))} denied</span></dd>
        <dt>Unapplied</dt><dd><span class="t-mono-sm">${esc(usd(c.unapplied))}</span></dd>
        <dt>Status</dt><dd>${statusHtml(rem)}${rem.postedAt ? `<br><span class="t-body-sm">posted ${esc(dateTime(rem.postedAt))}</span>` : ''}${rem.closedAt ? `<br><span class="t-body-sm">closed ${esc(dateTime(rem.closedAt))}</span>` : ''}</dd>
        <dt>Claims</dt><dd>${rem.claims.length} row${rem.claims.length === 1 ? '' : 's'}<br><span class="t-body-sm">${esc(matchSummary(rem))} · ${rem.claims.filter((r) => r.posted).length} posted</span></dd>
        <dt>Postings</dt><dd>${live.length} stand${rem.postings.length > live.length ? `<br><span class="t-body-sm">${rem.postings.length - live.length} reversed or reversal</span>` : ''}</dd>
        <dt>Captured</dt><dd>${capturedHtml(rem)}</dd>
        <dt>Tolerance</dt><dd class="t-body-sm">${esc(remittances.toleranceLabel(remittances.toleranceOf(rem.payerId)))} under the expected line before a hand-off</dd>
      </dl>`;
  }

  // --- events ---------------------------------------------------------------

  mount.addEventListener('click', async (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { state.tab = tab.dataset.tab; return draw(); }
    const chip = e.target.closest('[data-filter]');
    if (chip && state.tab === 'history') { state.filter = chip.dataset.filter; return draw(); }
    const btn = e.target.closest('[data-act]');
    if (!btn) return undefined;
    // A button inside a <summary> would also fold the row.
    if (btn.closest('summary')) e.preventDefault();
    const act = btn.dataset.act;
    if (act === 'post') return void (await askPost(no));
    if (act === 'close') return askClose();
    if (act === 'choose' || act === 'match') return void (await chooseClaim(no, btn.dataset.key));
    if (act === 'remove') return removeRow(btn.dataset.key);
    if (act === 'resolve-over') return void (await resolveOverpayment(no, btn.dataset.id));
    if (act === 'reverse') return void (await askReverse(no, btn.dataset.id));
    return undefined;
  });

  async function askClose() {
    const rem = remittances.get(no);
    const ok = await modal.confirm({
      title: `Close ${rem.remittanceNo}`,
      body: `${remittances.livePostings(rem).length} posting${remittances.livePostings(rem).length === 1 ? '' : 's'} stand, no exception is open and ${usd(rem.payment.total)} is accounted for. A closed remittance is not posted or reversed again.`,
      confirmLabel: 'Close remittance', tone: 'warning', icon: 'lock',
    });
    if (!ok) return;
    const { error } = remittances.close(no);
    if (error) toast(error, 'critical'); else toast(`${rem.remittanceNo} closed`, 'success');
  }

  async function removeRow(key) {
    const ok = await modal.confirm({
      title: 'Take this row off the remittance?',
      body: 'Its cash is no longer attributed to any claim and becomes residue — unapplied cash when the remittance is posted.',
      confirmLabel: 'Remove row', tone: 'critical', icon: 'delete',
    });
    if (!ok) return;
    remittances.removeClaim(no, key);
    toast('Row removed', 'info');
  }

  ctx.onData(draw);
  draw();
}
