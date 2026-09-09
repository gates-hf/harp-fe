// Register / edit patient — one full page, three tabs, one save.
// #/frontis/patients/new and #/frontis/patients/<mrn>/edit.
//
// Registration runs the duplicate check before anything is written, so the MRN
// is only spent on a patient the clerk has confirmed. Editing an identifier
// asks for a reason, which the trail keeps beside the old and new value.

import * as patients from '../../../../data/repositories/patients.js';
import * as duplicates from '../../../../data/repositories/duplicates.js';
import { toast } from '../../../../shared/toast.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { age, esc, isEmail, isPhone, todayIso } from '../../../../shared/format.js';
import { checkDuplicates } from './duplicate-check.js';
import { askIdentifierReason } from './patient-status.js';
import { documentsHtml, addDocument, handleDocument } from './patient-documents.js';

export const meta = { title: 'Register patient' };

const TABS = [
  { id: 'demographics', label: 'Demographics' },
  { id: 'identifiers', label: 'Identifiers' },
  { id: 'documents', label: 'Documents' },
];

export async function render(mount, ctx) {
  const mrn = ctx.params[1] === 'edit' ? ctx.params[0] : null;
  const patient = mrn ? patients.get(mrn) : null;
  if (mrn && !patient) throw new Error(`No patient ${mrn}`);

  const role = currentRole();
  if (patient?.vip && !role.canViewVip) return restricted(mount, patient.mrn, role);
  if (patient && patient.status === 'Merged') return mergedAway(mount, patient);

  const res = await fetch(new URL('./patient-form.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load patient-form.html (${res.status})`);
  mount.innerHTML = await res.text();

  const title = patient ? `Edit ${patient.nameEn}` : 'Register patient';
  ctx.setHeader(title);
  ctx.setCrumb([
    { label: 'Frontis', path: '/frontis/patients' },
    { label: 'Patients', path: '/frontis/patients' },
    { label: patient ? patient.mrn : 'Register' },
  ]);

  // Registering from somewhere that already knows some of the answers — the
  // conversion screen hands over what the pre-registration captured. It only
  // fills the fields; every rule the form applies is unchanged, which is the
  // point of mounting the real form rather than writing a second one.
  const seed = patient ? null : ctx.prefill || null;

  const state = { tab: 'demographics', vip: patient?.vip || false, photo: patient?.photo || null, errors: {} };
  const $ = (sel) => mount.querySelector(sel);

  $('#pf-title').textContent = title;
  $('#pf-mrn').textContent = patient ? `MRN ${patient.mrn}` : 'MRN assigned on save';
  $('#pf-cancel').href = patient ? `#/frontis/patients/${patient.mrn}` : '#/frontis/patients';
  $('#pf-gender').innerHTML = patients.GENDERS.map(
    (g) => `<option value="${g}"${(patient?.gender || seed?.gender || 'Female') === g ? ' selected' : ''}>${g}</option>`).join('');
  $('#pf-nationality').innerHTML = patients.NATIONALITIES.map(
    (n) => `<option value="${n}"${(patient?.nationality || seed?.nationality || 'Lebanese') === n ? ' selected' : ''}>${n}</option>`).join('');
  $('#pf-cities').innerHTML = patients.cities().map((c) => `<option value="${esc(c)}"></option>`).join('');
  $('#pf-dob').max = todayIso();

  for (const name of ['nameEn', 'nameAr', 'dob', 'phone', 'email', 'address', 'city', 'civilId', 'passportNo']) {
    $(`[name="${name}"]`).value = patient?.[name] ?? seed?.[name] ?? '';
  }

  // The VIP flag is only offered to the roles that can read a VIP record: a
  // role that cannot see one has no business creating one.
  if (role.canViewVip) {
    $('#pf-vip-label').hidden = false;
    $('#pf-vip-row').hidden = false;
    markVip();
  }

  drawTabs();
  drawPhoto();
  showAge();
  drawDocuments();

  function drawTabs() {
    $('#pf-tabs').innerHTML = TABS.map((t) => `
      <button class="sections__tab${t.id === state.tab ? ' is-active' : ''}" role="tab"
              aria-selected="${t.id === state.tab}" data-tab="${t.id}">
        ${t.label}${state.errors[t.id] ? ' <span class="badge badge--critical">fix</span>' : ''}
      </button>`).join('');
    for (const panel of mount.querySelectorAll('[data-panel]')) {
      panel.hidden = panel.dataset.panel !== state.tab;
    }
  }

  function drawDocuments() {
    $('#pf-documents').innerHTML = documentsHtml(patient, { readOnly: false });
  }

  function markVip() {
    for (const btn of mount.querySelectorAll('[data-vip]')) {
      btn.setAttribute('aria-pressed', String(String(state.vip) === btn.dataset.vip));
    }
  }

  // The preview and its Remove button are written rather than switched off:
  // .avatar and .btn set their own display, which outranks [hidden].
  function drawPhoto() {
    $('#pf-photo-preview').innerHTML = state.photo
      ? `<img class="avatar avatar--lg" src="${esc(state.photo)}" alt="">
         <button class="btn btn--ghost btn--sm" data-act="photo-clear">Remove photo</button>`
      : '';
  }

  function showAge() {
    const years = age($('#pf-dob').value);
    $('#pf-age').textContent = years === '—' ? 'Age —' : `Age ${years}`;
  }

  // --- errors ---------------------------------------------------------------

  function clearErrors() {
    state.errors = {};
    for (const box of mount.querySelectorAll('.field-error')) {
      box.hidden = true;
      box.textContent = '';
    }
    for (const field of mount.querySelectorAll('.field--invalid')) field.classList.remove('field--invalid');
  }

  function showError(tab, name, message) {
    state.errors[tab] = true;
    const box = mount.querySelector(`[data-error="${name}"]`);
    if (!box) return;
    box.textContent = message;
    box.hidden = false;
    mount.querySelector(`[name="${name}"]`)?.closest('.field')?.classList.add('field--invalid');
  }

  // --- save -----------------------------------------------------------------

  function read() {
    const values = {};
    const fields = mount.querySelectorAll('[data-panel="demographics"] [name], [data-panel="identifiers"] [name]');
    for (const input of fields) values[input.name] = input.value.trim();
    return {
      ...values,
      gender: $('#pf-gender').value,
      nationality: $('#pf-nationality').value,
      civilId: values.civilId || null,
      passportNo: values.passportNo || null,
      photo: state.photo,
      vip: state.vip,
    };
  }

  function validate(values) {
    clearErrors();
    if (values.nameEn.length < 2) showError('demographics', 'nameEn', 'Enter the patient name in English.');
    if (!values.nameAr) showError('demographics', 'nameAr', 'Enter the patient name in Arabic.');
    if (!values.dob) showError('demographics', 'dob', 'Enter a date of birth.');
    else if (values.dob > todayIso()) showError('demographics', 'dob', 'A date of birth cannot be in the future.');
    if (!isPhone(values.phone)) showError('demographics', 'phone', 'Enter a Lebanese number, for example +961 3 214 587.');
    if (values.email && !isEmail(values.email)) showError('demographics', 'email', 'Enter an email like rami.haddad@gmail.com.');

    if (!values.civilId && !values.passportNo) {
      const box = mount.querySelector('[data-error="identifiers"]');
      box.textContent = 'Enter a civil ID or a passport number. A patient with neither cannot be matched to a payer.';
      box.hidden = false;
      state.errors.identifiers = true;
    } else if (mrn) {
      // Registering does not check uniqueness here: an identifier already on
      // file is the duplicate check's first answer, and its dialog names the
      // record and offers to open it. On an edit there is no such dialog, so
      // the clash is a field error.
      const unique = patients.isIdentifierUnique(values.civilId, values.passportNo, mrn);
      if (!unique.civilId) showError('identifiers', 'civilId', 'Another patient already carries this civil ID.');
      if (!unique.passportNo) showError('identifiers', 'passportNo', 'Another patient already carries this passport number.');
    }

    // The first tab carrying an error is the one to open — the reader should
    // never have to hunt for the field the save complained about.
    const bad = TABS.find((t) => state.errors[t.id]);
    if (bad) state.tab = bad.id;
    drawTabs();
    if (bad) mount.querySelector(`[data-panel="${bad.id}"] .field--invalid input`)?.focus();
    return !bad;
  }

  async function save() {
    const values = read();
    if (!validate(values)) return;
    if (patient) return void saveEdit(values);

    const check = await checkDuplicates(values);
    if (!check.proceed) return;

    const row = patients.create(values);
    for (const match of check.matches) {
      duplicates.create({ mrnA: row.mrn, mrnB: match.mrn, basis: match.basis, justification: check.justification });
    }
    if (check.matches.length) {
      patients.logOverride(row.mrn, check.matches.map((m) => m.mrn), check.justification);
    }
    toast(`${row.nameEn} registered as ${row.mrn}`, 'success');
    ctx.navigate(`/frontis/patients/${row.mrn}`);
  }

  async function saveEdit(values) {
    const changed = ['civilId', 'passportNo'].filter((key) => (patient[key] || null) !== values[key]);
    let reason = '';
    if (changed.length) {
      reason = await askIdentifierReason(patient, changed, values);
      if (!reason) return;
    }
    patients.update(patient.mrn, values, { reason });
    toast(`${values.nameEn} saved`, 'success');
    ctx.navigate(`/frontis/patients/${patient.mrn}`);
  }

  // --- events ---------------------------------------------------------------

  mount.addEventListener('click', async (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) {
      state.tab = tab.dataset.tab;
      return drawTabs();
    }

    const vip = e.target.closest('[data-vip]');
    if (vip) {
      state.vip = vip.dataset.vip === 'true';
      return markVip();
    }

    if (e.target.closest('[data-act="photo-clear"]')) {
      state.photo = null;
      $('#pf-photo').value = '';
      return drawPhoto();
    }

    if (e.target.closest('[data-act="doc-add"]')) {
      if (addDocument(mount, patient.mrn)) drawDocuments();
      return;
    }
    const docAct = e.target.closest('[data-act^="doc-"]')?.dataset.act;
    if (docAct) {
      const id = e.target.closest('[data-doc]')?.dataset.doc;
      if (id && (await handleDocument(docAct, patient.mrn, id))) drawDocuments();
      return;
    }

    if (e.target.closest('[data-act="save"]')) void save();
  });

  $('#pf-dob').addEventListener('input', showAge);

  $('#pf-photo').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    const note = $('#pf-photo-note');
    if (!file) return;
    if (file.size > patients.MAX_PHOTO_BYTES) {
      state.photo = null;
      note.textContent = `${file.name} is over 300 KB, so the demo keeps the record without the image.`;
      return drawPhoto();
    }
    const reader = new FileReader();
    reader.onload = () => {
      state.photo = String(reader.result);
      note.textContent = `${file.name} attached to the record.`;
      drawPhoto();
    };
    reader.readAsDataURL(file);
  });
}

function restricted(mount, mrn, role) {
  mount.innerHTML = `
    <div class="state-view state-view--tall">
      <div class="state-view__glyph"><span class="icon">lock</span></div>
      <div class="state-view__title">Restricted record</div>
      <p class="state-view__body">${esc(mrn)} is a VIP record. You are signed in as ${esc(role.title)}, which reads it
        masked and cannot edit it. A role with VIP access can.</p>
      <div class="state-view__actions">
        <a class="btn btn--secondary" href="#/frontis/patients">Back to Patient Master</a>
      </div>
    </div>`;
}

function mergedAway(mount, patient) {
  mount.innerHTML = `
    <div class="state-view state-view--tall">
      <div class="state-view__glyph"><span class="icon">merge</span></div>
      <div class="state-view__title">Merged record</div>
      <p class="state-view__body">${esc(patient.mrn)} was merged into ${esc(patient.mergedInto)} and is kept read-only,
        so an old wristband still resolves. Edit the record that survived.</p>
      <div class="state-view__actions">
        <a class="btn btn--secondary" href="#/frontis/patients/${esc(patient.mrn)}">Open ${esc(patient.mrn)}</a>
        <a class="btn btn--primary" href="#/frontis/patients/${esc(patient.mergedInto)}/edit">Edit ${esc(patient.mergedInto)}</a>
      </div>
    </div>`;
}
