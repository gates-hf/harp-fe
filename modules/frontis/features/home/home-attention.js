// The things on the Frontis dashboard that want somebody to act: visits money
// cannot be collected on, authorisations running out or unanswered, arrivals to
// convert, records that may be the same person, and accounts carrying a flag.
// Each panel shows the first five and hands the rest to the list its header
// links to.
//
// Nothing is computed here. Every row set is the owning repository's own helper
// — the same one the screen behind "View all" reads — and the cells are the
// chips those features already draw, so a row means the same thing on both.
//
// The panel frame is the Pactum dashboard's, copied rather than imported: a
// module never reaches into another module's files.

import * as clearance from '../../../../data/repositories/clearance.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as prereg from '../../../../data/repositories/prereg.js';
import * as preauth from '../../../../data/repositories/preauth-requests.js';
import * as duplicates from '../../../../data/repositories/duplicates.js';
import * as accounts from '../../../../data/repositories/accounts.js';
import { flagChipsHtml } from '../accounts/account-flags.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { date, esc, relativeTime, usd } from '../../../../shared/format.js';
import { arrivalHtml, patientHtml as arrivalPatient } from '../prereg/prereg-chips.js';
import { completenessCell } from '../prereg/prereg-completeness.js';
import {
  isWithheld, patientHtml as authPatient, pendingHtml, servicesHtml, statusHtml as authStatus,
  validityHtml,
} from '../preauth/preauth-chips.js';

const MAX_ROWS = 5;

/** The first row of panels: the two answers that hold a visit up today. */
export const topHtml = () => blockedPanel() + preauthPanel();

/** The second: what is coming in, and what the register is unsure about. */
export const bottomHtml = () => arrivalsPanel() + duplicatesPanel();

/**
 * Account flags are amendment 22's, and the panel appears with the helper that
 * feeds it: a dashboard that named a number nobody can produce would be worse
 * than one panel short.
 */
export const flagsHtml = () => (typeof accounts.flagged === 'function' ? flaggedPanel() : '');

// --- blocked patients ---------------------------------------------------------

function blockedPanel() {
  const rows = clearance.byStatus('Blocked');
  return panel({
    title: 'Blocked patients',
    href: '#/frontis/clearance?status=Blocked',
    total: rows.length,
    headers: ['Patient', 'Visit', 'Blocking', 'Blocked for'],
    body: rows.slice(0, MAX_ROWS).map(blockedRow).join(''),
    empty: {
      icon: 'check_circle',
      title: 'Everyone is cleared',
      body: 'No open visit is held up on money. A missing signature or deposit lands here.',
    },
  });
}

function blockedRow(enc) {
  const patient = patients.view(patients.get(enc.patientMrn), currentRole());
  const stamp = clearance.stampOf(enc);
  const overdue = clearance.isOverdue(enc);
  return `
    ${rowStart(`/frontis/encounters/${enc.no}/clearance`, `Open the clearance for ${enc.no}`)}
      <td>${esc(patient?.nameEn || enc.patientMrn)}
        <br><span class="t-mono-sm">${esc(enc.patientMrn)}</span></td>
      <td><span class="badge">${esc(encounters.typeLabel(enc.type))}</span>
        <br><span class="t-mono-sm">${esc(enc.no)}</span></td>
      <td>${chips(stamp.blocking || [])}</td>
      <td>${stamp.pendingSince
        ? `<span class="${overdue ? 'badge badge--critical' : 't-body-sm'}" title="Since ${esc(date(stamp.pendingSince))}">${
            overdue ? '<span class="dot"></span>' : ''}${esc(relativeTime(stamp.pendingSince))}</span>`
        : '<span class="t-body-sm">—</span>'}</td>
    </tr>`;
}

// --- pre-auths requiring attention --------------------------------------------

function preauthPanel() {
  const rows = [...preauth.needsAction()].sort(authOrder);
  return panel({
    title: 'Pre-auths requiring attention',
    href: '#/frontis/preauth?view=needs-action',
    total: rows.length,
    headers: ['Patient', 'Services', 'Status', 'Waiting on'],
    body: rows.slice(0, MAX_ROWS).map(preauthRow).join(''),
    empty: {
      icon: 'gpp_good',
      title: 'No pre-auth needs attention',
      body: 'Nothing is unsent, unanswered or about to lapse.',
    },
  });
}

/** Expiring soonest first, then the longest unanswered, then the drafts. */
function authOrder(a, b) {
  const rank = (row) => (preauth.isExpiring(row) ? 0 : preauth.isPending(row) ? 1 : 2);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (rank(a) === 0) return (preauth.daysLeft(a) ?? 0) - (preauth.daysLeft(b) ?? 0);
  if (rank(a) === 1) return String(a.submittedAt).localeCompare(String(b.submittedAt));
  return String(b.createdAt).localeCompare(String(a.createdAt));
}

function preauthRow(row) {
  const role = currentRole();
  const withheld = isWithheld(row, role);
  return `
    ${rowStart(`/frontis/preauth/${row.no}`, `Open ${row.no}`)}
      <td>${authPatient(row, role)}</td>
      <td>${withheld ? '<span class="t-body-sm">withheld</span>' : servicesHtml(row)}</td>
      <td>${authStatus(row)}</td>
      <td>${preauth.isAuthorized(row) ? validityHtml(row) : pendingHtml(row)}</td>
    </tr>`;
}

// --- expected arrivals --------------------------------------------------------

function arrivalsPanel() {
  const rows = upcomingArrivals();
  return panel({
    // The whole worklist, not today's slice: the panel fills itself from the
    // days after when today is quiet, and that is the scope the worklist opens
    // in. The dashboard card above is the one that says today.
    title: 'Expected arrivals',
    href: '#/frontis/prereg',
    total: rows.length,
    headers: ['Patient', 'Expected', 'Complete', ''],
    body: rows.slice(0, MAX_ROWS).map(arrivalRow).join(''),
    empty: {
      icon: 'event_available',
      title: 'No arrivals expected today',
      body: 'Nothing is booked in. A pre-registration taken over the phone lands here.',
    },
  });
}

/** Today's open arrivals first, then the days after, to fill the panel. */
function upcomingArrivals() {
  const open = prereg.today().filter(prereg.isOpen);
  const seen = new Set(open.map((row) => row.no));
  const later = prereg.search('', {}).filter((row) => prereg.isOpen(row) && !seen.has(row.no));
  return [...open, ...later].sort((a, b) =>
    String(a.visit.expectedAt).localeCompare(String(b.visit.expectedAt)));
}

function arrivalRow(row) {
  return `
    ${rowStart(`/frontis/prereg/${row.no}`, `Open ${row.no}`)}
      <td>${arrivalPatient(row)}</td>
      <td>${arrivalHtml(row)}</td>
      <td>${completenessCell(row)}</td>
      <td><a class="btn btn--secondary btn--sm" href="#/frontis/prereg/${esc(row.no)}/convert"
             title="Turn ${esc(row.no)} into a visit">Convert</a></td>
    </tr>`;
}

// --- potential duplicates -----------------------------------------------------

function duplicatesPanel() {
  const rows = duplicates.open();
  return panel({
    title: 'Potential duplicates',
    href: '#/frontis/patients/duplicates',
    total: rows.length,
    headers: ['Patient', 'Looks like', 'Basis', ''],
    body: rows.slice(0, MAX_ROWS).map(duplicateRow).join(''),
    empty: {
      icon: 'join_inner',
      title: 'Registry is clean',
      body: 'No pair is waiting for a decision. A registration that looks like somebody on file lands here.',
    },
  });
}

function duplicateRow(pair) {
  const role = currentRole();
  const name = (mrn) => {
    const patient = patients.view(patients.get(mrn), role);
    return `${esc(patient?.nameEn || mrn)}<br><span class="t-mono-sm">${esc(mrn)}</span>`;
  };
  return `
    ${rowStart(`/frontis/patients/merge?survivor=${pair.mrnA}&duplicate=${pair.mrnB}`,
      `Review ${pair.mrnA} against ${pair.mrnB}`)}
      <td>${name(pair.mrnA)}</td>
      <td>${name(pair.mrnB)}</td>
      <td><span class="badge">${esc(pair.basis)}</span>
        <br><span class="t-body-sm">${esc(relativeTime(pair.detectedAt))}</span></td>
      <td><a class="btn btn--secondary btn--sm"
             href="#/frontis/patients/merge?survivor=${esc(pair.mrnA)}&duplicate=${esc(pair.mrnB)}"
             title="Compare the two records field by field">Review</a></td>
    </tr>`;
}

// --- account flags ------------------------------------------------------------

function flaggedPanel() {
  // The helper may hand back raw rows or the list's own view; either way the
  // panel reads the view, which is where the balances are.
  const rows = accounts.flagged()
    .map((row) => (row.balances ? row : accounts.view(row)))
    .sort((a, b) => b.balances.outstanding - a.balances.outstanding);
  return panel({
    title: 'Account flags',
    href: '#/frontis/accounts',
    total: rows.length,
    headers: ['Patient', 'Flags', 'Outstanding'],
    body: rows.slice(0, MAX_ROWS).map(flaggedRow).join(''),
    empty: {
      icon: 'account_balance_wallet',
      title: 'No accounts need follow-up',
      body: 'Nothing is flagged for collection or review.',
    },
  });
}

function flaggedRow(row) {
  const patient = patients.view(patients.get(row.mrn), currentRole());
  return `
    ${rowStart(`/frontis/accounts/${row.mrn}`, `Open the account for ${row.mrn}`)}
      <td>${esc(patient?.nameEn || row.mrn)}
        <br><span class="t-mono-sm">${esc(row.mrn)}</span></td>
      <td>${flagChipsHtml(row.flags || [])}</td>
      <td class="t-mono-sm">${esc(usd(row.balances.outstanding))}</td>
    </tr>`;
}

// --- shared markup ------------------------------------------------------------

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

/** Two names and a count, each carrying the whole list in its tooltip. */
function chips(items) {
  if (!items.length) return '<span class="t-body-sm">—</span>';
  const shown = items.slice(0, 2)
    .map((text) => `<span class="badge" title="${esc(text)}">${esc(short(text))}</span>`)
    .join(' ');
  const rest = items.length - 2;
  return shown + (rest > 0
    ? ` <span class="badge" title="${esc(items.slice(2).join('; '))}">+${rest}</span>`
    : '');
}

/** A blocking line is a whole sentence; the chip is the name in front of it. */
const short = (text) => {
  const head = String(text).split(/[—(·]/)[0].trim();
  return head.length > 26 ? `${head.slice(0, 25)}…` : head;
};
