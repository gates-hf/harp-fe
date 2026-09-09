// The small pieces a referral is read by, in one place because four screens
// draw them: the worklist, the form's banner, the encounter page's Linked
// Records row and the Referrals section on the patient record.
//
// A referral says who asked, who is being asked, how long the question is good
// for and how much of it is left — and every one of those is a chip somewhere.

import * as referrals from '../../../../data/repositories/referrals.js';
import { date, esc } from '../../../../shared/format.js';

/** Inbound arrives, outbound leaves — the arrow says which without reading. */
export function directionHtml(row) {
  const inbound = row.direction === 'Inbound';
  return `<span class="badge${inbound ? ' badge--accent' : ''}" title="${
    inbound ? 'Sent to us by a doctor outside this department' : 'Written here and sent elsewhere'}">
      <span class="icon icon--sm">${inbound ? 'call_received' : 'call_made'}</span>${esc(row.direction)}</span>`;
}

export function statusHtml(row) {
  const tone = referrals.statusTone(row.status);
  return `<span class="badge${tone ? ` badge--${tone}` : ''}"${row.statusReason ? ` title="${esc(row.statusReason)}"` : ''}>
      <span class="dot"></span>${esc(row.status)}</span>`;
}

/** Matched records carry their MRN; anything else is a patient nobody has yet. */
export function patientHtml(row) {
  return `
    ${esc(referrals.patientName(row))}
    <br>${row.patientMrn
      ? `<a class="crumb-link t-mono-sm" href="#/frontis/patients/${esc(row.patientMrn)}">${esc(row.patientMrn)}</a>`
      : `<span class="badge" title="Taken over the phone — ${esc(referrals.phoneOf(row) || 'no number')}">Unregistered</span>`}`;
}

/** The date the question stops being good for, amber when it is nearly up. */
export function validHtml(row) {
  if (!row.validUntil) return '<span class="t-body-sm">No end date</span>';
  const left = referrals.daysLeft(row);
  const expiring = referrals.isExpiring(row);
  return `
    <span class="t-mono-sm">${date(row.validUntil)}</span>
    ${expiring
      ? `<br><span class="badge badge--warning" title="Still valid, and the one to book first">
           <span class="dot"></span>${left === 0 ? 'Today' : `${left} day${left === 1 ? '' : 's'} left`}</span>`
      : left < 0 ? '<br><span class="t-body-sm">lapsed</span>' : ''}`;
}

/** Only a multi-visit referral says anything: a single one is spent or it is not. */
export function visitsHtml(row) {
  if (row.visits.total <= 1) return '<span class="t-body-sm">—</span>';
  return `<span class="t-mono-sm" title="${row.visits.remaining} of ${row.visits.total} visits left on this referral">${
    row.visits.remaining}/${row.visits.total}</span>`;
}

/** The encounters it has been spent on, as links. */
export function encountersHtml(row) {
  const ids = row.encounterNos || [];
  if (!ids.length) return '<span class="t-body-sm">None</span>';
  return ids
    .map((no) => `<a class="crumb-link t-mono-sm" href="#/frontis/encounters/${esc(no)}">${esc(no)}</a>`)
    .join('<br>');
}

/**
 * The Referrals section on the patient record's Encounters tab. A referral is
 * about the visit rather than the money, so it sits above the visits and beside
 * what is expected.
 */
export function referralsSectionHtml(mrn, { readOnly = false, canOpen = true } = {}) {
  const rows = referrals.byPatient(mrn);
  const open = rows.filter(referrals.isOpen).length;
  const why = readOnly
    ? 'A merged record is read-only — take the referral on the record that survived'
    : 'This record cannot open an encounter, so a referral has nothing to be spent on';
  return `
    <div class="toolbar">
      <span class="t-title-sm">Referrals</span>
      <span class="t-body-sm">${rows.length
        ? `${rows.length} on file · ${open} still open`
        : 'none on file'}</span>
      <span class="spacer"></span>
      ${readOnly || !canOpen
        ? `<button class="btn btn--ghost btn--sm" disabled title="${esc(why)}">
             <span class="icon icon--sm">call_received</span>New inbound</button>
           <button class="btn btn--ghost btn--sm" disabled title="${esc(why)}">
             <span class="icon icon--sm">call_made</span>Refer out</button>`
        : `<a class="btn btn--ghost btn--sm" href="#/frontis/referrals/new?direction=Inbound&mrn=${esc(mrn)}">
             <span class="icon icon--sm">call_received</span>New inbound</a>
           <a class="btn btn--ghost btn--sm" href="#/frontis/referrals/new?direction=Outbound&mrn=${esc(mrn)}">
             <span class="icon icon--sm">call_made</span>Refer out</a>`}
    </div>
    ${rows.length ? tableHtml(rows) : '<p class="t-body-sm">No referral has been taken or written for this patient.</p>'}`;
}

function tableHtml(rows) {
  return `
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">Referral no.</th>
          <th scope="col">Direction</th>
          <th scope="col">Source / destination</th>
          <th scope="col">Specialty</th>
          <th scope="col">Valid until</th>
          <th scope="col">Visits</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td><a class="crumb-link t-mono-sm" href="#/frontis/referrals/${esc(row.no)}/view">${esc(row.no)}</a></td>
            <td>${directionHtml(row)}</td>
            <td>${esc(referrals.partiesLabel(row))}</td>
            <td>${esc(referrals.specialtyOf(row) || '—')}</td>
            <td>${validHtml(row)}</td>
            <td>${visitsHtml(row)}</td>
            <td>${statusHtml(row)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}
