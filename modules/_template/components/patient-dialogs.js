// Dialogs shared inside this module only. Cross-module reuse belongs in
// shared/ instead. The dialog shell itself is shared/modal.js.
//
// The patient registry is owned by modules/frontis; this module reads and
// writes it through data/repositories/patients.js like any other consumer.

import * as patients from '../../../data/repositories/patients.js';
import * as modal from '../../../shared/modal.js';
import { toast } from '../../../shared/toast.js';
import { date, age, esc, isPhone, todayIso } from '../../../shared/format.js';
import { current as currentRole } from '../../../shared/roles.js';

/** Read-only detail with one state-changing action. Resolves when closed. */
export async function openDetail(mrn) {
  const role = currentRole();
  const p = patients.view(patients.get(mrn), role);
  if (!p) return null;

  const tone = patients.statusTone(p.status);
  const blocked = p.status === 'Blocked';
  const allowed = role.canBlockPatients;

  const dialog = modal.open({
    title: esc(p.nameEn),
    sub: `${esc(p.mrn)} · ${age(p.dob)} years · ${esc(p.gender)}`,
    icon: 'person',
    size: 'lg',
    body: `
      <div class="detail-banner__meta">
        <span class="badge${tone ? ` badge--${tone}` : ''}"><span class="dot"></span>${p.status}</span>
        ${p.vip && !p.masked ? '<span class="badge badge--accent">VIP</span>' : ''}
        ${p.masked ? '<span class="badge">Restricted</span>' : ''}
        <span class="badge">${esc(p.nationality)}</span>
        ${p.city ? `<span class="badge">${esc(p.city)}</span>` : ''}
      </div>
      <dl class="dl">
        <dt>Name (AR)</dt><dd dir="rtl">${esc(p.nameAr)}</dd>
        <dt>Date of birth</dt><dd class="t-mono-sm">${date(p.dob)}</dd>
        <dt>Civil ID</dt><dd class="t-mono-sm">${p.civilId ? esc(p.civilId) : '—'}</dd>
        <dt>Passport no.</dt><dd class="t-mono-sm">${p.passportNo ? esc(p.passportNo) : '—'}</dd>
        <dt>Phone</dt><dd class="t-mono-sm">${p.phone ? esc(p.phone) : '—'}</dd>
        <dt>Last visit</dt><dd class="t-mono-sm">${date(p.lastVisitAt)}</dd>
      </dl>
      ${blocked ? `<div class="alert alert--warning"><span class="icon">block</span><div>${esc(p.blockReason)}</div></div>` : ''}`,
    note: allowed ? '' : `Blocking a patient needs a registration role. You are signed in as ${esc(role.title)}.`,
    foot: `
      <a class="btn btn--secondary" href="#/frontis/patients/${esc(p.mrn)}" data-close>
        <span class="icon icon--sm">open_in_new</span>Open in Frontis
      </a>
      <button class="btn ${blocked ? 'btn--primary' : 'btn--danger'}" data-act="block"
        ${allowed && p.status !== 'Merged' && p.status !== 'Deceased' ? '' : 'disabled'}
        title="${blockHint(allowed, p)}">
        <span class="icon icon--sm">${blocked ? 'lock_open' : 'block'}</span>${blocked ? 'Lift the block' : 'Block patient'}
      </button>`,
  });

  dialog.el.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-act="block"]')) return;
    const ok = await modal.confirm({
      title: blocked ? 'Lift the block' : 'Block patient',
      body: blocked
        ? `${p.nameEn} can be registered for an encounter again.`
        : `${p.nameEn} stays on file and stays readable, and registration will refuse a new encounter.`,
      confirmLabel: blocked ? 'Lift the block' : 'Block',
      icon: blocked ? 'lock_open' : 'block',
    });
    if (!ok) return;
    patients.setStatus(p.mrn, blocked ? 'Active' : 'Blocked', {
      reason: blocked ? 'Lifted from the example screen' : 'Blocked from the example screen',
    });
    dialog.close('changed');
    toast(`${p.nameEn} ${blocked ? 'unblocked' : 'blocked'}`, 'success');
  });

  return dialog.closed;
}

function blockHint(allowed, p) {
  if (!allowed) return 'Your role cannot block patients';
  if (p.status === 'Merged' || p.status === 'Deceased') return `A ${p.status.toLowerCase()} record is read-only`;
  return p.status === 'Blocked' ? 'Let this patient be registered again' : 'Refuse new encounters for this patient';
}

/** New-patient form. Validates, saves, resolves with the row or undefined. */
export async function openNew() {
  const dialog = modal.open({
    title: 'Add patient',
    sub: 'Registration assigns the MRN automatically.',
    icon: 'person_add',
    size: 'lg',
    body: `
      <dl class="dl">
        <dt><label for="np-nameEn">Name (EN)</label></dt>
        <dd><label class="field"><input id="np-nameEn" name="nameEn" autofocus placeholder="Rami Haddad"></label></dd>
        <dt><label for="np-nameAr">Name (AR)</label></dt>
        <dd><label class="field"><input id="np-nameAr" name="nameAr" dir="rtl" placeholder="رامي حداد"></label></dd>
        <dt><label for="np-dob">Date of birth</label></dt>
        <dd><label class="field"><input id="np-dob" name="dob" type="date" max="${todayIso()}"></label></dd>
        <dt><label for="np-gender">Gender</label></dt>
        <dd><label class="field"><select id="np-gender" name="gender">${options(patients.GENDERS)}</select></label></dd>
        <dt><label for="np-nationality">Nationality</label></dt>
        <dd><label class="field"><select id="np-nationality" name="nationality">${options(patients.NATIONALITIES)}</select></label></dd>
        <dt><label for="np-civilId">Civil ID</label></dt>
        <dd><label class="field"><input id="np-civilId" name="civilId" placeholder="61784120"></label></dd>
        <dt><label for="np-phone">Phone</label></dt>
        <dd><label class="field"><input id="np-phone" name="phone" placeholder="+961 3 214 587"></label></dd>
        <dt><label for="np-city">City</label></dt>
        <dd><label class="field"><select id="np-city" name="city">${options(patients.cities())}</select></label></dd>
      </dl>
      <div class="field-error" id="np-error" hidden></div>`,
    note: 'The full registration, with duplicate detection, is in Frontis.',
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

    dialog.close(patients.create({ ...values, civilId: values.civilId || null }));
  });

  return dialog.closed;
}

function options(list) {
  return list.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
}

function read(root) {
  const values = {};
  for (const el of root.querySelectorAll('[name]')) values[el.name] = el.value.trim();
  return values;
}

function validate(v) {
  if (v.nameEn.length < 3) return { field: 'nameEn', message: 'Enter the patient’s name in English.' };
  if (!v.nameAr) return { field: 'nameAr', message: 'Enter the patient’s name in Arabic.' };
  if (!v.dob) return { field: 'dob', message: 'Enter a date of birth.' };
  if (v.dob > todayIso()) return { field: 'dob', message: 'Date of birth cannot be in the future.' };
  if (!v.civilId) return { field: 'civilId', message: 'Enter a civil ID — every record needs one identifier.' };
  if (!patients.isIdentifierUnique(v.civilId, null).civilId) {
    return { field: 'civilId', message: 'Another patient already carries this civil ID.' };
  }
  if (!isPhone(v.phone)) return { field: 'phone', message: 'Enter a Lebanese number, for example +961 3 214 587.' };
  return null;
}
