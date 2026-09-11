// Repository — TPA fee disputes (amendment 42). Owner: modules/defensio. A
// dispute is the desk's claim on one administrator for what it withheld
// past its schedule: one or more overcharged accruals of the same TPA, the
// total overcharge, and the evidence — each accrual's actual, expected and
// the version the expected was read from, frozen as the dispute was raised.
// It moves Raised → Acknowledged (the administrator's reference) →
// Settled (what came back, and what happens to the remainder: a write-off
// request through Claima's own creator, or accepted with a reason) or
// WrittenOff outright. Each move is written onto the accruals it holds
// through `tpaFeeAccruals.setDispute`, which is what the ledger reads; the
// register never touches a denial.
//
// The write-off register is reached by dynamic import and feature-detected
// (Claima's A33 — it imports files that import this module's peers). Seeded
// behind the accrual register's own seed from data/seed/tpa-disputes.js and
// again after a reset. Audit entity `tpaDisputes`, keyed on the dispute id.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as claims from './claims.js';
import * as tpas from './tpas.js';
import * as accruals from './tpa-fee-accruals.js';
import { bucketsOf, cents } from '../engines/tpa-matching.js';
import { current as currentRole } from '../../shared/roles.js';
import { todayIso, usd, withinDates } from '../../shared/format.js';
import { buildTpaDisputes } from '../seed/tpa-disputes.js';

const TABLE = 'tpaDisputes';
const ENTITY = 'tpaDisputes';

export const STATUSES = ['Raised', 'Acknowledged', 'Settled', 'WrittenOff'];
export const OPEN_STATUSES = ['Raised', 'Acknowledged'];
export const REMAINDER_OPTIONS = ['writeOff', 'accept'];
export const statusLabel = (s) => (s === 'WrittenOff' ? 'Written off' : s || '—');
export const statusTone = (s) => ({ Raised: 'warning', Acknowledged: 'info', Settled: 'success', WrittenOff: 'critical' }[s] || '');
export const isOpen = (row) => OPEN_STATUSES.includes(row?.status);

// --- peers -------------------------------------------------------------------------------

const peers = { writeoffs: null };
let settled = false;
let seeding = false;
let resolveSeedReady;
export const seedReady = new Promise((resolve) => { resolveSeedReady = resolve; });
export const peerStatus = () => ({ writeoffs: Boolean(peers.writeoffs?.request) });

export const peersReady = Promise.allSettled([
  accruals.peersReady.then(() => accruals.seedReady),
  import('./writeoffs.js').then((m) => { peers.writeoffs = m; return m.peersReady; }).catch(() => { peers.writeoffs = null; }),
]).then(() => { settled = true; ensureSeeded(); });

// --- reads -------------------------------------------------------------------------------

export const all = () => store.table(TABLE);
export const get = (id) => all().find((d) => d.id === id) || null;
export const byAccrual = (accrualId) => all().filter((d) => d.accrualIds.includes(accrualId));
export const byTpa = (tpaId) => all().filter((d) => d.tpaId === tpaId);
export const open = () => all().filter(isOpen);
export const history = (id) => audit.forEntity(ENTITY, id);
export const accrualsOf = (row) => (row?.accrualIds || []).map((id) => accruals.get(id)).filter(Boolean);

export function counts() {
  const rows = all();
  const monthStart = `${todayIso().slice(0, 7)}-01`;
  const openRows = rows.filter(isOpen);
  const settledMtd = rows.filter((d) => d.settlement && withinDates(d.settlement.at, monthStart, ''));
  return {
    total: rows.length, raised: rows.filter((d) => d.status === 'Raised').length, acknowledged: rows.filter((d) => d.status === 'Acknowledged').length,
    open: openRows.length, openValue: cents(openRows.reduce((n, d) => n + d.totalOvercharge, 0)),
    settledMtd: settledMtd.length, recoveredMtd: cents(settledMtd.reduce((n, d) => n + (d.settlement?.recovered || 0), 0)),
    recovered: cents(rows.reduce((n, d) => n + (d.settlement?.recovered || 0), 0)),
  };
}

export function search(q = '', f = {}) {
  const needle = String(q || '').trim().toLowerCase();
  return all().filter((d) => {
    if (needle && ![d.id, tpas.nameOf(d.tpaId), d.acknowledgment?.ref, d.writeOffRequestRef, ...d.accrualIds, ...d.evidence.computedRefs.map((r) => r.claimNo)].some((s) => String(s || '').toLowerCase().includes(needle))) return false;
    if (f.tpaId && d.tpaId !== f.tpaId) return false;
    if (f.status && d.status !== f.status) return false;
    return true;
  }).sort((x, y) => (isOpen(y) ? 1 : 0) - (isOpen(x) ? 1 : 0) || String(y.createdAt).localeCompare(String(x.createdAt)));
}

/** What a settlement can write the remainder off against: the claim with the largest payer balance among the dispute's accruals. */
export function writeOffTarget(row, remainder) {
  const candidates = accrualsOf(row).map((a) => claims.get(a.claimId || a.claimNo)).filter(Boolean)
    .map((c) => ({ claim: c, balance: cents(claims.openBalance?.(c) ?? Math.max(0, c.totals?.balance || 0)) }))
    .sort((x, y) => y.balance - x.balance);
  const hit = candidates.find((c) => c.balance >= remainder);
  return hit ? hit.claim : null;
}

/** raiseBlocker({ tpaId, accrualIds }) → a sentence or '' — overcharged, undisputed accruals of one administrator. */
export function raiseBlocker({ tpaId, accrualIds = [] } = {}) {
  if (!accrualIds.length) return 'Pick the overcharged accruals to dispute.';
  const rows = accrualIds.map((id) => accruals.get(id));
  if (rows.some((a) => !a)) return 'An accrual in the selection is not on the register.';
  const bad = rows.find((a) => !accruals.isDisputable(a));
  if (bad) return `${bad.id} is ${bad.state.toLowerCase()}${bad.dispute ? ` — already on ${bad.dispute.id}` : ''}; only an overcharged accrual nobody has disputed can be raised.`;
  const ids = new Set(rows.map((a) => a.tpaId));
  if (ids.size > 1) return 'A dispute is with one administrator — the selection spans two.';
  if (tpaId && !ids.has(tpaId)) return 'The accruals belong to a different administrator.';
  if (!rows[0].tpaId) return 'The accruals have no administrator linked to read them against.';
  return '';
}

// --- writes ------------------------------------------------------------------------------

/**
 * raise({ tpaId, accrualIds, note }) → the dispute or { error }. The evidence
 * is each accrual's computed figures as they stand now; the accruals read
 * Disputed from here on.
 */
export function raise({ tpaId = null, accrualIds = [], note = '' } = {}, { at = null, by = null, commit = true } = {}) {
  const why = raiseBlocker({ tpaId, accrualIds });
  if (why) return { error: why };
  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  const rows = accrualIds.map((id) => accruals.get(id));
  const row = {
    id: store.nextId(TABLE, 'TPD-'),
    tpaId: rows[0].tpaId,
    accrualIds: rows.map((a) => a.id),
    totalOvercharge: cents(rows.reduce((n, a) => n + bucketsOf(a).overcharge, 0)),
    evidence: { computedRefs: rows.map(evidenceOf), amendmentRefs: [] },
    status: 'Raised',
    note: String(note || '').trim(),
    acknowledgment: null,
    settlement: null,
    writeOffRequestRef: null,
    createdAt: when, createdBy: who, updatedAt: when,
  };
  all().push(row);
  for (const a of rows) accruals.setDispute(a.id, { id: row.id, status: 'Raised', recovered: 0, writtenOff: 0 }, { at: when, by: who });
  log(row, 'Raised', `${tpas.nameOf(row.tpaId)} · ${usd(row.totalOvercharge)} over ${rows.length} accrual${rows.length === 1 ? '' : 's'} (${row.accrualIds.join(', ')})${row.note ? ` — ${row.note}` : ''}`, when, who);
  if (commit) store.commit('tpaDisputes.raise');
  return row;
}

export function acknowledge(id, { ref = '' } = {}, { at = null, by = null, commit = true } = {}) {
  const row = get(id);
  if (!row) return { error: 'No such dispute' };
  if (row.status !== 'Raised') return { error: `A ${statusLabel(row.status).toLowerCase()} dispute is not acknowledged again` };
  if (!String(ref).trim()) return { error: 'Give the administrator’s reference — it is what the acknowledgment is.' };
  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  row.status = 'Acknowledged';
  row.acknowledgment = { ref: String(ref).trim(), at: when, by: who };
  row.updatedAt = when;
  for (const a of accrualsOf(row)) accruals.setDispute(a.id, { id: row.id, status: 'Acknowledged', recovered: 0, writtenOff: 0 }, { at: when, by: who });
  log(row, 'Acknowledged', `${row.acknowledgment.ref}`, when, who);
  if (commit) store.commit('tpaDisputes.acknowledge');
  return row;
}

/**
 * settle(id, { recovered, how ('writeOff' | 'accept'), reason, justification,
 * reasonCode }) → the dispute or { error }. What came back is recovered;
 * the remainder is raised as a claim-residual write-off request through
 * Claima's creator (Pending Approval — its tiers decide) or accepted with a
 * reason. Either way the dispute is Settled and the accruals carry the
 * split, in proportion to their overcharge.
 */
export function settle(id, { recovered = 0, how = 'accept', reason = '', justification = '', reasonCode = 'W03' } = {}, { at = null, by = null, commit = true } = {}) {
  const row = get(id);
  if (!row) return { error: 'No such dispute' };
  if (!isOpen(row)) return { error: `A ${statusLabel(row.status).toLowerCase()} dispute is not settled again` };
  const got = cents(recovered);
  if (!(got >= 0)) return { error: 'Give the amount recovered, zero or more.' };
  if (got > row.totalOvercharge + 0.005) return { error: `Recovered more than the ${usd(row.totalOvercharge)} in dispute — check the figure.` };
  const remainder = cents(row.totalOvercharge - got);
  if (remainder > 0 && !REMAINDER_OPTIONS.includes(how)) return { error: 'Say what happens to the remainder.' };
  if (remainder > 0 && how === 'accept' && !String(reason).trim()) return { error: 'Accepting the remainder needs a reason.' };
  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  let woRef = null;
  if (remainder > 0 && how === 'writeOff') {
    if (!peers.writeoffs?.request) return { error: 'The write-off register is not on disk — accept the remainder with a reason, or wait for it.' };
    const claim = writeOffTarget(row, remainder);
    if (!claim) return { error: 'No claim in the dispute carries a payer balance the remainder can be written off against — accept it with a reason instead.' };
    const wo = peers.writeoffs.request({
      source: { kind: 'ClaimResidual', ref: claim.claimNo, claimNo: claim.claimNo, mrn: claim.patientMrn || null, encounterNo: claim.encounterNo || null },
      side: 'Payer', amount: remainder, reasonCode,
      justification: `${justification || reason || 'TPA fee overcharge remainder'} — ${row.id} against ${tpas.nameOf(row.tpaId)}: ${usd(row.totalOvercharge)} disputed, ${usd(got)} recovered.`,
    }, { at: when, by: who, commit: false });
    if (!wo || wo.error) return { error: wo?.error || 'No write-off request was raised' };
    wo.origin = 'tpaDispute';
    wo.tpaDisputeId = row.id;
    wo.accrualIds = [...row.accrualIds];
    woRef = wo.id;
  }
  row.status = 'Settled';
  row.settlement = { recovered: got, remainder, how: remainder > 0 ? how : null, reason: String(reason || '').trim(), at: when, by: who };
  row.writeOffRequestRef = woRef;
  row.updatedAt = when;
  // The split lands on each accrual in proportion to its overcharge, the rounding on the last.
  const rows = accrualsOf(row);
  let leftRecovered = got;
  let leftWritten = remainder;
  rows.forEach((a, i) => {
    const share = row.totalOvercharge ? bucketsOf(a).overcharge / row.totalOvercharge : 1 / rows.length;
    const r = i === rows.length - 1 ? leftRecovered : cents(got * share);
    const w = i === rows.length - 1 ? leftWritten : cents(remainder * share);
    leftRecovered = cents(leftRecovered - r);
    leftWritten = cents(leftWritten - w);
    accruals.setDispute(a.id, { id: row.id, status: 'Settled', recovered: r, writtenOff: w }, { at: when, by: who });
  });
  log(row, 'Settled', `${usd(got)} recovered${remainder ? `, ${usd(remainder)} ${how === 'writeOff' ? `to write-off request ${woRef}` : 'accepted'}` : ''}${row.settlement.reason ? ` — ${row.settlement.reason}` : ''}`, when, who);
  if (commit) store.commit('tpaDisputes.settle');
  return row;
}

/** writeOff(id, { justification, reasonCode }) → the dispute or { error }: nothing came back; the whole overcharge goes to a write-off request. */
export function writeOff(id, { justification = '', reasonCode = 'W03', reason = '' } = {}, opts = {}) {
  const row = get(id);
  if (!row) return { error: 'No such dispute' };
  const r = settle(id, { recovered: 0, how: 'writeOff', justification, reasonCode, reason }, { ...opts, commit: false });
  if (r?.error) return r;
  row.status = 'WrittenOff';
  for (const a of accrualsOf(row)) accruals.setDispute(a.id, { id: row.id, status: 'WrittenOff', recovered: 0, writtenOff: bucketsOf(a).overcharge }, { at: opts.at || row.updatedAt, by: opts.by });
  log(row, 'Written off', `${usd(row.totalOvercharge)} to ${row.writeOffRequestRef}`, row.updatedAt, opts.by || currentRole().name);
  if (opts.commit !== false) store.commit('tpaDisputes.writeoff');
  return row;
}

/** onAmendment(amendmentId, accrualIds) — a posted amendment names the open disputes it touched; the evidence is refreshed and the reference kept. */
export function onAmendment(amendmentId, accrualIds = [], { at = null, by = null } = {}) {
  const when = at || new Date().toISOString();
  const touched = [];
  for (const row of all()) {
    if (!row.accrualIds.some((id) => accrualIds.includes(id))) continue;
    row.evidence.amendmentRefs = [...(row.evidence.amendmentRefs || []), { amendmentId, at: when }];
    row.evidence.computedRefs = accrualsOf(row).map(evidenceOf);
    row.updatedAt = when;
    log(row, 'Amendment noted', `${amendmentId} restated ${row.accrualIds.filter((id) => accrualIds.includes(id)).join(', ')} — the disputed overcharge stays at the figure it was raised on; the correction is the amendment's`, when, by || currentRole().name);
    touched.push(row);
  }
  return touched;
}

// --- seed ---------------------------------------------------------------------------------

function ensureSeeded() {
  const rows = store.table(TABLE);
  if (!settled || seeding || rows.some((r) => r.seedTag === 'A42')) return;
  seeding = true;
  try {
    store.batch(() => {
      buildTpaDisputes({ accruals, disputes: { raise, acknowledge, settle }, today: todayIso() });
      store.commit('tpaDisputes.seed');
    });
  } finally {
    seeding = false;
  }
  resolveSeedReady();
}
store.subscribe((why) => { if (why === 'reset') setTimeout(() => accruals.seedReady.then(ensureSeeded), 0); });

// --- internals -----------------------------------------------------------------------------

function evidenceOf(a) {
  return {
    accrualId: a.id, claimNo: a.claimNo, remittanceRef: a.remittanceRef, remittanceDate: a.remittanceDate,
    actual: a.actual.amount, expected: a.expected?.amount ?? null, versionRef: a.expected?.versionRef || null, rate: a.expected?.rate ?? null,
    variance: a.variance, overcharge: bucketsOf(a).overcharge,
  };
}

function log(row, action, details, at, user) {
  audit.all().push({ id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: row.id, action, details, user, at });
}
