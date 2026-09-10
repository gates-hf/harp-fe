// The two panels the money that came in is read from: the deposits taken and
// what has become of each, and the receipts every payment produced beside the
// documents the visits carry. Markup only — account-view.js owns the state and
// the events.
//
// They are here rather than in account-tabs.js because that file was already at
// the line cap with the ledger's own two panels, and because these two are the
// pair that read the receipt register: a deposit is money with a receipt, and a
// receipt is what the desk hands over for it.

import * as accounts from '../../../../data/repositories/accounts.js';
import * as ledger from '../../../../data/repositories/ledger.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import { date, dateTime, esc, usd } from '../../../../shared/format.js';
import { emptyHtml } from './account-tabs.js';

// --- Deposits -----------------------------------------------------------------

export function depositsHtml(mrn, role) {
  const rows = accounts.deposits(mrn);
  if (!rows.length) {
    return emptyHtml('savings', 'No deposit taken',
      'Money held against a visit before it is billed shows here, with what has become of it.');
  }
  const canRefund = Boolean(role?.canRefund);
  return `
    <div class="toolbar">
      <span class="t-title-sm">Deposits</span>
      <span class="spacer"></span>
      <span class="t-body-sm">${rows.length} deposit${rows.length === 1 ? '' : 's'}</span>
    </div>
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">Receipt</th>
          <th scope="col">Taken</th>
          <th scope="col">Encounter</th>
          <th scope="col" class="num">Amount</th>
          <th scope="col" class="num">Applied</th>
          <th scope="col" class="num">Refunded</th>
          <th scope="col" class="num">Remaining</th>
          <th scope="col">Status</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>${rows.map((d) => `
        <tr>
          <td class="t-mono-sm">${esc(d.receiptNo || '—')}</td>
          <td class="t-mono-sm" title="${esc(dateTime(d.tx.at))}">${date(d.tx.at)}</td>
          <td>${d.encounterNo
    ? `<a class="crumb-link t-mono-sm" href="#/frontis/encounters/${esc(d.encounterNo)}">${esc(d.encounterNo)}</a>`
    : '<span class="t-body-sm">—</span>'}</td>
          <td class="num t-mono-sm">${usd(d.amount)}</td>
          <td class="num t-mono-sm">${usd(d.applied)}</td>
          <td class="num t-mono-sm">${usd(d.refunded)}</td>
          <td class="num t-mono-sm"><b>${usd(d.remaining)}</b></td>
          <td><span class="badge${d.status === 'Held' ? ' badge--accent' : d.status === 'Refunded' ? ' badge--warning' : ' badge--success'}">
            ${esc(d.status)}</span></td>
          <td>
            <button class="btn btn--ghost btn--icon btn--sm" data-act="apply-deposit" data-tx="${esc(d.tx.id)}"
                    ${d.remaining > 0 ? '' : 'disabled'}
                    title="${esc(d.remaining > 0 ? 'Apply it to open charges' : 'Nothing left to apply')}">
              <span class="icon icon--sm">call_merge</span>
            </button>
            <button class="btn btn--ghost btn--icon btn--sm" data-act="refund-deposit" data-tx="${esc(d.tx.id)}"
                    ${d.remaining > 0 && canRefund ? '' : 'disabled'}
                    title="${esc(!canRefund ? 'Refunding needs a role with the refund permission'
    : d.remaining > 0 ? 'Give the balance back' : 'Nothing left to refund')}">
              <span class="icon icon--sm">undo</span>
            </button>
          </td>
        </tr>`).join('')}</tbody>
    </table>`;
}

// --- Receipts and documents -------------------------------------------------------

export function receiptsHtml(mrn) {
  const rows = accounts.transactions(mrn)
    .map((tx) => ({ tx, receipt: ledger.receiptOf(tx.id) }))
    .filter((row) => row.receipt)
    .reverse();
  return `
    <div class="toolbar">
      <span class="t-title-sm">Receipts</span>
      <span class="spacer"></span>
      <span class="t-body-sm">${rows.length} issued</span>
    </div>
    ${rows.length ? `
      <table class="tbl">
        <thead>
          <tr>
            <th scope="col">Receipt no.</th>
            <th scope="col">Date</th>
            <th scope="col">Purpose</th>
            <th scope="col">Method</th>
            <th scope="col" class="num">Amount</th>
            <th scope="col">Printed</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>${rows.map(({ tx, receipt }) => `
          <tr>
            <td class="t-mono-sm">${esc(receipt.receiptNo)}</td>
            <td class="t-mono-sm" title="${esc(dateTime(tx.at))}">${date(tx.at)}</td>
            <td>${esc(tx.detail?.purpose || tx.type)}</td>
            <td>${esc(tx.detail?.method || '—')}</td>
            <td class="num t-mono-sm">${usd(tx.amount)}</td>
            <td class="t-body-sm">${(receipt.printedAt || []).length
    ? `${receipt.printedAt.length}×, last ${date(receipt.printedAt.at(-1))}`
    : 'not yet'}</td>
            <td>
              <button class="btn btn--ghost btn--icon btn--sm" data-act="receipt" data-receipt="${esc(receipt.receiptNo)}"
                      title="Open the printable receipt">
                <span class="icon icon--sm">print</span>
              </button>
            </td>
          </tr>`).join('')}</tbody>
      </table>`
    : emptyHtml('receipt', 'No receipt issued yet', 'A receipt is issued for every payment and every deposit taken.')}
    ${documentsHtml(mrn)}`;
}

/**
 * The signed paperwork a visit produced. Acknowledgments are the clearance
 * feature's entity, so this reads whatever the encounter carries rather than
 * reaching into it: a visit with none says so, and fills in when one is signed.
 */
function documentsHtml(mrn) {
  const rows = encounters.byPatient(mrn)
    .flatMap((enc) => (enc.linked?.estimateIds || []).map((id) => ({ enc, id })));
  return `
    <div class="toolbar">
      <span class="t-title-sm">Documents</span>
      <span class="spacer"></span>
      <span class="t-body-sm">signed copies and quotations</span>
    </div>
    ${rows.length ? `
      <table class="tbl">
        <thead><tr><th scope="col">Document</th><th scope="col">Encounter</th><th scope="col">Date</th></tr></thead>
        <tbody>${rows.map(({ enc, id }) => `
          <tr>
            <td><a class="crumb-link t-mono-sm" href="#/frontis/estimates/${esc(id)}">${esc(id)}</a>
              <span class="t-body-sm">cost estimate</span></td>
            <td><a class="crumb-link t-mono-sm" href="#/frontis/encounters/${esc(enc.no)}">${esc(enc.no)}</a></td>
            <td class="t-mono-sm">${date(enc.startAt)}</td>
          </tr>`).join('')}</tbody>
      </table>`
    : '<p class="t-body-sm">No document is linked to this account yet.</p>'}`;
}

// --- shared ---------------------------------------------------------------------

function emptyHtml(icon, title, body) {
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">${icon}</span></div>
      <div class="state-view__title">${esc(title)}</div>
      <p class="state-view__body">${esc(body)}</p>
    </div>`;
}
