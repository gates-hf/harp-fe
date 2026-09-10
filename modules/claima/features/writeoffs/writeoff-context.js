// The context card beside a write-off: what is outstanding on the source
// right now, how long it has waited, what has been done to collect it (the
// follow-ups and the payer events on the claim, the open charges on the
// account) and the write-offs already raised on the same claim or account.
// One renderer for the request screen and the decision page, so the signer
// reads exactly what the requester read. Markup only — no listeners.

import * as writeoffs from '../../../../data/repositories/writeoffs.js';
import * as claims from '../../../../data/repositories/claims.js';
import * as followups from '../../../../data/repositories/followups.js';
import * as accounts from '../../../../data/repositories/accounts.js';
import * as lifecycle from '../../../../data/engines/claim-events.js';
import { date, dateTime, esc, usd } from '../../../../shared/format.js';
import { amountHtml, classificationHtml, statusHtml } from './writeoff-chips.js';

/**
 * contextHtml(source, side, { excludeId, amount }) — `amount` is what is
 * being asked for, so the card can say how much of the outstanding it is.
 */
export function contextHtml(source, side, { excludeId = null, amount = null } = {}) {
  if (!source?.ref) return emptyHtml();
  const c = writeoffs.contextFor(source, side, { excludeId });
  return `
    ${balanceHtml(c, side, amount)}
    ${side === 'Payer' ? claimHtml(c) : accountHtml(c)}
    ${pursuitHtml(c, side)}
    ${priorHtml(c)}`;
}

function balanceHtml(c, side, amount) {
  const share = amount && c.outstanding ? Math.min(1, amount / c.outstanding) : 0;
  const over = amount && amount > c.outstanding;
  return `
    <div class="toolbar">
      <span class="t-title-sm">Outstanding now</span>
      <span class="spacer"></span>
      <span class="t-body-sm">${esc(agingLine(c.agingDays, side))}</span>
    </div>
    <dl class="dl dl--narrow">
      <dt>${side === 'Payer' ? 'Claim open balance' : 'Patient owes'}</dt>
      <dd><span class="t-mono-sm">${esc(usd(c.outstanding))}</span>${c.denial ? ` <span class="t-body-sm">· denial open ${esc(usd(c.denial.amounts?.open ?? c.denial.amount))}</span>` : ''}</dd>
      ${amount ? `<dt>Requested</dt><dd><span class="t-mono-sm">${esc(usd(amount))}</span> <span class="t-body-sm">· ${over ? 'more than is outstanding' : `${Math.round(share * 100)}% of it`}</span></dd>` : ''}
      ${c.balances && side === 'Patient' ? `
        <dt>Account</dt>
        <dd><span class="t-body-sm">${esc(usd(c.balances.totalCharges))} charged · ${esc(usd(c.balances.patientShare))} patient share · ${esc(usd(c.balances.paid))} paid${
          c.balances.adjustments ? ` · ${esc(usd(c.balances.adjustments))} written off` : ''}${
          c.balances.depositsHeld ? ` · ${esc(usd(c.balances.depositsHeld))} on deposit` : ''}</span></dd>` : ''}
    </dl>`;
}

function claimHtml(c) {
  const { claim, payer, denial } = c;
  if (!claim) return '<p class="t-body-sm">The claim behind this source is not on the register.</p>';
  return `
    <div class="toolbar">
      <span class="t-title-sm">Claim</span>
      <span class="spacer"></span>
      <a class="crumb-link t-mono-sm" href="#/claima/claims/${esc(claim.claimNo)}">${esc(claim.claimNo)}</a>
    </div>
    <dl class="dl dl--narrow">
      <dt>Payer</dt><dd>${esc(payer?.nameEn || claim.payerId)}</dd>
      <dt>Status</dt><dd><span class="badge${claimTone(claim.status)}"><span class="dot"></span>${esc(claim.status)}</span>${claim.denialReasonCode ? ` <span class="t-body-sm">· ${esc(claims.denialLabel(claim.denialReasonCode))}</span>` : ''}</dd>
      <dt>Money</dt>
      <dd><span class="t-body-sm">${esc(usd(claim.totals.payerShare))} payer share · ${esc(usd(claim.totals.paid))} paid · ${esc(usd(claim.totals.adjusted))} adjusted</span></dd>
      <dt>Service</dt><dd>${date(claim.dateOfService)}${claim.submittedAt ? `<br><span class="t-body-sm">submitted ${date(claim.submittedAt)}</span>` : ''}</dd>
      ${denial ? `<dt>Denial</dt><dd><span class="t-mono-sm">${esc(denial.id)}</span> <span class="t-body-sm">· ${esc(denial.code || '')} ${esc(denial.reason || '')}${denial.status ? ` · ${esc(denial.status)}` : ''}</span></dd>` : ''}
    </dl>`;
}

function accountHtml(c) {
  const { patient } = c;
  if (!patient) return '<p class="t-body-sm">No patient record behind this source.</p>';
  const open = accounts.openCharges(patient.mrn).slice(-5).reverse();
  return `
    <div class="toolbar">
      <span class="t-title-sm">Open charges</span>
      <span class="badge">${open.length}${accounts.openCharges(patient.mrn).length > 5 ? '+' : ''}</span>
      <span class="spacer"></span>
      <a class="crumb-link t-mono-sm" href="#/frontis/accounts/${esc(patient.mrn)}">${esc(patient.mrn)}</a>
    </div>
    ${open.length ? `
      <table class="tbl">
        <thead><tr><th scope="col">Charge</th><th scope="col">Visit</th><th scope="col">Remaining</th></tr></thead>
        <tbody>${open.map((ch) => `
          <tr>
            <td>${esc(ch.description)}<br><span class="t-body-sm">${date(ch.at)}</span></td>
            <td><span class="t-mono-sm">${esc(ch.encounterNo || '—')}</span></td>
            <td><span class="t-mono-sm">${esc(usd(ch.remaining))}</span></td>
          </tr>`).join('')}</tbody>
      </table>` : '<p class="t-body-sm">Every charge on the account has been answered.</p>'}`;
}

/** What has been done to collect: calls and payer events on a claim, the ledger's last movements on an account. */
function pursuitHtml(c, side) {
  if (side === 'Payer' && c.claim) {
    const calls = followups.byClaim(c.claim.claimNo);
    const events = lifecycle.byClaim(c.claim.claimNo).filter((e) => ['Submitted', 'Acknowledged', 'Rejected', 'Resubmitted', 'RemittancePosted', 'Denied', 'FollowUp', 'Escalated', 'HandedOff'].includes(e.type)).slice(-6);
    const silent = lifecycle.silentDays(c.claim, lifecycle.byClaim(c.claim.claimNo));
    return `
      <div class="toolbar">
        <span class="t-title-sm">Pursuit</span>
        <span class="badge">${calls.length} call${calls.length === 1 ? '' : 's'}</span>
        <span class="spacer"></span>
        <a class="crumb-link t-body-sm" href="#/claima/timeline/${esc(c.claim.claimNo)}">Timeline</a>
      </div>
      ${events.length ? `<ol class="journey">${events.map((e) => `
        <li class="journey__row">
          <span class="journey__at t-mono-sm">${dateTime(e.at)}</span>
          <span class="journey__action">${esc(e.type)}</span>
          <span class="journey__actor">${esc(e.actor || '')}</span>
          <span class="journey__detail">${esc(e.summary)}</span>
        </li>`).join('')}</ol>` : '<p class="t-body-sm">No payer event and no call on record.</p>'}
      ${['Submitted', 'Acknowledged'].includes(c.claim.status) ? `<p class="t-body-sm">${silent} days since the payer last spoke.</p>` : ''}`;
  }
  const recent = c.patient ? accounts.transactions(c.patient.mrn).filter((t) => ['Payment', 'DepositHeld', 'Adjustment', 'Reversal', 'DepositApplied'].includes(t.type)).slice(-5).reverse() : [];
  return `
    <div class="toolbar">
      <span class="t-title-sm">Pursuit</span>
      <span class="spacer"></span>
      <span class="t-body-sm">${recent.length ? 'last money movements on the account' : 'nothing has moved on the account'}</span>
    </div>
    ${recent.length ? `<ol class="journey">${recent.map((t) => `
      <li class="journey__row">
        <span class="journey__at t-mono-sm">${dateTime(t.at)}</span>
        <span class="journey__action">${esc(t.type)}</span>
        <span class="journey__actor">${esc(t.by || '')}</span>
        <span class="journey__detail">${esc(usd(t.amount))}${t.detail?.method ? ` · ${esc(t.detail.method)}` : ''}${t.detail?.origin?.writeoffId ? ` · ${esc(t.detail.origin.writeoffId)}` : ''}${t.reason ? ` — ${esc(t.reason)}` : ''}</span>
      </li>`).join('')}</ol>` : ''}`;
}

function priorHtml(c) {
  return `
    <div class="toolbar">
      <span class="t-title-sm">Prior write-offs</span>
      <span class="badge">${c.prior.length}</span>
      <span class="spacer"></span>
      ${c.priorValue ? `<span class="t-body-sm">${esc(usd(c.priorValue))} posted on this ${c.claim ? 'claim or account' : 'account'}</span>` : ''}
    </div>
    ${c.prior.length ? `
      <table class="tbl">
        <thead><tr><th scope="col">Request</th><th scope="col">Reason</th><th scope="col">Amount</th><th scope="col">Status</th></tr></thead>
        <tbody>${c.prior.map((w) => `
          <tr>
            <td><a class="crumb-link t-mono-sm" href="#/claima/writeoffs/${esc(w.id)}">${esc(w.id)}</a><br><span class="t-body-sm">${date(w.at)} · ${esc(w.requestedBy)}</span></td>
            <td>${esc(w.reasonCode)} ${classificationHtml(w.classification)}</td>
            <td>${amountHtml(w)}</td>
            <td>${statusHtml(w)}</td>
          </tr>`).join('')}</tbody>
      </table>` : '<p class="t-body-sm">Nothing has been written off here before.</p>'}`;
}

const agingLine = (days, side) => (side === 'Payer'
  ? `${days} days since ${days ? 'submission' : 'service'}`
  : `oldest open charge ${days} days old`);

const claimTone = (status) => {
  const tone = { Paid: 'success', 'Partially Paid': 'warning', Denied: 'critical', Rejected: 'critical', Appealed: 'info', Submitted: 'info', Acknowledged: 'info' }[status];
  return tone ? ` badge--${tone}` : '';
};

function emptyHtml() {
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">account_balance_wallet</span></div>
      <div class="state-view__title">Pick a source</div>
      <p class="state-view__body">What is outstanding, how long it has waited, what has been done to collect it and what was written off before appear here once a source is chosen.</p>
    </div>`;
}
