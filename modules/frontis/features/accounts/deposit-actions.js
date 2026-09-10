// What becomes of a deposit: applied to charges, or given back. Both write a
// ledger row of their own rather than touching the deposit — money that was
// taken stays taken, and what happened to it is recorded beside it.

import * as accounts from '../../../../data/repositories/accounts.js';
import * as ledger from '../../../../data/repositories/ledger.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { date, esc, usd } from '../../../../shared/format.js';
import { METHODS } from './payment-form.js';

/** Apply what is left of a deposit to open charges — oldest first by default. */
export async function askApply(depositTxId) {
  const deposit = ledger.get(depositTxId);
  if (!deposit) return null;
  const held = accounts.deposits(deposit.patientMrn).find((d) => d.tx.id === depositTxId);
  if (!held) return null;

  const charges = accounts.openCharges(deposit.patientMrn);
  let selection = null;

  const sheet = modal.open({
    title: 'Apply deposit',
    sub: `${esc(held.receiptNo || deposit.id)} · ${esc(usd(held.remaining))} available`,
    icon: 'call_merge',
    size: 'lg',
    body: bodyHtml(),
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="apply"${charges.length ? '' : ' disabled'}>Apply</button>`,
  });

  function bodyHtml() {
    if (!charges.length) {
      return `<p class="t-body-sm">Nothing is outstanding on this account, so there is nothing to apply the
        deposit to. It can be refunded instead, or left held against a later charge.</p>`;
    }
    const proposal = propose(charges, held.remaining, selection);
    return `
      <div id="da-error"></div>
      <p class="t-body-sm">${esc(usd(held.remaining))} is available. It is put against the oldest charges
        first — tick to choose them yourself.</p>
      ${charges.map((charge) => {
    const picked = proposal.find((p) => p.chargeTxId === charge.txId);
    const checked = selection ? selection.includes(charge.txId) : Boolean(picked);
    return `
        <label class="rule-child-row">
          <input type="checkbox" data-charge="${esc(charge.txId)}"${checked ? ' checked' : ''}
                 aria-label="Apply to ${esc(charge.description)}">
          <span>
            <span class="t-mono-sm">${esc(charge.chargeCode)}</span> ${esc(charge.description)}
            <br><span class="t-body-sm">${esc(charge.encounterNo || 'no visit')} · ${esc(date(charge.at))} ·
              ${esc(usd(charge.remaining))} outstanding</span>
          </span>
          <span class="spacer"></span>
          <span class="t-mono-sm">${picked ? usd(picked.amount) : '—'}</span>
        </label>`;
  }).join('')}`;
  }

  sheet.el.addEventListener('change', (e) => {
    if (!e.target.closest('[data-charge]')) return;
    selection = [...sheet.el.querySelectorAll('[data-charge]')].filter((b) => b.checked).map((b) => b.dataset.charge);
    sheet.el.querySelector('.modal__body').innerHTML = bodyHtml();
  });

  sheet.el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="apply"]')) return;
    const result = accounts.applyDeposit(depositTxId, selection);
    if (result.error) {
      sheet.el.querySelector('#da-error').innerHTML =
        `<div class="alert alert--critical"><span class="icon">error</span><div>${esc(result.error)}</div></div>`;
      return;
    }
    sheet.close(result.tx);
    toast(`${usd(result.tx.amount)} applied from the deposit`);
  });

  return sheet.closed;
}

/** Give back what is left of a deposit. The reason is required and audited. */
export async function askRefund(depositTxId) {
  const deposit = ledger.get(depositTxId);
  if (!deposit) return null;
  const role = currentRole();
  if (!role.canRefund) {
    await modal.confirm({
      title: 'Refunding needs another role',
      body: `<p class="t-body">${esc(role.name)} cannot refund a deposit. A cashier supervisor or the CMO
        signs a refund off, because money leaving the hospital is a financial correction.</p>`,
      confirmLabel: 'Close',
      tone: 'refusal',
      icon: 'lock',
    });
    return null;
  }
  const held = accounts.deposits(deposit.patientMrn).find((d) => d.tx.id === depositTxId);
  if (!held) return null;

  const sheet = modal.open({
    title: 'Refund deposit',
    sub: `${esc(held.receiptNo || deposit.id)} · ${esc(usd(held.remaining))} to give back`,
    icon: 'undo',
    tone: 'warning',
    body: `
      <div id="dr-error"></div>
      <p class="t-body-sm">The whole remaining balance of ${esc(usd(held.remaining))} is refunded and a
        receipt is issued for it. What has already been applied to a charge stays applied.</p>
      <label class="field field--area">
        <span class="icon icon--sm">edit_note</span>
        <textarea rows="3" data-field="reason" placeholder="Why is it being refunded?"
                  aria-label="Reason"></textarea>
      </label>
      <div class="toolbar">
        <label class="field">
          <span class="icon icon--sm">account_balance</span>
          <select data-field="method" aria-label="Method">
            ${METHODS.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}
          </select>
        </label>
        <label class="field field--grow">
          <span class="icon icon--sm">tag</span>
          <input type="text" data-field="reference" placeholder="Reference" aria-label="Reference">
        </label>
      </div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="refund">Refund ${esc(usd(held.remaining))}</button>`,
  });

  sheet.el.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-act="refund"]')) return;
    const read = (field) => sheet.el.querySelector(`[data-field="${field}"]`).value;
    const result = accounts.refundDeposit(depositTxId, {
      reason: read('reason'), method: read('method'), reference: read('reference'),
    });
    if (result.error) {
      sheet.el.querySelector('#dr-error').innerHTML =
        `<div class="alert alert--critical"><span class="icon">error</span><div>${esc(result.error)}</div></div>`;
      return;
    }
    sheet.close(result.tx);
    toast(`${usd(result.tx.amount)} refunded — receipt ${result.receipt?.receiptNo || ''}`);
    const { openReceipt } = await import('./receipt-view.js');
    await openReceipt(result.receipt?.receiptNo);
  });

  return sheet.closed;
}

/** The same oldest-first proposal the repository runs, for the preview. */
function propose(charges, amount, selection) {
  const targets = selection ? charges.filter((c) => selection.includes(c.txId)) : charges;
  let left = amount;
  const out = [];
  for (const charge of targets) {
    if (left <= 0) break;
    const value = Math.min(left, charge.remaining);
    out.push({ chargeTxId: charge.txId, amount: Math.round(value * 100) / 100 });
    left -= value;
  }
  return out;
}
