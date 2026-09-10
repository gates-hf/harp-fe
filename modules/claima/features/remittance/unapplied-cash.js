// Unapplied cash at #/claima/remittances/unapplied — money payers sent that
// no claim accounts for, by payer: the remittance it came from, the amount,
// how long it has waited (red past the config's days), and the three ways
// out. Every movement is audited under the row; the trail opens beside it.

import * as unapplied from '../../../../data/repositories/unapplied.js';
import * as drawer from '../../../../shared/drawer.js';
import { metricRailHtml, metricKey } from '../../../../shared/metric-card.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { dateTime, esc, usd } from '../../../../shared/format.js';
import { payerName } from './remittance-chips.js';
import { askApply, askResolve } from './unapplied-actions.js';

export const meta = { title: 'Unapplied cash' };

export async function render(mount, ctx) {
  const res = await fetch(new URL('./unapplied-cash.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load unapplied-cash.html (${res.status})`);
  mount.innerHTML = await res.text();

  ctx.setHeader('Unapplied cash');
  ctx.setCrumb([
    { label: 'Claima', path: '/claima/remittances' },
    { label: 'Remittances', path: '/claima/remittances' },
    { label: 'Unapplied cash' },
  ]);

  const state = { scope: 'Held', overdue: false };
  const $ = (sel) => mount.querySelector(sel);

  function draw() {
    const c = unapplied.counts();
    $('#uc-metrics').innerHTML = metricRailHtml([
      { value: usd(c.heldAmount), label: 'Held', key: 'held', pressed: state.scope === 'Held' && !state.overdue,
        sub: `${c.held} row${c.held === 1 ? '' : 's'} over ${c.payers} payer${c.payers === 1 ? '' : 's'}`,
        title: 'Cash still held — select to list it' },
      { value: c.overdue, label: `Over ${unapplied.warnDays()} days`, key: c.overdue ? 'overdue' : '', pressed: c.overdue ? state.overdue : undefined,
        tone: c.overdue ? 'critical' : '', sub: 'held longer than the warning',
        title: `Rows held longer than ${unapplied.warnDays()} days${c.overdue ? ' — select to list them' : ''}` },
      { value: c.total - c.held, label: 'Resolved', key: 'resolved', pressed: state.scope === '' && !state.overdue,
        sub: 'applied, refunded or adjusted', title: 'Every row, resolved ones included — select to list them all' },
    ]);
    for (const btn of mount.querySelectorAll('[data-scope]')) btn.setAttribute('aria-pressed', String(btn.dataset.scope === state.scope));
    drawBody();
  }

  function drawBody() {
    const role = currentRole();
    let groups = unapplied.byPayer({ status: state.scope });
    if (state.overdue) groups = groups.map((g) => ({ ...g, rows: g.rows.filter(unapplied.isOverdue) })).filter((g) => g.rows.length);
    const body = $('#uc-body');
    if (!groups.length) {
      body.innerHTML = `
        <div class="state-view">
          <div class="state-view__glyph"><span class="icon">account_balance_wallet</span></div>
          <div class="state-view__title">${state.overdue ? 'Nothing held too long' : state.scope ? 'No cash held' : 'Nothing recorded'}</div>
          <p class="state-view__body">Cash lands here when a posted remittance carries more than its claims account for. Each row is applied to a claim, refunded to the payer or adjusted, and the trail records which.</p>
        </div>`;
      return;
    }
    body.innerHTML = groups.map((g) => `
      <details open>
        <summary class="panel-header">
          <span>${esc(payerName(g.payerId))}</span>
          <span class="badge">${g.rows.length}</span>
          <span class="spacer"></span>
          ${g.held ? `<span class="t-mono-sm">${esc(usd(g.held))} held</span>` : ''}
        </summary>
        <table class="tbl">
          <thead><tr><th>Row</th><th>Remittance</th><th>Amount</th><th>Since</th><th>Age</th><th>Status</th><th>Resolution</th><th>Actions</th></tr></thead>
          <tbody>${g.rows.map((r) => rowHtml(r, role)).join('')}</tbody>
        </table>
      </details>`).join('');
  }

  function rowHtml(r, role) {
    const age = unapplied.ageDays(r);
    const held = r.status === 'Held';
    const overdue = unapplied.isOverdue(r);
    return `
      <tr data-id="${esc(r.id)}">
        <td class="t-mono-sm">${esc(r.id)}</td>
        <td><a class="crumb-link t-mono-sm" href="#/claima/remittances/${esc(r.remittanceNo)}">${esc(r.remittanceNo)}</a></td>
        <td class="t-mono-sm">${esc(usd(r.amount))}</td>
        <td class="t-body-sm">${esc(dateTime(r.since))}</td>
        <td><span class="badge${overdue ? ' badge--critical' : age > unapplied.warnDays() / 2 && held ? ' badge--warning' : ''}" title="${held ? 'Days held' : 'Days from held to resolved'}">${age} d</span></td>
        <td><span class="badge badge--${held ? 'warning' : 'success'}"><span class="dot"></span>${esc(r.status)}</span></td>
        <td class="t-body-sm">${r.resolution
          ? `${esc(r.resolution.kind)}${r.resolution.ref ? ` · <span class="t-mono-sm">${esc(r.resolution.ref)}</span>` : ''}<br>${esc(r.resolution.by)} · ${esc(dateTime(r.resolution.at))}${r.resolution.reason ? ` — ${esc(r.resolution.reason)}` : ''}`
          : '—'}</td>
        <td>
          ${held ? `
            ${action('apply', 'input', true, 'Apply to a claim of this payer')}
            ${action('refund', 'undo', role.canRefund, role.canRefund ? 'Refund to the payer — with a reason' : 'Only the RCM coder and the CMO can refund')}
            ${action('adjust', 'tune', role.canAdjust, role.canAdjust ? 'Adjust — keep it, with a reason' : 'Only the RCM coder and the CMO can adjust')}` : ''}
          ${action('history', 'history', true, 'View history')}
        </td>
      </tr>`;
  }

  const action = (act, icon, allowed, why) => `
    <button class="btn btn--ghost btn--icon btn--sm" data-act="${act}"${allowed ? '' : ' disabled'} title="${esc(why)}">
      <span class="icon icon--sm">${icon}</span></button>`;

  function openHistory(id) {
    const row = unapplied.get(id);
    const entries = unapplied.history(id);
    drawer.open({
      title: `History — ${row.id}`,
      sub: `${usd(row.amount)} from ${row.remittanceNo} · append-only`,
      icon: 'history',
      body: entries.length ? `<ol class="journey">${entries.map((e) => `
        <li class="journey__row">
          <span class="journey__at t-mono-sm">${dateTime(e.at)}</span>
          <span class="journey__action">${esc(e.action)}</span>
          <span class="journey__actor">${esc(e.user)}</span>
          <span class="journey__detail">${esc(e.details || '')}</span>
        </li>`).join('')}</ol>` : '<p class="t-body">Nothing recorded yet.</p>',
    });
  }

  mount.addEventListener('click', async (e) => {
    if (e.target.closest('a')) return;
    const kpi = metricKey(e);
    if (kpi) {
      if (kpi === 'overdue') { state.overdue = !state.overdue; state.scope = 'Held'; }
      else { state.overdue = false; state.scope = kpi === 'resolved' ? '' : 'Held'; }
      return draw();
    }
    const scope = e.target.closest('[data-scope]');
    if (scope) { state.scope = scope.dataset.scope; state.overdue = false; return draw(); }
    const btn = e.target.closest('[data-act]');
    const tr = e.target.closest('tr[data-id]');
    if (!btn || !tr) return undefined;
    if (btn.closest('summary')) e.preventDefault();
    const id = tr.dataset.id;
    if (btn.dataset.act === 'apply') return void (await askApply(id));
    if (btn.dataset.act === 'refund') return void (await askResolve(id, 'Refunded'));
    if (btn.dataset.act === 'adjust') return void (await askResolve(id, 'Adjusted'));
    if (btn.dataset.act === 'history') return openHistory(id);
    return undefined;
  });

  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));
  draw();
}
