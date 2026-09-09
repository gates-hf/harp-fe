// The Eligibility tab on the patient record, at
// #/frontis/patients/<mrn>/eligibility. Every check ever run on this patient,
// newest first, and nothing else — a snapshot is read on its own page.
//
// Same shape as the Documents tab: patient-view.js owns the panel and the click
// handler, this file returns the markup. Read-only by nature, so it carries no
// actions of its own beyond starting a new check.

import * as eligibility from '../../../../data/repositories/eligibility.js';
import { dateTime, esc } from '../../../../shared/format.js';
import { resultBadge } from './eligibility-panel.js';

export const checkCount = (mrn) => eligibility.byPatient(mrn).length;

/**
 * The tab's body. A merged record is read-only outright — its checks moved with
 * the patient — so the only thing it loses is the button that starts a new one.
 */
export function eligibilityHtml(mrn, { readOnly = false } = {}) {
  const rows = eligibility.byPatient(mrn);
  return `
    <div class="toolbar">
      <span class="t-title-sm">${summaryLine(rows)}</span>
      <span class="spacer"></span>
      ${readOnly
        ? `<button class="btn btn--secondary btn--sm" disabled title="A merged record is read-only — verify the record that survived">
             <span class="icon icon--sm">verified_user</span>Check eligibility
           </button>`
        : `<a class="btn btn--secondary btn--sm" href="#/frontis/eligibility/new?mrn=${esc(mrn)}">
             <span class="icon icon--sm">verified_user</span>Check eligibility
           </a>`}
    </div>
    ${rows.length ? tableHtml(rows) : emptyHtml(mrn, readOnly)}`;
}

/** The newest check is what the desk actually wants at a glance. */
function summaryLine(rows) {
  const last = rows[0];
  if (!last) return 'Eligibility';
  return `Last checked ${dateTime(last.checkedAt)} — ${last.finalResult}`;
}

function tableHtml(rows) {
  return `
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">Checked</th>
          <th scope="col">Cover</th>
          <th scope="col">Result</th>
          <th scope="col">Reference no.</th>
          <th scope="col">Encounter</th>
          <th scope="col">Checked by</th>
        </tr>
      </thead>
      <tbody>${rows.map(rowHtml).join('')}</tbody>
    </table>`;
}

function rowHtml(row) {
  return `
    <tr>
      <td class="t-mono-sm">${dateTime(row.checkedAt)}<br><span class="t-body-sm">${esc(row.checkType)}</span></td>
      <td>${esc(eligibility.coverLabel(row))}</td>
      <td>${resultBadge(row)}</td>
      <td><a class="crumb-link t-mono-sm" href="#/frontis/eligibility/${esc(row.ref)}">${esc(row.ref)}</a></td>
      <td>${row.encounterId ? `<a class="crumb-link t-mono-sm" href="#/frontis/encounters/${esc(row.encounterId)}">${esc(row.encounterId)}</a>` : '<span class="t-mono-sm">—</span>'}</td>
      <td>${esc(row.checkedBy)}</td>
    </tr>`;
}

function emptyHtml(mrn, readOnly) {
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">verified_user</span></div>
      <div class="state-view__title">Nothing checked yet</div>
      <p class="state-view__body">No eligibility check has been run against this record. A check reads the
        policy chain against the payer's contract and records what it found, so the desk can tell the patient
        what they owe before the encounter opens.</p>
      ${readOnly ? '' : `
        <div class="state-view__actions">
          <a class="btn btn--primary" href="#/frontis/eligibility/new?mrn=${esc(mrn)}">Check eligibility</a>
        </div>`}
    </div>`;
}
