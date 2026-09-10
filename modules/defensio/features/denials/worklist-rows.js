// The Defensio worklist's table: one row per denial with a checkbox for the
// bulk actions and the row's own Assign — the separation, the triage (tier
// over class), the route with its link, the status and the appeal countdown
// the amendment names, beside the claim, the patient and the money. Markup
// only — the screen owns the state and the listeners.

import * as denials from '../../../../data/repositories/denials.js';
import { esc } from '../../../../shared/format.js';
import {
  ageHtml, amountHtml, assigneeHtml, deadlineHtml, isWithheld, patientHtml, payerName, reasonHtml, repeatHtml,
  rootCauseHtml, routeHtml, scopeHtml, separationHtml, statusHtml, triageHtml, withheldCell,
} from './denial-chips.js';

export function tableHtml(rows, role, state) {
  const allSelected = rows.length > 0 && rows.every((d) => state.selected.has(d.id));
  return `
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col"><input type="checkbox" data-select="all" aria-label="Select every row"${allSelected ? ' checked' : ''}></th>
          <th scope="col">Denial</th>
          <th scope="col">Claim</th>
          <th scope="col">Patient</th>
          <th scope="col">Payer</th>
          <th scope="col">Amount</th>
          <th scope="col">Payer reason</th>
          <th scope="col" title="A true denial, a contractual adjustment or a TPA fee — the triage's first answer">Separation</th>
          <th scope="col" title="Tier over class; the category is in the tooltip">Triage</th>
          <th scope="col">Root cause</th>
          <th scope="col">Route</th>
          <th scope="col">Status</th>
          <th scope="col">Assignee</th>
          <th scope="col">Age</th>
          <th scope="col" title="Days left to appeal — amber inside the warning window, red once passed">Appeal deadline</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>${rows.map((d) => rowHtml(d, role, state)).join('')}</tbody>
    </table>`;
}

function rowHtml(d, role, state) {
  const claim = denials.claimOf(d);
  const masked = claim ? isWithheld(claim, role) : false;
  const me = role.name;
  return `
    <tr data-id="${esc(d.id)}" tabindex="0" title="Open ${esc(d.id)}">
      <td><input type="checkbox" data-select="${esc(d.id)}" aria-label="Select ${esc(d.id)}"${state.selected.has(d.id) ? ' checked' : ''}></td>
      <td><a class="crumb-link t-mono-sm" href="#/defensio/denials/${esc(d.id)}">${esc(d.id)}</a>${repeatHtml(d)}<br>${scopeHtml(d)}</td>
      <td><a class="crumb-link t-mono-sm" href="#/claima/claims/${esc(d.claimNo)}" title="Open the claim">${esc(d.claimNo)}</a></td>
      <td>${claim ? (masked ? withheldCell() : patientHtml(claim, role)) : '<span class="t-body-sm">—</span>'}</td>
      <td>${masked ? withheldCell() : esc(payerName(d))}</td>
      <td>${masked ? withheldCell() : amountHtml(d)}</td>
      <td>${reasonHtml(d)}</td>
      <td>${separationHtml(d)}</td>
      <td>${triageHtml(d)}</td>
      <td>${rootCauseHtml(d)}</td>
      <td>${routeHtml(d)}</td>
      <td>${statusHtml(d)}</td>
      <td>${assigneeHtml(d)}</td>
      <td>${ageHtml(d)}</td>
      <td>${deadlineHtml(d)}</td>
      <td>
        ${denials.isOpen(d) ? `
          <button class="btn btn--secondary btn--sm" data-act="assign" title="${d.assignee === me ? 'Hand the denial to somebody else' : 'Take it, or hand it to a colleague'}">
            <span class="icon icon--sm">person</span>${d.assignee === me ? 'Reassign' : 'Assign'}
          </button>
          <button class="btn btn--${d.status === 'Untriaged' ? 'primary' : 'secondary'} btn--sm" data-act="open" title="Open the denial and triage it">
            <span class="icon icon--sm">rule</span>${d.status === 'Untriaged' ? 'Triage' : 'Open'}
          </button>`
    : `<button class="btn btn--secondary btn--sm" data-act="open" title="Open the denial"><span class="icon icon--sm">open_in_new</span>Open</button>`}
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
      <div class="state-view__glyph"><span class="icon">${filtered ? 'search_off' : 'task_alt'}</span></div>
      <div class="state-view__title">${filtered ? 'Nothing matches' : 'No denials on file'}</div>
      <p class="state-view__body">${filtered
        ? 'No denial matches these filters. Clear them to see the whole list.'
        : 'A denial arrives when Claima posts a remittance with a line the payer refused. Post one on the Remittances workbench and it lands here untriaged.'}</p>
      ${filtered ? '<div class="state-view__actions"><button class="btn btn--secondary" data-act="clear">Clear filters</button></div>' : ''}
    </div>`;
}
