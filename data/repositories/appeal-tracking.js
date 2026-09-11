// Repository — appeal tracking & resolution. Owner: modules/defensio
// (amendment 39, F4). The appeal case after it has been submitted: the
// payer's response clock, the follow-ups, the Under Review mark, the
// payer's decision captured per denial and per share, each lost share's
// disposition, the expected recoveries the conceded shares become, and the
// close. It writes onto `appealCases` rows additively (amendment 38 owns the
// file and everything up to Submitted — this file adds `tracking`, `outcome`,
// `recoveryState`, `decidedAt`, `closedAt`, `level` and moves `status` from
// Submitted on) and owns `expectedRecoveries` and `escalationRequests`
// through their own files. The rules are data/engines/appeal-resolution.js,
// a leaf; this file resolves the world for them and does the writing. Over
// the file cap on purpose: one entity's lifecycle, one file.
//
// Defensio never posts cash: a conceded share is Recovered only when
// Claima's remittance posting hook (`remittances.afterPostHooks`) reports a
// posting on the appealed claim's lines, matched here to the open expected
// recovery. The ledger every case holds, asserted on load:
//   disputed = recovered + writtenOff + accepted + escalated + openShortfall (+ pendingDisposition)

import { store } from '../store.js';
import * as audit from './audit.js';
import * as appealCases from './appeal-cases.js';
import * as denials from './denials.js';
import * as recoveries from './expected-recoveries.js';
import * as escalations from './escalation-requests.js';
import * as claims from './claims.js';
import * as payers from './payers.js';
import * as writeoffs from './writeoffs.js';
import * as engine from '../engines/appeal-resolution.js';
import { buildAppealTracking, stampSubmittedCase } from '../seed/appeal-tracking.js';
import { current as currentRole } from '../../shared/roles.js';
import { compareDates, iso, todayIso, usd } from '../../shared/format.js';

const ENTITY = 'appealCases';
const { cents } = engine;

export const {
  F4_STATUSES, IN_FLIGHT, DECIDED, OUTCOMES, OUTCOME_LABELS, STATUS_OF_OUTCOME, DISPOSITIONS, DISPOSITION_LABELS,
  RECOVERY_STATES, FOLLOW_UP_METHODS, outcomeLabel, dispositionLabel, recoveryLabel, recoveryStateLabel, outcomeTone,
  recoveryTone, statusTone, isInFlight, isDecided, isTracked, submissionOf, ledgerLine, recoveryAgingDays, responseWarnDays,
} = engine;

// The payer's own record is asked for its response window first (the A36 pattern for the appeal window).
engine.windowResolvers.push((payerId) => payers.get(payerId)?.responseWindowDays || null);
export const responseWindowDays = (payerId) => engine.responseWindowDays(payerId);

// --- reads ------------------------------------------------------------------------------

export const denialIdsOf = (c) => (c?.denialIds?.length ? c.denialIds : [c?.denialId].filter(Boolean));
export const disputedOf = (c) => cents(c?.disputedAmount ?? c?.amount);
export const get = (id) => appealCases.get(id);
export const history = (id) => audit.forEntity(ENTITY, id);
/** Every case this feature reads: submitted, under review or decided. */
export const tracked = () => (ensureSeeded(), appealCases.all().filter(isTracked));
export const inFlight = () => tracked().filter(isInFlight);
export const clockOf = (c, on = todayIso()) => engine.responseClock(c, responseWindowDays(c?.payerId), on);
export const ledgerOf = (c) => engine.ledgerOf(c, recoveries.byCase(c?.id));
export const recoveryStateOf = (c) => engine.recoveryStateOf(c, recoveries.byCase(c?.id));
export const closeBlockers = (c) => engine.closeBlockers(c, recoveries.byCase(c?.id));
export const followUpsOf = (c) => [...(c?.tracking?.followUps || [])];
export const nextDueOf = (c) => followUpsOf(c).map((f) => f.nextDue).filter(Boolean).sort().pop() || null;
export const recoveriesOf = (c) => recoveries.byCase(c?.id);

/** What the case disputes on each of its denials — the whole amount on one, each denial's open share on several. */
export function sharesOf(c) {
  const ids = denialIdsOf(c);
  const disputed = disputedOf(c);
  if (ids.length <= 1) return ids.length ? { [ids[0]]: disputed } : {};
  const out = {};
  let left = disputed;
  ids.forEach((id, i) => {
    const d = denials.get(id);
    const share = i === ids.length - 1 ? left : Math.min(left, cents(d?.amounts?.open ?? d?.amount ?? 0));
    out[id] = cents(share);
    left = cents(left - share);
  });
  return out;
}

/**
 * search(q, { payerId, status, recoveryState, outcome, overdue, from, to })
 * → the tracked cases, response deadline ascending (overdue first), decided
 * ones after the in-flight ones. `q` matches the case, the denial, the claim
 * and the payer's reference.
 */
export function search(q = '', f = {}) {
  const needle = String(q || '').trim().toLowerCase();
  const on = todayIso();
  return tracked()
    .filter((c) => !f.payerId || c.payerId === f.payerId)
    .filter((c) => !f.status || c.status === f.status)
    .filter((c) => !f.outcome || c.outcome?.type === f.outcome)
    .filter((c) => !f.recoveryState || recoveryStateOf(c) === f.recoveryState)
    .filter((c) => !f.overdue || clockOf(c, on).overdue)
    .filter((c) => !f.decidedFrom || (c.decidedAt && compareDates(iso(c.decidedAt), f.decidedFrom) >= 0))
    .filter((c) => !f.from || compareDates(submissionOf(c).submittedAt || c.createdAt, f.from) >= 0)
    .filter((c) => !f.to || compareDates(submissionOf(c).submittedAt || c.createdAt, f.to) <= 0)
    .filter((c) => !needle || [c.id, ...denialIdsOf(c), c.claimNo, submissionOf(c).reference, c.outcome?.payerRef, payers.get(c.payerId)?.nameEn]
      .some((v) => String(v || '').toLowerCase().includes(needle)))
    .sort((a, b) => Number(isInFlight(b)) - Number(isInFlight(a))
      || String(clockOf(a, on).deadline || '9999').localeCompare(String(clockOf(b, on).deadline || '9999'))
      || String(b.decidedAt || '').localeCompare(String(a.decidedAt || '')));
}

/** The header stats the worklist and the home flags read. */
export function counts(on = todayIso()) {
  const rows = tracked();
  const month = `${on.slice(0, 7)}-01`;
  const flight = rows.filter(isInFlight);
  const decidedMtd = rows.filter((c) => c.decidedAt && compareDates(iso(c.decidedAt), month) >= 0);
  const byOutcome = Object.fromEntries(OUTCOMES.map((o) => [o, decidedMtd.filter((c) => c.outcome?.type === o).length]));
  const rc = recoveries.counts(on);
  const recoveredMtd = recoveries.all().filter((r) => r.recoveredAmount > 0 && compareDates(iso(r.updatedAt), month) >= 0);
  const sum = (list, f) => cents(list.reduce((n, r) => n + (Number(f(r)) || 0), 0));
  return {
    inFlight: flight.length, inFlightValue: sum(flight, disputedOf),
    overdue: flight.filter((c) => clockOf(c, on).overdue).length,
    decidedMtd: decidedMtd.length, byOutcome,
    recoveredMtd: { count: recoveredMtd.length, amount: sum(recoveredMtd, (r) => r.recoveredAmount) },
    awaiting: rc.awaiting, awaitingValue: rc.awaitingValue, aging: rc.aging, agingValue: rc.agingValue, shortfalls: rc.shortfalls,
  };
}

// --- published for the peers --------------------------------------------------------------

/** getAppealOutcome(appealCaseId) → { outcome, decidedAt } | null — what amendment 38 reads before offering level 2. */
export function getAppealOutcome(appealCaseId) {
  const c = appealCases.get(appealCaseId);
  return c?.outcome ? { outcome: c.outcome.type, decidedAt: c.decidedAt || c.outcome.decisionDate, status: c.status, recoveryState: recoveryStateOf(c) } : null;
}

/** getLostAppeals() → the cases with a lost share, amendment 37's RCA trigger. */
export function getLostAppeals() {
  return tracked()
    .filter((c) => c.outcome && (c.outcome.type === 'Lost' || c.outcome.type === 'PartiallyWon'))
    .map((c) => ({
      appealCaseId: c.id, denialIds: denialIdsOf(c), outcome: c.outcome.type, decidedAt: c.decidedAt || c.outcome.decisionDate,
      lostAmount: cents(disputedOf(c) - cents(c.outcome.concededTotal)), payerId: c.payerId, claimNo: c.claimNo,
      rootCauseIds: [...new Set(denialIdsOf(c).map((id) => denials.get(id)?.rootCauseId).filter(Boolean))],
    }));
}

/** getF4HomeFlags() → { overdue[], aging[], overdueValue, agingValue, shortfalls } — the future home screen's two chases. */
export function getF4HomeFlags(on = todayIso()) {
  return { ...engine.flagsOf(inFlight(), recoveries.open(), responseWindowDays, on), shortfalls: recoveries.unansweredShortfalls().length };
}

/** For amendment 36's denial page: the appeal's answer on this denial and where its cash stands, or ''. */
export function appealDetailOf(denial) {
  // The case the denial names first; failing that (a level-2 case still in draft has no answer yet) the newest decided case on the denial.
  const ref = denial?.resolution?.kind === 'Appeal' ? denial.resolution.ref : denial?.route?.kind === 'Appeal' ? denial.route.ref : null;
  const named = ref ? appealCases.get(ref) : null;
  const c = named?.outcome ? named : appealCases.byDenial(denial?.id).filter((x) => x.outcome).sort((a, b) => String(b.decidedAt).localeCompare(String(a.decidedAt)))[0] || null;
  if (!c?.outcome) return '';
  const a = engine.normalizeAllocations(c.outcome.allocations).find((x) => x.denialId === denial.id);
  const rec = recoveries.byCase(c.id).find((r) => r.denialId === denial.id);
  const parts = [`${c.id} ${outcomeLabel(c.outcome.type).toLowerCase()} ${c.decidedAt || c.outcome.decisionDate}`];
  if (rec) parts.push(rec.state === 'Recovered' ? `${usd(rec.recoveredAmount)} recovered on ${rec.remittanceRef}`
    : rec.state === 'Shortfall' ? `${usd(rec.recoveredAmount)} of ${usd(rec.concededAmount)} came on ${rec.remittanceRef} — shortfall${rec.shortfall ? ` ${rec.shortfall.how === 'accept' ? 'accepted' : 'in the write-off loop'}` : ''}`
      : `${usd(rec.concededAmount)} awaiting the remittance, ${recoveries.recoveryAge(rec)} d`);
  if (a?.lostShare > 0) parts.push(`${usd(a.lostShare)} lost — ${a.lostDisposition ? dispositionLabel(a.lostDisposition).toLowerCase() : 'disposition pending'}`);
  return parts.join(' · ');
}

// --- writes ----------------------------------------------------------------------------

function tracking(c) {
  if (!c.tracking) c.tracking = { responseDeadline: null, followUps: [], underReview: null };
  if (!c.tracking.followUps) c.tracking.followUps = [];
  return c.tracking;
}

/** setUnderReview(id, { ref, at, by }) → the case or { error }: the payer has acknowledged the appeal and is reading it. */
export function setUnderReview(id, { ref = '', at = null, by = null, commit = true } = {}) {
  const c = appealCases.get(id);
  if (!c) return { error: 'No such case' };
  if (c.status !== 'Submitted') return { error: c.status === 'Under Review' ? 'Already under review' : `A ${String(c.status).toLowerCase()} case is not marked under review` };
  const when = at || new Date().toISOString();
  const t = tracking(c);
  if (!t.responseDeadline) t.responseDeadline = clockOf(c).deadline;
  t.underReview = { ref: String(ref || '').trim() || null, at: when };
  c.status = 'Under Review';
  c.updatedAt = when;
  log(c, 'Under review', `The payer is reviewing the appeal${t.underReview.ref ? ` · ref ${t.underReview.ref}` : ''} · answer due ${t.responseDeadline}`, when, by);
  if (commit) store.commit('appealTracking.status');
  return c;
}

/** logFollowUp(id, { method, contact, note, nextDue }) → the entry or { error }. Append-only on the case. */
export function logFollowUp(id, { method, contact = '', note = '', nextDue = null } = {}, { at = null, by = null, commit = true } = {}) {
  const c = appealCases.get(id);
  if (!c) return { error: 'No such case' };
  if (!isTracked(c)) return { error: 'Only a submitted appeal is followed up' };
  if (!FOLLOW_UP_METHODS.includes(method)) return { error: 'Pick how the payer was contacted' };
  if (!String(note || '').trim()) return { error: 'Say what was said' };
  const when = at || new Date().toISOString();
  const entry = { date: iso(when), at: when, method, contact: String(contact || '').trim(), note: String(note).trim(), nextDue: iso(nextDue) || null, by: by || currentRole().name };
  const t = tracking(c);
  if (!t.responseDeadline && submissionOf(c).submittedAt) t.responseDeadline = clockOf(c).deadline;
  t.followUps.push(entry);
  c.updatedAt = when;
  log(c, 'Follow-up', `${method}${entry.contact ? ` · ${entry.contact}` : ''} — ${entry.note}${entry.nextDue ? ` · next ${entry.nextDue}` : ''}`, when, entry.by);
  if (commit) store.commit('appealTracking.followup');
  return entry;
}

/** The same call on several cases of one payer, one commit. */
export function logFollowUpMany(ids = [], fields = {}) {
  const out = { done: [], problems: [] };
  store.batch(() => {
    for (const id of ids) {
      const r = logFollowUp(id, fields, { commit: false });
      if (r?.error) out.problems.push(`${id}: ${r.error}`); else out.done.push(id);
    }
    if (out.done.length) store.commit('appealTracking.followup');
  });
  return out;
}

/**
 * captureOutcome(id, form, { at, by }) → the case or { error }. The payer's
 * decision: validated by the engine, written on the case, then per
 * allocation — an expected recovery for the conceded share, the denial told
 * (conceded reads as recovered now, a lost share only once it has a
 * disposition, an escalated one stays open for level 2), the claim put back
 * with the payer when money is expected, and the claim's trail told either
 * way. A disposition given on the form is applied here too.
 */
export function captureOutcome(id, form = {}, { at = null, by = null, commit = true } = {}) {
  const c = appealCases.get(id);
  if (!c) return { error: 'No such case' };
  if (!isInFlight(c)) return { error: c.outcome ? 'The decision is already captured' : 'Only a submitted appeal takes a decision' };
  const shares = sharesOf(c);
  const problems = engine.validateOutcome(form, { disputed: disputedOf(c), shares });
  if (problems.length) return { error: problems.join(' ') };
  // One batch: the denial and claim writes below commit on their own, and a screen redrawn on one of those would read the case half-written.
  return store.batch(() => writeOutcome(c, form, { at, by, commit }));
}

function writeOutcome(c, form, { at, by, commit }) {
  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  const allocations = engine.normalizeAllocations(form.allocations).map((a) => ({ ...a, writeoffId: null, escalation: null, dispositionAt: null }));
  c.outcome = {
    type: form.type, decisionDate: iso(form.decisionDate), payerRef: String(form.payerRef || '').trim() || null,
    concededTotal: cents(form.concededTotal), allocations,
    payerRationale: { code: String(form.payerRationale?.code || '').trim() || null, text: String(form.payerRationale?.text || '').trim() },
    documentRef: form.documentRef?.fileName ? { fileName: form.documentRef.fileName, size: form.documentRef.size || 0 } : null,
    capturedAt: when, capturedBy: who,
  };
  c.status = STATUS_OF_OUTCOME[form.type];
  c.decidedAt = c.outcome.decisionDate;
  c.updatedAt = when;
  const t = tracking(c);
  if (!t.responseDeadline && submissionOf(c).submittedAt) t.responseDeadline = clockOf(c).deadline;
  log(c, c.status, `${outcomeLabel(form.type)} — ${usd(c.outcome.concededTotal)} of ${usd(disputedOf(c))} conceded${c.outcome.payerRef ? ` · ${c.outcome.payerRef}` : ''}${
    c.outcome.payerRationale.code ? ` · ${c.outcome.payerRationale.code}` : ''}${c.outcome.payerRationale.text ? ` — ${c.outcome.payerRationale.text}` : ''}`, when, who);

  const claim = claims.get(c.claimId || c.claimNo);
  for (const a of allocations) {
    const d = denials.get(a.denialId);
    if (a.concededShare > 0) {
      recoveries.create({ appealCaseId: c.id, denialId: a.denialId, claimId: claim?.id || c.claimId, claimNo: c.claimNo,
        lineRefs: d?.scope === 'Line' && d.lineId ? [d.lineId] : [], concededAmount: a.concededShare, agingFrom: c.decidedAt }, { at: when, by: who, commit: false });
    }
    const r = denials.applyAppealOutcome(a.denialId, { recovered: a.concededShare, lost: 0, ref: c.id, note: `${outcomeLabel(form.type)}${c.outcome.payerRef ? ` · ${c.outcome.payerRef}` : ''}` }, { at: when, by: who });
    if (r?.error) log(c, 'Note', `${a.denialId}: ${r.error}`, when, who);
    if (a.lostShare > 0 && a.lostDisposition) applyDisposition(c, a, { at: when, by: who });
  }
  if (claim && c.outcome.concededTotal > 0 && ['Denied', 'Appealed', 'Partially Paid'].includes(claim.status)) {
    claims.setStatus(claim.id, 'Acknowledged', { reason: `Appeal ${outcomeLabel(form.type).toLowerCase()}`, details: `${c.id} — ${usd(c.outcome.concededTotal)} conceded, awaiting the remittance` });
    const last = audit.forEntity('claims', claim.id).find((e) => e.action === 'Status');
    if (last && at && last.at > at) { last.at = when; last.user = who; }
  }
  if (claim) {
    audit.all().push({ id: store.nextId('audit', 'AU-'), entity: 'claims', entityId: claim.id, action: 'Appeal outcome',
      details: `${c.id} ${outcomeLabel(form.type).toLowerCase()} — ${usd(c.outcome.concededTotal)} conceded, ${usd(disputedOf(c) - c.outcome.concededTotal)} lost${c.outcome.payerRef ? ` · ${c.outcome.payerRef}` : ''}`, user: who, at: when });
  }
  c.recoveryState = recoveryStateOf(c);
  if (commit) store.commit('appealTracking.outcome');
  return c;
}

/**
 * setDisposition(id, denialId, disposition, { reason }, { at, by }) → the case
 * or { error }. What becomes of a lost share: accepted with a reason (the
 * role the config names), sent to the write-off loop (a claim-residual
 * request through Claima's own creator, linked here), or escalated to a
 * level-2 case (amendment 38's creator when it is on disk, a request for it
 * otherwise). Once per share.
 */
export function setDisposition(id, denialId, disposition, { reason = '' } = {}, { at = null, by = null, commit = true } = {}) {
  const c = appealCases.get(id);
  if (!c?.outcome) return { error: 'Capture the decision first' };
  if (c.status === 'Closed') return { error: 'The case is closed' };
  const a = c.outcome.allocations.find((x) => x.denialId === denialId);
  if (!a || a.lostShare <= 0) return { error: 'Nothing was lost on this denial' };
  if (a.lostDisposition) return { error: `Already ${dispositionLabel(a.lostDisposition).toLowerCase()}` };
  if (!DISPOSITIONS.includes(disposition)) return { error: 'Pick a disposition' };
  if (disposition === 'acceptWithReason') {
    if (!by && !currentRole()[engine.acceptRole()]) return { error: 'Only the RCM coder and the CMO can accept a lost share' };
    if (!String(reason || '').trim()) return { error: 'Say why the lost share is being accepted' };
  }
  a.lostDisposition = disposition;
  a.reason = String(reason || '').trim();
  return store.batch(() => {
    const r = applyDisposition(c, a, { at: at || new Date().toISOString(), by: by || currentRole().name });
    if (r?.error) { a.lostDisposition = null; a.reason = ''; return r; }
    c.updatedAt = a.dispositionAt;
    if (commit) store.commit('appealTracking.disposition');
    return c;
  });
}

function applyDisposition(c, a, { at, by }) {
  const claim = claims.get(c.claimId || c.claimNo);
  const d = denials.get(a.denialId);
  if (a.lostDisposition === 'writeOffLoop') {
    if (!claim) return { error: 'The claim behind the case is gone' };
    const code = d?.reasonCode === 'LATE_FILING' ? 'W02' : d?.reasonCode === 'COV_RULE' ? 'W01' : 'W05';
    const wo = writeoffs.request({
      source: { kind: 'ClaimResidual', ref: claim.claimNo, claimNo: claim.claimNo, mrn: claim.patientMrn || null, encounterNo: claim.encounterNo || null },
      side: 'Payer', amount: a.lostShare, reasonCode: code,
      justification: `Appeal ${c.id} on ${a.denialId} lost ${usd(a.lostShare)}${c.outcome.payerRef ? ` (payer ref ${c.outcome.payerRef})` : ''}${a.reason ? ` — ${a.reason}` : ''}. Raised from the write-off loop on the appeal.`,
    }, { at, by, commit: false });
    if (!wo || wo.error) return { error: wo?.error || 'No write-off request was raised' };
    tagAppealLost(wo, c, [a.denialId]);
    a.writeoffId = wo.id;
  } else if (a.lostDisposition === 'escalate') {
    const data = { denialId: a.denialId, claimNo: c.claimNo, claimId: c.claimId, payerId: c.payerId, amount: a.lostShare,
      reason: `Level-2 appeal of ${c.id}${c.outcome.payerRef ? ` — payer ref ${c.outcome.payerRef}` : ''}`, note: a.reason || c.outcome.payerRationale?.text || '' };
    if (typeof appealCases.createNextLevel === 'function') {
      const next = appealCases.createNextLevel(c.id, data, { at, by, commit: false });
      if (!next || next.error) return { error: next?.error || 'No level-2 case was opened' };
      a.escalation = { kind: 'case', ref: next.id };
    } else {
      const req = escalations.create({ appealCaseId: c.id, ...data }, { at, by, commit: false });
      a.escalation = { kind: 'request', ref: req.id };
    }
  }
  // An escalated share stays open on the denial — level 2 disputes it again; the other two are lost to the denial now.
  if (a.lostDisposition !== 'escalate') {
    const r = denials.applyAppealOutcome(a.denialId, { recovered: 0, lost: a.lostShare, ref: c.id, note: `${dispositionLabel(a.lostDisposition)}${a.reason ? ` — ${a.reason}` : ''}` }, { at, by });
    if (r?.error) log(c, 'Note', `${a.denialId}: ${r.error}`, at, by);
  }
  a.dispositionAt = at;
  log(c, 'Disposition', `${a.denialId} · ${usd(a.lostShare)} lost — ${dispositionLabel(a.lostDisposition)}${a.writeoffId ? ` · ${a.writeoffId}` : ''}${
    a.escalation ? ` · ${a.escalation.ref}` : ''}${a.reason ? ` — ${a.reason}` : ''}`, at, by);
  return c;
}

/**
 * A write-off raised from the appeal loop is a claim-residual request (a
 * denial-sourced one would post against `amounts.open`, which the appeal has
 * settled) — tagged so a recovery-rate or write-off figure downstream can
 * count it with the denial-sourced ones: `origin: 'appealLost'`,
 * `denialIds[]`, `appealCaseId`. Additive fields on A33's row; nothing in
 * its own logic reads them.
 */
function tagAppealLost(wo, c, denialIds) {
  wo.origin = 'appealLost';
  wo.denialIds = [...denialIds];
  wo.appealCaseId = c.id;
}

/** answerShortfall(id, recoveryId, { how, reason }) → the case or { error }: the gap accepted, or a claim-residual write-off raised for it. */
export function answerShortfall(id, recoveryId, { how, reason = '' } = {}, { at = null, by = null, commit = true } = {}) {
  const c = appealCases.get(id);
  const r = recoveries.get(recoveryId);
  if (!c || !r || r.appealCaseId !== c.id) return { error: 'No such shortfall on this case' };
  if (how === 'accept' && !by && !currentRole()[engine.acceptRole()]) return { error: 'Only the RCM coder and the CMO can accept a shortfall' };
  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  let writeoffId = null;
  if (how === 'writeOff') {
    const claim = claims.get(c.claimId || c.claimNo);
    const gap = cents(r.concededAmount - r.recoveredAmount);
    const wo = writeoffs.request({
      source: { kind: 'ClaimResidual', ref: claim?.claimNo || c.claimNo, claimNo: c.claimNo, mrn: claim?.patientMrn || null, encounterNo: claim?.encounterNo || null },
      side: 'Payer', amount: gap, reasonCode: 'W05',
      justification: `Appeal ${c.id} conceded ${usd(r.concededAmount)} on ${r.denialId}; ${usd(r.recoveredAmount)} came on ${r.remittanceRef} — ${usd(gap)} short${reason ? `: ${reason}` : ''}.`,
    }, { at: when, by: who, commit: false });
    if (!wo || wo.error) return { error: wo?.error || 'No write-off request was raised' };
    tagAppealLost(wo, c, [r.denialId]);
    writeoffId = wo.id;
  }
  const done = recoveries.answerShortfall(r.id, { how, reason, writeoffId }, { at: when, by: who, commit: false });
  if (done?.error) return done;
  c.recoveryState = recoveryStateOf(c);
  c.updatedAt = when;
  log(c, 'Shortfall', `${r.id} · ${usd(r.concededAmount - r.recoveredAmount)} ${how === 'accept' ? 'accepted' : `to the write-off loop · ${writeoffId}`}${reason ? ` — ${reason}` : ''}`, when, who);
  if (commit) store.commit('appealTracking.recovery');
  return c;
}

/** closeCase(id, { by }) → the case or { error }: the gate is the engine's blockers and the accepting role. */
export function closeCase(id, { reason = '' } = {}, { at = null, by = null, commit = true } = {}) {
  const c = appealCases.get(id);
  if (!c) return { error: 'No such case' };
  const blockers = closeBlockers(c);
  if (blockers.length) return { error: blockers.join('. ') };
  if (!by && !currentRole()[engine.acceptRole()]) return { error: 'Only the RCM coder and the CMO close an appeal case' };
  const when = at || new Date().toISOString();
  const l = ledgerOf(c);
  c.status = 'Closed';
  c.closedAt = when;
  c.recoveryState = recoveryStateOf(c);
  c.updatedAt = when;
  log(c, 'Closed', `${ledgerLine(l)}${reason ? ` — ${reason}` : ''}`, when, by);
  if (commit) store.commit('appealTracking.status');
  return c;
}

// --- the remittance hook ----------------------------------------------------------------

// data/repositories/expected-recoveries.js subscribes to Claima's posting
// hook and matches each posting to the open recoveries on the claim; the
// case is told here, so its recovery state and trail follow the cash.
recoveries.afterMatchHooks.push(({ caseIds, remittanceNo, reversed, at }) => {
  for (const id of caseIds) {
    const c = appealCases.get(id);
    if (!c) continue;
    c.recoveryState = recoveryStateOf(c);
    c.updatedAt = at || new Date().toISOString();
    log(c, 'Recovery', `${reversed ? 'Posting reversed on' : 'Posted on'} ${remittanceNo} — ${recoveryStateLabel(c.recoveryState).toLowerCase()}`, c.updatedAt);
  }
});

// --- the ledger check ------------------------------------------------------------------

/** selfCheck() → { pass, failures } — every decided case's ledger as a console.assert, one line on the console. */
export function selfCheck() {
  const failures = [];
  for (const c of appealCases.all().filter((x) => x.outcome)) {
    const l = ledgerOf(c);
    console.assert(l.holds, `[defensio] ${c.id}: ${ledgerLine(l)}`);
    if (!l.holds) failures.push(`${c.id}: ${ledgerLine(l)}`);
  }
  const pass = !failures.length;
  const cnt = counts();
  console[pass ? 'info' : 'warn'](`[defensio] appeal ledger self-check ${pass ? 'pass' : 'FAIL'} — ${cnt.inFlight} in flight, ${cnt.decidedMtd} decided this month, ${usd(cnt.awaitingValue)} awaiting remittance`, ...(pass ? [] : [failures]));
  return { pass, failures };
}

// --- seed ---------------------------------------------------------------------------------

let seeded = false;
let stamped = false;
let denialsSettled = false;
let building = false;
/**
 * Runs once the denial register's deferred half has settled (its seed
 * creates the denials mine hang off, and the write-off register seeds
 * behind it), and again after a reset. Amendment 38's Submitted case is
 * stamped whenever it is first seen, since its seed may land after this one.
 */
export function ensureSeeded() {
  if (building || !denialsSettled) return;
  if (!seeded) {
    if (appealCases.all().some((c) => c.seedTag === 'A39')) seeded = true;
    else {
      building = true;
      try {
        writeoffs.all?.();
        store.batch(() => buildAppealTracking(seedApi));
        seeded = true;
      } finally {
        building = false;
      }
    }
  }
  if (!stamped) stamped = stampSubmittedCase(seedApi);
}
let resolveSeedReady;
export const seedReady = new Promise((resolve) => { resolveSeedReady = resolve; });
denials.seedReady.then(() => { denialsSettled = true; ensureSeeded(); resolveSeedReady(); selfCheck(); });
store.subscribe((reason) => {
  if (reason === 'reset') { seeded = false; stamped = false; denialsSettled = false; return; }
  if (reason === 'denials.seed' && !seeded) { denialsSettled = true; queueMicrotask(ensureSeeded); }
});

function log(c, action, details, at = null, by = null) {
  audit.all().push({ id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: c.id, action, details, user: by || currentRole().name, at: at || new Date().toISOString() });
}

const seedApi = {
  today: todayIso(), store, audit, appealCases, denials, claims, payers, writeoffs, recoveries,
  setUnderReview, logFollowUp, captureOutcome, setDisposition, closeCase, clockOf, log,
};
