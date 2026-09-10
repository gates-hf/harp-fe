// The sessions panel on the day's report: every drawer opened on the day
// with its totals per method, its receipts, its variance and who
// countersigned, Close session on the open ones and Open session in the
// header. Drawn from the report's session summaries (frozen with the rest on
// a closed day) and read-only once the day is closed.

import * as cashSessions from '../../../../data/repositories/cash-sessions.js';
import { open as openModal } from '../../../../shared/modal.js';
import { open as openDrawer } from '../../../../shared/drawer.js';
import { toast } from '../../../../shared/toast.js';
import { ROLES, current as currentRole } from '../../../../shared/roles.js';
import { dateTime, esc, usd } from '../../../../shared/format.js';
import { moneyHtml, sessionStatusHtml, varianceHtml } from './dtr-chips.js';
import { listHtml } from './dtr-drill.js';
import { NIGHT_CASHIER } from '../../../../data/seed/cash-sessions.js';

export function sessionsPanelHtml(report, { live = false } = {}) {
  const rows = report.sessions;
  const open = rows.filter((s) => s.status === 'Open').length;
  return `
    <div class="panel" id="dtr-sessions">
      <div class="panel-header">
        <span>Cash sessions</span>
        <span class="badge${open ? ' badge--info' : ''}" title="${open} open, ${rows.length - open} closed">${rows.length}${open ? ` · ${open} open` : ''}</span>
        <span class="icon icon--sm" tabindex="0" role="img" aria-label="How a session works"
              title="A receipt joins its cashier’s open session the moment it is taken. Closing a session counts the drawer per method against the system; a variance needs a reason and, above the threshold, a countersignature. A closed session is immutable and its receipts are locked.">info</span>
        <span class="spacer"></span>
        <button class="btn btn--primary btn--sm" data-act="open-session"${live ? '' : ' disabled title="The day is closed — no session can open on it"'}>
          <span class="icon icon--sm">add</span>Open session
        </button>
      </div>
      <div class="panel-body">
        ${rows.length ? tableHtml(rows, live) : `
          <div class="state-view">
            <div class="state-view__glyph"><span class="icon">point_of_sale</span></div>
            <div class="state-view__title">No session on this day</div>
            <p class="state-view__body">A receipt taken with no session open stays loose, and the cash-integrity check names it.</p>
          </div>`}
      </div>
    </div>`;
}

function tableHtml(rows, live) {
  return `
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">Session</th>
          <th scope="col">Cashier</th>
          <th scope="col">Status</th>
          <th scope="col" class="num">Receipts</th>
          ${cashSessions.METHODS.map((m) => `<th scope="col" class="num">${esc(m)}</th>`).join('')}
          <th scope="col" class="num">Declared</th>
          <th scope="col">Variance</th>
          <th scope="col"></th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((s) => `
          <tr data-session="${esc(s.id)}">
            <td><span class="t-mono-sm">${esc(s.id)}</span><br><span class="t-body-sm">${dateTime(s.openedAt)}${s.closedAt ? ` → ${dateTime(s.closedAt)}` : ''}</span></td>
            <td>${esc(s.cashier)}</td>
            <td>${sessionStatusHtml(s.status)}</td>
            <td class="num t-mono-sm">${s.receipts}</td>
            ${cashSessions.METHODS.map((m) => `<td class="num">${moneyHtml(s.systemTotals?.[m], { zero: '—' })}</td>`).join('')}
            <td class="num">${s.declared ? moneyHtml(cashSessions.totalOf(s.declared), { zero: usd(0) }) : '<span class="t-body-sm">not yet</span>'}</td>
            <td>${s.variance ? `${varianceHtml(s.variance.total)}${s.countersign ? `<br><span class="t-body-sm" title="${esc(s.varianceReason || '')}">countersigned by ${esc(s.countersign.by)}</span>` : s.varianceReason ? `<br><span class="t-body-sm">${esc(s.varianceReason)}</span>` : ''}` : '—'}</td>
            <td>
              <button class="btn btn--ghost btn--sm" data-act="view-session" data-session="${esc(s.id)}"><span class="icon icon--sm">receipt_long</span>Receipts</button>
              ${s.status === 'Open' ? `<button class="btn btn--secondary btn--sm" data-act="close-session" data-session="${esc(s.id)}"${live ? '' : ' disabled title="The day is closed"'}><span class="icon icon--sm">lock</span>Close session</button>` : '<span class="badge" title="A closed session is never edited"><span class="icon icon--sm">lock</span>Locked</span>'}
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

/** The receipts on one session, in the drawer. */
export function openSessionReceipts(id) {
  const s = cashSessions.get(id);
  if (!s) return;
  const txs = cashSessions.receiptsOf(s).map((r) => ({
    id: r.id, at: r.at, amount: r.amount * (r.type === 'Refund' || r.type === 'DepositRefund' ? -1 : 1),
    label: `${r.type} · ${r.detail?.receiptNo || r.id}`, sub: `${r.detail?.method || ''} · ${r.patientMrn}`,
    href: `#/frontis/accounts/${r.patientMrn}`, priorDay: Boolean(r.priorDay),
  }));
  openDrawer({
    title: `${s.id} · ${s.cashier}`,
    sub: `${s.status}${s.closedAt ? ` · closed ${dateTime(s.closedAt)}` : ` · open since ${dateTime(s.openedAt)}`}${s.variance ? ` · variance ${usd(s.variance.total)}` : ''}`,
    icon: 'point_of_sale',
    body: `${s.varianceReason ? `<div class="alert alert--warning"><span class="icon">notes</span><div>${esc(s.varianceReason)}${s.countersign ? `<br><span class="t-body-sm">Countersigned by ${esc(s.countersign.by)} · ${dateTime(s.countersign.at)}</span>` : ''}</div></div>` : ''}${listHtml(txs)}`,
  });
}

/** Open a session: for the signed-in user, or for a named cashier. Resolves true when one opened. */
export async function openNewSession(date) {
  const me = currentRole().name;
  const names = [...new Set([me, ...ROLES.map((r) => r.name), NIGHT_CASHIER])];
  const dialog = openModal({
    title: 'Open a cash session',
    sub: date,
    icon: 'point_of_sale',
    size: 'sm',
    body: `
      <p class="modal__lede">Receipts the cashier takes from now on attach to this session.</p>
      <div class="toolbar">
        <label class="field field--grow">
          <span class="icon icon--sm">person</span>
          <select id="os-cashier" aria-label="Cashier">${names.map((n) => `<option value="${esc(n)}"${n === me ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
        </label>
      </div>
      <div id="os-error"></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="open">Open session</button>`,
  });
  dialog.el.addEventListener('click', (e) => {
    if (e.target.closest('[data-act]')?.dataset.act !== 'open') return;
    const cashier = dialog.el.querySelector('#os-cashier').value;
    const { error, session } = cashSessions.open(cashier, date);
    if (error) {
      dialog.el.querySelector('#os-error').innerHTML = `<div class="alert alert--critical"><span class="icon">error</span><div>${esc(error)}</div></div>`;
      return;
    }
    toast(`${session.id} opened for ${session.cashier}`);
    dialog.close('opened');
  });
  return (await dialog.closed) === 'opened';
}
