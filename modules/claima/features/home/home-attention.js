// The things on the Claima dashboard that want somebody to act: claims the
// scrub refused or a change made stale, claims a payer has gone quiet on,
// denials nobody has triaged, and cash captured but not posted. Each panel
// shows the worst five and hands the rest to the list its header links to.
//
// Nothing is computed here. Every row set is the owning repository's own
// helper — the same one the screen behind "View all" reads — and the cells
// are the chips those features already draw, imported from their chip files
// rather than copied: one module, one way of naming a claim, a denial or a
// remittance (the call the lifecycle and denial features already made).
//
// The panel frame is the Frontis dashboard's, copied rather than imported: a
// module never reaches into another module's files.

import * as claims from '../../../../data/repositories/claims.js';
import * as lifecycle from '../../../../data/engines/claim-events.js';
import * as denials from '../../../../data/repositories/denials.js';
import * as remittances from '../../../../data/repositories/remittances.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { compareDates, esc, relativeTime, usd } from '../../../../shared/format.js';
import {
  coverLabel, isWithheld, kindHtml, patientHtml, scrubHtml, staleHtml, statusHtml as claimStatus,
  valueHtml, withheldCell,
} from '../claims-assembly/claim-chips.js';
import { escalatedFlag, silentChip } from '../lifecycle/lifecycle-chips.js';
import {
  amountHtml, deadlineHtml, payerName as denialPayer, reasonHtml, statusHtml as denialStatus,
} from '../denials/denial-chips.js';
import {
  matchSummary, money, paymentHtml, payerName as remittancePayer, statusHtml as remittanceStatus,
} from '../remittance/remittance-chips.js';

const MAX_ROWS = 5;

/** The first row of panels: the claims that cannot go, and the ones nobody answers. */
export const topHtml = () => scrubPanel() + silencePanel();

/** The second: refusals to triage, and cash to post. */
export const bottomHtml = () => denialsPanel() + remittancesPanel();

// --- scrub-failed & stale claims ------------------------------------------------

/** In assembly, refused by the scrub or made stale by a change — by value, largest first. */
export const scrubRows = () => claims.inAssembly()
  .filter((c) => claims.scrubResult(c) === 'Fail' || claims.isStale(c))
  .sort((a, b) => (Number(b.totals?.payerShare) || 0) - (Number(a.totals?.payerShare) || 0));

function scrubPanel() {
  const rows = scrubRows();
  return panel({
    title: 'Scrub-failed & stale claims',
    href: '#/claima/claims',
    total: rows.length,
    headers: ['Claim', 'Patient', 'Cover', 'Problem', 'Value'],
    body: rows.slice(0, MAX_ROWS).map(scrubRow).join(''),
    empty: {
      icon: 'verified',
      title: 'All claims clean',
      body: 'Nothing in assembly failed its scrub or went stale. A claim the scrub refuses lands here.',
    },
  });
}

function scrubRow(claim) {
  const role = currentRole();
  const withheld = isWithheld(claim, role);
  return `
    ${rowStart(`/claima/claims/${claim.claimNo}`, `Open ${claim.claimNo}`)}
      <td><a class="crumb-link t-mono-sm" href="#/claima/claims/${esc(claim.claimNo)}">${esc(claim.claimNo)}</a>
        ${kindHtml(claim)}<br>${claimStatus(claim)}</td>
      <td>${patientHtml(claim, role)}</td>
      <td>${withheld ? withheldCell() : esc(coverLabel(claim))}</td>
      <td>${scrubHtml(claim)} ${staleHtml(claim)}</td>
      <td>${withheld ? withheldCell() : valueHtml(claim)}</td>
    </tr>`;
}

// --- escalated & silent ---------------------------------------------------------

/** The follow-up queue, escalated first, then the longest silence. */
export const silenceRows = () => [...lifecycle.silent()]
  .sort((a, b) => Number(b.escalated) - Number(a.escalated) || b.silent - a.silent);

function silencePanel() {
  const rows = silenceRows();
  return panel({
    title: 'Escalated & silent',
    href: '#/claima/followups',
    total: rows.length,
    headers: ['Claim', 'Patient', 'Cover', 'Silent', 'Value'],
    body: rows.slice(0, MAX_ROWS).map(silenceRow).join(''),
    empty: {
      icon: 'hearing',
      title: 'No payer silence',
      body: 'Every submitted claim has heard from its payer inside the threshold. One that goes quiet lands here.',
    },
  });
}

function silenceRow(annotated) {
  const { claim } = annotated;
  const role = currentRole();
  const withheld = isWithheld(claim, role);
  return `
    ${rowStart(`/claima/timeline/${claim.claimNo}`, `Open the timeline of ${claim.claimNo}`)}
      <td><a class="crumb-link t-mono-sm" href="#/claima/claims/${esc(claim.claimNo)}">${esc(claim.claimNo)}</a>
        <br>${claimStatus(claim)}</td>
      <td>${patientHtml(claim, role)}</td>
      <td>${withheld ? withheldCell() : esc(coverLabel(claim))}</td>
      <td>${silentChip(annotated)} ${escalatedFlag(annotated)}</td>
      <td>${withheld ? withheldCell() : valueHtml(claim)}</td>
    </tr>`;
}

// --- untriaged denials ----------------------------------------------------------

/** The open denials nobody has classed, largest open amount first. */
export const untriagedRows = () => denials.worklist()
  .filter((d) => d.status === 'Untriaged')
  .sort((a, b) => (Number(b.amounts?.open) || 0) - (Number(a.amounts?.open) || 0));

function denialsPanel() {
  const rows = untriagedRows();
  return panel({
    title: 'Untriaged denials',
    // A36 — denial management is Defensio's: the panel and its rows open there.
    href: '#/defensio/denials?status=Untriaged',
    total: rows.length,
    headers: ['Denial', 'Payer', 'Reason', 'Amount', 'Appeal by'],
    body: rows.slice(0, MAX_ROWS).map(denialRow).join(''),
    empty: {
      icon: 'rule',
      title: 'Nothing to triage',
      body: 'Every denial has been classed and routed. A refusal a remittance posts lands here.',
    },
  });
}

function denialRow(denial) {
  const role = currentRole();
  const withheld = denial.patientMrn ? isWithheld(denial, role) : false;
  return `
    ${rowStart(`/defensio/denials/${denial.id}`, `Open ${denial.id}`)}
      <td><span class="t-mono-sm">${esc(denial.id)}</span>
        <br><a class="crumb-link t-mono-sm" href="#/claima/claims/${esc(denial.claimNo)}">${esc(denial.claimNo)}</a></td>
      <td>${withheld ? withheldCell() : `${esc(denialPayer(denial))}<br>${denialStatus(denial)}`}</td>
      <td>${reasonHtml(denial)}</td>
      <td>${withheld ? withheldCell() : amountHtml(denial)}</td>
      <td>${deadlineHtml(denial)}</td>
    </tr>`;
}

// --- remittances pending posting ------------------------------------------------

/** Captured and not posted, or posted with something still open — oldest payment first. */
export const pendingRemittances = () => remittances.search('', {})
  .filter((r) => r.status === 'Unposted' || r.status === 'Posted with Exceptions')
  .sort((a, b) => compareDates(a.payment.date, b.payment.date)
    || String(a.capture?.at || '').localeCompare(String(b.capture?.at || ''))
    || a.remittanceNo.localeCompare(b.remittanceNo));

function remittancesPanel() {
  const rows = pendingRemittances();
  return panel({
    title: 'Remittances pending posting',
    href: '#/claima/remittances',
    total: rows.length,
    headers: ['Remittance', 'Payment', 'Status', 'Matching', 'Unapplied'],
    body: rows.slice(0, MAX_ROWS).map(remittanceRow).join(''),
    empty: {
      icon: 'price_check',
      title: 'All cash posted',
      body: 'Every remittance captured has been posted and reconciled. A file uploaded or a payment entered by hand lands here.',
    },
  });
}

function remittanceRow(rem) {
  const open = remittances.openExceptions(rem).length;
  const waiting = remittances.unpostedRows(rem).length;
  const note = rem.status === 'Unposted'
    ? `${matchSummary(rem)} · captured ${relativeTime(rem.capture?.at)}`
    : `${open} open exception${open === 1 ? '' : 's'}${waiting ? ` · ${waiting} row${waiting === 1 ? '' : 's'} unposted` : ''}`;
  return `
    ${rowStart(`/claima/remittances/${rem.remittanceNo}`, `Open ${rem.remittanceNo}`)}
      <td><span class="t-mono-sm">${esc(rem.remittanceNo)}</span>
        <br><span class="t-body-sm">${esc(remittancePayer(rem.payerId))}</span></td>
      <td>${paymentHtml(rem)}<br>${money(rem.payment.total)}</td>
      <td>${remittanceStatus(rem)}</td>
      <td><span class="t-body-sm">${esc(note)}</span></td>
      <td>${rem.unapplied > 0
        ? `<span class="badge badge--warning" title="${esc(`${usd(rem.unapplied)} on this remittance is not accounted for by any claim`)}">${esc(usd(rem.unapplied))}</span>`
        : '<span class="t-body-sm">—</span>'}</td>
    </tr>`;
}

// --- shared markup ----------------------------------------------------------------

/**
 * One attention panel: a header that says how many there are and links to the
 * whole list, and a five-row table or a positive empty state.
 */
function panel({ title, href, total, headers, body, empty }) {
  return `
    <div class="panel">
      <div class="panel-header">
        <span>${esc(title)}</span>
        ${total ? `<span class="badge">${total}</span>` : ''}
        <span class="spacer"></span>
        <a class="btn btn--ghost btn--sm" href="${esc(href)}" title="Open the full list">
          View all<span class="icon icon--sm">arrow_forward</span>
        </a>
      </div>
      <div class="panel-body">
        ${total ? `
          <table class="tbl">
            <thead><tr>${headers.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead>
            <tbody>${body}</tbody>
          </table>
          ${total > MAX_ROWS ? `<p class="t-body-sm">${total - MAX_ROWS} more in the full list.</p>` : ''}
        ` : `
          <div class="state-view">
            <div class="state-view__glyph"><span class="icon">${empty.icon}</span></div>
            <div class="state-view__title">${esc(empty.title)}</div>
            <p class="state-view__body">${esc(empty.body)}</p>
          </div>`}
      </div>
    </div>`;
}

const rowStart = (path, title) =>
  `<tr data-go="${esc(path)}" tabindex="0" title="${esc(title)}">`;
