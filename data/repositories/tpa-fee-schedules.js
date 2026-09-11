// Repository — TPA fee schedules (amendment 42). Owner: modules/defensio.
// One schedule per administrator × payer link, holding the versions of the
// fee it may withhold: a basis (a share of what is paid or billed, a flat
// fee per claim or per remittance), a base rate, service-group rates that
// win over it, caps per claim and per period, and the term. Versions are
// append-only and never overlap: a new one starts today or later and closes
// the open-ended one before it; a past period is never edited — it is
// restated through an amendment, which writes a retrospective version on
// top of the one it supersedes, invisible to the matching until the
// amendment posts. `versionAt` is the one door to "the version in force on
// a date", and the accrual repository asks it with the remittance date and
// nothing else.
//
// Seeded on first read from data/seed/tpa-fee-schedules.js. Audit entity
// `tpaFeeSchedules`, keyed on the schedule id; a version's ref is
// `<schedule id>/v<n>`.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as tpas from './tpas.js';
import * as payers from './payers.js';
import { SERVICE_GROUPS } from './contracts.js';
import * as engine from '../engines/tpa-matching.js';
import { current as currentRole } from '../../shared/roles.js';
import { iso, todayIso, usd } from '../../shared/format.js';
import { tpaFeeSchedules as SEED } from '../seed/tpa-fee-schedules.js';

const TABLE = 'tpaFeeSchedules';
const ENTITY = 'tpaFeeSchedules';

export const { BASES, BASIS_LABELS, basisLabel, isPct } = engine;
export { SERVICE_GROUPS };

export function all() {
  const rows = store.table(TABLE);
  if (!rows.length) rows.push(...structuredClone(SEED));
  return rows;
}

export const get = (id) => all().find((s) => s.id === id) || null;
export const forLink = (tpaId, payerId) => all().find((s) => s.tpaId === tpaId && s.payerId === payerId) || null;
export const byTpa = (tpaId) => all().filter((s) => s.tpaId === tpaId);
export const history = (id) => audit.forEntity(ENTITY, id);

/** Every version on the register with its schedule beside it, newest first. */
export const allVersions = () => all().flatMap((s) => s.versions.map((v) => ({ ...v, scheduleId: s.id, tpaId: s.tpaId, payerId: s.payerId })))
  .sort((a, b) => String(b.effectiveFrom).localeCompare(String(a.effectiveFrom)) || b.n - a.n);

export function versionByRef(ref) {
  const scheduleId = String(ref || '').split('/')[0];
  const s = get(scheduleId);
  return s ? s.versions.find((v) => v.ref === ref) || null : null;
}

/**
 * versionAt(tpaId, payerId, date) → the version in force on that date, or
 * null. The only current-version lookup in the feature is the picker on the
 * schedules tab; the matching always passes the remittance date.
 */
export function versionAt(tpaId, payerId, date) {
  const s = forLink(tpaId, payerId);
  return s ? engine.versionAt(s.versions, date) : null;
}

export const describe = (version) => engine.describeVersion(version, usd);

/** The version's own text for the tab: "v2 · 4% of paid · Lab 2% · cap $30/claim". */
export const versionLabel = (version) => (version ? `v${version.n} · ${describe(version)}` : '—');

/** editBlocker(version) → the sentence a disabled Edit carries: versions are never edited. */
export function editBlocker(version) {
  if (!version) return '';
  if (version.retrospective) return `A restatement is the amendment's — open ${version.amendmentId || 'the amendment'} to read it.`;
  const today = todayIso();
  if (iso(version.effectiveFrom) > today) return 'A version is never edited — add a new one starting the same day and this one is closed before it.';
  return 'A version in force is never edited — a past period is restated through an amendment.';
}

export function counts() {
  const rows = all();
  return { schedules: rows.length, versions: rows.reduce((n, s) => n + s.versions.length, 0), restated: rows.reduce((n, s) => n + s.versions.filter((v) => v.retrospective && v.posted).length, 0) };
}

// --- writes ------------------------------------------------------------------------------

/** The scopes a form hands in, cleaned: one row per service group, the base rate as the 'all' row. */
export function normaliseScopes(rate, scopes = []) {
  const out = [{ level: 'all', ref: null, rate: Number(rate) || 0 }];
  for (const s of scopes) {
    if (s?.level !== 'serviceGroup' || !s.ref || s.rate == null || s.rate === '') continue;
    if (out.some((x) => x.level === 'serviceGroup' && x.ref === s.ref)) continue;
    out.push({ level: 'serviceGroup', ref: s.ref, rate: Number(s.rate) || 0 });
  }
  return out;
}

/** validateVersion(scheduleId, v, { retrospective }) → problems[]. */
export function validateVersion(scheduleId, v = {}, { retrospective = false } = {}) {
  const problems = [];
  const s = get(scheduleId);
  if (!s) problems.push('No such schedule.');
  if (!BASES.includes(v.basis)) problems.push('Pick a basis.');
  if (!(Number(v.rate) >= 0)) problems.push(isPct(v.basis) ? 'Give the rate as a percentage.' : 'Give the fee amount.');
  if (isPct(v.basis) && Number(v.rate) > 100) problems.push('A share cannot be more than 100%.');
  for (const sc of v.scopes || []) {
    if (sc.level === 'serviceGroup' && !SERVICE_GROUPS.includes(sc.ref)) problems.push(`${sc.ref || 'A scope'} is not a service group a charge lands in.`);
    if (sc.level === 'serviceGroup' && !(Number(sc.rate) >= 0)) problems.push(`Give ${sc.ref} its rate.`);
  }
  if (v.capPerClaim != null && v.capPerClaim !== '' && !(Number(v.capPerClaim) > 0)) problems.push('A per-claim cap is above zero, or blank.');
  if (v.capPerPeriod != null && v.capPerPeriod !== '' && !(Number(v.capPerPeriod) > 0)) problems.push('A per-period cap is above zero, or blank.');
  if (!iso(v.effectiveFrom)) problems.push('Give the version a start date.');
  else if (!retrospective && iso(v.effectiveFrom) < todayIso()) problems.push('A version starts today or later — a past period is restated through an amendment.');
  if (v.effectiveTo && iso(v.effectiveTo) < iso(v.effectiveFrom)) problems.push('The version ends before it starts.');
  if (s && !retrospective) {
    const clash = engine.overlapOf(s.versions, { effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo });
    // The open-ended standing version is closed the day before a later one starts; anything else overlapping is refused.
    if (clash && !(clash.effectiveTo == null && iso(v.effectiveFrom) > iso(clash.effectiveFrom))) {
      problems.push(`v${clash.n} already covers ${clash.effectiveFrom}${clash.effectiveTo ? ` to ${clash.effectiveTo}` : ' onwards'} — a period has one standing version.`);
    }
  }
  return problems;
}

/** ensureSchedule(tpaId, payerId) → the schedule for a link, created empty when the link has none yet. */
export function ensureSchedule(tpaId, payerId, { at = null, by = null } = {}) {
  const existing = forLink(tpaId, payerId);
  if (existing) return existing;
  const when = at || new Date().toISOString();
  const row = { id: store.nextId(TABLE, 'TFS-'), tpaId, payerId, versions: [], createdAt: when, updatedAt: when };
  all().push(row);
  log(row, 'Created', `${tpas.nameOf(tpaId)} × ${payers.get(payerId)?.nameEn || payerId}`, when, by || currentRole().name);
  return row;
}

/**
 * addVersion(scheduleId, { basis, rate, scopes, capPerClaim, capPerPeriod,
 * effectiveFrom, effectiveTo, note }) → the version or { error }. Appends;
 * closes the open-ended standing version the day before the new one starts.
 */
export function addVersion(scheduleId, v = {}, { at = null, by = null, commit = true } = {}) {
  const problems = validateVersion(scheduleId, v);
  if (problems.length) return { error: problems.join(' ') };
  const s = get(scheduleId);
  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  const from = iso(v.effectiveFrom);
  const open = s.versions.find((x) => !x.retrospective && x.effectiveTo == null && iso(x.effectiveFrom) < from);
  if (open) {
    open.effectiveTo = dayBefore(from);
    log(s, 'Version closed', `${open.ref} now ends ${open.effectiveTo}`, when, who);
  }
  const n = s.versions.reduce((m, x) => Math.max(m, x.n), 0) + 1;
  const version = {
    ref: `${s.id}/v${n}`, n, basis: v.basis, rate: Number(v.rate) || 0, scopes: normaliseScopes(v.rate, v.scopes),
    capPerClaim: v.capPerClaim === '' || v.capPerClaim == null ? null : Number(v.capPerClaim),
    capPerPeriod: v.capPerPeriod === '' || v.capPerPeriod == null ? null : Number(v.capPerPeriod),
    effectiveFrom: from, effectiveTo: v.effectiveTo ? iso(v.effectiveTo) : null,
    retrospective: false, amendmentId: null, supersedesRef: null, posted: true, postedAt: when,
    note: String(v.note || '').trim(), createdAt: when, createdBy: who,
  };
  s.versions.push(version);
  s.updatedAt = when;
  log(s, 'Version added', `${version.ref} · ${describe(version)} · from ${version.effectiveFrom}${version.effectiveTo ? ` to ${version.effectiveTo}` : ''}`, when, who);
  if (commit) store.commit('tpaFeeSchedules.version');
  return version;
}

/**
 * restate(scheduleId, supersedesRef, patch, { amendmentId }) → the
 * retrospective version, unposted, on the term of the version it restates
 * (or the patch's own term). The amendment repository calls it while
 * drafting and marks it posted when the amendment posts; a draft amendment
 * dropped leaves it invisible for good.
 */
export function restate(scheduleId, supersedesRef, patch = {}, { amendmentId, at = null, by = null, commit = true } = {}) {
  const s = get(scheduleId);
  if (!s) return { error: 'No such schedule' };
  const base = supersedesRef ? s.versions.find((v) => v.ref === supersedesRef) : null;
  const v = {
    basis: patch.basis ?? base?.basis, rate: patch.rate ?? base?.rate, scopes: patch.scopes ?? base?.scopes ?? [],
    capPerClaim: patch.capPerClaim === undefined ? base?.capPerClaim ?? null : patch.capPerClaim,
    capPerPeriod: patch.capPerPeriod === undefined ? base?.capPerPeriod ?? null : patch.capPerPeriod,
    effectiveFrom: patch.effectiveFrom ?? base?.effectiveFrom, effectiveTo: patch.effectiveTo === undefined ? base?.effectiveTo ?? null : patch.effectiveTo,
    note: patch.note ?? '',
  };
  const problems = validateVersion(scheduleId, v, { retrospective: true });
  if (problems.length) return { error: problems.join(' ') };
  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  const n = s.versions.reduce((m, x) => Math.max(m, x.n), 0) + 1;
  const version = {
    ref: `${s.id}/v${n}`, n, basis: v.basis, rate: Number(v.rate) || 0, scopes: normaliseScopes(v.rate, v.scopes),
    capPerClaim: v.capPerClaim === '' || v.capPerClaim == null ? null : Number(v.capPerClaim),
    capPerPeriod: v.capPerPeriod === '' || v.capPerPeriod == null ? null : Number(v.capPerPeriod),
    effectiveFrom: iso(v.effectiveFrom), effectiveTo: v.effectiveTo ? iso(v.effectiveTo) : null,
    retrospective: true, amendmentId: amendmentId || null, supersedesRef: supersedesRef || null, posted: false, postedAt: null,
    note: String(v.note || '').trim(), createdAt: when, createdBy: who,
  };
  s.versions.push(version);
  s.updatedAt = when;
  log(s, 'Restatement drafted', `${version.ref} restates ${supersedesRef || 'an uncovered period'} for ${amendmentId || 'an amendment'} · ${describe(version)}`, when, who);
  if (commit) store.commit('tpaFeeSchedules.restate');
  return version;
}

/** markPosted(ref, { amendmentId }) → the version: a restatement becomes the version in force on its term. */
export function markPosted(ref, { amendmentId = null, at = null, by = null, commit = true } = {}) {
  const s = get(String(ref || '').split('/')[0]);
  const version = s?.versions.find((v) => v.ref === ref);
  if (!version) return null;
  const when = at || new Date().toISOString();
  version.posted = true;
  version.postedAt = when;
  s.updatedAt = when;
  log(s, 'Restatement posted', `${ref} in force from ${version.effectiveFrom}${version.effectiveTo ? ` to ${version.effectiveTo}` : ''} — ${amendmentId || version.amendmentId || ''}`, when, by || currentRole().name);
  if (commit) store.commit('tpaFeeSchedules.posted');
  return version;
}

/** Drop an unposted restatement — a draft amendment discarded takes its version with it. */
export function dropRestatement(ref, { at = null, by = null, commit = true } = {}) {
  const s = get(String(ref || '').split('/')[0]);
  const i = s ? s.versions.findIndex((v) => v.ref === ref && v.retrospective && !v.posted) : -1;
  if (i < 0) return false;
  s.versions.splice(i, 1);
  log(s, 'Restatement dropped', ref, at || new Date().toISOString(), by || currentRole().name);
  if (commit) store.commit('tpaFeeSchedules.restate');
  return true;
}

function dayBefore(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function log(row, action, details, at, user) {
  audit.all().push({ id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: row.id, action, details, user, at });
}
