// The log's table, its empty state and its CSV — the markup half of
// nullification-log.js, split so the screen stays near the line cap. A
// restricted record's row withholds its cover and its money, the encounter
// board's line; the record still shows that a claim was withdrawn, and when.

import * as nullifications from '../../../../data/repositories/nullifications.js';
import * as patients from '../../../../data/repositories/patients.js';
import { date, dateTime, esc } from '../../../../shared/format.js';
import { withheldCell } from '../claims-assembly/claim-chips.js';
import {
  actorsHtml, atHtml, dispositionHtml, notificationHtml, pathHtml, payerName, reasonHtml, replacementHtml, statusAtHtml, valueHtml,
} from './nullification-chips.js';

export function tableHtml(rows, role) {
  return `
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">Nullification</th>
          <th scope="col">Claim</th>
          <th scope="col">Patient</th>
          <th scope="col">Payer</th>
          <th scope="col">Value</th>
          <th scope="col">Status at nullification</th>
          <th scope="col">Reason</th>
          <th scope="col">Payer notified</th>
          <th scope="col">Disposition</th>
          <th scope="col">Replacement</th>
          <th scope="col">Requested / approved by</th>
          <th scope="col">At</th>
        </tr>
      </thead>
      <tbody>${rows.map((n) => rowHtml(n, role)).join('')}</tbody>
    </table>`;
}

function rowHtml(n, role) {
  const patient = patients.view(patients.get(n.patientMrn), role);
  const masked = Boolean(patient?.masked);
  return `
    <tr data-no="${esc(n.no)}">
      <td><a class="crumb-link t-mono-sm" href="#/claima/nullifications/${esc(n.no)}">${esc(n.no)}</a><br>${pathHtml(n)}</td>
      <td><a class="crumb-link t-mono-sm" href="#/claima/claims/${esc(n.claimNo)}">${esc(n.claimNo)}</a>${
        n.encounterNo ? `<br><a class="crumb-link t-mono-sm" href="#/frontis/encounters/${esc(n.encounterNo)}">${esc(n.encounterNo)}</a>` : ''}</td>
      <td>${patient
        ? `<a class="crumb-link" href="#/frontis/patients/${esc(n.patientMrn)}">${esc(patient.nameEn)}</a><br><span class="t-mono-sm">${esc(n.patientMrn)}</span>`
        : `<span class="t-mono-sm">${esc(n.patientMrn || '—')}</span>`}</td>
      <td>${masked ? withheldCell() : esc(payerName(n.payerId))}</td>
      <td>${masked ? withheldCell() : valueHtml(n)}</td>
      <td>${statusAtHtml(n)}</td>
      <td>${reasonHtml(n)}</td>
      <td>${notificationHtml(n)}</td>
      <td>${dispositionHtml(n)}</td>
      <td>${masked ? withheldCell() : replacementHtml(n)}</td>
      <td>${actorsHtml(n)}</td>
      <td>${atHtml(n)}</td>
    </tr>`;
}

export function emptyHtml(filtered) {
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">${filtered ? 'search_off' : 'block'}</span></div>
      <div class="state-view__title">${filtered ? 'No nullifications match' : 'Nothing has been nullified'}</div>
      <p class="state-view__body">${filtered
    ? 'Change the search text or clear the filters to see every record.'
    : 'A claim is withdrawn from its own page — Nullify in the header — and the record lands here. The log is immutable: a record is never edited or removed.'}</p>
      <div class="state-view__actions">${filtered ? '<button class="btn btn--secondary" data-act="clear">Clear filters</button>' : ''}</div>
    </div>`;
}

// --- export ---------------------------------------------------------------------------------

const COLUMNS = [
  'Nullification no.', 'Claim', 'Encounter', 'Patient MRN', 'Patient', 'Payer', 'Value', 'Status at nullification',
  'Path', 'Reason code', 'Reason', 'Reason text', 'Justification', 'Payer notification', 'Notification reference',
  'Notification date', 'Disposition', 'Hold reason', 'Lines returned', 'Batch removed', 'Replacement', 'Replacement kind',
  'Requested by', 'Approved by', 'At',
];

/** The rows on screen as CSV. A restricted record's cover and money are withheld here too. */
export function csvOf(rows, role) {
  const lines = [csvLine(COLUMNS)];
  for (const n of rows) {
    const patient = patients.view(patients.get(n.patientMrn), role);
    const masked = Boolean(patient?.masked);
    lines.push(csvLine([
      n.no, n.claimNo, n.encounterNo || '', n.patientMrn || '', patient?.nameEn || '',
      masked ? 'withheld' : payerName(n.payerId), masked ? 'withheld' : Number(n.valueAtNullification).toFixed(2),
      n.statusAtNullification, nullifications.PATH_LABELS[n.path] || n.path, n.reasonCode,
      nullifications.nullificationLabel(n.reasonCode), n.reasonText || '', n.justification,
      n.payerNotification?.method || '', n.payerNotification?.reference || '', n.payerNotification?.date ? date(n.payerNotification.date) : '',
      nullifications.DISPOSITION_LABELS[n.disposition?.kind] || '', n.disposition?.reason || '', (n.disposition?.lineIds || []).length,
      n.batchRemoved?.batchNo || '', masked ? 'withheld' : (n.replacement?.claimNo || ''), n.replacement?.kind || '',
      n.actors?.requestedBy || '', n.actors?.approvedBy || '', dateTime(n.at),
    ]));
  }
  return lines.join('\r\n');
}

function csvLine(values) {
  return values.map((v) => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',');
}

/** Hand the browser a file — the same six lines every export in the platform uses. */
export function download(name, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
