// Appeal resolution engine (amendment 39, Defensio F4). The rules of an
// appeal case after it has been submitted: the payer's response clock, what
// an outcome may say (the conceded total never above the disputed amount, the
// allocations adding up to it), how each denial's lost share is disposed of,
// what the expected recoveries say the case's cash state is, the ledger the
// case has to balance before it closes, and the flags the home screen reads.
//
// A leaf: it imports nothing from data/ and reads only the rows handed to it,
// which is what lets data/repositories/appeal-tracking.js import it and do
// the writing — the clearance engine's position. The identity every case
// holds, asserted there on load:
//
//   disputed = recovered + writtenOff + accepted + escalated + openShortfall (+ pendingDisposition)
//
// where `pendingDisposition` is a lost share nobody has answered yet — its
// own bucket rather than a shortfall in disguise, and the closure gate is
// that it, and openShortfall, are zero.

import { CONFIG } from '../../shared/config.js';
import { compareDates, iso, todayIso, usd } from '../../shared/format.js';

export const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;
const sum = (rows, f) => cents(rows.reduce((n, r) => n + (Number(f(r)) || 0), 0));
const same = (a, b) => Math.abs(cents(a) - cents(b)) < 0.005;

// --- vocabulary --------------------------------------------------------------------------

/** The statuses this feature owns: everything after Submitted. */
export const F4_STATUSES = ['Under Review', 'Won', 'Partially Won', 'Lost', 'Settled', 'Closed'];
export const IN_FLIGHT = ['Submitted', 'Under Review'];
export const DECIDED = ['Won', 'Partially Won', 'Lost', 'Settled', 'Closed'];
export const OUTCOMES = ['Won', 'PartiallyWon', 'Lost', 'Settled'];
export const OUTCOME_LABELS = { Won: 'Won', PartiallyWon: 'Partially won', Lost: 'Lost', Settled: 'Settled' };
/** The status an outcome puts the case in. */
export const STATUS_OF_OUTCOME = { Won: 'Won', PartiallyWon: 'Partially Won', Lost: 'Lost', Settled: 'Settled' };
export const DISPOSITIONS = ['escalate', 'writeOffLoop', 'acceptWithReason'];
export const DISPOSITION_LABELS = { escalate: 'Escalate to level 2', writeOffLoop: 'Write-off loop', acceptWithReason: 'Accept with reason' };
export const RECOVERY_STATES = ['AwaitingRemittance', 'Recovered', 'Shortfall'];
export const RECOVERY_LABELS = { AwaitingRemittance: 'Awaiting remittance', Recovered: 'Recovered', Shortfall: 'Shortfall' };
export const FOLLOW_UP_METHODS = ['Phone', 'Portal', 'Email', 'Visit'];

export const outcomeLabel = (o) => OUTCOME_LABELS[o] || o || '—';
export const dispositionLabel = (d) => DISPOSITION_LABELS[d] || d || '—';
export const recoveryLabel = (s) => RECOVERY_LABELS[s] || s || '—';
export const outcomeTone = (o) => (o === 'Won' ? 'success' : o === 'PartiallyWon' || o === 'Settled' ? 'info' : o === 'Lost' ? 'critical' : '');
export const recoveryTone = (s) => (s === 'Recovered' ? 'success' : s === 'Shortfall' ? 'critical' : s === 'AwaitingRemittance' ? 'warning' : '');
export function statusTone(status) {
  if (status === 'Won' || status === 'Closed') return 'success';
  if (status === 'Lost') return 'critical';
  if (status === 'Partially Won' || status === 'Settled') return 'info';
  if (status === 'Under Review') return 'accent';
  if (status === 'Submitted') return 'warning';
  return '';
}
export const isInFlight = (c) => IN_FLIGHT.includes(c?.status);
export const isDecided = (c) => DECIDED.includes(c?.status) && Boolean(c?.outcome);
export const isTracked = (c) => isInFlight(c) || isDecided(c);

// --- the response clock ---------------------------------------------------------------

const cfg = () => CONFIG.defensio?.appealTracking || {};
export const RESPONSE_WINDOW_DEFAULT = 30;

/** Resolvers a repository pushes (the payer record first); then config, then the default. */
export const windowResolvers = [];
export function responseWindowDays(payerId) {
  for (const fn of windowResolvers) {
    const n = Number(fn(payerId));
    if (Number.isFinite(n) && n > 0) return n;
  }
  const c = cfg().responseWindowDays || {};
  return Number(c.byPayer?.[payerId]) || Number(c.default) || RESPONSE_WINDOW_DEFAULT;
}
export const responseWarnDays = () => Number(cfg().responseWarnDays) || 5;
export const recoveryAgingDays = () => Number(cfg().recoveryAgingDays) || 45;
export const acceptRole = () => cfg().disposition?.acceptRole || 'canResolveDenial';

export const addDays = (isoDate, n) => {
  const d = new Date(`${iso(isoDate) || todayIso()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const daysBetween = (from, to) => Math.round((Date.parse(iso(to) || todayIso()) - Date.parse(iso(from) || todayIso())) / 86400000);

/** What the case reads as its submission — A38 writes the four fields flat and nested. */
export const submittedAt = (c) => iso(c?.submittedAt || c?.submission?.submittedAt) || null;
export const submissionOf = (c) => ({
  submittedAt: submittedAt(c),
  method: c?.method || c?.submission?.method || null,
  reference: c?.reference || c?.submission?.reference || null,
  packageRef: c?.packageRef || c?.submission?.packageRef || null,
});

/**
 * responseClock(c, windowDays, on) → { deadline, daysLeft, overdue, warn,
 * binding, tone }. The payer's clock: from the submission, responseWindowDays
 * long, stored on `tracking.responseDeadline` when the case was picked up
 * and computed here when it was not. Binding while the case is in flight —
 * a decided case has been answered.
 */
export function responseClock(c, windowDays, on = todayIso()) {
  const from = submittedAt(c);
  const deadline = c?.tracking?.responseDeadline || (from ? addDays(from, windowDays) : null);
  const binding = isInFlight(c) && Boolean(deadline);
  const daysLeft = deadline ? Math.round((Date.parse(deadline) - Date.parse(on)) / 86400000) : null;
  const overdue = binding && compareDates(deadline, on) < 0;
  const warn = binding && !overdue && daysLeft <= responseWarnDays();
  return { deadline, daysLeft, overdue, warn, binding, tone: overdue ? 'critical' : warn ? 'warning' : '' };
}

// --- outcome validation ------------------------------------------------------------------

/**
 * normalizeAllocations(rows) → the allocations as numbers, one per denial:
 * { denialId, concededShare, lostShare, lostDisposition | null, reason }.
 */
export const normalizeAllocations = (rows = []) => rows.map((a) => ({
  denialId: a.denialId,
  concededShare: cents(a.concededShare),
  lostShare: cents(a.lostShare),
  lostDisposition: DISPOSITIONS.includes(a.lostDisposition) ? a.lostDisposition : null,
  reason: String(a.reason || '').trim(),
}));

/**
 * validateOutcome(form, { disputed, shares }) → problems[]. `shares` is
 * denial id → what the case disputes on that denial. An outcome names its
 * type and decision date; the conceded total is at most the disputed amount;
 * every allocation adds up to its denial's share and the allocations to the
 * conceded total; Won concedes everything, Lost nothing, the two partial
 * kinds something of each; a lost share that has been disposed of names the
 * disposition's reason when it is accepted.
 */
export function validateOutcome(form = {}, { disputed = 0, shares = {} } = {}) {
  const problems = [];
  if (!OUTCOMES.includes(form.type)) problems.push('Pick the outcome.');
  if (!iso(form.decisionDate)) problems.push('Enter the decision date.');
  else if (compareDates(form.decisionDate, todayIso()) > 0) problems.push('The decision date is in the future.');
  const conceded = cents(form.concededTotal);
  if (conceded < 0) problems.push('The conceded total cannot be negative.');
  if (conceded > cents(disputed) + 0.005) problems.push(`The conceded total is more than the ${usd(disputed)} disputed.`);
  const rows = normalizeAllocations(form.allocations);
  const ids = Object.keys(shares);
  if (!rows.length) problems.push('Allocate the decision over the case’s denials.');
  for (const id of ids) if (!rows.some((r) => r.denialId === id)) problems.push(`${id} has no allocation.`);
  for (const r of rows) {
    const share = cents(shares[r.denialId]);
    if (!(r.denialId in shares)) { problems.push(`${r.denialId} is not on this case.`); continue; }
    if (r.concededShare < 0 || r.lostShare < 0) problems.push(`${r.denialId}: a share cannot be negative.`);
    if (!same(r.concededShare + r.lostShare, share)) problems.push(`${r.denialId}: ${usd(r.concededShare)} conceded + ${usd(r.lostShare)} lost ≠ ${usd(share)} disputed.`);
    if (r.lostShare > 0 && r.lostDisposition === 'acceptWithReason' && !r.reason) problems.push(`${r.denialId}: say why the lost share is being accepted.`);
  }
  if (rows.length && !same(sum(rows, (r) => r.concededShare), conceded)) problems.push(`The conceded shares add up to ${usd(sum(rows, (r) => r.concededShare))}, not ${usd(conceded)}.`);
  if (form.type === 'Won' && !same(conceded, disputed)) problems.push('A won appeal concedes the whole disputed amount.');
  if (form.type === 'Lost' && conceded > 0.005) problems.push('A lost appeal concedes nothing — record a partial win or a settlement instead.');
  if ((form.type === 'PartiallyWon' || form.type === 'Settled') && (conceded <= 0.005 || same(conceded, disputed))) {
    problems.push(`A ${outcomeLabel(form.type).toLowerCase()} concedes part of the disputed amount — not none of it and not all of it.`);
  }
  if (!String(form.payerRationale?.code || '').trim() && !String(form.payerRationale?.text || '').trim()) problems.push('Record the payer’s rationale — a code or the text of its answer.');
  return problems;
}

// --- the ledger ---------------------------------------------------------------------------

/**
 * ledgerOf(c, recoveries) → { disputed, conceded, lost, recovered, writtenOff,
 * accepted, escalated, openShortfall, pendingDisposition, holds }. Over the
 * case's outcome and its expected recoveries: what came in, what each lost
 * share went to, what is still owed. A case with no outcome holds trivially
 * — everything is still disputed.
 */
export function ledgerOf(c, recoveries = []) {
  const disputed = cents(c?.disputedAmount ?? c?.amount);
  const out = { disputed, conceded: 0, lost: 0, recovered: 0, writtenOff: 0, accepted: 0, escalated: 0, openShortfall: 0, pendingDisposition: 0, holds: true };
  if (!c?.outcome) { out.openShortfall = 0; out.pendingDisposition = disputed; out.holds = true; return out; }
  const allocations = normalizeAllocations(c.outcome.allocations || []);
  out.conceded = cents(c.outcome.concededTotal);
  out.lost = sum(allocations, (a) => a.lostShare);
  for (const a of allocations) {
    if (a.lostShare <= 0) continue;
    if (a.lostDisposition === 'escalate') out.escalated = cents(out.escalated + a.lostShare);
    else if (a.lostDisposition === 'writeOffLoop') out.writtenOff = cents(out.writtenOff + a.lostShare);
    else if (a.lostDisposition === 'acceptWithReason') out.accepted = cents(out.accepted + a.lostShare);
    else out.pendingDisposition = cents(out.pendingDisposition + a.lostShare);
  }
  const mine = recoveries.filter((r) => r.appealCaseId === c.id);
  out.recovered = sum(mine, (r) => r.recoveredAmount);
  // A shortfall the desk has answered — accepted, or sent to the write-off loop — leaves openShortfall for that bucket.
  for (const r of mine) {
    const gap = cents(cents(r.concededAmount) - cents(r.recoveredAmount));
    if (gap <= 0) continue;
    if (r.shortfall?.how === 'accept') out.accepted = cents(out.accepted + gap);
    else if (r.shortfall?.how === 'writeOff') out.writtenOff = cents(out.writtenOff + gap);
    else out.openShortfall = cents(out.openShortfall + gap);
  }
  // Conceded money no expected recovery was ever written for is owed too.
  const expected = sum(mine, (r) => r.concededAmount);
  if (expected < out.conceded - 0.005) out.openShortfall = cents(out.openShortfall + (out.conceded - expected));
  out.holds = same(disputed, out.recovered + out.writtenOff + out.accepted + out.escalated + out.openShortfall + out.pendingDisposition);
  return out;
}

export const ledgerLine = (l) => `${usd(l.disputed)} = ${usd(l.recovered)} recovered + ${usd(l.writtenOff)} written off + ${usd(l.accepted)} accepted + ${usd(l.escalated)} escalated + ${usd(l.openShortfall)} open shortfall${
  l.pendingDisposition ? ` + ${usd(l.pendingDisposition)} awaiting disposition` : ''}`;

/** The state the case's recoveries put it in, or null before an outcome. */
export function recoveryStateOf(c, recoveries = []) {
  if (!c?.outcome) return null;
  if (cents(c.outcome.concededTotal) <= 0) return 'NothingExpected';
  const mine = recoveries.filter((r) => r.appealCaseId === c.id);
  if (mine.some((r) => r.state === 'Shortfall' && !r.shortfall)) return 'Shortfall';
  if (mine.some((r) => r.state === 'AwaitingRemittance')) return 'AwaitingRemittance';
  return 'Recovered';
}
export const recoveryStateLabel = (s) => (s === 'NothingExpected' ? 'Nothing to recover' : recoveryLabel(s));

/**
 * closeBlockers(c, recoveries) → sentences[]. A case closes once it has an
 * outcome, every lost share has a disposition, nothing conceded is still
 * owed (recovered, or the shortfall answered), and the ledger holds.
 */
export function closeBlockers(c, recoveries = []) {
  const out = [];
  if (!c) return ['No such case'];
  if (c.status === 'Closed') return ['Already closed'];
  if (!c.outcome) return ['Capture the payer’s decision first'];
  const l = ledgerOf(c, recoveries);
  if (l.pendingDisposition > 0) out.push(`${usd(l.pendingDisposition)} lost is waiting for a disposition`);
  if (l.openShortfall > 0) out.push(`${usd(l.openShortfall)} conceded is still owed — awaiting the remittance, or a shortfall nobody has answered`);
  if (!l.holds) out.push(`The ledger does not balance: ${ledgerLine(l)}`);
  return out;
}

// --- aging and flags ----------------------------------------------------------------------

/** Whole days a conceded amount has waited: from `agingFrom`, the decision date. */
export const recoveryAge = (r, on = todayIso()) => (r?.state === 'AwaitingRemittance' ? Math.max(0, daysBetween(r.agingFrom, on)) : 0);
export const isAging = (r, on = todayIso()) => recoveryAge(r, on) >= recoveryAgingDays();

/**
 * flagsOf(cases, recoveries, windowOf, on) → { overdue[], aging[], overdueValue,
 * agingValue } — the two things the home screen chases: submitted appeals
 * the payer has not answered inside its window, and conceded money that has
 * waited past recoveryAgingDays. `windowOf(payerId)` is the resolved window.
 */
export function flagsOf(cases = [], recoveries = [], windowOf = responseWindowDays, on = todayIso()) {
  const overdue = cases.filter((c) => responseClock(c, windowOf(c.payerId), on).overdue);
  const aging = recoveries.filter((r) => isAging(r, on));
  return {
    overdue: overdue.map((c) => ({ appealCaseId: c.id, payerId: c.payerId, deadline: responseClock(c, windowOf(c.payerId), on).deadline, amount: cents(c.disputedAmount ?? c.amount) })),
    aging: aging.map((r) => ({ id: r.id, appealCaseId: r.appealCaseId, denialId: r.denialId, claimNo: r.claimNo, amount: cents(r.concededAmount), days: recoveryAge(r, on) })),
    overdueValue: sum(overdue, (c) => c.disputedAmount ?? c.amount),
    agingValue: sum(aging, (r) => r.concededAmount),
  };
}
