// Repository — risk rules (amendment 40, Defensio F5). Owner:
// modules/defensio. A risk rule is a pattern turned into a warning at the
// scrub: its conditions mirror the pattern's dimensions (the payer, the
// cause, the service at the level the pattern was read at), its message is
// what the biller reads, and its severity is a warning and nothing else — a
// prediction never blocks a claim, it is acknowledged with a reason like any
// other warning. `SEVERITY` is a constant, every write asserts it, and the
// one code path that raises a finding raises a Warning.
//
// The Claima wire, both halves registered here: the scrubber's extension
// point (`extensions[]` on data/engines/claim-scrubber.js, a leaf) gets one
// category, "Denial Risk (Defensio)", whose findings carry the rule id, and
// every claim a rule fires on is a hit; the acknowledgment of such a finding
// is read off the claim's own scrub run when the claim register commits
// it; and the remittance register's posting hook — the point amendment 39
// used — says whether a claim that fired was later denied on the lines the
// rule named, or paid. Those four counters are the rule's record: a rule
// that has fired often and whose warnings, sent out as they were, were
// paid rather than denied predicted nothing and is flagged for retirement;
// a rule whose source pattern has faded is proposed for suspension, and a
// person decides. Nothing here is imported by the claim register — the
// arrow runs from this file to the scrubber and to the remittances, never
// back.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as denialPatterns from './denial-patterns.js';
import * as claims from './claims.js';
import * as remittances from './remittances.js';
import * as contracts from './contracts.js';
import * as cdm from './cdm.js';
import * as payers from './payers.js';
import * as scrubber from '../engines/claim-scrubber.js';
import { buildRules } from '../seed/risk-rules.js';
import { rootCauseLabel, rootCause } from '../seed/root-causes.js';
import { current as currentRole } from '../../shared/roles.js';
import { CONFIG } from '../../shared/config.js';
import { todayIso } from '../../shared/format.js';

const TABLE = 'riskRules';
const ENTITY = 'riskRules';

export const SEVERITY = 'warning';
export const RISK_CATEGORY = 'Denial Risk (Defensio)';
export const STATUSES = ['Active', 'Suspended', 'Retired'];
export const statusTone = (s) => ({ Active: 'success', Suspended: 'warning', Retired: '' }[s] || '');
export const { LEVELS, LEVEL_LABELS } = denialPatterns;

const config = () => CONFIG.defensio?.prevention?.rules || {};
export const retireFiredAtLeast = () => Number(config().retireFiredAtLeast) || 20;
export const retireFollowThroughBelow = () => (config().retireFollowThroughBelow != null ? Number(config().retireFollowThroughBelow) : 0.1);

// --- reads ------------------------------------------------------------------------------

let ready = false;
export function all() {
  const rows = store.table(TABLE);
  if (!ready) { ready = true; ensureSeeded(); }
  return rows;
}
export const get = (id) => all().find((r) => r.id === id) || null;
export const history = (id) => audit.forEntity(ENTITY, id);
export const active = () => all().filter((r) => r.status === 'Active');
export const byPattern = (patternId) => all().filter((r) => r.patternId === patternId);
export const activeFor = (patternId) => byPattern(patternId).filter((r) => r.status === 'Active');

/** The conditions a pattern's dimensions mirror — what a rule created from it carries. */
export function conditionsFrom(pattern) {
  const d = pattern?.dims || {};
  return { payerId: d.payerId || null, causeId: d.causeId || null, service: { level: d.service?.level || 'any', value: d.service?.value ?? '*' } };
}
export const conditionsLabel = (c) => `${c?.payerId ? payers.get(c.payerId)?.nameEn || c.payerId : 'Any payer'} · ${c?.causeId ? rootCauseLabel(c.causeId) : 'Any cause'} · ${
  denialPatterns.serviceLabel({ service: c?.service })}`;
/** A message the pattern's own numbers write — editable afterwards. */
export function defaultMessage(pattern) {
  if (!pattern) return '';
  const c = pattern.counters || {};
  return `${denialPatterns.payerLabel(pattern.dims)} refused ${c.occurrences || 0} ${denialPatterns.serviceLabel(pattern.dims).toLowerCase()} line${(c.occurrences || 0) === 1 ? '' : 's'} in ${pattern.window?.days || denialPatterns.windowDays()} days — ${
    rootCauseLabel(pattern.dims.causeId).toLowerCase()}. Check it before this claim goes out.`;
}

/**
 * The counters on a rule: fired (claims warned), ackSubmitted (the warning
 * acknowledged and the claim sent out as it was), fixedPreSubmission (the
 * claim went out without the warning standing — a re-scrub after the fix
 * dropped it), deniedAnyway and paid (the remittance's answer on a claim
 * that went out as warned). Three numbers, no double-counting:
 * fired = ackSubmitted + fixedPreSubmission + pending (still in assembly).
 */
export const stats = (rule) => ({ fired: 0, ackSubmitted: 0, fixedPreSubmission: 0, deniedAnyway: 0, paid: 0, ...(rule?.hitStats || {}) });
/** Denied anyway over sent out as warned — when we warned and they sent it anyway, was the warning right? Null before anything went out. */
export function followThrough(rule) {
  const s = stats(rule);
  return s.ackSubmitted > 0 ? s.deniedAnyway / s.ackSubmitted : null;
}
/** Fixed before submission over fired — the share of warnings the desk acted on (amendment 41's first-pass prevention). Null before anything fired. */
export function firstPassPrevention(rule) {
  const s = stats(rule);
  return s.fired > 0 ? s.fixedPreSubmission / s.fired : null;
}
/** The whole record in one read: the five counters, the pending remainder and the two rates. */
export function breakdown(rule) {
  const s = stats(rule);
  return { ...s, pending: Math.max(0, s.fired - s.ackSubmitted - s.fixedPreSubmission), followThrough: followThrough(rule), firstPassPrevention: firstPassPrevention(rule) };
}
/** getRiskRuleStats() → the same record summed over every rule (a retired rule's history included), with the per-rule rows — what amendment 41 reads. */
export function getRiskRuleStats() {
  const rows = all().map((r) => ({ ruleId: r.id, patternId: r.patternId || null, status: r.status, ...breakdown(r) }));
  const sum = (key) => rows.reduce((n, r) => n + (Number(r[key]) || 0), 0);
  const fired = sum('fired');
  const ackSubmitted = sum('ackSubmitted');
  const fixedPreSubmission = sum('fixedPreSubmission');
  const deniedAnyway = sum('deniedAnyway');
  return {
    rules: rows.length, active: rows.filter((r) => r.status === 'Active').length,
    fired, ackSubmitted, fixedPreSubmission, pending: sum('pending'), deniedAnyway, paid: sum('paid'),
    followThrough: ackSubmitted > 0 ? deniedAnyway / ackSubmitted : null,
    firstPassPrevention: fired > 0 ? fixedPreSubmission / fired : null,
    byRule: rows,
  };
}
/** Flagged once it has fired enough and predicted too little; a person retires it. */
export const retirementFlag = (rule) => {
  const s = stats(rule);
  const ft = followThrough(rule);
  return rule?.status !== 'Retired' && s.fired >= retireFiredAtLeast() && ft != null && ft < retireFollowThroughBelow();
};
/** Proposed for suspension while its source pattern is faded — until somebody keeps it or suspends it. */
export function suspendProposal(rule) {
  if (!rule?.patternId || rule.status !== 'Active') return null;
  const p = denialPatterns.get(rule.patternId);
  if (!p || p.status !== 'Faded') return null;
  if (rule.keptDespiteFade && String(rule.keptDespiteFade.at) >= String(p.fadedAt || '')) return null;
  return { reason: `Source pattern faded on ${p.fadedAt || '—'} — the window no longer holds the threshold`, since: p.fadedAt || null };
}
export const attention = () => all().filter((r) => retirementFlag(r) || suspendProposal(r));

/** search(q, { status, patternId, source ('pattern' | 'manual'), flagged, proposed }) → rows, the ones needing a decision first. */
export function search(q = '', f = {}) {
  const needle = String(q || '').trim().toLowerCase();
  const rank = (r) => (retirementFlag(r) || suspendProposal(r) ? 0 : r.status === 'Active' ? 1 : r.status === 'Suspended' ? 2 : 3);
  return all()
    .filter((r) => {
      if (f.status && r.status !== f.status) return false;
      if (f.patternId && r.patternId !== f.patternId) return false;
      if (f.source === 'pattern' && !r.patternId) return false;
      if (f.source === 'manual' && r.patternId) return false;
      if (f.flagged && !retirementFlag(r)) return false;
      if (f.proposed && !suspendProposal(r)) return false;
      if (!needle) return true;
      return [r.id, r.message, conditionsLabel(r.conditions), r.patternId, r.manual?.reason].some((v) => String(v || '').toLowerCase().includes(needle));
    })
    .sort((a, b) => rank(a) - rank(b) || stats(b).fired - stats(a).fired || a.id.localeCompare(b.id));
}

export function counts() {
  const rows = all();
  return {
    total: rows.length,
    active: rows.filter((r) => r.status === 'Active').length,
    suspended: rows.filter((r) => r.status === 'Suspended').length,
    retired: rows.filter((r) => r.status === 'Retired').length,
    flagged: rows.filter(retirementFlag).length,
    proposed: rows.filter((r) => suspendProposal(r)).length,
    firedTotal: rows.reduce((n, r) => n + stats(r).fired, 0),
  };
}

/** getActiveRiskRules() → the Claima wire's shape: [{ ruleId, patternId, conditions { payerId, reasonCode | rootCause, cdmRef | category | serviceGroup, originRef }, message, status }]. */
export function getActiveRiskRules() {
  return active().map((r) => {
    const c = r.conditions || {};
    const p = r.patternId ? denialPatterns.get(r.patternId) : null;
    const kinds = p?.counters?.causeKinds || {};
    const code = Object.entries(p?.counters?.codes || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const conditions = { payerId: c.payerId || null };
    if (c.causeId && ((kinds.tagged || 0) + (kinds.confirmed || 0) > 0 || !code)) conditions.rootCause = c.causeId; else conditions.reasonCode = code;
    if (c.service?.level === 'item') conditions.cdmRef = c.service.value;
    else if (c.service?.level === 'category') conditions.category = c.service.value;
    else if (c.service?.level === 'group') conditions.serviceGroup = c.service.value;
    if (c.causeId) conditions.originRef = rootCause(c.causeId)?.group || null;
    return { ruleId: r.id, patternId: r.patternId || null, conditions, message: r.message, status: r.status };
  });
}

// --- the scrub extension ----------------------------------------------------------------

/** Does a claim line fall under the rule's service condition? `itemOf` is the scrubber's, the charge master the fallback. */
export function lineMatches(line, conditions, itemOf = null) {
  const s = conditions?.service || { level: 'any' };
  if (s.level === 'any') return true;
  const item = (itemOf && itemOf(line.itemId)) || cdm.get(line.itemId);
  if (!item) return false;
  if (s.level === 'item') return item.id === s.value || line.itemId === s.value;
  if (s.level === 'category') return item.category === s.value;
  if (s.level === 'group') return contracts.serviceGroupOf(item.category) === s.value;
  return false;
}

/**
 * The extension the scrubber runs after its six categories: every active
 * rule whose payer is the claim's and whose service one of the lines falls
 * under raises one Warning per line (one on the claim at the any-service
 * level), each carrying the rule id — and the claim is a hit on the rule.
 */
export function evaluateClaim(claim, ctx = {}) {
  const out = [];
  if (!claim) return out;
  for (const rule of active()) {
    const c = rule.conditions || {};
    if (c.payerId && claim.payerId !== c.payerId) continue;
    const lines = (claim.lines || []).filter((l) => !l.isOverage && lineMatches(l, c, ctx.itemOf));
    if (!lines.length) continue;
    const anyLevel = (c.service?.level || 'any') === 'any';
    const targets = anyLevel ? [null] : lines;
    for (const line of targets) {
      out.push({ message: rule.message, lineId: line?.id || null, code: rule.id, jumpTo: line ? { tab: 'lines', lineId: line.id } : { tab: 'lines' }, meta: { ruleId: rule.id, patternId: rule.patternId || null, source: 'defensio' } });
    }
    recordRiskRuleHit(rule.id, { claimId: claim.id, claimNo: claim.claimNo, lineIds: lines.map((l) => l.id), acknowledged: false }, { commit: false });
  }
  return out;
}
console.assert(SEVERITY === 'warning', '[riskRules] severity is a warning and nothing else');
scrubber.extensions?.push({ id: 'defensio-risk', category: RISK_CATEGORY, run: evaluateClaim });

// --- hits -----------------------------------------------------------------------------------

/**
 * recordRiskRuleHit(ruleId, { claimId, claimNo, lineIds, acknowledged }) —
 * the Claima wire's second call. Fired records the claim once; acknowledged
 * marks the hit and, once the claim has left assembly, counts it as sent
 * out over the warning.
 */
export function recordRiskRuleHit(ruleId, { claimId, claimNo = null, lineIds = null, acknowledged = false } = {}, { commit = true, at = null } = {}) {
  const rule = get(ruleId);
  if (!rule || !claimId) return null;
  const when = at || new Date().toISOString();
  rule.hits = rule.hits || [];
  rule.hitStats = stats(rule);
  let hit = rule.hits.find((h) => h.claimId === claimId);
  let changed = false;
  if (!hit) {
    hit = { claimId, claimNo: claimNo || claims.get(claimId)?.claimNo || null, lineIds: lineIds || [], firedAt: when, acknowledged: false, acknowledgedAt: null, submitted: false, submittedAt: null, fixed: false, fixedAt: null, outcome: null, outcomeAt: null, remittanceNo: null };
    rule.hits.push(hit);
    rule.hitStats.fired += 1;
    changed = true;
  } else if (lineIds && lineIds.length) hit.lineIds = lineIds;
  if (acknowledged && !hit.acknowledged) { hit.acknowledged = true; hit.acknowledgedAt = when; changed = true; }
  if (settleSubmitted(rule, hit, when)) changed = true;
  if (changed) { rule.updatedAt = when; if (commit) store.commit('riskRules.hit'); }
  return hit;
}
/**
 * A hit whose claim has left Draft or Ready is settled one way or the
 * other: acknowledged, it was sent out as warned; not acknowledged, the
 * warning no longer stood when the claim went out (a claim with a standing
 * warning is not finalized), so it was fixed before submission.
 */
function settleSubmitted(rule, hit, when) {
  if (hit.submitted || hit.fixed) return false;
  const c = claims.get(hit.claimId);
  if (!c || ['Draft', 'Ready', 'Void'].includes(c.status)) return false;
  if (hit.acknowledged) {
    hit.submitted = true;
    hit.submittedAt = when;
    rule.hitStats.ackSubmitted += 1;
  } else {
    hit.fixed = true;
    hit.fixedAt = when;
    rule.hitStats.fixedPreSubmission += 1;
  }
  return true;
}
/** Read the acknowledgments off the latest scrub run of every claim that fired — what the claim register's commit says. */
function reconcileAcknowledgments() {
  let changed = false;
  for (const rule of store.table(TABLE)) {
    for (const hit of rule.hits || []) {
      if (hit.acknowledged) continue;
      const c = claims.get(hit.claimId);
      const run = claims.latestScrub(c);
      if (!run) continue;
      const acked = (run.acknowledgments || []).some((a) => run.findings.find((f) => f.id === a.findingId)?.meta?.ruleId === rule.id);
      if (acked && recordRiskRuleHit(rule.id, { claimId: hit.claimId, acknowledged: true }, { commit: false })) changed = true;
    }
  }
  return changed;
}
function reconcileSubmissions() {
  let changed = false;
  const when = new Date().toISOString();
  for (const rule of store.table(TABLE)) for (const hit of rule.hits || []) if (settleSubmitted(rule, hit, when)) changed = true;
  return changed;
}
/** Claima's posting hook: a claim that fired and was refused on a line the rule named was denied anyway; paid otherwise. A reversal takes the answer back. */
function onRemittancePosted(event = {}) {
  let changed = false;
  const when = event.at || new Date().toISOString();
  for (const rule of store.table(TABLE)) {
    for (const hit of rule.hits || []) {
      if (!(event.claimNos || []).includes(hit.claimNo)) continue;
      rule.hitStats = stats(rule);
      if (event.reversed) {
        if (hit.remittanceNo !== event.remittanceNo || !hit.outcome) continue;
        rule.hitStats[hit.outcome === 'denied' ? 'deniedAnyway' : 'paid'] = Math.max(0, rule.hitStats[hit.outcome === 'denied' ? 'deniedAnyway' : 'paid'] - 1);
        Object.assign(hit, { outcome: null, outcomeAt: null, remittanceNo: null });
        changed = true;
        continue;
      }
      if (hit.outcome || !hit.submitted) continue; // the answer on a fixed claim belongs to first-pass prevention, not to follow-through
      const posting = remittances.byClaim(hit.claimNo).find((p) => p.remittanceNo === event.remittanceNo);
      if (!posting) continue;
      const named = (hit.lineIds || []).length ? posting.lines.filter((l) => hit.lineIds.includes(l.lineId)) : posting.lines;
      const denied = named.some((l) => l.outcome === 'Denied' || Number(l.denied) > 0);
      const paid = posting.lines.some((l) => Number(l.paid) > 0);
      if (!denied && !paid) continue;
      hit.outcome = denied ? 'denied' : 'paid';
      hit.outcomeAt = when;
      hit.remittanceNo = event.remittanceNo;
      rule.hitStats[denied ? 'deniedAnyway' : 'paid'] += 1;
      changed = true;
    }
    if (changed) rule.updatedAt = when;
  }
  if (changed) store.commit('riskRules.outcome');
}
remittances.afterPostHooks?.push(onRemittancePosted);
store.subscribe((reason) => {
  if (reason === 'reset') { ready = false; seeded = false; return; }
  if (!ready || reason.startsWith('riskRules.')) return;
  if (reason === 'claims.acknowledge' && reconcileAcknowledgments()) store.commit('riskRules.hit');
  if ((reason === 'claims.status' || reason === 'claims.batch' || reason === 'claims.resubmit') && reconcileSubmissions()) store.commit('riskRules.hit');
});

// --- writes -----------------------------------------------------------------------------------

const stamp = ({ at = null, by = null } = {}) => ({ when: at || new Date().toISOString(), who: by || currentRole().name });

/** create({ patternId | manual: { reason }, conditions, message }) → the Active rule or { error }. Conditions mirror the pattern when there is one. */
export function create(data = {}, dated = {}) {
  const pattern = data.patternId ? denialPatterns.get(data.patternId) : null;
  if (data.patternId && !pattern) return { error: `${data.patternId} is not a pattern on the register` };
  if (!pattern && !String(data.manual?.reason || '').trim()) return { error: 'A rule with no source pattern needs a reason' };
  const conditions = pattern ? conditionsFrom(pattern) : normalizeConditions(data.conditions);
  if (!conditions) return { error: 'Name at least a payer, a cause or a service' };
  const message = String(data.message || '').trim() || defaultMessage(pattern);
  if (!message) return { error: 'Write the message the biller reads' };
  const { when, who } = stamp(dated);
  const row = {
    id: store.nextId(TABLE, 'RR-'),
    patternId: pattern?.id || null, manual: pattern ? null : { reason: String(data.manual.reason).trim() },
    conditions, message, severity: SEVERITY, status: 'Active', statusReason: '',
    hitStats: { fired: 0, ackSubmitted: 0, fixedPreSubmission: 0, deniedAnyway: 0, paid: 0, ...(data.hitStats || {}) }, hits: [],
    keptDespiteFade: null, seedTag: data.seedTag || null,
    createdAt: when, createdBy: who, updatedAt: when,
  };
  console.assert(row.severity === SEVERITY, '[riskRules] severity is a warning and nothing else');
  all().push(row);
  log(row, 'Created', `${conditionsLabel(conditions)}${pattern ? ` — from ${pattern.id}` : ` — ${row.manual.reason}`}`, when, who);
  if (dated.commit !== false) store.commit('riskRules.create');
  return row;
}
export function normalizeConditions(c = {}) {
  const level = LEVELS.includes(c?.service?.level) ? c.service.level : 'any';
  const value = level === 'any' ? '*' : String(c?.service?.value || '').trim();
  if (level !== 'any' && !value) return null;
  const out = { payerId: c?.payerId || null, causeId: c?.causeId || null, service: { level, value } };
  return out.payerId || out.causeId || level !== 'any' ? out : null;
}

/** update(id, { message, conditions }) — the message on any rule; the conditions only on a manual one, since a pattern's are mirrored. */
export function update(id, patch = {}, dated = {}) {
  const row = get(id);
  if (!row) return { error: 'No such rule' };
  if (row.status === 'Retired') return { error: 'A retired rule is not edited' };
  const { when, who } = stamp(dated);
  const changed = [];
  if (patch.message !== undefined) {
    const m = String(patch.message || '').trim();
    if (!m) return { error: 'Write the message the biller reads' };
    if (m !== row.message) { row.message = m; changed.push('message'); }
  }
  if (patch.conditions !== undefined) {
    if (row.patternId) return { error: 'Conditions mirror the source pattern — retire this rule and write a manual one to change them' };
    const c = normalizeConditions(patch.conditions);
    if (!c) return { error: 'Name at least a payer, a cause or a service' };
    if (JSON.stringify(c) !== JSON.stringify(row.conditions)) { row.conditions = c; changed.push('conditions'); }
  }
  if (patch.severity !== undefined && patch.severity !== SEVERITY) return { error: 'Severity is locked to warning' };
  if (!changed.length) return row;
  row.updatedAt = when;
  log(row, 'Updated', changed.map((k) => (k === 'message' ? `message: ${row.message}` : `conditions: ${conditionsLabel(row.conditions)}`)).join('; '), when, who);
  if (dated.commit !== false) store.commit('riskRules.update');
  return row;
}

function move(id, status, action, reason, dated) {
  const row = get(id);
  if (!row) return { error: 'No such rule' };
  if (row.status === 'Retired') return { error: 'A retired rule stays retired' };
  if (row.status === status) return { error: `Already ${status.toLowerCase()}` };
  if (status !== 'Active' && !String(reason || '').trim()) return { error: 'Say why' };
  const { when, who } = stamp(dated);
  const from = row.status;
  row.status = status;
  row.statusReason = String(reason || '').trim();
  row.updatedAt = when;
  log(row, action, `${from} → ${status}${row.statusReason ? ` — ${row.statusReason}` : ''}`, when, who);
  if (dated.commit !== false) store.commit('riskRules.status');
  return row;
}
export const suspend = (id, reason, dated = {}) => move(id, 'Suspended', 'Suspended', reason, dated);
export const resume = (id, dated = {}) => move(id, 'Active', 'Resumed', '', dated);
export const retire = (id, reason, dated = {}) => move(id, 'Retired', 'Retired', reason, dated);
/** Keep an active rule whose pattern faded — the proposal is answered until the pattern fades again. */
export function keepDespiteFade(id, note = '', dated = {}) {
  const row = get(id);
  if (!row) return { error: 'No such rule' };
  const proposal = suspendProposal(row);
  if (!proposal) return { error: 'Nothing proposed on this rule' };
  const { when, who } = stamp(dated);
  row.keptDespiteFade = { at: when, by: who, note: String(note || '').trim() };
  row.updatedAt = when;
  log(row, 'Kept', `Suspension proposed (${proposal.reason}) — kept${row.keptDespiteFade.note ? ` — ${row.keptDespiteFade.note}` : ''}`, when, who);
  if (dated.commit !== false) store.commit('riskRules.status');
  return row;
}

function log(row, action, details, at = null, by = null) {
  audit.all().push({ id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: row.id, action, details, user: by || currentRole().name, at: at || new Date().toISOString() });
}

// --- seed -------------------------------------------------------------------------------------

let seeded = false;
let building = false;
const gate = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
let seedGate = gate();
export const whenSeeded = () => seedGate.promise;
export const seedReady = seedGate.promise;
async function ensureSeeded() {
  if (seeded || building) return;
  building = true;
  try {
    denialPatterns.all();
    await denialPatterns.whenSeeded();
    if (!store.table(TABLE).some((r) => r.seedTag === 'A40')) store.batch(() => buildRules(seedApi));
    seeded = true;
    store.commit('riskRules.seed');
  } finally {
    building = false;
    seedGate.resolve();
  }
}
store.subscribe((reason) => { if (reason === 'reset') seedGate = gate(); });

const seedApi = { today: todayIso(), patternId: (dims) => denialPatterns.idFor(dims), get, create, update, suspend, retire, log };
