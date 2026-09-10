// The dialogs an encounter needs before it moves: activate, edit the visit,
// discharge, cancel, re-classify. Each returns true when the repository was
// written to, so the board or the page redraws.
//
// The screen decides who may act — nothing here gates on a role, the way the
// rest of Frontis works. The one guard that lives here is the domain's own:
// charges posted against an encounter make cancelling it a financial
// correction, and the repository refuses it.

import * as encounters from '../../../../data/repositories/encounters.js';
import * as policies from '../../../../data/repositories/policies.js';
import * as eligibility from '../../../../data/repositories/eligibility.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { dateTime, esc } from '../../../../shared/format.js';
import { BED_CLASSES, DEPARTMENTS, WARDS, doctorsIn } from '../../../../data/seed/reference.js';
import { askReason } from '../insurance/policy-actions.js';
import { runAutoCheck } from '../eligibility/eligibility-check.js';
import { policyChainHtml, snapshotCardHtml } from './encounter-classification.js';

const sub = (enc) => `${enc.no} · ${encounters.typeLabel(enc.type)} · ${enc.department}`;

export async function askActivate(no) {
  const enc = encounters.get(no);
  if (!enc || enc.status !== 'Planned') return false;
  const ok = await modal.confirm({
    title: 'Activate encounter',
    body: `${enc.no} was booked for ${dateTime(enc.startAt)}. Activating it opens the visit now, and the start time
      moves to now so the length of stay is counted from the patient's arrival.`,
    confirmLabel: 'Activate',
    tone: 'warning',
    icon: 'play_arrow',
  });
  if (!ok) return false;
  encounters.activate(no);
  toast(`${no} is active`, 'success');
  return true;
}

export async function askCancel(no) {
  const enc = encounters.get(no);
  if (!enc) return false;
  const blocked = encounters.cancelBlocked(enc, currentRole());
  if (blocked) {
    toast(blocked, 'warning');
    return false;
  }
  const reason = await askReason({
    title: 'Cancel encounter',
    sub: sub(enc),
    icon: 'cancel',
    tone: 'critical',
    lede: 'The encounter stays on the register, cancelled, with the reason beside it. Nothing else about it changes.',
    placeholder: 'Patient did not attend; clinic rebooked for next week.',
    confirmLabel: 'Cancel encounter',
  });
  if (!reason) return false;
  encounters.cancel(no, reason);
  toast(`${no} cancelled`, 'success');
  return true;
}

/**
 * Discharge asks for the moment, not the day: the length of stay is counted
 * from it, so the dialog shows what it will be before anything is written.
 */
export async function askDischarge(no) {
  const enc = encounters.get(no);
  if (!enc || enc.status !== 'Active' || enc.type === 'OP') return false;
  const start = local(enc.startAt);

  const dialog = modal.open({
    title: 'Discharge patient',
    sub: esc(sub(enc)),
    icon: 'logout',
    tone: 'warning',
    size: 'md',
    body: `
      <p class="modal__lede">Admitted ${esc(dateTime(enc.startAt))}${
        enc.expectedLos ? `, booked for ${enc.expectedLos} night${enc.expectedLos === 1 ? '' : 's'}` : ''}.</p>
      <dl class="dl">
        <dt>Discharged at *</dt>
        <dd>
          <label class="field"><input type="datetime-local" name="at" min="${esc(start)}" value="${esc(local(new Date().toISOString()))}"></label>
          <div class="field-error" data-error="at" hidden></div>
          <span class="t-body-sm" id="ea-los"></span>
        </dd>
      </dl>`,
    note: 'The length of stay is computed from the admission and kept on the encounter.',
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="ok">Discharge</button>`,
  });

  const input = dialog.el.querySelector('[name="at"]');
  const note = dialog.el.querySelector('#ea-los');
  const box = dialog.el.querySelector('[data-error="at"]');

  const problem = () => {
    if (!input.value) return 'Enter when the patient was discharged.';
    if (new Date(input.value).getTime() < new Date(enc.startAt).getTime()) {
      return 'A discharge cannot be before the admission.';
    }
    return '';
  };

  function drawLos() {
    const message = problem();
    box.hidden = !message;
    box.textContent = message;
    input.closest('.field').classList.toggle('field--invalid', Boolean(message));
    const days = message ? 0 : encounters.lengthOfStay(enc.startAt, new Date(input.value).toISOString());
    note.textContent = message ? '' : `Length of stay ${days} day${days === 1 ? '' : 's'}.`;
  }

  input.addEventListener('input', drawLos);
  dialog.el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="ok"]')) return;
    if (problem()) return drawLos();
    dialog.close(new Date(input.value).toISOString());
  });
  drawLos();

  const at = await dialog.closed;
  if (!at) return false;
  const row = encounters.discharge(no, at);
  if (!row) return false;
  toast(`${no} discharged — ${row.los} day${row.los === 1 ? '' : 's'}`, 'success');
  // What the closing did to the money: deposits applied and the visit
  // reconciled, shown before the desk moves on (amendment 22).
  const { settlementResultHtml } = await import('../accounts/settlement-result.js');
  const result = modal.open({
    title: 'Discharged — settlement',
    sub: esc(sub(row)),
    icon: 'task_alt',
    size: 'md',
    body: settlementResultHtml(no),
    foot: `
      <a class="btn btn--secondary" href="#/frontis/accounts/${esc(row.patientMrn)}/encounters" data-close>Open the account</a>
      <button class="btn btn--primary" data-close>Close</button>`,
  });
  await result.closed;
  return true;
}

/** Edit the visit. Who pays is not here: that is a re-classification. */
export async function askEdit(no) {
  const enc = encounters.get(no);
  if (!enc || !encounters.isOpen(enc)) return false;
  const ip = enc.type === 'IP';

  const dialog = modal.open({
    title: 'Edit visit details',
    sub: esc(sub(enc)),
    icon: 'edit',
    size: 'md',
    body: `
      <dl class="dl">
        <dt>Department *</dt>
        <dd><label class="field"><select name="department">
          ${DEPARTMENTS.map((d) => `<option value="${esc(d)}"${d === enc.department ? ' selected' : ''}>${esc(d)}</option>`).join('')}
        </select></label></dd>
        <dt>Doctor *</dt>
        <dd><label class="field"><select name="doctorId"></select></label></dd>
        ${enc.type === 'OP' ? '' : `
          <dt>Visit reason *</dt>
          <dd><label class="field field--area"><textarea name="visitReason" rows="2">${esc(enc.visitReason)}</textarea></label></dd>`}
        ${ip ? `
          <dt>Ward *</dt>
          <dd><label class="field"><select name="ward">
            ${WARDS.map((w) => `<option value="${esc(w)}"${w === enc.ward ? ' selected' : ''}>${esc(w)}</option>`).join('')}
          </select></label></dd>
          <dt>Bed class *</dt>
          <dd><label class="field"><select name="bedClass">
            ${BED_CLASSES.map((b) => `<option value="${esc(b)}"${b === enc.bedClass ? ' selected' : ''}>${esc(b)}</option>`).join('')}
          </select></label></dd>
          <dt>Expected LOS *</dt>
          <dd><label class="field"><input type="number" name="expectedLos" min="1" max="90" value="${esc(enc.expectedLos ?? '')}"></label></dd>` : ''}
      </dl>
      <div class="field-error" data-error="form" hidden></div>`,
    note: 'The change is recorded in the trail with your name and the time.',
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="ok">Save visit</button>`,
  });

  const el = dialog.el;
  const departmentSel = el.querySelector('[name="department"]');
  const doctorSel = el.querySelector('[name="doctorId"]');

  function drawDoctors() {
    const list = doctorsIn(departmentSel.value);
    const keep = list.some((d) => d.id === enc.doctorId) ? enc.doctorId : list[0]?.id || '';
    doctorSel.innerHTML = list
      .map((d) => `<option value="${esc(d.id)}"${d.id === keep ? ' selected' : ''}>${esc(d.name)}</option>`)
      .join('');
  }

  departmentSel.addEventListener('change', drawDoctors);
  drawDoctors();

  el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="ok"]')) return;
    const values = {};
    for (const input of el.querySelectorAll('[name]')) values[input.name] = input.value.trim();
    const box = el.querySelector('[data-error="form"]');
    const message = !values.doctorId ? 'Choose the attending doctor.'
      : enc.type !== 'OP' && !values.visitReason ? 'Enter the reason for the visit.'
        : ip && !(Number(values.expectedLos) > 0) ? 'Enter the expected length of stay in nights.' : '';
    box.hidden = !message;
    box.textContent = message;
    if (!message) dialog.close(values);
  });

  const values = await dialog.closed;
  if (!values) return false;
  encounters.updateVisit(no, values);
  toast(`${no} updated`, 'success');
  return true;
}

/**
 * Re-classify — the cover changed after the encounter opened. It asks the same
 * question step 3 of registration asks, runs the same check inline, and keeps
 * what it replaces on the encounter.
 */
export async function askReclassify(no) {
  const enc = encounters.get(no);
  if (!enc) return false;
  const blocked = encounters.reclassifyBlocked(enc);
  if (blocked) {
    await modal.confirm({
      title: 'This visit is settled',
      body: `<p class="t-body">${esc(blocked)}</p>`,
      confirmLabel: 'Close',
      tone: 'refusal',
      icon: 'lock',
    });
    return false;
  }
  const state = { policyId: enc.financial.policyId, ref: enc.financial.snapshotRef };

  const dialog = modal.open({
    title: 'Re-classify the encounter',
    sub: esc(sub(enc)),
    icon: 'published_with_changes',
    size: 'lg',
    body: `
      <p class="modal__lede">Choosing a cover asks the payer again. What the encounter opened under is kept, so the
        Financial tab shows both.</p>
      ${policyChainHtml(enc.patientMrn, state.policyId || 'self')}
      <div id="ea-check"></div>
      <dl class="dl">
        <dt>Reason *</dt>
        <dd>
          <label class="field field--area">
            <textarea name="reason" rows="2" placeholder="Card produced at the desk after admission."></textarea>
          </label>
          <div class="field-error" data-error="reason" hidden></div>
        </dd>
      </dl>`,
    note: 'Recorded on the encounter with your name and the time.',
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="ok">Re-classify</button>`,
  });

  const el = dialog.el;
  const drawCheck = () => {
    el.querySelector('#ea-check').innerHTML = snapshotCardHtml(state.ref ? eligibility.get(state.ref) : null);
  };
  drawCheck();

  el.addEventListener('change', (e) => {
    if (e.target.name !== 'policyId') return;
    state.policyId = e.target.value === 'self' ? null : e.target.value;
    const row = runAutoCheck({
      mrn: enc.patientMrn,
      policyId: state.policyId,
      visitType: encounters.VISIT_TYPE_OF[enc.type] || null,
    });
    state.ref = row?.ref || '';
    drawCheck();
  });

  el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="ok"]')) return;
    const input = el.querySelector('[name="reason"]');
    const box = el.querySelector('[data-error="reason"]');
    const message = input.value.trim().length < 5 ? 'Enter why the classification changed.' : '';
    box.hidden = !message;
    box.textContent = message;
    input.closest('.field').classList.toggle('field--invalid', Boolean(message));
    if (!message) dialog.close(input.value.trim());
  });

  const reason = await dialog.closed;
  if (!reason) return false;
  const row = eligibility.get(state.ref);
  const moved = encounters.reclassify(no, {
    policyId: state.policyId,
    snapshotRef: state.ref || null,
    reason,
    overrideRef: row?.override ? row.ref : null,
  });
  if (!moved) {
    toast(encounters.reclassifyBlocked(encounters.get(no)) || `${no} could not be re-classified`, 'warning');
    return false;
  }
  if (state.ref) eligibility.attachEncounter(state.ref, no);
  if (state.policyId) {
    const policy = policies.get(state.policyId);
    if (policy && !policy.usedInEncounters) policy.usedInEncounters = true;
  }
  toast(`${no} re-classified`, 'success');
  return true;
}

/** `datetime-local` wants local wall-clock time, not an ISO instant. */
function local(iso) {
  const when = new Date(iso);
  when.setMinutes(when.getMinutes() - when.getTimezoneOffset());
  return when.toISOString().slice(0, 16);
}
