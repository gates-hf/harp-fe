// The four steps of encounter registration, as markup, plus the stepper over
// them. encounter-new.js owns the state and every write; this file only draws.
//
// The classification question itself is not here: the Re-classify dialog asks
// the same one outside the flow, so the chain and the answer card live in
// encounter-classification.js and both callers draw them from there.

import * as patients from '../../../../data/repositories/patients.js';
import * as policies from '../../../../data/repositories/policies.js';
import * as eligibility from '../../../../data/repositories/eligibility.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import * as referrals from '../../../../data/repositories/referrals.js';
import { BED_CLASSES, DEPARTMENTS, WARDS, doctorsIn, doctorName } from '../../../../data/seed/reference.js';
import { age, date, esc } from '../../../../shared/format.js';
import { policyChainHtml, snapshotCardHtml } from './encounter-classification.js';

const PICKER_LIMIT = 8;

/** The stepper over the flow: done, current, and the ones not yet reachable. */
export function stepperHtml(steps, current) {
  return steps.map((step, i) => {
    const cls = i === current ? ' stepper__step--current' : i < current ? ' stepper__step--done' : '';
    return `
      <button class="stepper__step${cls}" data-step="${i}" ${i > current ? 'aria-disabled="true"' : ''}
              title="${i > current ? 'Finish the current step first' : esc(step.title)}">
        <span class="stepper__n">${i < current ? '<span class="icon icon--sm">check</span>' : i + 1}</span>
        <span class="stepper__label">${esc(step.title)}</span>
      </button>`;
  }).join('<span class="stepper__line"></span>');
}

/** Step 1 — who the visit is for. */
export function stepPatient(state, role) {
  const patient = state.mrn ? patients.view(patients.get(state.mrn), role) : null;
  return `
    <div class="toolbar">
      <label class="field field--grow">
        <span class="icon icon--sm">search</span>
        <input type="search" id="en-patient-q" value="${esc(state.q)}"
               placeholder="Search name, MRN, civil ID or phone" aria-label="Search patients">
      </label>
      <span class="spacer"></span>
      <button class="btn btn--secondary btn--sm" data-act="register">
        <span class="icon icon--sm">person_add</span>Register new patient
      </button>
    </div>
    ${patient ? bannerHtml(patient) : pickerHtml(state, role)}`;
}

/** The banner over the flow once a patient is chosen, and the door it closes. */
export function bannerHtml(patient) {
  const blocked = !patients.canOpenEncounter(patient);
  return `
    <div class="rule-child-row">
      ${patient.photo ? `<img class="avatar avatar--lg" src="${esc(patient.photo)}" alt="">` : '<span class="icon icon--lg">person</span>'}
      <div>
        <div class="t-title-sm">${esc(patient.nameEn)}
          ${patient.vip && !patient.masked ? '<span class="badge badge--accent">VIP</span>' : ''}
          ${patient.masked ? '<span class="badge">Restricted</span>' : ''}
          <span class="badge${patients.statusTone(patient.status) ? ` badge--${patients.statusTone(patient.status)}` : ''}">
            <span class="dot"></span>${esc(patient.status)}</span>
        </div>
        <span class="t-mono-sm">${esc(patient.mrn)}</span>
        <span class="t-body-sm">${esc(patient.gender)}${age(patient.dob) === '—' ? '' : `, ${age(patient.dob)}`}</span>
      </div>
      <span class="spacer"></span>
      <button class="btn btn--ghost btn--sm" data-act="unpick">
        <span class="icon icon--sm">swap_horiz</span>Choose another
      </button>
    </div>
    ${blocked ? stopHtml(patient) : ''}`;
}

/** Deceased, blocked or merged: the flow stops here and says why. */
function stopHtml(patient) {
  const why = patient.status === 'Deceased'
    ? 'No encounter can be opened against a deceased record. The paperwork that follows a death is filed on the record itself.'
    : patient.status === 'Blocked'
      ? `This record is blocked: ${patient.blockReason || 'no reason recorded'}. Registration lifts a block, not this screen.`
      : `This record was merged into ${patient.mergedInto || 'another record'}. Open the record that survived and register there.`;
  return `
    <div class="alert alert--critical">
      <span class="icon">block</span>
      <div>
        <div class="title">${esc(patient.status)} — no encounter can be opened</div>
        ${esc(why)}
      </div>
    </div>
    <div class="toolbar">
      <span class="spacer"></span>
      <a class="btn btn--secondary btn--sm" href="#/frontis/patients/${esc(patient.mrn)}">Open the record</a>
    </div>`;
}

function pickerHtml(state, role) {
  const needle = state.q.trim();
  if (needle.length < 2) {
    return `<p class="t-body-sm">Type at least two characters to find the patient, or register a new one.</p>`;
  }
  const found = patients.search(needle).slice(0, PICKER_LIMIT);
  if (!found.length) {
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">person_search</span></div>
        <div class="state-view__title">No patient found</div>
        <p class="state-view__body">Nothing on the register matches “${esc(needle)}”. Check the spelling, or register
          the patient — the duplicate check runs before the MRN is spent.</p>
        <div class="state-view__actions">
          <button class="btn btn--primary" data-act="register">Register new patient</button>
        </div>
      </div>`;
  }
  return `
    <table class="tbl">
      <thead><tr><th scope="col">Patient</th><th scope="col">MRN</th><th scope="col">Born</th><th scope="col">Status</th><th scope="col"></th></tr></thead>
      <tbody>
        ${found.map((raw) => {
          const p = patients.view(raw, role);
          return `
            <tr data-mrn="${esc(p.mrn)}" tabindex="0" title="Choose ${esc(p.nameEn)}">
              <td>${esc(p.nameEn)}${p.vip && !p.masked ? ' <span class="badge badge--accent">VIP</span>' : ''}</td>
              <td class="t-mono-sm">${esc(p.mrn)}</td>
              <td class="t-mono-sm">${date(p.dob)}</td>
              <td><span class="badge${patients.statusTone(p.status) ? ` badge--${patients.statusTone(p.status)}` : ''}">
                    <span class="dot"></span>${esc(p.status)}</span></td>
              <td><button class="btn btn--secondary btn--sm" data-act="pick">Choose</button></td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

/** Step 2 — the visit itself. The type is what decides the rest of the form. */
export function stepVisit(state) {
  const ip = state.type === 'IP';
  const reasoned = ip || state.type === 'ER';
  return `
    <dl class="dl">
      <dt>Type *</dt>
      <dd>
        <label class="field">
          <select name="type">
            <option value="">Choose a type</option>
            ${encounters.TYPES.map((t) => `<option value="${t}"${t === state.type ? ' selected' : ''}>${esc(encounters.typeLabel(t))} (${t})</option>`).join('')}
          </select>
        </label>
      </dd>

      <dt>Department *</dt>
      <dd>
        <label class="field">
          <select name="department">
            <option value="">Choose a department</option>
            ${DEPARTMENTS.map((d) => `<option value="${esc(d)}"${d === state.department ? ' selected' : ''}>${esc(d)}</option>`).join('')}
          </select>
        </label>
      </dd>

      <dt>Doctor *</dt>
      <dd>
        <label class="field">
          <select name="doctorId"${state.department ? '' : ' disabled'}>
            <option value="">${state.department ? 'Choose a doctor' : 'Choose a department first'}</option>
            ${doctorsIn(state.department).map((d) => `<option value="${esc(d.id)}"${d.id === state.doctorId ? ' selected' : ''}>${esc(d.name)}</option>`).join('')}
          </select>
        </label>
      </dd>

      <dt>Start *</dt>
      <dd>
        <label class="field">
          <input type="datetime-local" name="startAt" value="${esc(state.startAt)}">
        </label>
        <span class="t-body-sm">${state.startAt && new Date(state.startAt).getTime() > Date.now()
          ? 'Later than now, so the encounter is created as Planned and is activated when the patient arrives.'
          : 'Now, so the encounter opens Active.'}</span>
      </dd>

      ${referralHtml(state)}

      ${reasoned ? `
        <dt>Visit reason *</dt>
        <dd>
          <label class="field field--area">
            <textarea name="visitReason" rows="2"
                      placeholder="${state.type === 'ER' ? 'Fall from scaffolding, right wrist deformity' : 'Elective laparoscopic cholecystectomy'}">${esc(state.visitReason)}</textarea>
          </label>
        </dd>` : ''}

      ${ip ? `
        <dt>Ward *</dt>
        <dd>
          <label class="field">
            <select name="ward">
              <option value="">Choose a ward</option>
              ${WARDS.map((w) => `<option value="${esc(w)}"${w === state.ward ? ' selected' : ''}>${esc(w)}</option>`).join('')}
            </select>
          </label>
        </dd>

        <dt>Bed class *</dt>
        <dd>
          <label class="field">
            <select name="bedClass">
              <option value="">Choose a bed class</option>
              ${BED_CLASSES.map((b) => `<option value="${esc(b)}"${b === state.bedClass ? ' selected' : ''}>${esc(b)}</option>`).join('')}
            </select>
          </label>
        </dd>

        <dt>Expected LOS *</dt>
        <dd>
          <label class="field">
            <input type="number" name="expectedLos" min="1" max="90" value="${esc(state.expectedLos)}">
          </label>
          <span class="t-body-sm">Nights the admission is booked for. The real length of stay is computed at discharge.</span>
        </dd>` : ''}
    </dl>`;
}

/**
 * The referral this visit answers, when there is one. Only referrals that can
 * actually be spent are offered — open, in date, with a visit left, and about
 * this department — because a picker that offered a lapsed one would be asking
 * the clerk to notice what the register already knows. An expired referral is
 * absent and the helper line says why.
 */
function referralHtml(state) {
  if (!state.mrn) return '';
  const on = state.startAt ? String(state.startAt).slice(0, 10) : undefined;
  const list = referrals.validForEncounter(state.mrn, state.department, on);
  const missing = state.referralFlag;
  return `
    <dt>Referral</dt>
    <dd>
      <label class="field">
        <select name="referralNo"${list.length ? '' : ' disabled'}>
          <option value="">${list.length ? 'None' : 'No referral to spend on this visit'}</option>
          ${list.map((row) => `<option value="${esc(row.no)}"${row.no === state.referralNo ? ' selected' : ''}>
            ${esc(row.no)} — ${esc(referrals.partiesLabel(row))}${row.visits.total > 1
              ? ` (${referrals.remaining(row)} of ${row.visits.total} left)` : ''}</option>`).join('')}
        </select>
      </label>
      <span class="t-body-sm">${list.length
        ? 'Creating the encounter spends one visit on the referral and links the two records.'
        : 'Nothing open and in date for this department. Expired referrals must be extended first.'}</span>
      ${missing ? `
        <div class="alert alert--warning">
          <span class="icon">forward</span>
          <div>
            <div class="title">Referral required by payer</div>
            The cover chosen on the next step asks for a referral and none is on file. The encounter can still be
            opened — it carries the flag until a referral is linked.
          </div>
        </div>` : ''}
    </dd>`;
}

/** Step 3 — who pays, and what the payer said when asked. */
export function stepFinancial(state, { snapshot, reuse, canOverride, remaining }) {
  const passed = state.mrn && snapshot && (eligibility.isPass(snapshot.finalResult) || snapshot.finalResult === 'Self-Pay');
  return `
    <p class="t-body">The highest policy on the chain is asked first. Whatever is chosen here is what the encounter
      opens under, and the check that backs it is kept with the encounter.</p>
    ${policyChainHtml(state.mrn, state.policyId || 'self')}
    <div id="en-check">${snapshotCardHtml(snapshot, { reuse })}</div>
    ${snapshot && !passed ? `
      <div class="toolbar">
        <span class="t-body-sm">This cover does not answer for the visit.</span>
        <span class="spacer"></span>
        ${remaining.length
          ? `<button class="btn btn--secondary btn--sm" data-act="next-policy">Try ${esc(policies.label(remaining[0]))}</button>`
          : ''}
        <button class="btn btn--secondary btn--sm" data-act="self-pay">Use Self-Pay</button>
        ${canOverride
          ? '<button class="btn btn--primary btn--sm" data-act="override">Proceed anyway</button>'
          : '<button class="btn btn--primary btn--sm" disabled title="Your role cannot override an eligibility answer. A coder or the CMO can.">Proceed anyway</button>'}
      </div>` : ''}`;
}

/** Step 4 — everything above, in one page, before anything is written. */
export function stepReview(state, { patient, snapshot }) {
  const policy = state.policyId && state.policyId !== 'self' ? policies.get(state.policyId) : null;
  return `
    <dl class="dl dl--narrow">
      <dt>Patient</dt><dd>${esc(patient?.nameEn || state.mrn)} <span class="t-mono-sm">${esc(state.mrn)}</span></dd>
      <dt>Type</dt><dd>${esc(encounters.typeLabel(state.type))}</dd>
      <dt>Department</dt><dd>${esc(state.department)}</dd>
      <dt>Doctor</dt><dd>${esc(doctorName(state.doctorId))}</dd>
      <dt>Start</dt><dd class="t-mono-sm">${esc(String(state.startAt).replace('T', ' '))}</dd>
      ${state.visitReason ? `<dt>Visit reason</dt><dd>${esc(state.visitReason)}</dd>` : ''}
      ${state.type === 'IP' ? `
        <dt>Ward</dt><dd>${esc(state.ward)}</dd>
        <dt>Bed class</dt><dd>${esc(state.bedClass)}</dd>
        <dt>Expected LOS</dt><dd>${esc(state.expectedLos)} night${Number(state.expectedLos) === 1 ? '' : 's'}</dd>` : ''}
      <dt>Financial class</dt>
      <dd>${policy ? `${esc(policies.label(policy))} <span class="t-body-sm">member ${esc(policy.memberId)}</span>` : 'Self-Pay'}</dd>
    </dl>
    ${snapshotCardHtml(snapshot)}`;
}
