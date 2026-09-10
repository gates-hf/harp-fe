// Repository — pre-authorisation requests. Owner: modules/frontis.
//
// Pactum's matrix, the eligibility ladder and a cost estimate all say the same
// thing in three places: this charge needs the payer's approval. None of them
// gets it. That is what a request is — the flag turned into a piece of work
// with a life of its own: raised, sent, answered, and good until a date.
//
// Two rules shape the whole file. A request is a draft until it is submitted,
// and submitting freezes what was asked for: the services and the justification
// are the evidence a payer answered against, so nothing moves them afterwards.
// And an answer is spent, not held — an approval carries a quantity and a
// validity, billing consumes against it, and `activeFor` is the one question
// everything downstream asks: is this charge covered by an approval, right now,
// with something left on it.
//
// The dataset seeds itself on first read (data/seed/preauth-requests.js) rather
// than through data/store.js: a request reads the register, the policy chains,
// the charge master, the contracts, the board and the estimates to exist — the
// shape data/seed/referrals.js already uses.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as patients from './patients.js';
import * as policies from './policies.js';
import * as payers from './payers.js';
import * as cdm from './cdm.js';
import * as encounters from './encounters.js';
import { authorizationHooks } from '../engines/eligibility-engine.js';
import { buildPreauthRequests, buildPreauthTrail } from '../seed/preauth-requests.js';
import { CONFIG as PLATFORM } from '../../shared/config.js';
import { current as currentRole } from '../../shared/roles.js';
import { compareDates, date as showDate, iso, todayIso, withinDates } from '../../shared/format.js';

const TABLE = 'preauthRequests';

/** The trail is keyed on this entity name; a request's id is its number. */
const ENTITY = 'preauth';

export const STATUSES = [
  'Draft', 'Submitted', 'Approved', 'Partially Approved', 'Denied', 'Expired', 'Cancelled',
];

/** The three answers a payer gives. Everything else is a state of the request. */
export const RESULTS = ['Approved', 'Partially Approved', 'Denied'];

export const PRIORITIES = ['Routine', 'Urgent'];

export const DOC_KINDS = ['Supporting', 'Payer response'];

export const CHANNELS = ['Phone', 'Portal', 'Email', 'Fax'];

export const DIRECTIONS = ['Out', 'In'];

/**
 * Why a payer refused. MEMBER_INELIG is deliberately the code the claims seed
 * uses, so a pre-auth refused for eligibility and a claim denied for it rank
 * together when Defensio reads both; the rest are the reasons a request is
 * refused before the service happens, which a claim never sees.
 */
export const DENIAL_REASONS = [
  { code: 'NOT_MEDICALLY_NEC', label: 'Not medically necessary' },
  { code: 'INSUFFICIENT_DOC', label: 'Insufficient documentation' },
  { code: 'NOT_COVERED', label: 'Service not covered by the plan' },
  { code: 'OUT_OF_NETWORK', label: 'Provider out of network' },
  { code: 'ALT_TREATMENT_REQUIRED', label: 'Alternative treatment required first' },
  { code: 'LATE_REQUEST', label: 'Requested after the service' },
  { code: 'MEMBER_INELIG', label: 'Member ineligible' },
  { code: 'OTHER', label: 'Other' },
];

export const denialLabel = (code) => DENIAL_REASONS.find((r) => r.code === code)?.label || '—';

export const CONFIG = {
  // Past this, an urgent request that has had no answer is shown red: the payer
  // agreed to answer an urgent request inside three working days.
  urgentChaseDays: 3,
  // How near its end an approval starts asking to be renewed.
  expiringDays: PLATFORM.preauthExpiryWarnDays,
};

export function all() {
  const rows = store.table(TABLE);
  if (!rows.length) {
    rows.push(...buildPreauthRequests());
    // The seeded register's own trail, written with the times the events
    // happened at. audit.log() would stamp every one of them with now and with
    // whoever is signed in, which is not what a history is.
    const trail = audit.all();
    for (const item of buildPreauthTrail(rows)) {
      trail.push({ id: store.nextId('audit', 'AU-'), ...item });
    }
  }
  return rows;
}

export const get = (no) => all().find((row) => row.no === no) || null;

export const isDraft = (row) => row?.status === 'Draft';

/** With the payer and not yet answered — the only state a decision lands on. */
export const isPending = (row) => row?.status === 'Submitted';

/** Answered yes, in whole or in part: the two states that authorise anything. */
export const isAuthorized = (row) =>
  row?.status === 'Approved' || row?.status === 'Partially Approved';

export function statusTone(status) {
  if (status === 'Approved') return 'success';
  if (status === 'Submitted') return 'accent';
  if (status === 'Partially Approved' || status === 'Expired') return 'warning';
  if (status === 'Denied' || status === 'Cancelled') return 'critical';
  return '';
}

// --- reading ------------------------------------------------------------------

export const patientName = (row) => patients.get(row?.patientMrn)?.nameEn || row?.patientMrn || '—';

/** The cover in words — the policy on the chain, or the payer and plan alone. */
export function coverLabel(row) {
  const policy = row?.policyId ? policies.get(row.policyId) : null;
  if (policy) return policies.label(policy);
  const payer = payers.get(row?.payerId);
  const plan = payer?.plans.find((p) => p.id === row?.planId);
  if (!payer) return 'Self-Pay';
  return `${payer.nameEn}${plan ? ` · ${plan.name}` : ''}`;
}

/** "MRI brain, Surgeon time +1" — the services column, first two and a count. */
export function servicesLabel(row) {
  const names = (row?.services || []).map((s) => cdm.label(cdm.get(s.itemId))).filter(Boolean);
  if (!names.length) return 'No services';
  const shown = names.slice(0, 2).join(', ');
  return names.length > 2 ? `${shown} +${names.length - 2}` : shown;
}

export const serviceLabel = (service) => cdm.label(cdm.get(service?.itemId)) || '—';

/** What was asked for, and what came back — the two figures a page compares. */
export const requestedTotal = (row) =>
  round((row?.services || []).reduce((n, s) => n + (Number(s.requestedAmount) || 0), 0));

export const approvedTotal = (row) =>
  round((row?.services || []).reduce((n, s) => n + (Number(s.approvedAmount) || 0), 0));

/** The quantity this line was authorised for — the requested one if untouched. */
export const authorizedQty = (service) =>
  (service?.approvedQty === null || service?.approvedQty === undefined
    ? Number(service?.qty) || 0
    : Number(service.approvedQty) || 0);

/** What is left on one authorised line: what was allowed, less what was used. */
export function remainingFor(row, itemId) {
  const service = (row?.services || []).find((s) => s.itemId === itemId);
  if (!service || service.lineDecision === 'Denied') return 0;
  const used = Number(row?.consumption?.usedQty?.[itemId]) || 0;
  return Math.max(0, authorizedQty(service) - used);
}

export const usedFor = (row, itemId) => Number(row?.consumption?.usedQty?.[itemId]) || 0;

/** Days left on the validity, or null when the request carries none. */
export function daysLeft(row, on = todayIso()) {
  const to = iso(row?.decision?.validTo);
  if (!to) return null;
  return Math.round((Date.parse(to) - Date.parse(iso(on) || todayIso())) / 86400000);
}

export const isExpiring = (row, on = todayIso()) => {
  if (!isAuthorized(row)) return false;
  const left = daysLeft(row, on);
  return left !== null && left >= 0 && left <= CONFIG.expiringDays;
};

/** How long a submitted request has been unanswered, in days. */
export function pendingDays(row) {
  if (!row?.submittedAt) return null;
  return Math.floor((Date.now() - Date.parse(row.submittedAt)) / 86400000);
}

/** An urgent request the payer has sat on past the turnaround it agreed to. */
export const isOverdue = (row) =>
  isPending(row) && row.priority === 'Urgent' && (pendingDays(row) || 0) > CONFIG.urgentChaseDays;

/** One patient's requests, newest first — what the record's section lists. */
export const byPatient = (mrn) =>
  all()
    .filter((row) => row.patientMrn === mrn)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

/** The requests hung off one encounter, oldest first. */
export const byEncounter = (no) =>
  all()
    .filter((row) => row.encounterNo === no)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

/**
 * The whole resubmission and renewal chain one request sits in, oldest first.
 * Both ends are stored, so this walks back to the first and forward from it.
 */
export function chainOf(no) {
  const row = get(no);
  if (!row) return [];
  let first = row;
  const seen = new Set([row.no]);
  while (first.predecessorNo && !seen.has(first.predecessorNo)) {
    const before = get(first.predecessorNo);
    if (!before) break;
    seen.add(before.no);
    first = before;
  }
  const chain = [first];
  let next = first.successorNo ? get(first.successorNo) : null;
  while (next && !chain.includes(next)) {
    chain.push(next);
    next = next.successorNo ? get(next.successorNo) : null;
  }
  return chain;
}

/**
 * The authorisation covering one charge for one patient on one day, or null.
 * This is the question every screen downstream asks — the eligibility ladder,
 * the estimate's flags, the clearance desk and billing — so it is the one place
 * "authorised" is defined: answered yes, in date, and with something left.
 */
export function activeFor(mrn, itemId, on = todayIso()) {
  const day = iso(on) || todayIso();
  const found = byPatient(mrn).find((row) => {
    if (!isAuthorized(row) || !row.decision) return false;
    if (!withinDates(day, row.decision.validFrom, row.decision.validTo)) return false;
    return remainingFor(row, itemId) > 0;
  });
  if (!found) return null;
  return {
    no: found.no,
    authNumber: found.decision.authNumber,
    validFrom: found.decision.validFrom,
    validTo: found.decision.validTo,
    remaining: remainingFor(found, itemId),
  };
}

/** Everything the desk still owes somebody: a draft, an answer, or a renewal. */
export const needsAction = (on = todayIso()) =>
  all().filter((row) => isDraft(row) || isPending(row) || isExpiring(row, on));

/**
 * search(q, filters) — the worklist's one query, newest first. `view` is the
 * toggle: the work still outstanding, or the whole register.
 */
export function search(q = '', {
  view = 'action', status = '', payerId = '', from = '', to = '', expiring = '',
} = {}) {
  const needle = String(q).trim().toLowerCase();
  const on = todayIso();
  const within = Number(expiring) || 0;
  const outstanding = new Set(needsAction(on).map((row) => row.no));
  return all()
    .filter((row) => {
      if (view === 'action' && !outstanding.has(row.no)) return false;
      if (status && row.status !== status) return false;
      if (payerId && row.payerId !== payerId) return false;
      if (within) {
        const left = daysLeft(row, on);
        if (!isAuthorized(row) || left === null || left < 0 || left > within) return false;
      }
      const day = String(row.createdAt).slice(0, 10);
      if (from && compareDates(day, from) < 0) return false;
      if (to && compareDates(day, to) > 0) return false;
      if (!needle) return true;
      return [row.no, row.patientMrn, patientName(row), row.decision?.authNumber, row.encounterNo]
        .some((v) => String(v || '').toLowerCase().includes(needle));
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || b.no.localeCompare(a.no));
}

/** The rail's figures, read off whatever list the worklist is showing. */
export function counts(rows = all()) {
  const on = todayIso();
  const month = on.slice(0, 7);
  return {
    action: rows.filter((row) => isDraft(row) || isPending(row) || isExpiring(row, on)).length,
    submitted: rows.filter(isPending).length,
    expiring: rows.filter((row) => isExpiring(row, on)).length,
    denied: rows.filter((row) =>
      row.status === 'Denied' && String(row.decision?.capturedAt || '').slice(0, 7) === month).length,
  };
}

/** Next number in this year's sequence, read off the register itself. */
export function nextNo(year = new Date().getFullYear()) {
  const prefix = `PA-${year}-`;
  const max = all().reduce((n, row) => {
    if (!String(row.no).startsWith(prefix)) return n;
    const digits = Number(String(row.no).slice(prefix.length));
    return Number.isFinite(digits) && digits > n ? digits : n;
  }, 0);
  return prefix + String(max + 1).padStart(6, '0');
}

// --- writes -------------------------------------------------------------------

export function create(data = {}) {
  const now = new Date().toISOString();
  const row = {
    no: nextNo(),
    status: 'Draft',
    patientMrn: '',
    policyId: null,
    payerId: null,
    planId: null,
    encounterNo: null,
    estimateNo: null,
    snapshotRef: null,
    services: [],
    diagnosis: '',
    justification: '',
    doctorId: '',
    priority: 'Routine',
    documents: [],
    submittedAt: null,
    submittedBy: null,
    decision: null,
    consumption: { usedQty: {} },
    predecessorNo: null,
    successorNo: null,
    communications: [],
    ...data,
    createdAt: now,
    createdBy: currentRole().name,
    updatedAt: now,
  };
  all().push(row);
  store.commit('preauth.create');
  log(row, 'Created',
    `${patientName(row)} — ${row.services.length} service${row.services.length === 1 ? '' : 's'}, ${
      row.priority.toLowerCase()}`);
  return row;
}

/** A draft is the only thing that moves; everything else is evidence. */
export function updateDraft(no, patch = {}, { details = 'Draft saved' } = {}) {
  const row = get(no);
  if (!row || !isDraft(row)) return null;
  const { no: ignored, status, decision, documents, communications, consumption, ...rest } = patch;
  Object.assign(row, rest, { updatedAt: new Date().toISOString() });
  store.commit('preauth.update');
  log(row, 'Updated', details);
  return row;
}

/**
 * Send it. The services and the justification stop moving here: they are what
 * the payer answered against, and a decision captured against something else is
 * a decision about nothing.
 */
export function submit(no) {
  const row = get(no);
  if (!row || !isDraft(row) || !row.services.length) return null;
  const now = new Date().toISOString();
  row.status = 'Submitted';
  row.submittedAt = now;
  row.submittedBy = currentRole().name;
  row.updatedAt = now;
  store.commit('preauth.submit');
  log(row, 'Submitted',
    `${row.services.length} service${row.services.length === 1 ? '' : 's'} and the justification locked · ${
      row.priority.toLowerCase()}`);
  return row;
}

/**
 * The payer's answer. The result sets the status, the per-line grid rides in
 * `services` and the encounter — if there is one — gains the request, so the
 * visit shows what is holding it.
 */
export function captureDecision(no, decision = {}) {
  const row = get(no);
  if (!row || !isPending(row) || !RESULTS.includes(decision.result)) return null;

  const now = new Date().toISOString();
  const denied = decision.result === 'Denied';
  row.decision = {
    result: decision.result,
    authNumber: denied ? null : decision.authNumber || null,
    validFrom: denied ? null : iso(decision.validFrom) || null,
    validTo: denied ? null : iso(decision.validTo) || null,
    denialReasonCode: decision.denialReasonCode || null,
    capturedAt: now,
    capturedBy: currentRole().name,
    note: decision.note || '',
  };
  if (Array.isArray(decision.services)) applyLines(row, decision.services, denied);
  else for (const service of row.services) straightThrough(service, denied);
  row.status = decision.result;
  row.updatedAt = now;
  if (decision.document) pushDocument(row, { ...decision.document, kind: 'Payer response' });
  store.commit('preauth.decision');
  log(row, 'Decision captured',
    `${decision.result}${row.decision.authNumber ? ` · ${row.decision.authNumber}` : ''}${
      row.decision.validTo ? ` · valid ${row.decision.validFrom} to ${row.decision.validTo}` : ''}${
      row.decision.denialReasonCode ? ` · ${denialLabel(row.decision.denialReasonCode)}` : ''}`);
  if (row.encounterNo) encounters.linkRecord(row.encounterNo, 'preAuth', row.no);
  return row;
}

/** The per-service grid a partial decision writes back onto the request. */
function applyLines(row, lines, denied) {
  for (const service of row.services) {
    const answer = lines.find((line) => line.itemId === service.itemId);
    if (!answer) {
      straightThrough(service, denied);
      continue;
    }
    const qty = Math.max(0, Number(answer.approvedQty) || 0);
    service.approvedQty = denied ? null : qty;
    service.approvedAmount = denied ? null : round(Number(answer.approvedAmount) || 0);
    service.lineDecision = denied ? 'Denied' : (answer.lineDecision || (qty ? 'Approved' : 'Denied'));
    service.lineReason = answer.lineReason || null;
  }
}

/** A line nobody touched was allowed exactly as it was asked for. */
function straightThrough(service, denied) {
  service.approvedQty = denied ? null : service.qty;
  service.approvedAmount = denied ? null : service.requestedAmount;
  service.lineDecision = denied ? 'Denied' : 'Approved';
}

export function cancel(no, reason = '') {
  const row = get(no);
  if (!row || !(isDraft(row) || isPending(row))) return null;
  const was = row.status;
  row.status = 'Cancelled';
  row.cancelReason = reason;
  row.updatedAt = new Date().toISOString();
  store.commit('preauth.cancel');
  log(row, 'Cancelled', `${was} → Cancelled${reason ? ` — ${reason}` : ''}`);
  return row;
}

/**
 * Ask again. A renewal follows an approval that has run out or is about to; a
 * resubmission follows a refusal. They are the same act — a fresh draft holding
 * everything the last one held — and differ only in what the trail calls it,
 * which is what the reader of a chain needs to know.
 */
export const renew = (no) => copyForward(no, 'renew');

export const resubmit = (no) => copyForward(no, 'resubmit');

function copyForward(no, kind) {
  const source = get(no);
  if (!source || source.successorNo) return null;
  const renewal = kind === 'renew';
  if (renewal ? !isAuthorized(source) && source.status !== 'Expired' : source.status !== 'Denied') return null;

  const copy = create({
    patientMrn: source.patientMrn,
    policyId: source.policyId,
    payerId: source.payerId,
    planId: source.planId,
    encounterNo: source.encounterNo,
    estimateNo: source.estimateNo,
    snapshotRef: source.snapshotRef,
    // A renewal asks for what is left; a resubmission asks again for the whole
    // thing, because the payer refused the request rather than trimming it.
    services: source.services.map((service) => ({
      itemId: service.itemId,
      qty: renewal ? Math.max(1, remainingFor(source, service.itemId) || service.qty) : service.qty,
      requestedAmount: service.requestedAmount,
      approvedQty: null,
      approvedAmount: null,
      lineDecision: null,
      lineReason: null,
    })),
    diagnosis: source.diagnosis,
    justification: source.justification,
    doctorId: source.doctorId,
    priority: source.priority,
    documents: source.documents
      .filter((doc) => doc.kind === 'Supporting')
      .map((doc, i) => ({ ...doc, id: `${doc.id}-C${i + 1}` })),
    predecessorNo: source.no,
  });

  source.successorNo = copy.no;
  source.updatedAt = new Date().toISOString();
  store.commit('preauth.chain');
  const word = renewal ? 'Renewed' : 'Resubmitted';
  log(source, word, `${word} as ${copy.no}`);
  log(copy, word, `${renewal ? 'Renewal' : 'Resubmission'} of ${source.no}`);
  return copy;
}

/** A call, a portal note, a fax. Always available — chasing never stops. */
export function logCommunication(no, { channel, direction, note }) {
  const row = get(no);
  if (!row || !CHANNELS.includes(channel) || !DIRECTIONS.includes(direction) || !note) return null;
  const entry = {
    id: `PAC-${row.no.slice(-6)}-${row.communications.length + 1}`,
    at: new Date().toISOString(),
    by: currentRole().name,
    channel,
    direction,
    note,
  };
  row.communications = [...row.communications, entry];
  row.updatedAt = entry.at;
  store.commit('preauth.communication');
  log(row, 'Communication', `${channel} ${direction === 'Out' ? 'out' : 'in'} — ${note}`);
  return entry;
}

/** The demo keeps a document's name and size, never the bytes. */
export function addDocument(no, { kind, fileName, size }) {
  const row = get(no);
  if (!row || !DOC_KINDS.includes(kind) || !fileName) return null;
  const doc = pushDocument(row, { kind, fileName, size });
  row.updatedAt = doc.uploadedAt;
  store.commit('preauth.document');
  log(row, 'Document added', `${kind} — ${fileName}`);
  return doc;
}

function pushDocument(row, { kind, fileName, size }) {
  const doc = {
    id: `PAD-${row.no.slice(-6)}-${row.documents.length + 1}`,
    kind,
    fileName,
    size: Number(size) || 0,
    uploadedBy: currentRole().name,
    uploadedAt: new Date().toISOString(),
  };
  row.documents = [...row.documents, doc];
  return doc;
}

/**
 * Billing spends an approval as it posts the charge. Nothing in the demo calls
 * it yet — the seed writes two rows part-consumed so the Remaining column has
 * something to say — but this is the one write that moves the counter, so the
 * arithmetic behind `activeFor` lives in one place.
 */
export function consume(no, itemId, qty = 1) {
  const row = get(no);
  if (!row || !isAuthorized(row) || !itemId) return null;
  const used = { ...(row.consumption?.usedQty || {}) };
  used[itemId] = (Number(used[itemId]) || 0) + Math.max(1, Number(qty) || 1);
  row.consumption = { usedQty: used };
  row.updatedAt = new Date().toISOString();
  store.commit('preauth.consume');
  log(row, 'Consumed',
    `${cdm.label(cdm.get(itemId))} — ${used[itemId]} of ${authorizedQty(
      row.services.find((s) => s.itemId === itemId))} used`);
  return row;
}

/**
 * Approvals past their validity, retired on load. An expired authorisation is
 * not wrong, it is old: the request stays readable, says so on its face, and is
 * the thing Renew copies forward.
 */
export function expireAuths(on = todayIso()) {
  let closed = 0;
  for (const row of all()) {
    if (!isAuthorized(row) || !row.decision?.validTo) continue;
    if (compareDates(row.decision.validTo, on) >= 0) continue;
    const was = row.status;
    row.status = 'Expired';
    row.updatedAt = new Date().toISOString();
    log(row, 'Expired', `${was} — validity ended ${row.decision.validTo}`);
    closed += 1;
  }
  if (closed) store.commit('preauth.expire');
  return closed;
}

// --- hooks --------------------------------------------------------------------

/**
 * The ladder and the estimate ask whether a flagged charge is already
 * authorised. Registering the lookup here rather than letting the engine import
 * this file is what keeps the engine a leaf — it asks the question and never
 * learns what a request is.
 */
authorizationHooks.push((mrn, itemId, on) => activeFor(mrn, itemId, on));

// What a pre-authorisation owes the clearance desk used to be pushed onto the
// encounter from here, through `encounters.clearanceFlagHooks`. Amendment 20
// took that over: financial clearance is computed now, and its engine asks this
// file the same three questions directly — `byEncounter()` for a request
// against the visit, `activeFor()` for an authorisation in force, and the
// statuses for one that lapsed or was refused. The same four sentences come out
// on the checklist, where the rest of the items are.

/**
 * Requests follow the patient when two records are folded together: an approval
 * given for a person is an approval given to whichever record survived.
 */
patients.relinkHooks.push({
  label: 'Pre-authorisations',
  count: (mrn) => byPatient(mrn).length,
  relink: (fromMrn, toMrn) => {
    const moving = byPatient(fromMrn);
    const now = new Date().toISOString();
    for (const row of moving) {
      row.patientMrn = toMrn;
      row.updatedAt = now;
      log(row, 'Re-linked', `Moved from ${fromMrn} to ${toMrn} on merge`);
    }
    return moving.length;
  },
});

// --- internals ----------------------------------------------------------------

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** "valid until 30 Sep 2026" — the one phrase four screens write the same way. */
export const validityLabel = (row) =>
  (row?.decision?.validTo ? `valid until ${showDate(row.decision.validTo)}` : 'no validity recorded');

function log(row, action, details) {
  audit.log({ entity: ENTITY, entityId: row.no, action, details });
}

/** Approvals past their validity are retired before any screen reads the list. */
expireAuths();
