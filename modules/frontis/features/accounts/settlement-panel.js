// The reconciliation of one visit, as the account page's By encounter expander
// and the encounter page's Financial tab both draw it: the strip (estimated →
// actual → paid, then the difference with its outcome), the drivers behind an
// estimate-versus-actual gap, and the actions the outcome allows. One
// renderer, one action handler, so the two screens can never say two things.
//
// Estimates never settle — only actual charges do: the estimate is a column to
// read against, and the difference is taken between the actual share and what
// was paid.

import * as accounts from '../../../../data/repositories/accounts.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { toast } from '../../../../shared/toast.js';
import { dateTime, esc, usd } from '../../../../shared/format.js';

/** The strip, the drivers and the actions for one visit. `data-enc` on the root carries the visit to the handler. */
export function settlementHtml(encounterNo, role = currentRole()) {
  const r = accounts.reconcile(encounterNo);
  const enc = encounters.get(encounterNo);
  if (!r || !enc) return '';
  return `
    <div data-settlement="${esc(encounterNo)}">
      <div class="toolbar">
        <span class="t-title-sm">Settlement</span>
        ${outcomeBadge(r)}
        ${enc.settlement?.status === 'Settled' ? `<span class="t-body-sm">settled ${esc(dateTime(enc.settlement.at))} by ${esc(enc.settlement.by)}${enc.settlement.manual ? ' by hand' : ''}</span>` : ''}
        <span class="spacer"></span>
        <span class="t-body-sm" title="${esc(modeTitle(r))}">${esc(r.mode)}${r.runsContinuously ? ' · continuous' : ''}</span>
      </div>
      <div class="metric-rail metric-rail--3">
        ${card(r.estimatedShare === null ? '—' : usd(r.estimatedShare), 'Estimated share', r.estimateNo ? `acknowledged ${r.estimateNo}` : 'no acknowledged estimate')}
        ${card(usd(r.actualShare), 'Actual share', `${r.chargeCount} charge line${r.chargeCount === 1 ? '' : 's'} posted`)}
        ${card(usd(r.paid), 'Paid', 'payments and deposits applied')}
      </div>
      <div class="toolbar">
        <span class="t-title-sm">Difference</span>
        <span class="t-mono">${esc(r.outcome === 'Pending' ? '—' : usd(r.difference))}</span>
        ${outcomeBadge(r)}
        ${r.consent ? `<span class="t-body-sm" title="${esc(`${r.consent.name}, ${r.consent.method}, ${dateTime(r.consent.at)}`)}">consent: ${esc(usd(r.consent.amount))} held as credit</span>` : ''}
        <span class="spacer"></span>
        ${actionsHtml(r, enc, role)}
      </div>
      ${driversHtml(r)}
      <p class="t-body-sm">Estimates never settle — only actual charges do.</p>
    </div>`;
}

const card = (value, label, sub) => `
  <div class="metric-rail-card">
    <span class="metric-rail-card__value">${esc(value)}</span>
    <span class="metric-rail-card__label">${esc(label)}</span>
    <span class="metric-rail-card__sub">${esc(sub)}</span>
  </div>`;

export function outcomeBadge(r) {
  const tone = accounts.outcomeTone(r.outcome);
  return `<span class="badge${tone ? ` badge--${tone}` : ''}"><span class="dot"></span>${esc(accounts.outcomeLabel(r))}</span>`;
}

const modeTitle = (r) => (r.runsContinuously
  ? 'Money is taken up front and the visit settles on its own the moment the charges and the payments match'
  : r.mode === 'Deposit' ? 'A deposit is held and applied when the visit closes; the residual is chased or written off'
    : 'Nothing is asked for before the service; the visit is settled when it is paid');

/** What the outcome allows. The role gates carry the same sentence the repository refuses with. */
function actionsHtml(r, enc, role) {
  const btn = (act, icon, label, enabled, title, kind = 'secondary') => `
    <button class="btn btn--${kind} btn--sm" data-act="${act}"${enabled ? '' : ' disabled'} title="${esc(title)}">
      <span class="icon icon--sm">${icon}</span>${label}</button>`;
  const settled = enc.settlement?.status === 'Settled';
  if (r.outcome === 'Pending') return btn('post', 'post_add', 'Post charges', encounters.isOpen(enc) || enc.status !== 'Cancelled', 'Post the visit’s charges', 'primary');
  if (r.outcome === 'Unsettled') {
    return `${btn('pay', 'payments', 'Record payment', true, `Take the ${usd(r.difference)} residual`, 'primary')}
      ${btn('adjust', 'price_change', 'Write-off', role.canAdjust, role.canAdjust ? 'Adjust the residual off a charge, with a reason' : 'Adjusting needs the RCM coder or the CMO')}`;
  }
  if (r.outcome === 'Excess') {
    return `${btn('refund', 'undo', 'Refund', role.canRefund, role.canRefund ? `Give the ${usd(-r.difference)} excess back with a voucher` : 'Refunding needs the RCM coder or the CMO', 'primary')}
      ${r.consent ? (settled ? '' : btn('settle', 'task_alt', 'Settle now', true, 'Close the visit with the excess held as credit'))
        : btn('hold', 'savings', 'Hold as credit', true, 'Record the patient’s consent to leave the excess on the account')}`;
  }
  if (settled) return '';
  return btn('settle', 'task_alt', 'Settle now', !accounts.settleBlocker(enc.no), accounts.settleBlocker(enc.no) || 'Mark the visit settled — the charges and the money match', 'primary');
}

function driversHtml(r) {
  if (!r.drivers.length) return '';
  const quoted = r.estimatedShare !== null;
  const rows = quoted ? r.drivers.filter((d) => d.isOverage || d.delta !== 0 || d.inEstimate === false) : r.drivers;
  if (!rows.length) return '<p class="t-body-sm">Every line came out at what the estimate quoted.</p>';
  return `
    <div class="toolbar">
      <span class="t-title-sm">${quoted ? 'Drivers' : 'Charge lines'}</span>
      <span class="badge">${rows.length}</span>
      <span class="spacer"></span>
      <span class="t-body-sm">${quoted ? 'lines that moved the share off the estimate, overage first' : 'nothing was quoted, so every line is shown'}</span>
    </div>
    <table class="tbl">
      <thead><tr><th scope="col">Item</th><th scope="col" class="num">Estimated</th><th scope="col" class="num">Actual</th><th scope="col" class="num">Delta</th></tr></thead>
      <tbody>${rows.map((d) => `
        <tr${d.isOverage ? ' title="Beyond what the package price covers"' : ''}>
          <td><span class="t-mono-sm">${esc(d.chargeCode)}</span> ${esc(d.item)}
            ${d.isOverage ? '<span class="badge badge--warning">overage</span>' : ''}
            ${d.inEstimate === false ? '<span class="badge">not in estimate</span>' : ''}</td>
          <td class="num t-mono-sm">${d.estimated === null ? '—' : esc(usd(d.estimated))}</td>
          <td class="num t-mono-sm">${esc(usd(d.actual))}</td>
          <td class="num t-mono-sm">${d.delta === null ? '—' : `<b>${esc(usd(d.delta))}</b>`}</td>
        </tr>`).join('')}</tbody>
    </table>`;
}

/**
 * handleSettlementAction(act, encounterNo, ctx) → true when the click was one
 * of the panel's. Both hosts call it from their own delegated handler.
 */
export async function handleSettlementAction(act, encounterNo, ctx) {
  const enc = encounters.get(encounterNo);
  if (!enc) return false;
  const r = accounts.reconcile(encounterNo);
  if (act === 'post') { ctx.navigate(`/frontis/encounters/${encounterNo}/post-charges`); return true; }
  if (act === 'pay') {
    const { openPaymentForm } = await import('./payment-form.js');
    await openPaymentForm({ mrn: enc.patientMrn, encounterNo, purpose: 'Balance payment', amount: r?.difference > 0 ? r.difference : '' });
    return true;
  }
  if (act === 'adjust') {
    const { askAdjust } = await import('./adjustment-form.js');
    await askAdjust({ mrn: enc.patientMrn, encounterNo, amount: r?.difference > 0 ? r.difference : '', reason: 'Write-off — management approval' });
    return true;
  }
  if (act === 'refund') {
    const { askRefund } = await import('./adjustment-form.js');
    await askRefund({ mrn: enc.patientMrn, encounterNo, amount: r?.difference < 0 ? -r.difference : '' });
    return true;
  }
  if (act === 'hold') {
    const { askHoldCredit } = await import('./adjustment-form.js');
    await askHoldCredit(encounterNo);
    return true;
  }
  if (act === 'settle') {
    const result = accounts.settle(encounterNo, { manual: true });
    if (result.error) toast(result.error, 'warning');
    else toast(`${encounterNo} settled at ${usd(result.row.settlement.amount)}`);
    return true;
  }
  return false;
}
