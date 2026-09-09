// The Encounters tab on the patient record, at
// #/frontis/patients/<mrn>/encounters. Every visit this patient has had, newest
// first, and the door to the next one.
//
// Same shape as the Eligibility tab: patient-view.js owns the panel and the
// click handler, this file returns the markup.

import * as encounters from '../../../../data/repositories/encounters.js';
import { date, dateTime, esc } from '../../../../shared/format.js';
import { doctorName } from '../../../../data/seed/reference.js';

export const encounterCount = (mrn) => encounters.byPatient(mrn).length;

/**
 * The tab's body. `readOnly` is the merged record's rule — its encounters moved
 * to the survivor, so the only thing it loses is the button that opens another.
 * `masked` withholds the financial class and nothing else: that a restricted
 * patient was seen is not the secret, who pays for them is — the same line the
 * Insurance and Eligibility tabs draw.
 */
export function encountersHtml(mrn, { readOnly = false, canOpen = true, masked = false } = {}) {
  const rows = encounters.byPatient(mrn);
  const open = rows.filter(encounters.isOpen).length;
  return `
    <div class="toolbar">
      <span class="t-title-sm">${summaryLine(rows, open)}</span>
      <span class="spacer"></span>
      ${readOnly || !canOpen
        ? `<button class="btn btn--secondary btn--sm" disabled title="${esc(readOnly
            ? 'A merged record is read-only — register the visit on the record that survived'
            : 'This record cannot open an encounter')}">
             <span class="icon icon--sm">add</span>New encounter
           </button>`
        : `<a class="btn btn--secondary btn--sm" href="#/frontis/encounters/new?mrn=${esc(mrn)}">
             <span class="icon icon--sm">add</span>New encounter
           </a>`}
    </div>
    ${rows.length ? tableHtml(rows, masked) : emptyHtml(mrn, readOnly, canOpen)}`;
}

function summaryLine(rows, open) {
  if (!rows.length) return 'Encounters';
  const last = rows[0];
  return open
    ? `${open} open · last ${date(last.startAt)}`
    : `${rows.length} encounter${rows.length === 1 ? '' : 's'} · last ${date(last.startAt)}`;
}

function tableHtml(rows, masked) {
  return `
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">Encounter no.</th>
          <th scope="col">Type</th>
          <th scope="col">Department</th>
          <th scope="col">Doctor</th>
          <th scope="col">Financial class</th>
          <th scope="col">Status</th>
          <th scope="col">Start</th>
        </tr>
      </thead>
      <tbody>${rows.map((row) => rowHtml(row, masked)).join('')}</tbody>
    </table>`;
}

function rowHtml(enc, masked) {
  return `
    <tr>
      <td><a class="crumb-link t-mono-sm" href="#/frontis/encounters/${esc(enc.no)}">${esc(enc.no)}</a></td>
      <td><span class="badge${enc.type === 'ER' ? ' badge--critical' : enc.type === 'IP' ? ' badge--accent' : ''}"
                title="${esc(encounters.typeLabel(enc.type))}">${esc(enc.type)}</span></td>
      <td>${esc(enc.department)}</td>
      <td>${esc(doctorName(enc.doctorId))}</td>
      <td>${masked
        ? '<span class="badge" title="A restricted record’s cover is read by roles with VIP access only">withheld</span>'
        : `<span title="${esc(encounters.financialTitle(enc))}">${esc(encounters.financialLabel(enc))}</span>`}</td>
      <td><span class="badge${encounters.statusTone(enc.status) ? ` badge--${encounters.statusTone(enc.status)}` : ''}">
            <span class="dot"></span>${esc(enc.status)}</span>
        ${enc.los ? `<br><span class="t-body-sm">${enc.los} day${enc.los === 1 ? '' : 's'}</span>` : ''}</td>
      <td class="t-mono-sm">${dateTime(enc.startAt)}</td>
    </tr>`;
}

function emptyHtml(mrn, readOnly, canOpen) {
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">event_available</span></div>
      <div class="state-view__title">No encounters yet</div>
      <p class="state-view__body">Nothing has been opened against this record. An encounter is the visit itself —
        the pre-auths, the clearance, the estimates and the account all hang off one.</p>
      ${readOnly || !canOpen ? '' : `
        <div class="state-view__actions">
          <a class="btn btn--primary" href="#/frontis/encounters/new?mrn=${esc(mrn)}">New encounter</a>
        </div>`}
    </div>`;
}
