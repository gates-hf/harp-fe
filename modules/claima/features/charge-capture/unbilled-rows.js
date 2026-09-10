// The unbilled worklist's rows: one per visit, and the lines under it when
// the row is expanded. Markup only — unbilled-worklist.js owns the state and
// the events, the split the clearance worklist and its kpis file already make.
//
// A restricted record's cover and split are withheld here the way the
// encounter board withholds them: the charge is not the secret, who pays for
// it is.

import * as charges from '../../../../data/repositories/charges.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import * as cdm from '../../../../data/repositories/cdm.js';
import { date, dateTime, esc, relativeTime, usd } from '../../../../shared/format.js';

/** The number of columns the group row spans, for the detail row under it. */
export const COLUMNS = 10;

export function groupHtml(group, { patient, open, role }) {
  const enc = group.encounter;
  const withheld = Boolean(patient?.masked);
  const blocked = releaseEncounterBlocker(group);
  return `
    <tr data-no="${esc(enc.no)}">
      <td>
        <button class="btn btn--ghost btn--icon btn--sm" data-act="expand" aria-expanded="${open}"
                title="${open ? 'Hide the lines' : 'Show the lines'}">
          <span class="icon icon--sm">${open ? 'expand_more' : 'chevron_right'}</span>
        </button>
        <a class="t-mono-sm" href="#/frontis/encounters/${esc(enc.no)}" title="Open the encounter">${esc(enc.no)}</a>
        <br><span class="t-body-sm">${esc(patient?.nameEn || enc.patientMrn)}</span>
        <span class="t-mono-sm">${esc(enc.patientMrn)}</span>
      </td>
      <td><span class="badge${enc.type === 'ER' ? ' badge--critical' : enc.type === 'IP' ? ' badge--accent' : ''}"
                title="${esc(encounters.typeLabel(enc.type))}">${esc(enc.type)}</span></td>
      <td>${esc(enc.department)}</td>
      <td><span class="badge${encounters.statusTone(enc.status) ? ` badge--${encounters.statusTone(enc.status)}` : ''}"
                title="${group.closed ? 'A closed visit: its claim is waiting on these lines' : 'Still open'}">
            <span class="dot"></span>${esc(enc.status)}</span></td>
      <td class="num t-mono-sm" title="${group.held ? `${group.held} on hold` : 'None on hold'}">${group.lines.length}${
        group.held ? ` <span class="t-body-sm">(${group.held} held)</span>` : ''}</td>
      <td class="num t-mono-sm" title="At the charge master’s price; ${esc(usd(group.allowed))} allowed">${usd(group.gross)}</td>
      <td>${withheld
        ? '<span class="badge" title="A restricted record’s cover is read by roles with VIP access only">withheld</span>'
        : `<span title="${esc(encounters.financialTitle(enc))}">${esc(encounters.financialLabel(enc))}</span>`}</td>
      <td>${flagsHtml(group.flags, group.lines)}</td>
      <td><span class="t-body-sm" title="Oldest line captured ${esc(dateTime(group.oldestAt))}">${esc(relativeTime(group.oldestAt))}</span></td>
      <td>
        <button class="btn btn--secondary btn--sm" data-act="release-encounter"${blocked ? ' disabled' : ''}
                title="${esc(blocked || `Release ${group.releasable} clean line${group.releasable === 1 ? '' : 's'} to billing`)}">
          <span class="icon icon--sm">send</span>Release
        </button>
      </td>
    </tr>
    ${open ? `<tr data-detail="${esc(enc.no)}"><td colspan="${COLUMNS}">${linesHtml(group, { withheld, role })}</td></tr>` : ''}`;
}

/** Why the group's Release is off, or ''. */
function releaseEncounterBlocker(group) {
  if (group.releasable > 0) return '';
  if (group.lines.every((line) => line.status === 'Held')) return 'Every line is on hold';
  return 'No line on this visit is clean enough to release';
}

/** The union of a group's flags, each chip carrying the worst line's reason. */
function flagsHtml(flags, lines) {
  if (!flags.length) return '<span class="t-body-sm">—</span>';
  return flags.map((flag) => {
    const line = lines.find((row) => row.flags.includes(flag));
    const tone = charges.flagTone(flag);
    return `<span class="badge${tone ? ` badge--${tone}` : ''}" title="${esc(charges.flagTitle(line, flag))}">${
      esc(charges.FLAG_LABELS[flag] || flag)}</span>`;
  }).join(' ');
}

function linesHtml(group, opts) {
  return `
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">Date of service</th>
          <th scope="col">Charge</th>
          <th scope="col" class="num">Qty</th>
          <th scope="col">Source</th>
          <th scope="col" class="num">Gross</th>
          <th scope="col" class="num">Payer / patient</th>
          <th scope="col">Status</th>
          <th scope="col">Flags</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>${group.lines.map((line) => lineHtml(line, opts)).join('')}</tbody>
    </table>`;
}

export function lineHtml(line, { withheld, role }) {
  const item = cdm.get(line.itemId);
  const p = line.pricing;
  const held = line.status === 'Held';
  const pendingLate = Boolean(line.late && !line.late.window && !line.late.approvedBy);
  const releaseWhy = charges.releaseBlocker(line);
  const unholdWhy = charges.unholdBlocked(line);
  const editable = charges.isUnreleased(line);
  return `
    <tr data-id="${esc(line.id)}">
      <td class="t-mono-sm">${date(line.dateOfService)}</td>
      <td>
        <span class="t-mono-sm">${esc(item?.chargeCode || line.itemId)}</span> ${esc(cdm.label(item) || line.itemId)}
        ${p.overageRows ? `<span class="badge badge--warning" title="${p.overageRows} overage row${p.overageRows === 1 ? '' : 's'} beyond what the package covers">overage</span>` : ''}
        ${line.reversesId ? `<span class="t-body-sm" title="Reposted from ${esc(line.reversesId)}">↺ ${esc(line.reversesId)}</span>` : ''}
      </td>
      <td class="num t-mono-sm">${esc(line.qty)}</td>
      <td>${sourceHtml(line)}</td>
      <td class="num t-mono-sm">${usd(p.gross)}</td>
      <td class="num t-mono-sm" title="${withheld ? 'Withheld on a restricted record' : `${esc(usd(p.allowed))} allowed${p.undecided ? `, ${esc(usd(p.undecided))} pending the payer’s approval` : ''}`}">${
        withheld ? '—' : `${usd(p.payerShare)} / ${usd(p.patientShare)}`}</td>
      <td><span class="badge badge--${charges.statusTone(line.status)}" title="${esc(held ? line.holdReason || '' : line.status)}">
            <span class="dot"></span>${esc(line.status)}</span></td>
      <td>${line.flags.length
        ? line.flags.map((flag) => `<span class="badge${charges.flagTone(flag) ? ` badge--${charges.flagTone(flag)}` : ''}"
              title="${esc(charges.flagTitle(line, flag))}">${esc(charges.FLAG_LABELS[flag] || flag)}</span>`).join(' ')
        : '<span class="t-body-sm">—</span>'}</td>
      <td>
        <button class="btn btn--ghost btn--icon btn--sm" data-act="edit"${editable ? '' : ' disabled'}
                title="${editable ? 'Edit quantity, date or doctor — reversed and reposted' : 'Only an unreleased line can be edited'}">
          <span class="icon icon--sm">edit</span>
        </button>
        <button class="btn btn--ghost btn--icon btn--sm" data-act="replace"${editable ? '' : ' disabled'}
                title="${editable ? 'Replace the charge — reversed and reposted under another item' : 'Only an unreleased line can be replaced'}">
          <span class="icon icon--sm">swap_horiz</span>
        </button>
        ${held
    ? `<button class="btn btn--ghost btn--icon btn--sm" data-act="unhold"${unholdWhy ? ' disabled' : ''}
                title="${esc(unholdWhy || 'Lift the hold')}"><span class="icon icon--sm">lock_open</span></button>`
    : `<button class="btn btn--ghost btn--icon btn--sm" data-act="hold" title="Put on hold with a reason">
                <span class="icon icon--sm">pause_circle</span></button>`}
        ${pendingLate
    ? `<button class="btn btn--ghost btn--icon btn--sm" data-act="approve-late"${role.canLateCharge ? '' : ' disabled'}
                title="${role.canLateCharge ? 'Approve this late charge' : `${esc(role.title)} cannot approve a late charge — the RCM coder or the CMO can`}">
                <span class="icon icon--sm">verified</span></button>`
    : ''}
        <button class="btn btn--ghost btn--icon btn--sm" data-act="release-line"${releaseWhy ? ' disabled' : ''}
                title="${esc(releaseWhy || 'Release this line to billing')}">
          <span class="icon icon--sm">send</span>
        </button>
        <button class="btn btn--ghost btn--icon btn--sm" data-act="cancel" title="Cancel — the ledger rows are reversed">
          <span class="icon icon--sm">delete</span>
        </button>
        <button class="btn btn--ghost btn--icon btn--sm" data-act="history" title="View history">
          <span class="icon icon--sm">history</span>
        </button>
      </td>
    </tr>`;
}

/** The type chip with the reference beside it, or who typed it. */
export function sourceHtml(line) {
  const s = line.source;
  const tone = s.type === 'Manual' ? '' : 'badge--info';
  return `<span class="badge ${tone}" title="${esc(s.type === 'Manual' ? `Entered by ${s.capturedBy}` : `Captured by ${s.capturedBy} from the ${s.type.toLowerCase()} feed`)}">${esc(s.type)}</span>
    <span class="t-mono-sm" title="${esc(s.reason || '')}">${esc(s.ref || s.capturedBy)}</span>`;
}
