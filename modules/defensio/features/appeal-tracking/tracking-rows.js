// The appeal tracking worklist's table: one row per tracked case with a
// checkbox for the same-payer bulk follow-up — the response clock (the
// payer's deadline, overdue painted), the last follow-up and the next one
// due, the outcome, the recovery state and the money, beside the denial,
// the claim, the patient and the payer. Markup only — the screen owns the
// state and the listeners.

import * as tracking from '../../../../data/repositories/appeal-tracking.js';
import * as denials from '../../../../data/repositories/denials.js';
import { date, esc } from '../../../../shared/format.js';
import { amountHtml, clockHtml, isWithheld, nextDueHtml, outcomeHtml, patientHtml, payerName, recoveryHtml, statusHtml, withheldCell } from './tracking-chips.js';

export function tableHtml(rows, role, state) {
  const allSelected = rows.length > 0 && rows.every((c) => state.selected.has(c.id));
  return `
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col"><input type="checkbox" data-select="all" aria-label="Select every row"${allSelected ? ' checked' : ''}></th>
          <th scope="col">Case</th>
          <th scope="col">Denial</th>
          <th scope="col">Claim</th>
          <th scope="col">Patient</th>
          <th scope="col">Payer</th>
          <th scope="col">Disputed</th>
          <th scope="col">Submitted</th>
          <th scope="col" title="The payer's response deadline — not the filing deadline, which is the denial's">Response due</th>
          <th scope="col">Status</th>
          <th scope="col">Follow-up</th>
          <th scope="col">Outcome</th>
          <th scope="col">Recovery</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>${rows.map((c) => rowHtml(c, role, state)).join('')}</tbody>
    </table>`;
}

function rowHtml(c, role, state) {
  const claim = denials.claimOf({ claimId: c.claimId, claimNo: c.claimNo });
  const masked = claim ? isWithheld(claim, role) : false;
  const sub = tracking.submissionOf(c);
  const fus = tracking.followUpsOf(c);
  const last = fus[fus.length - 1];
  const clock = tracking.clockOf(c);
  return `
    <tr data-id="${esc(c.id)}" tabindex="0" title="${esc(clock.overdue ? `Open ${c.id} — the payer is ${Math.abs(clock.daysLeft)} days past its response window` : `Open ${c.id}`)}">
      <td><input type="checkbox" data-select="${esc(c.id)}" aria-label="Select ${esc(c.id)}"${state.selected.has(c.id) ? ' checked' : ''}></td>
      <td><a class="crumb-link t-mono-sm" href="#/defensio/appeal-tracking/${esc(c.id)}">${esc(c.id)}</a>${c.level > 1 ? ` <span class="badge badge--accent" title="Level ${c.level} — escalated from ${esc(c.parentCaseId || '')}">L${c.level}</span>` : ''}</td>
      <td>${tracking.denialIdsOf(c).map((id) => `<a class="crumb-link t-mono-sm" href="#/defensio/denials/${esc(id)}">${esc(id)}</a>`).join('<br>') || '—'}</td>
      <td><a class="crumb-link t-mono-sm" href="#/claima/claims/${esc(c.claimNo)}" title="Open the claim">${esc(c.claimNo || '—')}</a></td>
      <td>${claim ? (masked ? withheldCell() : patientHtml(claim, role)) : '<span class="t-body-sm">—</span>'}</td>
      <td>${masked ? withheldCell() : esc(payerName(c))}</td>
      <td>${masked ? withheldCell() : amountHtml(c)}</td>
      <td><span title="${esc(`${sub.method || ''} ${sub.reference ? `· ref ${sub.reference}` : ''}`)}">${date(sub.submittedAt)}${sub.method ? `<br><span class="t-body-sm">${esc(sub.method)}</span>` : ''}</span></td>
      <td>${clockHtml(c)}</td>
      <td>${statusHtml(c)}</td>
      <td>${last ? `<span title="${esc(`${last.method}${last.contact ? ` · ${last.contact}` : ''} — ${last.note}`)}">${date(last.date)}<br>${nextDueHtml(c)}</span>` : '<span class="t-body-sm">None yet</span>'}</td>
      <td>${outcomeHtml(c)}</td>
      <td>${masked ? withheldCell() : recoveryHtml(c)}</td>
      <td>
        ${tracking.isInFlight(c) ? `
          <button class="btn btn--secondary btn--sm" data-act="followup" title="Log a call, a portal check or an email to the payer">
            <span class="icon icon--sm">call</span>Follow up
          </button>
          <button class="btn btn--primary btn--sm" data-act="open" title="Open the case on its Tracking & outcome tab">
            <span class="icon icon--sm">gavel</span>Decision
          </button>`
    : `<button class="btn btn--secondary btn--sm" data-act="open" title="Open the case"><span class="icon icon--sm">open_in_new</span>Open</button>`}
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
      <div class="state-view__title">${filtered ? 'Nothing matches' : 'No submitted appeals'}</div>
      <p class="state-view__body">${filtered
        ? 'No case matches these filters. Clear them to see the whole list.'
        : 'A case arrives here once the appeal feature submits it to the payer. Route a denial to an appeal, prepare it, and submit it.'}</p>
      ${filtered ? '<div class="state-view__actions"><button class="btn btn--secondary" data-act="clear">Clear filters</button></div>' : ''}
    </div>`;
}
