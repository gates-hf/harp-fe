// The chips and cells every nullification screen reads a record by: the
// path, the reason, the disposition, the payer notification, the replacement,
// the two actors. One file so the log row, the record page and the claim
// page's Void banner say the same thing the same way. The claim itself is
// named through claims-assembly/claim-chips.js — one module, one way of
// naming a claim.

import * as nullifications from '../../../../data/repositories/nullifications.js';
import * as claims from '../../../../data/repositories/claims.js';
import * as payers from '../../../../data/repositories/payers.js';
import { date, dateTime, esc, usd } from '../../../../shared/format.js';
import { statusHtml } from '../claims-assembly/claim-chips.js';

const PATH_TONE = { Direct: '', PayerNotified: 'info', EndChain: 'warning' };
const PATH_TITLE = {
  Direct: 'Withdrawn before anything went to the payer',
  PayerNotified: 'The payer held the claim and was told it is withdrawn',
  EndChain: 'Rejected and not resubmitted — the chain ends here',
};

export function pathHtml(record) {
  const tone = PATH_TONE[record.path] || '';
  return `<span class="badge${tone ? ` badge--${tone}` : ''}" title="${esc(PATH_TITLE[record.path] || '')}">${
    esc(nullifications.PATH_LABELS[record.path] || record.path || '—')}</span>`;
}

export function reasonHtml(record) {
  const reason = nullifications.nullificationReason(record.reasonCode);
  return `<span class="badge" title="${esc(reason?.description || '')}">${esc(record.reasonCode)}</span> ${
    esc(reason?.label || '')}${record.reasonText ? `<br><span class="t-body-sm">${esc(record.reasonText)}</span>` : ''}`;
}

export function dispositionHtml(record) {
  const d = record.disposition || {};
  const n = (d.lineIds || []).length;
  if (!n && !(record.lines || []).length) {
    return '<span class="t-body-sm" title="A generated claim carries no captured charge lines">No lines</span>';
  }
  const hold = d.kind === 'ReturnAndHold';
  return `<span class="badge${hold ? ' badge--warning' : ''}" title="${esc(hold ? `Held: ${d.reason || ''}` : 'Back to the unbilled pool')}">${
    esc(nullifications.DISPOSITION_LABELS[d.kind] || d.kind || '—')}</span> <span class="t-body-sm">${n} line${n === 1 ? '' : 's'}</span>`;
}

/** ✓ with the method and the reference in the tooltip, or — for a path that told nobody. */
export function notificationHtml(record) {
  const n = record.payerNotification;
  if (!n) return '<span class="t-body-sm" title="Nothing had gone to the payer — no notification was needed">—</span>';
  return `<span class="badge badge--success" title="${esc(`${n.method} · ${n.reference} · ${date(n.date)}${n.note ? ` — ${n.note}` : ''}`)}">✓ ${esc(n.method)}</span>`;
}

/** The replacement claim as a link with its status, or why there is none. */
export function replacementHtml(record) {
  const r = record.replacement;
  if (!r) return '<span class="t-body-sm">—</span>';
  if (!r.claimNo) {
    return `<span class="badge" title="${esc(r.reason || '')}">${esc(r.kind === 'WrongPayerReclass' ? 'Re-classified · no claim' : 'None')}</span>`;
  }
  const claim = claims.get(r.claimNo);
  return `<a class="crumb-link t-mono-sm" href="#/claima/claims/${esc(r.claimNo)}" title="${esc(r.kind === 'WrongPayerReclass' ? 'Assembled fresh against the new cover' : 'Assembled fresh from the visit')}">${
    esc(r.claimNo)}</a>${claim ? ` ${statusHtml(claim)}` : ''}`;
}

export function actorsHtml(record) {
  const a = record.actors || {};
  return `${esc(a.requestedBy || '—')}${a.approvedBy
    ? `<br><span class="t-body-sm" title="Second approver — the claim was worth ${esc(usd(record.valueAtNullification))}, above the threshold">✓ ${esc(a.approvedBy)}</span>`
    : ''}`;
}

export const valueHtml = (record) => `<span class="t-mono-sm">${esc(usd(record.valueAtNullification))}</span>`;

export function statusAtHtml(record) {
  const tone = claims.statusTone(record.statusAtNullification);
  return `<span class="badge${tone ? ` badge--${tone}` : ''}">${esc(record.statusAtNullification || '—')}</span>`;
}

export const atHtml = (record) => `<span class="t-body-sm" title="${esc(record.at)}">${dateTime(record.at)}</span>`;

export function payerName(payerId) {
  return payers.get(payerId)?.nameEn || payerId || '—';
}

/** The record as one line for a banner: number, path, reason, when. */
export const summaryLine = (record) =>
  `${record.no} · ${nullifications.PATH_LABELS[record.path] || record.path} · ${record.reasonCode} ${
    nullifications.nullificationLabel(record.reasonCode)} · ${dateTime(record.at)}`;
