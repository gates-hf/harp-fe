// The small pieces a pre-authorisation is read by, in one place because five
// screens draw them: the worklist, the form's rail, the request page, the
// encounter's Linked Records row and the Pre-Auths section on the patient
// record.
//
// Two of them earn the file. A validity is never just a date — it is a
// countdown, and an approval a week from lapsing is the reason the worklist
// exists. And "pending since" is not an age either: an urgent request the payer
// has sat on past the turnaround it agreed to is red, and a routine one is not.

import * as preauth from '../../../../data/repositories/preauth-requests.js';
import * as patients from '../../../../data/repositories/patients.js';
import { date, esc, relativeTime } from '../../../../shared/format.js';

export function statusHtml(row) {
  const tone = preauth.statusTone(row.status);
  return `<span class="badge${tone ? ` badge--${tone}` : ''}"><span class="dot"></span>${esc(row.status)}</span>`;
}

/** Urgent is the only priority worth a colour; routine is the default state. */
export const priorityHtml = (row) =>
  (row.priority === 'Urgent'
    ? '<span class="badge badge--critical" title="The payer agreed to answer an urgent request inside three working days"><span class="dot"></span>Urgent</span>'
    : '<span class="badge">Routine</span>');

/** The date the payer's answer runs to, with what is left of it. */
export function validityHtml(row) {
  const decision = row.decision;
  if (!decision?.validTo) {
    return `<span class="t-body-sm">${esc(decision ? 'no validity' : 'not answered yet')}</span>`;
  }
  const left = preauth.daysLeft(row);
  const live = preauth.isAuthorized(row);
  return `
    <span class="t-mono-sm">${date(decision.validTo)}</span>
    ${live && left <= preauth.CONFIG.expiringDays
      ? `<br><span class="badge badge--warning" title="Renew it before it lapses">
           <span class="dot"></span>${left <= 0 ? 'lapses today' : `${left} day${left === 1 ? '' : 's'} left`}</span>`
      : live ? `<br><span class="t-body-sm">${left} day${left === 1 ? '' : 's'} left</span>`
        : '<br><span class="t-body-sm">lapsed</span>'}`;
}

/** How long it has been with the payer, and whether that is too long. */
export function pendingHtml(row) {
  if (!row.submittedAt) return '<span class="t-body-sm">not sent</span>';
  const days = preauth.pendingDays(row);
  const line = `<span class="t-body-sm" title="Submitted ${date(row.submittedAt)}">${esc(relativeTime(row.submittedAt))}</span>`;
  if (!preauth.isPending(row)) return line;
  return preauth.isOverdue(row)
    ? `<span class="badge badge--critical" title="Urgent, and ${days} days with no answer — chase it">
         <span class="dot"></span>${days} day${days === 1 ? '' : 's'}</span>`
    : line;
}

/** The first two services and a count, with the whole list in the tooltip. */
export function servicesHtml(row) {
  const names = (row.services || []).map(preauth.serviceLabel);
  return `<span title="${esc(names.join(', '))}">${esc(preauth.servicesLabel(row))}</span>`;
}

/** The patient's name over their MRN, the way every Frontis list writes it. */
export function patientHtml(row, role) {
  const patient = patients.view(patients.get(row.patientMrn), role);
  return `
    ${esc(patient?.nameEn || row.patientMrn)}
    <br><a class="crumb-link t-mono-sm" href="#/frontis/patients/${esc(row.patientMrn)}">${esc(row.patientMrn)}</a>`;
}

/**
 * Whether this role reads the request's record masked. A request names the
 * payer, the plan, the diagnosis and the money, which is the field the
 * encounter board and the record's own tabs withhold on a restricted record.
 */
export const isWithheld = (row, role) =>
  Boolean(patients.view(patients.get(row?.patientMrn), role)?.masked);

export const authNumberHtml = (row) =>
  (row.decision?.authNumber
    ? `<span class="t-mono-sm">${esc(row.decision.authNumber)}</span>`
    : '<span class="t-body-sm">—</span>');

/**
 * The Pre-Auths section on the patient record's Encounters tab. It sits with
 * the estimates because both are money questions asked before the visit: what
 * it will cost, and whether the payer has agreed to it.
 */
export function preauthSectionHtml(mrn, { readOnly = false, canOpen = true } = {}) {
  const rows = preauth.byPatient(mrn);
  const live = rows.filter(preauth.isAuthorized).length;
  const pending = rows.filter(preauth.isPending).length;
  return `
    <div class="toolbar">
      <span class="t-title-sm">Pre-authorisations</span>
      <span class="t-body-sm">${rows.length
        ? `${rows.length} raised · ${live} in force${pending ? ` · ${pending} with the payer` : ''}`
        : 'nothing raised yet'}</span>
      <span class="spacer"></span>
      ${readOnly || !canOpen
        ? `<button class="btn btn--ghost btn--sm" disabled title="${esc(readOnly
            ? 'A merged record is read-only — raise the request on the record that survived'
            : 'This record cannot open an encounter, so there is nothing to authorise')}">
             <span class="icon icon--sm">gpp_maybe</span>Request pre-auth</button>`
        : `<a class="btn btn--ghost btn--sm" href="#/frontis/preauth/new?mrn=${esc(mrn)}">
             <span class="icon icon--sm">gpp_maybe</span>Request pre-auth</a>`}
    </div>
    ${rows.length ? tableHtml(rows) : '<p class="t-body-sm">No pre-authorisation has been asked for on this record.</p>'}`;
}

function tableHtml(rows) {
  return `
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">Request no.</th>
          <th scope="col">Services</th>
          <th scope="col">Payer / plan</th>
          <th scope="col">Auth number</th>
          <th scope="col">Valid until</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td><a class="crumb-link t-mono-sm" href="#/frontis/preauth/${esc(row.no)}">${esc(row.no)}</a></td>
            <td>${servicesHtml(row)}</td>
            <td>${esc(preauth.coverLabel(row))}</td>
            <td>${authNumberHtml(row)}</td>
            <td>${validityHtml(row)}</td>
            <td>${statusHtml(row)}${row.priority === 'Urgent' ? ` ${priorityHtml(row)}` : ''}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}
