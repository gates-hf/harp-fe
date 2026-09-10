// The five panels of the account page. Markup only — account-view.js owns the
// state and the events, so the two files each stay near the line cap.
//
// The running balance is computed over the whole ledger and only then filtered
// for display: a column that restarted at zero every time somebody chose a type
// would be a different number with the same name.

import * as accounts from '../../../../data/repositories/accounts.js';
import * as ledger from '../../../../data/repositories/ledger.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import * as cdm from '../../../../data/repositories/cdm.js';
import { patientDelta, answeredOn } from '../../../../data/engines/account-engine.js';
import { consumedLabel, limitRows } from '../../../../data/engines/overage-engine.js';
import { date, dateTime, esc, usd, withinDates } from '../../../../shared/format.js';

/** The tint each transaction type wears, so the column reads at a glance. */
const TONE = {
  Charge: '', Payment: 'success', Allocation: 'accent', DepositHeld: 'accent',
  DepositApplied: 'accent', DepositRefund: 'warning', Adjustment: 'warning',
  Refund: 'warning', Reversal: 'critical',
};

// --- Transactions ---------------------------------------------------------------

export function transactionsHtml(mrn, filters = {}) {
  const all = accounts.transactions(mrn);
  const rows = withRunningBalance(all);
  const shown = rows.filter((row) => keep(row, filters));
  const encounterNos = [...new Set(rows.map((r) => r.tx.encounterNo).filter(Boolean))];

  return `
    <div class="toolbar">
      <span class="t-title-sm">Transactions</span>
      <span class="spacer"></span>
      <label class="field">
        <span class="icon icon--sm">filter_list</span>
        <select data-filter="type" aria-label="Transaction type">
          <option value="">All types</option>
          ${ledger.TYPES.map((t) => `<option value="${esc(t)}"${filters.type === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}
        </select>
      </label>
      <label class="field">
        <span class="icon icon--sm">event_available</span>
        <select data-filter="encounterNo" aria-label="Encounter">
          <option value="">All encounters</option>
          ${encounterNos.map((no) => `<option value="${esc(no)}"${filters.encounterNo === no ? ' selected' : ''}>${esc(no)}</option>`).join('')}
        </select>
      </label>
      <label class="field">
        <span class="icon icon--sm">event</span>
        <input type="date" data-filter="from" value="${esc(filters.from || '')}" aria-label="From">
      </label>
      <label class="field">
        <span class="icon icon--sm">event</span>
        <input type="date" data-filter="to" value="${esc(filters.to || '')}" aria-label="To">
      </label>
      <button class="btn btn--ghost btn--sm" data-act="clear-tx">Clear</button>
    </div>

    ${shown.length ? `
      <table class="tbl">
        <thead>
          <tr>
            <th scope="col">Seq</th>
            <th scope="col">Date</th>
            <th scope="col">Encounter</th>
            <th scope="col">Type</th>
            <th scope="col">Description</th>
            <th scope="col" class="num">Payer</th>
            <th scope="col" class="num">Patient</th>
            <th scope="col" class="num">Paid / applied</th>
            <th scope="col" class="num">Balance</th>
            <th scope="col">By</th>
          </tr>
        </thead>
        <tbody>${shown.map((row) => txRowHtml(row, all)).join('')}</tbody>
      </table>`
    : emptyHtml('receipt_long', 'No transactions',
      'Nothing on this account matches. Clear the filters to see the whole ledger.')}`;
}

function txRowHtml({ tx, balance }, all) {
  const d = tx.detail || {};
  const reversed = tx.status === 'Reversed';
  const reversal = reversed ? ledger.reversalOf(tx.id) : null;
  const text = (value) => (reversed ? `<s>${value}</s>` : value);
  const answered = tx.type === 'Charge'
    ? answeredOn(all, tx.id)
    : (d.allocations || d.appliedTo || []).reduce((n, a) => n + (Number(a.amount) || 0), 0);
  return `
    <tr${reversed ? ' title="Reversed — see the reversal below"' : ''}>
      <td class="t-mono-sm">${tx.seq}</td>
      <td class="t-mono-sm" title="${esc(dateTime(tx.at))}">${date(tx.at)}</td>
      <td>${tx.encounterNo
        ? `<a class="crumb-link t-mono-sm" href="#/frontis/encounters/${esc(tx.encounterNo)}">${esc(tx.encounterNo)}</a>`
        : '<span class="t-body-sm">—</span>'}</td>
      <td><span class="badge${TONE[tx.type] ? ` badge--${TONE[tx.type]}` : ''}">${esc(tx.type)}</span></td>
      <td>${text(esc(ledger.describe(tx)))}
        ${d.isOverage ? '<span class="badge badge--warning">overage</span>' : ''}
        ${d.status === 'Held for approval' ? '<span class="badge badge--warning">held</span>' : ''}
        ${reversal ? `<br><span class="t-body-sm">reversed by #${reversal.seq} — ${esc(reversal.reason || '')}</span>` : ''}
        ${tx.reason && tx.type !== 'Reversal' ? `<br><span class="t-body-sm">${esc(tx.reason)}</span>` : ''}</td>
      <td class="num t-mono-sm">${tx.type === 'Charge' ? text(usd(d.payerShare)) : '—'}</td>
      <td class="num t-mono-sm">${tx.type === 'Charge' ? text(usd(d.patientShare)) : '—'}</td>
      <td class="num t-mono-sm">${answered ? usd(answered) : '—'}</td>
      <td class="num t-mono-sm"><b>${usd(balance)}</b></td>
      <td class="t-body-sm">${esc(tx.by)}</td>
    </tr>`;
}

/** Every row carrying the balance as it stood after it. */
function withRunningBalance(rows) {
  let balance = 0;
  return rows.map((tx) => {
    balance = Math.round((balance + patientDelta(tx)) * 100) / 100;
    return { tx, balance };
  });
}

function keep({ tx }, { type = '', encounterNo = '', from = '', to = '' }) {
  if (type && tx.type !== type) return false;
  if (encounterNo && tx.encounterNo !== encounterNo) return false;
  if ((from || to) && !withinDates(String(tx.at).slice(0, 10), from, to)) return false;
  return true;
}

// --- By encounter -----------------------------------------------------------------

export function byEncounterHtml(mrn, expanded = []) {
  const rows = accounts.byEncounter(mrn);
  if (!rows.length) {
    return emptyHtml('event_available', 'No visit has been charged yet',
      'Charges are posted against an encounter. Post a visit’s charges and it appears here.');
  }
  return `
    <div class="toolbar">
      <span class="t-title-sm">By encounter</span>
      <span class="spacer"></span>
      <span class="t-body-sm">${rows.length} visit${rows.length === 1 ? '' : 's'}</span>
    </div>
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">Encounter</th>
          <th scope="col">Type</th>
          <th scope="col">Status</th>
          <th scope="col" class="num">Charges</th>
          <th scope="col" class="num">Payer</th>
          <th scope="col" class="num">Patient</th>
          <th scope="col" class="num">Pending approval</th>
          <th scope="col" class="num">Paid</th>
          <th scope="col" class="num">Deposits</th>
          <th scope="col" class="num">Unpaid</th>
          <th scope="col">Settlement</th>
          <th scope="col"></th>
        </tr>
      </thead>
      <tbody>${rows.map((row) => encounterRowHtml(row, mrn, expanded.includes(row.encounterNo))).join('')}</tbody>
    </table>`;
}

function encounterRowHtml(row, mrn, open) {
  const enc = encounters.get(row.encounterNo);
  return `
    <tr>
      <td><a class="crumb-link t-mono-sm" href="#/frontis/encounters/${esc(row.encounterNo)}">${esc(row.encounterNo)}</a></td>
      <td>${esc(enc ? encounters.typeLabel(enc.type) : '—')}</td>
      <td>${enc
        ? `<span class="badge${encounters.statusTone(enc.status) ? ` badge--${encounters.statusTone(enc.status)}` : ''}">
             <span class="dot"></span>${esc(enc.status)}</span>`
        : '—'}</td>
      <td class="num t-mono-sm">${usd(row.totalCharges)}</td>
      <td class="num t-mono-sm">${usd(row.payerShare)}</td>
      <td class="num t-mono-sm">${usd(row.patientShare)}</td>
      <td class="num t-mono-sm"${row.undecided > 0
        ? ' title="Waiting on the payer’s approval — nobody carries it yet"' : ''}>${
  row.undecided > 0 ? usd(row.undecided) : '—'}</td>
      <td class="num t-mono-sm">${usd(row.paid)}</td>
      <td class="num t-mono-sm">${usd(row.depositsApplied)}</td>
      <td class="num t-mono-sm"><b>${usd(row.unpaid)}</b></td>
      <td><span class="t-body-sm" title="Reconciliation and settlement land in part B">—</span></td>
      <td>
        <button class="btn btn--ghost btn--icon btn--sm" data-act="expand" data-enc="${esc(row.encounterNo)}"
                aria-expanded="${open}" title="${open ? 'Hide the charge lines' : 'Show the charge lines'}">
          <span class="icon icon--sm">${open ? 'expand_less' : 'expand_more'}</span>
        </button>
      </td>
    </tr>
    ${open ? `<tr><td colspan="12">${chargeLinesHtml(mrn, row.encounterNo)}</td></tr>` : ''}`;
}

/** The charge lines of one visit, with the overage rows marked and a bundle's
 *  consumption underneath the package that measured it. */
function chargeLinesHtml(mrn, encounterNo) {
  const lines = accounts.transactions(mrn)
    .filter((tx) => tx.type === 'Charge' && tx.encounterNo === encounterNo);
  if (!lines.length) return '<p class="t-body-sm">No charge lines on this visit.</p>';
  return `
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">Charge</th>
          <th scope="col" class="num">Qty</th>
          <th scope="col" class="num">Standard</th>
          <th scope="col" class="num">Allowed</th>
          <th scope="col" class="num">Payer</th>
          <th scope="col" class="num">Patient</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>${lines.map((tx) => {
    const d = tx.detail || {};
    return `
        <tr${d.isOverage ? ' title="Beyond what the package price covers"' : ''}>
          <td>
            <span class="t-mono-sm">${esc(d.chargeCode || '')}</span> ${esc(d.description || '')}
            ${d.isOverage ? '<span class="badge badge--warning">overage</span>' : ''}
            ${consumptionLineHtml(d)}
          </td>
          <td class="num t-mono-sm">${esc(d.qtyLabel || d.qty || 1)}</td>
          <td class="num t-mono-sm">${d.gross === null || d.gross === undefined ? '—' : usd(d.gross)}</td>
          <td class="num t-mono-sm">${usd(d.allowed)}</td>
          <td class="num t-mono-sm">${usd(d.payerShare)}</td>
          <td class="num t-mono-sm">${usd(d.patientShare)}</td>
          <td>${statusBadge(d.status)}</td>
        </tr>`;
  }).join('')}</tbody>
    </table>`;
}

/** What a package was measured against, read back off what was posted. */
function consumptionLineHtml(detail) {
  if (!detail.consumption?.length) return '';
  const rows = limitRows(detail.itemId, detail.qty || 1);
  const words = detail.consumption.map((entry) => {
    const row = rows.find((r) => r.componentId === entry.componentId);
    if (!row) return '';
    const value = entry[row.unit];
    return `${cdm.label(row.item)} ${consumedLabel(row, value)} of ${consumedLabel(row, row.included)}`;
  }).filter(Boolean);
  return words.length ? `<br><span class="t-body-sm">used ${esc(words.join(' · '))}</span>` : '';
}

const statusBadge = (status) => (status === 'Priced'
  ? '<span class="badge badge--success">Priced</span>'
  : status === 'Held for approval'
    ? '<span class="badge badge--warning">Held for approval</span>'
    : status === 'Not billable'
      ? '<span class="badge badge--critical">Not billable</span>'
      : `<span class="badge">${esc(status || '—')}</span>`);

// --- shared ---------------------------------------------------------------------

export function emptyHtml(icon, title, body) {
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">${icon}</span></div>
      <div class="state-view__title">${esc(title)}</div>
      <p class="state-view__body">${esc(body)}</p>
    </div>`;
}
