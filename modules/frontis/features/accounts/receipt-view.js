// The printable receipt. It opens in the shared sheet rather than on a route of
// its own: a receipt is handed over at the moment the money is taken, and
// sending the desk to another page to print it would lose the dialog it was
// taken in.
//
// Everything but the receipt itself carries data-print="hide", so Print hands
// the printer the document and nothing else — the call the referral letter and
// the estimate document already make.

import * as ledger from '../../../../data/repositories/ledger.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import * as accounts from '../../../../data/repositories/accounts.js';
import * as drawer from '../../../../shared/drawer.js';
import { dateTime, esc, usd, usdToLbp } from '../../../../shared/format.js';

export async function openReceipt(receiptNo) {
  const receipt = ledger.receipt(receiptNo);
  if (!receipt) return undefined;
  const tx = ledger.get(receipt.txId);
  if (!tx) return undefined;

  const sheet = drawer.open({
    title: `Receipt ${esc(receipt.receiptNo)}`,
    sub: `${esc(tx.type === 'DepositRefund' ? 'Refunded' : 'Received')} ${esc(usd(tx.amount))} · ${esc(dateTime(tx.at))}`,
    icon: 'receipt',
    body: bodyHtml(receipt, tx),
    foot: `
      <button class="btn btn--secondary" data-close data-print="hide">Close</button>
      <button class="btn btn--primary" data-act="print" data-print="hide">
        <span class="icon icon--sm">print</span>Print
      </button>`,
  });

  sheet.el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="print"]')) return;
    ledger.markPrinted(receipt.receiptNo);
    window.print();
  });

  return sheet.closed;
}

function bodyHtml(receipt, tx) {
  const patient = patients.get(tx.patientMrn);
  const enc = tx.encounterNo ? encounters.get(tx.encounterNo) : null;
  const d = tx.detail || {};
  const balance = accounts.balances(tx.patientMrn);
  const allocations = d.allocations || d.appliedTo || [];
  return `
    <div class="panel">
      <div class="panel-header">
        <span>Official receipt</span>
        <span class="spacer"></span>
        <span class="t-mono-sm">${esc(receipt.receiptNo)}</span>
      </div>
      <div class="panel-body">
      <div class="toolbar">
        <span class="t-body-sm">${esc(dateTime(tx.at))}</span>
        <span class="spacer"></span>
        <span class="t-body-sm">Taken by ${esc(tx.by)}</span>
      </div>

      <dl class="dl">
        <dt>Received from</dt>
        <dd>${esc(patient?.nameEn || tx.patientMrn)} <span class="t-mono-sm">${esc(tx.patientMrn)}</span></dd>
        <dt>Purpose</dt>
        <dd>${esc(d.purpose || tx.type)}</dd>
        <dt>Method</dt>
        <dd>${esc(d.method || '—')}${d.reference ? ` · ${esc(d.reference)}` : ''}</dd>
        ${enc ? `<dt>Encounter</dt>
        <dd><span class="t-mono-sm">${esc(enc.no)}</span> ${esc(encounters.typeLabel(enc.type))} · ${esc(enc.department)}</dd>` : ''}
        ${tx.reason ? `<dt>Reason</dt><dd>${esc(tx.reason)}</dd>` : ''}
      </dl>

      <div class="toolbar">
        <span class="t-title-sm">${tx.type === 'DepositRefund' ? 'Amount refunded' : 'Amount received'}</span>
        <span class="spacer"></span>
        <span class="t-mono"><b>${esc(usd(tx.amount))}</b></span>
      </div>
      <p class="t-body-sm">${esc(usdToLbp(tx.amount))} at the platform rate.</p>

      ${allocations.length ? `
        <div class="toolbar"><span class="t-title-sm">Applied to</span></div>
        <table class="tbl">
          <thead><tr><th scope="col">Charge</th><th scope="col" class="num">Amount</th></tr></thead>
          <tbody>${allocations.map((a) => {
    const charge = ledger.get(a.chargeTxId);
    return `
            <tr>
              <td><span class="t-mono-sm">${esc(charge?.detail?.chargeCode || '')}</span>
                ${esc(charge?.detail?.description || a.chargeTxId)}</td>
              <td class="num t-mono-sm">${esc(usd(a.amount))}</td>
            </tr>`;
  }).join('')}</tbody>
        </table>`
    : `<p class="t-body-sm">${tx.type === 'DepositHeld'
      ? 'Held against the visit. It answers no charge until it is applied.'
      : 'Held as credit on the account until charges are posted.'}</p>`}

      <div class="toolbar">
        <span class="t-body-sm">Balance on the account after this receipt</span>
        <span class="spacer"></span>
        <span class="t-mono-sm"><b>${esc(usd(balance.outstanding))}</b> outstanding</span>
      </div>
      <p class="t-body-sm">This receipt records money taken at the desk. It is not a statement of account
        and does not settle a claim the payer has yet to adjudicate.</p>
      </div>
    </div>`;
}
