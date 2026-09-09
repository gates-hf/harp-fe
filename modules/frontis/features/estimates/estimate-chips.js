// The small pieces an estimate is read by, in one place because four screens
// draw them: the list, the builder's banner, the document's header and the
// Estimates section on the patient record's Encounters tab.
//
// Validity is the one that earns the file. An estimate is the only entity here
// whose whole subject is a date in the future, so "valid until" is never just a
// stamp: it is amber three days out and a plain fact once it has passed.

import * as estimates from '../../../../data/repositories/estimates.js';
import * as patients from '../../../../data/repositories/patients.js';
import { date, esc, usd } from '../../../../shared/format.js';

/** How near the end of its validity an estimate starts asking to be reissued. */
const SOON = 3;

export function statusHtml(row) {
  const tone = estimates.statusTone(row.status);
  return `<span class="badge${tone ? ` badge--${tone}` : ''}"><span class="dot"></span>${esc(row.status)}</span>`;
}

/** The date, and how long is left when there is still something left. */
export function validityHtml(row) {
  if (!row.validUntil) return '<span class="t-body-sm">not issued</span>';
  const left = estimates.daysLeft(row);
  const live = estimates.isLive(row);
  return `
    <span class="t-mono-sm">${date(row.validUntil)}</span>
    ${live && left <= SOON
      ? `<br><span class="badge badge--warning" title="Reissue it before it lapses">
           <span class="dot"></span>${left <= 0 ? 'lapses today' : `${left} day${left === 1 ? '' : 's'} left`}</span>`
      : live ? `<br><span class="t-body-sm">${left} day${left === 1 ? '' : 's'} left</span>` : ''}`;
}

/**
 * Whether this role reads the subject's record masked. An estimate names the
 * payer, the plan and what the patient is expected to find, which is the field
 * the encounter board and the record's own tabs withhold on a restricted
 * record: that a VIP was quoted is not the secret, what they were quoted is.
 * A walk-in has no record to be restricted, so nothing about it is withheld.
 */
export const isWithheld = (row, role) =>
  row?.subject?.kind === 'patient'
  && Boolean(patients.view(patients.get(row.subject.mrn), role)?.masked);

/** A registered subject carries its MRN; a walk-in carries the tag instead. */
export function subjectHtml(row, role) {
  if (estimates.isProspect(row)) {
    return `
      ${esc(row.subject.name)}
      <br><span class="badge" title="Quoted at the counter, not linked to a patient record">Prospect</span>
      <span class="t-mono-sm">${esc(row.subject.phone || '')}</span>`;
  }
  const patient = patients.view(patients.get(row.subject.mrn), role);
  return `
    ${esc(patient?.nameEn || row.subject.mrn)}
    <br><a class="crumb-link t-mono-sm" href="#/frontis/patients/${esc(row.subject.mrn)}">${esc(row.subject.mrn)}</a>`;
}

/**
 * The Estimates section on the patient record's Encounters tab. It sits with
 * the encounters because that is what an accepted estimate becomes, and the two
 * answer one question between them: what has been quoted, and what was opened.
 */
export function estimatesSectionHtml(mrn, { readOnly = false, canOpen = true } = {}) {
  const rows = estimates.byPatient(mrn);
  const live = rows.filter((row) => estimates.isLive(row)).length;
  return `
    <div class="toolbar">
      <span class="t-title-sm">Estimates</span>
      <span class="t-body-sm">${rows.length
        ? `${rows.length} quoted · ${live} still valid`
        : 'nothing quoted yet'}</span>
      <span class="spacer"></span>
      ${readOnly || !canOpen
        ? `<button class="btn btn--ghost btn--sm" disabled title="${esc(readOnly
            ? 'A merged record is read-only — quote on the record that survived'
            : 'This record cannot open an encounter, so there is nothing to quote for')}">
             <span class="icon icon--sm">calculate</span>Cost estimate</button>`
        : `<a class="btn btn--ghost btn--sm" href="#/frontis/estimates/new?mrn=${esc(mrn)}">
             <span class="icon icon--sm">calculate</span>Cost estimate</a>`}
    </div>
    ${rows.length ? tableHtml(rows) : '<p class="t-body-sm">No cost estimate has been quoted for this patient.</p>'}`;
}

function tableHtml(rows) {
  return `
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">Estimate no.</th>
          <th scope="col">Services</th>
          <th scope="col">Payer / plan</th>
          <th scope="col" class="num">Patient share</th>
          <th scope="col">Valid until</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td><a class="crumb-link t-mono-sm" href="#/frontis/estimates/${esc(row.no)}">${esc(row.no)}</a></td>
            <td>${esc(estimates.servicesLabel(row))}</td>
            <td>${esc(estimates.coverLabel(row))}</td>
            <td class="num t-mono-sm">${row.result ? usd(row.result.totals.patientShare) : '—'}</td>
            <td>${validityHtml(row)}</td>
            <td>${statusHtml(row)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}
