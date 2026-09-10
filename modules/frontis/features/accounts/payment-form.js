// Capturing money. One dialog for every desk that takes it — the account page,
// the encounter page and financial clearance — so a receipt is issued the same
// way and allocated the same way whoever took it.
//
// The allocation panel is the part worth being careful about: the proposal is
// oldest first, because the oldest debt is the one a desk chases, and the boxes
// are there to override it rather than to build it. Whatever the amount does
// not reach stays as credit on the account and is applied as charges land.

import * as accounts from '../../../../data/repositories/accounts.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import * as estimates from '../../../../data/repositories/estimates.js';
import * as ledger from '../../../../data/repositories/ledger.js';
import { isUpfront } from '../../../../data/engines/account-engine.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { date, esc, usd } from '../../../../shared/format.js';

export const METHODS = ['Cash', 'Card', 'Bank transfer', 'Cheque', 'Mobile wallet'];

/**
 * openPaymentForm({ mrn, encounterNo, purpose }) -> the transaction, or null.
 * `encounterNo` preselects the visit; a deposit and a settlement require one,
 * because money held or settled is always held or settled against a visit.
 */
export async function openPaymentForm({ mrn, encounterNo = '', purpose = '' } = {}) {
  const patient = patients.get(mrn);
  if (!patient) return null;

  const visits = accounts.postableEncounters(mrn);
  const state = {
    amount: '',
    purpose: purpose || (encounterNo ? 'Deposit' : 'Balance payment'),
    method: METHODS[0],
    reference: '',
    encounterNo: encounterNo || '',
    selection: null,
    error: '',
  };

  const upfrontHint = () => {
    const enc = encounters.get(state.encounterNo);
    if (!enc || !isUpfront(enc) || state.purpose !== 'Settlement') return '';
    const quoted = expectedShare(enc);
    return `<div class="alert alert--info">
        <span class="icon">bolt</span>
        <div>Upfront settlement — this money is applied to the visit's charges automatically as they are
          posted.${quoted ? ` The estimate the patient acknowledged puts their share at ${esc(usd(quoted))}.` : ''}</div>
      </div>`;
  };

  const sheet = modal.open({
    title: 'Record payment',
    sub: `${esc(patient.nameEn)} · ${esc(mrn)}`,
    icon: 'payments',
    size: 'lg',
    body: bodyHtml(),
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="save">Take payment</button>`,
  });

  function bodyHtml() {
    const charges = openChargesFor();
    const amount = Number(state.amount) || 0;
    const proposal = proposalOf(charges, amount);
    return `
      <div id="pf-error"></div>
      ${upfrontHint()}
      <div class="toolbar">
        <label class="field">
          <span class="icon icon--sm">payments</span>
          <input type="number" min="0" step="0.01" value="${esc(state.amount)}" data-field="amount"
                 placeholder="Amount" aria-label="Amount" autofocus>
        </label>
        <label class="field">
          <span class="icon icon--sm">category</span>
          <select data-field="purpose" aria-label="Purpose">
            ${ledger.PURPOSES.map((p) => `<option value="${esc(p)}"${p === state.purpose ? ' selected' : ''}>${esc(p)}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span class="icon icon--sm">account_balance</span>
          <select data-field="method" aria-label="Method">
            ${METHODS.map((m) => `<option value="${esc(m)}"${m === state.method ? ' selected' : ''}>${esc(m)}</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="toolbar">
        <label class="field field--grow">
          <span class="icon icon--sm">tag</span>
          <input type="text" value="${esc(state.reference)}" data-field="reference"
                 placeholder="Reference (card slip, transfer no.)" aria-label="Reference">
        </label>
        <label class="field">
          <span class="icon icon--sm">event_available</span>
          <select data-field="encounterNo" aria-label="Encounter">
            <option value="">No encounter — on the account</option>
            ${visits.map((enc) => `
              <option value="${esc(enc.no)}"${enc.no === state.encounterNo ? ' selected' : ''}>
                ${esc(enc.no)} · ${esc(encounters.typeLabel(enc.type))} · ${esc(date(enc.startAt))}
              </option>`).join('')}
          </select>
        </label>
      </div>
      <div id="pf-alloc">${state.purpose === 'Deposit' ? depositNote() : allocationHtml(charges, proposal, amount)}</div>`;
  }

  function openChargesFor() {
    // A settlement answers the visit it was taken for; a balance payment
    // answers whatever is oldest on the account.
    return accounts.openCharges(mrn, state.purpose === 'Settlement' ? state.encounterNo : '');
  }

  function depositNote() {
    return `
      <p class="t-body-sm">A deposit is held against the visit and answers no charge yet. Apply it from the
        account's Deposits tab once the charges are posted, or refund what is left.</p>`;
  }

  function allocationHtml(charges, proposal, amount) {
    if (!charges.length) {
      return `<p class="t-body-sm">Nothing is outstanding on this ${state.purpose === 'Settlement' ? 'visit' : 'account'}
        yet, so the whole amount is held as credit and applied as charges are posted.</p>`;
    }
    const allocated = proposal.reduce((n, p) => n + p.amount, 0);
    return `
      <div class="toolbar">
        <span class="t-title-sm">Allocation</span>
        <span class="spacer"></span>
        <span class="t-body-sm">oldest first — tick to choose the charges yourself</span>
      </div>
      ${charges.map((charge) => {
    const picked = proposal.find((p) => p.chargeTxId === charge.txId);
    const checked = state.selection ? state.selection.includes(charge.txId) : Boolean(picked);
    return `
        <label class="rule-child-row">
          <input type="checkbox" data-charge="${esc(charge.txId)}"${checked ? ' checked' : ''}
                 aria-label="Allocate to ${esc(charge.description)}">
          <span>
            <span class="t-mono-sm">${esc(charge.chargeCode)}</span> ${esc(charge.description)}
            ${charge.isOverage ? '<span class="badge badge--warning">overage</span>' : ''}
            <br><span class="t-body-sm">${esc(charge.encounterNo || 'no visit')} · ${esc(date(charge.at))} ·
              ${esc(usd(charge.remaining))} outstanding of ${esc(usd(charge.owed))}</span>
          </span>
          <span class="spacer"></span>
          <span class="t-mono-sm">${picked ? usd(picked.amount) : '—'}</span>
        </label>`;
  }).join('')}
      <div class="toolbar">
        <span class="t-body-sm">Allocated ${esc(usd(allocated))} of ${esc(usd(amount))}</span>
        <span class="spacer"></span>
        <span class="t-body-sm">${amount > allocated
    ? `${esc(usd(amount - allocated))} stays as credit`
    : 'nothing left over'}</span>
      </div>`;
  }

  /** What the proposal would be at this amount — the same allocation the save runs. */
  function proposalOf(charges, amount) {
    if (amount <= 0) return [];
    const targets = state.selection ? charges.filter((c) => state.selection.includes(c.txId)) : charges;
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

  function redraw() {
    sheet.el.querySelector('.modal__body').innerHTML = bodyHtml();
  }

  function showError(message) {
    state.error = message;
    const box = sheet.el.querySelector('#pf-error');
    box.innerHTML = message
      ? `<div class="alert alert--critical"><span class="icon">error</span><div>${esc(message)}</div></div>`
      : '';
  }

  sheet.el.addEventListener('change', (e) => {
    const field = e.target.closest('[data-field]');
    if (field) {
      state[field.dataset.field] = field.value;
      if (field.dataset.field === 'purpose' || field.dataset.field === 'encounterNo') state.selection = null;
      redraw();
      return;
    }
    const box = e.target.closest('[data-charge]');
    if (box) {
      const boxes = [...sheet.el.querySelectorAll('[data-charge]')];
      state.selection = boxes.filter((b) => b.checked).map((b) => b.dataset.charge);
      redraw();
    }
  });

  sheet.el.addEventListener('input', (e) => {
    const field = e.target.closest('[data-field="amount"], [data-field="reference"]');
    if (!field) return;
    state[field.dataset.field] = field.value;
    if (field.dataset.field !== 'amount') return;
    // Redrawing the whole body on every keystroke would take the caret with it,
    // so only the allocation under the inputs is redrawn.
    const charges = openChargesFor();
    const amount = Number(state.amount) || 0;
    sheet.el.querySelector('#pf-alloc').innerHTML = state.purpose === 'Deposit'
      ? depositNote()
      : allocationHtml(charges, proposalOf(charges, amount), amount);
  });

  sheet.el.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-act="save"]')) return;
    const amount = Number(state.amount);
    if (!Number.isFinite(amount) || amount <= 0) return showError('Enter the amount taken');
    if (state.purpose !== 'Balance payment' && !state.encounterNo) {
      return showError(`A ${state.purpose.toLowerCase()} is taken against a visit — choose the encounter`);
    }
    const result = accounts.recordPayment({
      mrn,
      encounterNo: state.encounterNo || null,
      amount,
      purpose: state.purpose,
      method: state.method,
      reference: state.reference,
      selection: state.selection,
    });
    if (result.error) return showError(result.error);

    sheet.close(result.tx);
    toast(`${state.purpose} of ${usd(amount)} recorded — receipt ${result.receipt?.receiptNo || ''}`);
    const { openReceipt } = await import('./receipt-view.js');
    await openReceipt(result.receipt?.receiptNo);
    return undefined;
  });

  return sheet.closed;
}

/** What the visit's acknowledged estimate said the patient would owe. */
function expectedShare(encounter) {
  const quoted = estimates.byEncounter(encounter.no)
    .filter((row) => row.result?.totals)
    .sort((a, b) => String(b.issuedAt || '').localeCompare(String(a.issuedAt || '')))[0];
  return quoted?.result?.totals?.patientShare || 0;
}
