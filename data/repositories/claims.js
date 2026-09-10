// Repository — claims. Owner: modules/claima (amendment 24). Pactum's
// Performance reads it through the helpers amendment 11 wrote, which stay as
// they are; the sections below them are the module's, and each parallel
// session adds its own under its TAG (modules/claima/COORDINATION.md).
//
// The dataset is generated (data/seed/claims.js) and seeds itself on first
// read rather than through data/store.js, which keeps the store free of a seed
// that has to read the contracts, the charge master and the register to exist.
// A reset empties the table and the next read regenerates the same 600 rows.
//
// A claim is its lines: `totals` and the legacy flat fields are re-derived from
// them by data/engines/claim-totals.js on every write, so nothing here adds
// money by hand. Every performance definition lives in
// data/engines/performance-engine.js and nowhere else.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as patients from './patients.js';
import { generateClaims, DENIAL_REASONS } from '../seed/claims.js';
import * as cdm from './cdm.js';
import * as contracts from './contracts.js';
import { syncClaim, lineOf, cents } from '../engines/claim-totals.js';
import { compareDates, iso, todayIso, usd } from '../../shared/format.js';
// A27: assembly, scrub and the sources they read.
import * as encounters from './encounters.js';
import * as policies from './policies.js';
import * as payers from './payers.js';
import * as ledger from './ledger.js';
import * as preauth from './preauth-requests.js';
import * as referrals from './referrals.js';
import * as claimAttachments from './claim-attachments.js';
import * as assembler from '../engines/claim-assembler.js';
import * as scrubber from '../engines/claim-scrubber.js';
import { evaluateCharge } from '../engines/billing-engine.js';
import { ADMISSION_OF } from '../engines/eligibility-engine.js';
import { buildAssemblyClaims } from '../seed/claim-assembly.js';
import { CONFIG } from '../../shared/config.js';
import { current as currentRole } from '../../shared/roles.js';

const TABLE = 'claims';
const ENTITY = 'claims';

export const STATUSES = [
  'Draft', 'Ready', 'Submitted', 'Acknowledged', 'Paid', 'Partially Paid', 'Denied',
  'Rejected', 'Appealed', 'Closed', 'Void',
];
/** A claim the payer has answered — the denominator of every rate. */
export const ADJUDICATED = ['Paid', 'Partially Paid', 'Denied', 'Appealed', 'Closed'];
/** With the payer and not yet answered. */
export const IN_FLIGHT = ['Submitted', 'Acknowledged'];
/** Still the desk's: editable, and never sent. */
export const UNSUBMITTED = ['Draft', 'Ready'];
export const LINE_STATUSES = ['Open', 'Paid', 'Partially Paid', 'Denied', 'Void'];
export { DENIAL_REASONS };

export const denialLabel = (code) => DENIAL_REASONS.find((r) => r.code === code)?.label || '—';

export function all() {
  const rows = store.table(TABLE);
  if (!rows.length) rows.push(...generateClaims());
  return rows;
}

export const get = (id) => all().find((c) => c.id === id || c.claimNo === id) || null;

export const isAdjudicated = (claim) => ADJUDICATED.includes(claim?.status);
export const isPaid = (claim) => Boolean(claim?.paidAt);
/** Refused and paid nothing — an appeal does not lift the denial until it is won. */
export const isDenied = (claim) =>
  claim?.status === 'Denied' || (claim?.status === 'Appealed' && !claim?.paidAt);
export const isPending = (claim) => IN_FLIGHT.includes(claim?.status);
export const isEditable = (claim) => UNSUBMITTED.includes(claim?.status);

export function statusTone(status) {
  if (status === 'Paid' || status === 'Closed') return 'success';
  if (status === 'Partially Paid' || status === 'Appealed' || status === 'Ready') return 'warning';
  if (status === 'Denied' || status === 'Rejected') return 'critical';
  if (status === 'Submitted' || status === 'Acknowledged') return 'info';
  return '';
}

/** list({ payerId, contractId, serviceGroup, status, itemId, from, to }). */
export function list({
  payerId = '', contractId = '', serviceGroup = '', status = '', itemId = '',
  from = '', to = '',
} = {}) {
  return all().filter((c) => {
    if (payerId && c.payerId !== payerId) return false;
    if (contractId && c.contractId !== contractId) return false;
    if (serviceGroup && c.serviceGroup !== serviceGroup) return false;
    if (status && c.status !== status) return false;
    if (itemId && c.itemId !== itemId) return false;
    if (from && compareDates(c.dateOfService, from) < 0) return false;
    if (to && compareDates(c.dateOfService, to) > 0) return false;
    return true;
  });
}

export const byPayer = (payerId, range = {}) => list({ payerId, ...range });
export const byContract = (contractId, range = {}) => list({ contractId, ...range });
export const byServiceGroup = (contractId, serviceGroup, range = {}) =>
  list({ contractId, serviceGroup, ...range });

/** The payers that have claims at all — who Performance can report on. */
export const trackedPayerIds = () => [...new Set(all().map((c) => c.payerId))].sort();

/** The contract versions that carry claims, newest term first. */
export function trackedContracts(payerId = '') {
  const ids = [...new Set(list({ payerId }).map((c) => c.contractId))];
  return ids
    .map((id) => contracts.get(id))
    .filter(Boolean)
    .sort((a, b) => b.startDate.localeCompare(a.startDate) || b.version - a.version);
}

/** The charge line a claim names, and its label — the tables read both. */
export const itemOf = (claim) => cdm.get(claim?.itemId);
export const itemName = (claim) => cdm.label(itemOf(claim)) || claim?.itemId || '—';

export function counts() {
  const rows = all();
  const status = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const row of rows) status[row.status] = (status[row.status] || 0) + 1;
  return {
    total: rows.length,
    adjudicated: rows.filter(isAdjudicated).length,
    denied: rows.filter(isDenied).length,
    pending: rows.filter(isPending).length,
    payers: trackedPayerIds().length,
    status,
  };
}

// --- A24: the module's read side ------------------------------------------------

/**
 * search(q, { status, payerId, planId, contractId, patientMrn, encounterNo,
 * batchId, remittanceId, from, to }) — newest date of service first. The text
 * matches the claim number, the id, the encounter number and the patient's MRN
 * or name; a filter left blank is not applied.
 */
export function search(q = '', {
  status = '', payerId = '', planId = '', contractId = '', patientMrn = '', encounterNo = '',
  batchId = '', remittanceId = '', from = '', to = '',
} = {}) {
  const needle = String(q || '').trim().toLowerCase();
  return all()
    .filter((c) => {
      if (status && c.status !== status) return false;
      if (payerId && c.payerId !== payerId) return false;
      if (planId && c.planId !== planId) return false;
      if (contractId && c.contractId !== contractId) return false;
      if (patientMrn && c.patientMrn !== patientMrn) return false;
      if (encounterNo && c.encounterNo !== encounterNo) return false;
      if (batchId && c.batchId !== batchId) return false;
      if (remittanceId && c.remittanceId !== remittanceId) return false;
      if (from && compareDates(c.dateOfService, from) < 0) return false;
      if (to && compareDates(c.dateOfService, to) > 0) return false;
      if (!needle) return true;
      const patient = patients.get(c.patientMrn);
      return [c.claimNo, c.id, c.encounterNo, c.patientMrn, patient?.nameEn, patient?.nameAr]
        .some((v) => String(v || '').toLowerCase().includes(needle));
    })
    .sort((a, b) => b.dateOfService.localeCompare(a.dateOfService) || b.claimNo.localeCompare(a.claimNo));
}

/** byStatus('Denied') → its rows; byStatus() → { [status]: rows } over every status. */
export function byStatus(status = '') {
  if (status) return all().filter((c) => c.status === status);
  const out = Object.fromEntries(STATUSES.map((s) => [s, []]));
  for (const row of all()) (out[row.status] || (out[row.status] = [])).push(row);
  return out;
}

export const byPatient = (mrn) => search('', { patientMrn: mrn });
export const byEncounter = (no) => search('', { encounterNo: no });

/** The trail for one claim, newest first — a claim carries no history of its own. */
export const history = (id) => audit.forEntity(ENTITY, id);

/** Sequential per year, read off the table itself: CLM-2026-000601 after 600. */
export function nextClaimNo(year = new Date().getFullYear()) {
  const prefix = `CLM-${year}-`;
  const max = all().reduce((n, c) => {
    if (!String(c.claimNo).startsWith(prefix)) return n;
    const digits = Number(String(c.claimNo).slice(prefix.length));
    return Number.isFinite(digits) && digits > n ? digits : n;
  }, 0);
  return `${prefix}${String(max + 1).padStart(6, '0')}`;
}

// --- A24: the module's write side -----------------------------------------------

/**
 * create({ patientMrn, payerId, planId, policyId, encounterNo, contractId,
 * dateOfService, lines, status }) → the stored claim. A new claim is a Draft
 * (or Ready, when the caller says so) and nothing else: everything past that
 * is a status move. Lines arrive priced — the caller ran the billing engine —
 * and the totals and the flat fields are derived here.
 */
export function create(data = {}) {
  const status = UNSUBMITTED.includes(data.status) ? data.status : 'Draft';
  const dateOfService = iso(data.dateOfService) || todayIso();
  const contract = data.contractId
    ? contracts.get(data.contractId)
    : contracts.contractForService(data.payerId, data.planId, dateOfService);
  const lines = (data.lines || []).map((line, i) => lineOf(line, `L${i + 1}`));
  const row = syncClaim({
    id: store.nextId(TABLE, 'CLM-'),
    claimNo: nextClaimNo(Number(dateOfService.slice(0, 4))),
    patientMrn: data.patientMrn || null,
    encounterNo: data.encounterNo || null,
    payerId: data.payerId || null,
    planId: data.planId || null,
    policyId: data.policyId || null,
    contractId: contract?.id || null,
    status,
    dateOfService,
    createdAt: new Date().toISOString(),
    submittedAt: null,
    batchId: null,
    remittanceId: null,
    lines,
    totals: { paid: 0, adjusted: 0 },
    denialReasonCode: null,
    scrubberFindings: Array.isArray(data.scrubberFindings) ? [...data.scrubberFindings] : [],
    attachments: Array.isArray(data.attachments) ? [...data.attachments] : [],
    ...flatOf(lines[0]),
    allowedPaid: 0,
    paidAt: null,
    appealed: false,
  });
  all().push(row);
  store.commit('claims.create');
  log(row, 'Created', data.details || `${status} · ${row.lines.length} line${row.lines.length === 1 ? '' : 's'}`);
  return row;
}

/**
 * update(id, patch) — Draft and Ready only; returns null on anything else.
 * A patch may carry lines, the cover, the encounter, the date of service, the
 * scrubber findings or the attachments; the status is not a field here.
 */
export function update(id, patch = {}, { details = '' } = {}) {
  const row = get(id);
  if (!row || !isEditable(row)) return null;
  const fields = [
    'patientMrn', 'encounterNo', 'payerId', 'planId', 'policyId', 'contractId', 'dateOfService',
    'lines', 'scrubberFindings', 'attachments',
  ];
  for (const key of fields) if (key in patch) row[key] = patch[key];
  if ('dateOfService' in patch) row.dateOfService = iso(patch.dateOfService) || row.dateOfService;
  if (!row.contractId || 'payerId' in patch || 'planId' in patch || 'dateOfService' in patch) {
    row.contractId = contracts.contractForService(row.payerId, row.planId, row.dateOfService)?.id || row.contractId;
  }
  syncClaim(row);
  Object.assign(row, flatOf(row.lines[0]));
  store.commit('claims.update');
  log(row, 'Updated', details || Object.keys(patch).join(', '));
  return row;
}

/**
 * setStatus(id, status, payload) — the one way a claim moves, audited as
 * "Status: from → to". The payload carries what the move knows: submittedAt,
 * paidAt, paid, adjusted, batchId, remittanceId, denialReasonCode, reason,
 * details. Submitting stamps today when no date is given; a payment stamps
 * paidAt the same way; an appeal marks the legacy flag. Returns null when the
 * status is not one of STATUSES or the claim is unknown.
 */
export function setStatus(id, status, payload = {}) {
  const row = get(id);
  if (!row || !STATUSES.includes(status)) return null;
  const from = row.status;
  row.status = status;
  if ('submittedAt' in payload) row.submittedAt = iso(payload.submittedAt) || null;
  if ('paidAt' in payload) row.paidAt = iso(payload.paidAt) || null;
  if ('batchId' in payload) row.batchId = payload.batchId || null;
  if ('remittanceId' in payload) row.remittanceId = payload.remittanceId || null;
  if ('denialReasonCode' in payload) row.denialReasonCode = payload.denialReasonCode || null;
  if ('paid' in payload) row.totals.paid = Number(payload.paid) || 0;
  if ('adjusted' in payload) row.totals.adjusted = Number(payload.adjusted) || 0;
  if (status === 'Submitted' && !row.submittedAt) row.submittedAt = todayIso();
  if ((status === 'Paid' || status === 'Partially Paid') && !row.paidAt) row.paidAt = todayIso();
  if (status === 'Appealed') row.appealed = true;
  syncClaim(row);
  store.commit('claims.status');
  const why = [payload.reason, payload.details].filter(Boolean).join(' — ');
  log(row, 'Status', `${from} → ${status}${why ? ` — ${why}` : ''}`);
  return row;
}

/** Re-derive totals and the flat fields from the lines. Arithmetic, not a fact: not audited. */
export function recomputeTotals(id) {
  const row = get(id);
  if (!row) return null;
  syncClaim(row);
  Object.assign(row, flatOf(row.lines[0]));
  store.commit('claims.recompute');
  return row;
}

// --- internals ---------------------------------------------------------------

/** The legacy category fields, read off the first line's charge. */
function flatOf(line) {
  const item = cdm.get(line?.itemId);
  return {
    serviceGroup: item ? contracts.serviceGroupOf(item.category) : null,
    category: item?.category || null,
  };
}

function log(row, action, details = '') {
  audit.log({ entity: ENTITY, entityId: row.id, action, details });
}

// A merged record's claims move to the survivor. Registered here so the merge
// screen counts them without data/repositories/patients.js learning what a
// claim is.
patients.relinkHooks.push({
  label: 'Claims',
  count: (mrn) => byPatient(mrn).length,
  relink: (fromMrn, toMrn) => {
    const moving = byPatient(fromMrn);
    for (const row of moving) {
      row.patientMrn = toMrn;
      log(row, 'Re-linked', `Moved from ${fromMrn} to ${toMrn} on merge`);
    }
    return moving.length;
  },
});

// --- A27: claim assembly & portfolio ---------------------------------------------
// The claim a coded visit becomes, and everything that happens to it before it
// is Ready: assembly from the released charges, the coding snapshot, the
// attachments the contract asks for, the scrub, the stale flag, refresh with
// its diff, finalize and reopen. The two engines are leaves —
// data/engines/claim-assembler.js and data/engines/claim-scrubber.js — and
// this section resolves the world for them.
//
// The three peer repositories (charges, coding, clinical documents) are loaded
// dynamically and feature-detected: a static import would close a cycle the
// moment one of them called claims.markStale(), and the screens have to render
// against seeded claims before any of them exists.

const peers = { charges: null, coding: null, clinicalDocs: null };

/** Which peer repositories are loaded — the screens say so where a helper is missing. */
export const peerStatus = () => ({
  charges: Boolean(peers.charges), coding: Boolean(peers.coding), clinicalDocs: Boolean(peers.clinicalDocs),
});

export const KINDS = assembler.KINDS;
export const SCRUB_RESULTS = scrubber.RESULTS;
export const SCRUB_CATEGORIES = scrubber.CATEGORIES;
export const scrubTone = scrubber.resultTone;
export const groupedFindings = scrubber.grouped;

export const kindOf = (claim) => claim?.kind || 'Primary';
export const isStale = (claim) => Boolean(claim?.stale?.flag);
export const isLocked = (claim) => claim?.status !== 'Draft';

/** Whole days since the claim was assembled. */
export const ageDays = (claim, on = todayIso()) => {
  const from = iso(claim?.createdAt);
  if (!from) return 0;
  return Math.max(0, Math.round((Date.parse(on) - Date.parse(from)) / 86400000));
};

export const latestScrub = (claim) => (claim?.scrubRuns || [])[(claim?.scrubRuns || []).length - 1] || null;

/** The result the claim stands on, or null when nothing valid has been run. */
export const scrubResult = (claim) => (claim?.scrubValid && latestScrub(claim) ? latestScrub(claim).result : null);

export const scrubLabel = (claim) => scrubResult(claim) || (latestScrub(claim) ? 'Voided' : 'Not run');

/** The warnings on the latest valid run nobody has signed off yet. */
export function unacknowledged(claim) {
  const run = latestScrub(claim);
  if (!run || !claim.scrubValid) return [];
  const done = new Set((run.acknowledgments || []).map((a) => a.findingId));
  return run.findings.filter((f) => f.severity === 'Warning' && !done.has(f.id));
}

/** Whether the claim may be finalized, and if not, why — the button's tooltip. */
export function canFinalize(claim) {
  if (!claim) return { ok: false, why: 'No claim' };
  if (claim.status !== 'Draft') return { ok: false, why: `A ${claim.status.toLowerCase()} claim is not a draft` };
  if (kindOf(claim) === 'Secondary' && !claim.activatedAt) {
    return { ok: false, why: 'A secondary claim is activated by the primary’s remittance' };
  }
  if (isStale(claim)) return { ok: false, why: 'Stale — refresh the claim first' };
  const result = scrubResult(claim);
  if (!result) return { ok: false, why: 'Run the scrub first' };
  if (result === 'Fail') return { ok: false, why: 'The scrub failed — fix the errors and run it again' };
  const left = unacknowledged(claim).length;
  if (left) return { ok: false, why: `${left} warning${left === 1 ? '' : 's'} still to acknowledge` };
  return { ok: true, why: 'Finalize — locks the lines, the coding and the attachments' };
}

// --- bands ----------------------------------------------------------------------

export const VALUE_BANDS = (() => {
  const edges = CONFIG.claima?.assembly?.valueBands || [0, 500, 2000, 10000];
  const out = [];
  for (let i = 1; i < edges.length; i += 1) {
    out.push({
      id: `b${i}`, min: edges[i - 1], max: edges[i],
      label: i === 1 ? `Under ${usd(edges[i])}` : `${usd(edges[i - 1])} – ${usd(edges[i])}`,
    });
  }
  const last = edges[edges.length - 1];
  out.push({ id: `b${edges.length}`, label: `Over ${usd(last)}`, min: last, max: Infinity });
  return out;
})();

export const AGE_BANDS = [
  { id: 'a1', label: '0 – 7 days', min: 0, max: 7 },
  { id: 'a2', label: '8 – 14 days', min: 8, max: 14 },
  { id: 'a3', label: '15 – 30 days', min: 15, max: 30 },
  { id: 'a4', label: 'Over 30 days', min: 31, max: Infinity },
];

export const valueBandOf = (claim) => {
  const v = Number(claim?.totals?.payerShare) || 0;
  return VALUE_BANDS.find((b) => v >= b.min && v < b.max) || VALUE_BANDS[VALUE_BANDS.length - 1];
};
export const ageBandOf = (claim) => {
  const a = ageDays(claim);
  return AGE_BANDS.find((b) => a >= b.min && a <= b.max) || AGE_BANDS[AGE_BANDS.length - 1];
};

// --- the portfolio's read side ----------------------------------------------------

/** Every claim still the desk's: Draft or Ready, any kind. */
export const inAssembly = () => { ensureAssembled(); return all().filter(isEditable); };

/**
 * portfolio(q, { view, status, payerId, scrub, band, age, kind, stale, from, to })
 * — the portfolio's one query. `view` is 'assembly' (Draft + Ready, the default)
 * or 'all'; `scrub` one of the results, 'none' for never run, 'voided';
 * `band`/`age` a band id; `stale` '1'. Oldest first, so what has waited
 * longest is read first.
 */
export function portfolio(q = '', {
  view = 'assembly', status = '', payerId = '', scrub = '', band = '', age = '', kind = '', stale = '',
  from = '', to = '',
} = {}) {
  ensureAssembled();
  return search(q, { status, payerId, from, to })
    .filter((c) => (view === 'all' ? true : isEditable(c)))
    .filter((c) => !scrub || scrubKey(c) === scrub)
    .filter((c) => !band || valueBandOf(c).id === band)
    .filter((c) => !age || ageBandOf(c).id === age)
    .filter((c) => !kind || kindOf(c) === kind)
    .filter((c) => !stale || isStale(c))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

const scrubKey = (claim) => scrubResult(claim) || (latestScrub(claim) ? 'voided' : 'none');

/** The four header figures over the portfolio, computed over what is in assembly. */
export function assemblyStats() {
  const rows = inAssembly();
  const ready = rows.filter((c) => c.status === 'Ready');
  const money = (list) => cents(list.reduce((n, c) => n + (Number(c.totals?.payerShare) || 0), 0));
  return {
    count: rows.length,
    value: money(rows),
    readyCount: ready.length,
    readyValue: money(ready),
    stale: rows.filter(isStale).length,
    avgAge: rows.length ? Math.round(rows.reduce((n, c) => n + ageDays(c), 0) / rows.length) : 0,
  };
}

/** Ready and not stale — what the submission feature consumes. */
export const readyForSubmission = () => {
  ensureAssembled();
  return all().filter((c) => c.status === 'Ready' && !isStale(c));
};

/** The parent and the children of a claim, resolved — the chain links on the page. */
export function chainOf(claim) {
  return {
    parent: claim?.parentClaimNo ? get(claim.parentClaimNo) : null,
    children: (claim?.childClaimNos || []).map((no) => get(no)).filter(Boolean),
  };
}

/** The claims of one encounter that still count — anything but Void. */
const liveClaimsOf = (encounterNo) => byEncounter(encounterNo).filter((c) => c.status !== 'Void');

const primaryOf = (encounterNo) =>
  liveClaimsOf(encounterNo).filter((c) => kindOf(c) === 'Primary')
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;

const secondaryOf = (encounterNo) => liveClaimsOf(encounterNo).find((c) => kindOf(c) === 'Secondary') || null;

// --- sources ----------------------------------------------------------------------

/**
 * The released charge lines of a visit, in the shape the assembler reads. From
 * the charge-capture repository when it is loaded; until then, from the ledger's
 * posted Charge rows, which is the same set that repository seeds its lines from.
 */
export function releasedLines(encounterNo) {
  if (peers.charges?.releasedByEncounter) {
    return (peers.charges.releasedByEncounter(encounterNo) || []).map((line) => {
      const item = cdm.get(line.itemId);
      return { ...line, chargeCode: line.chargeCode || item?.chargeCode || null, description: line.description || cdm.label(item) || null };
    });
  }
  const enc = encounters.get(encounterNo);
  const on = iso(enc?.startAt) || todayIso();
  return ledger.byEncounter(encounterNo)
    .filter((tx) => tx.type === 'Charge' && tx.status !== 'Reversed')
    .map((tx) => ({
      id: tx.id,
      encounterNo,
      itemId: tx.detail?.itemId,
      chargeCode: tx.detail?.chargeCode,
      description: tx.detail?.description,
      qty: tx.detail?.qty || 1,
      dateOfService: on,
      pricing: {
        gross: tx.detail?.gross, allowed: tx.detail?.allowed, payerShare: tx.detail?.payerShare,
        patientShare: tx.detail?.patientShare, isOverage: Boolean(tx.detail?.isOverage),
      },
      ledgerTxIds: [tx.id],
      status: 'Released',
      flags: [],
    }));
}

/**
 * The coded version of a chart, as the coding register holds it: the current
 * version when it is Coded, else the last one that was. A chart the register
 * has never coded answers undefined — the snapshot the claim already carries
 * is evidence of what was coded at assembly, and nothing newer replaces it.
 */
function codingOf(encounterNo) {
  const c = peers.coding;
  if (!c?.byEncounter) return undefined;
  const current = c.byEncounter(encounterNo);
  if (current?.status === 'Coded' && current.codedAt) return current;
  const rec = c.get?.(encounterNo);
  const last = rec && c.lastCoded ? c.lastCoded(rec) : null;
  return last ? { ...last, status: rec.status } : undefined;
}
const docsOf = (encounterNo) => (peers.clinicalDocs?.byEncounter ? peers.clinicalDocs.byEncounter(encounterNo) || [] : undefined);
const lateIdsOf = (encounterNo) =>
  (peers.charges?.lateCharges ? (peers.charges.lateCharges(encounterNo) || []).map((l) => l.id) : []);

/** The clinical documents of a visit, for the Attachments tab — undefined until the peer is loaded. */
export const clinicalDocsOf = docsOf;

const itemView = (itemId) => {
  const item = cdm.get(itemId);
  return item ? { id: item.id, chargeCode: item.chargeCode, name: cdm.label(item), category: item.category } : null;
};

/** The cover behind the one the visit was classified on, or null. */
function nextPolicyOf(enc) {
  const chain = policies.chain(enc.patientMrn);
  const at = chain.findIndex((p) => p.id === enc.financial?.policyId);
  const next = at >= 0 ? chain[at + 1] : null;
  return next ? { id: next.id, payerId: next.payerId, planId: next.planId } : null;
}

const patientCtxOf = (mrn) => {
  const patient = patients.get(mrn);
  if (!patient) return {};
  const born = Date.parse(patient.dob);
  return {
    age: Number.isFinite(born) ? Math.floor((Date.now() - born) / (365.25 * 86400000)) : undefined,
    gender: patient.gender,
    nationality: patient.nationality,
    memberSince: patient.createdAt ? String(patient.createdAt).slice(0, 10) : undefined,
  };
};

const encounterCtxOf = (enc, on) => ({
  dateOfService: on,
  department: enc?.department || '',
  admissionType: ADMISSION_OF[encounters.VISIT_TYPE_OF[enc?.type]] || null,
  lengthOfStay: enc?.los ?? undefined,
  attendingDoctor: enc?.doctorId,
});

/** The assembler's context for one visit, with `previous` the claim being refreshed. */
function assemblyContext(enc, { previous = null, lateChargeLineIds = [] } = {}) {
  const financial = enc.financial || {};
  const on = iso(enc.startAt) || todayIso();
  const contract = financial.payerId && financial.planId
    ? contracts.contractForService(financial.payerId, financial.planId, on) : null;
  const taken = liveClaimsOf(enc.no)
    .filter((c) => c.id !== previous?.id)
    .flatMap((c) => c.lines);
  return {
    contract: contract ? { id: contract.id, contractNo: contract.contractNo, version: contract.version } : null,
    itemOf: itemView,
    authorizationFor: (itemId, amount, day) => {
      const need = contract ? contracts.resolvePreAuth(contract, cdm.get(itemId), amount) : { required: false, reason: '' };
      const auth = need.required ? preauth.activeFor(enc.patientMrn, itemId, day) : null;
      return { required: need.required, reason: need.reason, auth };
    },
    referralNo: enc.linked?.referralId || null,
    clinicalDocs: docsOf(enc.no),
    docsRequired: (lines, total) => (contract ? contracts.documentationFor(contract, lines, total) : []),
    takenLines: taken,
    lateChargeLineIds: [...lateIdsOf(enc.no), ...lateChargeLineIds],
    nextPolicy: nextPolicyOf(enc),
    previous,
  };
}

// --- assembly -------------------------------------------------------------------

/** What the assembler's payload writes onto a claim row — the A27 fields. */
function applyPayload(row, payload) {
  const h = payload.header;
  Object.assign(row, {
    patientMrn: h.patientMrn,
    encounterNo: h.encounterNo,
    encounterType: h.encounterType,
    department: h.department,
    doctorId: h.doctorId,
    payerId: h.payerId,
    planId: h.planId,
    policyId: h.policyId,
    contractId: h.contractId,
    contractNo: h.contractNo,
    contractVersion: h.contractVersion,
    snapshotRef: h.snapshotRef,
    referralNo: h.referralNo,
    dateOfService: h.dateOfService,
    dateOfServiceTo: h.dateOfServiceTo,
    lines: payload.lines,
    excluded: payload.excluded,
    lateLineIds: payload.lateLineIds,
    coding: payload.coding,
    attachments: payload.attachments,
    docRequirements: payload.docRequirements,
  });
  syncClaim(row);
  Object.assign(row, flatOf(row.lines[0]));
  return row;
}

/** The fields every assembled claim carries beyond the amendment-24 shape. */
const assemblyFields = () => ({
  kind: 'Primary',
  parentClaimNo: null,
  childClaimNos: [],
  stale: null,
  scrubRuns: [],
  scrubValid: false,
  coding: null,
  refreshes: [],
  lateLineIds: [],
  excluded: [],
  docRequirements: [],
  finalizedAt: null,
  reopenedAt: null,
  activatedAt: null,
  assembledAt: new Date().toISOString(),
});

/**
 * A claim row in the amendment-24 shape plus the assembly fields, pushed to
 * the table but neither committed nor audited — the caller says what
 * happened. The seed builds its rows through it with their own dates.
 */
function rowFor(payload, { kind = 'Primary', parentClaimNo = null, createdAt = null, claimNo = null } = {}) {
  const h = payload.header;
  const at = createdAt || new Date().toISOString();
  const row = {
    id: store.nextId(TABLE, 'CLM-'),
    claimNo: claimNo || nextClaimNo(Number(String(h.dateOfService).slice(0, 4)) || new Date().getFullYear()),
    patientMrn: h.patientMrn,
    encounterNo: h.encounterNo,
    payerId: h.payerId,
    planId: h.planId,
    policyId: h.policyId,
    contractId: h.contractId,
    status: 'Draft',
    dateOfService: h.dateOfService,
    createdAt: at,
    submittedAt: null,
    batchId: null,
    remittanceId: null,
    lines: [],
    totals: { paid: 0, adjusted: 0 },
    denialReasonCode: null,
    scrubberFindings: [],
    attachments: [],
    allowedPaid: 0,
    paidAt: null,
    appealed: false,
    ...assemblyFields(),
    kind,
    parentClaimNo,
    assembledAt: at,
  };
  applyPayload(row, payload);
  all().push(row);
  return row;
}

/** The assembler run for one visit — `pick` narrows the charges, `coding` overrides the peer's answer. */
function payloadFor(encounterNo, { coding, pick = null, lateChargeLineIds = [], previous = null } = {}) {
  const enc = encounters.get(encounterNo);
  if (!enc) return null;
  const charges = releasedLines(encounterNo).filter(pick || (() => true));
  return assembler.assemble(enc, coding === undefined ? codingOf(encounterNo) : coding, charges,
    assemblyContext(enc, { previous, lateChargeLineIds }));
}

function createAssembled(payload, { kind = 'Primary', parentClaimNo = null, details = '' } = {}) {
  const h = payload.header;
  const n = payload.lines.length;
  const row = rowFor(payload, { kind, parentClaimNo });
  store.commit('claims.assemble');
  log(row, 'Created', details || `Assembled from ${h.encounterNo} · ${kind.toLowerCase()} · ${n} line${n === 1 ? '' : 's'}${
    payload.coding ? ` · coding v${payload.coding.version}` : ' · not coded'}${
    h.contractNo ? ` · ${h.contractNo} v${h.contractVersion}` : ' · no contract'}`);
  return row;
}

/**
 * assembleFor(encounterNo) → { claim, created, secondary, reason }. Idempotent:
 * a visit with a live primary gets it back untouched — a refresh is explicit.
 * A self-pay visit, or one with no released lines yet, assembles nothing and
 * says why. The secondary the chain names is defined beside the primary,
 * Draft and not activated; its lines are what the primary's remittance leaves.
 */
export function assembleFor(encounterNo) {
  ensureAssembled();
  const enc = encounters.get(encounterNo);
  if (!enc) return { claim: null, created: false, secondary: null, reason: `No encounter ${encounterNo}` };
  const existing = primaryOf(encounterNo);
  if (existing) return { claim: existing, created: false, secondary: secondaryOf(encounterNo), reason: 'Already assembled' };

  const charges = releasedLines(encounterNo);
  const payload = assembler.assemble(enc, codingOf(encounterNo), charges, assemblyContext(enc));
  if (payload.selfPay) return { claim: null, created: false, secondary: null, reason: payload.reason };
  if (!charges.length) return { claim: null, created: false, secondary: null, reason: 'No released charges on the visit yet' };

  const row = createAssembled(payload);
  const secondary = payload.secondary ? defineSecondary(row, payload) : null;
  return { claim: row, created: true, secondary, reason: '' };
}

function defineSecondary(primary, payload) {
  const row = rowFor({ ...payload, lines: [], excluded: [], lateLineIds: [], attachments: [], docRequirements: [] }, {
    kind: 'Secondary', parentClaimNo: primary.claimNo,
  });
  Object.assign(row, {
    payerId: payload.secondary.payerId,
    planId: payload.secondary.planId,
    policyId: payload.secondary.policyId,
    contractId: null,
    contractNo: null,
    contractVersion: null,
  });
  syncClaim(row);
  primary.childClaimNos = [...new Set([...(primary.childClaimNos || []), row.claimNo])];
  store.commit('claims.assemble');
  log(row, 'Created', `Secondary defined behind ${primary.claimNo} — activates when the primary is remitted`);
  return row;
}

/**
 * refresh(id) → { claim, diff, error } — re-assemble a draft against the visit
 * as it stands now, keep what moved, clear the stale flag and void the scrub.
 * A locked claim is not refreshed, and a secondary has nothing to re-assemble
 * until it is activated.
 */
export function refresh(id) {
  const row = get(id);
  if (!row) return { claim: null, diff: null, error: 'No such claim' };
  if (row.status !== 'Draft') return { claim: row, diff: null, error: `A ${row.status.toLowerCase()} claim is locked — reopen it first` };
  if (kindOf(row) === 'Secondary' && !row.activatedAt) {
    return { claim: row, diff: null, error: 'A secondary claim is activated by the primary’s remittance' };
  }
  const enc = encounters.get(row.encounterNo);
  if (!enc) return { claim: row, diff: null, error: `Encounter ${row.encounterNo} is gone` };

  const before = structuredClone(row);
  const payload = assembler.assemble(enc, codingOf(enc.no), releasedLines(enc.no), assemblyContext(enc, { previous: row }));
  if (payload.selfPay) return { claim: row, diff: null, error: payload.reason };
  applyPayload(row, payload);
  const diff = assembler.diff(before, row);
  const wasStale = isStale(row);
  row.stale = null;
  row.scrubValid = false;
  row.refreshes = [...(row.refreshes || []), { at: new Date().toISOString(), by: currentRole().name, diff }];
  store.commit('claims.refresh');
  log(row, 'Refreshed', `${wasStale ? 'Stale cleared · ' : ''}${diffSummary(diff)}`);
  return { claim: row, diff, error: '' };
}

/** One line for the trail: what a refresh moved. */
export function diffSummary(diff) {
  if (!diff || assembler.isEmptyDiff(diff)) return 'Nothing changed';
  const parts = [];
  const { added, removed, changed } = diff.lines;
  if (added.length) parts.push(`${added.length} line${added.length === 1 ? '' : 's'} added`);
  if (removed.length) parts.push(`${removed.length} removed`);
  if (changed.length) parts.push(`${changed.length} repriced`);
  if (diff.coding) parts.push(`coding v${diff.coding.from ?? '—'} → v${diff.coding.to ?? '—'}`);
  if (diff.attachments.added.length || diff.attachments.removed.length) {
    parts.push(`attachments +${diff.attachments.added.length} −${diff.attachments.removed.length}`);
  }
  for (const h of diff.header) parts.push(`${h.label} ${h.from ?? '—'} → ${h.to ?? '—'}`);
  if (diff.totals) parts.push(`payer share ${usd(diff.totals.from)} → ${usd(diff.totals.to)}`);
  return parts.join('; ');
}

/**
 * markStale(encounterNo, reason) → how many claims were flagged. The open
 * claims of a visit whose coding or charges moved after assembly: the scrub
 * is voided, and a Ready claim goes back to Draft, since what it locked is
 * no longer what the visit says.
 */
export function markStale(encounterNo, reason = 'The encounter changed after assembly') {
  ensureAssembled();
  let n = 0;
  for (const row of liveClaimsOf(encounterNo).filter(isEditable)) {
    row.stale = { flag: true, reason, at: new Date().toISOString() };
    row.scrubValid = false;
    n += 1;
    if (row.status === 'Ready') setStatus(row.id, 'Draft', { reason: 'Stale', details: reason });
    else store.commit('claims.stale');
    log(row, 'Stale', reason);
  }
  return n;
}

/**
 * onLateCharge(encounterNo, lineIds) → the claim the lines landed on. Into the
 * open draft when there is one, flagged Late; otherwise a supplementary claim
 * chained to the primary, since a Ready or submitted claim is not reopened for
 * a charge that arrived after it.
 */
export function onLateCharge(encounterNo, lineIds = []) {
  ensureAssembled();
  const primary = primaryOf(encounterNo);
  if (!primary) return assembleFor(encounterNo).claim;
  const ids = [...lineIds];
  if (primary.status === 'Draft') {
    if (refresh(primary.id).error) return primary;
    const late = new Set([
      ...(primary.lateLineIds || []),
      ...primary.lines.filter((l) => ids.includes(l.chargeLineId)).map((l) => l.id),
    ]);
    primary.lateLineIds = [...late];
    for (const line of primary.lines) if (late.has(line.id)) line.late = true;
    store.commit('claims.late');
    log(primary, 'Late charge added', `${ids.length} line${ids.length === 1 ? '' : 's'} flagged late`);
    return primary;
  }
  const open = liveClaimsOf(encounterNo).find((c) => kindOf(c) === 'Supplementary' && c.status === 'Draft');
  const enc = encounters.get(encounterNo);
  if (open) {
    if (!refresh(open.id).error) {
      open.lateLineIds = open.lines.map((l) => l.id);
      for (const line of open.lines) line.late = true;
      store.commit('claims.late');
    }
    return open;
  }
  const payload = assembler.assemble(enc, codingOf(encounterNo), releasedLines(encounterNo),
    assemblyContext(enc, { lateChargeLineIds: ids }));
  if (payload.selfPay || !payload.lines.length) return primary;
  for (const line of payload.lines) line.late = true;
  payload.lateLineIds = payload.lines.map((l) => l.id);
  const row = createAssembled(payload, {
    kind: 'Supplementary',
    parentClaimNo: primary.claimNo,
    details: `Supplementary to ${primary.claimNo} — ${payload.lines.length} late line${payload.lines.length === 1 ? '' : 's'}`,
  });
  primary.childClaimNos = [...new Set([...(primary.childClaimNos || []), row.claimNo])];
  store.commit('claims.assemble');
  return row;
}

// --- scrub ----------------------------------------------------------------------

/** The scrubber's context for one claim: the contract as stamped, re-priced live. */
function scrubContext(row) {
  const enc = encounters.get(row.encounterNo);
  const contract = row.contractId ? contracts.get(row.contractId) : null;
  const payer = payers.get(row.payerId);
  const plan = payer?.plans.find((p) => p.id === row.planId);
  const policy = row.policyId ? policies.get(row.policyId) : null;
  const patientCtx = patientCtxOf(row.patientMrn);
  const traces = new Map();
  const evaluate = (line) => {
    if (!contract) return null;
    if (!traces.has(line.id)) {
      traces.set(line.id, evaluateCharge(contract, row.planId, patientCtx,
        encounterCtxOf(enc, line.dateOfService || row.dateOfService), { itemId: line.itemId, qty: line.qty }));
    }
    return traces.get(line.id);
  };
  const referral = row.referralNo ? referrals.get(row.referralNo) : null;
  return {
    encounter: enc ? { no: enc.no, type: enc.type, status: enc.status, startAt: enc.startAt, endAt: enc.endAt } : null,
    contract: contract ? { id: contract.id, contractNo: contract.contractNo, version: contract.version, status: contract.status } : null,
    payerName: payer?.nameEn || null,
    planName: plan?.name || null,
    policy: policy ? { id: policy.id, status: policy.status, startDate: policy.startDate, endDate: policy.endDate } : null,
    itemOf: itemView,
    reprice: (line) => {
      const t = evaluate(line);
      return t ? { allowed: t.result.allowed, payerShare: t.result.payerShare, patientShare: t.result.patientShare } : null;
    },
    preAuthRequired: (line) => {
      const t = evaluate(line);
      return { required: t ? t.result.preAuthRequired : Boolean(line.preAuthRequired), reason: '' };
    },
    authorizationFor: (itemId, on) => preauth.activeFor(row.patientMrn, itemId, on),
    referralRequired: Boolean(contract) && (
      row.lines.length
        ? row.lines.some((l) => contracts.referralRequired(contract, cdm.get(l.itemId)))
        : contracts.referralRequired(contract, null)),
    referral: referral ? { no: referral.no, status: referral.status } : null,
    docsRequired: contract
      ? contracts.documentationFor(contract,
        row.lines.map((l) => ({ id: l.id, item: itemView(l.itemId), amount: l.allowedExpected })), row.totals?.payerShare)
      : [],
    today: todayIso(),
  };
}

/** runScrub(id, { at, by, silent }) → the run. Draft claims only; stored on the claim. */
export function runScrub(id, { at = null, by = null, silent = false } = {}) {
  const row = get(id);
  if (!row || row.status !== 'Draft') return null;
  const { result, findings } = scrubber.scrub(row, scrubContext(row));
  const run = {
    id: `SR-${String((row.scrubRuns || []).length + 1).padStart(3, '0')}`,
    at: at || new Date().toISOString(),
    by: by || currentRole().name,
    contractVersion: row.contractVersion ?? null,
    contractNo: row.contractNo || null,
    findings,
    result,
    acknowledgments: [],
  };
  row.scrubRuns = [...(row.scrubRuns || []), run];
  row.scrubValid = true;
  row.scrubberFindings = findings;
  store.commit('claims.scrub');
  if (!silent) {
    const errors = findings.filter((f) => f.severity === 'Error').length;
    const warnings = findings.length - errors;
    log(row, 'Scrubbed', `${result} — ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`);
  }
  return run;
}

/** Sign off one warning on the latest run with a reason. Role-gated by the screen. */
export function acknowledge(id, findingId, reason) {
  const row = get(id);
  const run = latestScrub(row);
  if (!row || !run || !row.scrubValid) return null;
  const finding = run.findings.find((f) => f.id === findingId && f.severity === 'Warning');
  if (!finding || !String(reason || '').trim()) return null;
  if ((run.acknowledgments || []).some((a) => a.findingId === findingId)) return run;
  run.acknowledgments = [...(run.acknowledgments || []), {
    findingId, reason: String(reason).trim(), by: currentRole().name, at: new Date().toISOString(),
  }];
  store.commit('claims.acknowledge');
  log(row, 'Warning acknowledged', `${finding.category}: ${finding.message} — ${String(reason).trim()}`);
  return run;
}

// --- finalize / reopen ------------------------------------------------------------

/** finalize(id) → the claim, or null when canFinalize says no. Ready locks everything. */
export function finalize(id, { at = null } = {}) {
  const row = get(id);
  if (!canFinalize(row).ok) return null;
  row.finalizedAt = at || new Date().toISOString();
  const acked = latestScrub(row)?.acknowledgments?.length || 0;
  return setStatus(id, 'Ready', {
    reason: 'Finalized',
    details: `${scrubResult(row)}${acked ? ` · ${acked} warning${acked === 1 ? '' : 's'} acknowledged` : ''} · ${
      usd(row.totals.payerShare)} to ${payers.get(row.payerId)?.nameEn || row.payerId}`,
  });
}

/** reopen(id, reason) → the claim back in Draft with its scrub voided. */
export function reopen(id, reason = '') {
  const row = get(id);
  if (!row || row.status !== 'Ready') return null;
  row.reopenedAt = new Date().toISOString();
  row.scrubValid = false;
  return setStatus(id, 'Draft', { reason: 'Reopened', details: reason });
}

// --- attachments ------------------------------------------------------------------

/** Attach a file the biller uploaded; the register keeps the file, the claim the link. */
export function addUpload(id, { fileName, type, size = 0, lineIds = [] } = {}) {
  const row = get(id);
  if (!row || row.status !== 'Draft' || !fileName) return null;
  const file = claimAttachments.record(row.claimNo, { fileName, type, size, lineIds });
  const serial = (row.attachments || []).reduce((n, a) => Math.max(n, Number(String(a.id).slice(1)) || 0), 0);
  const required = (row.docRequirements || []).some((r) => r.docType === type);
  const att = { id: `A${serial + 1}`, docId: null, fileId: file.id, fileName, type, origin: 'Upload', lineIds: [...lineIds], required };
  row.attachments = [...(row.attachments || []), att];
  row.scrubValid = false;
  store.commit('claims.attach');
  log(row, 'Attachment added', `${fileName} (${type}${lineIds.length ? ` · ${lineIds.join(', ')}` : ''})`);
  return att;
}

/** Attach one of the visit's clinical documents by reference — the auto-pull, done by hand. */
export function attachDoc(id, docId) {
  const row = get(id);
  if (!row || row.status !== 'Draft') return null;
  const doc = (docsOf(row.encounterNo) || []).find((d) => d.id === docId);
  if (!doc || (row.attachments || []).some((a) => a.docId === docId)) return null;
  const serial = (row.attachments || []).reduce((n, a) => Math.max(n, Number(String(a.id).slice(1)) || 0), 0);
  const required = (row.docRequirements || []).some((r) => r.docType === doc.type);
  const att = {
    id: `A${serial + 1}`, docId, fileId: null, fileName: doc.fileName || doc.title || docId, type: doc.type, origin: 'Auto',
    lineIds: [...((row.docRequirements || []).find((r) => r.docType === doc.type)?.lineIds || [])], required,
  };
  row.attachments = [...(row.attachments || []), att];
  row.scrubValid = false;
  store.commit('claims.attach');
  log(row, 'Attachment added', `${att.fileName} (${doc.type} · from the chart)`);
  return att;
}

export function removeAttachment(id, attachmentId) {
  const row = get(id);
  const att = (row?.attachments || []).find((a) => a.id === attachmentId);
  if (!row || row.status !== 'Draft' || !att) return false;
  row.attachments = row.attachments.filter((a) => a.id !== attachmentId);
  if (att.fileId) claimAttachments.remove(att.fileId);
  row.scrubValid = false;
  store.commit('claims.attach');
  log(row, 'Attachment removed', `${att.fileName} (${att.type})`);
  return true;
}

export function linkAttachment(id, attachmentId, lineIds = []) {
  const row = get(id);
  const att = (row?.attachments || []).find((a) => a.id === attachmentId);
  if (!row || row.status !== 'Draft' || !att) return null;
  att.lineIds = [...new Set(lineIds)].filter((lid) => row.lines.some((l) => l.id === lid));
  store.commit('claims.attach');
  log(row, 'Attachment linked', `${att.fileName} → ${att.lineIds.join(', ') || 'no line'}`);
  return att;
}

// --- load-time wiring ---------------------------------------------------------------

/** Assemble every coded visit that has no claim yet. Needs the coding peer; idempotent. */
export function assembleCoded() {
  if (!peers.coding?.byEncounter) return 0;
  let n = 0;
  for (const enc of encounters.all()) {
    if (!['Discharged', 'Completed'].includes(enc.status) || !enc.financial?.payerId) continue;
    if (primaryOf(enc.no)) continue;
    if (peers.coding.byEncounter(enc.no)?.status !== 'Coded') continue;
    if (assembleFor(enc.no).created) n += 1;
  }
  return n;
}

function wirePeer(key, mod) {
  peers[key] = mod;
  if (key === 'coding') {
    // Marked coded: a visit with no claim is assembled; a draft takes the new
    // version in through a refresh; a finalized claim is stale until refreshed.
    mod.afterCodedHooks?.push?.(({ encounterNo }) => {
      if (!encounterNo) return;
      const primary = primaryOf(encounterNo);
      if (!primary) return void assembleFor(encounterNo);
      if (primary.status === 'Draft') return void refresh(primary.id);
      markStale(encounterNo, 'Chart coded again after the claim was finalized');
    });
  }
  if (key === 'charges') {
    mod.afterCorrectionHooks?.push?.((e) => {
      if (!e?.encounterNo) return;
      const n = (e.lineIds || []).length;
      const what = e.kind === 'hold' ? 'held' : e.kind === 'cancel' ? 'cancelled' : 'corrected';
      markStale(e.encounterNo, e.reason || `${n || 'Released'} charge line${n === 1 ? '' : 's'} ${what} after assembly`);
    });
    mod.afterReleaseHooks?.push?.((e) => {
      if (e?.encounterNo && primaryOf(e.encounterNo)) onLateCharge(e.encounterNo, e.lineIds || []);
    });
  }
}

// The peers load in parallel; the seed and the load-time assembly wait for all
// three to settle, so a seeded line carries the capture register's id when the
// register exists and the ledger's when it does not.
const PEERS = [['charges', './charges.js'], ['coding', './coding.js'], ['clinicalDocs', './clinical-docs.js']];
export const peersReady = Promise.allSettled(
  PEERS.map(([key, path]) => import(path).then((mod) => wirePeer(key, mod))),
).then(() => { ensureAssembled(); assembleCoded(); });

let seeded = false;

/** Seed the assembly claims once, on the first read that needs them. */
export function ensureAssembled() {
  if (seeded) return;
  seeded = true;
  ensureAssemblySeed();
}

// A reset empties every table; the next read seeds the assembly claims again.
store.subscribe((reason) => { if (reason === 'reset') seeded = false; });

/**
 * The seeded assembly claims, once: the rows, then the scrub runs they were
 * seeded with, then the finalizations that pass — a seeded Ready claim whose
 * scrub no longer passes stays a draft rather than lying about its lock.
 */
function ensureAssemblySeed() {
  // A36 (found in verification): the remittance seed activates a Secondary
  // for a generated primary as it posts, and on a load where it ran first —
  // the sidebar badge that reads denials fires it before the peers settle —
  // "any claim with a kind" read as "already seeded" and the eleven assembly
  // claims never appeared. Only a Primary is proof the seed ran.
  if (all().some((c) => c.kind === 'Primary')) return;
  const { claims: seeded, scrubs, finalize: ready, trail } = buildAssemblyClaims({ payloadFor, rowFor, releasedLines });
  // The upload register is seeded by id; the numbers are read off the table.
  for (const row of seeded) {
    for (const att of row.attachments) {
      const file = att.fileId ? claimAttachments.get(att.fileId) : null;
      if (file) file.claimNo = row.claimNo;
    }
  }
  const entries = audit.all();
  for (const { claimNo, at, by } of scrubs) {
    const row = get(claimNo);
    const run = row ? runScrub(row.id, { at, by, silent: true }) : null;
    if (!run) continue;
    const errors = run.findings.filter((f) => f.severity === 'Error').length;
    const warnings = run.findings.length - errors;
    entries.push({
      id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: row.id, action: 'Scrubbed', user: by, at,
      details: `${run.result} — ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`,
    });
  }
  for (const entry of trail) entries.push({ id: store.nextId('audit', 'AU-'), ...entry });
  for (const { claimNo, at } of ready) {
    const row = get(claimNo);
    if (!row || !canFinalize(row).ok) continue;
    row.status = 'Ready';
    row.finalizedAt = at;
    entries.push({
      id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: row.id, action: 'Status', user: 'Tarek Solh', at,
      details: `Draft → Ready — Finalized — ${scrubResult(row)} · ${usd(row.totals.payerShare)} to ${payers.get(row.payerId)?.nameEn || row.payerId}`,
    });
  }
  store.commit('claims.seed');
}


// --- A28: claim submission --------------------------------------------------------
// What a batch writes on a claim, and the cycle a claim goes round when the
// payer sends it back. A resubmission keeps the claim number: the record is
// the same, `cycle` counts the times it went to the payer, and the closed
// cycles sit in `cycles[]` with the batch, the dates and the rejection each
// ended in. `previousCycleNo` is the number of the cycle before the current
// one, and a closed cycle's `nextCycleNo` the number of the one that followed
// it. Every move here goes through setStatus, so the trail reads as before.
//
// Fields on the claim: cycle (1..n), previousCycleNo|null, nextCycleNo|null,
// cycles[{ cycle, batchNo, submittedAt, acknowledgedAt, rejection, nextCycleNo }],
// submission { batchNo, at, method, reference }|null, acknowledgedAt|null,
// rejection { code, reason, at, batchNo }|null, rejectedCycle { cycle, batchNo,
// code, reason, at }|null — the rejection a draft under fix is answering.

import { REJECTION_REASONS, rejectionReason, rejectionLabel, fixRouteOf } from '../seed/rejection-reasons.js';

export { REJECTION_REASONS, rejectionReason, rejectionLabel, fixRouteOf };

export const cycleOf = (claim) => Number(claim?.cycle) || 1;

/** Cycle 1 → n as one strip: the closed cycles, then the one the claim is on. */
export function cycleChain(claim) {
  if (!claim) return [];
  const closed = (claim.cycles || []).map((c) => ({
    cycle: c.cycle, batchNo: c.batchNo || null, submittedAt: c.submittedAt || null,
    acknowledgedAt: c.acknowledgedAt || null, rejection: c.rejection || null, status: c.rejection ? 'Rejected' : 'Closed', current: false,
  }));
  return [...closed, {
    cycle: cycleOf(claim), batchNo: claim.submission?.batchNo || claim.batchId || null, submittedAt: claim.submission?.at || null,
    acknowledgedAt: claim.acknowledgedAt || null, rejection: claim.rejection || null, status: claim.status, current: true,
  }];
}

/** Where the claim sits: in a batch (batchNo) or nowhere. Audited on the claim, not committed twice. */
export function assignBatch(id, batchNo, details = '') {
  const row = get(id);
  if (!row) return null;
  const was = row.batchId;
  if (was === (batchNo || null)) return row;
  row.batchId = batchNo || null;
  row.cycle = cycleOf(row);
  store.commit('claims.batch');
  log(row, batchNo ? 'Batched' : 'Unbatched', details || (batchNo ? `Included in ${batchNo}` : `Removed from ${was}`));
  return row;
}

/** The batch went to the payer: the claim is Submitted, on this cycle, by this method. */
export function markSubmitted(id, { batchNo, at = null, method = '', reference = '' } = {}) {
  const row = get(id);
  if (!row) return null;
  const when = at || new Date().toISOString();
  row.submission = { batchNo, at: when, method, reference };
  row.cycle = cycleOf(row);
  row.acknowledgedAt = null;
  row.rejection = null;
  return setStatus(id, 'Submitted', {
    submittedAt: iso(when), batchId: batchNo, reason: 'Submitted',
    details: `${batchNo} · cycle ${row.cycle} · ${method}${reference ? ` · ${reference}` : ''}`,
  });
}

/** The payer accepted the claim into adjudication. */
export function markAcknowledged(id, { batchNo, at = null, payerRef = '' } = {}) {
  const row = get(id);
  if (!row) return null;
  row.acknowledgedAt = at || new Date().toISOString();
  return setStatus(id, 'Acknowledged', { reason: 'Acknowledged', details: `${batchNo}${payerRef ? ` · payer ref ${payerRef}` : ''}` });
}

/** The payer sent the claim back unprocessed, with a code. */
export function markRejected(id, { batchNo, code, reason = '', at = null } = {}) {
  const row = get(id);
  if (!row) return null;
  row.rejection = { code, reason: reason || rejectionLabel(code), at: at || new Date().toISOString(), batchNo };
  return setStatus(id, 'Rejected', { reason: `Rejected ${code}`, details: `${rejectionLabel(code)}${reason ? ` — ${reason}` : ''} · ${batchNo}` });
}

/**
 * The claim never reached the payer, or was pulled from a batch before it did:
 * back to Ready with no submission on this cycle. Used by ejection.
 */
export function unsubmit(id, cause = '') {
  const row = get(id);
  if (!row || !['Submitted', 'Acknowledged'].includes(row.status)) return null;
  row.submission = null;
  row.acknowledgedAt = null;
  return setStatus(id, 'Ready', { submittedAt: null, batchId: null, reason: 'Ejected', details: cause });
}

/**
 * The desk takes a rejected claim back to fix it: Draft, its scrub voided,
 * out of the batch, with the rejection kept on `rejectedCycle` so the strip
 * can say what this cycle is answering. The route that fixes it is the
 * submission feature's business — this only opens the door.
 */
export function openForFix(id, details = '') {
  const row = get(id);
  if (!row || row.status !== 'Rejected') return null;
  const r = row.rejection || {};
  row.rejectedCycle = { cycle: cycleOf(row), batchNo: r.batchNo || row.batchId || null, code: r.code || null, reason: r.reason || '', at: r.at || null };
  row.scrubValid = false;
  row.stale = null;
  return setStatus(id, 'Draft', { batchId: null, reason: 'Fix & resubmit', details: details || `${r.code || 'Rejected'} — ${rejectionLabel(r.code)}` });
}

/**
 * resubmit(claimNo) → the claim on its next cycle. Called once a claim under
 * fix is finalized again: the rejected cycle closes into `cycles[]`, the
 * cycle count moves on, and the claim is Ready for the payer's next batch.
 * A claim with no rejected cycle to answer is handed back untouched.
 */
export function resubmit(claimNo) {
  const row = get(claimNo);
  if (!row) return null;
  const answering = row.rejectedCycle;
  if (!answering || answering.cycle !== cycleOf(row) || row.status !== 'Ready') return row;
  const closed = {
    cycle: answering.cycle, batchNo: answering.batchNo, submittedAt: row.submission?.at || row.submittedAt || null,
    acknowledgedAt: row.acknowledgedAt || null,
    rejection: { code: answering.code, reason: answering.reason, at: answering.at, batchNo: answering.batchNo },
    nextCycleNo: answering.cycle + 1,
  };
  row.cycles = [...(row.cycles || []), closed];
  row.previousCycleNo = answering.cycle;
  row.cycle = answering.cycle + 1;
  row.nextCycleNo = null;
  row.submission = null;
  row.submittedAt = null;
  row.acknowledgedAt = null;
  row.rejection = null;
  row.batchId = null;
  store.commit('claims.resubmit');
  log(row, 'Resubmitted', `Cycle ${closed.cycle} closed (${closed.rejection.code} — ${rejectionLabel(closed.rejection.code)}) · cycle ${row.cycle} Ready`);
  return row;
}

/** Rejected claims still waiting for a fix, oldest rejection first. */
export const rejectionsWorklist = () =>
  all().filter((c) => c.status === 'Rejected')
    .sort((a, b) => String(a.rejection?.at || '').localeCompare(String(b.rejection?.at || '')) || a.claimNo.localeCompare(b.claimNo));

/** Whole days since the rejection landed. */
export const rejectionAge = (claim, on = todayIso()) => {
  const from = iso(claim?.rejection?.at);
  return from ? Math.max(0, Math.round((Date.parse(on) - Date.parse(from)) / 86400000)) : 0;
};

// --- A29: remittance posting -----------------------------------------------------
// What a remittance writes onto a claim, and nothing else: the per-line answer
// the payer gave, the status move through setStatus, and the secondary claim a
// partial payment activates. data/repositories/remittances.js decides all of it
// (through data/engines/posting-engine.js) and calls in here to write; this
// section never reads a remittance.

/**
 * The cover behind the claim's own, or null — what a secondary claim would
 * bill. An assembled claim already has one defined beside it (A27) and that
 * one's cover wins; a generated claim reads the patient's chain directly.
 */
export function secondaryPolicyOf(claim) {
  if (!claim) return null;
  const defined = claim.encounterNo ? secondaryOf(claim.encounterNo) : null;
  if (defined) return { id: defined.policyId, payerId: defined.payerId, planId: defined.planId, claimNo: defined.claimNo };
  if (!claim.policyId) return null;
  const chain = policies.chain(claim.patientMrn);
  const at = chain.findIndex((p) => p.id === claim.policyId);
  const next = at >= 0 ? chain[at + 1] : null;
  return next ? { id: next.id, payerId: next.payerId, planId: next.planId, claimNo: null } : null;
}

/**
 * applyRemittance(id, { remittanceNo, lines, status, paid, adjusted, paidAt,
 * denialReasonCode, details, at, by }) → the claim. Each line takes the
 * payer's answer as `remittance { … }` and its status; a PR-* shift moves that
 * much of the line's payer share onto the patient, so the totals — and what
 * Performance reads as allowed — follow. Paid and adjusted accumulate across
 * remittances. The status move is setStatus, the one path; `at`/`by` let the
 * seed date the trail entry it writes.
 */
export function applyRemittance(id, {
  remittanceNo, lines = [], status, paid = 0, adjusted = 0, paidAt = null, denialReasonCode = null,
  details = '', at = null, by = null,
} = {}) {
  const row = get(id);
  if (!row || !STATUSES.includes(status)) return null;
  for (const result of lines) {
    const line = row.lines.find((l) => l.id === result.lineId);
    if (!line) continue;
    const shift = cents(result.patientShift);
    if (shift > 0) {
      line.payerShare = cents(line.payerShare - shift);
      line.patientShare = cents(line.patientShare + shift);
    }
    line.remittance = {
      remittanceNo, paid: cents(result.paid), adjustment: cents(result.adjustment), adjCode: result.adjCode || null,
      denied: cents(result.denied), denialCode: result.denialCode || null, patientShift: shift,
      outcome: result.outcome, variance: cents(result.variance), at: at || new Date().toISOString(),
    };
    line.status = result.outcome === 'Denied' ? 'Denied'
      : result.outcome === 'Underpaid' ? 'Partially Paid'
        : 'Paid';
    if (result.denied > 0) line.denialReasonCode = result.denialReasonCode || line.denialReasonCode || null;
  }
  const previous = row.status;
  const payload = {
    paid: cents((row.totals?.paid || 0) + paid),
    adjusted: cents((row.totals?.adjusted || 0) + adjusted),
    remittanceId: remittanceNo,
    denialReasonCode: status === 'Denied' ? denialReasonCode : row.denialReasonCode,
    reason: `Remittance ${remittanceNo}`,
    details,
  };
  if (paidAt) payload.paidAt = paidAt;
  const moved = setStatus(id, status, payload);
  if (!moved) return null;
  if (!(moved.remittances || []).includes(remittanceNo)) moved.remittances = [...(moved.remittances || []), remittanceNo];
  moved.statusBeforeRemittance = previous;
  if (at || by) restamp(moved, at, by);
  return moved;
}

/**
 * revertRemittance(id, { remittanceNo, status, reason, at, by }) → the claim
 * with that remittance's answers taken off its lines, its money out of the
 * totals and its status back where it was — a reversed posting.
 */
export function revertRemittance(id, { remittanceNo, status, reason = '', at = null, by = null } = {}) {
  const row = get(id);
  if (!row) return null;
  let paid = 0;
  let adjusted = 0;
  for (const line of row.lines) {
    const r = line.remittance;
    if (!r || r.remittanceNo !== remittanceNo) continue;
    if (r.patientShift > 0) {
      line.payerShare = cents(line.payerShare + r.patientShift);
      line.patientShare = cents(line.patientShare - r.patientShift);
    }
    paid += r.paid;
    adjusted += cents(r.adjustment - r.patientShift);
    delete line.remittance;
    line.status = 'Open';
    line.denialReasonCode = null;
  }
  row.remittances = (row.remittances || []).filter((no) => no !== remittanceNo);
  const back = STATUSES.includes(status) ? status : (row.statusBeforeRemittance || 'Acknowledged');
  const moved = setStatus(id, back, {
    paid: Math.max(0, cents((row.totals?.paid || 0) - paid)),
    adjusted: Math.max(0, cents((row.totals?.adjusted || 0) - adjusted)),
    paidAt: row.remittances.length ? row.paidAt : null,
    remittanceId: row.remittances[row.remittances.length - 1] || null,
    denialReasonCode: null,
    reason: `Remittance ${remittanceNo} reversed`,
    details: reason,
  });
  if (moved && (at || by)) restamp(moved, at, by);
  return moved;
}

/**
 * activateSecondary(primaryId, { remittanceNo, policy, lines, primaryPayment,
 * at, by }) → the secondary claim. The one defined beside the primary at
 * assembly takes the lines; a primary that has none (a generated claim) gets
 * one defined now. Its lines are what the primary's payer left on each line —
 * expected less paid — billed whole to the next cover; it is a Draft the
 * portfolio can now scrub and finalize, and the chain is written both ways.
 */
export function activateSecondary(primaryId, { remittanceNo, policy, lines = [], primaryPayment = {}, at = null, by = null } = {}) {
  const primary = get(primaryId);
  if (!primary || !policy || !lines.length) return null;
  let row = primary.encounterNo ? secondaryOf(primary.encounterNo) : null;
  if (row && row.activatedAt) return row;
  const when = at || new Date().toISOString();
  if (!row) row = defineSecondaryFor(primary, policy, when);
  row.lines = lines.map((l) => {
    const src = primary.lines.find((p) => p.id === l.lineId) || {};
    return {
      itemId: src.itemId, qty: src.qty, grossBilled: src.grossBilled, allowedExpected: cents(l.remaining),
      payerShare: cents(l.remaining), patientShare: 0, isOverage: src.isOverage, ledgerTxIds: src.ledgerTxIds,
      chargeLineId: src.chargeLineId, chargeCode: src.chargeCode, description: src.description,
      dateOfService: src.dateOfService, primaryLineId: src.id, primaryPaid: cents(src.remittance?.paid),
    };
  });
  row.activatedAt = when;
  row.primaryPayment = { remittanceNo, ...primaryPayment, at: when };
  row.stale = null;
  row.scrubValid = false;
  syncClaim(row);
  Object.assign(row, flatOf(row.lines[0]));
  primary.childClaimNos = [...new Set([...(primary.childClaimNos || []), row.claimNo])];
  row.parentClaimNo = primary.claimNo;
  audit.all().push({
    id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: row.id, action: 'Activated', user: by || currentRole().name, at: when,
    details: `Activated by ${remittanceNo} — ${primary.claimNo} left ${usd(row.totals.payerShare)} on ${row.lines.length} line${row.lines.length === 1 ? '' : 's'} for ${payers.get(row.payerId)?.nameEn || row.payerId}`,
  });
  store.commit('claims.activate');
  return row;
}

/** A reversed posting takes the activation back: the secondary is a defined, empty draft again. */
export function deactivateSecondary(secondaryId, reason = '', { at = null, by = null } = {}) {
  const row = get(secondaryId);
  if (!row || kindOf(row) !== 'Secondary' || !row.activatedAt || row.status !== 'Draft') return row;
  row.lines = [];
  row.activatedAt = null;
  row.primaryPayment = null;
  row.scrubValid = false;
  syncClaim(row);
  Object.assign(row, flatOf(null));
  audit.all().push({
    id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: row.id, action: 'Deactivated', user: by || currentRole().name,
    at: at || new Date().toISOString(), details: reason || 'The primary’s posting was reversed',
  });
  store.commit('claims.deactivate');
  return row;
}

/** A secondary row in the primary's image, for a primary that was never assembled. */
function defineSecondaryFor(primary, policy, at) {
  const contract = contracts.contractForService(policy.payerId, policy.planId, primary.dateOfService);
  const row = {
    id: store.nextId(TABLE, 'CLM-'),
    claimNo: nextClaimNo(Number(String(primary.dateOfService).slice(0, 4)) || new Date().getFullYear()),
    patientMrn: primary.patientMrn,
    encounterNo: primary.encounterNo || null,
    payerId: policy.payerId,
    planId: policy.planId,
    policyId: policy.id,
    contractId: contract?.id || null,
    status: 'Draft',
    dateOfService: primary.dateOfService,
    createdAt: at,
    submittedAt: null,
    batchId: null,
    remittanceId: null,
    lines: [],
    totals: { paid: 0, adjusted: 0 },
    denialReasonCode: null,
    scrubberFindings: [],
    attachments: [],
    allowedPaid: 0,
    paidAt: null,
    appealed: false,
    ...assemblyFields(),
    kind: 'Secondary',
    parentClaimNo: primary.claimNo,
    assembledAt: at,
    encounterType: primary.encounterType || null,
    department: primary.department || null,
    doctorId: primary.doctorId || null,
    contractNo: contract?.contractNo || null,
    contractVersion: contract?.version ?? null,
    snapshotRef: primary.snapshotRef || null,
    referralNo: primary.referralNo || null,
    dateOfServiceTo: primary.dateOfServiceTo || null,
  };
  syncClaim(row);
  all().push(row);
  audit.all().push({
    id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: row.id, action: 'Created', user: 'System', at,
    details: `Secondary defined behind ${primary.claimNo} — the next cover in the chain`,
  });
  return row;
}

/** The seed's clock: the entry setStatus just wrote takes the time the event happened. */
function restamp(row, at, by) {
  const entries = audit.all();
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const e = entries[i];
    if (e.entity === ENTITY && e.entityId === row.id && e.action === 'Status') {
      if (at) e.at = at;
      if (by) e.user = by;
      return;
    }
  }
}

// --- A33: write-off management ----------------------------------------------------
// What a write-off writes onto a claim, and nothing else: an amount let go off
// the payer's share, kept as its own entry so the trail and the reversal can
// name it. data/repositories/writeoffs.js decides whether it may happen and
// calls in here to write; this section never reads a write-off. The status is
// not moved here — a denial resolved by a write-off is the denial feature's
// call, and a residual let go leaves the claim Partially Paid with nothing
// owed, which is what it is.

/** What the payer still owes on the claim: its share less paid, less adjusted, never below zero. */
export const openBalance = (claim) => Math.max(0, cents(claim?.totals?.balance));

/** The adjustments a write-off has written, newest last. */
export const adjustmentsOf = (claim) => claim?.adjustments || [];

/**
 * adjust(claimNo, { amount, reasonCode, writeoffId, note, at, by, commit }) →
 * the claim, or null when it is unknown or the amount is not positive. Adds
 * the amount to `totals.adjusted` (so the balance falls by it), keeps the
 * entry under `adjustments[]` keyed on the write-off, re-derives the totals
 * and audits "Adjusted". `at`/`by`/`commit` let the seed write history.
 */
export function adjust(claimNo, { amount, reasonCode = null, writeoffId = null, note = '', at = null, by = null, commit = true } = {}) {
  const row = get(claimNo);
  const value = cents(amount);
  if (!row || value <= 0) return null;
  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  const entry = { id: `ADJ-${(row.adjustments || []).length + 1}`, writeoffId, amount: value, reasonCode, note: note || null, at: when, by: who, reversedAt: null };
  row.adjustments = [...(row.adjustments || []), entry];
  row.totals = { ...(row.totals || {}), adjusted: cents((row.totals?.adjusted || 0) + value) };
  syncClaim(row);
  if (commit) store.commit('claims.adjust');
  audit.all().push({
    id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: row.id, action: 'Adjusted', user: who, at: when,
    details: `${usd(value)} written off the payer share${reasonCode ? ` — ${reasonCode}` : ''}${writeoffId ? ` · ${writeoffId}` : ''}${note ? ` — ${note}` : ''}`,
  });
  return row;
}

/**
 * reverseAdjustment(claimNo, { writeoffId, reason, at, by, commit }) → the
 * claim, or null when no live adjustment carries that write-off. The entry is
 * marked reversed and its amount comes back off `totals.adjusted`, so the
 * balance is what it was before the write-off; audited "Adjustment reversed".
 */
export function reverseAdjustment(claimNo, { writeoffId, reason = '', at = null, by = null, commit = true } = {}) {
  const row = get(claimNo);
  const entry = (row?.adjustments || []).find((a) => a.writeoffId === writeoffId && !a.reversedAt);
  if (!row || !entry) return null;
  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  entry.reversedAt = when;
  entry.reversedBy = who;
  entry.reversalReason = reason || null;
  row.totals = { ...(row.totals || {}), adjusted: Math.max(0, cents((row.totals?.adjusted || 0) - entry.amount)) };
  syncClaim(row);
  if (commit) store.commit('claims.adjust.reverse');
  audit.all().push({
    id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: row.id, action: 'Adjustment reversed', user: who, at: when,
    details: `${usd(entry.amount)} put back on the payer share · ${writeoffId}${reason ? ` — ${reason}` : ''}`,
  });
  return row;
}

// --- A31: denial routing -----------------------------------------------------------
// A denied claim routed back to the desk — Refresh or Recode — is reopened
// the way a rejected one is (A28's openForFix), so the same chain carries it
// out again: Draft, then Ready, then the submission feature's subscription
// closes the cycle and puts it in the payer's open batch. Nothing here reads
// a denial; the denial repository decides and calls in.

/**
 * openForDenial(id, { denialId, code, reason, at, by }) → the claim as a
 * Draft, or null when it is not one the payer answered. The denial's code
 * stands where the rejection's did on `rejectedCycle`, which is what
 * `resubmit` closes into `cycles[]` once the claim is Ready again.
 */
export function openForDenial(id, { denialId = null, code = null, reason = '', at = null, by = null } = {}) {
  const row = get(id);
  if (!row || !['Denied', 'Appealed', 'Partially Paid'].includes(row.status)) return null;
  row.rejectedCycle = {
    cycle: cycleOf(row), batchNo: row.batchId || null, code: code || row.denialReasonCode || null,
    reason: reason || denialLabel(row.denialReasonCode), at: at || new Date().toISOString(), denialId,
  };
  row.scrubValid = false;
  row.stale = null;
  row.statusBeforeDenialFix = row.status;
  const moved = setStatus(id, 'Draft', { batchId: null, reason: 'Fix & resubmit', details: `Denial ${denialId || ''} — ${code || ''} ${reason || ''}`.replace(/\s+/g, ' ').trim() });
  if (moved && (at || by)) restamp(moved, at, by);
  return moved;
}

// --- A32: claim nullification -----------------------------------------------------
// What a nullification writes on a claim, and the fresh claim that may
// replace it. data/repositories/nullifications.js decides the path, the
// gates and the disposition and calls in here to write; this section never
// reads a nullification. Fields on the claim: nullification { no, at } | null,
// statusAtNullification, replacedBy | null (the claim number assembled in its
// place), replaces | null (the claim number this one was assembled to replace).
// Void is the status; the lines are kept as they were billed — the record of
// what was withdrawn — and each reads Void.

export const isNullified = (claim) => Boolean(claim?.nullification?.no);

/**
 * nullify(claimNo, { nullificationNo, reasonCode, reasonLabel, justification,
 * path, at, by }) → the claim, Void, or null when it is already void or
 * unknown. The status move is setStatus, the one path, audited as
 * "Status: from → Void — Nullified NUL-… — N0x label — justification". An
 * unactivated secondary defined beside a nullified primary goes with it: it
 * was defined for a claim that no longer exists, and a replacement defines
 * its own.
 */
export function nullify(claimNo, {
  nullificationNo, reasonCode = '', reasonLabel = '', justification = '', path = '', at = null, by = null,
} = {}) {
  const row = get(claimNo);
  if (!row || row.status === 'Void' || !nullificationNo) return null;
  const when = at || new Date().toISOString();
  row.statusAtNullification = row.status;
  row.nullification = { no: nullificationNo, at: when, path: path || null };
  row.replacedBy = row.replacedBy || null;
  row.replaces = row.replaces || null;
  for (const line of row.lines) line.status = 'Void';
  row.scrubValid = false;
  row.stale = null;
  const moved = setStatus(row.id, 'Void', {
    reason: `Nullified ${nullificationNo}`,
    details: `${reasonCode} ${reasonLabel}${justification ? ` — ${justification}` : ''}${path ? ` · ${path}` : ''}`,
  });
  if (!moved) return null;
  if (at || by) restamp(moved, at, by);
  for (const childNo of moved.childClaimNos || []) {
    const child = get(childNo);
    if (!child || kindOf(child) !== 'Secondary' || child.activatedAt || child.status !== 'Draft') continue;
    child.nullification = { no: nullificationNo, at: when, path: path || null, via: moved.claimNo };
    child.statusAtNullification = child.status;
    child.scrubValid = false;
    const gone = setStatus(child.id, 'Void', {
      reason: `Nullified ${nullificationNo}`,
      details: `Defined behind ${moved.claimNo}, which was nullified — a replacement defines its own secondary`,
    });
    if (gone && (at || by)) restamp(gone, at, by);
  }
  return moved;
}

/**
 * assembleReplacement(nullifiedClaimNo, { at, by }) → { claim, created,
 * secondary, reason }. Always a fresh assembly of the visit as it stands now —
 * its classification, its coding, its released lines — never a copy of the
 * claim that was withdrawn. The two are linked both ways (`replaces` /
 * `replacedBy`) and each trail names the other. A self-pay visit, a visit
 * with no released lines, or one that already carries a live primary
 * assembles nothing and says why.
 */
export function assembleReplacement(nullifiedClaimNo, { at = null, by = null } = {}) {
  ensureAssembled();
  const old = get(nullifiedClaimNo);
  if (!old) return { claim: null, created: false, secondary: null, reason: `No claim ${nullifiedClaimNo}` };
  if (old.status !== 'Void') return { claim: null, created: false, secondary: null, reason: `${old.claimNo} is ${old.status}, not void` };
  if (!old.encounterNo) return { claim: null, created: false, secondary: null, reason: 'No visit behind this claim to assemble from' };
  const existing = primaryOf(old.encounterNo);
  if (existing) return { claim: existing, created: false, secondary: secondaryOf(old.encounterNo), reason: `${old.encounterNo} already carries ${existing.claimNo}` };
  const enc = encounters.get(old.encounterNo);
  if (!enc) return { claim: null, created: false, secondary: null, reason: `Encounter ${old.encounterNo} is gone` };
  const charges = releasedLines(enc.no);
  const payload = assembler.assemble(enc, codingOf(enc.no), charges, assemblyContext(enc));
  if (payload.selfPay) return { claim: null, created: false, secondary: null, reason: payload.reason };
  if (!charges.length) return { claim: null, created: false, secondary: null, reason: 'No released charges on the visit' };

  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  const row = rowFor(payload, { createdAt: when });
  row.replaces = old.claimNo;
  old.replacedBy = row.claimNo;
  store.commit('claims.assemble');
  const n = payload.lines.length;
  audit.all().push({
    id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: row.id, action: 'Created', user: who, at: when,
    details: `Assembled from ${enc.no} to replace ${old.claimNo} (${old.nullification?.no || 'nullified'}) · ${n} line${n === 1 ? '' : 's'}${
      payload.coding ? ` · coding v${payload.coding.version}` : ' · not coded'}${
      payload.header.contractNo ? ` · ${payload.header.contractNo} v${payload.header.contractVersion}` : ' · no contract'}`,
  });
  audit.all().push({
    id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: old.id, action: 'Replaced', user: who, at: when,
    details: `Replaced by ${row.claimNo} — assembled fresh from ${enc.no}`,
  });
  const secondary = payload.secondary ? defineSecondary(row, payload) : null;
  return { claim: row, created: true, secondary, reason: '' };
}
