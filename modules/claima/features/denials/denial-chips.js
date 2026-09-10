// The chips the three denial screens read a denial by: status, class, the
// route with its link, the appeal countdown, the scope, the repeat mark and
// the money. One file so the worklist row, the page banner and the analytics
// say the same thing the same way. The claim's own vocabulary — patient
// cell, cover label, masking — is the claims-assembly feature's
// claim-chips.js, imported rather than copied: one module, one way of naming
// a claim (the call the lifecycle feature already made).

import * as denials from '../../../../data/repositories/denials.js';
import * as payers from '../../../../data/repositories/payers.js';
import { date, esc, usd } from '../../../../shared/format.js';

export { patientHtml, isWithheld, withheldCell, coverLabel } from '../claims-assembly/claim-chips.js';

export function statusHtml(denial) {
  const tone = denials.statusTone(denial.status);
  const title = denial.status === 'Deadline Passed'
    ? `Appeal window closed ${date(denial.deadline?.appealBy)} — ${usd(denial.amounts.open)} still open, nothing written off`
    : denial.status === 'In Progress' ? (denials.progressOf(denial) || 'The work item has moved on')
      : denial.resolution ? `${denial.resolution.kind}${denial.resolution.ref ? ` · ${denial.resolution.ref}` : ''} · ${date(denial.resolvedAt)}` : '';
  return `<span class="badge${tone ? ` badge--${tone}` : ''}" title="${esc(title)}"><span class="dot"></span>${esc(denial.status)}</span>`;
}

export function classHtml(denial) {
  if (!denial.class) return '<span class="t-body-sm">—</span>';
  const tone = denials.classTone(denial.class);
  return `<span class="badge${tone ? ` badge--${tone}` : ''}">${esc(denial.class)}</span>`;
}

export const rootCauseHtml = (denial) => (denial.rootCauseId
  ? `<span title="${esc(`${denial.rootCauseId} · ${denials.rootCause(denial.rootCauseId)?.group || ''}`)}">${esc(denials.rootCauseLabel(denial.rootCauseId))}</span>`
  : '<span class="t-body-sm">—</span>');

/** The active route as a chip and the link to its work item; the last ended route in the tooltip. */
export function routeHtml(denial) {
  const r = denial.route;
  if (!r) {
    const last = (denial.routeHistory || [])[denial.routeHistory.length - 1];
    if (last) return `<span class="badge" title="${esc(`${denials.routeLabel(last.kind)} ended ${date(last.endedAt)} — ${last.endedReason}`)}">${esc(denials.routeLabel(last.kind))} · ended</span>`;
    // Resolved without a route of its own — a write-off raised from its side, a remittance that paid it — the resolution names the record.
    const res = denial.resolution;
    if (res?.ref) return `<span class="badge" title="${esc(`Resolved through ${res.kind} ${res.ref}`)}">${esc(res.kind)}</span> <span class="t-mono-sm">${esc(res.ref)}</span>`;
    return '<span class="t-body-sm">Not routed</span>';
  }
  const link = denials.linkOf(denial);
  const icon = denials.ROUTE_ICONS[r.kind] || 'route';
  return `<span class="badge badge--accent" title="${esc(`Routed ${date(r.at)} by ${r.by}${r.reason ? ` — ${r.reason}` : ''}`)}"><span class="icon icon--sm">${icon}</span>${esc(denials.routeLabel(r.kind))}</span>${
    link ? ` <a class="crumb-link t-mono-sm" href="${esc(link.href)}" title="Open the work item">${esc(link.label)}</a>` : ''}`;
}

/** The appeal countdown: days left, amber inside the warning window, red once passed, quiet when the route has met it. */
export function deadlineHtml(denial) {
  const dl = denials.deadline(denial);
  if (!denials.isOpen(denial)) return `<span class="t-body-sm" title="Resolved — the deadline no longer applies">${date(dl.appealBy)}</span>`;
  if (!dl.binding) return `<span class="t-body-sm" title="An active route has met the deadline — the appeal is under way">${date(dl.appealBy)} · met</span>`;
  const tone = denials.deadlineTone(dl);
  const text = dl.passed ? `Passed ${Math.abs(dl.daysLeft)} d ago` : dl.daysLeft === 0 ? 'Due today' : `${dl.daysLeft} d left`;
  return `<span class="badge${tone ? ` badge--${tone}` : ''}" title="${esc(`Appeal by ${date(dl.appealBy)} — ${denials.appealWindowDays(denial.payerId)}-day window`)}">${esc(text)}</span>`;
}

export const scopeHtml = (denial) => `<span class="badge" title="${denial.scope === 'Line' ? `Line ${esc(denial.lineId)} of the claim` : 'The whole claim'}">${esc(denial.scope)}</span>`;

export const repeatHtml = (denial) => (denial.repeatCount >= 2
  ? ` <span class="badge badge--warning" title="${esc(`Denied ${denial.repeatCount} times${denial.previousDenialId ? ` — follows ${denial.previousDenialId}` : ''}`)}">×${denial.repeatCount}</span>` : '');

export const moneyHtml = (n, title = '') => `<span class="t-mono-sm"${title ? ` title="${esc(title)}"` : ''}>${esc(usd(n))}</span>`;

/** Denied, with what is still open under it when the two differ. */
export function amountHtml(denial) {
  const a = denial.amounts;
  const under = a.open !== a.denied ? `<br><span class="t-body-sm">${esc(usd(a.open))} open</span>` : '';
  return `${moneyHtml(a.denied, `Denied ${usd(a.denied)} · recovered ${usd(a.recovered)} · written off ${usd(a.writtenOff)} · lost ${usd(a.lost)} · open ${usd(a.open)}`)}${under}`;
}

export const payerName = (denial) => payers.get(denial.payerId)?.nameEn || denial.payerId || '—';

export const reasonHtml = (denial) => `<span title="${esc(denial.payerReason?.text || '')}"><span class="t-mono-sm">${esc(denial.payerReason?.code || denial.code || '—')}</span><br><span class="t-body-sm">${esc(denial.payerReason?.text || denial.reason || '')}</span></span>`;

export function ageHtml(denial) {
  const days = denials.ageDays(denial);
  const tone = denials.isOpen(denial) ? (days > 30 ? 'critical' : days > 14 ? 'warning' : '') : '';
  return `<span class="badge${tone ? ` badge--${tone}` : ''}" title="Landed ${date(denial.createdAt)}">${days} d</span>`;
}

export const assigneeHtml = (denial) => (denial.assignee ? esc(denial.assignee) : '<span class="t-body-sm">Unassigned</span>');
