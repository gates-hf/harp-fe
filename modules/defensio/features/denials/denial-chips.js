// The chips the Defensio denial screens read a denial by: status, separation,
// tier, category, class, the route with its link, the appeal countdown, the
// scope, the repeat mark and the money. One file so the worklist row, the
// page banner and the panels say the same thing the same way. The claim's
// own vocabulary — patient cell, cover label, contract chip, masking — is
// copied here from Claima's claim-chips.js rather than imported: a module
// never reaches into another module's files, and the repositories the
// helpers read are the shared part.

import * as denials from '../../../../data/repositories/denials.js';
import * as payers from '../../../../data/repositories/payers.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as contracts from '../../../../data/repositories/contracts.js';
import { date, esc, usd } from '../../../../shared/format.js';

// --- the claim's vocabulary (copied from modules/claima/features/claims-assembly/claim-chips.js) ---

export function coverLabel(claim) {
  const payer = payers.get(claim.payerId);
  const plan = payer?.plans.find((p) => p.id === claim.planId);
  return `${payer?.nameEn || claim.payerId || '—'}${plan ? ` · ${plan.name}` : ''}`;
}

/** The version stamped on the claim — read off the contract itself for a row assembled before the stamp existed. */
export function contractHtml(claim) {
  const contract = claim.contractId ? contracts.get(claim.contractId) : null;
  const no = claim.contractNo || contract?.contractNo;
  const version = claim.contractVersion ?? contract?.version;
  if (!no) return '<span class="badge badge--critical" title="No agreement covers this plan on the date of service">No contract</span>';
  return `<a class="badge" href="#/pactum/contracts/${esc(claim.contractId)}" title="Open the contract version this claim was priced under">${
    esc(no)} v${esc(version)}</a>`;
}

/** A restricted record reads masked and its cover is withheld — the encounter board's line. */
export const isWithheld = (claim, role) => Boolean(patients.view(patients.get(claim.patientMrn), role)?.masked);

export function patientHtml(claim, role) {
  const patient = patients.view(patients.get(claim.patientMrn), role);
  if (!patient) return `<span class="t-mono-sm">${esc(claim.patientMrn || '—')}</span>`;
  return `<a class="crumb-link" href="#/frontis/patients/${esc(claim.patientMrn)}">${esc(patient.nameEn)}</a>
    <br><span class="t-mono-sm">${esc(claim.patientMrn)}</span>`;
}

export const withheldCell = () =>
  '<span class="badge" title="A restricted record’s cover and money are read by roles with VIP access only">withheld</span>';

// --- the denial's own ---

export function statusHtml(denial) {
  const tone = denials.statusTone(denial.status);
  const title = denial.status === 'Deadline Passed'
    ? `Appeal window closed ${date(denial.deadline?.appealBy)} — ${usd(denial.amounts.open)} still open, nothing written off`
    : denial.status === 'In Progress' ? (denials.progressOf(denial) || 'The work item has moved on')
      : denial.status === 'Reclassified' ? `${denials.separationLabel(denial.separation)} · ${denial.reclassification?.ref || ''} · ${date(denial.resolvedAt)}`
        : denial.resolution ? `${denial.resolution.kind}${denial.resolution.ref ? ` · ${denial.resolution.ref}` : ''} · ${date(denial.resolvedAt)}` : '';
  return `<span class="badge${tone ? ` badge--${tone}` : ''}" title="${esc(title)}"><span class="dot"></span>${esc(denial.status)}</span>`;
}

/** True denial, contractual adjustment or TPA fee — quiet before triage, since nobody has said. */
export function separationHtml(denial) {
  const sep = denial.separation || (denial.class ? 'True' : null);
  if (!sep) return '<span class="t-body-sm" title="Not yet separated — the triage answers it">—</span>';
  const tone = denials.separationTone(sep);
  const title = sep === 'True' ? 'A denial to be worked'
    : sep === 'Contractual' ? `The payer applied the contract as written — ${usd(denial.amounts.reclassified)} reconciled on the claim${denial.reclassification?.ref ? ` (${denial.reclassification.ref})` : ''}`
      : `The administrator's fee withheld from the remittance — ${usd(denial.amounts.reclassified)} accrued${denial.reclassification?.ref ? ` as ${denial.reclassification.ref}` : ''}`;
  return `<span class="badge${tone ? ` badge--${tone}` : ''}" title="${esc(title)}">${esc(denials.separationLabel(sep))}</span>`;
}

export function tierHtml(denial) {
  if (!denial.tier) return '<span class="t-body-sm">—</span>';
  const tone = denials.tierTone(denial.tier);
  const title = denial.tier === 'Hard' ? 'The payer refuses the service itself — only an appeal moves it'
    : denial.tier === 'Soft' ? 'The claim was wrong — a corrected one is paid' : 'Paid, below what the contract says';
  return `<span class="badge${tone ? ` badge--${tone}` : ''}" title="${esc(title)}">${esc(denial.tier)}</span>`;
}

export const categoryHtml = (denial) => (denial.category
  ? `<span class="badge" title="What kind of failure let the denial happen">${esc(denial.category)}</span>` : '<span class="t-body-sm">—</span>');

export function classHtml(denial) {
  if (!denial.class) return '<span class="t-body-sm">—</span>';
  const tone = denials.classTone(denial.class);
  return `<span class="badge${tone ? ` badge--${tone}` : ''}">${esc(denial.class)}</span>`;
}

/** The triage in one cell: tier over class, the category in the tooltip. */
export const triageHtml = (denial) => (denial.tier || denial.class
  ? `<span title="${esc(denial.category || '')}">${tierHtml(denial)}${denial.class ? `<br>${classHtml(denial)}` : ''}</span>`
  : '<span class="t-body-sm">Untriaged</span>');

export const rootCauseHtml = (denial) => (denial.rootCauseId
  ? `<span title="${esc(`${denial.rootCauseId} · ${denials.rootCause(denial.rootCauseId)?.group || ''}`)}">${esc(denials.rootCauseLabel(denial.rootCauseId))}</span>`
  : '<span class="t-body-sm">—</span>');

/** The active route as a chip and the link to its work item; the last ended route in the tooltip. */
export function routeHtml(denial) {
  const r = denial.route;
  if (!r) {
    const last = (denial.routeHistory || [])[denial.routeHistory.length - 1];
    if (last) return `<span class="badge" title="${esc(`${denials.routeLabel(last.kind)} ended ${date(last.endedAt)} — ${last.endedReason}`)}">${esc(denials.routeLabel(last.kind))} · ended</span>`;
    // Resolved without a route of its own — a write-off raised from its side, a remittance that paid it, a separation — the resolution names the record.
    const res = denial.resolution;
    if (res?.ref) return `<span class="badge" title="${esc(`Resolved through ${res.kind} ${res.ref}`)}">${esc(res.kind === 'TPAFee' ? 'TPA fee' : res.kind)}</span> <span class="t-mono-sm">${esc(res.ref)}</span>`;
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
  const under = a.open !== a.denied
    ? `<br><span class="t-body-sm">${a.reclassified && !a.open ? `${esc(usd(a.reclassified))} separated` : `${esc(usd(a.open))} open`}</span>` : '';
  return `${moneyHtml(a.denied, `Denied ${usd(a.denied)} · recovered ${usd(a.recovered)} · written off ${usd(a.writtenOff)} · lost ${usd(a.lost)} · reclassified ${usd(a.reclassified || 0)} · open ${usd(a.open)}`)}${under}`;
}

export const payerName = (denial) => payers.get(denial.payerId)?.nameEn || denial.payerId || '—';

export const reasonHtml = (denial) => `<span title="${esc(denial.payerReason?.text || '')}"><span class="t-mono-sm">${esc(denial.payerReason?.code || denial.code || '—')}</span><br><span class="t-body-sm">${esc(denial.payerReason?.text || denial.reason || '')}</span></span>`;

export function ageHtml(denial) {
  const days = denials.ageDays(denial);
  const tone = denials.isOpen(denial) ? (days > 30 ? 'critical' : days > 14 ? 'warning' : '') : '';
  return `<span class="badge${tone ? ` badge--${tone}` : ''}" title="Landed ${date(denial.createdAt)}">${days} d</span>`;
}

export const assigneeHtml = (denial) => (denial.assignee ? esc(denial.assignee) : '<span class="t-body-sm">Unassigned</span>');
