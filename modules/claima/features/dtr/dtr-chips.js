// The small pieces every DTR screen reads a day, a check or a session by:
// the status badge, the check badge, the money cell, the version chip. One
// file, so the live report, the frozen snapshot and the archive table say a
// thing the same way.

import { dateTime, esc, usd } from '../../../../shared/format.js';

export function dayStatusHtml(status) {
  const tone = status === 'Closed' ? 'success' : status === 'Reopened' ? 'warning' : 'info';
  return `<span class="badge badge--${tone}"><span class="dot"></span>${esc(status)}</span>`;
}

export const checkBadgeHtml = (status) =>
  `<span class="badge badge--${status === 'RED' ? 'critical' : 'success'}"><span class="dot"></span>${status === 'RED' ? 'RED' : 'OK'}</span>`;

export const sessionStatusHtml = (status) =>
  `<span class="badge badge--${status === 'Open' ? 'info' : 'success'}"><span class="dot"></span>${esc(status)}</span>`;

/** A signed amount; nothing reads as a dash. The system tints a badge, not a number, so a minus sign carries the sign. */
export function moneyHtml(n, { zero = '—' } = {}) {
  const v = Number(n) || 0;
  if (!v) return `<span class="t-mono-sm" title="Nothing">${zero}</span>`;
  return `<span class="t-mono-sm">${esc(usd(v))}</span>`;
}

/** A variance: over reads warning, short reads critical, exact reads success. */
export function varianceHtml(v) {
  const n = Number(v) || 0;
  const tone = n === 0 ? 'success' : n < 0 ? 'critical' : 'warning';
  return `<span class="badge badge--${tone}" title="${n === 0 ? 'The count agrees with the system' : n < 0 ? 'Short' : 'Over'}">${n === 0 ? 'Exact' : (n > 0 ? '+' : '−') + usd(Math.abs(n))}</span>`;
}

export function versionChipHtml(dtrNo, { title = '' } = {}) {
  return dtrNo
    ? `<span class="badge badge--accent t-mono-sm"${title ? ` title="${esc(title)}"` : ''}>${esc(dtrNo)}</span>`
    : '<span class="badge" title="A number is assigned when the day is closed">No DTR number yet</span>';
}

/** "Closed 10 Sep 2026 18:30 by Tarek Solh", or the open state. */
export function closedLine(day) {
  if (!day) return '';
  if (day.status === 'Closed') return `Closed ${dateTime(day.closedAt)} by ${esc(day.closedBy)}`;
  if (day.status === 'Reopened') {
    const ev = day.reopenEvents[day.reopenEvents.length - 1];
    return `Reopened ${dateTime(ev?.at)} by ${esc(ev?.by)} — ${esc(ev?.reason || '')}`;
  }
  return `Open since ${dateTime(day.openedAt)}`;
}

/** The count and the money of a section, one line. */
export const sectionTotalLine = (s) => `${esc(s.totalLabel)}: ${usd(s.total)} over ${s.count} transaction${s.count === 1 ? '' : 's'}`;
