// Closing a cash session: the system totals per method beside the declared
// count, the variance recomputed as the count is typed, the reason a variance
// needs, and the countersignature one past the threshold needs — from a
// second person, picked from the roles that hold the right (the demo's role
// switcher, in a select), never the cashier and never the closer.

import * as cashSessions from '../../../../data/repositories/cash-sessions.js';
import { open as openModal } from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { dateTime, esc, usd } from '../../../../shared/format.js';
import { varianceHtml } from './dtr-chips.js';

/** openCloseSession(id) → Promise<boolean> — whether the session closed. */
export async function openCloseSession(id) {
  const session = cashSessions.get(id);
  if (!session || session.status !== 'Open') return false;
  const closer = currentRole();
  const system = cashSessions.systemTotals(session);
  const signers = cashSessions.countersigners([session.cashier, closer.name]);
  const receipts = cashSessions.receiptsOf(session);

  const dialog = openModal({
    title: `Close session ${session.id}`,
    sub: `${session.cashier} · opened ${dateTime(session.openedAt)} · ${receipts.length} receipt${receipts.length === 1 ? '' : 's'}`,
    icon: 'point_of_sale',
    size: 'lg',
    body: `
      <p class="modal__lede">Count the drawer per method. The system side is the sum of the receipts attached to this session; a variance needs a reason, and one above ${esc(usd(cashSessions.threshold()))} a countersignature.</p>
      <table class="tbl">
        <thead>
          <tr>
            <th scope="col">Method</th>
            <th scope="col" class="num">System</th>
            <th scope="col" class="num">Declared</th>
            <th scope="col" class="num">Variance</th>
          </tr>
        </thead>
        <tbody>
          ${cashSessions.METHODS.map((m) => `
            <tr>
              <td>${esc(m)}</td>
              <td class="num t-mono-sm">${esc(usd(system[m] || 0))}</td>
              <td class="num">
                <label class="field"><input type="number" step="0.01" min="0" data-method="${esc(m)}" value="${system[m] || 0}" aria-label="Declared ${esc(m)}"></label>
              </td>
              <td class="num" data-variance="${esc(m)}">${varianceHtml(0)}</td>
            </tr>`).join('')}
          <tr>
            <th scope="row">Total</th>
            <td class="num t-mono-sm">${esc(usd(cashSessions.totalOf(system)))}</td>
            <td class="num t-mono-sm" id="scd-declared">${esc(usd(cashSessions.totalOf(system)))}</td>
            <td class="num" id="scd-total">${varianceHtml(0)}</td>
          </tr>
        </tbody>
      </table>
      <div class="toolbar">
        <label class="field field--area field--grow">
          <span class="icon icon--sm">notes</span>
          <textarea id="scd-reason" rows="2" placeholder="Why the count differs (required for any variance)" aria-label="Variance reason"></textarea>
        </label>
      </div>
      <!-- A plain wrapper carries hidden: .toolbar sets its own display, which outranks the attribute. -->
      <div id="scd-sign" hidden>
        <div class="toolbar">
          <label class="field">
            <span class="icon icon--sm">how_to_reg</span>
            <select id="scd-countersign" aria-label="Countersigned by">
              <option value="">Countersigned by…</option>
              ${signers.map((r) => `<option value="${esc(r.name)}">${esc(r.name)} — ${esc(r.title)}</option>`).join('')}
            </select>
          </label>
          <span class="t-body-sm">A variance above ${esc(usd(cashSessions.threshold()))} needs a second person with countersign rights — not the cashier, not ${esc(closer.name)}.</span>
        </div>
      </div>
      <div id="scd-error"></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="close-session">Close session</button>`,
  });

  const el = dialog.el;
  const form = () => ({
    declared: Object.fromEntries(cashSessions.METHODS.map((m) => [m, el.querySelector(`[data-method="${m}"]`).value])),
    reason: el.querySelector('#scd-reason').value,
    countersignBy: el.querySelector('#scd-countersign').value,
  });

  function recompute() {
    const f = form();
    const v = cashSessions.varianceOf(session, f.declared);
    for (const m of cashSessions.METHODS) el.querySelector(`[data-variance="${m}"]`).innerHTML = varianceHtml(v[m]);
    el.querySelector('#scd-total').innerHTML = varianceHtml(v.total);
    el.querySelector('#scd-declared').textContent = usd(cashSessions.totalOf(f.declared));
    el.querySelector('#scd-sign').hidden = Math.abs(v.total) <= cashSessions.threshold();
    el.querySelector('#scd-error').innerHTML = '';
  }

  el.addEventListener('input', recompute);
  el.addEventListener('change', recompute);
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-act]')?.dataset.act !== 'close-session') return;
    const why = cashSessions.closeBlocker(session, form(), closer.name);
    if (why) {
      el.querySelector('#scd-error').innerHTML = `<div class="alert alert--critical"><span class="icon">error</span><div>${esc(why)}</div></div>`;
      return;
    }
    const { error, session: closed } = cashSessions.close(session.id, form());
    if (error) {
      el.querySelector('#scd-error').innerHTML = `<div class="alert alert--critical"><span class="icon">error</span><div>${esc(error)}</div></div>`;
      return;
    }
    toast(`${closed.id} closed — variance ${closed.variance.total === 0 ? 'exact' : usd(closed.variance.total)}${closed.countersign ? `, countersigned by ${closed.countersign.by}` : ''}`);
    dialog.close('closed');
  });

  return (await dialog.closed) === 'closed';
}
