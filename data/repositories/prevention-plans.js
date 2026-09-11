// Repository — prevention plans (amendment 40, Defensio F5). Owner:
// modules/defensio. What the hospital decides to change so a pattern stops:
// a plan names its targets (a pattern, a root cause, or a corrective action
// a root-cause case already raised), freezes a baseline the day it is
// activated — what those targets drew in the window before — carries its
// actions (its own, a risk rule, or one adopted from amendment 37's register,
// whose status is read from there and never copied) with evidence on each,
// and is measured over the same length of window once the actions are done.
// data/engines/plan-effectiveness.js decides the verdict; this file resolves
// the facts and writes the plan. A plan closed ineffective has to say what
// happens next — reopened as a fresh draft chained to it, or escalated into a
// root-cause case — and what a plan is credited with preventing is an
// estimate, labelled as one and written to no ledger.
//
// The pattern register never reads this file: `planResolvers` there is how
// a pattern learns it is Under plan. Amendment 37's case register is reached
// by dynamic import and feature-detected (the adopt picker, the escalation);
// its corrective-actions register is imported for the shared action types
// and the one-way status read.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as denialPatterns from './denial-patterns.js';
import * as denials from './denials.js';
import * as correctiveActions from './corrective-actions.js';
import * as engine from '../engines/plan-effectiveness.js';
import { buildPlans } from '../seed/prevention-plans.js';
import { staff, staffName } from '../seed/staff.js';
import { rootCauseLabel } from '../seed/root-causes.js';
import { current as currentRole } from '../../shared/roles.js';
import { CONFIG } from '../../shared/config.js';
import { compareDates, todayIso } from '../../shared/format.js';

const TABLE = 'preventionPlans';
const ENTITY = 'preventionPlans';

export const STATUSES = ['Draft', 'Active', 'InMeasurement', 'ClosedEffective', 'ClosedPartial', 'ClosedIneffective', 'Cancelled'];
export const STATUS_LABELS = {
  Draft: 'Draft', Active: 'Active', InMeasurement: 'In measurement', ClosedEffective: 'Closed — effective',
  ClosedPartial: 'Closed — partial', ClosedIneffective: 'Closed — ineffective', Cancelled: 'Cancelled',
};
export const OPEN_STATUSES = ['Draft', 'Active', 'InMeasurement'];
/** The statuses that hold a pattern Under plan. */
export const IN_FORCE = ['Active', 'InMeasurement'];
export const CLOSED = ['ClosedEffective', 'ClosedPartial', 'ClosedIneffective'];
export const TARGET_TYPES = ['pattern', 'cause', 'f2Action'];
export const TARGET_LABELS = { pattern: 'Pattern', cause: 'Root cause', f2Action: 'Corrective action' };
export const ACTION_KINDS = ['own', 'riskRule', 'f2Action'];
export const ACTION_KIND_LABELS = { own: 'Plan action', riskRule: 'Risk rule', f2Action: 'Adopted from RCA' };
export const ACTION_TYPES = correctiveActions.TYPES;
export const actionTypeLabel = correctiveActions.typeLabel;
export const EVIDENCE_KINDS = ['note', 'file'];
export const { VERDICTS, ESTIMATE_LABEL } = engine;
export const statusLabel = (s) => STATUS_LABELS[s] || s || '—';
export const statusTone = (s) => ({ Draft: '', Active: 'accent', InMeasurement: 'info', ClosedEffective: 'success', ClosedPartial: 'warning', ClosedIneffective: 'critical', Cancelled: '' }[s] || '');
export const verdictTone = (v) => ({ Effective: 'success', Partial: 'warning', Ineffective: 'critical' }[v] || '');
export const isOpen = (row) => OPEN_STATUSES.includes(row?.status);
export const inForce = (row) => IN_FORCE.includes(row?.status);

const config = () => CONFIG.defensio?.prevention?.measurement || {};
export const measurementDays = () => Number(config().windowDays) || engine.DEFAULTS.windowDays;
export const effectiveBelowPct = () => (config().effectiveBelowPct != null ? Number(config().effectiveBelowPct) : engine.DEFAULTS.effectiveBelowPct);

// --- peers ------------------------------------------------------------------------------

const peers = { rca: null };
export const peersReady = import('./rca-cases.js').then((m) => { peers.rca = m; }).catch(() => { peers.rca = null; });
export const peerStatus = () => ({ rca: Boolean(peers.rca) });

/** Amendment 37's concluded cases with their corrective actions — what the adopt picker lists; empty when the register is not on disk. */
export function adoptableActions() {
  const fn = peers.rca?.getConcludedRcaCases;
  if (typeof fn !== 'function') return [];
  try {
    return (fn() || []).flatMap((c) => (c.correctiveActions || []).map((a) => ({ ...a, caseId: c.caseId, caseStatus: c.status, rootCauseId: c.confirmedRootCause, denialIds: c.denialIds, row: correctiveActions.get(a.id) })));
  } catch (err) { console.warn('[plans] getConcludedRcaCases threw', err); return []; }
}

// --- reads ------------------------------------------------------------------------------

let ready = false;
export function all() {
  const rows = store.table(TABLE);
  if (!ready) { ready = true; ensureSeeded(); }
  return rows;
}
export const get = (id) => all().find((p) => p.id === id) || null;
export const history = (id) => audit.forEntity(ENTITY, id);

/** What the plans in force target — the pattern register's resolver. */
export function activeTargets() {
  const out = { patterns: new Set(), causes: new Set() };
  for (const p of store.table(TABLE)) {
    if (!inForce(p)) continue;
    for (const t of p.targets || []) {
      if (t.type === 'pattern') out.patterns.add(t.ref);
      if (t.type === 'cause') out.causes.add(t.ref);
    }
  }
  return out;
}
denialPatterns.planResolvers.push(activeTargets);

export const byPattern = (patternId) => all().filter((p) => (p.targets || []).some((t) => t.type === 'pattern' && t.ref === patternId));
export const byCause = (causeId) => all().filter((p) => (p.targets || []).some((t) => t.type === 'cause' && t.ref === causeId));
/** The plans in force on a pattern, directly or through its cause. */
export const inForceFor = (pattern) => all().filter((p) => inForce(p) && (p.targets || []).some((t) => (t.type === 'pattern' && t.ref === pattern?.id) || (t.type === 'cause' && t.ref === pattern?.dims?.causeId)));

export function targetLabel(t) {
  if (!t) return '—';
  if (t.type === 'pattern') { const p = denialPatterns.get(t.ref); return p ? denialPatterns.labelOf(p) : t.ref; }
  if (t.type === 'cause') return rootCauseLabel(t.ref);
  const a = correctiveActions.get(t.ref);
  return a ? `${a.id} · ${a.action}` : t.ref;
}
export const targetHref = (t) => (t?.type === 'pattern' ? `#/defensio/prevention?pattern=${encodeURIComponent(t.ref)}` : t?.type === 'cause' ? `#/defensio/denials?rootCauseId=${encodeURIComponent(t.ref)}` : t?.type === 'f2Action' && correctiveActions.get(t.ref) ? `#/defensio/rca/${correctiveActions.get(t.ref).rcaCaseId}/actions` : '');

/** Every denial fact the plan's targets cover, once each — what the baseline and the measurement count. */
export function targetFacts(plan) {
  const facts = denialPatterns.facts();
  const ids = new Set();
  for (const t of plan?.targets || []) {
    if (t.type === 'pattern') { const p = denialPatterns.get(t.ref); if (p) for (const f of facts) if (denialPatterns.matches(f, p.dims)) ids.add(f.id); }
    else if (t.type === 'cause') for (const f of facts) { if (f.causeId === t.ref) ids.add(f.id); }
    else if (t.type === 'f2Action') { const a = correctiveActions.get(t.ref); const c = a && peers.rca?.get ? peers.rca.get(a.rcaCaseId) : null; for (const id of c?.denialIds || []) ids.add(id); }
  }
  return facts.filter((f) => ids.has(f.id));
}

/** An adopted action's row on amendment 37's register — by reference, or by the rule the seed left when the register had not built yet. */
export function f2ActionOf(action) {
  if (!action || action.kind !== 'f2Action') return null;
  let row = action.f2ActionRef ? correctiveActions.get(action.f2ActionRef) : null;
  if (!row && action.f2Find && peers.rca?.all) {
    const c = peers.rca.all().find((x) => x.seedKey === action.f2Find.seedKey);
    row = c ? correctiveActions.byCase(c.id).find((a) => a.type === action.f2Find.type) || null : null;
    if (row) { action.f2ActionRef = row.id; if (!action.text) action.text = row.action; if (!action.ownerId) action.ownerId = row.ownerId; }
  }
  return row;
}
/** The status a row on the Actions panel reads — an adopted action's is amendment 37's, read one way. */
export function actionStatus(action) {
  if (action?.kind === 'f2Action') return f2ActionOf(action)?.status || 'Open';
  return action?.status || 'Open';
}
export const actionDone = (action) => ['Done', 'Verified'].includes(actionStatus(action));
export const isOverdue = (action, on = todayIso()) => !actionDone(action) && Boolean(action?.dueDate) && compareDates(action.dueDate, on) < 0;
export const overdueActions = (plan) => (inForce(plan) || plan?.status === 'Draft' ? (plan.actions || []).filter((a) => isOverdue(a)) : []);
/** Done without a file or a note behind it — the panel warns, the gate lets it through. */
export const doneWithoutEvidence = (action) => action?.kind !== 'f2Action' && actionDone(action) && !(action.evidence || []).length;

export const windowOf = (plan) => (plan?.measurement?.startedAt ? engine.windowOf(plan.measurement.startedAt, plan.measurement.windowDays || measurementDays()) : null);
export const pastWindow = (plan, on = todayIso()) => Boolean(plan?.measurement?.startedAt) && engine.isPastWindow(plan.measurement.startedAt, plan.measurement.windowDays || measurementDays(), on);
export const daysLeft = (plan, on = todayIso()) => (plan?.measurement?.startedAt ? engine.daysLeft(plan.measurement.startedAt, plan.measurement.windowDays || measurementDays(), on) : null);

export function activateBlockers(plan) {
  const out = [];
  if (!plan) return ['No such plan'];
  if (plan.status !== 'Draft') out.push(`A ${statusLabel(plan.status).toLowerCase()} plan is not activated again.`);
  if (!String(plan.title || '').trim()) out.push('Give the plan a title.');
  if (!(plan.targets || []).length) out.push('Name at least one target — a pattern, a cause or a corrective action.');
  if (!(plan.actions || []).length) out.push('Raise at least one action.');
  if (!plan.ownerId) out.push('Name an owner.');
  return out;
}
export function measurementBlockers(plan) {
  const out = [];
  if (!plan) return ['No such plan'];
  if (plan.status !== 'Active') out.push(`Only an active plan starts measuring (this one is ${statusLabel(plan.status).toLowerCase()}).`);
  const open = (plan.actions || []).filter((a) => !actionDone(a));
  if (open.length) out.push(`${open.length} action${open.length === 1 ? ' is' : 's are'} still open — measurement starts once every action is done.`);
  return out;
}
export function closeBlockers(plan, on = todayIso()) {
  const out = [];
  if (!plan) return ['No such plan'];
  if (plan.status !== 'InMeasurement') out.push('Only a plan in measurement closes on a verdict.');
  else if (!pastWindow(plan, on)) out.push(`The measurement window runs to ${windowOf(plan).to} — ${daysLeft(plan, on)} day${daysLeft(plan, on) === 1 ? '' : 's'} left.`);
  return out;
}

/** search(q, { status, open, ownerId ('me' | id), targetType, patternId, causeId, overdue }) → rows, open first, then newest. */
export function search(q = '', f = {}) {
  const needle = String(q || '').trim().toLowerCase();
  const me = currentRole().id;
  const rank = (p) => (p.status === 'InMeasurement' ? 0 : p.status === 'Active' ? 1 : p.status === 'Draft' ? 2 : p.status === 'Cancelled' ? 4 : 3);
  return all()
    .filter((p) => {
      if (f.status && p.status !== f.status) return false;
      if (f.open && !isOpen(p)) return false;
      if (f.ownerId && p.ownerId !== (f.ownerId === 'me' ? me : f.ownerId)) return false;
      if (f.targetType && !(p.targets || []).some((t) => t.type === f.targetType)) return false;
      if (f.patternId && !(p.targets || []).some((t) => t.type === 'pattern' && t.ref === f.patternId)) return false;
      if (f.causeId && !(p.targets || []).some((t) => t.type === 'cause' && t.ref === f.causeId)) return false;
      if (f.overdue && !overdueActions(p).length) return false;
      if (!needle) return true;
      return [p.id, p.title, p.description, staffName(p.ownerId), ...(p.targets || []).map(targetLabel)].some((v) => String(v || '').toLowerCase().includes(needle));
    })
    .sort((a, b) => rank(a) - rank(b) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function counts(on = todayIso()) {
  const rows = all();
  const month = on.slice(0, 7);
  const byStatus = {};
  for (const s of STATUSES) byStatus[s] = rows.filter((p) => p.status === s).length;
  const measured = rows.filter((p) => p.measurement?.result && String(p.measurement.result.computedAt || '').slice(0, 7) === month);
  return {
    total: rows.length,
    open: rows.filter(isOpen).length,
    inForce: rows.filter(inForce).length,
    overdue: rows.filter((p) => overdueActions(p).length).length,
    readyToClose: rows.filter((p) => p.status === 'InMeasurement' && pastWindow(p, on)).length,
    byStatus,
    preventedValueEstimateMTD: engine.cents(measured.reduce((n, p) => n + (p.measurement.result.prevented?.value || 0), 0)),
    closedEffectiveMtd: rows.filter((p) => p.status === 'ClosedEffective' && String(p.measurement?.closedAt || '').slice(0, 7) === month).length,
  };
}

/** getPreventionSummary() → { activePatterns, plansByStatus, preventedValueEstimateMTD, label } — what amendment 41 reads. */
export function getPreventionSummary() {
  const c = counts();
  return { activePatterns: denialPatterns.counts().active, plansByStatus: c.byStatus, preventedValueEstimateMTD: c.preventedValueEstimateMTD, label: engine.ESTIMATE_LABEL };
}

// --- writes -------------------------------------------------------------------------------

const stamp = ({ at = null, by = null } = {}) => ({ when: at || new Date().toISOString(), who: by || currentRole().name });
const nextActionId = (plan) => `A${(plan.actions || []).reduce((n, a) => Math.max(n, Number(String(a.id).replace('A', '')) || 0), 0) + 1}`;
const touch = (row, when) => { row.updatedAt = when; };

/** create({ title, description, targets[], ownerId, sponsorId }) → the Draft or { error }. */
export function create(data = {}, dated = {}) {
  const title = String(data.title || '').trim();
  if (!title) return { error: 'Give the plan a title' };
  const targets = (data.targets || []).filter((t) => TARGET_TYPES.includes(t?.type) && t.ref);
  if (data.ownerId && !staff(data.ownerId)) return { error: 'Pick an owner from the staff list' };
  const { when, who } = stamp(dated);
  const row = {
    id: store.nextId(TABLE, 'PP-'),
    title, description: String(data.description || '').trim(),
    targets, baseline: null, actions: [], planEvidence: [],
    status: 'Draft',
    measurement: { windowDays: measurementDays(), startedAt: null, endsAt: null, result: null, closedAt: null, closedBy: null, verdict: null, decision: null },
    ownerId: data.ownerId || null, sponsorId: data.sponsorId || null,
    predecessorId: data.predecessorId || null, successorId: null, cancelled: null,
    seedTag: data.seedTag || null,
    createdAt: when, createdBy: who, activatedAt: null, updatedAt: when,
  };
  all().push(row);
  log(row, 'Created', `${title}${targets.length ? ` — ${targets.map(targetLabel).join('; ')}` : ''}`, when, who);
  if (dated.commit !== false) store.commit('preventionPlans.create');
  return row;
}

export function update(id, patch = {}, dated = {}) {
  const row = get(id);
  if (!row) return { error: 'No such plan' };
  if (!isOpen(row)) return { error: 'A closed plan is not edited' };
  if (patch.ownerId && !staff(patch.ownerId)) return { error: 'Pick an owner from the staff list' };
  const { when, who } = stamp(dated);
  const changed = [];
  for (const key of ['title', 'description', 'ownerId', 'sponsorId']) {
    if (patch[key] === undefined) continue;
    const v = key === 'title' || key === 'description' ? String(patch[key] || '').trim() : patch[key] || null;
    if (key === 'title' && !v) return { error: 'Give the plan a title' };
    if (row[key] !== v) { changed.push(key); row[key] = v; }
  }
  if (!changed.length) return row;
  touch(row, when);
  log(row, 'Updated', changed.join(', '), when, who);
  if (dated.commit !== false) store.commit('preventionPlans.update');
  return row;
}

export function addTarget(id, target, dated = {}) {
  const row = get(id);
  if (!row) return { error: 'No such plan' };
  if (row.status !== 'Draft') return { error: 'Targets are frozen with the baseline once the plan is active' };
  if (!TARGET_TYPES.includes(target?.type) || !target.ref) return { error: 'Pick a target' };
  if ((row.targets || []).some((t) => t.type === target.type && t.ref === target.ref)) return row;
  const { when, who } = stamp(dated);
  row.targets = [...(row.targets || []), { type: target.type, ref: target.ref }];
  touch(row, when);
  log(row, 'Target added', targetLabel(target), when, who);
  if (dated.commit !== false) store.commit('preventionPlans.target');
  return row;
}
export function removeTarget(id, index, dated = {}) {
  const row = get(id);
  if (!row) return { error: 'No such plan' };
  if (row.status !== 'Draft') return { error: 'Targets are frozen with the baseline once the plan is active' };
  const t = (row.targets || [])[index];
  if (!t) return row;
  const { when, who } = stamp(dated);
  row.targets = row.targets.filter((_, i) => i !== index);
  touch(row, when);
  log(row, 'Target removed', targetLabel(t), when, who);
  if (dated.commit !== false) store.commit('preventionPlans.target');
  return row;
}

/** addAction(id, { kind: 'own' | 'riskRule', text, type, targetRef, riskRuleRef, ownerId, dueDate }) → the plan or { error }. */
export function addAction(id, data = {}, dated = {}) {
  const row = get(id);
  if (!row) return { error: 'No such plan' };
  if (!['Draft', 'Active'].includes(row.status)) return { error: 'Actions are raised while the plan is a draft or active' };
  const problems = validateAction(data);
  if (problems.length) return { error: problems.join(' ') };
  const { when, who } = stamp(dated);
  const a = {
    id: nextActionId(row), kind: data.kind === 'riskRule' ? 'riskRule' : 'own', text: String(data.text || '').trim(),
    type: data.kind === 'riskRule' ? 'RiskRule' : data.type, targetRef: data.targetRef || null, riskRuleRef: data.kind === 'riskRule' ? data.riskRuleRef : null,
    f2ActionRef: null, f2Find: null, ownerId: data.ownerId, dueDate: data.dueDate, status: 'Open', doneAt: null, doneBy: null, doneNote: '',
    evidence: [], raisedAt: when, raisedBy: who,
  };
  row.actions = [...(row.actions || []), a];
  touch(row, when);
  log(row, 'Action raised', `${a.id} · ${a.text}`, when, who);
  if (dated.commit !== false) store.commit('preventionPlans.action');
  return row;
}
export function validateAction(data = {}) {
  const out = [];
  if (!String(data.text || '').trim()) out.push('Say what the action is.');
  if (data.kind !== 'riskRule' && !ACTION_TYPES.includes(data.type)) out.push('Pick a type.');
  if (data.kind === 'riskRule' && !data.riskRuleRef) out.push('Pick the risk rule.');
  if (!data.ownerId || !staff(data.ownerId)) out.push('Name an owner from the staff list.');
  if (!data.dueDate) out.push('Give it a due date.');
  return out;
}
export function updateAction(id, actionId, patch = {}, dated = {}) {
  const row = get(id);
  const a = (row?.actions || []).find((x) => x.id === actionId);
  if (!row || !a) return { error: 'No such action' };
  if (a.kind === 'f2Action') return { error: 'An adopted action is edited on its root-cause case' };
  if (actionDone(a)) return { error: 'A done action is not edited — reopen it first' };
  const merged = { ...a, ...patch, kind: a.kind };
  const problems = validateAction(merged);
  if (problems.length) return { error: problems.join(' ') };
  const { when, who } = stamp(dated);
  Object.assign(a, { text: String(merged.text).trim(), type: a.kind === 'riskRule' ? 'RiskRule' : merged.type, targetRef: merged.targetRef || null, riskRuleRef: a.kind === 'riskRule' ? merged.riskRuleRef : null, ownerId: merged.ownerId, dueDate: merged.dueDate });
  touch(row, when);
  log(row, 'Action updated', `${a.id} · ${a.text}`, when, who);
  if (dated.commit !== false) store.commit('preventionPlans.action');
  return row;
}
export function removeAction(id, actionId, dated = {}) {
  const row = get(id);
  const a = (row?.actions || []).find((x) => x.id === actionId);
  if (!row || !a) return { error: 'No such action' };
  if (!['Draft', 'Active'].includes(row.status)) return { error: 'Actions are removed while the plan is a draft or active' };
  if (a.kind !== 'f2Action' && actionDone(a)) return { error: 'A done action stays on the plan' };
  const { when, who } = stamp(dated);
  row.actions = row.actions.filter((x) => x.id !== actionId);
  touch(row, when);
  log(row, a.kind === 'f2Action' ? 'Adoption dropped' : 'Action removed', `${a.id} · ${a.text}`, when, who);
  if (dated.commit !== false) store.commit('preventionPlans.action');
  return row;
}

/** adoptF2Action(id, caId | { seedKey, type }) — a link to amendment 37's action; its status is read from there, never copied. */
export function adoptF2Action(id, ref, dated = {}) {
  const row = get(id);
  if (!row) return { error: 'No such plan' };
  if (!['Draft', 'Active'].includes(row.status)) return { error: 'Actions are adopted while the plan is a draft or active' };
  const ca = typeof ref === 'string' ? correctiveActions.get(ref) : null;
  if (typeof ref === 'string' && !ca) return { error: `${ref} is not on the corrective-action register` };
  if (ca && (row.actions || []).some((a) => a.f2ActionRef === ca.id)) return { error: `${ca.id} is already adopted` };
  const { when, who } = stamp(dated);
  const a = {
    id: nextActionId(row), kind: 'f2Action', text: ca?.action || '', type: ca?.type || null, targetRef: ca?.targetRef || null, riskRuleRef: null,
    f2ActionRef: ca?.id || null, f2Find: ca ? null : ref, ownerId: ca?.ownerId || null, dueDate: ca?.dueDate || null, status: null,
    doneAt: null, doneBy: null, doneNote: '', evidence: [], raisedAt: when, raisedBy: who,
  };
  row.actions = [...(row.actions || []), a];
  touch(row, when);
  log(row, 'Action adopted', `${a.id} · ${ca ? `${ca.id} · ${ca.action}` : `from case ${ref?.seedKey || '?'}`} — status read from the root-cause case`, when, who);
  if (dated.commit !== false) store.commit('preventionPlans.action');
  return row;
}

export function markActionDone(id, actionId, { note = '' } = {}, dated = {}) {
  const row = get(id);
  const a = (row?.actions || []).find((x) => x.id === actionId);
  if (!row || !a) return { error: 'No such action' };
  if (a.kind === 'f2Action') return { error: 'An adopted action is marked done on its root-cause case' };
  if (actionDone(a)) return { error: 'Already done' };
  const { when, who } = stamp(dated);
  Object.assign(a, { status: 'Done', doneAt: when, doneBy: who, doneNote: String(note || '').trim() });
  touch(row, when);
  log(row, 'Action done', `${a.id} · ${a.text}${a.doneNote ? ` — ${a.doneNote}` : ''}${(a.evidence || []).length ? '' : ' (no evidence attached)'}`, when, who);
  if (dated.commit !== false) store.commit('preventionPlans.action');
  return row;
}
export function reopenAction(id, actionId, reason = '', dated = {}) {
  const row = get(id);
  const a = (row?.actions || []).find((x) => x.id === actionId);
  if (!row || !a) return { error: 'No such action' };
  if (a.kind === 'f2Action') return { error: 'An adopted action is reopened on its root-cause case' };
  if (!actionDone(a)) return { error: 'Not done yet' };
  if (!String(reason || '').trim()) return { error: 'Say why it is being reopened' };
  const { when, who } = stamp(dated);
  Object.assign(a, { status: 'Open', doneAt: null, doneBy: null, doneNote: '' });
  touch(row, when);
  log(row, 'Action reopened', `${a.id} · ${String(reason).trim()}`, when, who);
  if (dated.commit !== false) store.commit('preventionPlans.action');
  return row;
}

/** Evidence on an action or on the plan: a note, or a file by name and size — never the file itself. */
export function addEvidence(id, actionId, { kind = 'note', fileName = '', size = 0, text = '' } = {}, dated = {}) {
  const row = get(id);
  if (!row) return { error: 'No such plan' };
  const a = actionId ? (row.actions || []).find((x) => x.id === actionId) : null;
  if (actionId && !a) return { error: 'No such action' };
  if (kind === 'file' ? !String(fileName || '').trim() : !String(text || '').trim()) return { error: kind === 'file' ? 'Pick a file' : 'Write the note' };
  const { when, who } = stamp(dated);
  const list = a ? a.evidence : row.planEvidence;
  const e = { id: `E${list.length + 1}`, kind, fileName: kind === 'file' ? String(fileName).trim() : '', size: kind === 'file' ? Number(size) || 0 : 0, text: String(text || '').trim(), at: when, by: who };
  list.push(e);
  touch(row, when);
  log(row, 'Evidence added', `${a ? `${a.id} · ` : ''}${kind === 'file' ? e.fileName : e.text}`, when, who);
  if (dated.commit !== false) store.commit('preventionPlans.evidence');
  return row;
}

/** activate(id, { baseline }) → the plan Active with its baseline frozen — computed from the register unless one is handed in. */
export function activate(id, { baseline = null } = {}, dated = {}) {
  const row = get(id);
  const blockers = activateBlockers(row);
  if (blockers.length) return { error: blockers.join(' ') };
  const { when, who } = stamp(dated);
  const on = when.slice(0, 10);
  row.baseline = baseline ? { ...engine.baselineOf([], on, row.measurement.windowDays), ...baseline, note: baseline.note || 'Frozen at activation' } : { ...engine.baselineOf(targetFacts(row), on, row.measurement.windowDays), note: 'Frozen at activation from the register' };
  row.status = 'Active';
  row.activatedAt = when;
  touch(row, when);
  log(row, 'Activated', `Baseline frozen — ${row.baseline.count} denial${row.baseline.count === 1 ? '' : 's'}, ${money(row.baseline.value)} in the ${row.baseline.windowDays} days to ${on}`, when, who);
  if (dated.commit !== false) store.commit('preventionPlans.status');
  return row;
}

export function startMeasurement(id, dated = {}) {
  const row = get(id);
  const blockers = measurementBlockers(row);
  if (blockers.length) return { error: blockers.join(' ') };
  const { when, who } = stamp(dated);
  const w = engine.windowOf(when, row.measurement.windowDays);
  Object.assign(row.measurement, { startedAt: when.slice(0, 10), endsAt: w.to, result: null });
  row.status = 'InMeasurement';
  touch(row, when);
  log(row, 'Measurement started', `${w.days} days, to ${w.to}`, when, who);
  if (dated.commit !== false) store.commit('preventionPlans.status');
  measure(id, { on: when.slice(0, 10), commit: dated.commit !== false });
  return row;
}

/** measure(id, { on }) → the result as it stands: what the targets drew since measurement started, against the baseline. */
export function measure(id, { on = todayIso(), commit = true } = {}) {
  const row = get(id);
  if (!row?.measurement?.startedAt || !row.baseline) return null;
  const w = windowOf(row);
  const result = engine.measure({ baseline: row.baseline, facts: targetFacts(row), from: w.from, to: w.to, on, effectiveBelowPct: effectiveBelowPct() });
  const before = JSON.stringify(row.measurement.result);
  row.measurement.result = result;
  if (before !== JSON.stringify(result)) { row.updatedAt = new Date().toISOString(); if (commit) store.commit('preventionPlans.measure'); }
  return result;
}

/** close(id, { decision: { kind: 'reopen' | 'escalate', note } }) → the plan closed on the verdict; an ineffective one needs the decision. */
export function close(id, { decision = null } = {}, dated = {}) {
  const row = get(id);
  const blockers = closeBlockers(row, (dated.at || todayIso()).slice(0, 10));
  if (blockers.length) return { error: blockers.join(' ') };
  const { when, who } = stamp(dated);
  const result = measure(id, { on: when.slice(0, 10), commit: false });
  if (!result) return { error: 'Nothing measured' };
  if (result.verdict === 'Ineffective' && !['reopen', 'escalate'].includes(decision?.kind)) return { error: 'An ineffective plan is reopened or escalated — say which' };
  row.status = result.verdict === 'Effective' ? 'ClosedEffective' : result.verdict === 'Partial' ? 'ClosedPartial' : 'ClosedIneffective';
  Object.assign(row.measurement, { closedAt: when, closedBy: who, verdict: result.verdict, decision: null });
  touch(row, when);
  log(row, 'Closed', `${result.verdict} — ${result.count} denial${result.count === 1 ? '' : 's'}, ${money(result.value)} against ${row.baseline.count} / ${money(row.baseline.value)} (${result.deltaPct > 0 ? '+' : ''}${result.deltaPct}%) · prevented ${money(result.prevented.value)} (${engine.ESTIMATE_LABEL})`, when, who);
  if (result.verdict === 'Ineffective') {
    const d = { kind: decision.kind, note: String(decision.note || '').trim(), ref: null, at: when, by: who };
    if (decision.kind === 'reopen') {
      const next = create({ title: `${row.title} (reopened)`, description: row.description, targets: row.targets, ownerId: row.ownerId, sponsorId: row.sponsorId, predecessorId: row.id }, { at: when, by: who, commit: false });
      if (next?.id) {
        for (const a of row.actions || []) if (a.kind !== 'f2Action') addAction(next.id, { kind: a.kind, text: a.text, type: a.type, targetRef: a.targetRef, riskRuleRef: a.riskRuleRef, ownerId: a.ownerId, dueDate: a.dueDate }, { at: when, by: who, commit: false });
        row.successorId = next.id;
        d.ref = next.id;
      }
    } else {
      const ids = [...new Set([...(result.denialIds || []), ...(row.baseline.denialIds || [])])].filter((x) => denials.get(x));
      const made = peers.rca?.create ? peers.rca.create({ trigger: 'manual', denialIds: ids, detail: `Prevention plan ${row.id} closed ineffective — ${row.title}${d.note ? ` — ${d.note}` : ''}`, analystId: null }, { at: when, by: who, commit: false }) : null;
      d.ref = made?.id || null;
      if (!made?.id) d.note = `${d.note ? `${d.note} — ` : ''}${made?.error || 'root-cause register not on disk; escalation recorded on the plan'}`;
    }
    row.measurement.decision = d;
    log(row, decision.kind === 'reopen' ? 'Reopened' : 'Escalated', `${d.ref || 'recorded on the plan'}${d.note ? ` — ${d.note}` : ''}`, when, who);
  }
  if (dated.commit !== false) store.commit('preventionPlans.status');
  return row;
}

export function cancel(id, reason = '', dated = {}) {
  const row = get(id);
  if (!row) return { error: 'No such plan' };
  if (!isOpen(row)) return { error: `A ${statusLabel(row.status).toLowerCase()} plan is not cancelled` };
  if (!String(reason || '').trim()) return { error: 'Say why' };
  const { when, who } = stamp(dated);
  row.cancelled = { reason: String(reason).trim(), at: when, by: who };
  row.status = 'Cancelled';
  touch(row, when);
  log(row, 'Cancelled', row.cancelled.reason, when, who);
  if (dated.commit !== false) store.commit('preventionPlans.status');
  return row;
}

/** Every plan in measurement re-measured — on load, and whenever a denial moves. */
export function sweep(on = todayIso()) {
  let moved = 0;
  for (const p of store.table(TABLE)) {
    if (p.status !== 'InMeasurement') continue;
    const before = JSON.stringify(p.measurement.result);
    measure(p.id, { on, commit: false });
    if (before !== JSON.stringify(p.measurement.result)) moved += 1;
  }
  if (moved) store.commit('preventionPlans.measure');
  return moved;
}

const money = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function log(row, action, details, at = null, by = null) {
  audit.all().push({ id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: row.id, action, details, user: by || currentRole().name, at: at || new Date().toISOString() });
}

// --- seed -----------------------------------------------------------------------------------

let seeded = false;
let building = false;
const gate = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
let seedGate = gate();
/** Resolves once the seed has run — renewed on a reset. */
export const whenSeeded = () => seedGate.promise;
export const seedReady = seedGate.promise;
/** Behind the pattern register's seed (the patterns a plan targets have to exist) and again after a reset. */
async function ensureSeeded() {
  if (seeded || building) return;
  building = true;
  try {
    denialPatterns.all();
    await denialPatterns.whenSeeded();
    await peersReady;
    if (!store.table(TABLE).some((p) => p.seedTag === 'A40')) store.batch(() => buildPlans(seedApi));
    seeded = true;
    sweep();
    store.commit('preventionPlans.seed');
  } finally {
    building = false;
    seedGate.resolve();
  }
}
store.subscribe((reason) => {
  if (reason === 'reset') { ready = false; seeded = false; seedGate = gate(); return; }
  if (reason.startsWith('preventionPlans.')) return;
  if (ready && seeded && (reason.startsWith('denials.') || reason === 'denialPatterns.recompute')) queueMicrotask(() => sweep());
});

const seedApi = {
  today: todayIso(),
  patternId: (dims) => denialPatterns.idFor(dims),
  get, create, addAction, adoptF2Action, markActionDone, addEvidence, activate, startMeasurement, close, log,
};
