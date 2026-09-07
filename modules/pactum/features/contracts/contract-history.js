// Contract history — every version of the agreement and every change made to
// it, read-only. The audit trail is keyed on the lineage, so one query covers
// all versions.
//
// Two readers use the same markup: the History tab on the contract page, and
// the View history row action, which opens it in the shared drawer beside the
// list. Same shape as the payer and CDM trails, wearing the audit strip.

import * as audit from '../../../../data/repositories/audit.js';
import * as contracts from '../../../../data/repositories/contracts.js';
import * as drawer from '../../../../shared/drawer.js';
import { date, dateTime, esc } from '../../../../shared/format.js';

export const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'corrective', label: 'Corrective edits' },
  { id: 'status', label: 'Status changes' },
];

const STATUS_ACTIONS = ['Activated', 'Terminated', 'Expired', 'Draft deleted'];

/** The two sections, ready to drop into a tab panel or a drawer body. */
export function historyHtml(contract, filter = 'all') {
  if (!contract) return '';
  return versionsHtml(contract) + changesHtml(contract, filter);
}

/** View history — the same trail beside a list rather than on the page. */
export async function openContractHistory(id) {
  const contract = contracts.get(id);
  if (!contract) return undefined;

  const entries = audit.forEntity('contract', contract.lineageId);
  const sheet = drawer.open({
    title: `History — ${esc(contract.contractNo)}`,
    sub: `${esc(contract.name)} · ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} · append-only`,
    icon: 'history',
    body: historyHtml(contract, 'all'),
  });

  // The drawer is a reader: the filter chips work, version rows do not
  // navigate, because the page behind the sheet is the one being read.
  let filter = 'all';
  sheet.el.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter]');
    if (!chip) return;
    filter = chip.dataset.filter;
    sheet.el.querySelector('.drawer__body').innerHTML = historyHtml(contract, filter);
  });

  return sheet.closed;
}

// --- versions ----------------------------------------------------------------

function versionsHtml(contract) {
  const versions = contracts.versionsOf(contract.lineageId);
  return `
    <div class="toolbar">
      <span class="t-title-sm">Versions</span>
      <span class="spacer"></span>
      <span class="t-body-sm">${versions.length} version${versions.length === 1 ? '' : 's'} of ${esc(contract.contractNo)}</span>
    </div>
    <table class="tbl">
      <thead>
        <tr>
          <th class="num">Version</th>
          <th>Status</th>
          <th>Term</th>
          <th>Active from</th>
          <th>Closed</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>
        ${versions.map((v) => versionRow(v, contract)).join('')}
      </tbody>
    </table>`;
}

function versionRow(v, current) {
  const here = v.id === current.id;
  const tone = contracts.statusTone(v.status);
  const closed = v.terminationDate || v.closedAt;
  return `
    <tr data-version="${v.id}" tabindex="0" title="${here ? 'You are reading this version' : `Switch to version ${v.version}`}">
      <td class="num t-mono-sm">v${v.version}${here ? ' <span class="badge badge--accent">reading</span>' : ''}</td>
      <td><span class="badge${tone ? ` badge--${tone}` : ''}"><span class="dot"></span>${v.status}</span></td>
      <td class="t-mono-sm">${date(v.startDate)} – ${date(v.endDate)}</td>
      <td class="t-mono-sm">${date(v.effectiveDate)}</td>
      <td class="t-mono-sm">${closed ? `${date(closed)}${v.terminationDate ? ' (terminated)' : ''}` : '—'}</td>
      <td>${esc(v.createdBy)}<br><span class="t-mono-sm">${dateTime(v.createdAt)}</span></td>
    </tr>`;
}

// --- changes -----------------------------------------------------------------

function changesHtml(contract, filter) {
  const entries = audit.forEntity('contract', contract.lineageId).filter((row) => keep(row, filter));
  return `
    <div class="toolbar">
      <span class="t-title-sm">Changes</span>
      <span class="spacer"></span>
      <div class="segmented" role="group" aria-label="Filter changes">
        ${FILTERS.map((f) => `
          <button data-filter="${f.id}" aria-pressed="${f.id === filter}">${f.label}</button>`).join('')}
      </div>
    </div>
    ${entries.length ? `<ol class="journey">${entries.map(changeRow).join('')}</ol>` : emptyHtml(filter)}`;
}

function keep(row, filter) {
  if (filter === 'corrective') return row.action === 'Corrective edit';
  if (filter === 'status') return STATUS_ACTIONS.includes(row.action);
  return true;
}

// Details are stored as "v2 · one change; another change" — the version reads
// as a chip and a corrective edit's fields as one line each.
function changeRow(entry) {
  const [version, rest = ''] = splitDetails(entry.details);
  const parts = entry.action === 'Corrective edit' ? rest.split('; ') : [rest];
  return `
    <li class="journey__row">
      <span class="journey__at t-mono-sm">${dateTime(entry.at)}</span>
      <span class="journey__action">${esc(entry.action)}</span>
      <span class="journey__actor">${esc(entry.user)}</span>
      <span class="journey__detail">
        ${version ? `<span class="badge">${esc(version)}</span> ` : ''}
        ${parts.filter(Boolean).map((p) => esc(p)).join('<br>')}
      </span>
    </li>`;
}

function splitDetails(details) {
  const match = /^(v\d+) · (.*)$/s.exec(String(details || ''));
  return match ? [match[1], match[2]] : ['', String(details || '')];
}

function emptyHtml(filter) {
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">history</span></div>
      <div class="state-view__title">Nothing recorded yet</div>
      <p class="state-view__body">${filter === 'all'
        ? 'Every edit, activation and termination of this agreement is recorded here, with the user and the time.'
        : 'No entries of this kind. Choose All to see the whole trail.'}</p>
    </div>`;
}
