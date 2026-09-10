// The Exceptions tab: every exception the postings raised — kind, reference,
// amount, and the way out. An ambiguous or unmatched row is resolved on the
// grid (Choose / Match), an overpayment here with a reason and a role, and a
// residue is already resolved as unapplied cash the moment it is held.

import * as remittances from '../../../../data/repositories/remittances.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { dateTime, esc, usd } from '../../../../shared/format.js';
import { exceptionKindHtml, money } from './remittance-chips.js';

export function exceptionsHtml(rem) {
  const rows = rem.exceptions || [];
  if (!rows.length) {
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">verified</span></div>
        <div class="state-view__title">No exceptions</div>
        <p class="state-view__body">Every row matched, nothing was overpaid and the payment is fully accounted for.</p>
      </div>`;
  }
  const open = rows.filter((e) => !e.resolution);
  return `
    ${open.length ? `<div class="alert alert--warning"><span class="icon">priority_high</span><div><div class="title">${open.length} open</div>The remittance cannot be closed until each is resolved.</div></div>` : ''}
    <table class="tbl">
      <thead><tr><th>Id</th><th>Kind</th><th>Reference</th><th>Amount</th><th>Raised</th><th>Resolution</th><th>Action</th></tr></thead>
      <tbody>${rows.map((e) => `
        <tr data-exception="${esc(e.id)}">
          <td class="t-mono-sm">${esc(e.id)}</td>
          <td>${exceptionKindHtml(e.kind)}</td>
          <td class="t-mono-sm">${esc(e.ref)}${e.candidates?.length ? `<br><span class="t-body-sm">${e.candidates.length} candidates</span>` : ''}${
            e.lines?.length ? `<br><span class="t-body-sm">${esc(e.lines.join(', '))}</span>` : ''}</td>
          <td>${money(e.amount)}</td>
          <td class="t-body-sm">${e.at ? esc(dateTime(e.at)) : '—'}${e.postingId ? ` · ${esc(e.postingId)}` : ''}</td>
          <td>${e.resolution
            ? `<span class="badge badge--success"><span class="dot"></span>${esc(e.resolution.kind)}</span>${e.resolution.ref ? ` <span class="t-mono-sm">${esc(e.resolution.ref)}</span>` : ''}<br><span class="t-body-sm">${esc(e.resolution.by)} · ${esc(dateTime(e.resolution.at))}${e.resolution.reason ? ` — ${esc(e.resolution.reason)}` : ''}</span>`
            : '<span class="badge badge--critical"><span class="dot"></span>Open</span>'}</td>
          <td>${actionHtml(rem, e)}</td>
        </tr>`).join('')}</tbody>
    </table>`;
}

function actionHtml(rem, e) {
  if (e.resolution || rem.status === 'Closed') return '<span class="t-body-sm">—</span>';
  if (e.kind === 'AmbiguousMatch') return `<button class="btn btn--secondary btn--sm" data-act="choose" data-key="${esc(rowKey(rem, e))}"><span class="icon icon--sm">compare_arrows</span>Choose claim</button>`;
  if (e.kind === 'Unmatched') return `<button class="btn btn--secondary btn--sm" data-act="match" data-key="${esc(rowKey(rem, e))}"><span class="icon icon--sm">link</span>Match to claim</button>`;
  if (e.kind === 'Overpayment') return `<button class="btn btn--primary btn--sm" data-act="resolve-over" data-id="${esc(e.id)}"><span class="icon icon--sm">rule</span>Resolve</button>`;
  return '<span class="t-body-sm">—</span>';
}

/** The row an exception is about, by whatever key the grid addresses it with. */
const rowKey = (rem, e) => {
  const row = rem.claims.find((r) => r.payerClaimRef === e.ref || r.claimNo === e.ref || r.claimNo === e.claimNo);
  return row ? remittances.keyOf(row) : e.ref;
};

/** The overpayment dialog: refund the payer, apply as credit, or adjust — each with a reason, two of them role-gated. */
export async function resolveOverpayment(no, id) {
  const rem = remittances.get(no);
  const e = rem?.exceptions.find((x) => x.id === id);
  if (!e) return false;
  const role = currentRole();
  const options = [
    { kind: 'Refund to payer', icon: 'undo', allowed: role.canRefund, why: role.canRefund ? 'Send the excess back; the reference is the refund instruction' : 'Only the RCM coder and the CMO can refund' },
    { kind: 'Apply as credit', icon: 'account_balance_wallet', allowed: true, why: 'Hold the excess as unapplied cash for this payer' },
    { kind: 'Adjust', icon: 'tune', allowed: role.canAdjust, why: role.canAdjust ? 'Keep the excess — a correction written on with a reason' : 'Only the RCM coder and the CMO can adjust' },
  ];
  const dialog = modal.open({
    title: `Resolve ${e.id} — overpayment on ${e.ref}`,
    sub: `${usd(e.amount)} over the expected share${e.lines?.length ? ` on ${e.lines.join(', ')}` : ''}`,
    icon: 'rule',
    tone: 'warning',
    body: `
      <div class="segmented" role="group" aria-label="Resolution" id="ov-kind">
        ${options.map((o, i) => `<button type="button" data-kind="${esc(o.kind)}" aria-pressed="${i === 1}"${o.allowed ? '' : ' disabled'} title="${esc(o.why)}">
          <span class="icon icon--sm">${o.icon}</span>${esc(o.kind)}</button>`).join('')}
      </div>
      <p class="t-body-sm" id="ov-why">${esc(options[1].why)}</p>
      <div id="ov-ref-field" hidden>
        <div class="toolbar">
          <label class="field">
            <span class="icon icon--sm">tag</span>
            <input name="reference" id="ov-ref" placeholder="Refund reference" aria-label="Refund reference">
          </label>
        </div>
      </div>
      <label class="field field--area">
        <textarea id="ov-reason" rows="3" placeholder="Why — required" aria-label="Reason"></textarea>
      </label>
      <div class="field-error" id="ov-error" hidden></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" id="ov-save"><span class="icon icon--sm">check</span>Resolve</button>`,
  });
  let kind = options[1].kind;
  dialog.el.addEventListener('click', (e2) => {
    const btn = e2.target.closest('#ov-kind [data-kind]');
    if (btn && !btn.disabled) {
      kind = btn.dataset.kind;
      for (const b of dialog.el.querySelectorAll('#ov-kind [data-kind]')) b.setAttribute('aria-pressed', String(b === btn));
      dialog.el.querySelector('#ov-why').textContent = options.find((o) => o.kind === kind).why;
      dialog.el.querySelector('#ov-ref-field').hidden = kind !== 'Refund to payer';
      return;
    }
    if (!e2.target.closest('#ov-save')) return;
    const reason = dialog.el.querySelector('#ov-reason').value.trim();
    const box = dialog.el.querySelector('#ov-error');
    const { error } = remittances.resolveException(no, id, { kind, reason, reference: dialog.el.querySelector('#ov-ref').value.trim() });
    box.textContent = error;
    box.hidden = !error;
    if (error) return;
    toast(`${e.id} resolved — ${kind.toLowerCase()}`, 'success');
    dialog.close('done');
  });
  return (await dialog.closed) === 'done';
}
