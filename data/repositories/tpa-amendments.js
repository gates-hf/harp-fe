// Repository — TPA fee amendments (amendment 42). Owner: modules/defensio.
// The only path to a past period: a fee schedule is append-only, so a
// period already accrued is restated by an amendment that names the
// administrator, the payer, the closed period and the reason, carries the
// restated version (retrospective, invisible until posting), computes its
// impact by running every accrual in the period through the matching
// engine against it, is signed at the write-off tiers by somebody other
// than the requester, and posts: the restatement becomes the version in
// force on its term, each changed accrual is frozen with its pre-amendment
// snapshot and reads Amended, the disputes holding those accruals are told,
// and the corrections are written as posting records. Claima publishes no
// creator that reposts a remittance at a different amount — only a full
// reversal — so a correction is kept here as a pending-integration record
// with a reconciliation line on the claim's own trail, and the Requests
// section of modules/claima/COORDINATION.md names the creator that takes
// them. A posted amendment is frozen: nothing on it is edited again.
//
// data/engines/tpa-amendment.js decides the impact, the tier and who may
// sign; this file resolves the accruals and does the writing. Seeded behind
// the dispute register's seed from data/seed/tpa-amendments.js and again
// after a reset. Audit entity `tpaAmendments`, keyed on the amendment id.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as claims from './claims.js';
import * as tpas from './tpas.js';
import * as schedules from './tpa-fee-schedules.js';
import * as accruals from './tpa-fee-accruals.js';
import * as disputes from './tpa-disputes.js';
import * as engine from '../engines/tpa-amendment.js';
import { current as currentRole } from '../../shared/roles.js';
import { iso, todayIso, usd, withinDates } from '../../shared/format.js';
import { buildTpaAmendments } from '../seed/tpa-amendments.js';

const TABLE = 'tpaAmendments';
const ENTITY = 'tpaAmendments';

export const { STATUSES, OPEN_STATUSES, REASONS, reason, reasonLabel, tierFor, tierLabel, tierDef, canApprove, statusLabel, statusTone } = engine;
export const STEPS = [
  { id: 'header', label: 'Header' },
  { id: 'impact', label: 'Computed impact' },
  { id: 'review', label: 'Tiered review' },
  { id: 'post', label: 'Post' },
];

// --- peers -------------------------------------------------------------------------------

let settled = false;
let seeding = false;
let resolveSeedReady;
export const seedReady = new Promise((resolve) => { resolveSeedReady = resolve; });
export const peersReady = disputes.peersReady.then(() => disputes.seedReady).then(() => { settled = true; ensureSeeded(); });

// --- reads -------------------------------------------------------------------------------

export const all = () => store.table(TABLE);
export const get = (id) => all().find((a) => a.id === id) || null;
export const byTpa = (tpaId) => all().filter((a) => a.tpaId === tpaId);
export const history = (id) => audit.forEntity(ENTITY, id);
export const isFrozen = (row) => row?.status === 'Posted' || row?.status === 'Rejected';
export const isEditable = (row) => row?.status === 'Draft';
export const restatedVersion = (row) => (row?.restatedVersionRef ? schedules.versionByRef(row.restatedVersionRef) : null);
export const stepOf = (row) => ({ Draft: row?.impact?.length || row?.totals ? 1 : 0, InReview: 2, Approved: 3, Posted: 3, Rejected: 2 }[row?.status] ?? 0);

/** The accruals an amendment restates: the link's, with a remittance date inside the period. */
export const inPeriod = (row) => accruals.all().filter((a) => a.tpaId === row.tpaId && a.payerId === row.payerId && withinDates(a.remittanceDate, row.period?.from, row.period?.to));

export function search(q = '', f = {}) {
  const needle = String(q || '').trim().toLowerCase();
  return all().filter((a) => {
    if (needle && ![a.id, tpas.nameOf(a.tpaId), a.restatedVersionRef, a.reason?.text, a.approval?.requestedBy].some((s) => String(s || '').toLowerCase().includes(needle))) return false;
    if (f.tpaId && a.tpaId !== f.tpaId) return false;
    if (f.status && a.status !== f.status) return false;
    return true;
  }).sort((x, y) => (OPEN_STATUSES.includes(y.status) ? 1 : 0) - (OPEN_STATUSES.includes(x.status) ? 1 : 0) || String(y.createdAt).localeCompare(String(x.createdAt)));
}

export function counts() {
  const rows = all();
  return {
    total: rows.length, open: rows.filter((a) => OPEN_STATUSES.includes(a.status)).length, inReview: rows.filter((a) => a.status === 'InReview').length,
    posted: rows.filter((a) => a.status === 'Posted').length, pendingIntegration: rows.reduce((n, a) => n + (a.postingRefs || []).filter((p) => p.kind === 'PendingIntegration').length, 0),
    corrections: Math.round(rows.filter((a) => a.status === 'Posted').reduce((n, a) => n + (a.totals?.correction || 0), 0) * 100) / 100,
  };
}

/** The versions of a link that touch a period — what the header step offers to restate. */
export function restatableVersions(tpaId, payerId, period = {}) {
  const s = schedules.forLink(tpaId, payerId);
  if (!s) return [];
  return s.versions.filter((v) => !v.retrospective && !(period.from && v.effectiveTo && iso(v.effectiveTo) < iso(period.from)) && !(period.to && iso(v.effectiveFrom) > iso(period.to)));
}

// --- writes ------------------------------------------------------------------------------

/**
 * draft({ tpaId, payerId, period, reason, supersedesRef, restatement, documentRef,
 * existingRef }) → the Draft or { error }. Writes the retrospective version
 * onto the schedule (unposted) — or adopts an existing unposted one — and
 * computes the impact at once.
 */
export function draft(h = {}, { at = null, by = null, commit = true } = {}) {
  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  const existing = h.existingRef ? schedules.versionByRef(h.existingRef) : null;
  const header = { ...h, restatement: h.restatement || (existing ? { basis: existing.basis, rate: existing.rate, scopes: existing.scopes, capPerClaim: existing.capPerClaim, capPerPeriod: existing.capPerPeriod } : null) };
  const problems = engine.validateHeader(header, todayIso());
  if (!tpas.get(h.tpaId)) problems.push('No such administrator.');
  if (problems.length) return { error: problems.join(' ') };
  const schedule = schedules.ensureSchedule(h.tpaId, h.payerId, { at: when, by: who });
  const id = store.nextId(TABLE, 'TAM-');
  let version = existing && existing.retrospective && !existing.posted ? existing : null;
  if (!version) {
    const base = h.supersedesRef ? schedules.versionByRef(h.supersedesRef) : null;
    const made = schedules.restate(schedule.id, h.supersedesRef || null, {
      ...header.restatement, ...restatedTerm(base, h.period),
      note: `Restated by ${id} — ${engine.reasonLabel(h.reason.code)}`,
    }, { amendmentId: id, at: when, by: who, commit: false });
    if (made?.error) return { error: made.error };
    version = made;
  } else if (!version.amendmentId) version.amendmentId = id;
  const row = {
    id, tpaId: h.tpaId, payerId: h.payerId, scheduleId: schedule.id,
    period: { from: iso(h.period.from), to: iso(h.period.to) },
    reason: { code: h.reason.code, text: String(h.reason.text || '').trim() },
    restatedVersionRef: version.ref, supersedesRef: h.supersedesRef || version.supersedesRef || null,
    restatement: { basis: version.basis, rate: version.rate, scopes: version.scopes, capPerClaim: version.capPerClaim, capPerPeriod: version.capPerPeriod },
    documentRef: h.documentRef?.fileName ? { fileName: h.documentRef.fileName, size: h.documentRef.size || 0 } : null,
    impact: [], totals: null,
    approval: null,
    status: 'Draft',
    postingRefs: [],
    postedAt: null, postedBy: null,
    createdAt: when, createdBy: who, updatedAt: when,
  };
  all().push(row);
  log(row, 'Drafted', `${tpas.nameOf(row.tpaId)} × ${payerName(row)} · ${row.period.from} to ${row.period.to} · ${engine.reasonLabel(row.reason.code)} · restates ${row.supersedesRef || 'an uncovered period'} as ${row.restatedVersionRef} (${schedules.describe(version)})`, when, who);
  computeImpact(row.id, { at: when, by: who, commit: false });
  if (commit) store.commit('tpaAmendments.draft');
  return row;
}

/** updateDraft(id, header) → the Draft or { error }: the restatement is replaced and the impact recomputed. */
export function updateDraft(id, h = {}, { at = null, by = null, commit = true } = {}) {
  const row = get(id);
  if (!row) return { error: 'No such amendment' };
  if (!isEditable(row)) return { error: `A ${statusLabel(row.status).toLowerCase()} amendment is not edited` };
  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  const header = { tpaId: row.tpaId, payerId: row.payerId, period: h.period || row.period, reason: h.reason || row.reason, restatement: h.restatement || row.restatement };
  const problems = engine.validateHeader(header, todayIso());
  if (problems.length) return { error: problems.join(' ') };
  const supersedesRef = h.supersedesRef === undefined ? row.supersedesRef : h.supersedesRef;
  const base = supersedesRef ? schedules.versionByRef(supersedesRef) : null;
  schedules.dropRestatement(row.restatedVersionRef, { at: when, by: who, commit: false });
  const made = schedules.restate(row.scheduleId, supersedesRef || null, {
    ...header.restatement, ...restatedTerm(base, header.period),
    note: `Restated by ${row.id} — ${engine.reasonLabel(header.reason.code)}`,
  }, { amendmentId: row.id, at: when, by: who, commit: false });
  if (made?.error) return { error: made.error };
  Object.assign(row, {
    period: { from: iso(header.period.from), to: iso(header.period.to) }, reason: { code: header.reason.code, text: String(header.reason.text || '').trim() },
    restatedVersionRef: made.ref, supersedesRef: supersedesRef || null,
    restatement: { basis: made.basis, rate: made.rate, scopes: made.scopes, capPerClaim: made.capPerClaim, capPerPeriod: made.capPerPeriod },
    documentRef: h.documentRef === undefined ? row.documentRef : h.documentRef?.fileName ? { fileName: h.documentRef.fileName, size: h.documentRef.size || 0 } : null,
    updatedAt: when,
  });
  log(row, 'Updated', `restates ${row.supersedesRef || 'an uncovered period'} as ${row.restatedVersionRef} (${schedules.describe(made)})`, when, who);
  computeImpact(row.id, { at: when, by: who, commit: false });
  if (commit) store.commit('tpaAmendments.update');
  return row;
}

/** computeImpact(id) → { rows, totals }: every in-period accrual against the restated version, stored on the amendment while it is open. */
export function computeImpact(id, { at = null, by = null, commit = true } = {}) {
  const row = get(id);
  if (!row) return { error: 'No such amendment' };
  if (isFrozen(row)) return { rows: row.impact, totals: row.totals };
  const version = restatedVersion(row);
  if (!version) return { error: 'The restated version is gone' };
  const list = inPeriod(row);
  const out = engine.impactOf(list, version, { basisOf: (a) => accruals.contextOf(a, accruals.all()) });
  row.impact = out.rows.map(({ match, ...rest }) => ({ ...rest, expected: match.expected }));
  row.totals = out.totals;
  row.updatedAt = at || new Date().toISOString();
  log(row, 'Impact computed', `${out.totals.accruals} accrual${out.totals.accruals === 1 ? '' : 's'}, ${out.totals.changed} moved · expected ${usd(out.totals.oldExpected)} → ${usd(out.totals.newExpected)} · correction ${usd(out.totals.correction)} · ${tierLabel(out.totals.tier)}`, row.updatedAt, by || currentRole().name);
  if (commit) store.commit('tpaAmendments.impact');
  return out;
}

export function submitForReview(id, { at = null, by = null, commit = true } = {}) {
  const row = get(id);
  if (!row) return { error: 'No such amendment' };
  if (row.status !== 'Draft') return { error: `A ${statusLabel(row.status).toLowerCase()} amendment is not sent for review` };
  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  computeImpact(id, { at: when, by: who, commit: false });
  if (!row.totals?.accruals) return { error: 'Nothing to restate — no accrual of this link falls inside the period.' };
  row.status = 'InReview';
  row.approval = { tier: tierFor(row.totals.correction), requestedBy: who, requestedAt: when, approvedBy: null, approvedAt: null, note: '', decision: null };
  row.updatedAt = when;
  log(row, 'Sent for review', `${tierLabel(row.approval.tier)} · correction ${usd(row.totals.correction)} over ${row.totals.changed} of ${row.totals.accruals}`, when, who);
  if (commit) store.commit('tpaAmendments.review');
  return row;
}

/** approve(id, { note }, { role }) → the row or { error }: a role at the tier, never the requester. */
export function approve(id, { note = '' } = {}, { role = currentRole(), at = null, by = null, commit = true } = {}) {
  const row = get(id);
  if (!row) return { error: 'No such amendment' };
  const gate = canApprove(row, role);
  if (!gate.ok) return { error: gate.why };
  const when = at || new Date().toISOString();
  const who = by || role.name;
  row.status = 'Approved';
  row.approval = { ...row.approval, approvedBy: who, approvedAt: when, note: String(note || '').trim(), decision: 'Approved' };
  row.updatedAt = when;
  log(row, 'Approved', `${tierLabel(row.approval.tier)} · ${who}${row.approval.note ? ` — ${row.approval.note}` : ''}`, when, who);
  if (commit) store.commit('tpaAmendments.approve');
  return row;
}

/** reject(id, { note }, { role }) → the row or { error }: the restatement is dropped with it. */
export function reject(id, { note = '' } = {}, { role = currentRole(), at = null, by = null, commit = true } = {}) {
  const row = get(id);
  if (!row) return { error: 'No such amendment' };
  const gate = canApprove(row, role);
  if (!gate.ok) return { error: gate.why };
  if (!String(note).trim()) return { error: 'A refusal needs a note — the requester reads it.' };
  const when = at || new Date().toISOString();
  const who = by || role.name;
  row.status = 'Rejected';
  row.approval = { ...row.approval, approvedBy: who, approvedAt: when, note: String(note).trim(), decision: 'Rejected' };
  row.updatedAt = when;
  schedules.dropRestatement(row.restatedVersionRef, { at: when, by: who, commit: false });
  log(row, 'Rejected', `${who} — ${row.approval.note}`, when, who);
  if (commit) store.commit('tpaAmendments.reject');
  return row;
}

/**
 * post(id) → the row or { error }. Approved only. The restatement becomes
 * the version in force, every changed accrual is restated with its
 * snapshot, the disputes holding them are told, a correction record is
 * written per changed accrual (pending integration — see the file header)
 * with a reconciliation line on the claim's trail, and the amendment
 * freezes.
 */
export function post(id, { at = null, by = null, commit = true } = {}) {
  const row = get(id);
  if (!row) return { error: 'No such amendment' };
  if (row.status !== 'Approved') return { error: `A ${statusLabel(row.status).toLowerCase()} amendment is not posted` };
  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  const version = restatedVersion(row);
  if (!version) return { error: 'The restated version is gone' };
  // The impact is recomputed as of now: an accrual that moved since the review is posted as it stands, and the trail says so.
  const fresh = engine.impactOf(inPeriod(row), version, { basisOf: (a) => accruals.contextOf(a, accruals.all()) });
  if (Math.abs((fresh.totals.correction || 0) - (row.totals?.correction || 0)) >= 0.005) log(row, 'Note', `Impact moved since review: correction ${usd(row.totals?.correction || 0)} → ${usd(fresh.totals.correction)}`, when, who);
  row.impact = fresh.rows.map(({ match, ...rest }) => ({ ...rest, expected: match.expected }));
  row.totals = fresh.totals;
  schedules.markPosted(version.ref, { amendmentId: row.id, at: when, by: who, commit: false });
  const changed = [];
  for (const r of fresh.rows) {
    accruals.applyAmendment(r.accrualId, { amendmentId: row.id, match: r.match, correction: r.correction }, { at: when, by: who });
    if (!r.changed) continue;
    changed.push(r.accrualId);
    if (r.correction === 0) continue;
    const ref = { id: `TPC-${String(row.postingRefs.length + 1).padStart(4, '0')}`, accrualId: r.accrualId, claimNo: r.claimNo, remittanceRef: accruals.get(r.accrualId)?.remittanceRef || null,
      amount: r.correction, direction: r.correction > 0 ? 'Reclaim from TPA' : 'Refund to TPA', kind: 'PendingIntegration', at: when, by: who };
    row.postingRefs.push(ref);
    const claim = claims.get(r.claimNo);
    if (claim) {
      audit.all().push({ id: store.nextId('audit', 'AU-'), entity: 'claims', entityId: claim.id, action: 'Reconciliation note',
        details: `${row.id} · ${r.accrualId} · TPA fee ${r.correction > 0 ? 'reclaim' : 'refund'} ${usd(Math.abs(r.correction))} — expected ${usd(r.oldExpected || 0)} → ${usd(r.newExpected || 0)} under ${version.ref}; posting pending integration (${ref.id})`, user: who, at: when });
    }
  }
  disputes.onAmendment(row.id, changed, { at: when, by: who });
  // Accruals after the period read the restatement too — it is the version in force on their dates now.
  accruals.matchAll({ commit: false });
  row.status = 'Posted';
  row.postedAt = when;
  row.postedBy = who;
  row.updatedAt = when;
  log(row, 'Posted', `${version.ref} in force · ${changed.length} accrual${changed.length === 1 ? '' : 's'} amended · ${row.postingRefs.length} correction${row.postingRefs.length === 1 ? '' : 's'} pending integration (${usd(row.totals.correction)})`, when, who);
  if (commit) store.commit('tpaAmendments.post');
  return row;
}

/** discard(id) → true: a Draft dropped, with its restatement. */
export function discard(id, { at = null, by = null } = {}) {
  const row = get(id);
  if (!row || row.status !== 'Draft') return false;
  const when = at || new Date().toISOString();
  schedules.dropRestatement(row.restatedVersionRef, { at: when, by, commit: false });
  const rows = all();
  rows.splice(rows.indexOf(row), 1);
  audit.all().push({ id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: row.id, action: 'Discarded', details: '', user: by || currentRole().name, at: when });
  store.commit('tpaAmendments.discard');
  return true;
}

export const payerName = (row) => tpas.linksOf(row?.tpaId).find((l) => l.payerId === row?.payerId)?.payer || row?.payerId || '—';

/**
 * The term a restatement runs on: from the period's start (never before
 * the version it restates began) to the end of that version — a rate
 * corrected from a date is corrected forward. The period names the closed
 * accruals the amendment itself posts corrections for; anything after is
 * matched afresh against the restatement, the way any accrual is. With no
 * version to restate, the restatement covers the period alone.
 */
function restatedTerm(base, period = {}) {
  if (!base) return { effectiveFrom: period.from, effectiveTo: period.to };
  const from = iso(period.from) > iso(base.effectiveFrom) ? iso(period.from) : iso(base.effectiveFrom);
  return { effectiveFrom: from, effectiveTo: base.effectiveTo || null };
}

// --- seed ---------------------------------------------------------------------------------

function ensureSeeded() {
  const rows = store.table(TABLE);
  if (!settled || seeding || rows.some((r) => r.seedTag === 'A42')) return;
  seeding = true;
  try {
    store.batch(() => {
      buildTpaAmendments({ amendments: { draft, submitForReview, approve, post } });
      store.commit('tpaAmendments.seed');
    });
  } finally {
    seeding = false;
  }
  accruals.selfCheck();
  resolveSeedReady();
}
store.subscribe((why) => { if (why === 'reset') setTimeout(() => disputes.seedReady.then(ensureSeeded), 0); });

function log(row, action, details, at, user) {
  audit.all().push({ id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: row.id, action, details, user, at });
}
