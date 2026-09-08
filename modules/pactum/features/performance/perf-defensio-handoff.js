// Hand off an underpayment to Defensio — the appeals module, which does not
// exist yet. The record is real: it lands in data/repositories/handoffs.js
// (shared entity, Defensio's when it arrives), is audited, and moves the
// Variance captured and Variance recovered figures on both Performance screens.
//
// This is the stub, not a placeholder: nothing here changes when Defensio ships
// except where the chip on the row points.

import * as handoffs from '../../../../data/repositories/handoffs.js';
import * as claimsRepo from '../../../../data/repositories/claims.js';
import { open as openModal } from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { usd, date, esc } from '../../../../shared/format.js';

/** The reason a hand-off starts with, read off why the money is missing. */
export function suggestedReason(claim) {
  if (claim?.status === 'Denied') {
    const map = {
      PA_MISSING: 'Denied — prior auth on file',
      DOC_MISSING: 'Denied — documentation supplied',
      COV_RULE: 'Coverage split applied incorrectly',
    };
    return map[claim.denialReasonCode] || 'Other';
  }
  return 'Paid below contracted rate';
}

/**
 * Opens the dialog and writes the hand-off on confirm. Returns the stored row,
 * or null when the user backed out.
 */
export async function handOff(claim, variance) {
  const existing = handoffs.forClaim(claim.id);
  if (existing) return existing;

  const dialog = openModal({
    title: 'Hand off to Defensio',
    sub: `${claim.claimNo} · ${claimsRepo.itemName(claim)}`,
    icon: 'forward_to_inbox',
    size: 'md',
    body: bodyHtml(claim, variance),
    note: 'Defensio works the appeal. The variance stays counted here until it is recovered.',
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="save">Hand off</button>`,
  });

  dialog.el.querySelector('[data-act="save"]').addEventListener('click', () => {
    dialog.close({
      reason: dialog.el.querySelector('#ho-reason').value,
      note: dialog.el.querySelector('#ho-note').value.trim(),
    });
  });

  const answer = await dialog.closed;
  if (!answer || typeof answer !== 'object') return null;

  const row = handoffs.create({
    claimId: claim.id,
    contractId: claim.contractId,
    payerId: claim.payerId,
    amount: variance,
    reason: answer.reason,
    note: answer.note,
  });
  toast(`Handed off ${usd(row.amount)} to Defensio`);
  return row;
}

function bodyHtml(claim, variance) {
  const reason = suggestedReason(claim);
  return `
    <dl class="dl dl--narrow">
      <dt>Claim</dt><dd class="t-mono-sm">${esc(claim.claimNo)}</dd>
      <dt>Date of service</dt><dd>${esc(date(claim.dateOfService))}</dd>
      <dt>Charge</dt><dd>${esc(claimsRepo.itemName(claim))} × ${claim.qty}</dd>
      <dt>Expected</dt><dd class="t-mono-sm">${esc(usd(claim.allowedExpected))}</dd>
      <dt>Paid</dt><dd class="t-mono-sm">${esc(usd(claim.allowedPaid))}</dd>
      <dt>Variance</dt><dd class="t-mono-sm">${esc(usd(variance))}</dd>
    </dl>
    <div class="toolbar">
      <label class="field field--grow">
        <span class="icon icon--sm">flag</span>
        <select id="ho-reason" aria-label="Reason">
          ${handoffs.REASONS.map((r) => `<option value="${esc(r)}"${r === reason ? ' selected' : ''}>${esc(r)}</option>`).join('')}
        </select>
      </label>
    </div>
    <label class="field field--area">
      <textarea id="ho-note" rows="3" placeholder="Anything the appeals team should know (optional)"></textarea>
    </label>`;
}
