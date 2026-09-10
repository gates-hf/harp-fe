// The four panels of the request form, as markup. preauth-form.js owns the
// state and the events, so the two files each stay near the line cap.
//
// The one thing worth naming here is the per-line chip. A request may ask for
// anything — a payer will answer for a charge its matrix never mentions — but
// the chip says which lines the agreement itself flags, so the desk can see at
// a glance whether it is answering a requirement or asking a favour. It reads
// contracts.resolvePreAuth, the same function the eligibility ladder reads, so
// the form and the check cannot disagree.

import * as patients from '../../../../data/repositories/patients.js';
import * as policies from '../../../../data/repositories/policies.js';
import * as cdm from '../../../../data/repositories/cdm.js';
import * as contracts from '../../../../data/repositories/contracts.js';
import * as preauth from '../../../../data/repositories/preauth-requests.js';
import { DEPARTMENTS, DOCTORS } from '../../../../data/seed/reference.js';
import { age, date, esc, fileSize, usd } from '../../../../shared/format.js';

const MATCHES = 6;

export { DEPARTMENTS };

/** Where the request came from, when it was not typed from nothing. */
export function bannerHtml(state) {
  if (!state.origin) return '';
  return `
    <div class="alert alert--info">
      <span class="icon">bolt</span>
      <div>
        <div class="title">Pre-filled from ${esc(state.origin.ref)}</div>
        ${esc(state.origin.detail)} Nothing here is retyped — change anything that is wrong before sending.
      </div>
    </div>`;
}

// --- 1 · patient and policy ---------------------------------------------------

/** The register search, or the chosen record with the cover under it. */
export function patientPanel(state, role) {
  const patient = state.patientMrn ? patients.view(patients.get(state.patientMrn), role) : null;
  if (!patient) return pickerHtml(state, role);
  return `
    ${bannerRowHtml(patient, state)}
    ${coverHtml(state)}`;
}

function bannerRowHtml(patient, state) {
  return `
    <div class="rule-child-row">
      ${patient.photo
        ? `<img class="avatar avatar--lg" src="${esc(patient.photo)}" alt="">`
        : '<span class="icon icon--lg">person</span>'}
      <div>
        <div class="t-title-sm">${esc(patient.nameEn)}
          ${patient.masked ? '<span class="badge">Restricted</span>' : ''}</div>
        <span class="t-mono-sm">${esc(patient.mrn)}</span>
        <span class="t-body-sm">${esc(patient.gender)}${age(patient.dob) === '—' ? '' : `, ${age(patient.dob)}`}</span>
      </div>
      <span class="spacer"></span>
      ${state.encounterNo
        ? `<a class="crumb-link t-mono-sm" href="#/frontis/encounters/${esc(state.encounterNo)}">${esc(state.encounterNo)}</a>`
        : ''}
      <button class="btn btn--ghost btn--sm" data-act="unpick"
              title="${state.encounterNo
                ? 'The patient came from the encounter this request is for — changing it unlinks the visit'
                : 'Choose a different record'}">
        <span class="icon icon--sm">swap_horiz</span>Change
      </button>
    </div>`;
}

function pickerHtml(state, role) {
  const rows = patients.search(state.q).slice(0, MATCHES);
  return `
    <div class="toolbar">
      <label class="field field--grow">
        <span class="icon icon--sm">search</span>
        <input type="search" id="pf-q" value="${esc(state.q)}"
               placeholder="Search name, MRN, civil ID or phone" aria-label="Search patients">
      </label>
    </div>
    ${!state.q.trim()
      ? '<p class="t-body-sm">Search the register for the patient this request is about. A payer answers about a person, so there is no request without one.</p>'
      : !rows.length
        ? `<p class="t-body-sm">No record matches “${esc(state.q)}”. Register the patient first — a request cannot be raised for somebody who is not on the register.</p>`
        : `<table class="tbl">
             <thead><tr><th scope="col">Patient</th><th scope="col">MRN</th><th scope="col">Date of birth</th></tr></thead>
             <tbody>${rows.map((raw) => {
               const p = patients.view(raw, role);
               return `
                 <tr data-mrn="${esc(p.mrn)}" tabindex="0" title="Raise a request for ${esc(p.nameEn)}">
                   <td>${esc(p.nameEn)}${p.masked ? ' <span class="badge">Restricted</span>' : ''}</td>
                   <td class="t-mono-sm">${esc(p.mrn)}</td>
                   <td class="t-mono-sm">${date(p.dob)}</td>
                 </tr>`;
             }).join('')}</tbody>
           </table>`}`;
}

/** The chain as radios. Self-Pay is not offered: nobody authorises a bill. */
function coverHtml(state) {
  const chain = policies.chain(state.patientMrn);
  if (!chain.length) {
    return `
      <div class="alert alert--warning">
        <span class="icon">error</span>
        <div>
          <div class="title">No cover on the chain</div>
          This patient has no active policy, so there is no payer to ask. Add the policy on the record's Insurance
          tab first — a self-paying patient needs no authorisation, only an estimate.
        </div>
      </div>`;
  }
  return chain.map((p) => `
    <label class="rule-child-row">
      <input type="radio" name="pf-policy" value="${esc(p.id)}"${p.id === state.policyId ? ' checked' : ''}>
      <div>
        <div>${esc(policies.label(p))} <span class="badge">${esc(policies.priorityLabel(p.priority))}</span></div>
        <span class="t-body-sm">Member ${esc(p.memberId)} · valid to ${date(p.validTo)}</span>
      </div>
    </label>`).join('');
}

// --- 2 · services -------------------------------------------------------------

/** The active charge master as a picker, bundles and items in one list. */
export const optionsHtml = (selected) =>
  `<option value=""${selected ? '' : ' selected'}>Choose a service</option>` +
  cdm.findActive().map((row) => `
    <option value="${esc(row.id)}"${row.id === selected ? ' selected' : ''}>
      ${esc(row.chargeCode)} — ${esc(cdm.label(row))}${cdm.isBundle(row) ? ' (package)' : ''}
    </option>`).join('');

export function servicesPanel(state) {
  const contract = contractOf(state);
  return `
    <div class="toolbar">
      <span class="t-title-sm">Services</span>
      <span class="spacer"></span>
      <span class="t-body-sm">${state.services.length} line${state.services.length === 1 ? '' : 's'} ·
        asking ${usd(total(state))}</span>
      <button class="btn btn--secondary btn--sm" data-act="add-line">
        <span class="icon icon--sm">add</span>Add service
      </button>
    </div>
    ${state.services.length
      ? state.services.map((line, i) => lineHtml(line, i, contract)).join('')
      : '<p class="t-body-sm">No services yet. Add the ones the payer is being asked to approve.</p>'}
    <p class="t-body-sm">The requested amount defaults to what the agreement allows for that quantity. Change it
      where the payer is being asked for something else.</p>`;
}

function lineHtml(line, i, contract) {
  const item = cdm.get(line.itemId);
  const flag = item && contract
    ? contracts.resolvePreAuth(contract, item, Number(line.requestedAmount) || 0)
    : null;
  return `
    <div class="panel panel--sunken" data-index="${i}">
      <div class="panel-header">
        <span class="t-title-sm">Service ${i + 1}</span>
        ${item && cdm.isBundle(item) ? '<span class="badge badge--accent">Package</span>' : ''}
        ${flag?.required
          ? `<span class="badge badge--warning" title="${esc(flag.reason)}"><span class="dot"></span>Pre-auth required</span>`
          : flag
            ? `<span class="badge" title="${esc(flag.reason)}">Not flagged by the agreement</span>`
            : ''}
        <span class="spacer"></span>
        <span class="t-body-sm">${item ? `${usd(item.standardPrice)} standard` : 'No service chosen'}</span>
        <button class="btn btn--ghost btn--icon btn--sm" data-act="remove-line" title="Remove service ${i + 1}">
          <span class="icon icon--sm">delete</span>
        </button>
      </div>
      <div class="panel-body">
        <div class="toolbar">
          <label class="field field--grow">
            <span class="icon icon--sm">sell</span>
            <select data-field="itemId" aria-label="Service ${i + 1}">${optionsHtml(line.itemId)}</select>
          </label>
          <label class="field">
            <span class="icon icon--sm">tag</span>
            <input type="number" min="1" step="1" value="${esc(line.qty)}" data-field="qty"
                   aria-label="Quantity on service ${i + 1}">
          </label>
          <label class="field">
            <span class="icon icon--sm">payments</span>
            <input type="number" min="0" step="0.01" value="${esc(line.requestedAmount)}" data-field="requestedAmount"
                   aria-label="Requested amount on service ${i + 1}">
          </label>
        </div>
      </div>
    </div>`;
}

// --- 3 · clinical -------------------------------------------------------------

export function clinicalPanel(state) {
  return `
    <dl class="dl">
      <dt><label for="pf-diagnosis">Diagnosis *</label></dt>
      <dd><label class="field">
        <span class="icon icon--sm">clinical_notes</span>
        <input id="pf-diagnosis" name="diagnosis" type="text" value="${esc(state.diagnosis)}"
               placeholder="K35.80 — Acute appendicitis, unspecified">
      </label></dd>
      <dt><label for="pf-justification">Justification *</label></dt>
      <dd><label class="field field--area">
        <textarea id="pf-justification" name="justification" rows="5"
                  placeholder="What was found, what has been tried, and why this is the next step. It is what the payer answers against.">${esc(state.justification)}</textarea>
      </label></dd>
      <dt><label for="pf-doctor">Treating doctor *</label></dt>
      <dd><label class="field">
        <span class="icon icon--sm">stethoscope</span>
        <select id="pf-doctor" name="doctorId">
          <option value=""${state.doctorId ? '' : ' selected'}>Choose the treating doctor</option>
          ${DOCTORS.map((d) => `
            <option value="${esc(d.id)}"${d.id === state.doctorId ? ' selected' : ''}>
              ${esc(d.name)} — ${esc(d.department)}</option>`).join('')}
        </select>
      </label></dd>
      <dt>Priority *</dt>
      <dd>
        <div class="segmented" role="group" aria-label="Priority">
          ${preauth.PRIORITIES.map((p) => `
            <button type="button" data-priority="${esc(p)}" aria-pressed="${p === state.priority}">${esc(p)}</button>`).join('')}
        </div>
        <span class="t-body-sm">An urgent request is chased after ${preauth.CONFIG.urgentChaseDays} days
          without an answer, and shows red on the worklist until it is answered.</span>
      </dd>
    </dl>`;
}

// --- 4 · documents ------------------------------------------------------------

export function documentsPanel(state) {
  const saved = Boolean(state.no);
  return `
    <div class="toolbar">
      <span class="t-title-sm">Supporting documents</span>
      <span class="spacer"></span>
      ${saved
        ? `<label class="btn btn--secondary btn--sm" title="PDF, JPG or PNG, up to 10 MB">
             <span class="icon icon--sm">upload_file</span>Upload
             <input type="file" id="pf-doc" accept=".pdf,.jpg,.jpeg,.png" hidden>
           </label>`
        : `<button class="btn btn--secondary btn--sm" disabled
             title="Save the draft first — a document is filed against a request number">
             <span class="icon icon--sm">upload_file</span>Upload</button>`}
    </div>
    ${state.documents.length
      ? state.documents.map((doc) => `
        <div class="rule-child-row">
          <span class="icon">description</span>
          <div>
            <div>${esc(doc.fileName)} <span class="badge">${esc(doc.kind)}</span></div>
            <span class="t-body-sm">${fileSize(doc.size)} · ${esc(doc.uploadedBy)}</span>
          </div>
        </div>`).join('')
      : '<p class="t-body-sm">Nothing attached. A report, an operative note or an imaging result is what most refusals turn out to have been missing.</p>'}`;
}

// --- rail ---------------------------------------------------------------------

/** What the request says at a glance, beside the form that is writing it. */
export function summaryHtml(state) {
  const patient = state.patientMrn ? patients.get(state.patientMrn) : null;
  const policy = state.policyId ? policies.get(state.policyId) : null;
  return `
    <dl class="dl dl--narrow">
      <dt>Patient</dt><dd>${patient ? esc(patient.nameEn) : '<span class="t-body-sm">not chosen</span>'}</dd>
      <dt>Cover</dt><dd>${policy ? esc(policies.label(policy)) : '<span class="t-body-sm">not chosen</span>'}</dd>
      <dt>Services</dt><dd>${state.services.length}</dd>
      <dt>Asking for</dt><dd class="t-mono-sm">${usd(total(state))}</dd>
      <dt>Priority</dt><dd>${esc(state.priority)}</dd>
      <dt>Encounter</dt>
      <dd>${state.encounterNo
        ? `<a class="crumb-link t-mono-sm" href="#/frontis/encounters/${esc(state.encounterNo)}">${esc(state.encounterNo)}</a>`
        : '<span class="t-body-sm">not linked</span>'}</dd>
      <dt>Documents</dt><dd>${state.documents.length}</dd>
    </dl>`;
}

/** Save draft and Submit, with the reason Submit is out of reach when it is. */
export function footerHtml(state, why) {
  return `
    <div class="toolbar">
      <button class="btn btn--secondary btn--sm" data-act="save">
        <span class="icon icon--sm">save</span>Save draft
      </button>
      ${why
        ? `<button class="btn btn--primary btn--sm" disabled title="${esc(why)}">
             <span class="icon icon--sm">send</span>Submit</button>`
        : `<button class="btn btn--primary btn--sm" data-act="submit">
             <span class="icon icon--sm">send</span>Submit</button>`}
    </div>
    <p class="t-body-sm">Submitting locks the services and the justification: they are what the payer answers
      against, so nothing moves them afterwards. Everything else — documents, calls, the decision itself — is
      still recorded on the request.</p>`;
}

// --- shared internals ---------------------------------------------------------

export const total = (state) =>
  Math.round(state.services.reduce((n, line) => n + (Number(line.requestedAmount) || 0), 0) * 100) / 100;

/** The agreement this request is being raised under, or null. */
export function contractOf(state) {
  const policy = state.policyId ? policies.get(state.policyId) : null;
  if (!policy) return null;
  return contracts.contractForService(policy.payerId, policy.planId, state.on);
}

/** What the agreement allows for one line — the amount the form asks for. */
export function askingPrice(state, itemId, qty) {
  const item = cdm.get(itemId);
  if (!item) return 0;
  const contract = contractOf(state);
  const unit = contract
    ? contracts.resolvedPrice(contract, item, state.on)
    : Number(item.standardPrice) || 0;
  return Math.round(unit * Math.max(1, Number(qty) || 1) * 100) / 100;
}
