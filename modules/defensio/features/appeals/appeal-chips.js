// The chips the appeal screens read a case by: status, level, tier, the
// filing countdown, the review state, the ground, the money, the patient
// and the cover. One file so the workbench row, the case banner and the
// denial page's hook chip say the same thing the same way. The claim's own
// vocabulary (patient cell, cover label, masking) is imported from the
// denials feature's chips — one module, one way of naming a claim.

import * as appealCases from '../../../../data/repositories/appeal-cases.js';
import * as payers from '../../../../data/repositories/payers.js';
import { date, esc, usd } from '../../../../shared/format.js';
import { coverLabel, isWithheld, patientHtml, withheldCell } from '../denials/denial-chips.js';

export { coverLabel, isWithheld, patientHtml, withheldCell };

export function statusHtml(row) {
  const tone = appealCases.statusTone(row.status);
  const title = row.status === 'InReview' ? `${appealCases.requiredTierOf(row) === 'senior' ? 'Senior' : 'Standard'} tier · sent ${date(row.review?.requestedAt)} by ${row.review?.requestedBy || ''}`
    : row.status === 'Returned' ? (row.review?.rounds || []).filter((r) => r.action === 'return').pop()?.note || 'Returned by the reviewer'
      : row.status === 'ApprovedToSubmit' ? `Letter locked ${date(row.letter?.finalLockedAt)} — generate the package and file it`
        : row.status === 'Submitted' ? `${row.method || ''} · ref ${row.reference || '—'} · filed ${date(row.submittedAt)}`
          : row.status === 'Withdrawn' ? row.withdrawal?.reason || '' : '';
  return `<span class="badge${tone ? ` badge--${tone}` : ''}" title="${esc(title)}"><span class="dot"></span>${esc(appealCases.statusLabel(row.status))}</span>`;
}

export const levelHtml = (row) => `<span class="badge${row.level > 1 ? ' badge--accent' : ''}" title="${row.level > 1 ? esc(`Second-level appeal after ${row.parentCaseId}`) : 'First-level appeal'}">L${row.level || 1}</span>`;

export function tierHtml(row) {
  const tier = appealCases.requiredTierOf(row);
  return `<span class="badge${tier === 'senior' ? ' badge--warning' : ''}" title="${tier === 'senior'
    ? esc(`Disputed ${usd(row.disputedAmount)} is at or above ${usd(appealCases.seniorAbove())} — the CMO signs`) : 'Below the senior threshold — the RCM coder or the CMO signs'}">${tier === 'senior' ? 'Senior' : 'Standard'}</span>`;
}

/** Days to file: amber inside the warning window, red once passed, quiet once filed. */
export function deadlineHtml(row) {
  const dl = appealCases.deadlineOf(row);
  if (!dl.at) return '<span class="t-body-sm">—</span>';
  if (dl.met) return `<span class="t-body-sm" title="Filed ${date(row.submittedAt)} — the deadline was met">${date(dl.at)} · met</span>`;
  if (row.status === 'Withdrawn') return `<span class="t-body-sm">${date(dl.at)}</span>`;
  const tone = dl.passed ? 'critical' : dl.warn ? 'warning' : '';
  const text = dl.passed ? `Passed ${Math.abs(dl.daysLeft)} d ago` : dl.daysLeft === 0 ? 'Due today' : `${dl.daysLeft} d left`;
  return `<span class="badge${tone ? ` badge--${tone}` : ''}" title="${esc(`File by ${date(dl.at)} — the payer's appeal window on the denial`)}">${esc(text)}</span>`;
}

export function reviewHtml(row) {
  const rounds = row.review?.rounds || [];
  const last = rounds[rounds.length - 1];
  if (row.status === 'InReview') return `<span class="t-body-sm" title="Waiting on a ${appealCases.requiredTierOf(row)} reviewer">Round ${rounds.length + 1} pending</span>`;
  if (!last) return '<span class="t-body-sm">Not yet reviewed</span>';
  return `<span class="badge${last.action === 'approve' ? ' badge--success' : ' badge--warning'}" title="${esc(`${last.reviewerId} · ${date(last.at)}${last.note ? ` — ${last.note}` : ''}`)}">${last.action === 'approve' ? 'Approved' : 'Returned'} · ${esc(last.reviewerId)}</span>`;
}

/** The primary ground; the secondary ones ride in the tooltip so the column stays one line. */
export const groundHtml = (row) => (row.grounds?.primary
  ? `<span title="${esc(`${appealCases.ground(row.grounds.primary)?.summary || ''}${row.grounds.secondary?.length ? ` Also: ${row.grounds.secondary.map(appealCases.groundLabel).join(', ')}.` : ''}`)}">${esc(appealCases.groundLabel(row.grounds.primary))}${
    row.grounds.secondary?.length ? ` <span class="badge">+${row.grounds.secondary.length}</span>` : ''}</span>`
  : '<span class="t-body-sm">No ground yet</span>');

export const moneyHtml = (n, title = '') => `<span class="t-mono-sm"${title ? ` title="${esc(title)}"` : ''}>${esc(usd(n))}</span>`;

export const payerName = (row) => payers.get(row.payerId)?.nameEn || row.payerId || '—';

export const preparerHtml = (row) => `<span title="Prepared the case">${esc(row.createdBy || '—')}</span>`;

/** The chip the denial page wears: the case and its status, or nothing when no case exists. */
export function denialAppealChipHtml(denialId) {
  const c = appealCases.getAppealCaseForDenial(denialId);
  if (!c) return '';
  const tone = appealCases.statusTone(c.status);
  return `<a class="badge${tone ? ` badge--${tone}` : ''}" href="#/defensio/appeals/${esc(c.id)}" title="${esc(`Appeal case ${c.id} · level ${c.level} · ${usd(c.disputedAmount)} disputed · open the case`)}"><span class="icon icon--sm">gavel</span>${esc(c.id)} · ${esc(appealCases.statusLabel(c.status))}</a>`;
}

/** Lateness on a submission: the flag and the reason. */
export const lateHtml = (row) => (row.submission?.lateOverride
  ? ` <span class="badge badge--critical" title="${esc(`Filed ${row.submission.lateOverride.daysLate} day(s) after the deadline by ${row.submission.lateOverride.by} — ${row.submission.lateOverride.reason}`)}">Late</span>` : '');

export const coverHtml = (claim) => (claim ? esc(coverLabel(claim)) : '—');
