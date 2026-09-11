// Repository — accountability cases (amendment 37, Defensio F2). Owner:
// modules/defensio. When a root-cause case concludes that one person's act
// let a denial happen, this is the record of what happens next — and the
// order it happens in is the rule. The person answers first (or the window
// closes and that is recorded), then somebody who did not analyse the case
// decides — nothing, coaching, a warning, or a recommendation that a
// deduction be made — then the person may appeal to somebody more senior
// than the decider, whose review is a version on the record, and a deduction
// is only ever recommended: it is sent to HR with a reference and HR's
// answer is captured as a note. Nothing here posts to payroll, by design.
//
// Identities are the point of the register and the reason it is gated:
// `canRead(role)` says whether a role sees names; every other screen reads
// "Individual — case N". The role-separation rules are asserted on the save
// paths as well as refused: a decider is never the analyst, a reviewer is
// always senior to the decider. Reads data/seed/staff.js for who is who and
// never reads data/repositories/rca-cases.js — the case arrives as arguments.

import { store } from '../store.js';
import * as audit from './audit.js';
import { current as currentRole } from '../../shared/roles.js';
import { CONFIG } from '../../shared/config.js';
import { staff, staffByName, staffLevel, staffName } from '../seed/staff.js';
import { todayIso } from '../../shared/format.js';

const TABLE = 'accountabilityCases';
const ENTITY = 'accountabilityCases';

export const DECISION_TYPES = ['noAction', 'coaching', 'warning', 'deductionRecommendation'];
export const DECISION_LABELS = { noAction: 'No action', coaching: 'Coaching', warning: 'Warning', deductionRecommendation: 'Deduction recommended' };
export const decisionLabel = (type) => DECISION_LABELS[type] || type || '—';
export const APPEAL_OUTCOMES = ['Upheld', 'Modified', 'Overturned'];
export const DEDUCTION_STAGES = ['Recommended', 'SentToHR', 'OutcomeCaptured'];
export const DEDUCTION_LABELS = { Recommended: 'Recommended', SentToHR: 'Sent to HR', OutcomeCaptured: 'Outcome captured' };
export const STAGES = ['Awaiting response', 'Response recorded', 'No response', 'Decided', 'Under appeal', 'Appeal reviewed', 'Closed'];

const config = () => CONFIG.defensio?.rca || {};
export const windowDays = () => Number(config().responseWindowDays) || 7;

/** Whether a role reads the register with names on it. */
export const canRead = (role = currentRole()) => (config().accountabilityRoles || []).includes(role?.id);

export const all = () => store.table(TABLE);
export const get = (id) => all().find((a) => a.id === id) || null;
export const byCase = (rcaCaseId) => all().filter((a) => a.rcaCaseId === rcaCaseId).sort(byAt);
export const byPerson = (personId) => all().filter((a) => a.personId === personId).sort(byAt);
export const history = (id) => audit.forEntity(ENTITY, id);

/** "Individual — case 3": what a screen outside the authorised roles says. */
export const maskedLabel = (row) => `Individual — case ${Number(String(row?.id || '').replace(/\D/g, '')) || '?'}`;

export const personLabel = (row, role = currentRole()) => (canRead(role) ? staffName(row?.personId) : maskedLabel(row));

/** Where the case stands, read off the record rather than stored. */
export function stageOf(row) {
  if (!row) return '—';
  if (row.closedAt) return 'Closed';
  if (row.appeal?.text) return row.appeal.outcome ? 'Appeal reviewed' : 'Under appeal';
  if (row.decision?.type) return 'Decided';
  if (row.employeeResponse?.respondedAt) return 'Response recorded';
  if (row.employeeResponse?.noResponseRecordedAt) return 'No response';
  return 'Awaiting response';
}

export function stageTone(stage) {
  if (stage === 'Closed') return 'success';
  if (stage === 'Awaiting response' || stage === 'Under appeal') return 'warning';
  if (stage === 'No response') return 'critical';
  if (stage === 'Decided' || stage === 'Appeal reviewed') return 'info';
  return '';
}

export const isOpen = (row) => Boolean(row) && !row.closedAt;

/** The response window: when it closes and whether it has. */
export function windowOf(row, on = todayIso()) {
  const opened = String(row?.openedAt || '').slice(0, 10);
  const days = Number(row?.employeeResponse?.windowDays) || windowDays();
  const closes = daysAfter(opened, days);
  const daysLeft = Math.round((Date.parse(closes) - Date.parse(on)) / 86400000);
  return { closes, daysLeft, passed: daysLeft < 0, answered: Boolean(row?.employeeResponse?.respondedAt || row?.employeeResponse?.noResponseRecordedAt) };
}

export function search(q = '', { stage = '', decision = '', personId = '', rcaCaseId = '', deduction = '' } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  return all()
    .filter((a) => {
      if (stage && stageOf(a) !== stage) return false;
      if (decision && a.decision?.type !== decision) return false;
      if (personId && a.personId !== personId) return false;
      if (rcaCaseId && a.rcaCaseId !== rcaCaseId) return false;
      if (deduction && a.deductionTracking?.status !== deduction) return false;
      if (!needle) return true;
      return [a.id, a.rcaCaseId, staffName(a.personId), a.roleInFailure, a.decision?.type && decisionLabel(a.decision.type)]
        .some((v) => String(v || '').toLowerCase().includes(needle));
    })
    .sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || byAt(b, a));
}

export function counts(on = todayIso()) {
  const rows = all();
  const open = rows.filter(isOpen);
  return {
    total: rows.length,
    open: open.length,
    awaiting: open.filter((a) => stageOf(a) === 'Awaiting response').length,
    windowPassed: open.filter((a) => stageOf(a) === 'Awaiting response' && windowOf(a, on).passed).length,
    toDecide: open.filter((a) => ['Response recorded', 'No response'].includes(stageOf(a))).length,
    underAppeal: open.filter((a) => stageOf(a) === 'Under appeal').length,
    deductions: rows.filter((a) => a.deductionTracking && a.deductionTracking.status !== 'OutcomeCaptured').length,
  };
}

// --- writes -----------------------------------------------------------------------------------

/**
 * open({ rcaCaseId, personId, roleInFailure, analystId, evidenceRefs }) →
 * the row. One open case per person per root-cause case: a second call hands
 * the first back. The window starts now.
 */
export function open(data = {}, { at = null, by = null, commit = true } = {}) {
  const existing = byCase(data.rcaCaseId).find((a) => a.personId === data.personId && isOpen(a));
  if (existing) return existing;
  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  const row = {
    id: store.nextId(TABLE, 'ACC-'),
    rcaCaseId: data.rcaCaseId,
    personId: data.personId,
    roleInFailure: String(data.roleInFailure || '').trim(),
    analystId: data.analystId || null,
    evidenceRefs: [...(data.evidenceRefs || [])],
    employeeResponse: { text: '', attachments: [], respondedAt: null, noResponseRecordedAt: null, windowDays: windowDays() },
    decision: null,
    appeal: null,
    deductionTracking: null,
    openedAt: when,
    openedBy: who,
    closedAt: null,
    closedBy: null,
    updatedAt: when,
  };
  all().push(row);
  log(row, 'Opened', `${staffName(row.personId)} · ${row.roleInFailure} · from ${row.rcaCaseId} · ${row.employeeResponse.windowDays}-day response window`, when, who);
  if (commit) store.commit('accountabilityCases.open');
  return row;
}

/** The person's answer, recorded as received. */
export function recordResponse(id, { text = '', attachments = [] } = {}, { at = null, by = null } = {}) {
  const row = get(id);
  if (!row) return { error: 'No such case' };
  if (!isOpen(row)) return { error: 'The case is closed' };
  if (row.decision?.type) return { error: 'A decision has been recorded — the response came first' };
  const said = String(text || '').trim();
  if (!said) return { error: 'Record what the person said' };
  const when = at || new Date().toISOString();
  row.employeeResponse = {
    ...row.employeeResponse, text: said, attachments: (attachments || []).map((f, i) => ({ id: `${row.id}-R${i + 1}`, ...f })),
    respondedAt: when, noResponseRecordedAt: null,
  };
  touch(row, when);
  log(row, 'Response recorded', `${said.slice(0, 160)}${said.length > 160 ? '…' : ''}${attachments?.length ? ` · ${attachments.length} attachment${attachments.length === 1 ? '' : 's'}` : ''}`, when, by);
  store.commit('accountabilityCases.response');
  return row;
}

/** The window closed with nothing said — recorded, so a decision can follow. */
export function recordNoResponse(id, { at = null, by = null } = {}) {
  const row = get(id);
  if (!row) return { error: 'No such case' };
  if (!isOpen(row)) return { error: 'The case is closed' };
  if (row.employeeResponse?.respondedAt) return { error: 'A response is on file' };
  const w = windowOf(row, String(at || todayIso()).slice(0, 10));
  if (!w.passed) return { error: `The response window is open until ${w.closes} — ${w.daysLeft} day${w.daysLeft === 1 ? '' : 's'} left` };
  const when = at || new Date().toISOString();
  row.employeeResponse = { ...row.employeeResponse, noResponseRecordedAt: when };
  touch(row, when);
  log(row, 'No response', `Window closed ${w.closes} with nothing received`, when, by);
  store.commit('accountabilityCases.noResponse');
  return row;
}

/** What blocks a decision now — the sentence, or '' when one can be recorded. */
export function decideBlocker(row, decider = currentRole().name) {
  if (!row) return 'No such case';
  if (!isOpen(row)) return 'The case is closed';
  if (row.decision?.type) return 'A decision is on file — an appeal is the way to change it';
  if (!row.employeeResponse?.respondedAt && !row.employeeResponse?.noResponseRecordedAt) {
    const w = windowOf(row);
    return w.passed ? 'Record that no response was received before deciding' : `The person has until ${w.closes} to respond`;
  }
  if (isSamePerson(decider, row.analystId)) return 'You analysed this case — somebody else decides';
  return '';
}

/**
 * decide(id, { type, rationale, deduction: { amount, basis } }) → the row or
 * { error }. Response before decision; the decider is never the analyst.
 */
export function decide(id, { type, rationale = '', deduction = null } = {}, { at = null, by = null } = {}) {
  const row = get(id);
  const who = by || currentRole().name;
  const blocker = decideBlocker(row, who);
  if (blocker) return { error: blocker };
  if (!DECISION_TYPES.includes(type)) return { error: 'Pick a decision' };
  const why = String(rationale || '').trim();
  if (!why) return { error: 'Give the rationale' };
  let ded = null;
  if (type === 'deductionRecommendation') {
    const amount = Math.round((Number(deduction?.amount) || 0) * 100) / 100;
    const basis = String(deduction?.basis || '').trim();
    if (amount <= 0) return { error: 'A deduction recommendation names an amount' };
    if (!basis) return { error: 'A deduction recommendation states its basis' };
    ded = { amount, basis };
  }
  console.assert(!isSamePerson(who, row.analystId), '[accountability] decider must not be the analyst', row.id);
  const when = at || new Date().toISOString();
  row.decision = { type, rationale: why, deduction: ded, decidedBy: who, decidedAt: when };
  row.deductionTracking = ded ? { status: 'Recommended', sentRef: null, sentAt: null, hrOutcome: null, hrRef: null, capturedAt: null } : null;
  touch(row, when);
  log(row, 'Decided', `${decisionLabel(type)}${ded ? ` · ${money(ded.amount)} — ${ded.basis}` : ''} — ${why}`, when, who);
  store.commit('accountabilityCases.decide');
  return row;
}

/** The person appeals the decision — once, to somebody more senior than the decider. */
export function fileAppeal(id, { text = '' } = {}, { at = null, by = null } = {}) {
  const row = get(id);
  if (!row) return { error: 'No such case' };
  if (!isOpen(row)) return { error: 'The case is closed' };
  if (!row.decision?.type) return { error: 'There is no decision to appeal yet' };
  if (row.appeal?.text) return { error: 'An appeal is on file' };
  const said = String(text || '').trim();
  if (!said) return { error: 'Record the grounds of the appeal' };
  const when = at || new Date().toISOString();
  row.appeal = { text: said, filedAt: when, reviewedBy: null, outcome: null, rationale: '', reviewedAt: null, versions: [] };
  touch(row, when);
  log(row, 'Appeal filed', said.slice(0, 200), when, by);
  store.commit('accountabilityCases.appeal');
  return row;
}

/** What blocks a review now — the sentence, or ''. */
export function reviewBlocker(row, reviewer = currentRole().name) {
  if (!row) return 'No such case';
  if (!isOpen(row)) return 'The case is closed';
  if (!row.appeal?.text) return 'No appeal has been filed';
  const deciderLevel = levelOf(row.decision?.decidedBy);
  if (isSamePerson(reviewer, row.decision?.decidedBy)) return 'You made the decision — somebody more senior reviews the appeal';
  if (levelOf(reviewer) <= deciderLevel) return `The appeal is reviewed by somebody senior to ${row.decision?.decidedBy || 'the decider'}`;
  return '';
}

/**
 * reviewAppeal(id, { outcome, rationale, modified: { type, deduction } }) →
 * the row or { error }. The reviewer is senior to the decider; every review
 * is appended as a version, so a later reviewer reads what the earlier one
 * ruled. Modified carries the new decision onto the record and keeps the old
 * one in the version; Overturned records No action.
 */
export function reviewAppeal(id, { outcome, rationale = '', modified = null } = {}, { at = null, by = null } = {}) {
  const row = get(id);
  const who = by || currentRole().name;
  const blocker = reviewBlocker(row, who);
  if (blocker) return { error: blocker };
  if (!APPEAL_OUTCOMES.includes(outcome)) return { error: 'Pick an outcome' };
  const why = String(rationale || '').trim();
  if (!why) return { error: 'Give the rationale' };
  let next = null;
  if (outcome === 'Modified') {
    if (!DECISION_TYPES.includes(modified?.type)) return { error: 'A modified outcome names the decision it becomes' };
    if (modified.type === row.decision.type && JSON.stringify(modified.deduction || null) === JSON.stringify(row.decision.deduction || null)) return { error: 'Modified means the decision changes' };
    if (modified.type === 'deductionRecommendation' && !(Number(modified.deduction?.amount) > 0 && String(modified.deduction?.basis || '').trim())) return { error: 'A deduction recommendation names an amount and its basis' };
    next = { type: modified.type, deduction: modified.type === 'deductionRecommendation' ? { amount: Math.round(Number(modified.deduction.amount) * 100) / 100, basis: String(modified.deduction.basis).trim() } : null };
  } else if (outcome === 'Overturned') next = { type: 'noAction', deduction: null };
  console.assert(levelOf(who) > levelOf(row.decision?.decidedBy), '[accountability] appeal reviewer must be senior to the decider', row.id);
  const when = at || new Date().toISOString();
  const before = { type: row.decision.type, deduction: row.decision.deduction };
  row.appeal.versions = [...(row.appeal.versions || []), { n: (row.appeal.versions?.length || 0) + 1, outcome, rationale: why, reviewedBy: who, reviewedAt: when, decisionBefore: before, decisionAfter: next || before }];
  row.appeal.outcome = outcome;
  row.appeal.rationale = why;
  row.appeal.reviewedBy = who;
  row.appeal.reviewedAt = when;
  if (next) {
    row.decision = { ...row.decision, type: next.type, deduction: next.deduction, modifiedBy: who, modifiedAt: when, original: row.decision.original || before };
    if (next.deduction && !row.deductionTracking) row.deductionTracking = { status: 'Recommended', sentRef: null, sentAt: null, hrOutcome: null, hrRef: null, capturedAt: null };
    if (!next.deduction && row.deductionTracking && row.deductionTracking.status === 'Recommended') row.deductionTracking = null;
  }
  touch(row, when);
  log(row, 'Appeal reviewed', `${outcome}${next ? ` → ${decisionLabel(next.type)}${next.deduction ? ` ${money(next.deduction.amount)}` : ''}` : ''} — ${why}`, when, who);
  store.commit('accountabilityCases.review');
  return row;
}

/** The recommendation goes to HR with a reference. Nothing is deducted here. */
export function sendToHr(id, { sentRef = '' } = {}, { at = null, by = null } = {}) {
  const row = get(id);
  if (!row) return { error: 'No such case' };
  const t = row.deductionTracking;
  if (!t) return { error: 'There is no deduction recommendation on this case' };
  if (t.status !== 'Recommended') return { error: `Already ${DEDUCTION_LABELS[t.status].toLowerCase()}` };
  if (row.appeal?.text && !row.appeal.outcome) return { error: 'The appeal is under review — HR waits for the outcome' };
  const ref = String(sentRef || '').trim();
  if (!ref) return { error: 'Quote the HR reference' };
  const when = at || new Date().toISOString();
  row.deductionTracking = { ...t, status: 'SentToHR', sentRef: ref, sentAt: when };
  touch(row, when);
  log(row, 'Sent to HR', `${money(row.decision?.deduction?.amount)} recommended · ${ref}`, when, by);
  store.commit('accountabilityCases.hr');
  return row;
}

/** What HR decided, as a note — payroll is theirs. */
export function captureHrOutcome(id, { hrOutcome = '', hrRef = '' } = {}, { at = null, by = null } = {}) {
  const row = get(id);
  if (!row) return { error: 'No such case' };
  const t = row.deductionTracking;
  if (!t) return { error: 'There is no deduction recommendation on this case' };
  if (t.status !== 'SentToHR') return { error: t.status === 'Recommended' ? 'Send the recommendation to HR first' : 'The outcome is already captured' };
  const outcome = String(hrOutcome || '').trim();
  if (!outcome) return { error: 'Record what HR decided' };
  const when = at || new Date().toISOString();
  row.deductionTracking = { ...t, status: 'OutcomeCaptured', hrOutcome: outcome, hrRef: String(hrRef || '').trim() || null, capturedAt: when };
  touch(row, when);
  log(row, 'HR outcome captured', `${outcome}${hrRef ? ` · ${hrRef}` : ''}`, when, by);
  store.commit('accountabilityCases.hrOutcome');
  return row;
}

export function closeBlocker(row) {
  if (!row) return 'No such case';
  if (!isOpen(row)) return 'Already closed';
  if (!row.decision?.type) return 'Record a decision first';
  if (row.appeal?.text && !row.appeal.outcome) return 'The appeal is under review';
  if (row.deductionTracking && row.deductionTracking.status !== 'OutcomeCaptured') return `The deduction is ${DEDUCTION_LABELS[row.deductionTracking.status].toLowerCase()} — capture HR's outcome first`;
  return '';
}

export function close(id, { note = '' } = {}, { at = null, by = null } = {}) {
  const row = get(id);
  const blocker = closeBlocker(row);
  if (blocker) return { error: blocker };
  const when = at || new Date().toISOString();
  row.closedAt = when;
  row.closedBy = by || currentRole().name;
  touch(row, when);
  log(row, 'Closed', String(note || '').trim() || `${decisionLabel(row.decision.type)}${row.appeal?.outcome ? ` · appeal ${row.appeal.outcome.toLowerCase()}` : ''}`, when, by);
  store.commit('accountabilityCases.close');
  return row;
}

// --- internals --------------------------------------------------------------------------------

const byAt = (a, b) => String(a.openedAt).localeCompare(String(b.openedAt)) || a.id.localeCompare(b.id);

/** A name or a staff id on either side. */
export function isSamePerson(a, b) {
  if (!a || !b) return false;
  const idOf = (v) => staff(v)?.id || staffByName(v)?.id || v;
  return idOf(a) === idOf(b);
}

const levelOf = (nameOrId) => staffLevel(staff(nameOrId)?.id || staffByName(nameOrId)?.id || nameOrId);

const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function touch(row, at = null) { row.updatedAt = at || new Date().toISOString(); }

function daysAfter(isoDate, n) {
  const d = new Date(`${String(isoDate || '').slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function log(row, action, details, at, by) {
  audit.all().push({
    id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: row.id, action, details,
    user: by || currentRole().name, at: at || new Date().toISOString(),
  });
}
