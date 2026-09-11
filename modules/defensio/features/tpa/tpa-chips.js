// The chips the TPA screens read an accrual, a dispute and an amendment by:
// state, basis, the version applied, the money with its sign, the
// administrator and the payer. One file so the ledger's rows, the drawer,
// the dispute table and the amendment flow say the same thing the same way.
// The claim's masking is imported from the denials feature's chips — one
// module, one way of withholding a restricted record.

import * as accruals from '../../../../data/repositories/tpa-fee-accruals.js';
import * as disputes from '../../../../data/repositories/tpa-disputes.js';
import * as amendments from '../../../../data/repositories/tpa-amendments.js';
import * as schedules from '../../../../data/repositories/tpa-fee-schedules.js';
import * as claims from '../../../../data/repositories/claims.js';
import { date, esc, usd } from '../../../../shared/format.js';
import { isWithheld, withheldCell } from '../denials/denial-chips.js';

export { isWithheld, withheldCell };

const STATE_TONE = { Matched: 'success', Overcharged: 'critical', Undercharged: 'warning', Unscheduled: 'warning', Disputed: 'info', Settled: 'success', Amended: 'accent', Accrued: '' };
const STATE_TITLE = {
  Matched: 'What the administrator withheld is inside tolerance of what its schedule allows',
  Overcharged: 'The administrator withheld more than the schedule version in force on the remittance date allows',
  Undercharged: 'The administrator withheld less than its schedule allows',
  Unscheduled: 'No schedule version covers the remittance date — add one through an amendment',
  Disputed: 'The overcharge is with the administrator on a dispute',
  Settled: 'The dispute on this accrual is settled — recovered, written off, or accepted',
  Amended: 'A posted amendment restated the period; the figures that stood are snapshotted on the accrual',
};

export const stateTone = (state) => STATE_TONE[state] || '';

export function stateHtml(row) {
  const s = row?.state || 'Accrued';
  const tone = stateTone(s);
  let title = STATE_TITLE[s] || '';
  if (s === 'Disputed' && row.dispute) title = `${row.dispute.id} · ${disputes.statusLabel(row.dispute.status)}`;
  if (s === 'Settled' && row.dispute) title = `${row.dispute.id} · recovered ${usd(row.dispute.recovered)}${row.dispute.writtenOff ? `, ${usd(row.dispute.writtenOff)} written off` : ''}`;
  if (s === 'Amended' && row.amendment) title = `${row.amendment.id} · correction ${usd(row.amendment.correction)} · was ${row.preAmendmentSnapshot?.state || ''}`;
  return `<span class="badge${tone ? ` badge--${tone}` : ''}" title="${esc(title)}"><span class="dot"></span>${esc(s)}</span>`;
}

/** The matching's own answer beside an overlay state — "Amended (Overcharged)" reads both. */
export const matchStateHtml = (row) => (row?.matchState && row.matchState !== row.state
  ? `<span class="badge${stateTone(row.matchState) ? ` badge--${stateTone(row.matchState)}` : ''}" title="${esc(STATE_TITLE[row.matchState] || '')}">${esc(row.matchState)}</span>` : '');

export const moneyHtml = (n, title = '') => `<span class="t-mono-sm"${title ? ` title="${esc(title)}"` : ''}>${esc(usd(n))}</span>`;

/** A variance with its sign: red above tolerance, amber below, quiet inside it. */
export function varianceHtml(row) {
  const v = Number(row?.variance) || 0;
  if (!row?.expected) return `<span class="badge badge--warning" title="No expected fee to compare against">${esc(usd(v))} unscheduled</span>`;
  const over = v > (row.tolerance || 0);
  const under = v < -(row.tolerance || 0);
  const tone = over ? 'critical' : under ? 'warning' : '';
  const text = `${v > 0 ? '+' : ''}${usd(v)}`;
  return `<span class="badge${tone ? ` badge--${tone}` : ''}" title="${esc(`actual − expected; tolerance ±${usd(row.tolerance || 0)}`)}">${esc(text)}</span>`;
}

/** "3% of paid · TFS-0001/v1" — what the expected fee was read from. */
export function expectedHtml(row) {
  const e = row?.expected;
  if (!e) return '<span class="t-body-sm" title="No schedule version in force on the remittance date">—</span>';
  const version = schedules.versionByRef(e.versionRef);
  const rate = schedules.isPct(e.basis) ? `${e.rate}%` : usd(e.rate);
  const scope = e.scope && e.scope !== 'all' ? ` on ${e.scope}` : '';
  const cap = e.capped ? ` · capped per ${e.capped}` : '';
  return `${moneyHtml(e.amount)}<br><span class="t-body-sm" title="${esc(version ? schedules.describe(version) : e.versionRef)}">${esc(rate)} ${esc(schedules.basisLabel(e.basis).toLowerCase())}${esc(scope)}${esc(cap)} · <span class="t-mono-sm">${esc(e.versionRef)}</span>${version?.retrospective ? ' <span class="badge badge--accent" title="A retrospective restatement">restated</span>' : ''}</span>`;
}

/** The remittance the fee came off: its reference when Claima posted one, else the payment date it was read from. */
export function remittanceHtml(row) {
  const ref = row?.remittanceRef;
  const src = row?.basis?.source;
  const note = src === 'remittance' ? 'Read off the posted remittance' : src === 'claim' ? 'No remittance record on file — read off the claim’s payment stamps' : 'Read off the separation itself — nothing was paid';
  return `${ref ? `<a class="crumb-link t-mono-sm" href="#/claima/remittances/${esc(ref)}" title="${esc(note)}">${esc(ref)}</a>` : `<span class="t-body-sm" title="${esc(note)}">no remittance record</span>`}<br><span class="t-body-sm">${esc(date(row?.remittanceDate))}</span>`;
}

/** "paid $302.40" — what the basis read. */
export function basisHtml(row) {
  const b = row?.basis || {};
  const basis = row?.expected?.basis;
  if (basis === 'pctBilled') return `${moneyHtml(b.billed)}<br><span class="t-body-sm">billed</span>`;
  if (basis === 'flatClaim' || basis === 'flatRemit') return `<span class="t-body-sm">flat</span>`;
  return `${moneyHtml(b.paid)}<br><span class="t-body-sm">paid${row?.serviceGroup ? ` · ${esc(row.serviceGroup)}` : ''}</span>`;
}

export function claimHtml(row, role) {
  const claim = claims.get(row?.claimId || row?.claimNo);
  if (claim && isWithheld(claim, role)) return withheldCell();
  return `<a class="crumb-link t-mono-sm" href="#/claima/claims/${esc(row?.claimNo || '')}" title="Open the claim">${esc(row?.claimNo || '—')}</a>`;
}

export const separationsHtml = (row) => (row?.actual?.separationRefs || []).map((id) => `<a class="crumb-link t-mono-sm" href="#/defensio/denials/${esc(id)}" title="Open the denial the fee was separated on">${esc(id)}</a>`).join(', ') || '<span class="t-body-sm">—</span>';

export const linkHtml = (row) => (row?.dispute
  ? `<a class="badge${disputes.statusTone(row.dispute.status) ? ` badge--${disputes.statusTone(row.dispute.status)}` : ''}" href="#/defensio/tpa/disputes?dispute=${esc(row.dispute.id)}" title="${esc(`Dispute ${disputes.statusLabel(row.dispute.status).toLowerCase()}`)}">${esc(row.dispute.id)}</a>`
  : row?.amendment ? `<a class="badge badge--accent" href="#/defensio/tpa/amendments/${esc(row.amendment.id)}" title="${esc(`Restated · correction ${usd(row.amendment.correction)}`)}">${esc(row.amendment.id)}</a>` : '<span class="t-body-sm">—</span>');

// --- disputes ---

export function disputeStatusHtml(d) {
  const tone = disputes.statusTone(d?.status);
  const title = d?.status === 'Acknowledged' ? `${d.acknowledgment?.ref || ''} · ${date(d.acknowledgment?.at)}`
    : d?.status === 'Settled' ? `${usd(d.settlement?.recovered || 0)} recovered${d.settlement?.remainder ? `, ${usd(d.settlement.remainder)} ${d.settlement.how === 'writeOff' ? 'to a write-off request' : 'accepted'}` : ''}`
      : d?.status === 'WrittenOff' ? `${usd(d.totalOvercharge)} to ${d.writeOffRequestRef || 'a write-off request'}` : `Raised ${date(d?.createdAt)} by ${d?.createdBy || ''}`;
  return `<span class="badge${tone ? ` badge--${tone}` : ''}" title="${esc(title)}"><span class="dot"></span>${esc(disputes.statusLabel(d?.status))}</span>`;
}

// --- amendments ---

export function amendmentStatusHtml(a) {
  const tone = amendments.statusTone(a?.status);
  const title = a?.status === 'InReview' ? `${amendments.tierLabel(a.approval?.tier)} · sent ${date(a.approval?.requestedAt)} by ${a.approval?.requestedBy || ''}`
    : a?.status === 'Approved' ? `${a.approval?.approvedBy || ''} · ${date(a.approval?.approvedAt)}`
      : a?.status === 'Posted' ? `${a.postedBy || ''} · ${date(a.postedAt)}` : a?.status === 'Rejected' ? a.approval?.note || '' : 'Not yet sent for review';
  return `<span class="badge${tone ? ` badge--${tone}` : ''}" title="${esc(title)}"><span class="dot"></span>${esc(amendments.statusLabel(a?.status))}</span>`;
}

export const reasonHtml = (a) => `<span title="${esc(a?.reason?.text || '')}">${esc(amendments.reasonLabel(a?.reason?.code))}</span>`;

/** The chip the denial page wears on a TPA separation — the accrual's state, linking to its row on the ledger. */
export function tpaAccrualChipHtml(denialId) {
  const row = accruals.getAccrualForSeparation(denialId);
  if (!row) return '';
  const tone = stateTone(row.state);
  return `<a class="badge${tone ? ` badge--${tone}` : ''}" href="#/defensio/tpa/accruals/${esc(row.id)}" title="${esc(`TPA accrual ${row.id} · ${row.state} · ${usd(row.actual.amount)} withheld${row.expected ? `, ${usd(row.expected.amount)} expected` : ''}`)}">TPA accrual ${esc(row.id)}</a>`;
}
