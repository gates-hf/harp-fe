// The dialogs that ask for what the trail will need before a record changes: a
// date of death, a reason to block, a reason to lift the block, a confirmation
// before a record is restricted, and the reason a changed identifier needs.
//
// The four status dialogs write through the repository and return true when the
// record changed, so the caller redraws; the identifier one only asks, because
// the form saves the whole record in one call. Nothing here decides who may do
// it — the screen gates the button on the role and says which role is missing.

import * as patients from '../../../../data/repositories/patients.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { esc, todayIso } from '../../../../shared/format.js';

export async function askDeceased(patient) {
  const value = await ask({
    title: 'Mark deceased',
    sub: `${patient.mrn} — ${patient.nameEn}`,
    icon: 'sentiment_very_dissatisfied',
    tone: 'critical',
    lede: 'The record stays on file and stays readable. No encounter can be opened against it afterwards.',
    field: `<label class="field"><input name="value" type="date" max="${todayIso()}" value="${todayIso()}"></label>`,
    label: 'Date of death *',
    confirmLabel: 'Mark deceased',
    validate: (v) => {
      if (!v) return 'Enter the date of death.';
      if (v > todayIso()) return 'The date of death cannot be in the future.';
      return '';
    },
  });
  if (!value) return false;
  patients.setStatus(patient.mrn, 'Deceased', { deceasedAt: value });
  toast(`${patient.nameEn} marked deceased`, 'success');
  return true;
}

export async function askBlock(patient) {
  const reason = await ask({
    title: 'Block patient',
    sub: `${patient.mrn} — ${patient.nameEn}`,
    icon: 'block',
    tone: 'warning',
    lede: 'Registration will refuse a new encounter and show this reason. The record stays readable and editable.',
    field: '<label class="field field--area"><textarea name="value" rows="3" placeholder="Unsettled balance from the August admission — refer to the finance office."></textarea></label>',
    label: 'Reason *',
    confirmLabel: 'Block patient',
    validate: (v) => (v.length < 10 ? 'Enter the reason. It is what the desk reads when the patient comes back.' : ''),
  });
  if (!reason) return false;
  patients.setStatus(patient.mrn, 'Blocked', { reason });
  toast(`${patient.nameEn} blocked`, 'success');
  return true;
}

export async function askUnblock(patient) {
  const reason = await ask({
    title: 'Lift the block',
    sub: `${patient.mrn} — ${patient.nameEn}`,
    icon: 'lock_open',
    lede: `Blocked because: ${patient.blockReason || 'no reason recorded'}`,
    field: '<label class="field field--area"><textarea name="value" rows="3" placeholder="Balance settled in full at the cashier."></textarea></label>',
    label: 'Reason *',
    confirmLabel: 'Lift the block',
    validate: (v) => (v.length < 5 ? 'Enter why the block is being lifted.' : ''),
  });
  if (!reason) return false;
  patients.setStatus(patient.mrn, 'Active', { reason });
  toast(`Block lifted on ${patient.nameEn}`, 'success');
  return true;
}

export async function askVip(patient, on) {
  const ok = await modal.confirm({
    title: on ? 'Restrict this record' : 'Remove the restriction',
    body: on
      ? `${patient.nameEn} is masked for every role without VIP access: the name reads as initials, the identifiers as their last two digits, and the phone, address and documents are withheld.`
      : `${patient.nameEn} becomes readable by every role, documents included.`,
    confirmLabel: on ? 'Mark VIP' : 'Remove VIP',
    tone: on ? 'warning' : 'critical',
    icon: on ? 'shield_person' : 'shield',
  });
  if (!ok) return false;
  patients.setVip(patient.mrn, on);
  toast(on ? `${patient.nameEn} is now a VIP record` : `${patient.nameEn} is no longer restricted`, 'success');
  return true;
}

/**
 * A changed identifier is the edit an auditor comes looking for, so the form
 * asks here rather than saving quietly. Same dialog as the three above: the
 * old and new value read as the lede, and the reason is the one field.
 */
export function askIdentifierReason(patient, changed, values) {
  return ask({
    title: 'Why is the identifier changing?',
    sub: `${patient.mrn} — ${patient.nameEn}`,
    icon: 'fingerprint',
    lede: changed
      .map((key) => `${patients.fieldLabel(key)}: ${patient[key] || '—'} → ${values[key] || '—'}`)
      .join(' · '),
    field: '<label class="field field--area"><textarea name="value" rows="3" placeholder="Civil ID corrected against the original document presented today."></textarea></label>',
    label: 'Reason *',
    confirmLabel: 'Save the change',
    validate: (v) => (v.length < 5 ? 'Enter the reason for the change.' : ''),
  });
}

/** One field, one reason, one answer — the shape every dialog here shares. */
async function ask({ title, sub, icon, tone = 'warning', lede, field, label, confirmLabel, validate }) {
  const dialog = modal.open({
    title,
    sub: esc(sub),
    icon,
    tone,
    size: 'md',
    body: `
      <p class="modal__lede">${esc(lede)}</p>
      <dl class="dl">
        <dt>${esc(label)}</dt>
        <dd>${field}<div class="field-error" data-error="value" hidden></div></dd>
      </dl>`,
    note: 'The change is recorded in the trail with your name and the time.',
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn ${tone === 'critical' ? 'btn--danger' : 'btn--primary'}" data-act="ok">${esc(confirmLabel)}</button>`,
  });

  dialog.el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="ok"]')) return;
    const input = dialog.el.querySelector('[name="value"]');
    const box = dialog.el.querySelector('[data-error="value"]');
    const value = input.value.trim();
    const message = validate(value);
    box.hidden = !message;
    box.textContent = message;
    input.closest('.field').classList.toggle('field--invalid', Boolean(message));
    if (message) return input.focus();
    dialog.close(value);
  });

  return dialog.closed;
}
