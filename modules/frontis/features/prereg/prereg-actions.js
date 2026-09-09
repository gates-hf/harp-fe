// The two dialogs that close and reopen a pre-registration, asked the same way
// from the worklist row and from the form's footer.
//
// Cancelling asks for a reason through the shared one-field dialog the policy
// actions already use — one prompt, one shape, one trail entry. Reactivating
// asks for the new arrival instead of a reason: the row lapsed because the time
// it was holding has passed, so restoring that time would expire it again on
// the next sweep.

import * as prereg from '../../../../data/repositories/prereg.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { dateTime, esc } from '../../../../shared/format.js';
import { askReason } from '../insurance/policy-actions.js';

/** Resolves true when the row was cancelled. */
export async function askCancel(no) {
  const row = prereg.get(no);
  if (!row || !prereg.isOpen(row)) return false;

  const reason = await askReason({
    title: `Cancel ${no}?`,
    sub: `${prereg.patientName(row)} · ${prereg.typeLabel(row.visit.type)} · ${dateTime(row.visit.expectedAt)}`,
    icon: 'event_busy',
    tone: 'critical',
    lede: 'The pre-registration is kept and stops being work: it leaves the worklist and cannot be converted. Nothing has been written against a patient record yet.',
    placeholder: 'Patient rescheduled the operation to next month and will call to rebook.',
    confirmLabel: 'Cancel the pre-registration',
  });
  if (!reason) return false;

  prereg.cancel(no, reason);
  toast(`${no} cancelled`, 'success');
  return true;
}

/** Resolves true when an expired row was put back on the worklist. */
export async function askReactivate(no) {
  const row = prereg.get(no);
  if (!row || row.status !== 'Expired') return false;

  const dialog = modal.open({
    title: `Reactivate ${esc(no)}`,
    sub: `${esc(prereg.patientName(row))} · expected ${dateTime(row.visit.expectedAt)}`,
    icon: 'event_repeat',
    size: 'md',
    body: `
      <p class="modal__lede">This arrival came and went, so the row was retired ${prereg.CONFIG.preregExpiryHours}
        hours after the time it was holding. Give it the new one and it goes back on the worklist with everything
        it already captured.</p>
      <dl class="dl">
        <dt>New expected arrival *</dt>
        <dd>
          <label class="field"><input type="datetime-local" name="expectedAt" value="${esc(soon())}"></label>
          <div class="field-error" data-error="expectedAt" hidden></div>
        </dd>
      </dl>`,
    note: 'The pre-check is kept. Re-run it from the form if the cover has moved since.',
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="ok">Reactivate</button>`,
  });

  dialog.el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="ok"]')) return;
    const input = dialog.el.querySelector('[name="expectedAt"]');
    const box = dialog.el.querySelector('[data-error="expectedAt"]');
    const at = Date.parse(input.value);
    const message = !input.value ? 'Enter when the patient is now expected.'
      : at <= Date.now() ? 'The new arrival has to be ahead of now, or the row expires again on the next sweep.'
        : '';
    box.hidden = !message;
    box.textContent = message;
    input.closest('.field').classList.toggle('field--invalid', Boolean(message));
    if (message) return input.focus();
    dialog.close(new Date(at).toISOString());
  });

  const answer = await dialog.closed;
  if (typeof answer !== 'string') return false;
  prereg.reactivate(no, answer);
  toast(`${no} is back on the worklist`, 'success');
  return true;
}

/** Tomorrow morning, in the local wall-clock shape the input wants. */
function soon() {
  const when = new Date(Date.now() + 24 * 3600000);
  when.setHours(9, 0, 0, 0);
  when.setMinutes(when.getMinutes() - when.getTimezoneOffset());
  return when.toISOString().slice(0, 16);
}
