// TPA amendment engine (amendment 42, Defensio F7). A leaf: it reads the
// config and the matching engine and nothing in data/, so the amendment
// repository can wrap it without a cycle. Pure — no DOM, no writes.
//
// A fee schedule is append-only: a past period is never edited, it is
// restated. An amendment names a TPA, a payer, a closed period and a reason,
// carries the restated version (marked retrospective, invisible until the
// amendment is posted), and computes its impact by running every accrual in
// the period through the matching engine against that version. The
// correction on each row is what was agreed before the restatement less
// what is agreed after — positive is money the administrator owes back,
// negative money it is owed — and the net over the period is what the
// signature is sized on: the write-off tiers' ceilings and role flags
// (CONFIG.claima.writeoffs.tiers), read here and never imported from
// Claima's code. The requester never signs, whatever tier they hold.

import { CONFIG } from '../../shared/config.js';
import * as matching from './tpa-matching.js';

export const STATUSES = ['Draft', 'InReview', 'Approved', 'Posted', 'Rejected'];
export const OPEN_STATUSES = ['Draft', 'InReview', 'Approved'];

export const REASONS = [
  { code: 'TPA_ERROR', label: 'TPA error', hint: 'The administrator applied or notified the wrong rate and has confirmed the restatement in writing.' },
  { code: 'BACKDATED_RATE', label: 'Backdated rate change', hint: 'A rate renegotiated with retrospective effect — the addendum names the date it runs from.' },
  { code: 'ENTRY_ERROR', label: 'Entry error', hint: 'The schedule was entered wrongly on our side; the agreement itself never changed.' },
  { code: 'OTHER', label: 'Other', hint: 'Say what in the reason text — nothing above fits.' },
];
export const reason = (code) => REASONS.find((r) => r.code === code) || null;
export const reasonLabel = (code) => reason(code)?.label || code || '—';

const { cents } = matching;

/** The write-off tiers, read off the config path CONFIG.defensio.tpa.approvalTiers names. */
export function tiers() {
  const path = String(CONFIG.defensio?.tpa?.approvalTiers || 'claima.writeoffs.tiers').split('.');
  let node = CONFIG;
  for (const key of path) node = node?.[key];
  return Array.isArray(node) ? node : [];
}

/** The tier a net correction needs: the first whose ceiling its size is under, the open-ended one otherwise. */
export function tierFor(amount) {
  const value = Math.abs(cents(amount));
  const list = tiers();
  const hit = list.find((t) => t.max === null || t.max === undefined || value <= t.max);
  return (hit || list[list.length - 1] || { tier: 1, max: null, role: '' }).tier;
}

export const tierDef = (tier) => tiers().find((t) => t.tier === Number(tier)) || null;

export function tierLabel(tier) {
  const def = tierDef(tier);
  if (!def) return `Tier ${tier}`;
  return def.max == null ? `Tier ${def.tier} · unlimited` : `Tier ${def.tier} · up to $${Number(def.max).toLocaleString('en-US')}`;
}

/** canApprove(amendment, role) → { ok, why }: a role at the tier, and never the requester. */
export function canApprove(amendment, role) {
  if (!amendment) return { ok: false, why: 'No amendment' };
  if (amendment.status !== 'InReview') return { ok: false, why: `A ${statusLabel(amendment.status).toLowerCase()} amendment is not waiting for a signature` };
  const def = tierDef(amendment.approval?.tier);
  if (!def) return { ok: false, why: 'No tier is configured for this amount' };
  if (role?.name === amendment.approval?.requestedBy) return { ok: false, why: 'The requester never signs their own amendment' };
  if (!role?.[def.role]) return { ok: false, why: `${tierLabel(def.tier)} needs a role holding ${def.role}` };
  return { ok: true, why: '' };
}

export const statusLabel = (s) => ({ Draft: 'Draft', InReview: 'In review', Approved: 'Approved', Posted: 'Posted', Rejected: 'Rejected' }[s] || s || '—');
export const statusTone = (s) => ({ InReview: 'warning', Approved: 'info', Posted: 'success', Rejected: 'critical' }[s] || '');

/** A period is closed when it ends before today; an amendment restates closed accruals only. */
export function validateHeader(h = {}, today) {
  const problems = [];
  if (!h.tpaId) problems.push('Pick the administrator.');
  if (!h.payerId) problems.push('Pick the payer the schedule is for.');
  if (!h.period?.from || !h.period?.to) problems.push('Give the period a start and an end.');
  else if (h.period.from > h.period.to) problems.push('The period ends before it starts.');
  else if (today && h.period.to >= today) problems.push('An amendment restates a closed period — the end has to be before today.');
  if (!reason(h.reason?.code)) problems.push('Pick a reason.');
  if (h.reason?.code === 'OTHER' && !String(h.reason?.text || '').trim()) problems.push('Say what the reason is.');
  const r = h.restatement || {};
  if (!matching.BASES.includes(r.basis)) problems.push('Pick the restated basis.');
  if (!(Number(r.rate) >= 0)) problems.push('Give the restated rate.');
  return problems;
}

/**
 * impactOf(accruals, version, { basisOf }) → { rows[], totals }. Every
 * accrual handed in is run against the restated version — `basisOf(row)`
 * hands back the matching context the repository already knows (paid,
 * billed, service group, remittance index, period used) — and the row
 * records what moved: old and new expected, old and new state, and the
 * correction (agreed before − agreed after). A row whose correction is zero
 * and whose state does not move is still listed, with nothing to post.
 */
export function impactOf(accruals = [], version, { basisOf = () => ({}) } = {}) {
  const rows = accruals.map((row) => {
    const actual = cents(row.actual?.amount ?? row.amount ?? 0);
    const m = matching.match(actual, version, basisOf(row));
    const oldExpected = row.expected ? cents(row.expected.amount) : null;
    const newExpected = m.expected ? cents(m.expected.amount) : null;
    const oldState = row.matchState || 'Unscheduled';
    // What stood as agreed before: the matched figure, or the whole fee when nothing scheduled it (held, never disputed).
    const agreedOld = row.state === 'Amended' && row.preAmendmentSnapshot
      ? cents(matching.agreedOf(actual, row.expected, oldState))
      : oldState === 'Unscheduled' ? actual : matching.agreedOf(actual, row.expected, oldState);
    const agreedNew = matching.agreedOf(actual, m.expected, m.matchState);
    const correction = cents(agreedOld - agreedNew);
    return {
      accrualId: row.id, claimNo: row.claimNo, remittanceDate: row.remittanceDate, actual,
      oldExpected, newExpected, oldState, newState: m.matchState, oldVersionRef: row.expected?.versionRef || null,
      agreedOld, agreedNew, correction, changed: correction !== 0 || oldState !== m.matchState,
      match: m,
    };
  });
  const totals = {
    accruals: rows.length,
    changed: rows.filter((r) => r.changed).length,
    actual: cents(rows.reduce((n, r) => n + r.actual, 0)),
    oldExpected: cents(rows.reduce((n, r) => n + (r.oldExpected || 0), 0)),
    newExpected: cents(rows.reduce((n, r) => n + (r.newExpected || 0), 0)),
    correction: cents(rows.reduce((n, r) => n + r.correction, 0)),
    reclaim: cents(rows.reduce((n, r) => n + Math.max(0, r.correction), 0)),
    refund: cents(rows.reduce((n, r) => n + Math.max(0, -r.correction), 0)),
  };
  totals.tier = tierFor(totals.correction);
  return { rows, totals };
}
