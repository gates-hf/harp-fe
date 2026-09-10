// The chips and cells every write-off screen reads a request by: status,
// source, side, classification, tier, amount, patient and requester. One file
// so the worklist row and the decision page's banner say the same thing the
// same way.

import * as writeoffs from '../../../../data/repositories/writeoffs.js';
import * as patients from '../../../../data/repositories/patients.js';
import { date, esc, usd } from '../../../../shared/format.js';

export const statusHtml = (w) => {
  const tone = writeoffs.statusTone(w.status);
  return `<span class="badge${tone && tone !== 'neutral' ? ` badge--${tone}` : ''}"><span class="dot"></span>${esc(w.status)}</span>`;
};

/** Contractual reads plain, Discretionary is tinted — the one a signature is being asked for. */
export const classificationHtml = (classification) =>
  `<span class="badge${classification === 'Discretionary' ? ' badge--warning' : ''}" title="${
    classification === 'Discretionary' ? 'Money the hospital chose to let go' : 'Money the agreement never allowed'}">${esc(classification)}</span>`;

export const sideHtml = (side) =>
  `<span class="badge${side === 'Payer' ? ' badge--info' : ''}" title="${side === 'Payer' ? 'Written off the claim’s open balance' : 'Written off the patient’s account'}">${esc(side)}</span>`;

/** The kind, and the record it points at. */
export function sourceHtml(w) {
  const { kind, ref, claimNo, mrn } = w.source || {};
  const label = writeoffs.SOURCE_LABELS[kind] || kind;
  const href = kind === 'Denial' ? (writeoffs.peerStatus().denials && writeoffs.denialOf(w) ? `#/claima/denials/${ref}` : `#/claima/claims/${claimNo || ref}`)
    : kind === 'PatientBalance' ? `#/frontis/accounts/${mrn || ref}`
      : `#/claima/claims/${claimNo || ref}`;
  return `<span class="badge">${esc(label)}</span> <a class="crumb-link t-mono-sm" href="${esc(href)}" title="Open the ${esc(label.toLowerCase())}">${esc(ref)}</a>`;
}

export function tierHtml(w) {
  const step = writeoffs.currentStep(w);
  const total = (w.tier?.steps || []).length;
  const signed = (w.tier?.steps || []).filter((s) => s.decision === 'Approved').length;
  if (w.status === 'Pending Approval' && step) {
    return `<span class="badge badge--warning" title="${esc(writeoffs.tierLabel(step.tier))}${total > 1 ? ` · step ${signed + 1} of ${total} (${w.tier.mode})` : ''}">Tier ${step.tier}${total > 1 ? ` · ${signed + 1}/${total}` : ''}</span>`;
  }
  return `<span class="badge" title="${esc(writeoffs.tierLabel(w.tier?.required || 1))} · ${esc(w.tier?.mode || 'Single')}">Tier ${w.tier?.required || 1}</span>`;
}

/** Who signed last, or who is being waited on. */
export function approverHtml(w) {
  const steps = w.tier?.steps || [];
  const signed = steps.filter((s) => s.decision);
  const last = signed[signed.length - 1];
  if (w.status === 'Pending Approval') {
    const step = writeoffs.currentStep(w);
    return `<span class="t-body-sm">${last ? `${esc(last.approver)} signed · ` : ''}waiting on ${esc(writeoffs.tierLabel(step?.tier || 1).split(' · ')[0].toLowerCase())}</span>`;
  }
  return last ? `${esc(last.approver)}<br><span class="t-body-sm">${date(last.at)}</span>` : '<span class="t-body-sm">—</span>';
}

export const amountHtml = (w) =>
  `<span class="t-mono-sm" title="${w.amountPosted !== null && w.amountPosted !== undefined ? `Requested ${esc(usd(w.amountRequested))}, posted ${esc(usd(w.amountPosted))}` : `Requested ${esc(usd(w.amountRequested))}`}">${
    esc(usd(w.amountPosted ?? w.amountRequested))}</span>${w.posting?.cappedNote ? ' <span class="badge badge--warning" title="' + esc(w.posting.cappedNote) + '">capped</span>' : ''}`;

/** A restricted record reads masked and its cover and money are withheld — the encounter board's line. */
export const isWithheld = (w, role) => Boolean(patients.view(patients.get(w.source?.mrn), role)?.masked);

export function patientHtml(w, role) {
  const patient = patients.view(patients.get(w.source?.mrn), role);
  if (!patient) return `<span class="t-body-sm">${esc(w.source?.mrn || '—')}</span>`;
  return `<a class="crumb-link" href="#/frontis/patients/${esc(patient.mrn)}">${esc(patient.nameEn)}</a>
    <br><span class="t-mono-sm">${esc(patient.mrn)}</span>`;
}

export const withheldCell = () =>
  '<span class="badge" title="A restricted record’s cover and money are read by roles with VIP access only">withheld</span>';

export const reasonHtml = (w) =>
  `<span title="${esc(writeoffs.reason(w.reasonCode)?.hint || '')}">${esc(w.reasonCode)} ${esc(writeoffs.reasonLabel(w.reasonCode))}</span> ${classificationHtml(w.classification)}`;

/** The chip a peer's row wears when a re-request or an earlier request is linked. */
export const linkHtml = (id, label) =>
  (id ? `<a class="crumb-link t-mono-sm" href="#/claima/writeoffs/${esc(id)}" title="${esc(label)}">${esc(id)}</a>` : '');
