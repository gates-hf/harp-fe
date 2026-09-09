// The small pieces a pre-registration is read by, in one place because three
// screens draw them: the worklist, the form's banner and the "Expected" section
// on the patient record's Encounters tab.
//
// The arrival line is the reason this file exists. shared/format.js reads a
// stamp backwards — "2 hours ago" — because everything else in the platform
// records what has happened; a pre-registration is the one entity whose whole
// subject is ahead of the clock, so it needs "in 2 hours" as well.

import * as prereg from '../../../../data/repositories/prereg.js';
import { dateTime, esc, relativeTime, todayIso } from '../../../../shared/format.js';
import { completenessCell } from './prereg-completeness.js';

/** "in 2 hours", "in 3 days", "just now", "yesterday" — either side of now. */
export function arrivalLabel(at) {
  const then = Date.parse(at);
  if (!Number.isFinite(then)) return '—';
  const secs = Math.round((then - Date.now()) / 1000);
  if (secs < 60) return relativeTime(at);
  const mins = Math.round(secs / 60);
  if (mins < 60) return `in ${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

/** The Expected Arrival cell: the stamp, the reading, and a Today marker. */
export function arrivalHtml(row) {
  const at = row.visit.expectedAt;
  const today = prereg.expectedOn(row, todayIso());
  return `
    <span class="t-mono-sm">${dateTime(at)}</span>
    ${today ? '<span class="badge badge--accent">Today</span>' : ''}
    <br><span class="t-body-sm">${esc(arrivalLabel(at))}</span>`;
}

/** Matched records carry their MRN; anything else is a patient nobody has yet. */
export function patientHtml(row) {
  return `
    ${esc(prereg.patientName(row))}
    <br>${row.patientMrn
      ? `<a class="crumb-link t-mono-sm" href="#/frontis/patients/${esc(row.patientMrn)}">${esc(row.patientMrn)}</a>`
      : '<span class="badge">New</span>'}`;
}

/** Done · Failed · Pending, linking to the snapshot when there is one. */
export function precheckHtml(row) {
  const p = prereg.precheckIndicator(row);
  const badge = `<span class="badge${p.tone ? ` badge--${p.tone}` : ''}" title="${esc(p.label)}">
      <span class="dot"></span>${esc(p.status)}</span>`;
  return row.precheck?.snapshotRef
    ? `<a class="badge${p.tone ? ` badge--${p.tone}` : ''}" title="${esc(p.label)} · ${esc(row.precheck.snapshotRef)}"
          href="#/frontis/eligibility/${esc(row.precheck.snapshotRef)}"><span class="dot"></span>${esc(p.status)}</a>`
    : badge;
}

export function statusHtml(row) {
  const tone = prereg.statusTone(row.status);
  return `<span class="badge${tone ? ` badge--${tone}` : ''}"><span class="dot"></span>${esc(row.status)}</span>`;
}

/**
 * The Expected section on the patient record. Only what is still ahead and
 * still open: a converted pre-registration is read as the encounter it became,
 * which is the row underneath it in the same tab.
 */
export function expectedSectionHtml(mrn) {
  const rows = prereg.expectedFor(mrn);
  if (!rows.length) return '';
  return `
    <div class="toolbar">
      <span class="t-title-sm">Expected</span>
      <span class="t-body-sm">${rows.length} pre-registration${rows.length === 1 ? '' : 's'} not yet converted</span>
      <span class="spacer"></span>
      <a class="btn btn--ghost btn--sm" href="#/frontis/prereg">
        <span class="icon icon--sm">open_in_new</span>Expected arrivals
      </a>
    </div>
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">Pre-reg no.</th>
          <th scope="col">Expected arrival</th>
          <th scope="col">Visit</th>
          <th scope="col">Department</th>
          <th scope="col">Completeness</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td><a class="crumb-link t-mono-sm" href="#/frontis/prereg/${esc(row.no)}">${esc(row.no)}</a></td>
            <td>${arrivalHtml(row)}</td>
            <td><span class="badge" title="${esc(prereg.typeLabel(row.visit.type))}">${esc(row.visit.type)}</span></td>
            <td>${esc(row.visit.department)}</td>
            <td>${completenessCell(row)}</td>
            <td>${statusHtml(row)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}
