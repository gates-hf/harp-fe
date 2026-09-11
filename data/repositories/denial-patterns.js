// Repository — denial patterns (amendment 40, Defensio F5). Owner:
// modules/defensio. A pattern is the same payer, cause and service refused
// three times inside the rolling window; data/engines/pattern-engine.js
// decides, this file resolves the facts it reads (the denial register, the
// claim line behind each denial, the charge master, the root-cause cases
// that confirmed a cause, the appeals the hospital lost) and writes the
// records. Recomputed on the first read, on every commit that moves a
// denial, a plan, an appeal or a root-cause case, and again after the seed;
// a pattern's id is a stable hash of its dimensions, so a pass never creates
// a pattern twice and a record is never deleted — it fades and comes back.
//
// The cause a denial counts under is one id: the confirmed root cause of a
// concluded root-cause case covering it (A37, feature-detected), else the
// triage tag, else the cause the payer's own code usually comes down to
// (the router's starting point) — so an untriaged denial counts from the
// day it lands. A lost appeal on a denial in the pattern sharpens it: the
// payer's refusal stood, which is a reason for a plan rather than another
// appeal. Nothing here reads prevention-plans.js — the plan register pushes
// a resolver into `planResolvers` so a pattern can read Under plan without
// the two files importing each other.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as denials from './denials.js';
import * as claims from './claims.js';
import * as cdm from './cdm.js';
import * as payers from './payers.js';
import * as contracts from './contracts.js';
import * as engine from '../engines/pattern-engine.js';
import { ROOT_CAUSES, rootCause, rootCauseLabel, DEFAULT_ROOT_CAUSE, ROOT_CAUSE_BY_CODE, OWNERS, groupedRootCauses } from '../seed/root-causes.js';
import { reasonOf } from '../seed/denials.js';
import { buildPatterns } from '../seed/denial-patterns.js';
import { current as currentRole } from '../../shared/roles.js';
import { CONFIG } from '../../shared/config.js';
import { todayIso } from '../../shared/format.js';

const TABLE = 'denialPatterns';
const ENTITY = 'denialPatterns';

export const { STATUSES, STATUS_LABELS, ACTIVE_STATUSES, TRENDS, LEVELS, LEVEL_LABELS, matches, idFor, dimsKey } = engine;
export { ROOT_CAUSES, rootCause, rootCauseLabel, groupedRootCauses, OWNERS };
export const statusLabel = (s) => STATUS_LABELS[s] || s || '—';
export const statusTone = (s) => ({ New: 'critical', Reactivated: 'critical', Acknowledged: 'warning', UnderPlan: 'accent', Faded: '' }[s] || '');
export const TREND_LABELS = { accelerating: 'Accelerating', steady: 'Steady', slowing: 'Slowing' };
export const trendLabel = (t) => TREND_LABELS[t] || t || '—';
export const trendTone = (t) => ({ accelerating: 'critical', steady: 'warning', slowing: 'success' }[t] || '');
export const isActive = (row) => ACTIVE_STATUSES.includes(row?.status);

export const config = () => CONFIG.defensio?.prevention || {};
export const threshold = () => Number(config().threshold) || engine.DEFAULTS.threshold;
export const windowDays = () => Number(config().windowDays) || engine.DEFAULTS.windowDays;
export const noPlanFlagValue = () => Number(config().noPlanFlagValue) || 1000;

/** The root cause a payer's code usually comes down to — the cause an untriaged denial counts under. */
export const causeOfCode = (code) => ROOT_CAUSE_BY_CODE[code] || DEFAULT_ROOT_CAUSE[reasonOf(code)] || null;

/** prevention-plans.js pushes `() => ({ patterns: Set<patternId>, causes: Set<causeId> })` — what an active plan targets. */
export const planResolvers = [];
function planned() {
  const out = { patterns: new Set(), causes: new Set() };
  for (const fn of planResolvers) {
    try { const r = fn() || {}; for (const id of r.patterns || []) out.patterns.add(id); for (const id of r.causes || []) out.causes.add(id); } catch (err) { console.warn('[patterns] plan resolver threw', err); }
  }
  return out;
}

// --- peers ------------------------------------------------------------------------------

const peers = { rca: null, tracking: null };
export const peerStatus = () => ({ rca: Boolean(peers.rca), tracking: Boolean(peers.tracking) });
export const peersReady = Promise.allSettled([
  import('./rca-cases.js').then((m) => { peers.rca = m; }).catch(() => { peers.rca = null; }),
  import('./appeal-tracking.js').then((m) => { peers.tracking = m; }).catch(() => { peers.tracking = null; }),
]).then(() => { if (ready) arm(); });

function confirmedCauses() {
  const out = new Map();
  const fn = peers.rca?.getConcludedRcaCases;
  if (typeof fn !== 'function') return out;
  try { for (const c of fn() || []) if (c.confirmedRootCause) for (const id of c.denialIds || []) out.set(id, c.confirmedRootCause); } catch (err) { console.warn('[patterns] getConcludedRcaCases threw', err); }
  return out;
}
function lostAppealDenials() {
  const out = new Set();
  const fn = peers.tracking?.getLostAppeals;
  if (typeof fn !== 'function') return out;
  try { for (const a of fn() || []) for (const id of a.denialIds || []) out.add(id); } catch (err) { console.warn('[patterns] getLostAppeals threw', err); }
  return out;
}

// --- facts ------------------------------------------------------------------------------

let lastFacts = null;
function factOf(d, confirmed, lost) {
  const claim = denials.claimOf(d);
  const line = (d.lineId && claim ? claim.lines.find((l) => l.id === d.lineId) : null) || claim?.lines?.[0] || null;
  const item = line ? cdm.get(line.itemId) : null;
  const code = d.payerReason?.code || d.code || null;
  const causeId = confirmed.get(d.id) || d.rootCauseId || causeOfCode(code) || null;
  return {
    id: d.id, payerId: d.payerId, causeId, causeKind: confirmed.has(d.id) ? 'confirmed' : d.rootCauseId ? 'tagged' : 'code', code,
    origin: rootCause(causeId)?.group || null,
    item: item ? { id: item.id, chargeCode: item.chargeCode, name: item.descriptionEn || item.name || '', category: item.category, group: contracts.serviceGroupOf(item.category) } : null,
    landedAt: String(d.createdAt || '').slice(0, 10), denied: d.amounts?.denied || 0, recovered: d.amounts?.recovered || 0, open: d.amounts?.open || 0,
    resolved: denials.isResolved(d), lostAppeal: lost.has(d.id), status: d.status, claimNo: d.claimNo, encounterNo: d.encounterNo || null,
  };
}
function resolveFacts() {
  const confirmed = confirmedCauses();
  const lost = lostAppealDenials();
  return denials.all().filter((d) => d.status !== 'Withdrawn' && d.status !== 'Reclassified').map((d) => factOf(d, confirmed, lost));
}
/** Every denial as the engine reads it — resolved on the last pass; what the plan register measures against. */
export function facts() { if (!lastFacts) recompute({ commit: false }); return lastFacts; }
export const factOfDenial = (id) => facts().find((f) => f.id === id) || null;

// --- reads ------------------------------------------------------------------------------

let ready = false;
let computing = false;
export function all() {
  const rows = store.table(TABLE);
  if (!ready) { ready = true; recompute({ commit: false }); ensureSeeded(); }
  return rows;
}
export const get = (id) => all().find((p) => p.id === id) || null;
export const history = (id) => audit.forEntity(ENTITY, id);

export const payerLabel = (dims) => payers.get(dims?.payerId)?.nameEn || dims?.payerId || 'Any payer';
export const causeLabel = (dims) => (dims?.causeId ? rootCauseLabel(dims.causeId) : 'Any cause');
export function serviceLabel(dims) {
  const s = dims?.service || { level: 'any' };
  if (s.level === 'any') return 'Any service';
  if (s.level === 'item') { const item = cdm.get(s.value); return item ? `${item.chargeCode} ${item.descriptionEn || item.name || ''}`.trim() : String(s.value); }
  return String(s.value);
}
export const labelOf = (row) => `${payerLabel(row.dims)} · ${causeLabel(row.dims)} · ${serviceLabel(row.dims)}`;
/** The codes the window's denials carried, most common first: "CO-197 ×4". */
export const codesLabel = (row) => Object.entries(row?.counters?.codes || {}).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ×${n}`).join(', ');

/** The worklist narrowed to the pattern's denials: the cause tag when the denials carry one, the payer's code when they count from it. */
export function denialsHref(row) {
  const kinds = row?.counters?.causeKinds || {};
  const tagged = (kinds.tagged || 0) + (kinds.confirmed || 0);
  const code = Object.entries(row?.counters?.codes || {}).sort((a, b) => b[1] - a[1])[0]?.[0];
  const q = [`payerId=${encodeURIComponent(row.dims.payerId || '')}`];
  if (!tagged && code) q.push(`code=${encodeURIComponent(code)}`);
  else if (row.dims.causeId) q.push(`rootCauseId=${encodeURIComponent(row.dims.causeId)}`);
  return `#/defensio/denials?${q.join('&')}`;
}

export const denialsOf = (row, { window = false } = {}) => ((window ? row?.windowDenialIds : row?.denialIds) || []).map((id) => denials.get(id)).filter(Boolean);
export const forDenial = (denialId) => all().filter((p) => (p.denialIds || []).includes(denialId));
/** A reactivated pattern acknowledged before it faded needs a fresh acknowledgment. */
export const needsAcknowledgment = (row) => row?.status === 'New' || (row?.status === 'Reactivated' && (!row.acknowledged || String(row.acknowledged.at) < String(row.reactivatedAt || '')));

/** search(q, { status, payerId, causeId, level, active }) → rows, the ones needing attention first, then by denied value. */
export function search(q = '', f = {}) {
  const needle = String(q || '').trim().toLowerCase();
  const rank = (p) => (needsAcknowledgment(p) ? 0 : p.status === 'UnderPlan' ? 2 : p.status === 'Acknowledged' ? 1 : 3);
  return all()
    .filter((p) => {
      if (f.status && p.status !== f.status) return false;
      if (f.active && !isActive(p)) return false;
      if (f.attention && !needsAcknowledgment(p)) return false;
      if (f.payerId && p.dims.payerId !== f.payerId) return false;
      if (f.causeId && p.dims.causeId !== f.causeId) return false;
      if (f.level && p.dims.service?.level !== f.level) return false;
      if (!needle) return true;
      return [p.id, labelOf(p), codesLabel(p), p.origin].some((v) => String(v || '').toLowerCase().includes(needle));
    })
    .sort((a, b) => rank(a) - rank(b) || (b.counters?.deniedValue || 0) - (a.counters?.deniedValue || 0) || a.id.localeCompare(b.id));
}

export function counts() {
  const rows = all();
  const active = rows.filter(isActive);
  return {
    total: rows.length,
    active: active.length,
    activeValue: engine.cents(active.reduce((n, p) => n + (p.counters?.deniedValue || 0), 0)),
    attention: rows.filter(needsAcknowledgment).length,
    acknowledged: rows.filter((p) => p.status === 'Acknowledged').length,
    underPlan: rows.filter((p) => p.status === 'UnderPlan').length,
    faded: rows.filter((p) => p.status === 'Faded').length,
    accelerating: active.filter((p) => p.counters?.trend === 'accelerating').length,
  };
}

/**
 * rankedCauses() → the prevention feed: every cause the window's denials
 * count under, ranked by denied value, with who owns the fix, the payers it
 * came from, the patterns on it, and the No-plan flag on a cause worth the
 * config's value that no plan targets — directly or through a pattern on it.
 */
export function rankedCauses(on = todayIso()) {
  const since = engine.daysBefore(on, windowDays());
  const plans = planned();
  const patterns = all();
  const map = new Map();
  for (const f of facts()) {
    if (!f.causeId || !f.landedAt || f.landedAt < since || f.landedAt > on) continue;
    const g = map.get(f.causeId) || { causeId: f.causeId, label: rootCauseLabel(f.causeId), group: f.origin, owner: OWNERS[f.origin] || null, count: 0, deniedValue: 0, recoveredValue: 0, openValue: 0, payerIds: new Set(), denialIds: [], codes: {} };
    g.count += 1;
    g.deniedValue = engine.cents(g.deniedValue + f.denied);
    g.recoveredValue = engine.cents(g.recoveredValue + f.recovered);
    g.openValue = engine.cents(g.openValue + f.open);
    g.payerIds.add(f.payerId);
    g.denialIds.push(f.id);
    if (f.code) g.codes[f.code] = (g.codes[f.code] || 0) + 1;
    map.set(f.causeId, g);
  }
  return [...map.values()].map((g) => {
    const mine = patterns.filter((p) => p.dims.causeId === g.causeId && isActive(p));
    const hasPlan = plans.causes.has(g.causeId) || mine.some((p) => plans.patterns.has(p.id));
    return { ...g, payerIds: [...g.payerIds], patternIds: mine.map((p) => p.id), hasPlan, noPlanFlag: !hasPlan && g.deniedValue >= noPlanFlagValue() };
  }).sort((a, b) => b.deniedValue - a.deniedValue || b.count - a.count);
}

// --- recompute ----------------------------------------------------------------------------

let timer = null;
function arm() { clearTimeout(timer); timer = setTimeout(() => { timer = null; recompute(); }, 30); }

/** One pass of the engine over the register: new detections, recounts, status moves — each move a trail line. */
export function recompute({ on = todayIso(), commit = true } = {}) {
  if (computing) return;
  computing = true;
  try {
    const rows = store.table(TABLE);
    lastFacts = resolveFacts();
    const found = engine.detect({ facts: lastFacts, existing: rows, planned: planned().patterns, on, config: config() });
    let changed = false;
    const when = new Date().toISOString();
    for (const rec of found) {
      let row = rows.find((r) => r.id === rec.id);
      if (!row) {
        row = { id: rec.id, dims: rec.dims, origin: rec.origin, status: rec.status, acknowledged: null, firstDetectedAt: on, lastDetectedAt: on, fadedAt: null, reactivatedAt: null, seedTag: null, createdAt: when, updatedAt: when };
        rows.push(row);
        log(row, 'Detected', `${labelOf(row)} — ${rec.counters.occurrences} in ${windowDays()} days, ${rec.counters.trend}`, when, 'System');
        changed = true;
      } else if (row.status !== rec.status) {
        const from = row.status;
        row.status = rec.status;
        if (rec.status === 'Faded') row.fadedAt = on;
        if (rec.status === 'Reactivated') row.reactivatedAt = on;
        log(row, 'Status', `${statusLabel(from)} → ${statusLabel(rec.status)} — ${rec.counters.occurrences} in the window (threshold ${threshold()})`, when, 'System');
        changed = true;
      }
      if (rec.counters.occurrences >= threshold()) row.lastDetectedAt = on;
      const before = JSON.stringify([row.counters, row.denialIds, row.windowDenialIds, row.firstSeenAt, row.lastSeenAt]);
      Object.assign(row, { counters: rec.counters, denialIds: rec.denialIds, windowDenialIds: rec.windowDenialIds, firstSeenAt: rec.firstSeenAt, lastSeenAt: rec.lastSeenAt, window: rec.window, origin: row.origin || rec.origin });
      if (before !== JSON.stringify([row.counters, row.denialIds, row.windowDenialIds, row.firstSeenAt, row.lastSeenAt])) { row.updatedAt = when; changed = true; }
    }
    if (changed && commit) store.commit('denialPatterns.recompute');
  } finally {
    computing = false;
  }
}

store.subscribe((reason) => {
  if (reason === 'reset') { ready = false; seeded = false; lastFacts = null; seedGate = gate(); return; }
  if (reason.startsWith('denialPatterns.')) return;
  if (reason === 'denials.seed' && ready && !seeded) queueMicrotask(ensureSeeded);
  if (ready && (reason.startsWith('denials.') || reason.startsWith('preventionPlans.') || reason.startsWith('appeal') || reason.startsWith('rcaCases.') || reason.startsWith('riskRules.'))) arm();
});

// --- writes ---------------------------------------------------------------------------------

/** acknowledge(id, { note }) → the row or { error } — somebody has read the pattern; a plan or a rule is a separate act. */
export function acknowledge(id, { note = '' } = {}, { at = null, by = null } = {}) {
  const row = get(id);
  if (!row) return { error: 'No such pattern' };
  if (!needsAcknowledgment(row)) return { error: `Already ${statusLabel(row.status).toLowerCase()}` };
  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  row.acknowledged = { by: who, at: when, note: String(note || '').trim() };
  const from = row.status;
  row.status = 'Acknowledged';
  row.updatedAt = when;
  log(row, 'Acknowledged', `${statusLabel(from)} → Acknowledged${row.acknowledged.note ? ` — ${row.acknowledged.note}` : ''}`, when, who);
  store.commit('denialPatterns.acknowledge');
  return row;
}

function log(row, action, details, at = null, by = null) {
  audit.all().push({ id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: row.id, action, details, user: by || currentRole().name, at: at || new Date().toISOString() });
}

// --- seed -----------------------------------------------------------------------------------

let seeded = false;
let building = false;
const gate = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
let seedGate = gate();
/** Resolves once the seed has run — renewed on a reset, so a peer that waits on it waits for the rebuild. */
export const whenSeeded = () => seedGate.promise;
export const seedReady = seedGate.promise;
/**
 * Runs once the denial register's deferred half has settled and the two
 * peers have been tried, and again after a reset (the denial register's
 * `denials.seed` commit says it has rebuilt). The seed creates the denials
 * its patterns need through the denial register's own writes, writes the
 * one pattern that has already faded by hand, and the pass that follows
 * detects the rest.
 */
async function ensureSeeded() {
  if (seeded || building) return;
  building = true;
  try {
    await denials.seedReady;
    await peersReady;
    await Promise.allSettled([peers.tracking?.seedReady, peers.rca?.seedReady].filter(Boolean));
    if (!store.table(TABLE).some((r) => r.seedTag === 'A40')) store.batch(() => buildPatterns(seedApi));
    seeded = true;
    recompute({ commit: false });
    store.commit('denialPatterns.seed');
  } finally {
    building = false;
    seedGate.resolve();
  }
}

/**
 * For a seed only: a status the pass moved today was really moved the day
 * the plan behind it was activated — the newest trail line saying "→ <to>"
 * is restamped, and nothing else changes.
 */
export function backdateStatus(id, to, at, why = '') {
  const row = store.table(TABLE).find((r) => r.id === id);
  if (!row) return;
  const entries = audit.all().filter((e) => e.entity === ENTITY && e.entityId === row.id && e.action === 'Status' && String(e.details).includes(`→ ${statusLabel(to)}`));
  const entry = entries[entries.length - 1];
  if (entry) { entry.at = at; if (why) entry.details = `${String(entry.details).split(' — ')[0]} — ${why}`; }
  row.updatedAt = at;
}

/** What the seed drives — the denial register's writes and this file's own, dated by the seed. */
const seedApi = {
  today: todayIso(),
  denials,
  claims: () => claims.all(),
  idFor,
  get: (id) => store.table(TABLE).find((r) => r.id === id) || null,
  upsert(record) {
    const rows = store.table(TABLE);
    const existing = rows.find((r) => r.id === record.id);
    if (existing) return existing;
    rows.push(record);
    return record;
  },
  // A pattern the pass found today was really found the day its third denial landed.
  backdate(row, at) {
    row.firstDetectedAt = String(at).slice(0, 10);
    row.createdAt = at;
    const entry = audit.all().find((e) => e.entity === ENTITY && e.entityId === row.id && e.action === 'Detected');
    if (entry) { entry.at = at; entry.details = `${labelOf(row)} — ${threshold()} in ${windowDays()} days`; }
  },

  acknowledge: (id, fields, dated) => acknowledge(id, fields, dated),
  log: (row, action, details, at, by) => log(row, action, details, at, by),
  recompute: () => recompute({ commit: false }),
};
