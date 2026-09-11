// Repository — root-cause cases (amendment 37, Defensio F2). Owner:
// modules/defensio. Over the file cap on purpose: one entity, one file — the
// case, its analysis, the person it names, the gates it concludes and closes
// through, the triggers that open one and the seed that drives all of it are
// one set of rules.
//
// A case is opened over a set of denials by a trigger — a denial worth the
// amount threshold, the same cause repeating inside the window, an appeal the
// hospital lost (data/engines/rca-triggers.js decides, this file writes) —
// or by hand. An analyst works it: the problem, the whys, the cause they
// confirm, whether it was the system, a person or the payer, and whether a
// configuration somewhere let it happen. Concluding it is gated on all of
// that (and on a person named with evidence when it was a person, and on at
// least one corrective action), retags every covered denial's F1 root cause
// to the confirmed one — audited old → new on both records — and opens the
// accountability case when a person was named. Closing it waits for every
// action to be Verified and the accountability decision to be recorded.
//
// Evidence is never written here: an evidence ref names an audit row another
// register wrote, by id and by (entity, entityId, action, at) for the day a
// reset deals the ids again. The appeal-tracking register (amendment 39) is
// reached by dynamic import and feature-detected; the two peer registers this
// file writes to never read it back.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as denials from './denials.js';
import * as encounters from './encounters.js';
import * as correctiveActions from './corrective-actions.js';
import * as accountabilityCases from './accountability-cases.js';
import * as triggers from '../engines/rca-triggers.js';
import { buildRcaCases } from '../seed/rca-cases.js';
import { buildActions, settleActions } from '../seed/corrective-actions.js';
import { buildAccountability } from '../seed/accountability-cases.js';
import { staff, staffByName, staffName } from '../seed/staff.js';
import { current as currentRole } from '../../shared/roles.js';
import { CONFIG } from '../../shared/config.js';
import { compareDates, todayIso, usd } from '../../shared/format.js';

const TABLE = 'rcaCases';
const ENTITY = 'rcaCases';

export const STATUSES = ['Open', 'InAnalysis', 'Concluded', 'Closed'];
export const STATUS_LABELS = { Open: 'Open', InAnalysis: 'In analysis', Concluded: 'Concluded', Closed: 'Closed' };
export const statusLabel = (s) => STATUS_LABELS[s] || s || '—';
export const OPEN_STATUSES = ['Open', 'InAnalysis'];
export const NATURES = ['systemic', 'individual', 'payerSide'];
export const NATURE_LABELS = { systemic: 'Systemic', individual: 'Individual', payerSide: 'Payer-side' };
export const natureLabel = (n) => NATURE_LABELS[n] || n || '—';
export const { TRIGGERS, TRIGGER_LABELS, triggerLabel } = triggers;

const config = () => CONFIG.defensio?.rca || {};
export const targetDays = () => Number(config().targetDays) || 14;

export function statusTone(status) {
  if (status === 'Closed') return 'success';
  if (status === 'Concluded') return 'info';
  if (status === 'InAnalysis') return 'accent';
  return 'warning';
}

// --- peers ------------------------------------------------------------------------------------

const peers = { appealTracking: null };
export const peerStatus = () => ({ appealTracking: Boolean(peers.appealTracking) });
/** Settled once the appeal-tracking register has been tried — absent until amendment 39 lands. */
export const peersReady = import('./appeal-tracking.js')
  .then((m) => { peers.appealTracking = m; })
  .catch(() => { peers.appealTracking = null; });

/** What the appeal register publishes, or nothing when it is not on disk. */
export function lostAppeals() {
  const fn = peers.appealTracking?.getLostAppeals;
  if (typeof fn !== 'function') return [];
  try { return fn() || []; } catch (err) { console.warn('[rca] getLostAppeals threw', err); return []; }
}

// --- reads ------------------------------------------------------------------------------------

let ready = false;
let seeding = false;
let scheduled = false;
export function all() {
  const rows = store.table(TABLE);
  if (!ready && !seeding && !scheduled) { scheduled = true; schedule(); }
  return rows;
}
// The denials the seed waits for arrive on a later commit after a reset; a
// new denial, or an appeal that ends, is what the triggers read. Both run
// once the burst of commits a seed or a posting makes has ended — a peer
// register's seed writes a denial, then the appeal it lost, and reading the
// two apart would case the denial once as a repeat and never as a lost
// appeal.
let pending = null;
store.subscribe((reason) => {
  if (reason === 'reset') { ready = false; seeding = false; scheduled = false; return; }
  if (!ready || seeding) return;
  if (!(reason.startsWith('denials.') || reason.startsWith('appeal'))) return;
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    if (!ready || seeding) return;
    ensureSeeded();
    evaluateTriggers();
  }, 0);
});

export const get = (id) => all().find((c) => c.id === id) || null;
export const history = (id) => audit.forEntity(ENTITY, id);

/** Every case covering a denial, newest first. */
export const casesFor = (denialId) => all().filter((c) => (c.denialIds || []).includes(denialId)).sort((a, b) => byAt(b, a));
/** The newest case covering a denial, or null — what the denial page's chip and the worklist's filter read. */
export const caseFor = (denialId) => casesFor(denialId)[0] || null;
export const hasCase = (denialId) => casesFor(denialId).length > 0;

export const isOpen = (row) => OPEN_STATUSES.includes(row?.status);
export const isConcluded = (row) => row?.status === 'Concluded' || row?.status === 'Closed';

/** The case's target: the day it is due and whether that has passed — read on every call, never stored. */
export const target = (row, on = todayIso()) => triggers.targetOf(row?.openedAt, row?.targetDays ?? targetDays(), on);
export const isOverdue = (row, on = todayIso()) => isOpen(row) && target(row, on).passed;

export const denialsOf = (row) => (row?.denialIds || []).map((id) => denials.get(id)).filter(Boolean);
export const deniedTotal = (row) => cents(denialsOf(row).reduce((n, d) => n + (d.amounts?.denied || 0), 0));
export const openTotal = (row) => cents(denialsOf(row).reduce((n, d) => n + (d.amounts?.open || 0), 0));

/** The cause a case reads for: the confirmed one once there is one, else the tags on its denials (the first). */
export const causeOf = (row) => row?.analysis?.confirmedRootCause || denialsOf(row).map((d) => d.rootCauseId).find(Boolean) || null;

export const analystName = (row) => (row?.analystId ? staffName(row.analystId) : '');

/**
 * search(q, { status, trigger, nature, analyst ('me' | staff id), overdue,
 * payerId, rootCauseId, from, to }) → rows, open first (overdue first, then
 * oldest target), then concluded, then closed.
 */
export function search(q = '', f = {}) {
  const needle = String(q || '').trim().toLowerCase();
  const me = currentRole().id;
  return all()
    .filter((c) => {
      if (f.status && c.status !== f.status) return false;
      if (f.trigger && c.trigger !== f.trigger) return false;
      if (f.nature && (c.analysis?.causeNature || '') !== f.nature) return false;
      if (f.analyst && c.analystId !== (f.analyst === 'me' ? me : f.analyst)) return false;
      if (f.overdue && !isOverdue(c)) return false;
      if (f.open && !isOpen(c)) return false;
      if (f.payerId && !(c.payerIds || []).includes(f.payerId)) return false;
      if (f.rootCauseId && causeOf(c) !== f.rootCauseId) return false;
      if (f.from && compareDates(c.openedAt, f.from) < 0) return false;
      if (f.to && compareDates(c.openedAt, f.to) > 0) return false;
      if (f.concludedFrom && (!c.concludedAt || compareDates(c.concludedAt, f.concludedFrom) < 0)) return false;
      if (!needle) return true;
      return [c.id, c.detail, c.analysis?.problem, analystName(c), ...(c.denialIds || []), causeOf(c) && denials.rootCauseLabel(causeOf(c))]
        .some((v) => String(v || '').toLowerCase().includes(needle));
    })
    .sort(byRank);
}

export function counts(on = todayIso()) {
  const rows = all();
  const open = rows.filter(isOpen);
  const month = on.slice(0, 7);
  return {
    total: rows.length,
    open: open.length,
    inAnalysis: rows.filter((c) => c.status === 'InAnalysis').length,
    unassigned: open.filter((c) => !c.analystId).length,
    overdue: open.filter((c) => isOverdue(c, on)).length,
    concluded: rows.filter((c) => c.status === 'Concluded').length,
    concludedMtd: rows.filter((c) => isConcluded(c) && String(c.concludedAt || '').slice(0, 7) === month).length,
    individual: rows.filter((c) => c.analysis?.causeNature === 'individual').length,
    accountabilityOpen: accountabilityCases.all().filter(accountabilityCases.isOpen).length,
  };
}

/**
 * getConcludedRcaCases() → what amendment 40 (prevention) reads: every
 * concluded or closed case with its confirmed cause, its nature, the
 * configuration gap, the first corrective action raised (and all of them),
 * the denials it covers and the department the visit behind them was in.
 */
export function getConcludedRcaCases() {
  return all().filter(isConcluded).map((c) => {
    const actions = correctiveActions.byCase(c.id);
    const first = actions[0] || null;
    return {
      caseId: c.id,
      status: c.status,
      trigger: c.trigger,
      confirmedRootCause: c.analysis?.confirmedRootCause || null,
      causeNature: c.analysis?.causeNature || null,
      configGap: { present: Boolean(c.analysis?.configGap?.present), target: c.analysis?.configGap?.target || null, note: c.analysis?.configGap?.note || '' },
      correctiveAction: first ? { type: first.type, target: first.targetRef || null, status: first.status } : null,
      correctiveActions: actions.map((a) => ({ id: a.id, type: a.type, target: a.targetRef || null, status: a.status, action: a.action })),
      denialIds: [...(c.denialIds || [])],
      departmentId: c.departmentId || null,
      payerIds: [...(c.payerIds || [])],
      concludedAt: c.concludedAt || null,
    };
  });
}

/** Resolve an evidence ref back to the audit row it names — by id, else by what it said. */
export function resolveEvidence(ref) {
  if (!ref) return null;
  const rows = audit.all();
  return rows.find((a) => a.id === ref.auditId && a.entity === ref.entity)
    || rows.find((a) => a.entity === ref.entity && a.entityId === ref.entityId && a.action === ref.action && a.at === ref.at)
    || null;
}

/** An evidence ref from an audit row: what a causer is named on. */
export const evidenceRef = (row) => (row ? { auditId: row.id, entity: row.entity, entityId: row.entityId, action: row.action, at: row.at, user: row.user, label: String(row.details || '').slice(0, 140) } : null);

// --- writes -----------------------------------------------------------------------------------

/**
 * create({ trigger, denialIds, detail, analystId, clusterKey, triggerRef })
 * → the row or { error }. A manual case names a reason and at least one
 * denial; a set of denials already the whole of an open case is refused,
 * since that case is where the work is.
 */
export function create(data = {}, { at = null, by = null, commit = true } = {}) {
  const ids = [...new Set((data.denialIds || []).filter(Boolean))];
  if (!ids.length) return { error: 'Pick at least one denial' };
  const missing = ids.filter((id) => !denials.get(id));
  if (missing.length) return { error: `Not on the register: ${missing.join(', ')}` };
  const trigger = triggers.TRIGGERS.includes(data.trigger) ? data.trigger : 'manual';
  const detail = String(data.detail || '').trim();
  if (trigger === 'manual' && !detail) return { error: 'Say why the case is being opened' };
  const same = all().find((c) => isOpen(c) && c.denialIds.length === ids.length && ids.every((id) => c.denialIds.includes(id)));
  if (same) return { error: `${same.id} is already open over exactly these denials` };
  if (data.analystId && !staff(data.analystId)) return { error: 'Pick an analyst from the staff list' };
  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  const rows = denialsOf({ denialIds: ids });
  const row = {
    id: store.nextId(TABLE, 'RCA-'),
    trigger,
    triggerRef: data.triggerRef || null,
    clusterKey: data.clusterKey || null,
    detail: detail || defaultDetail(trigger, rows),
    denialIds: ids,
    payerIds: [...new Set(rows.map((d) => d.payerId).filter(Boolean))],
    departmentId: departmentOf(rows),
    status: 'Open',
    analystId: data.analystId || null,
    targetDays: targetDays(),
    analysis: { problem: '', whys: [], confirmedRootCause: '', causeNature: '', configGap: { present: false, target: '', note: '' } },
    causer: null,
    retags: [],
    accountabilityCaseId: null,
    seedKey: data.seedKey || null,
    openedAt: when,
    openedBy: who,
    concludedAt: null,
    concludedBy: null,
    closedAt: null,
    closedBy: null,
    closeNote: '',
    updatedAt: when,
  };
  all().push(row);
  log(row, trigger === 'manual' ? 'Opened' : 'Opened by trigger', `${triggerLabel(trigger)} · ${ids.join(', ')} · ${usd(deniedTotal(row))} denied${row.analystId ? ` · analyst ${staffName(row.analystId)}` : ''} — ${row.detail}`, when, who);
  if (commit && !seeding) store.commit('rcaCases.create');
  return row;
}

export function assign(id, analystId, { at = null, by = null } = {}) {
  const row = get(id);
  if (!row) return { error: 'No such case' };
  if (isConcluded(row)) return { error: `A ${statusLabel(row.status).toLowerCase()} case is not reassigned` };
  const who = analystId === 'me' ? currentRole().id : analystId || null;
  if (who && !staff(who)) return { error: 'Pick an analyst from the staff list' };
  if (row.analystId === who) return row;
  const was = row.analystId;
  row.analystId = who;
  touch(row, at);
  log(row, who ? 'Assigned' : 'Unassigned', who ? `${staffName(who)}${was ? ` (was ${staffName(was)})` : ''}` : `Was ${staffName(was)}`, at, by);
  if (!seeding) store.commit('rcaCases.assign');
  return row;
}

/** Denials added to an open case — by the trigger engine extending a cluster, or by hand. */
export function addDenials(id, denialIds = [], { source = null, at = null, by = null } = {}) {
  const row = get(id);
  if (!row) return { error: 'No such case' };
  if (isConcluded(row)) return { error: `A ${statusLabel(row.status).toLowerCase()} case takes no more denials` };
  const fresh = [...new Set(denialIds)].filter((d) => denials.get(d) && !row.denialIds.includes(d));
  if (!fresh.length) return row;
  row.denialIds = [...row.denialIds, ...fresh];
  const rows = denialsOf(row);
  row.payerIds = [...new Set(rows.map((d) => d.payerId).filter(Boolean))];
  row.departmentId = row.departmentId || departmentOf(rows);
  touch(row, at);
  log(row, 'Denials added', `${fresh.join(', ')}${source ? ` — ${source}` : ''}`, at, by);
  if (!seeding) store.commit('rcaCases.denials');
  return row;
}

/**
 * saveAnalysis(id, { problem, whys, confirmedRootCause, causeNature,
 * configGap }) → the row or { error }. A draft may be partial — the gate is
 * conclude() — but a cause named has to be on the list and a nature one of
 * the three. The first save moves Open → InAnalysis and makes the saver the
 * analyst when nobody was.
 */
export function saveAnalysis(id, patch = {}, { at = null, by = null } = {}) {
  const row = get(id);
  if (!row) return { error: 'No such case' };
  if (isConcluded(row)) return { error: `A ${statusLabel(row.status).toLowerCase()} case is not re-analysed` };
  const next = {
    problem: String(patch.problem ?? row.analysis.problem ?? '').trim(),
    whys: (patch.whys ?? row.analysis.whys ?? []).map((w) => ({ why: String(w?.why || '').trim(), because: String(w?.because || '').trim() })).filter((w) => w.why || w.because),
    confirmedRootCause: String(patch.confirmedRootCause ?? row.analysis.confirmedRootCause ?? ''),
    causeNature: String(patch.causeNature ?? row.analysis.causeNature ?? ''),
    configGap: {
      present: Boolean(patch.configGap?.present ?? row.analysis.configGap?.present),
      target: String(patch.configGap?.target ?? row.analysis.configGap?.target ?? '').trim(),
      note: String(patch.configGap?.note ?? row.analysis.configGap?.note ?? '').trim(),
    },
  };
  if (next.confirmedRootCause && !denials.rootCause(next.confirmedRootCause)) return { error: 'The confirmed cause is not on the root-cause list' };
  if (next.causeNature && !NATURES.includes(next.causeNature)) return { error: 'The nature is systemic, individual or payer-side' };
  const changes = [];
  if (next.problem !== row.analysis.problem) changes.push('problem');
  if (JSON.stringify(next.whys) !== JSON.stringify(row.analysis.whys)) changes.push(`${next.whys.length} why${next.whys.length === 1 ? '' : 's'}`);
  if (next.confirmedRootCause !== row.analysis.confirmedRootCause) changes.push(`cause ${row.analysis.confirmedRootCause ? denials.rootCauseLabel(row.analysis.confirmedRootCause) : '—'} → ${next.confirmedRootCause ? denials.rootCauseLabel(next.confirmedRootCause) : '—'}`);
  if (next.causeNature !== row.analysis.causeNature) changes.push(`nature ${natureLabel(row.analysis.causeNature) || '—'} → ${natureLabel(next.causeNature) || '—'}`);
  if (JSON.stringify(next.configGap) !== JSON.stringify(row.analysis.configGap)) changes.push(next.configGap.present ? `configuration gap: ${next.configGap.target || 'unnamed'}` : 'no configuration gap');
  const started = row.status === 'Open';
  if (!changes.length && !started) return row;
  row.analysis = next;
  // A causer named on a case that is no longer about a person is dropped with the nature.
  if (next.causeNature !== 'individual' && row.causer) { row.causer = null; changes.push('causer cleared'); }
  if (started) { row.status = 'InAnalysis'; if (!row.analystId) row.analystId = staffByName(by || currentRole().name)?.id || currentRole().id; }
  touch(row, at);
  log(row, started ? 'Analysis started' : 'Analysis saved', changes.join('; ') || 'first save', at, by);
  if (!seeding) store.commit('rcaCases.analysis');
  return row;
}

/**
 * saveCauser(id, { personId, roleInFailure, evidenceRefs, analystNote }) →
 * the row or { error }. Only on a case whose nature is individual, and only
 * with evidence — at least one audit row the person's act is read on.
 */
export function saveCauser(id, { personId, roleInFailure = '', evidenceRefs = [], analystNote = '' } = {}, { at = null, by = null } = {}) {
  const row = get(id);
  if (!row) return { error: 'No such case' };
  if (isConcluded(row)) return { error: `A ${statusLabel(row.status).toLowerCase()} case does not rename its causer` };
  if (row.analysis.causeNature !== 'individual') return { error: 'Name a person only on a case whose nature is individual' };
  if (!staff(personId)) return { error: 'Pick the person from the staff list' };
  const role = String(roleInFailure || '').trim();
  if (!role) return { error: 'Say what the person did — their role in the failure' };
  const refs = (evidenceRefs || []).filter((r) => r && r.entity && r.action);
  console.assert(refs.length >= 1, '[rca] a causer needs evidence', row.id);
  if (!refs.length) return { error: 'Link at least one trail entry as evidence — a person is never named without it' };
  const unresolved = refs.filter((r) => !resolveEvidence(r));
  if (unresolved.length) return { error: `${unresolved.length} evidence ref${unresolved.length === 1 ? '' : 's'} no longer resolve${unresolved.length === 1 ? 's' : ''} to a trail entry` };
  const was = row.causer;
  row.causer = { personId, roleInFailure: role, evidenceRefs: refs, analystNote: String(analystNote || '').trim(), namedAt: at || new Date().toISOString(), namedBy: by || currentRole().name };
  touch(row, at);
  log(row, was ? 'Causer updated' : 'Causer named', `${staffName(personId)} — ${role} · ${refs.length} evidence ref${refs.length === 1 ? '' : 's'}${was && was.personId !== personId ? ` (was ${staffName(was.personId)})` : ''}`, at, by);
  if (!seeding) store.commit('rcaCases.causer');
  return row;
}

export function clearCauser(id, { at = null, by = null } = {}) {
  const row = get(id);
  if (!row) return { error: 'No such case' };
  if (isConcluded(row)) return { error: `A ${statusLabel(row.status).toLowerCase()} case does not unname its causer` };
  if (!row.causer) return row;
  const was = row.causer;
  row.causer = null;
  touch(row, at);
  log(row, 'Causer cleared', `Was ${staffName(was.personId)} — ${was.roleInFailure}`, at, by);
  if (!seeding) store.commit('rcaCases.causer');
  return row;
}

/** What stops the case concluding now — the sentences, or [] when it can. */
export function concludeBlockers(row) {
  if (!row) return ['No such case'];
  if (isConcluded(row)) return [`Already ${statusLabel(row.status).toLowerCase()}`];
  const out = [];
  const a = row.analysis || {};
  if (!row.analystId) out.push('Assign an analyst.');
  if (!a.problem) out.push('State the problem.');
  const complete = (a.whys || []).filter((w) => w.why && w.because);
  if (complete.length < 2) out.push(`Work at least two whys through to a because (${complete.length} so far).`);
  if (!a.confirmedRootCause) out.push('Confirm the root cause.');
  if (!a.causeNature) out.push('Say whether the cause was systemic, individual or the payer’s.');
  if (a.configGap?.present && !a.configGap.target) out.push('Name where the configuration gap is.');
  if (a.causeNature === 'individual') {
    if (!row.causer?.personId) out.push('Name the person on the Causer tab.');
    else if (!(row.causer.evidenceRefs || []).length) out.push('Link evidence to the person named.');
  }
  if (!correctiveActions.byCase(row.id).length) out.push('Raise at least one corrective action.');
  return out;
}
export const concludeBlocker = (id) => concludeBlockers(get(id)).join(' ');

/**
 * conclude(id) → the row or { error }. Gated on the analysis; retags each
 * covered denial whose root cause differs from the confirmed one (audited
 * old → new on the denial and listed on the case), and opens the
 * accountability case when a person was named.
 */
export function conclude(id, { at = null, by = null } = {}) {
  const row = get(id);
  const blockers = concludeBlockers(row);
  if (blockers.length) return { error: blockers.join(' ') };
  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  const cause = row.analysis.confirmedRootCause;
  const retags = [];
  for (const d of denialsOf(row)) {
    const from = d.rootCauseId;
    if (from === cause) continue;
    const r = denials.retagRootCause(d.id, cause, { source: row.id, at: when, by: who });
    if (r && !r.error) retags.push({ denialId: d.id, from, to: cause });
  }
  // The retag list keeps what each denial said before the case spoke.
  row.retags = [...(row.retags || []), ...retags.map((t) => ({ ...t, at: when }))];
  row.status = 'Concluded';
  row.concludedAt = when;
  row.concludedBy = who;
  if (row.analysis.causeNature === 'individual' && row.causer?.personId) {
    const acc = accountabilityCases.open({
      rcaCaseId: row.id, personId: row.causer.personId, roleInFailure: row.causer.roleInFailure, analystId: row.analystId, evidenceRefs: row.causer.evidenceRefs,
    }, { at: when, by: who, commit: false });
    row.accountabilityCaseId = acc.id;
  }
  touch(row, when);
  log(row, 'Concluded', `${denials.rootCauseLabel(cause)} · ${natureLabel(row.analysis.causeNature)}${row.analysis.configGap?.present ? ` · configuration gap at ${row.analysis.configGap.target}` : ''}${
    retags.length ? ` · ${retags.length} denial${retags.length === 1 ? '' : 's'} retagged` : ''}${row.accountabilityCaseId ? ` · ${row.accountabilityCaseId} opened for ${staffName(row.causer.personId)}` : ''}`, when, who);
  if (!seeding) store.commit('rcaCases.conclude');
  return row;
}

/** What stops the case closing now — the sentences, or [] when it can. */
export function closeBlockers(row) {
  if (!row) return ['No such case'];
  if (row.status === 'Closed') return ['Already closed'];
  if (row.status !== 'Concluded') return ['Conclude the case first.'];
  const out = [];
  const actions = correctiveActions.byCase(row.id);
  const unverified = actions.filter((a) => a.status !== 'Verified');
  if (!actions.length) out.push('Raise at least one corrective action.');
  else if (unverified.length) out.push(`${unverified.length} corrective action${unverified.length === 1 ? ' is' : 's are'} not verified yet.`);
  if (row.analysis?.causeNature === 'individual') {
    const acc = accountabilityCases.byCase(row.id)[0];
    if (!acc) out.push('No accountability case was opened.');
    else if (!acc.decision?.type) out.push(`${acc.id}: no decision recorded yet.`);
    else if (acc.appeal?.text && !acc.appeal.outcome) out.push(`${acc.id}: the appeal is under review.`);
  }
  return out;
}
export const closeBlocker = (id) => closeBlockers(get(id)).join(' ');

export function close(id, { note = '' } = {}, { at = null, by = null } = {}) {
  const row = get(id);
  const blockers = closeBlockers(row);
  if (blockers.length) return { error: blockers.join(' ') };
  const when = at || new Date().toISOString();
  row.status = 'Closed';
  row.closedAt = when;
  row.closedBy = by || currentRole().name;
  row.closeNote = String(note || '').trim();
  touch(row, when);
  log(row, 'Closed', row.closeNote || `${correctiveActions.byCase(row.id).length} action${correctiveActions.byCase(row.id).length === 1 ? '' : 's'} verified`, when, by);
  if (!seeding) store.commit('rcaCases.close');
  return row;
}

// --- triggers ---------------------------------------------------------------------------------

/**
 * evaluateTriggers() → { created[], extended[] }. Runs the engine over the
 * register as it stands and writes what it decides: a case per denial worth
 * the threshold, one per repeat cluster (extended when it already has an
 * open case), one per lost appeal. Idempotent — a second run finds nothing.
 */
export function evaluateTriggers({ at = null } = {}) {
  const rows = denials.all().filter((d) => d.status !== 'Reversed');
  const cases = store.table(TABLE);
  const confirmed = new Map();
  for (const c of cases) if (isConcluded(c) && c.analysis?.confirmedRootCause) for (const id of c.denialIds) confirmed.set(id, c.analysis.confirmedRootCause);
  const plan = triggers.evaluate({
    denials: rows, cases, lostAppeals: lostAppeals(),
    causeOf: (d) => confirmed.get(d.id) || d.rootCauseId || null,
    originOf: (causeId) => denials.rootCause(causeId)?.group || '',
    labelOf: (causeId) => denials.rootCauseLabel(causeId),
    on: todayIso(), config: config().triggers,
  });
  const created = [];
  const extended = [];
  const when = at || new Date().toISOString();
  for (const p of plan.create) {
    const row = create({ trigger: p.trigger, denialIds: p.denialIds, detail: p.detail, clusterKey: p.trigger === 'repeat' ? p.key : null, triggerRef: p.triggerRef || null }, { at: when, by: 'System', commit: false });
    if (row && !row.error) created.push(row);
    else console.warn('[rca] trigger refused', p, row?.error);
  }
  for (const e of plan.extend) {
    const row = addDenials(e.caseId, e.denialIds, { source: `trigger — ${e.detail}`, at: when, by: 'System' });
    if (row && !row.error) extended.push(row);
  }
  if ((created.length || extended.length) && !seeding) store.commit('rcaCases.trigger');
  return { created, extended };
}

// --- seed -------------------------------------------------------------------------------------

let resolveSeedReady;
/** Resolves after the first seed pass — what a screen may await before asserting counts. */
export const seedReady = new Promise((resolve) => { resolveSeedReady = resolve; });

async function schedule() {
  denials.all(); // the denial register's deferred seed is scheduled from its first read
  await Promise.allSettled([denials.peersReady, denials.seedReady, peersReady]);
  ensureSeeded();
  ready = true;
  evaluateTriggers();
  resolveSeedReady();
}

/**
 * The seed: the six hand-written cases, their actions and their
 * accountability, each found on the registers by rule and skipped when it is
 * already on the table. One batch, one commit — a badge redrawn halfway would
 * read a case without its actions.
 */
function ensureSeeded() {
  if (seeding) return;
  seeding = true;
  try {
    store.batch(() => {
      const built = new Map();
      const before = store.table(TABLE).length;
      // The intents name people by staff id; the audit trail names them.
      const nameOf = (v) => staff(v)?.name || v || null;
      const named = (fn) => (a, b, opts = {}) => fn(a, b, { ...opts, by: nameOf(opts.by) });
      const api = {
        today: todayIso(),
        has: (key) => store.table(TABLE).find((c) => c.seedKey === key) || null,
        findDenials: (rule, used) => findDenials(rule, used),
        findEvidence: (denial, spec) => {
          const entityId = spec.self ? denial.id : spec.encounter ? denial.encounterNo : spec.entityId;
          if (!entityId) return null;
          const hits = audit.forEntity(spec.entity, entityId).filter((a) => a.action === spec.action);
          return evidenceRef(hits[hits.length - 1] || null);
        },
        targetFor: (denial, name) => {
          if (name === 'contract-preauth') { const claim = denials.claimOf(denial); return claim?.contractId ? `#/pactum/contracts/${claim.contractId}/preauth` : '#/pactum/contracts'; }
          return name;
        },
        create: (data, opts = {}) => create(data, { ...opts, by: nameOf(opts.by) }),
        assign: named(assign), saveAnalysis: named(saveAnalysis), saveCauser: named(saveCauser), close: named(close),
        conclude: (id, opts = {}) => conclude(id, { ...opts, by: nameOf(opts.by) }),
        actionsFor: (key, row, { at, by }) => {
          const first = denialsOf(row)[0];
          built.set(key, buildActions({ create: correctiveActions.create, targetFor: api.targetFor }, key, row, first, { at, by: nameOf(by) }));
        },
        accountabilityFor: (key, row, { at }) => buildAccountability({
          open: accountabilityCases.open, byCase: accountabilityCases.byCase, recordResponse: accountabilityCases.recordResponse,
          decide: accountabilityCases.decide, fileAppeal: accountabilityCases.fileAppeal, reviewAppeal: accountabilityCases.reviewAppeal,
          sendToHr: accountabilityCases.sendToHr, captureHrOutcome: accountabilityCases.captureHrOutcome, close: accountabilityCases.close,
          nameOf,
        }, key, row, { at }),
        verifyFor: (key, row, { at }) => settleActions({
          markDone: (id, note, opts) => correctiveActions.markDone(id, note, { ...opts, by: nameOf(opts.by) }),
          verify: (id, data, opts) => correctiveActions.verify(id, data, { ...opts, by: nameOf(opts.by) }),
        }, built.get(key) || [], { at }),
      };
      buildRcaCases(api);
      if (store.table(TABLE).length !== before) store.commit('rcaCases.seed');
    });
  } finally {
    seeding = false;
  }
}

/** The seed's rule for finding denials: cause, status, route, visit, size — oldest first, never one already used. */
function findDenials(rule = {}, used = new Set()) {
  const rows = denials.all()
    .filter((d) => d.status !== 'Reversed' && !used.has(d.id))
    .filter((d) => (!rule.rootCauseId || d.rootCauseId === rule.rootCauseId)
      && (!rule.status || d.status === rule.status)
      && (!rule.route || d.route?.kind === rule.route || (d.routeHistory || []).some((r) => r.kind === rule.route))
      && (!rule.payerId || d.payerId === rule.payerId)
      && (!rule.encounter || Boolean(d.encounterNo))
      && (!rule.minAmount || d.amounts.denied >= rule.minAmount))
    .sort((a, b) => byAtDenial(a, b));
  return rows.slice(0, rule.many || 1);
}

// --- internals --------------------------------------------------------------------------------

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;
const byAt = (a, b) => String(a.openedAt).localeCompare(String(b.openedAt)) || a.id.localeCompare(b.id);
const byAtDenial = (a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id);
const rank = (c) => (isOpen(c) ? (isOverdue(c) ? 0 : 1) : c.status === 'Concluded' ? 2 : 3);
const byRank = (a, b) => rank(a) - rank(b) || (isOpen(a) ? byAt(a, b) : byAt(b, a));

function departmentOf(rows) {
  for (const d of rows) {
    const claim = denials.claimOf(d);
    const enc = claim?.encounterNo ? encounters.get(claim.encounterNo) : null;
    if (enc?.department) return enc.department;
  }
  return null;
}

function defaultDetail(trigger, rows) {
  const total = cents(rows.reduce((n, d) => n + (d.amounts?.denied || 0), 0));
  if (trigger === 'amount') return `${rows.map((d) => d.id).join(', ')} denied ${usd(total)} — at or above the ${usd(config().triggers?.amountThreshold ?? 500)} threshold`;
  if (trigger === 'repeat') return `${rows.length} denials on one cause inside the window`;
  if (trigger === 'appealLost') return 'An appeal the hospital lost';
  return `${rows.length} denial${rows.length === 1 ? '' : 's'} · ${usd(total)}`;
}

function touch(row, at = null) { row.updatedAt = at || new Date().toISOString(); }

function log(row, action, details, at, by) {
  audit.all().push({
    id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: row.id, action, details,
    user: by || currentRole().name, at: at || new Date().toISOString(),
  });
}
