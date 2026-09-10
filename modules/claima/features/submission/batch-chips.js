// The chips every submission screen reads a batch or a cycle by: the batch
// status, the mode, the contents, the status timeline over the batch page,
// and the cycle strip a resubmitted claim wears. One file so the workbench
// row, the batch page and the rejections worklist say the same thing the
// same way.

import * as batches from '../../../../data/repositories/batches.js';
import * as claims from '../../../../data/repositories/claims.js';
import * as payers from '../../../../data/repositories/payers.js';
import { date, dateTime, esc, usd } from '../../../../shared/format.js';

export const statusHtml = (batch) => {
  const tone = batches.statusTone(batch.status);
  return `<span class="badge${tone ? ` badge--${tone}` : ''}"><span class="dot"></span>${esc(batch.status)}</span>`;
};

export const modeHtml = (mode) =>
  `<span class="badge${mode === 'Electronic' ? ' badge--info' : ''}" title="${
    mode === 'Electronic' ? 'A submission file and its manifest' : 'Printed claim forms, cover sheets and a batch cover'}">${esc(mode)}</span>`;

export const payerName = (payerId) => payers.get(payerId)?.nameEn || payerId || '—';

/** "4 claims · $1,240.00" — the batch's contents in one cell. */
export function contentsHtml(batch) {
  const n = batch.claimNos.length;
  return `<span class="t-body-sm">${n} claim${n === 1 ? '' : 's'}</span> · <span class="t-mono-sm">${esc(usd(batches.valueOf(batch)))}</span>${
    batch.rejections.length ? ` <span class="badge badge--critical" title="${batch.rejections.length} rejected">${batch.rejections.length} rejected</span>` : ''}${
    batch.ejected.length ? ` <span class="badge badge--warning" title="${esc(batch.ejected.map((e) => `${e.claimNo}: ${e.cause}`).join('\n'))}">${batch.ejected.length} ejected</span>` : ''}`;
}

export const cycleChip = (profile, on) => {
  const due = batches.dueToday(profile.cycle, on);
  return `<span class="badge${due ? ' badge--warning' : ''}" title="${esc(batches.cycleLabel(profile.cycle))}${due ? ' — falls today' : ''}">${
    esc(batches.cycleLabel(profile.cycle))}${due ? ' · due today' : ''}</span>`;
};

/** The dates a row carries: created, submitted, acknowledged. */
export const datesHtml = (batch) => `
  <span class="t-body-sm" title="Created ${esc(dateTime(batch.createdAt))}">${esc(date(batch.createdAt))}</span>
  <br><span class="t-body-sm" title="${batch.submission ? `Submitted ${esc(dateTime(batch.submission.at))}` : 'Not submitted'}">${
  batch.submission ? `sent ${esc(date(batch.submission.at))}` : '—'}</span>
  <br><span class="t-body-sm" title="${batch.acknowledgment ? `Acknowledged ${esc(dateTime(batch.acknowledgment.at))}` : 'Not acknowledged'}">${
  batch.acknowledgment ? `ack ${esc(date(batch.acknowledgment.at))}` : '—'}</span>`;

// --- the status timeline -----------------------------------------------------------------

const STEPS = ['Open', 'Generated', 'Submitted', 'Answered'];

/**
 * Open → Generated → Submitted → Acknowledged / Rejected as the design
 * system's stepper: the order is the meaning, and the last step reads what
 * the payer actually said.
 */
export function timelineHtml(batch) {
  const answered = ['Acknowledged', 'Partially Rejected', 'Rejected', 'Closed'].includes(batch.status);
  const at = answered ? 3 : STEPS.indexOf(batch.status);
  const last = batch.status === 'Closed' ? 'Closed' : answered ? batch.status : 'Acknowledged / Rejected';
  const when = [batch.createdAt, batches.latestGeneration(batch)?.at, batch.submission?.at, batch.acknowledgment?.at || (batch.rejections[0]?.at)];
  return `<div class="stepper" aria-label="Batch status">${STEPS.map((label, i) => {
    const done = i < at || (i === 3 && answered);
    const current = i === at && !(i === 3 && answered);
    const blocked = i === 3 && batch.status === 'Rejected';
    const cls = blocked ? ' stepper__step--blocked' : done ? ' stepper__step--done' : current ? ' stepper__step--current' : '';
    const title = when[i] ? `${label === 'Answered' ? last : label} · ${dateTime(when[i])}` : `${label === 'Answered' ? last : label} — not yet`;
    return `<span class="stepper__step${cls}" title="${esc(title)}" aria-disabled="${!done && !current}">
        <span class="stepper__n">${done ? '<span class="icon icon--sm">check</span>' : blocked ? '!' : i + 1}</span>
        <span class="stepper__label">${esc(label === 'Answered' ? last : label)}</span>
      </span>`;
  }).join('<span class="stepper__line"></span>')}</div>`;
}

// --- the cycle strip ---------------------------------------------------------------------------

/**
 * "Cycle 1 (Rejected R01) → Cycle 2 (Ready)": every cycle the claim has gone
 * round, oldest first, each naming the batch it went out in. One cycle is the
 * ordinary case and says nothing beyond its number.
 */
export function cycleStripHtml(claim, { compact = false } = {}) {
  const chain = claims.cycleChain(claim);
  if (chain.length <= 1 && !claim.rejectedCycle) return compact ? '' : '<span class="t-body-sm">Cycle 1 — first submission</span>';
  const answering = claim.rejectedCycle && claim.rejectedCycle.cycle === claims.cycleOf(claim) ? claim.rejectedCycle : null;
  const parts = chain.map((c) => {
    const said = c.rejection ? `Rejected ${c.rejection.code}` : c.current && answering ? `Rejected ${answering.code} → ${claim.status}` : c.status;
    const tone = c.rejection || (c.current && answering) ? 'critical' : c.current ? claims.statusTone(c.status) : '';
    const title = `Cycle ${c.cycle}${c.batchNo ? ` · ${c.batchNo}` : ''}${c.submittedAt ? ` · sent ${dateTime(c.submittedAt)}` : ''}${
      c.rejection ? ` · ${c.rejection.code} ${batches.rejectionLabel(c.rejection.code)} — ${c.rejection.reason}` : ''}`;
    return `<span class="badge${tone ? ` badge--${tone}` : ''}" title="${esc(title)}">Cycle ${c.cycle} (${esc(said)})</span>`;
  });
  return `<span title="The claim keeps its number; each cycle is one trip to the payer">${parts.join(' <span class="icon icon--sm">arrow_forward</span> ')}</span>`;
}

/** "cycle 2" beside a claim number, or nothing on a first submission. */
export const cycleBadge = (claim) => (claims.cycleOf(claim) > 1
  ? ` <span class="badge badge--accent" title="Resubmission — cycle ${claims.cycleOf(claim)} of this claim">cycle ${claims.cycleOf(claim)}</span>` : '');
