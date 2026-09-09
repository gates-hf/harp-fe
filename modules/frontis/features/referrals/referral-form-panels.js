// The three panels of the referral form, as markup, plus the rail beside them.
// referral-form.js owns the state and every write; this file only draws.
//
// The design system ships no combobox, so a facility or a doctor is a select of
// what the register already holds with one extra option — "Type a new name" —
// that reveals a plain field. Typing there is what creates the source, which is
// the amendment's growing list drawn in the vocabulary the system does have.

import * as referrals from '../../../../data/repositories/referrals.js';
import * as sources from '../../../../data/repositories/referral-sources.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import { DEPARTMENTS, SPECIALTIES, departmentOf, doctorsIn } from '../../../../data/seed/reference.js';
import { date, dateTime, esc, fileSize } from '../../../../shared/format.js';

const PICKER_LIMIT = 6;

/** The value that turns a picker into a text field. */
export const NEW = '__new';

// --- rail ---------------------------------------------------------------------

/** What the referral says so far, and the buttons that close or spend it. */
export function summaryHtml(state, stored) {
  const inbound = state.direction === 'Inbound';
  return `
    <dl class="dl dl--narrow">
      <dt>Direction</dt><dd>${esc(state.direction)}</dd>
      <dt>Type</dt><dd>${esc(state.type)}</dd>
      <dt>Patient</dt>
      <dd>${state.patientMrn
        ? `${esc(patients.get(state.patientMrn)?.nameEn || state.patientMrn)}
           <span class="t-mono-sm">${esc(state.patientMrn)}</span>`
        : state.unregistered.name
          ? `${esc(state.unregistered.name)} <span class="badge">Unregistered</span>`
          : '<span class="t-body-sm">Not chosen</span>'}</dd>
      <dt>${inbound ? 'Referred by' : 'Referred to'}</dt>
      <dd>${esc(partyPreview(state) || '—')}</dd>
      <dt>Specialty</dt><dd>${esc(state.dst.specialty || '—')}</dd>
      <dt>Referral date</dt><dd class="t-mono-sm">${state.referralDate ? date(state.referralDate) : '—'}</dd>
      <dt>Valid until</dt><dd class="t-mono-sm">${state.validUntil ? date(state.validUntil) : 'No end date'}</dd>
      <dt>Visits</dt><dd>${esc(String(state.visitsTotal || 1))}</dd>
      ${stored ? `<dt>Status</dt><dd>${esc(stored.status)}</dd>` : ''}
    </dl>`;
}

/** The party the referral names, as far as the form has been filled in. */
function partyPreview(state) {
  if (state.direction === 'Inbound') {
    if (state.type === 'Internal') return state.src.department || '';
    const facility = state.src.facilityId === NEW ? state.src.facilityNew : sources.name(state.src.facilityId);
    const doctor = state.src.doctorId === NEW ? state.src.doctorNew : sources.get(state.src.doctorId)?.name || '';
    return [facility, doctor].filter(Boolean).join(' · ');
  }
  const facility = state.dst.facilityId === NEW ? state.dst.facilityNew : sources.name(state.dst.facilityId);
  return [facility, state.dst.doctorName].filter(Boolean).join(' · ');
}

export function footerHtml(state, stored) {
  const open = !stored || referrals.isOpen(stored);
  return `
    <div class="toolbar">
      <button class="btn btn--primary btn--sm" data-act="save">
        <span class="icon icon--sm">save</span>${state.no ? 'Save referral' : 'Create referral'}
      </button>
      <span class="spacer"></span>
    </div>
    ${state.no ? `
      <div class="toolbar">
        <a class="btn btn--secondary btn--sm" href="#/frontis/referrals/${esc(state.no)}/view">
          <span class="icon icon--sm">visibility</span>Open the referral
        </a>
        <span class="spacer"></span>
      </div>
      <div class="toolbar">
        ${open && state.patientMrn
          ? `<button class="btn btn--secondary btn--sm" data-act="schedule">
               <span class="icon icon--sm">event_upcoming</span>Schedule</button>`
          : `<button class="btn btn--secondary btn--sm" disabled title="${esc(open
              ? 'Register the patient first — there is nothing to book an arrival against'
              : `A ${stored.status.toLowerCase()} referral holds no place`)}">
               <span class="icon icon--sm">event_upcoming</span>Schedule</button>`}
        <span class="spacer"></span>
      </div>
      <div class="toolbar">
        ${open
          ? `<button class="btn btn--ghost btn--sm" data-act="cancel">
               <span class="icon icon--sm">cancel</span>Cancel referral</button>`
          : `<button class="btn btn--ghost btn--sm" disabled title="This referral is already ${esc(stored.status.toLowerCase())}">
               <span class="icon icon--sm">cancel</span>Cancel referral</button>`}
        <span class="spacer"></span>
      </div>` : `
      <p class="t-body-sm">Nothing is written until the referral is created. Scheduling and linking are offered
        once it has a number.</p>`}`;
}

export function bannerHtml(stored) {
  if (!stored || referrals.isOpen(stored)) return '';
  return `
    <div class="alert alert--${stored.status === 'Used' ? 'info' : stored.status === 'Expired' ? 'warning' : 'critical'}">
      <span class="icon">${stored.status === 'Used' ? 'task_alt' : stored.status === 'Expired' ? 'schedule' : 'block'}</span>
      <div>
        <div class="title">${esc(stored.status)}</div>
        ${esc(stored.statusReason || (stored.status === 'Used'
          ? 'Every visit written on this referral has been opened.'
          : `Valid until ${date(stored.validUntil)}.`))} It is read-only —
        <a class="crumb-link" href="#/frontis/referrals/${esc(stored.no)}/view">open the referral</a>.
      </div>
    </div>`;
}

// --- panel 1: who ------------------------------------------------------------

/**
 * An inbound referral may be for somebody with no record — a clinic phoned with
 * a name and a number. An outbound one cannot: it is written from a visit here,
 * so the patient is on the register by definition.
 */
export function patientPanel(state, role) {
  const inbound = state.direction === 'Inbound';
  if (state.patientMrn) {
    const p = patients.view(patients.get(state.patientMrn), role);
    return `
      <div class="rule-child-row">
        <span class="icon icon--lg">person</span>
        <div>
          <div class="t-title-sm">${esc(p?.nameEn || state.patientMrn)}
            ${p?.masked ? '<span class="badge">Restricted</span>' : ''}</div>
          <span class="t-mono-sm">${esc(state.patientMrn)}</span>
          <span class="t-body-sm">${esc(p?.phone || '')}</span>
        </div>
        <span class="spacer"></span>
        <button class="btn btn--ghost btn--sm" data-act="unpick">
          <span class="icon icon--sm">swap_horiz</span>Choose another
        </button>
      </div>`;
  }
  return `
    ${inbound ? `
      <div class="toolbar">
        <span class="t-body-sm">Who the referral is for</span>
        <span class="spacer"></span>
        <span class="segmented" role="group" aria-label="Patient">
          <button type="button" data-mode="patient" aria-pressed="${state.mode === 'patient'}">On the register</button>
          <button type="button" data-mode="unregistered" aria-pressed="${state.mode === 'unregistered'}">Unregistered person</button>
        </span>
      </div>` : ''}
    ${!inbound || state.mode === 'patient' ? searchHtml(state, role) : unregisteredHtml(state)}`;
}

function searchHtml(state, role) {
  const needle = state.q.trim();
  const found = needle.length >= 2 ? patients.search(needle).slice(0, PICKER_LIMIT) : [];
  return `
    <label class="field field--grow">
      <span class="icon icon--sm">search</span>
      <input type="search" id="rf-q" value="${esc(state.q)}"
             placeholder="Search name, MRN, civil ID or phone" aria-label="Search patients">
    </label>
    ${needle.length < 2
      ? '<p class="t-body-sm">Type at least two characters to find the patient.</p>'
      : found.length
        ? `<table class="tbl">
             <thead><tr><th scope="col">Patient</th><th scope="col">MRN</th><th scope="col">Phone</th><th scope="col"></th></tr></thead>
             <tbody>${found.map((raw) => {
               const p = patients.view(raw, role);
               return `
                 <tr data-mrn="${esc(p.mrn)}">
                   <td>${esc(p.nameEn)}</td>
                   <td class="t-mono-sm">${esc(p.mrn)}</td>
                   <td class="t-mono-sm">${esc(p.phone || '—')}</td>
                   <td><button class="btn btn--secondary btn--sm" data-act="pick">Choose</button></td>
                 </tr>`;
             }).join('')}</tbody>
           </table>`
        : `<p class="t-body-sm">Nothing on the register matches “${esc(needle)}”.${
            state.direction === 'Inbound'
              ? ' Take the details as an unregistered person — registration finds the referral by the phone number.'
              : ''}</p>`}`;
}

function unregisteredHtml(state) {
  return `
    <p class="t-body-sm">The clinic gave a name and a number and nothing else. Registering this patient later finds
      the referral by that number and attaches it, so nothing has to be typed twice.</p>
    <dl class="dl">
      <dt>Name *</dt>
      <dd><label class="field"><input type="text" name="name" value="${esc(state.unregistered.name)}"
                                     placeholder="Jad Moukarzel"></label></dd>
      <dt>Phone *</dt>
      <dd><label class="field"><input type="tel" name="phone" value="${esc(state.unregistered.phone)}"
                                     placeholder="+961 3 447 219"></label></dd>
    </dl>`;
}

// --- panel 2: the two ends ---------------------------------------------------

export function partiesPanel(state) {
  const internal = state.type === 'Internal';
  return `
    <dl class="dl">
      <dt>Type *</dt>
      <dd>
        <label class="field">
          <select name="type">
            ${referrals.TYPES.map((t) => `<option value="${t}"${t === state.type ? ' selected' : ''}>${t}</option>`).join('')}
          </select>
        </label>
        <span class="t-body-sm">${internal
          ? 'One of our own departments referring to another.'
          : 'A doctor outside this hospital.'}</span>
      </dd>
      ${state.direction === 'Inbound' ? inboundSourceHtml(state, internal) : outboundHtml(state)}
      ${destinationHtml(state)}
    </dl>`;
}

function inboundSourceHtml(state, internal) {
  if (internal) {
    return `
      <dt>Referring department *</dt>
      <dd>
        <label class="field">
          <select name="src.department">
            <option value="">Choose a department</option>
            ${DEPARTMENTS.map((d) => `<option value="${esc(d)}"${d === state.src.department ? ' selected' : ''}>${esc(d)}</option>`).join('')}
          </select>
        </label>
      </dd>
      <dt>Referring doctor</dt>
      <dd>
        <label class="field">
          <select name="src.ourDoctorId"${state.src.department ? '' : ' disabled'}>
            <option value="">${state.src.department ? 'Choose a doctor' : 'Choose a department first'}</option>
            ${doctorsIn(state.src.department).map((d) =>
              `<option value="${esc(d.id)}"${d.id === state.src.ourDoctorId ? ' selected' : ''}>${esc(d.name)}</option>`).join('')}
          </select>
        </label>
      </dd>`;
  }
  return `
    <dt>Referring facility *</dt>
    <dd>${comboHtml('src.facilityId', 'src.facilityNew', state.src.facilityId, state.src.facilityNew,
      sources.search('Facility'), 'Choose a facility', 'Clinique Saint-Georges, Achrafieh')}</dd>
    <dt>Referring doctor</dt>
    <dd>${comboHtml('src.doctorId', 'src.doctorNew', state.src.doctorId, state.src.doctorNew,
      sources.search('Doctor', '', { facilityId: realId(state.src.facilityId) }),
      'Choose a doctor', 'Dr. Samir Khalifeh')}
      <span class="t-body-sm">Narrowed to the facility above. A name nothing matches is added to the register.</span>
    </dd>`;
}

function outboundHtml(state) {
  const open = state.patientMrn ? encounters.byPatient(state.patientMrn).filter(encounters.isOpen) : [];
  return `
    <dt>Referring department *</dt>
    <dd>
      <label class="field">
        <select name="src.department">
          <option value="">Choose a department</option>
          ${DEPARTMENTS.map((d) => `<option value="${esc(d)}"${d === state.src.department ? ' selected' : ''}>${esc(d)}</option>`).join('')}
        </select>
      </label>
    </dd>
    <dt>Referring doctor</dt>
    <dd>
      <label class="field">
        <select name="src.ourDoctorId"${state.src.department ? '' : ' disabled'}>
          <option value="">${state.src.department ? 'Choose a doctor' : 'Choose a department first'}</option>
          ${doctorsIn(state.src.department).map((d) =>
            `<option value="${esc(d.id)}"${d.id === state.src.ourDoctorId ? ' selected' : ''}>${esc(d.name)}</option>`).join('')}
        </select>
      </label>
    </dd>
    <dt>Source encounter</dt>
    <dd>
      <label class="field">
        <select name="sourceEncounterNo"${open.length ? '' : ' disabled'}>
          <option value="">${open.length ? 'None' : 'No open encounter'}</option>
          ${open.map((enc) => `<option value="${esc(enc.no)}"${enc.no === state.sourceEncounterNo ? ' selected' : ''}>
            ${esc(enc.no)} — ${esc(enc.department)}, ${esc(dateTime(enc.startAt))}</option>`).join('')}
        </select>
      </label>
      <span class="t-body-sm">The visit this referral was written from. It shows on that encounter's linked records.</span>
    </dd>
    <dt>Destination facility *</dt>
    <dd>${comboHtml('dst.facilityId', 'dst.facilityNew', state.dst.facilityId, state.dst.facilityNew,
      sources.search('Facility'), 'Choose a facility', 'Hôtel-Dieu de France, Achrafieh')}</dd>
    <dt>Destination doctor</dt>
    <dd><label class="field"><input type="text" name="dst.doctorName" value="${esc(state.dst.doctorName)}"
                                   placeholder="Dr. Antoine Karam"></label></dd>`;
}

/** Inbound: which of our services. Outbound: what is being asked for. */
function destinationHtml(state) {
  const inbound = state.direction === 'Inbound';
  const mapped = departmentOf(state.dst.specialty);
  return `
    <dt>Specialty *</dt>
    <dd>
      <label class="field">
        <select name="dst.specialty">
          <option value="">Choose a specialty</option>
          ${SPECIALTIES.map((s) => `<option value="${esc(s)}"${s === state.dst.specialty ? ' selected' : ''}>${esc(s)}</option>`).join('')}
        </select>
      </label>
      <span class="t-body-sm">${inbound
        ? mapped
          ? `Seen in ${esc(mapped)} here, which is the department a visit against this referral has to be booked in.`
          : 'The department this is seen in is set below.'
        : 'What the other hospital is being asked for.'}</span>
    </dd>
    ${inbound ? `
      <dt>Department</dt>
      <dd>
        <label class="field">
          <select name="dst.department">
            <option value="">${mapped ? `From the specialty — ${esc(mapped)}` : 'Any department'}</option>
            ${DEPARTMENTS.map((d) => `<option value="${esc(d)}"${d === state.dst.department ? ' selected' : ''}>${esc(d)}</option>`).join('')}
          </select>
        </label>
        <span class="t-body-sm">Only set this when the referral names a department the specialty does not map to.</span>
      </dd>` : ''}`;
}

/** A select over what the register holds, plus one option that opens a field. */
function comboHtml(selectName, textName, value, typed, list, placeholderLabel, example) {
  const isNew = value === NEW;
  return `
    <label class="field">
      <select name="${selectName}">
        <option value=""${value ? '' : ' selected'}>${esc(placeholderLabel)}</option>
        ${list.map((row) => `<option value="${esc(row.id)}"${row.id === value ? ' selected' : ''}>${esc(row.name)}</option>`).join('')}
        <option value="${NEW}"${isNew ? ' selected' : ''}>Type a new name…</option>
      </select>
    </label>
    ${isNew ? `
      <label class="field">
        <span class="icon icon--sm">add</span>
        <input type="text" name="${textName}" value="${esc(typed)}" placeholder="${esc(example)}">
      </label>
      <span class="t-body-sm">Saving adds this to the referral register, so the next clerk finds it.</span>` : ''}`;
}

const realId = (value) => (value === NEW ? '' : value);

// --- panel 3: the question ---------------------------------------------------

export function detailsPanel(state) {
  return `
    <dl class="dl">
      <dt>Reason *</dt>
      <dd>
        <label class="field field--area">
          <textarea name="reason" rows="3"
                    placeholder="Persistent right shoulder pain after a fall, no improvement on physiotherapy.">${esc(state.reason)}</textarea>
        </label>
      </dd>
      <dt>Referral date *</dt>
      <dd><label class="field"><input type="date" name="referralDate" value="${esc(state.referralDate)}"></label></dd>
      <dt>Valid until</dt>
      <dd>
        <label class="field"><input type="date" name="validUntil" value="${esc(state.validUntil)}"></label>
        <span class="t-body-sm">${state.direction === 'Inbound'
          ? 'Defaults to a month from the referral date. A referral past this date lapses on the next load.'
          : 'Optional on an outbound referral — the question is asked once and answered when it is answered.'}</span>
      </dd>
      <dt>Visits *</dt>
      <dd>
        <label class="field"><input type="number" name="visitsTotal" min="1" max="12" value="${esc(String(state.visitsTotal))}"></label>
        <span class="t-body-sm">How many visits this one referral is written for. Each encounter opened against it
          takes one, and the referral is used up when they run out.</span>
      </dd>
      <dt>Payer reference</dt>
      <dd>
        <label class="field"><input type="text" name="payerRef" value="${esc(state.payerRef)}"
                                   placeholder="NSSF-REF-2026-88134"></label>
        <span class="t-body-sm">The number the payer gave for this referral, when it gave one.</span>
      </dd>
      <dt>Letter</dt>
      <dd>
        ${state.letter
          ? `<div class="rule-child-row">
               <span class="icon">description</span>
               <div><div>${esc(state.letter.fileName)}</div>
                 <span class="t-body-sm">${fileSize(state.letter.size)}</span></div>
               <span class="spacer"></span>
               <button class="btn btn--ghost btn--icon btn--sm" data-act="drop-letter" title="Remove the letter">
                 <span class="icon icon--sm">delete</span>
               </button>
             </div>`
          : `<label class="field">
               <span class="icon icon--sm">upload_file</span>
               <input type="file" name="letter" accept=".pdf,.jpg,.jpeg,.png">
             </label>
             <span class="t-body-sm">PDF, JPG or PNG, up to 10 MB. The demo keeps the name and the size, not the file.</span>`}
      </dd>
    </dl>`;
}
