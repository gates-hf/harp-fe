// The chips the coding screens read a chart by: its status, its age against
// the SLA, who it is for and who has it. One file, so the worklist, the
// workspace banner and the metrics name a state the same way.

import * as coding from '../../../../data/repositories/coding.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import * as patients from '../../../../data/repositories/patients.js';
import { date, dateTime, esc } from '../../../../shared/format.js';

export function statusTone(status) {
  if (status === 'Coded') return 'success';
  if (status === 'Query Pending') return 'warning';
  if (status === 'Recode Requested') return 'critical';
  if (status === 'In Progress') return 'accent';
  return '';
}

export const statusHtml = (status) =>
  `<span class="badge${statusTone(status) ? ` badge--${statusTone(status)}` : ''}"><span class="dot"></span>${esc(status)}</span>`;

export const typeHtml = (type) =>
  `<span class="badge${type === 'ER' ? ' badge--critical' : type === 'IP' ? ' badge--accent' : ''}"
         title="${esc(encounters.typeLabel(type))}">${esc(type)}</span>`;

/** Whole days, or "today" — an age is read at a glance, not to the hour. */
export function daysLabel(days) {
  const n = Math.floor(Number(days) || 0);
  if (n < 1) return 'today';
  return `${n} day${n === 1 ? '' : 's'}`;
}

/**
 * The age column: a critical chip past the SLA, plain text inside it. The
 * design system tints a badge and not a line of text, so a breach is a chip.
 * A coded chart reads its turnaround the same way, since a late chart was
 * late whether or not it has since been finished.
 */
export function ageHtml(row) {
  const open = row.status !== 'Coded';
  const title = open
    ? `Released ${dateTime(row.releasedAt)} · due ${date(row.dueAt)} (${row.slaDays}-day SLA)`
    : `Released ${dateTime(row.releasedAt)} · coded ${dateTime(row.codedAt)} (${row.slaDays}-day SLA)`;
  if (row.beyondSla) {
    return `<span class="badge badge--critical" title="${esc(title)} — beyond SLA">
      <span class="dot"></span>${esc(daysLabel(row.ageDays))}</span>`;
  }
  return `<span class="t-body-sm" title="${esc(title)}">${esc(daysLabel(row.ageDays))}</span>`;
}

/** Patient name over MRN, read through view() so a restricted record masks. */
export function patientHtml(mrn, role) {
  const patient = patients.view(patients.get(mrn), role);
  return `${esc(patient?.nameEn || mrn)}${
    patient?.vip && !patient?.masked ? ' <span class="badge badge--accent">VIP</span>' : ''}
    <br><span class="t-mono-sm">${esc(mrn)}</span>`;
}

export const coderHtml = (id) =>
  (id ? esc(coding.coderName(id)) : '<span class="t-body-sm">Unassigned</span>');

/** The recode-request badge on a chart that has one waiting. */
export function requestHtml(rec) {
  const open = coding.openRecodeRequests(rec);
  if (!open.length) return '';
  const req = open[open.length - 1];
  return `<span class="badge badge--critical" title="${esc(`${req.id} · ${req.source}${req.ref ? ` · ${req.ref}` : ''} — ${req.reason}`)}">
    <span class="dot"></span>${esc(req.source === 'LateCharge' ? 'Late charge' : req.source)}</span>`;
}
