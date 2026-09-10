// The write-off dialogs: approve (optional note), reject (note required),
// post (the re-validation shown before it is confirmed) and reverse (a
// reason, and a role at the request's tier or higher). Each validates, writes
// through data/repositories/writeoffs.js and says what it did; the page
// redraws on the commit.

import * as writeoffs from '../../../../data/repositories/writeoffs.js';
import * as modal from '../../../../shared/modal.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { toast } from '../../../../shared/toast.js';
import { esc, usd } from '../../../../shared/format.js';

const errorHtml = (text) => (text ? `<div class="alert alert--critical"><span class="icon">error</span><div>${esc(text)}</div></div>` : '');

/** Approve or reject the step that is waiting. `approved` picks the dialog. */
export async function askDecide(id, approved) {
  const row = writeoffs.get(id);
  if (!row) return undefined;
  const step = writeoffs.currentStep(row);
  const gate = writeoffs.canDecide(row, currentRole());
  const dialog = modal.open({
    title: approved ? `Approve ${row.id}` : `Reject ${row.id}`,
    sub: `${usd(row.amountRequested)} · ${row.reasonCode} ${writeoffs.reasonLabel(row.reasonCode)} · ${writeoffs.tierLabel(step?.tier || row.tier.required)}`,
    icon: approved ? 'task_alt' : 'block',
    tone: approved ? '' : 'critical',
    size: 'sm',
    body: `
      <p class="modal__lede">${approved
        ? (row.tier.steps.length > 1 ? `Signs step ${row.tier.steps.filter((s) => s.decision).length + 1} of ${row.tier.steps.length}. ${writeoffs.currentStep(row) && row.tier.steps.filter((s) => !s.decision).length > 1 ? 'The next tier signs after you.' : 'Yours is the last signature — the request becomes Approved.'}` : 'One signature is enough at this tier — the request becomes Approved and can be posted.')
        : 'A refusal ends the ladder. The requester can raise it again with the case made since, linked to this one.'}</p>
      <label class="field field--area">
        <span class="icon icon--sm">notes</span>
        <textarea id="wd-note" rows="3" maxlength="400" placeholder="${approved ? 'Note (optional)' : 'Why it is refused, and what should happen first'}" aria-label="Note"></textarea>
      </label>
      <div id="wd-error">${errorHtml(gate.ok ? '' : gate.why)}</div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn ${approved ? 'btn--primary' : 'btn--danger'}" id="wd-save"${gate.ok ? '' : ' disabled'}>${approved ? 'Approve' : 'Reject'}</button>`,
  });
  const $ = (sel) => dialog.el.querySelector(sel);
  $('#wd-save').addEventListener('click', () => {
    const result = writeoffs.decide(id, { approved, note: $('#wd-note').value.trim() });
    if (result.error) return void ($('#wd-error').innerHTML = errorHtml(result.error));
    toast(result.status === 'Posted' ? `${row.id} approved and posted` : result.status === 'Approved' ? `${row.id} approved` : result.status === 'Rejected' ? `${row.id} rejected` : `${row.id} — step signed, next tier to sign`);
    dialog.close(result);
  });
  return dialog.closed;
}

/** Post an approved write-off, showing what the re-validation will do first. */
export async function askPost(id) {
  const row = writeoffs.get(id);
  if (!row) return undefined;
  const outstanding = writeoffs.outstandingFor(row.source, row.side);
  const amount = Math.min(row.amountRequested, outstanding);
  const capped = amount < row.amountRequested;
  const nothing = outstanding <= 0;
  const dialog = modal.open({
    title: `Post ${row.id}`,
    sub: `${row.side === 'Payer' ? `off claim ${row.source.claimNo}` : `off account ${row.source.mrn}`}`,
    icon: 'publish',
    tone: nothing ? 'critical' : capped ? 'warning' : '',
    size: 'sm',
    body: `
      <dl class="dl dl--narrow">
        <dt>Requested</dt><dd class="t-mono-sm">${esc(usd(row.amountRequested))}</dd>
        <dt>Outstanding now</dt><dd class="t-mono-sm">${esc(usd(outstanding))}</dd>
        <dt>Will post</dt><dd class="t-mono-sm">${esc(usd(nothing ? 0 : amount))}</dd>
      </dl>
      <p class="modal__lede">${nothing
        ? 'Nothing is left to write off — the balance has been settled since the request. It cannot be posted.'
        : capped ? `The balance shrank since the request, so the posting is capped at what is outstanding and the note says so. A balance that grew is never chased — the request stands for the amount it named.`
          : row.side === 'Payer'
            ? `Adjusts the claim's open balance by ${usd(amount)}${row.source.kind === 'Denial' ? ' and resolves the denial as written off' : ''}.`
            : `Writes an Adjustment of ${usd(amount)} on the patient's ledger, allocated to the oldest open charges first, so the statement shows it.`}</p>
      <div id="wp-error"></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" id="wp-save"${nothing ? ' disabled' : ''}>Post ${esc(usd(nothing ? 0 : amount))}</button>`,
  });
  const $ = (sel) => dialog.el.querySelector(sel);
  $('#wp-save').addEventListener('click', () => {
    const result = writeoffs.post(id);
    if (result.error) return void ($('#wp-error').innerHTML = errorHtml(result.error));
    toast(`${row.id} posted — ${usd(result.amountPosted)}${result.posting.cappedNote ? ' (capped)' : ''}`);
    dialog.close(result);
  });
  return dialog.closed;
}

/** Reverse a posted write-off: a reason, and a signature at the request's tier or above. */
export async function askReverse(id) {
  const row = writeoffs.get(id);
  if (!row) return undefined;
  const gate = writeoffs.canReverse(row, currentRole());
  const dialog = modal.open({
    title: `Reverse ${row.id}`,
    sub: `${usd(row.amountPosted)} posted ${row.side === 'Payer' ? `on ${row.source.claimNo}` : `on ${row.source.mrn}`}`,
    icon: 'undo',
    tone: 'warning',
    size: 'sm',
    body: `
      <p class="modal__lede">${row.side === 'Payer'
        ? 'Puts the amount back on the claim’s open balance as a linked reversal of the adjustment; the write-off stays on the register as Reversed.'
        : 'Writes the ledger’s Reversal row against the Adjustment, so the patient’s balance is what it was; the write-off stays on the register as Reversed.'}</p>
      <label class="field field--area">
        <span class="icon icon--sm">notes</span>
        <textarea id="wr-reason" rows="3" maxlength="400" placeholder="Why the posting is being undone" aria-label="Reason"></textarea>
      </label>
      <div id="wr-error">${errorHtml(gate.ok ? '' : gate.why)}</div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--danger" id="wr-save"${gate.ok ? '' : ' disabled'}>Reverse</button>`,
  });
  const $ = (sel) => dialog.el.querySelector(sel);
  $('#wr-save').addEventListener('click', () => {
    const result = writeoffs.reverse(id, { reason: $('#wr-reason').value.trim() });
    if (result.error) return void ($('#wr-error').innerHTML = errorHtml(result.error));
    toast(`${row.id} reversed — ${usd(row.amountPosted)} put back`);
    dialog.close(result);
  });
  return dialog.closed;
}
