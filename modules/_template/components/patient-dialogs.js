// Dialogs shared inside this module only. Cross-module reuse belongs in
// shared/ instead. The dialog shell itself is shared/modal.js.

import * as patients from '../../../data/repositories/patients.js';
import * as modal from '../../../shared/modal.js';
import { toast } from '../../../shared/toast.js';
import { usd, usdToLbp, date, age, esc, isPhone } from '../../../shared/format.js';
import { current as currentRole } from '../../../shared/roles.js';

/** Read-only detail with one state-changing action. Resolves when closed. */
export async function openDetail(id) {
  const p = patients.get(id);
  if (!p) return null;

  const s = patients.statusOf(p.status);
  const canDischarge = p.status === 'inpatient' || p.status === 'emergency';
  const role = currentRole();
  const allowed = ['physician', 'nurse'].includes(role.id);

  const dialog = modal.open({
    title: esc(p.name),
    sub: `MRN ${p.mrn} · ${age(p.dob)} years · ${p.sex === 'F' ? 'Female' : 'Male'}`,
    icon: 'person',
    size: 'lg',
    body: `
      <div class="detail-banner__meta">
        <span class="badge${s.tone ? ` badge--${s.tone}` : ''}"><span class="dot"></span>${s.label}</span>
        <span class="badge">${esc(p.department)}</span>
        <span class="badge">${esc(p.city)}</span>
      </div>
      <dl class="dl">
        <dt>Phone</dt><dd class="t-mono-sm">${esc(p.phone)}</dd>
        <dt>City</dt><dd>${esc(p.city)}</dd>
        <dt>Insurer</dt><dd>${esc(p.insurer)}</dd>
        <dt>Date of birth</dt><dd class="t-mono-sm">${date(p.dob)}</dd>
        <dt>Admitted</dt><dd class="t-mono-sm">${date(p.admittedOn)}</dd>
        <dt>Last visit</dt><dd class="t-mono-sm">${date(p.lastVisit)}</dd>
        <dt>Patient balance</dt><dd class="t-mono-sm">${usd(p.balanceUsd)} — ${usdToLbp(p.balanceUsd)}</dd>
      </dl>`,
    note: allowed ? '' : `Discharge requires a clinical role. You are signed in as ${esc(role.title)}.`,
    foot: `
      <button class="btn btn--secondary" data-close>Close</button>
      <button class="btn btn--primary" data-act="discharge"
        ${canDischarge && allowed ? '' : 'disabled'}
        title="${dischargeHint(canDischarge, allowed, s.label)}">
        <span class="icon icon--sm">logout</span>Discharge patient
      </button>`,
  });

  dialog.el.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-act="discharge"]')) return;
    const ok = await modal.confirm({
      title: 'Discharge patient',
      body: `${p.name} is discharged from ${p.department} and the encounter closes for coding.`,
      confirmLabel: 'Discharge',
      icon: 'logout',
    });
    if (!ok) return;
    patients.discharge(p.id);
    dialog.close('discharged');
    toast(`${p.name} discharged`, 'success');
  });

  return dialog.closed;
}

function dischargeHint(canDischarge, allowed, label) {
  if (!allowed) return 'Your role cannot discharge patients';
  if (!canDischarge) return `Patient is ${label.toLowerCase()}`;
  return 'Close this encounter';
}

/** New-patient form. Validates, saves, resolves with the row or undefined. */
export async function openNew() {
  const dialog = modal.open({
    title: 'Add patient',
    sub: 'Registration creates the MRN automatically.',
    icon: 'person_add',
    size: 'lg',
    body: `
      <dl class="dl">
        <dt><label for="np-name">Full name</label></dt>
        <dd><label class="field"><input id="np-name" name="name" autofocus placeholder="Rami Haddad"></label></dd>
        <dt><label for="np-dob">Date of birth</label></dt>
        <dd><label class="field"><input id="np-dob" name="dob" type="date" max="${new Date().toISOString().slice(0, 10)}"></label></dd>
        <dt><label for="np-sex">Sex</label></dt>
        <dd><label class="field"><select id="np-sex" name="sex"><option value="F">Female</option><option value="M">Male</option></select></label></dd>
        <dt><label for="np-phone">Phone</label></dt>
        <dd><label class="field"><input id="np-phone" name="phone" placeholder="+961 3 214 587"></label></dd>
        <dt><label for="np-city">City</label></dt>
        <dd><label class="field"><select id="np-city" name="city">${options(patients.cities())}</select></label></dd>
        <dt><label for="np-insurer">Insurer</label></dt>
        <dd><label class="field"><select id="np-insurer" name="insurer">${options(patients.insurers())}</select></label></dd>
        <dt><label for="np-dept">Department</label></dt>
        <dd><label class="field"><select id="np-dept" name="department">${options(departments())}</select></label></dd>
      </dl>
      <div class="field-error" id="np-error" hidden></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="save">Save patient</button>`,
  });

  dialog.el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="save"]')) return;
    const values = read(dialog.el);
    const error = validate(values);
    const box = dialog.el.querySelector('#np-error');

    for (const field of dialog.el.querySelectorAll('.field')) field.classList.remove('field--invalid');
    box.hidden = !error;
    if (error) {
      box.textContent = error.message;
      const bad = dialog.el.querySelector(`[name="${error.field}"]`);
      bad?.closest('.field')?.classList.add('field--invalid');
      bad?.focus();
      return;
    }

    const row = patients.create({ ...values, status: 'outpatient' });
    dialog.close(row);
  });

  return dialog.closed;
}

function options(list) {
  return list.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
}

function departments() {
  return [...new Set(patients.all().map((p) => p.department))].sort();
}

function read(root) {
  const values = {};
  for (const el of root.querySelectorAll('[name]')) values[el.name] = el.value.trim();
  return values;
}

function validate(v) {
  if (v.name.length < 3) return { field: 'name', message: 'Enter the patient’s full name.' };
  if (!v.dob) return { field: 'dob', message: 'Enter a date of birth.' };
  if (new Date(v.dob) > new Date()) return { field: 'dob', message: 'Date of birth cannot be in the future.' };
  if (!isPhone(v.phone)) return { field: 'phone', message: 'Enter a Lebanese number, for example +961 3 214 587.' };
  return null;
}
