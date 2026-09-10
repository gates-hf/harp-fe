// Take money at the desk against one visit, and hand back a receipt.
//
// It shows what was asked for, what has already been taken and what is left,
// and defaults the amount to the remainder — because the common case is
// somebody paying exactly what they owe, and a field already filled in with the
// right number is the fastest correct answer.
//
// Overpayment is allowed and confirmed rather than refused: a patient handing
// over a round sum is ordinary, and the balance belongs to the account that
// will own it, not to a validation rule at the desk.

import * as clearance from '../../../../data/repositories/clearance.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as payments from '../../../../data/repositories/payments.js';
import { depositFor } from '../../../../data/engines/clearance-engine.js';
import { dateTime, esc, usd } from '../../../../shared/format.js';
import { confirm, open } from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';

export async function askCollect(no) {
  const enc = encounters.get(no);
  if (!enc) return null;
  const patient = patients.get(enc.patientMrn);
  const money = amounts(enc);

  const dialog = open({
    title: 'Collect payment',
    sub: `${enc.no} — ${patient?.nameEn || enc.patientMrn}`,
    icon: 'payments',
    size: 'md',
    body: bodyHtml(enc, money),
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-save>Take payment</button>`,
  });

  const el = dialog.el;
  const referenceRow = [el.querySelector('#pay-ref-label'), el.querySelector('#pay-ref')];
  const method = el.querySelector('[name="method"]');

  // Cash has no reference to give, so the field is shown only for the methods
  // that carry one. Both halves of the .dl row are switched, never a wrapper.
  const syncMethod = () => {
    const wanted = method.value !== 'Cash';
    for (const half of referenceRow) half.hidden = !wanted;
  };
  method.addEventListener('change', syncMethod);
  syncMethod();

  el.querySelector('[data-save]').addEventListener('click', async () => {
    const values = read(el);
    const error = validate(values);
    if (error) return void showError(el, error);

    if (money.required > 0 && values.amount > money.remaining) {
      const over = values.amount - money.remaining;
      const ok = await confirm({
        title: 'More than is owed',
        body: `${usd(values.amount)} is ${usd(over)} more than the ${usd(money.remaining)} outstanding on this `
          + 'visit. The balance stays with the patient and is carried into their account. Take it anyway?',
        confirmLabel: 'Take the payment',
        icon: 'account_balance_wallet',
      });
      if (!ok) return;
    }

    const row = payments.create({
      encounterNo: enc.no,
      patientMrn: enc.patientMrn,
      kind: 'Deposit',
      amount: values.amount,
      method: values.method,
      reference: values.method === 'Cash' ? '' : values.reference,
      note: values.note,
    });
    if (!row) return void showError(el, 'The payment was not recorded. Check the amount and try again.');

    clearance.refreshClearance(enc.no);
    toast(`${usd(row.amount)} taken — receipt ${row.receiptNo}`);
    dialog.close('saved');
    showReceipt(enc, row, patient);
  });

  return dialog.closed;
}

/** The deposit arithmetic comes from the engine, so nothing is worked out twice. */
const amounts = (enc) => depositFor(enc);

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

function bodyHtml(enc, money) {
  return `
    <dl class="dl dl--narrow">
      <dt>Required</dt><dd>${esc(money.summary)}</dd>
      <dt>Received so far</dt><dd>${usd(money.received)}</dd>
      <dt>Remaining</dt><dd>${money.remaining > 0 ? usd(money.remaining) : 'Nothing outstanding'}</dd>

      <dt><label for="pay-amount">Amount *</label></dt>
      <dd>
        <label class="field">
          <span class="icon icon--sm">attach_money</span>
          <input type="number" id="pay-amount" name="amount" min="0.01" step="0.01"
                 value="${money.remaining > 0 ? money.remaining : ''}" aria-label="Amount">
        </label>
      </dd>

      <dt><label for="pay-method">Method *</label></dt>
      <dd>
        <label class="field">
          <span class="icon icon--sm">credit_card</span>
          <select id="pay-method" name="method">
            ${payments.METHODS.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}
          </select>
        </label>
      </dd>

      <dt id="pay-ref-label" hidden><label for="pay-reference">Reference</label></dt>
      <dd id="pay-ref" hidden>
        <label class="field">
          <span class="icon icon--sm">tag</span>
          <input type="text" id="pay-reference" name="reference"
                 placeholder="Card authorisation or transfer reference" aria-label="Reference">
        </label>
      </dd>

      <dt><label for="pay-note">Note</label></dt>
      <dd>
        <label class="field field--area">
          <textarea id="pay-note" name="note" rows="2"
                    placeholder="Anything the desk should remember about this payment"></textarea>
        </label>
      </dd>
    </dl>
    <div id="pay-error"></div>`;
}

function read(el) {
  const value = (name) => el.querySelector(`[name="${name}"]`)?.value || '';
  return {
    amount: round(value('amount')),
    method: value('method'),
    reference: value('reference').trim(),
    note: value('note').trim(),
  };
}

function validate(values) {
  if (!(values.amount > 0)) return 'Enter the amount taken. A payment has to be more than nothing.';
  if (!values.method) return 'Say how the money was taken.';
  return '';
}

function showError(el, message) {
  el.querySelector('#pay-error').innerHTML = `
    <div class="alert alert--critical">
      <span class="icon">error</span>
      <div>${esc(message)}</div>
    </div>`;
}

// --- receipt ------------------------------------------------------------------

/**
 * The receipt, offered the moment the money is taken. Print hands the printer
 * the receipt alone: `app/app.css` already drops anything marked
 * `data-print="hide"`, so the page behind the dialog is marked while it is open
 * and unmarked when it closes — no new CSS, and the rule is used the way it was
 * written.
 */
function showReceipt(enc, row, patient) {
  const page = document.querySelector('.main');
  page?.setAttribute('data-print', 'hide');

  const dialog = open({
    title: `Receipt ${row.receiptNo}`,
    sub: `${enc.no} — ${patient?.nameEn || enc.patientMrn}`,
    icon: 'receipt_long',
    size: 'sm',
    body: `
      <dl class="dl dl--narrow">
        <dt>Receipt no.</dt><dd class="t-mono-sm">${esc(row.receiptNo)}</dd>
        <dt>Patient</dt><dd>${esc(patient?.nameEn || enc.patientMrn)}<br>
          <span class="t-mono-sm">${esc(enc.patientMrn)}</span></dd>
        <dt>Encounter</dt><dd class="t-mono-sm">${esc(enc.no)}</dd>
        <dt>For</dt><dd>${esc(row.kind)} against ${esc(enc.department)}</dd>
        <dt>Amount</dt><dd class="t-title-sm">${usd(row.amount)}</dd>
        <dt>Method</dt><dd>${esc(row.method)}${row.reference ? ` · ${esc(row.reference)}` : ''}</dd>
        <dt>Taken by</dt><dd>${esc(row.receivedBy)}</dd>
        <dt>Taken at</dt><dd class="t-mono-sm">${dateTime(row.at)}</dd>
      </dl>
      <p class="t-body-sm">This receipt acknowledges money taken before the service. It is not a bill, and it
        does not settle a claim.</p>`,
    foot: `
      <button class="btn btn--secondary" data-close data-print="hide">Close</button>
      <button class="btn btn--primary" data-print-receipt data-print="hide">
        <span class="icon icon--sm">print</span>Print</button>`,
  });

  dialog.el.querySelector('[data-print-receipt]')?.addEventListener('click', () => window.print());
  dialog.closed.then(() => page?.removeAttribute('data-print'));
}
