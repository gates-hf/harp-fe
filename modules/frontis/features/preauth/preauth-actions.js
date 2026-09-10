// The dialogs that send, chase, withdraw and re-ask a pre-authorisation, asked
// the same way from the worklist row, the form's footer and the request page.
//
// Cancelling asks for a reason through the shared one-field dialog the policy,
// pre-registration and referral actions already use — one prompt, one shape,
// one trail entry. The rest are their own dialogs, because what they ask for is
// not a sentence: sending asks for a confirmation that something is about to
// stop moving, and logging a call asks how and which way.

import * as preauth from '../../../../data/repositories/preauth-requests.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { date, esc, usd } from '../../../../shared/format.js';
import { askReason } from '../insurance/policy-actions.js';

/** The subtitle every one of these dialogs carries. */
const sub = (row) => `${preauth.patientName(row)} · ${preauth.coverLabel(row)}`;

/**
 * Send it. The confirmation is not a formality: the services and the
 * justification stop moving here, and a payer that answers about the wrong
 * thing has still answered. Sending opens the printable form, which is what
 * goes to the payer.
 */
export async function askSubmit(no, ctx) {
  const row = preauth.get(no);
  if (!row || !preauth.isDraft(row)) return false;

  const dialog = modal.open({
    title: `Submit ${esc(no)}?`,
    sub: esc(sub(row)),
    icon: 'send',
    size: 'lg',
    body: `
      <p class="modal__lede">The services and the justification below are what the payer will answer against, so
        they stop moving once this is sent. Everything else — documents, calls, the decision itself — is still
        recorded on the request afterwards.</p>
      <table class="tbl">
        <thead><tr><th scope="col">Service</th><th scope="col" class="num">Qty</th>
          <th scope="col" class="num">Requested</th></tr></thead>
        <tbody>
          ${row.services.map((service) => `
            <tr>
              <td>${esc(preauth.serviceLabel(service))}</td>
              <td class="num t-mono-sm">${service.qty}</td>
              <td class="num t-mono-sm">${usd(service.requestedAmount)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div class="toolbar">
        <span class="t-title-sm">Asking for</span>
        <span class="spacer"></span>
        <span class="t-mono-sm">${usd(preauth.requestedTotal(row))}</span>
      </div>
      <p class="t-body-sm">${esc(row.justification)}</p>
      ${row.documents.length
        ? `<p class="t-body-sm">${row.documents.length} document${row.documents.length === 1 ? '' : 's'} attached.</p>`
        : `<div class="alert alert--warning">
             <span class="icon">description</span>
             <div>Nothing is attached. Most refusals turn out to have been missing a report — attach it now if
               there is one.</div>
           </div>`}`,
    note: `${row.priority === 'Urgent' ? 'Urgent: chased after three days without an answer. ' : ''}The change is recorded in the trail with your name and the time.`,
    foot: `
      <button class="btn btn--secondary" data-close>Not yet</button>
      <button class="btn btn--primary" data-close="ok">Submit to the payer</button>`,
  });

  if ((await dialog.closed) !== 'ok') return false;
  const sent = preauth.submit(no);
  if (!sent) return false;
  toast(`${no} submitted to ${preauth.coverLabel(sent)}`, 'success');
  // The printable form is what the payer actually receives, so sending opens
  // the request page scrolled to it, with Print beside it.
  ctx?.navigate(`/frontis/preauth/${no}?print=1`);
  return true;
}

/** Withdrawn by the ward, entered twice, or overtaken by events. */
export async function askCancel(no) {
  const row = preauth.get(no);
  if (!row || !(preauth.isDraft(row) || preauth.isPending(row))) return false;

  const reason = await askReason({
    title: `Cancel ${no}?`,
    sub: sub(row),
    icon: 'cancel',
    tone: 'critical',
    lede: preauth.isPending(row)
      ? 'The request is kept and stops being work: it leaves the worklist and no answer will be recorded against it. Tell the payer as well — a request withdrawn here is still open on their desk.'
      : 'The draft is kept and stops being work. Nothing has been sent, so there is nothing to withdraw with the payer.',
    placeholder: 'The procedure was cancelled — the patient was discharged before it was scheduled.',
    confirmLabel: 'Cancel the request',
  });
  if (!reason) return false;

  preauth.cancel(no, reason);
  toast(`${no} cancelled`, 'success');
  return true;
}

/** The approval ran out, or is about to. Ask again for what is left of it. */
export const askRenew = (no, ctx) => askAgain(no, ctx, 'renew');

/** The payer said no. Ask again, with whatever it said was missing. */
export const askResubmit = (no, ctx) => askAgain(no, ctx, 'resubmit');

async function askAgain(no, ctx, kind) {
  const row = preauth.get(no);
  if (!row) return false;
  const renewal = kind === 'renew';

  const dialog = modal.open({
    title: renewal ? `Renew ${esc(no)}?` : `Resubmit ${esc(no)}?`,
    sub: esc(sub(row)),
    icon: renewal ? 'more_time' : 'restart_alt',
    size: 'md',
    body: `
      <p class="modal__lede">${renewal
        ? `A new draft is opened holding everything this request held, asking for what is left on it${
          row.decision?.validTo ? ` after ${date(row.decision.validTo)}` : ''}. This request stays exactly as the payer left it.`
        : 'A new draft is opened holding everything this request held, asking for the whole of it again. This request stays denied — the chain is what shows the payer changed its mind.'}</p>
      ${!renewal && row.decision?.denialReasonCode
        ? `<div class="alert alert--warning">
             <span class="icon">rule</span>
             <div>
               <div class="title">${esc(preauth.denialLabel(row.decision.denialReasonCode))}</div>
               ${esc(row.decision.note || 'No note was recorded with the refusal.')}
             </div>
           </div>`
        : ''}
      <dl class="dl dl--narrow">
        ${row.services.map((service) => `
          <dt>${esc(preauth.serviceLabel(service))}</dt>
          <dd>${renewal
            ? `${preauth.remainingFor(row, service.itemId)} of ${preauth.authorizedQty(service)} left`
            : `${service.qty} requested${service.lineDecision ? ` · ${esc(service.lineDecision)}` : ''}`}</dd>`).join('')}
      </dl>`,
    note: 'Supporting documents are copied forward; the payer’s own response is not.',
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-close="ok">${renewal ? 'Open the renewal' : 'Open the resubmission'}</button>`,
  });

  if ((await dialog.closed) !== 'ok') return false;
  const draft = renewal ? preauth.renew(no) : preauth.resubmit(no);
  if (!draft) {
    toast(`${no} cannot be ${renewal ? 'renewed' : 'resubmitted'} — one has been opened already`, 'warning');
    return false;
  }
  toast(`${draft.no} opened as ${renewal ? 'a renewal' : 'a resubmission'} of ${no}`, 'success');
  ctx?.navigate(`/frontis/preauth/${draft.no}`);
  return true;
}

/**
 * A call, a portal note, a fax. Always available, including after the decision:
 * chasing an answer, querying one and asking for a copy are all the same act,
 * and the log is what a payer dispute is argued from.
 */
export async function askCommunication(no) {
  const row = preauth.get(no);
  if (!row) return false;

  const dialog = modal.open({
    title: `Log a communication on ${esc(no)}`,
    sub: esc(sub(row)),
    icon: 'forum',
    size: 'md',
    body: `
      <p class="modal__lede">What was said, which way it went and how. It is recorded against the request with
        your name and the time.</p>
      <dl class="dl">
        <dt>Channel *</dt>
        <dd><label class="field">
          <span class="icon icon--sm">contact_support</span>
          <select name="channel">
            ${preauth.CHANNELS.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
          </select>
        </label></dd>
        <dt>Direction *</dt>
        <dd>
          <div class="segmented" role="group" aria-label="Direction">
            <button type="button" data-direction="Out" aria-pressed="true">We contacted them</button>
            <button type="button" data-direction="In" aria-pressed="false">They contacted us</button>
          </div>
        </dd>
        <dt>Note *</dt>
        <dd>
          <label class="field field--area">
            <textarea name="note" rows="3"
                      placeholder="Called the pre-auth desk; reference taken, answer promised within two working days."></textarea>
          </label>
          <div class="field-error" data-error hidden></div>
        </dd>
      </dl>`,
    note: 'The log is append-only. Nothing recorded here is edited later.',
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="ok">Log it</button>`,
  });

  let direction = 'Out';
  dialog.el.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-direction]');
    if (pick) {
      direction = pick.dataset.direction;
      for (const btn of dialog.el.querySelectorAll('[data-direction]')) {
        btn.setAttribute('aria-pressed', String(btn.dataset.direction === direction));
      }
      return;
    }
    if (!e.target.closest('[data-act="ok"]')) return;
    const note = dialog.el.querySelector('[name="note"]').value.trim();
    const box = dialog.el.querySelector('[data-error]');
    box.hidden = Boolean(note);
    box.textContent = note ? '' : 'Enter what was said. An entry with no note records nothing.';
    if (!note) return;
    dialog.close({ channel: dialog.el.querySelector('[name="channel"]').value, direction, note });
  });

  const answer = await dialog.closed;
  if (!answer) return false;
  preauth.logCommunication(no, answer);
  toast(`Logged on ${no}`, 'success');
  return true;
}
