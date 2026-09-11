// The appeals workbench's table: one row per case — level, the denial and
// the claim, the patient, the payer, the disputed amount, the ground, the
// status, the review tier and its state, the filing countdown and the
// preparer. A row is opened, and that is its only action here: what is done
// to a case is done on its page. Markup only — the screen owns the state.

import * as appealCases from '../../../../data/repositories/appeal-cases.js';
import { esc } from '../../../../shared/format.js';
import {
  deadlineHtml, groundHtml, isWithheld, lateHtml, levelHtml, moneyHtml, patientHtml, payerName, preparerHtml, reviewHtml, statusHtml, tierHtml, withheldCell,
} from './appeal-chips.js';

export function tableHtml(rows, role) {
  return `
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">Case</th>
          <th scope="col" title="First or second level">Level</th>
          <th scope="col">Denial</th>
          <th scope="col">Claim</th>
          <th scope="col">Patient</th>
          <th scope="col">Payer</th>
          <th scope="col">Disputed</th>
          <th scope="col">Ground</th>
          <th scope="col">Status</th>
          <th scope="col" title="The tier the disputed amount needs">Tier</th>
          <th scope="col">Review</th>
          <th scope="col" title="Days left to file — amber inside the warning window, red once passed">Deadline</th>
          <th scope="col">Preparer</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>${rows.map((a) => rowHtml(a, role)).join('')}</tbody>
    </table>`;
}

function rowHtml(a, role) {
  const claim = appealCases.claimOf(a);
  const masked = claim ? isWithheld(claim, role) : false;
  const dl = appealCases.deadlineOf(a);
  return `
    <tr data-id="${esc(a.id)}" tabindex="0" title="Open ${esc(a.id)}"${dl.warn || dl.passed ? ' aria-current="true"' : ''}>
      <td><a class="crumb-link t-mono-sm" href="#/defensio/appeals/${esc(a.id)}">${esc(a.id)}</a>${a.parentCaseId ? `<br><span class="t-body-sm">after ${esc(a.parentCaseId)}</span>` : ''}</td>
      <td>${levelHtml(a)}</td>
      <td>${(a.denialIds || []).map((d) => `<a class="crumb-link t-mono-sm" href="#/defensio/denials/${esc(d)}">${esc(d)}</a>`).join('<br>') || '—'}</td>
      <td><a class="crumb-link t-mono-sm" href="#/claima/claims/${esc(a.claimNo)}" title="Open the claim">${esc(a.claimNo || '—')}</a></td>
      <td>${claim ? (masked ? withheldCell() : patientHtml(claim, role)) : '<span class="t-body-sm">—</span>'}</td>
      <td>${masked ? withheldCell() : esc(payerName(a))}</td>
      <td>${masked ? withheldCell() : moneyHtml(a.disputedAmount, 'What the appeal asks the payer to pay')}</td>
      <td>${groundHtml(a)}</td>
      <td>${statusHtml(a)}${lateHtml(a)}</td>
      <td>${tierHtml(a)}</td>
      <td>${reviewHtml(a)}</td>
      <td>${deadlineHtml(a)}</td>
      <td>${preparerHtml(a)}</td>
      <td>
        <button class="btn btn--${dl.warn || dl.passed ? 'primary' : 'secondary'} btn--sm" data-act="open" title="${appealCases.beforeSubmission(a) ? 'Open the case and work it' : 'Open the case — read-only once filed'}">
          <span class="icon icon--sm">${appealCases.beforeSubmission(a) ? 'edit_document' : 'open_in_new'}</span>Open
        </button>
      </td>
    </tr>`;
}

export function pagerHtml(start, shown, total, page, pages) {
  return `
    <div class="tbl-foot">
      <span class="range">${start + 1}–${start + shown} of ${total}</span>
      <span class="pager">
        <button class="btn btn--secondary btn--sm" data-page="prev"${page === 0 ? ' disabled title="You are on the first page"' : ''}>
          <span class="icon icon--sm">chevron_left</span>Previous
        </button>
        <button class="btn btn--secondary btn--sm" data-page="next"${page >= pages - 1 ? ' disabled title="You are on the last page"' : ''}>
          Next<span class="icon icon--sm">chevron_right</span>
        </button>
      </span>
    </div>`;
}

export function emptyHtml(filtered) {
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">${filtered ? 'search_off' : 'gavel'}</span></div>
      <div class="state-view__title">${filtered ? 'Nothing matches' : 'No appeal cases'}</div>
      <p class="state-view__body">${filtered
        ? 'No case matches these filters. Clear them to see the whole list.'
        : 'A case opens when a triaged denial is routed to Appeal on the denials worklist. Triage one, route it, and it lands here as a draft.'}</p>
      ${filtered ? '<div class="state-view__actions"><button class="btn btn--secondary" data-act="clear">Clear filters</button></div>'
    : '<div class="state-view__actions"><a class="btn btn--secondary" href="#/defensio/denials">Open the denials</a></div>'}
    </div>`;
}
