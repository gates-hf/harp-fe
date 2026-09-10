// The three money corrections a desk makes without a charge or a payment
// moving: an amount adjusted off one charge's patient portion, an unallocated
// payment given back with a voucher, and an excess the patient agrees to leave
// on the account. Each is one dialog that validates, writes through
// data/repositories/accounts.js and says what it did; the screens redraw on
// the commit. The role gates read the same sentence the repository refuses
// with, so a disabled button and a refused save never disagree.

import * as accounts from '../../../../data/repositories/accounts.js';
import { paymentCredit } from '../../../../data/engines/account-engine.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { date, esc, usd } from '../../../../shared/format.js';
import { METHODS } from './payment-form.js';

const errorHtml = (text) => (text ? `<div class="alert alert--critical"><span class="icon">error</span><div>${esc(text)}</div></div>` : '');
const options = (list, selected = '') => list.map((v) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(v)}</option>`).join('');

async function refuse(title, body) {
  await modal.confirm({ title, body: `<p class="t-body">${body}</p>`, confirmLabel: 'Close', tone: 'refusal', icon: 'lock' });
  return null;
}

/**
 * askAdjust({ mrn, encounterNo, chargeTxId, amount, reason }) → the row or
 * null. The charge is picked from the account's open ones (narrowed to the
 * visit when one is named), and the amount can never exceed what is left on it.
 */
export async function askAdjust({ mrn, encounterNo = '', chargeTxId = '', amount = '', reason = '' } = {}) {
  const role = currentRole();
  if (!role.canAdjust) {
    return refuse('Adjusting needs another role',
      `${esc(role.name)} cannot write an amount off a charge. The RCM coder or the CMO signs an adjustment, because money let go is a financial correction.`);
  }
  const charges = accounts.openCharges(mrn, encounterNo);
  if (!charges.length) return refuse('Nothing to adjust', 'Every charge on this account has been answered — there is no patient portion left to write off.');
  const state = { chargeTxId: chargeTxId || charges[0].txId, amount: '', reason: reason || accounts.ADJUSTMENT_REASONS[0], note: '' };
  const chosen = () => charges.find((c) => c.txId === state.chargeTxId) || charges[0];
  // A residual handed in by the settlement panel is capped at what the chosen
  // charge still carries: an adjustment is against one charge, not a visit.
  const cap = (n) => String(Math.min(Number(n) || 0, chosen().remaining) || '');
  state.amount = amount ? cap(amount) : '';

  const dialog = modal.open({
    title: 'Adjust a charge',
    sub: `${esc(mrn)}${encounterNo ? ` · ${esc(encounterNo)}` : ''}`,
    icon: 'price_change',
    tone: 'warning',
    size: 'md',
    body: `
      <div id="aj-error"></div>
      <p class="modal__lede">An Adjustment row against one charge, reducing what the patient carries on it. The charge itself is not edited.</p>
      <dl class="dl">
        <dt>Charge *</dt>
        <dd><label class="field"><select data-field="chargeTxId">${charges.map((c) => `
          <option value="${esc(c.txId)}"${c.txId === state.chargeTxId ? ' selected' : ''}>${esc(c.chargeCode)} ${esc(c.description)} · ${esc(c.encounterNo || 'no visit')} · ${esc(usd(c.remaining))} left</option>`).join('')}</select></label></dd>
        <dt>Reason *</dt>
        <dd><label class="field"><select data-field="reason">${options(accounts.ADJUSTMENT_REASONS, state.reason)}</select></label></dd>
        <dt>Amount *</dt>
        <dd><label class="field"><input type="number" min="0.01" step="0.01" data-field="amount" value="${esc(state.amount)}" placeholder="0.00"></label>
          <span class="t-body-sm" id="aj-max">Up to ${esc(usd(chosen().remaining))}</span></dd>
        <dt>Note</dt>
        <dd><label class="field field--area"><textarea rows="2" data-field="note" placeholder="What happened" maxlength="300"></textarea></label></dd>
      </dl>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="save">Adjust</button>`,
  });
  const $ = (sel) => dialog.el.querySelector(sel);
  const read = (e) => {
    const f = e.target.closest('[data-field]');
    if (!f) return;
    state[f.dataset.field] = f.value;
    if (f.dataset.field === 'chargeTxId') {
      $('#aj-max').textContent = `Up to ${usd(chosen().remaining)}`;
      if (Number(state.amount) > chosen().remaining) { state.amount = cap(state.amount); $('[data-field="amount"]').value = state.amount; }
    }
  };
  dialog.el.addEventListener('input', read);
  dialog.el.addEventListener('change', read);
  dialog.el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="save"]')) return;
    const result = accounts.adjust({ mrn, chargeTxId: state.chargeTxId, amount: Number(state.amount), reason: state.reason, note: state.note });
    if (result.error) return void ($('#aj-error').innerHTML = errorHtml(result.error));
    toast(`${usd(result.tx.amount)} adjusted off — ${state.reason}`);
    dialog.close(result.tx);
  });
  return dialog.closed;
}

/**
 * askRefund({ mrn, encounterNo, paymentTxId, amount }) → the row or null.
 * Gives back part of a payment's unallocated credit — the excess on a visit,
 * or money paid and never needed — and opens the voucher for it.
 */
export async function askRefund({ mrn, encounterNo = '', paymentTxId = '', amount = '' } = {}) {
  const role = currentRole();
  if (!role.canRefund) {
    return refuse('Refunding needs another role',
      `${esc(role.name)} cannot refund a payment. A cashier supervisor or the CMO signs a refund off, because money leaving the hospital is a financial correction.`);
  }
  const rows = accounts.transactions(mrn);
  const payments = rows
    .filter((tx) => tx.type === 'Payment' && tx.status !== 'Reversed' && (!encounterNo || tx.encounterNo === encounterNo || !tx.encounterNo))
    .map((tx) => ({ tx, credit: paymentCredit(rows, tx.id) }))
    .filter((p) => p.credit > 0);
  if (!payments.length) return refuse('Nothing to refund', 'No payment on this account carries unallocated credit. A deposit is refunded from the Deposits tab.');
  const state = {
    paymentTxId: paymentTxId && payments.some((p) => p.tx.id === paymentTxId) ? paymentTxId : payments[0].tx.id,
    amount: String(amount || ''), reason: accounts.REFUND_REASONS[0], method: METHODS[0], reference: '',
  };
  const chosen = () => payments.find((p) => p.tx.id === state.paymentTxId) || payments[0];
  if (!state.amount) state.amount = String(chosen().credit);

  const dialog = modal.open({
    title: 'Refund a payment',
    sub: `${esc(mrn)}${encounterNo ? ` · ${esc(encounterNo)}` : ''}`,
    icon: 'undo',
    tone: 'warning',
    size: 'md',
    body: `
      <div id="rf-error"></div>
      <p class="modal__lede">A Refund row against the payment, no more than what of it is not against a charge, with a voucher the patient signs for.</p>
      <dl class="dl">
        <dt>Payment *</dt>
        <dd><label class="field"><select data-field="paymentTxId">${payments.map((p) => `
          <option value="${esc(p.tx.id)}"${p.tx.id === state.paymentTxId ? ' selected' : ''}>${esc(p.tx.detail?.receiptNo || p.tx.id)} · ${esc(date(p.tx.at))} · ${esc(usd(p.tx.amount))} paid · ${esc(usd(p.credit))} unallocated</option>`).join('')}</select></label></dd>
        <dt>Reason *</dt>
        <dd><label class="field"><select data-field="reason">${options(accounts.REFUND_REASONS, state.reason)}</select></label></dd>
        <dt>Amount *</dt>
        <dd><label class="field"><input type="number" min="0.01" step="0.01" data-field="amount" value="${esc(state.amount)}"></label>
          <span class="t-body-sm" id="rf-max">Up to ${esc(usd(chosen().credit))}</span></dd>
        <dt>Method *</dt>
        <dd>
          <div class="toolbar">
            <label class="field"><select data-field="method">${options(METHODS, state.method)}</select></label>
            <label class="field field--grow"><span class="icon icon--sm">tag</span><input type="text" data-field="reference" placeholder="Reference" aria-label="Reference"></label>
          </div>
        </dd>
      </dl>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="save">Refund</button>`,
  });
  const $ = (sel) => dialog.el.querySelector(sel);
  const read = (e) => {
    const f = e.target.closest('[data-field]');
    if (!f) return;
    state[f.dataset.field] = f.value;
    if (f.dataset.field === 'paymentTxId') $('#rf-max').textContent = `Up to ${usd(chosen().credit)}`;
  };
  dialog.el.addEventListener('input', read);
  dialog.el.addEventListener('change', read);
  dialog.el.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-act="save"]')) return;
    const result = accounts.refund({ mrn, paymentTxId: state.paymentTxId, amount: Number(state.amount), reason: state.reason, method: state.method, reference: state.reference });
    if (result.error) return void ($('#rf-error').innerHTML = errorHtml(result.error));
    toast(`${usd(result.tx.amount)} refunded — voucher ${result.receipt?.receiptNo || ''}`);
    dialog.close(result.tx);
    const { openReceipt } = await import('./receipt-view.js');
    await openReceipt(result.receipt?.receiptNo);
  });
  return dialog.closed;
}

/**
 * askHoldCredit(encounterNo) → the visit or null. Records that the patient
 * agreed to leave the excess on the account: who consented and how. Nothing
 * moves; the choice is audited and the visit can then settle.
 */
export async function askHoldCredit(encounterNo) {
  const r = accounts.reconcile(encounterNo);
  if (!r || r.outcome !== 'Excess') return null;
  const amount = Math.abs(r.difference);
  const dialog = modal.open({
    title: 'Hold the excess as credit',
    sub: `${esc(encounterNo)} · ${esc(usd(amount))} more than the share was taken`,
    icon: 'savings',
    size: 'sm',
    body: `
      <div id="hc-error"></div>
      <p class="modal__lede">Records: “Patient consented to hold ${esc(usd(amount))} as credit.” The money stays on the account and answers the next charge; nothing is refunded.</p>
      <dl class="dl">
        <dt>Consent by *</dt>
        <dd><label class="field"><input type="text" data-field="name" placeholder="Name of the person who agreed" maxlength="80"></label></dd>
        <dt>Method *</dt>
        <dd><label class="field"><select data-field="method">${options(['Signed in person', 'Verbal (documented)', 'By phone (documented)', 'E-signature'])}</select></label></dd>
      </dl>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="save">Record consent</button>`,
  });
  const $ = (sel) => dialog.el.querySelector(sel);
  dialog.el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="save"]')) return;
    const result = accounts.holdAsCredit(encounterNo, { name: $('[data-field="name"]').value, method: $('[data-field="method"]').value });
    if (result.error) return void ($('#hc-error').innerHTML = errorHtml(result.error));
    toast(`${usd(amount)} held as credit with the patient’s consent`);
    dialog.close(result.row);
  });
  return dialog.closed;
}
