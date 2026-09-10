// What a closing did to the money, in one card: the deposits applied at
// discharge and where the visit stands — "Deposits applied $620 — residual
// $80" — shown in the discharge dialog before the desk moves on. Markup only;
// the figures are the settlement engine's.

import * as accounts from '../../../../data/repositories/accounts.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import { esc, usd } from '../../../../shared/format.js';
import { outcomeBadge } from './settlement-panel.js';

export function settlementResultHtml(encounterNo) {
  const r = accounts.reconcile(encounterNo);
  const enc = encounters.get(encounterNo);
  if (!r || !enc) return '<p class="t-body-sm">No reconciliation for this visit.</p>';
  const b = accounts.encounterBalance(enc.patientMrn, encounterNo);
  const line = r.outcome === 'Settled' ? 'Nothing is left to chase — the visit is settled.'
    : r.outcome === 'Unsettled' ? `Residual ${usd(r.difference)} is still owed. It is chased from the account, or written off with a reason.`
      : r.outcome === 'Excess' ? `${usd(-r.difference)} more than the share was taken. Refund it, or record the patient’s consent to hold it as credit.`
        : 'No charge has been posted on this visit yet, so there is nothing to reconcile.';
  return `
    <div class="toolbar">
      <span class="t-title-sm">Settlement</span>
      ${outcomeBadge(r)}
      <span class="spacer"></span>
      <span class="t-body-sm">${esc(r.mode)}</span>
    </div>
    <dl class="dl dl--narrow">
      <dt>Deposits applied</dt><dd class="t-mono-sm">${esc(usd(b.depositsApplied))}${r.depositsHeld ? ` <span class="t-body-sm">· ${esc(usd(r.depositsHeld))} still held</span>` : ''}</dd>
      <dt>Actual share</dt><dd class="t-mono-sm">${esc(usd(r.actualShare))}</dd>
      <dt>Paid</dt><dd class="t-mono-sm">${esc(usd(r.paid))}</dd>
      <dt>Difference</dt><dd class="t-mono-sm"><b>${esc(r.outcome === 'Pending' ? '—' : usd(r.difference))}</b></dd>
    </dl>
    <p class="modal__lede">${esc(line)}</p>`;
}
