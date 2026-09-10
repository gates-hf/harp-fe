// Repository — submission batches. Owner: modules/claima (amendment 28). One
// entity: the batch, with the files it generated, the submission it went out
// on, the acknowledgment that came back and the rejections inside it — the
// amendment names them as one shape, so they live in one file and it is over
// the line cap on purpose.
//
// A batch is the unit a payer receives. It is filled from the Ready queue on
// creation, validated before it generates (a claim that went stale is ejected,
// a claim already in another open batch is refused), generated as a versioned
// set of files, marked submitted with the method and the reference the desk
// used, and acknowledged against a reconciliation — included = accepted +
// rejected + not received — that refuses to record an answer that does not
// add up. A rejection sends its claim to the rejections worklist; Fix &
// Resubmit routes by the reason's fixRoute and the claim keeps its number,
// going round again on the next cycle.
//
// Reads data/repositories/claims.js, which never reads this file. The table
// seeds itself on first read from data/seed/batches.js, the way claims does.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as claims from './claims.js';
import * as payers from './payers.js';
import * as files from '../engines/submission-files.js';
import { buildBatches } from '../seed/batches.js';
import { REJECTION_REASONS, rejectionLabel, fixRouteOf, rejectionReason } from '../seed/rejection-reasons.js';
import { CONFIG } from '../../shared/config.js';
import { current as currentRole } from '../../shared/roles.js';
import { compareDates, iso, todayIso } from '../../shared/format.js';

const TABLE = 'batches';
const ENTITY = 'batches';

export const STATUSES = ['Open', 'Generated', 'Submitted', 'Acknowledged', 'Partially Rejected', 'Rejected', 'Closed'];
/** Not yet with the payer. */
export const OPEN_STATUSES = ['Open', 'Generated'];
/** With the payer, or answered — a rejection may still be recorded. */
export const ANSWERABLE = ['Submitted', 'Acknowledged', 'Partially Rejected', 'Rejected'];
export const MODES = ['Electronic', 'Manual'];
export const FILE_KINDS = files.FILE_KINDS;
export { REJECTION_REASONS, rejectionLabel, fixRouteOf, rejectionReason };

// Hooks the lifecycle feature subscribes to (amendment 30). A hook that throws
// is logged and skipped, so one listener never blocks the batch.
export const afterSubmitHooks = [];
export const afterAckHooks = [];
export const afterRejectHooks = [];

export function all() {
  const rows = store.table(TABLE);
  if (!rows.length) seed(rows);
  return rows;
}

export const get = (batchNo) => all().find((b) => b.batchNo === batchNo || b.id === batchNo) || null;

export function statusTone(status) {
  if (status === 'Acknowledged' || status === 'Closed') return 'success';
  if (status === 'Generated' || status === 'Partially Rejected') return 'warning';
  if (status === 'Rejected') return 'critical';
  if (status === 'Submitted') return 'info';
  return '';
}

export const isOpen = (batch) => OPEN_STATUSES.includes(batch?.status);

// --- payer profiles ----------------------------------------------------------------

const SUBMISSION = () => CONFIG.claima?.submission || { profiles: {}, methods: {}, defaultProfile: { mode: 'Manual', cycle: { kind: 'Weekly', day: 'Monday' }, methods: [] } };

/** How the payer takes its claims: mode, cycle and the methods the desk may use. */
export function profileOf(payerId) {
  const s = SUBMISSION();
  return s.profiles?.[payerId] || s.defaultProfile;
}

export const modeOf = (payerId) => profileOf(payerId).mode;

/** The methods the Mark submitted form offers: the profile's, else every one the mode allows. */
export function methodsFor(payerId) {
  const p = profileOf(payerId);
  const fallback = SUBMISSION().methods?.[p.mode] || [];
  return p.methods?.length ? p.methods : fallback;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function cycleLabel(cycle) {
  if (!cycle) return '—';
  if (cycle.kind === 'Daily') return 'Daily';
  if (cycle.kind === 'Weekly') return `Weekly · ${cycle.day}`;
  if (cycle.kind === 'Monthly') return `Monthly · ${ordinal(cycle.day)}`;
  return String(cycle.kind);
}

function ordinal(n) {
  const v = Number(n);
  const suffix = ['th', 'st', 'nd', 'rd'];
  const r = v % 100;
  return `${v}${suffix[(r - 20) % 10] || suffix[r] || suffix[0]}`;
}

/** Whether the payer's cycle falls on this day: every working day, its weekday, or its day of the month. */
export function dueToday(cycle, on = todayIso()) {
  const d = new Date(`${iso(on) || todayIso()}T12:00:00`);
  if (!cycle) return false;
  if (cycle.kind === 'Daily') return d.getDay() !== 0 && d.getDay() !== 6;
  if (cycle.kind === 'Weekly') return DAYS[d.getDay()] === cycle.day;
  if (cycle.kind === 'Monthly') return d.getDate() === Number(cycle.day);
  return false;
}

// --- the ready queue ------------------------------------------------------------------

/** Ready, not stale, and in no open batch — what the next batch takes. */
export function readyQueue(payerId = '') {
  return claims.readyForSubmission().filter((c) => !c.batchId && (!payerId || c.payerId === payerId));
}

const money = (rows) => Math.round(rows.reduce((n, c) => n + (Number(c.totals?.payerShare) || 0), 0) * 100) / 100;

const ageOf = (claim, on = todayIso()) => {
  const from = iso(claim.finalizedAt) || iso(claim.createdAt);
  return from ? Math.max(0, Math.round((Date.parse(on) - Date.parse(from)) / 86400000)) : 0;
};

/** The open batch a payer already has, if any — the queue adds to it rather than opening a second. */
export const openBatchFor = (payerId) => all().find((b) => b.payerId === payerId && isOpen(b)) || null;

/**
 * readyQueueByPayer() → one row per payer with something waiting: count,
 * value, mode, cycle, whether the cycle is due today, the age of the oldest
 * claim and the open batch the claims would join. Due payers first, then by
 * the oldest claim.
 */
export function readyQueueByPayer(on = todayIso()) {
  const byPayer = new Map();
  for (const c of readyQueue()) (byPayer.get(c.payerId) || byPayer.set(c.payerId, []).get(c.payerId)).push(c);
  return [...byPayer.entries()].map(([payerId, rows]) => {
    const profile = profileOf(payerId);
    return {
      payerId,
      payer: payers.get(payerId),
      claims: rows,
      count: rows.length,
      value: money(rows),
      mode: profile.mode,
      cycle: profile.cycle,
      cycleLabel: cycleLabel(profile.cycle),
      dueToday: dueToday(profile.cycle, on),
      oldestAge: Math.max(0, ...rows.map((c) => ageOf(c, on))),
      openBatch: openBatchFor(payerId),
    };
  }).sort((a, b) => Number(b.dueToday) - Number(a.dueToday) || b.oldestAge - a.oldestAge || (a.payer?.nameEn || '').localeCompare(b.payer?.nameEn || ''));
}

// --- reads --------------------------------------------------------------------------------

/** The batches a claim has been in, oldest cycle first — what a claim page and the timeline read. */
export function byClaim(claimNo) {
  return all()
    .filter((b) => b.claimNos.includes(claimNo))
    .map((b) => ({
      batchNo: b.batchNo,
      cycle: b.claimCycles?.[claimNo] || 1,
      status: b.status,
      submittedAt: b.submission?.at || null,
      method: b.submission?.method || null,
      reference: b.submission?.reference || null,
      acknowledgedAt: b.acknowledgment?.at || null,
      rejection: b.rejections.find((r) => r.claimNo === claimNo) || null,
    }))
    .sort((a, b) => a.cycle - b.cycle || String(a.submittedAt || '').localeCompare(String(b.submittedAt || '')));
}

/** The claims a batch holds, resolved. */
export const claimsOf = (batch) => (batch?.claimNos || []).map((no) => claims.get(no)).filter(Boolean);

export const valueOf = (batch) => money(claimsOf(batch));

/** The newest generation: its version, when, by whom and its files. Null before the first. */
export function latestGeneration(batch) {
  const list = batch?.files || [];
  if (!list.length) return null;
  const version = Math.max(...list.map((f) => f.version));
  const set = list.filter((f) => f.version === version);
  return { version, at: set[0].generatedAt, by: set[0].by, files: set };
}

/** Every generation, newest first. */
export function generations(batch) {
  const versions = [...new Set((batch?.files || []).map((f) => f.version))].sort((a, b) => b - a);
  return versions.map((version) => {
    const set = batch.files.filter((f) => f.version === version);
    return { version, at: set[0].generatedAt, by: set[0].by, files: set };
  });
}

/**
 * search(q, { payerId, status, from, to }) — newest first. `status` is one of
 * STATUSES or 'open' (Open + Generated); the text matches the batch number,
 * the payer's name, and any claim number the batch holds.
 */
export function search(q = '', { payerId = '', status = '', from = '', to = '' } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  return all()
    .filter((b) => {
      if (payerId && b.payerId !== payerId) return false;
      if (status === 'open' ? !isOpen(b) : status && b.status !== status) return false;
      if (from && compareDates(b.createdAt, from) < 0) return false;
      if (to && compareDates(b.createdAt, to) > 0) return false;
      if (!needle) return true;
      const payer = payers.get(b.payerId);
      return [b.batchNo, payer?.nameEn, b.submission?.reference, b.acknowledgment?.payerRef, ...b.claimNos]
        .some((v) => String(v || '').toLowerCase().includes(needle));
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function counts(on = todayIso()) {
  const queue = readyQueueByPayer(on);
  return {
    readyValue: money(queue.flatMap((r) => r.claims)),
    readyCount: queue.reduce((n, r) => n + r.count, 0),
    dueToday: queue.filter((r) => r.dueToday).length,
    open: all().filter(isOpen).length,
    rejected: claims.rejectionsWorklist().length,
  };
}

export const history = (batchNo) => audit.forEntity(ENTITY, batchNo);

/** Sequential per year, read off the table: BAT-2026-000143 after the seed. */
export function nextBatchNo(year = new Date().getFullYear()) {
  const prefix = `BAT-${year}-`;
  const max = store.table(TABLE).reduce((n, b) => {
    if (!String(b.batchNo).startsWith(prefix)) return n;
    const digits = Number(String(b.batchNo).slice(prefix.length));
    return Number.isFinite(digits) && digits > n ? digits : n;
  }, 0);
  return `${prefix}${String(max + 1).padStart(6, '0')}`;
}

// --- writes: filling a batch ----------------------------------------------------------------

/** A bare batch row for a payer, pushed but not committed — the seed builds through it too. */
export function rowFor(payerId, { batchNo = null, createdAt = null, by = null } = {}) {
  const no = batchNo || nextBatchNo();
  const row = {
    id: no,
    batchNo: no,
    payerId,
    mode: modeOf(payerId),
    status: 'Open',
    claimNos: [],
    claimCycles: {},
    exclusions: [],
    ejected: [],
    files: [],
    submission: null,
    acknowledgment: null,
    rejections: [],
    createdAt: createdAt || new Date().toISOString(),
    createdBy: by || currentRole().name,
    closedAt: null,
  };
  store.table(TABLE).push(row);
  return row;
}

/**
 * create(payerId) → the batch, filled with every Ready, non-stale claim of
 * the payer that sits in no other open batch. Nothing to fill it with →
 * null, since an empty batch is not a batch.
 */
export function create(payerId) {
  const queue = readyQueue(payerId);
  if (!queue.length) return null;
  const row = rowFor(payerId);
  for (const c of queue) include(row, c);
  store.commit('batches.create');
  log(row, 'Created', `${row.mode} · ${queue.length} claim${queue.length === 1 ? '' : 's'} · ${row.claimNos.join(', ')}`);
  return row;
}

/** addReady(batchNo) → how many of the queue's claims joined an open batch. */
export function addReady(batchNo) {
  const row = get(batchNo);
  if (!row || !isOpen(row)) return 0;
  const queue = readyQueue(row.payerId).filter((c) => !row.exclusions.some((x) => x.claimNo === c.claimNo));
  for (const c of queue) include(row, c);
  if (queue.length) {
    // The files no longer describe the batch: back to Open until generated again.
    row.status = 'Open';
    store.commit('batches.add');
    log(row, 'Claims added', `${queue.length} · ${queue.map((c) => c.claimNo).join(', ')}`);
  }
  return queue.length;
}

function include(row, claim) {
  if (row.claimNos.includes(claim.claimNo)) return;
  row.claimNos.push(claim.claimNo);
  row.claimCycles[claim.claimNo] = claims.cycleOf(claim);
  row.status = 'Open';
  claims.assignBatch(claim.id, row.batchNo, `Included in ${row.batchNo}${claims.cycleOf(claim) > 1 ? ` · cycle ${claims.cycleOf(claim)}` : ''}`);
}

/** exclude(batchNo, claimNo, reason) — while Open or Generated; the claim goes back to the queue. */
export function exclude(batchNo, claimNo, reason = '') {
  const row = get(batchNo);
  const claim = claims.get(claimNo);
  if (!row || !isOpen(row) || !row.claimNos.includes(claimNo) || !String(reason).trim()) return null;
  row.claimNos = row.claimNos.filter((no) => no !== claimNo);
  delete row.claimCycles[claimNo];
  row.exclusions.push({ claimNo, reason: String(reason).trim(), by: currentRole().name, at: new Date().toISOString() });
  if (row.status === 'Generated') row.status = 'Open';
  if (claim) claims.assignBatch(claim.id, null, `Excluded from ${batchNo} — ${String(reason).trim()}`);
  store.commit('batches.exclude');
  log(row, 'Claim excluded', `${claimNo} — ${String(reason).trim()}`);
  return row;
}

/**
 * validate(batchNo) → { ok, ejected[{ claimNo, cause }], blockers[] }. A claim
 * that is no longer Ready — stale, reopened, already in another open batch —
 * is ejected with its cause; a batch left with nothing cannot generate.
 */
export function validate(batchNo) {
  const row = get(batchNo);
  if (!row) return { ok: false, ejected: [], blockers: ['No such batch'] };
  if (!isOpen(row)) return { ok: false, ejected: [], blockers: [`A ${row.status.toLowerCase()} batch is not validated again`] };
  const ejected = [];
  for (const no of [...row.claimNos]) {
    const c = claims.get(no);
    const cause = !c ? 'Claim no longer exists'
      : claims.isStale(c) ? `Stale — ${c.stale?.reason || 'the encounter changed after assembly'}`
        : c.status !== 'Ready' ? `No longer Ready (${c.status.toLowerCase()})`
          : c.batchId && c.batchId !== row.batchNo && isOpen(get(c.batchId)) ? `Already in ${c.batchId}` : '';
    if (!cause) continue;
    row.claimNos = row.claimNos.filter((x) => x !== no);
    delete row.claimCycles[no];
    row.ejected.push({ claimNo: no, cause, at: new Date().toISOString() });
    ejected.push({ claimNo: no, cause });
    if (c && c.batchId === row.batchNo) claims.assignBatch(c.id, null, `Ejected from ${row.batchNo} — ${cause}`);
  }
  const blockers = row.claimNos.length ? [] : ['Nothing left in the batch to generate'];
  if (ejected.length) {
    if (row.status === 'Generated') row.status = 'Open';
    store.commit('batches.validate');
    log(row, 'Validated', `${ejected.length} ejected — ${ejected.map((e) => `${e.claimNo} (${e.cause})`).join('; ')}`);
  }
  return { ok: !blockers.length, ejected, blockers };
}

// --- writes: generate, submit, acknowledge ----------------------------------------------

/**
 * generate(batchNo) → { batch, generation, ejected, error }. Validates first,
 * then writes the mode's files as the next version — every earlier version
 * is kept, and the batch is Generated.
 */
export function generate(batchNo, { at = null, by = null } = {}) {
  const row = get(batchNo);
  if (!row) return { batch: null, generation: null, ejected: [], error: 'No such batch' };
  if (!isOpen(row)) return { batch: row, generation: null, ejected: [], error: `A ${row.status.toLowerCase()} batch is not generated again` };
  const check = validate(batchNo);
  if (!check.ok) return { batch: row, generation: null, ejected: check.ejected, error: check.blockers.join('; ') };
  const version = (latestGeneration(row)?.version || 0) + 1;
  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  const built = files.build(row, claimsOf(row), { version, at: when });
  for (const f of built) row.files.push({ version, generatedAt: when, by: who, ...f });
  row.status = 'Generated';
  store.commit('batches.generate');
  log(row, 'Generated', `v${version} · ${built.map((f) => f.fileName).join(', ')} · ${row.claimNos.length} claim${row.claimNos.length === 1 ? '' : 's'}`);
  return { batch: row, generation: latestGeneration(row), ejected: check.ejected, error: '' };
}

/** Why the batch cannot be marked submitted, or ''. */
export function submitBlocker(batch) {
  if (!batch) return 'No batch';
  if (batch.status === 'Open') return 'Generate the files first';
  if (batch.status !== 'Generated') return `Already ${batch.status.toLowerCase()}`;
  if (!batch.claimNos.length) return 'Nothing in the batch';
  return '';
}

/**
 * markSubmitted(batchNo, { method, reference, at }) → the batch, Submitted
 * on the latest file version; every claim moves to Submitted on its cycle,
 * and afterSubmitHooks hear about it.
 */
export function markSubmitted(batchNo, { method = '', reference = '', at = null, by = null } = {}) {
  const row = get(batchNo);
  const why = submitBlocker(row);
  if (why) return null;
  if (!method) return null;
  const when = at || new Date().toISOString();
  row.submission = { at: when, by: by || currentRole().name, method, reference: String(reference || '').trim(), fileVersion: latestGeneration(row)?.version || null };
  row.status = 'Submitted';
  for (const c of claimsOf(row)) claims.markSubmitted(c.id, { batchNo: row.batchNo, at: when, method, reference: row.submission.reference });
  store.commit('batches.submit');
  log(row, 'Submitted', `${method}${row.submission.reference ? ` · ${row.submission.reference}` : ''} · v${row.submission.fileVersion} · ${row.claimNos.length} claim${row.claimNos.length === 1 ? '' : 's'}`);
  fire(afterSubmitHooks, { batchNo: row.batchNo, claimNos: [...row.claimNos], at: when });
  return row;
}

/**
 * reconcile(batch, ack) → { ok, included, received, accepted, rejected, ejected,
 * problems[] } — the strip the acknowledgment form shows and the gate
 * acknowledge() refuses on. `ack.rejections` names the rejected claims,
 * `ack.notReceived` the ones the payer never got; the typed counts have to
 * agree with both.
 */
export function reconcile(batch, ack = {}) {
  const included = batch?.claimNos.length || 0;
  const rejections = ack.rejections || [];
  const notReceived = ack.notReceived || [];
  const received = Number(ack.receivedCount);
  const accepted = Number(ack.acceptedCount);
  const rejected = Number(ack.rejectedCount);
  const ejected = Number.isFinite(received) ? included - received : notReceived.length;
  const problems = [];
  if (!Number.isFinite(received) || received < 0) problems.push('Enter how many claims the payer received.');
  if (!Number.isFinite(accepted) || accepted < 0) problems.push('Enter how many were accepted.');
  if (!Number.isFinite(rejected) || rejected < 0) problems.push('Enter how many were rejected.');
  if (problems.length) return { ok: false, included, received, accepted, rejected, ejected, problems };
  if (received > included) problems.push(`The payer cannot have received ${received} of ${included} claims.`);
  if (accepted + rejected !== received) problems.push(`Accepted ${accepted} + rejected ${rejected} is not the ${received} received.`);
  if (rejections.length !== rejected) problems.push(`${rejections.length} claim${rejections.length === 1 ? '' : 's'} marked rejected, but the count says ${rejected}.`);
  if (notReceived.length !== ejected) problems.push(`${notReceived.length} claim${notReceived.length === 1 ? '' : 's'} marked not received, but ${ejected} ${ejected === 1 ? 'is' : 'are'} missing.`);
  for (const r of rejections) {
    if (!batch.claimNos.includes(r.claimNo)) problems.push(`${r.claimNo} is not in this batch.`);
    if (!r.code) problems.push(`${r.claimNo}: choose a rejection code.`);
    if (notReceived.includes(r.claimNo)) problems.push(`${r.claimNo} cannot be both rejected and not received.`);
  }
  return { ok: !problems.length && accepted + rejected + ejected === included, included, received, accepted, rejected, ejected, problems };
}

/**
 * acknowledge(batchNo, ack) → { batch, error }. Blocked unless the
 * reconciliation holds. Accepted claims are Acknowledged, rejected ones go
 * through reject(), and a claim the payer never received is ejected back to
 * Ready for the next batch. The batch reads Acknowledged, Partially Rejected
 * or Rejected by what came back.
 */
export function acknowledge(batchNo, ack = {}) {
  const row = get(batchNo);
  if (!row) return { batch: null, error: 'No such batch' };
  if (row.status !== 'Submitted' && row.status !== 'Partially Rejected') return { batch: row, error: `A ${row.status.toLowerCase()} batch is not acknowledged` };
  if (row.acknowledgment) return { batch: row, error: 'Already acknowledged' };
  const r = reconcile(row, ack);
  if (!r.ok) return { batch: row, error: r.problems[0] || 'The counts do not reconcile' };
  const when = ack.at || new Date().toISOString();
  const who = ack.by || currentRole().name;
  const rejectedNos = new Set((ack.rejections || []).map((x) => x.claimNo));
  const missing = new Set(ack.notReceived || []);
  const accepted = [];
  const rejected = [];
  row.acknowledgment = {
    at: when, payerRef: String(ack.payerRef || '').trim(), receivedCount: r.received, acceptedCount: r.accepted,
    rejectedCount: r.rejected, document: ack.document || null, by: who,
  };
  for (const no of [...row.claimNos]) {
    const c = claims.get(no);
    if (!c) continue;
    if (missing.has(no)) {
      row.claimNos = row.claimNos.filter((x) => x !== no);
      delete row.claimCycles[no];
      row.ejected.push({ claimNo: no, cause: 'Not received by the payer', at: when });
      claims.unsubmit(c.id, `Not received by the payer — ejected from ${row.batchNo}`);
      continue;
    }
    if (rejectedNos.has(no) || c.status === 'Rejected') {
      rejected.push(no);
      continue;
    }
    if (c.status === 'Submitted') claims.markAcknowledged(c.id, { batchNo: row.batchNo, at: when, payerRef: row.acknowledgment.payerRef });
    accepted.push(no);
  }
  row.status = 'Acknowledged';
  store.commit('batches.acknowledge');
  log(row, 'Acknowledged', `${row.acknowledgment.payerRef ? `${row.acknowledgment.payerRef} · ` : ''}received ${r.received} · accepted ${r.accepted} · rejected ${r.rejected}${
    r.ejected ? ` · ${r.ejected} not received, back to the queue` : ''}`);
  for (const x of ack.rejections || []) {
    if (!claims.get(x.claimNo)?.rejection) reject(row.batchNo, x.claimNo, x.code, x.reason, x.document, { at: when, by: who, quiet: true });
  }
  settleStatus(row);
  store.commit('batches.acknowledge');
  fire(afterAckHooks, { batchNo: row.batchNo, accepted, rejected, at: when });
  return { batch: row, error: '' };
}

/**
 * reject(batchNo, claimNo, code, reason, document) → the batch. The claim is
 * Rejected with the code, the batch Partially Rejected or Rejected, and
 * afterRejectHooks hear about it. Allowed on any batch that went out.
 */
export function reject(batchNo, claimNo, code, reason = '', document = null, { at = null, by = null, quiet = false } = {}) {
  const row = get(batchNo);
  const c = claims.get(claimNo);
  if (!row || !c || !ANSWERABLE.includes(row.status) || !row.claimNos.includes(claimNo) || !code) return null;
  if (!['Submitted', 'Acknowledged'].includes(c.status)) return null;
  const when = at || new Date().toISOString();
  const text = String(reason || '').trim() || rejectionLabel(code);
  row.rejections.push({ claimNo, code, reason: text, document: document || null, at: when, by: by || currentRole().name });
  claims.markRejected(c.id, { batchNo: row.batchNo, code, reason: text, at: when });
  if (!quiet) settleStatus(row);
  store.commit('batches.reject');
  log(row, 'Rejection recorded', `${claimNo} — ${code} ${rejectionLabel(code)}${text !== rejectionLabel(code) ? ` — ${text}` : ''}`);
  fire(afterRejectHooks, { claimNo, code, at: when });
  return row;
}

/** Acknowledged, Partially Rejected or Rejected, by what the claims say now. */
function settleStatus(row) {
  if (!row.acknowledgment && row.status === 'Submitted' && !row.rejections.length) return;
  const rejectedNow = row.claimNos.filter((no) => row.rejections.some((r) => r.claimNo === no)).length;
  if (!rejectedNow) row.status = row.acknowledgment ? 'Acknowledged' : row.status;
  else row.status = rejectedNow >= row.claimNos.length ? 'Rejected' : 'Partially Rejected';
}

/** Why the batch cannot close, or ''. A batch closes once every rejection has been taken up. */
export function closeBlocker(batch) {
  if (!batch) return 'No batch';
  if (!['Acknowledged', 'Partially Rejected', 'Rejected'].includes(batch.status)) return 'Only an acknowledged batch closes';
  const open = claimsOf(batch).filter((c) => c.status === 'Rejected');
  return open.length ? `${open.length} rejected claim${open.length === 1 ? '' : 's'} still to fix` : '';
}

export function close(batchNo) {
  const row = get(batchNo);
  if (closeBlocker(row)) return null;
  row.status = 'Closed';
  row.closedAt = new Date().toISOString();
  store.commit('batches.close');
  log(row, 'Closed', `${row.claimNos.length} claim${row.claimNos.length === 1 ? '' : 's'} · ${row.rejections.length} rejection${row.rejections.length === 1 ? '' : 's'} taken up`);
  return row;
}

// --- fix & resubmit ----------------------------------------------------------------------

/**
 * fixPlan(claim) → { route, label, href, immediate, note } — what Fix & Resubmit
 * will do, for the confirm dialog. A claim assembled from a visit goes back to
 * draft and is fixed on the portfolio; a claim with no visit behind it has
 * nothing to re-assemble, so it is resubmitted as filed once the desk has
 * made the fix the route points at.
 */
export function fixPlan(claim) {
  const code = claim?.rejection?.code;
  const reason = rejectionReason(code);
  const route = fixRouteOf(code);
  const hasVisit = Boolean(claim?.encounterNo);
  const href = route === 'Policy' ? `#/frontis/patients/${claim.patientMrn}/insurance`
    : route === 'Contract' && claim.contractId ? `#/pactum/contracts/${claim.contractId}/preauth`
      : `#/claima/claims/${claim.claimNo}`;
  const hrefLabel = route === 'Policy' ? 'Open the Insurance tab' : route === 'Contract' ? 'Open the contract' : 'Open the claim';
  const immediate = !hasVisit || route === 'Policy' || route === 'Contract' || route === 'Review';
  const note = !hasVisit
    ? 'This claim has no visit to re-assemble from, so it is resubmitted as filed on the next cycle and joins the payer’s open batch.'
    : route === 'Refresh' ? 'The claim goes back to draft and is re-assembled from the visit; scrub it and finalize it again to resubmit.'
      : route === 'Recode' ? 'A recode request is raised on the chart; the claim goes back to draft and is refreshed once the coder answers.'
        : 'The claim is resubmitted as filed on the next cycle once the fix is made, and joins the payer’s open batch.';
  return { route, label: reason?.fixLabel || 'Read the claim', href, hrefLabel, immediate, note, code, reason: claim?.rejection?.reason || '' };
}

/**
 * fixAndResubmit(claimNo) → { claim, plan, error }. Routes by the reason's
 * fixRoute: Refresh re-assembles the draft, Recode raises a recode request
 * on the chart, and the rest point at where the fix is made; a claim with
 * nothing to re-assemble goes straight to Ready on the next cycle and joins
 * the payer's open batch when there is one.
 */
export async function fixAndResubmit(claimNo) {
  const claim = claims.get(claimNo);
  if (!claim || claim.status !== 'Rejected') return { claim, plan: null, error: 'Only a rejected claim is resubmitted' };
  const plan = fixPlan(claim);
  const opened = claims.openForFix(claim.id, `${plan.code} — ${rejectionLabel(plan.code)} · fix: ${plan.route}`);
  if (!opened) return { claim, plan, error: 'The claim could not be reopened' };
  if (plan.route === 'Recode' && claim.encounterNo) {
    try {
      const coding = await import('./coding.js');
      coding.requestRecode?.(claim.encounterNo, { source: 'Denial', ref: claim.claimNo, reason: `Rejected ${plan.code} — ${plan.reason || rejectionLabel(plan.code)}` });
    } catch (err) {
      console.warn('[batches] coding peer not loaded', err);
    }
  }
  if (plan.route === 'Refresh' && claim.encounterNo) claims.refresh(claim.id);
  if (plan.immediate) {
    claim.finalizedAt = new Date().toISOString();
    claims.setStatus(claim.id, 'Ready', { reason: 'Resubmitted as filed', details: `${plan.route} fix made at the desk` });
  }
  return { claim: claims.get(claimNo), plan, error: '' };
}

// --- reactions --------------------------------------------------------------------------------
// A claim finalized again after a rejection moves to its next cycle and joins
// the payer's open batch; the subscription reacts to the claims repository's
// status commits and never to its own.

let reacting = false;
store.subscribe((reason) => {
  if (reason !== 'claims.status' || reacting) return;
  reacting = true;
  try {
    for (const c of claims.all()) {
      if (c.status !== 'Ready' || !c.rejectedCycle || c.rejectedCycle.cycle !== claims.cycleOf(c)) continue;
      claims.resubmit(c.claimNo);
      const open = openBatchFor(c.payerId);
      if (open) {
        include(open, c);
        store.commit('batches.add');
        log(open, 'Claims added', `${c.claimNo} · cycle ${claims.cycleOf(c)} — resubmission`);
      }
    }
  } finally {
    reacting = false;
  }
});

// --- internals -------------------------------------------------------------------------------

function fire(hooks, payload) {
  for (const fn of hooks) {
    try { fn(payload); } catch (err) { console.warn('[batches] hook failed', err); }
  }
}

function log(row, action, details = '', { user, at } = {}) {
  if (at) {
    audit.all().push({ id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: row.batchNo, action, user: user || 'Tarek Solh', at, details });
    return;
  }
  audit.log({ entity: ENTITY, entityId: row.batchNo, action, details, user });
}

/**
 * The seed writes through the repository's own row factory and trail, with
 * its own dates, and never commits. A reset empties the table and the next
 * read seeds it again.
 */
function seed(rows) {
  if (rows.length) return;
  buildBatches({ rowFor, log, files });
}

// --- A32: claim nullification -------------------------------------------------------

/**
 * removeClaim(batchNo, claimNo, reason, { at, by }) → the batch, or null. A
 * nullified claim leaves the open batch it was waiting in: the same shape as
 * an exclusion — recorded on the batch, the claim unbatched, a Generated
 * batch back to Open since its files no longer describe it — but the reason
 * is the nullification's and the trail says so. Open or Generated only; a
 * batch that has gone to the payer keeps the claim in its history.
 */
export function removeClaim(batchNo, claimNo, reason = '', { at = null, by = null } = {}) {
  const row = get(batchNo);
  const claim = claims.get(claimNo);
  if (!row || !isOpen(row) || !row.claimNos.includes(claimNo)) return null;
  const why = String(reason || '').trim() || 'Nullified';
  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  row.claimNos = row.claimNos.filter((no) => no !== claimNo);
  delete row.claimCycles[claimNo];
  row.exclusions.push({ claimNo, reason: why, by: who, at: when });
  if (row.status === 'Generated') row.status = 'Open';
  if (claim) claims.assignBatch(claim.id, null, `Removed from ${batchNo} — ${why}`);
  store.commit('batches.remove');
  log(row, 'Claim removed', `${claimNo} — ${why}`, { user: who, at });
  return row;
}
