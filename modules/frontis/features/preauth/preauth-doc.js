// The printable request form — what actually goes to the payer, on paper or as
// a PDF. It is the only thing on the request page without data-print="hide", so
// Print hands the printer this and nothing else, the way the referral letter
// and the cost estimate already do.
//
// It is regenerated from the frozen request rather than stored: submitting is
// what stops the services and the justification moving, so a form printed today
// and one printed in March are the same document. It is the design system's own
// type and table classes on a plain page — a module writes no CSS, and a
// pre-authorisation form is a document, not a component.

import * as preauth from '../../../../data/repositories/preauth-requests.js';
import * as policies from '../../../../data/repositories/policies.js';
import { doctorName } from '../../../../data/seed/reference.js';
import { age, date, esc, usd } from '../../../../shared/format.js';

const HOSPITAL = { name: 'Harp Medical Centre', line: 'Rue de Damas, Beirut · +961 1 200 400' };

export function requestFormHtml(row, patient) {
  const policy = row.policyId ? policies.get(row.policyId) : null;
  return `
    <div class="panel">
      <div class="panel-header" data-print="hide">
        <span>Request form</span>
        <span class="spacer"></span>
        <span class="t-body-sm">What Print hands the printer. Everything else on this page is left off it.</span>
      </div>
      <div class="panel-body">
        <div class="toolbar">
          <span class="t-title">${esc(HOSPITAL.name)}</span>
          <span class="spacer"></span>
          <span class="t-mono-sm">${esc(row.no)}</span>
        </div>
        <p class="t-body-sm">${esc(HOSPITAL.line)}</p>

        <div class="toolbar">
          <span class="t-title-sm">Request for pre-authorisation</span>
          <span class="spacer"></span>
          <span class="badge${row.priority === 'Urgent' ? ' badge--critical' : ''}">${esc(row.priority)}</span>
        </div>

        <dl class="dl dl--narrow">
          <dt>Date of request</dt>
          <dd class="t-mono-sm">${date(row.submittedAt || row.createdAt)}</dd>
          <dt>Patient</dt>
          <dd>${esc(patient?.nameEn || row.patientMrn)}
            <span class="t-mono-sm">${esc(row.patientMrn)}</span>
            ${patient && age(patient.dob) !== '—' ? `<span class="t-body-sm">${esc(patient.gender)}, ${age(patient.dob)}</span>` : ''}</dd>
          <dt>Payer and plan</dt><dd>${esc(preauth.coverLabel(row))}</dd>
          <dt>Member ID</dt><dd class="t-mono-sm">${esc(policy?.memberId || '—')}</dd>
          <dt>Policy no.</dt><dd class="t-mono-sm">${esc(policy?.policyNo || '—')}</dd>
          ${row.encounterNo ? `<dt>Encounter</dt><dd class="t-mono-sm">${esc(row.encounterNo)}</dd>` : ''}
          <dt>Treating doctor</dt><dd>${esc(doctorName(row.doctorId))}</dd>
          <dt>Diagnosis</dt><dd>${esc(row.diagnosis)}</dd>
        </dl>

        <div class="toolbar"><span class="t-title-sm">Services requested</span></div>
        <table class="tbl">
          <thead>
            <tr>
              <th scope="col">Service</th>
              <th scope="col" class="num">Quantity</th>
              <th scope="col" class="num">Amount requested</th>
            </tr>
          </thead>
          <tbody>
            ${row.services.map((service) => `
              <tr>
                <td>${esc(preauth.serviceLabel(service))}</td>
                <td class="num t-mono-sm">${service.qty}</td>
                <td class="num t-mono-sm">${usd(service.requestedAmount)}</td>
              </tr>`).join('')}
            <tr>
              <td><b>Total</b></td>
              <td class="num"></td>
              <td class="num t-mono-sm"><b>${usd(preauth.requestedTotal(row))}</b></td>
            </tr>
          </tbody>
        </table>

        <div class="toolbar"><span class="t-title-sm">Clinical justification</span></div>
        <p class="t-body-sm">${esc(row.justification)}</p>

        ${row.documents.filter((doc) => doc.kind === 'Supporting').length
          ? `<div class="toolbar"><span class="t-title-sm">Attached</span></div>
             <p class="t-body-sm">${row.documents.filter((doc) => doc.kind === 'Supporting')
               .map((doc) => esc(doc.fileName)).join(', ')}</p>`
          : ''}

        <div class="toolbar"><span class="t-title-sm">Signature</span></div>
        <p class="t-body-sm">Requesting physician: ${esc(doctorName(row.doctorId))}</p>
        <p class="t-body-sm">Signed: ______________________________&nbsp;&nbsp;&nbsp;Date: ______________</p>
        <p class="t-body-sm">For payer use — authorisation no.: ______________________&nbsp;&nbsp;&nbsp;
          valid from: ____________&nbsp;&nbsp;&nbsp;to: ____________</p>
      </div>
    </div>`;
}

/** The form is only a form once it has been sent; a draft is still a draft. */
export const notYetHtml = () => `
  <div class="state-view">
    <div class="state-view__glyph"><span class="icon">draft</span></div>
    <div class="state-view__title">Not sent yet</div>
    <p class="state-view__body">The printable form is what goes to the payer, so it exists from the moment the
      request is submitted. Submitting freezes the services and the justification, which is what makes the form
      reprintable — the same document, however long afterwards.</p>
  </div>`;
