// The chips and cells every remittance screen reads a remittance by: posting
// status, match status, line outcome, the payer, the payment, who captured it.
// One file so the workbench row and the remittance page's banner say the same
// thing the same way.

import * as remittances from '../../../../data/repositories/remittances.js';
import * as payers from '../../../../data/repositories/payers.js';
import { date, dateTime, esc, relativeTime, usd } from '../../../../shared/format.js';

export const statusHtml = (rem) => {
  const tone = remittances.statusTone(rem.status);
  return `<span class="badge badge--${tone}"><span class="dot"></span>${esc(rem.status)}</span>`;
};

export const matchHtml = (m, title = '') =>
  `<span class="badge badge--${remittances.matchTone(m)}"${title ? ` title="${esc(title)}"` : ''}><span class="dot"></span>${esc(m || 'Unmatched')}</span>`;

/** A line's outcome once posted, or what it would be — the grid reads both the same way. */
export function outcomeHtml(outcome, { variance = 0, patientShift = 0 } = {}) {
  if (!outcome) return '<span class="badge">Not posted</span>';
  const title = outcome === 'Underpaid' ? `${usd(variance)} under the expected share`
    : outcome === 'Overpaid' ? `${usd(-variance)} over the expected share`
      : outcome === 'Adjusted' && patientShift ? `${usd(patientShift)} moved to the patient`
        : outcome === 'Denied' ? 'Refused by the payer — a denial record was created' : '';
  return `<span class="badge badge--${remittances.outcomeTone(outcome)}"${title ? ` title="${esc(title)}"` : ''}><span class="dot"></span>${esc(outcome)}</span>`;
}

export const payerName = (payerId) => payers.get(payerId)?.nameEn || payerId || '—';

/** "EFT · NSSF/EFT/2026/07/0091 · 28 Jul 2026" — the payment on one line. */
export const paymentHtml = (rem) =>
  `<span class="t-mono-sm">${esc(rem.payment.reference)}</span><br><span class="t-body-sm">${esc(date(rem.payment.date))} · ${esc(rem.payment.method)}</span>`;

export const capturedHtml = (rem) =>
  `${esc(rem.capture.by)}<br><span class="t-body-sm" title="${esc(dateTime(rem.capture.at))}">${esc(relativeTime(rem.capture.at))} · ${
    rem.capture.mode === 'File' ? esc(rem.capture.fileName || 'file') : 'by hand'}</span>`;

/** "3 matched · 1 ambiguous" — the row's matching in words. */
export function matchSummary(rem) {
  const n = (m) => rem.claims.filter((r) => r.matchStatus === m).length;
  const parts = [`${n('Matched')} matched`];
  if (n('Ambiguous')) parts.push(`${n('Ambiguous')} ambiguous`);
  if (n('Unmatched')) parts.push(`${n('Unmatched')} unmatched`);
  return parts.join(' · ');
}

export const money = (n) => `<span class="t-mono-sm">${esc(usd(n))}</span>`;

/** The exception's kind in words, for a badge. */
export function exceptionKindHtml(kind) {
  const tone = kind === 'Overpayment' ? 'warning' : kind === 'Residue' ? 'info' : 'critical';
  const label = kind === 'AmbiguousMatch' ? 'Ambiguous match' : kind;
  return `<span class="badge badge--${tone}"><span class="dot"></span>${esc(label)}</span>`;
}
