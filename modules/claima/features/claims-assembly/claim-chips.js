// The chips and cells every claims-assembly screen reads a claim by: status,
// kind, scrub result, stale, value, age, the cover and the patient. One file so
// the portfolio row and the claim page's banner say the same thing the same way.

import * as claims from '../../../../data/repositories/claims.js';
import * as payers from '../../../../data/repositories/payers.js';
import * as contracts from '../../../../data/repositories/contracts.js';
import * as patients from '../../../../data/repositories/patients.js';
import { date, esc, usd } from '../../../../shared/format.js';

export const statusHtml = (claim) => {
  const tone = claims.statusTone(claim.status);
  return `<span class="badge${tone ? ` badge--${tone}` : ''}"><span class="dot"></span>${esc(claim.status)}</span>`;
};

/** Primary says nothing; a secondary or a supplementary wears its kind. */
export function kindHtml(claim) {
  const kind = claims.kindOf(claim);
  if (kind === 'Primary') return '';
  const title = kind === 'Secondary'
    ? `Secondary claim behind ${claim.parentClaimNo} — activated by the primary’s remittance`
    : `Supplementary to ${claim.parentClaimNo} — late charges that landed after it was finalized`;
  return `<span class="badge badge--info" title="${esc(title)}">${esc(kind)}</span>`;
}

export const staleHtml = (claim) =>
  (claims.isStale(claim)
    ? `<span class="badge badge--warning" title="${esc(claim.stale.reason)}"><span class="dot"></span>Stale</span>`
    : '');

export function scrubHtml(claim) {
  const result = claims.scrubResult(claim);
  const run = claims.latestScrub(claim);
  if (!result) {
    return `<span class="badge" title="${run ? 'The last run was voided by a change to the claim' : 'No scrub has been run on this claim'}">${
      run ? 'Voided' : 'Not run'}</span>`;
  }
  const errors = run.findings.filter((f) => f.severity === 'Error').length;
  const warnings = run.findings.length - errors;
  const left = claims.unacknowledged(claim).length;
  const title = `${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}${
    result === 'Warnings' ? ` — ${left ? `${left} to acknowledge` : 'all acknowledged'}` : ''} · run ${date(run.at)}`;
  return `<span class="badge badge--${claims.scrubTone(result)}" title="${esc(title)}"><span class="dot"></span>${esc(result)}</span>`;
}

export const valueHtml = (claim) =>
  `<span class="t-mono-sm" title="Payer share — gross ${esc(usd(claim.totals?.gross))}, allowed ${esc(usd(claim.totals?.allowedExpected))}">${
    esc(usd(claim.totals?.payerShare))}</span>`;

export function ageHtml(claim) {
  const days = claims.ageDays(claim);
  const tone = days > 30 ? 'critical' : days > 14 ? 'warning' : '';
  return `<span class="badge${tone ? ` badge--${tone}` : ''}" title="Assembled ${date(claim.createdAt)}">${days} d</span>`;
}

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

export const encounterHtml = (claim) =>
  (claim.encounterNo
    ? `<a class="crumb-link t-mono-sm" href="#/frontis/encounters/${esc(claim.encounterNo)}">${esc(claim.encounterNo)}</a>`
    : '<span class="t-body-sm">—</span>');

/** The note on a row the desk no longer owns. */
export const downstreamNote = (claim) =>
  (claims.isEditable(claim) ? '' : `<span class="t-body-sm">Managed in ${
    claims.isPending(claim) ? 'Submission' : 'Remittance'}</span>`);
