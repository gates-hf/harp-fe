// The chips the five lifecycle screens read a claim by: days in a status, the
// kind (cycle, supplementary, secondary), the escalation flag, the silence
// figure and the shape of each event type. One file so a card on the board,
// a row in the follow-up queue and a line on the timeline say the same thing
// the same way. The claim's own vocabulary — status badge, patient cell, cover
// label, value — is the claims-assembly feature's `claim-chips.js`, imported
// rather than copied: one module, one way of naming a claim.

import * as lifecycle from '../../../../data/engines/claim-events.js';
import { date, esc, usd } from '../../../../shared/format.js';

export {
  statusHtml, patientHtml, coverLabel, valueHtml, isWithheld, withheldCell, encounterHtml,
} from '../claims-assembly/claim-chips.js';

/** Days in the current status — amber past 15, red past 30 on an open status, with the since-date in the tooltip. */
export function daysChip(days, since = '', status = '', label = 'in status') {
  const tone = lifecycle.daysTone(days, status);
  return `<span class="badge${tone ? ` badge--${tone}` : ''}" title="${esc(`${days} day${days === 1 ? '' : 's'} ${label}${since ? ` · since ${date(since)}` : ''}`)}">${days} d</span>`;
}

/** "Cycle 2", "Supp", "Secondary" — nothing on a first-cycle primary. */
export function kindChip(claim) {
  const label = lifecycle.kindLabel(claim);
  if (!label) return '';
  const title = label === 'Supp'
    ? `Supplementary to ${claim.parentClaimNo} — charges that landed after it was finalized`
    : label === 'Secondary'
      ? `Secondary claim behind ${claim.parentClaimNo}`
      : `Resubmission of ${claim.previousCycleNo || 'an earlier cycle'}`;
  return `<span class="badge badge--info" title="${esc(title)}">${esc(label)}</span>`;
}

/** The escalation flag: silent past the payer's escalation threshold. */
export function escalatedFlag(annotated) {
  if (!annotated?.escalated) return '';
  const days = lifecycle.thresholdFor(annotated.claim, 'escalationDays');
  // A glyph inside the 20px badge spills out of it (the policy tab learned
  // this), so the flag is the character the amendment writes, not an icon.
  return `<span class="badge badge--critical" title="${esc(`Escalated — silent ${annotated.silent} days, past the ${days}-day threshold`)}">⚑ Escalated</span>`;
}

/** Silent days as a figure with its tone: amber past the silence threshold, red past escalation. */
export function silentChip(annotated) {
  const { claim, silent, escalated, isSilent } = annotated;
  const tone = escalated ? 'critical' : isSilent ? 'warning' : '';
  const last = lifecycle.lastPayerEvent(claim.claimNo, annotated.events);
  const title = last
    ? `Last heard from the payer ${date(last.at)} — ${last.type}`
    : `Nothing from the payer since submission${claim.submittedAt ? ` on ${date(claim.submittedAt)}` : ''}`;
  return `<span class="badge${tone ? ` badge--${tone}` : ''}" title="${esc(title)}">${silent} d</span>`;
}

/** "+3" on a collapsed family card, naming what is folded under it. */
export function familyChip(card) {
  if (!card.family || card.family < 2) return '';
  const f = lifecycle.family(card.claim.claimNo);
  const parts = [];
  if (f && f.cycles.length > 1) parts.push(`${f.cycles.length} cycles`);
  if (f?.supplementary.length) parts.push(`${f.supplementary.length} supplementary`);
  if (f?.secondary.length) parts.push(`${f.secondary.length} secondary`);
  return `<span class="badge badge--accent" title="${esc(`Family of ${card.family}: ${parts.join(', ') || 'linked claims'}`)}">+${card.family - 1}</span>`;
}

/** The glyph and tone of an event type, for the timeline's rows. */
export const EVENT_SHAPE = {
  Assembled: { icon: 'inventory_2', tone: '' },
  Refreshed: { icon: 'sync', tone: '' },
  Scrubbed: { icon: 'fact_check', tone: '' },
  Finalized: { icon: 'lock', tone: 'success' },
  Reopened: { icon: 'lock_open', tone: 'warning' },
  Batched: { icon: 'inbox', tone: 'info' },
  FileGenerated: { icon: 'description', tone: 'info' },
  Submitted: { icon: 'send', tone: 'info' },
  Acknowledged: { icon: 'mark_email_read', tone: 'info' },
  Rejected: { icon: 'block', tone: 'critical' },
  Resubmitted: { icon: 'replay', tone: 'info' },
  RemittancePosted: { icon: 'payments', tone: 'success' },
  Denied: { icon: 'cancel', tone: 'critical' },
  HandedOff: { icon: 'gavel', tone: 'warning' },
  PatientShift: { icon: 'person', tone: 'warning' },
  FollowUp: { icon: 'call', tone: '' },
  Escalated: { icon: 'flag', tone: 'critical' },
  Closed: { icon: 'check_circle', tone: 'success' },
};

/** The tinted badge alone — the icon is drawn beside it, never inside it, where it would spill out. */
export function eventBadge(type) {
  const shape = EVENT_SHAPE[type] || { icon: 'circle', tone: '' };
  return `<span class="badge${shape.tone ? ` badge--${shape.tone}` : ''}">${esc(label(type))}</span>`;
}

export const eventIcon = (type) => `<span class="icon icon--sm" aria-hidden="true">${(EVENT_SHAPE[type] || { icon: 'circle' }).icon}</span>`;

/** "RemittancePosted" reads as "Remittance posted". */
export const label = (type) => String(type).replace(/([a-z])([A-Z])/g, (m, a, b) => `${a} ${b.toLowerCase()}`);

export const money = (n) => `<span class="t-mono-sm">${esc(usd(n))}</span>`;
