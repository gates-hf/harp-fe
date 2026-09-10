// Engine — who signs a write-off, and in what order. A leaf: it reads the
// config and the static reason list and nothing in data/, so the write-off
// repository can wrap it without a cycle. Pure — no DOM, no writes.
//
// A tier is a ceiling and a role flag (CONFIG.claima.writeoffs.tiers). The
// amount picks the tier; the mode says whether one signature at that tier is
// enough (Single) or every tier below it signs first (Sequential). The one
// rule no mode relaxes is that a requester never signs their own request —
// which is why every check here takes the request's requester beside the
// person signing.

import { CONFIG } from '../../shared/config.js';
import { classificationOf } from '../seed/writeoff-reasons.js';

export const MODES = ['Single', 'Sequential'];

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const tiers = () => CONFIG.claima?.writeoffs?.tiers || [];

export const defaultMode = () => (MODES.includes(CONFIG.claima?.writeoffs?.mode) ? CONFIG.claima.writeoffs.mode : 'Single');

export const autoPostOnApproval = () => Boolean(CONFIG.claima?.writeoffs?.autoPostOnApproval);

/** The tier an amount needs: the first whose ceiling it is under, the open-ended one otherwise. */
export function tierFor(amount) {
  const value = cents(amount);
  const list = tiers();
  const hit = list.find((t) => t.max === null || t.max === undefined || value <= t.max);
  return (hit || list[list.length - 1] || { tier: 1, max: null, role: '' }).tier;
}

export const tierDef = (tier) => tiers().find((t) => t.tier === Number(tier)) || null;

/** "Tier 2 · up to $5,000" — what a step and a chip say about a tier. */
export function tierLabel(tier) {
  const def = tierDef(tier);
  if (!def) return `Tier ${tier}`;
  return def.max === null || def.max === undefined ? `Tier ${def.tier} · unlimited` : `Tier ${def.tier} · up to $${def.max.toLocaleString('en-US')}`;
}

/**
 * The approval ladder an amount needs. Single: one step at the required tier.
 * Sequential: one step per tier from 1 up to it, signed in order. Each step
 * is { tier, approver, decision, note, at } and starts unsigned.
 */
export function stepsFor(amount, mode = defaultMode()) {
  const required = tierFor(amount);
  const list = mode === 'Sequential'
    ? tiers().filter((t) => t.tier <= required).map((t) => t.tier)
    : [required];
  return list.map((tier) => ({ tier, approver: null, decision: null, note: null, at: null }));
}

/** The whole tier block a new request stores. */
export const tierBlock = (amount, mode = defaultMode()) => ({
  required: tierFor(amount),
  mode: MODES.includes(mode) ? mode : defaultMode(),
  steps: stepsFor(amount, mode),
});

/** The step waiting for a signature, or null once the ladder is complete or a step refused. */
export const currentStep = (tier) => (tier?.steps || []).find((s) => !s.decision) || null;

/** Does this role hold the flag a tier asks for? */
export function roleHoldsTier(role, tier) {
  const def = tierDef(tier);
  return Boolean(def && role && role[def.role]);
}

/** The highest tier a role signs at — 0 for a role that signs nothing. */
export const highestTier = (role) => tiers().reduce((n, t) => (role?.[t.role] ? Math.max(n, t.tier) : n), 0);

/**
 * canDecide(request, role) → { ok, why }. The requester never signs, the step
 * has to be the one waiting, and the role has to hold its tier. `role` is a
 * roles.js entry; the requester is matched on the name the request stored.
 */
export function canDecide(request, role) {
  if (!request || request.status !== 'Pending Approval') return { ok: false, why: 'This request is not waiting for a decision' };
  const step = currentStep(request.tier);
  if (!step) return { ok: false, why: 'Every step has been signed' };
  if (!role) return { ok: false, why: 'Sign in to decide' };
  if (role.name === request.requestedBy) return { ok: false, why: 'You raised this request — somebody else has to sign it' };
  if (!roleHoldsTier(role, step.tier)) return { ok: false, why: `${tierLabel(step.tier)} needs a role that signs at that level` };
  return { ok: true, why: '' };
}

/** Reversal needs a signature at least as high as the original approval. */
export function canReverse(request, role) {
  if (!request || request.status !== 'Posted') return { ok: false, why: 'Only a posted write-off can be reversed' };
  if (!role) return { ok: false, why: 'Sign in to reverse' };
  const mine = highestTier(role);
  if (mine < (request.tier?.required || 1)) {
    return { ok: false, why: `Reversing needs ${tierLabel(request.tier?.required || 1)} or higher — your role signs at ${mine ? tierLabel(mine) : 'no tier'}` };
  }
  return { ok: true, why: '' };
}

/**
 * The request as it would stand after one signature: the step is filled, and
 * the ladder is complete when nothing is left unsigned. Returns a fresh tier
 * block and whether the request is now Approved — the repository writes it.
 */
export function decide(tier, { by, approved, note = '', at = new Date().toISOString() }) {
  const steps = (tier?.steps || []).map((s) => ({ ...s }));
  const step = steps.find((s) => !s.decision);
  if (!step) return { tier, complete: true, rejected: false };
  Object.assign(step, { approver: by, decision: approved ? 'Approved' : 'Rejected', note: note || null, at });
  const rejected = !approved;
  const complete = rejected || steps.every((s) => s.decision === 'Approved');
  return { tier: { ...tier, steps }, complete, rejected };
}

/** Whether a reason needs evidence attached before it can be raised. */
export const needsEvidence = (reasonCode) => classificationOf(reasonCode) === 'Discretionary' && reasonCode === 'W04';

export { classificationOf };
