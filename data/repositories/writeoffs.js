// Repository — write-offs. Owner: modules/claima (amendment 33).
//
// A write-off is a request first and a posting second, and the two are never
// the same act: somebody asks for an amount to be let go, somebody else signs
// it at the tier the amount needs (data/engines/writeoff-tiers.js), and only
// then is it posted — against the claim's open balance on the payer side, or
// as an Adjustment row on the patient's ledger on the patient side. The chain
// request → decision → posting is immutable: nothing here edits a step once it
// is signed, and a posting is undone by a linked reversal, never by deletion.
//
// Posting re-validates against what is outstanding *now*: a balance that
// shrank since the request caps the posting (and says so), one that grew is
// never chased — the request is for the amount it named.
//
// The denials repository is reached by dynamic import and feature-detected,
// because that feature reaches this one the same way; the seed waits for it
// (`peersReady`), so a seeded request can name the denial it answers. Over the
// file cap on purpose: one entity, one file.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as claims from './claims.js';
import * as accounts from './accounts.js';
import * as ledger from './ledger.js';
import * as patients from './patients.js';
import * as encounters from './encounters.js';
import * as payers from './payers.js';
import * as accountEngine from '../engines/account-engine.js';
import * as tiersEngine from '../engines/writeoff-tiers.js';
import {
  WRITEOFF_REASONS, CLASSIFICATIONS, EVIDENCE_REASONS, reason, reasonLabel, classificationOf,
} from '../seed/writeoff-reasons.js';
import { buildWriteoffs } from '../seed/writeoffs.js';
import { current as currentRole } from '../../shared/roles.js';
import { compareDates, iso, todayIso, usd } from '../../shared/format.js';

const TABLE = 'writeoffs';
const ENTITY = 'writeoffs';

export const STATUSES = ['Pending Approval', 'Approved', 'Rejected', 'Posted', 'Reversed'];
export const SOURCE_KINDS = ['Denial', 'ClaimResidual', 'PatientBalance', 'AgedItem'];
export const SOURCE_LABELS = {
  Denial: 'Denial', ClaimResidual: 'Claim residual', PatientBalance: 'Patient balance', AgedItem: 'Aged item',
};
export const SIDES = ['Payer', 'Patient'];
export const PERIODS = ['MTD', 'QTD', 'YTD'];
/** Upper bound of each band; the last is open-ended. */
export const AMOUNT_BANDS = [100, 500, 5000];
export { WRITEOFF_REASONS, CLASSIFICATIONS, EVIDENCE_REASONS, reason, reasonLabel, classificationOf };
export const MODES = tiersEngine.MODES;
export const tierLabel = tiersEngine.tierLabel;
export const canDecide = tiersEngine.canDecide;
export const canReverse = tiersEngine.canReverse;
export const currentStep = (row) => tiersEngine.currentStep(row?.tier);

/** The write-off reason a denial's Performance key reads as when it is routed here. */
const REASON_OF_DENIAL = { LATE_FILING: 'W02', COV_RULE: 'W01' };

// --- peers ---------------------------------------------------------------------------

const peers = { denials: null };
let settled = false;

/** The denials repository, once loaded — null when the feature is absent. */
export const peerStatus = () => ({ denials: Boolean(peers.denials) });

export const peersReady = import('./denials.js')
  .then((mod) => { peers.denials = mod; })
  .catch(() => {})
  .then(() => { settled = true; ensureSeeded(); });

// --- reading ---------------------------------------------------------------------------

export function all() {
  const rows = store.table(TABLE);
  if (!rows.length && settled) ensureSeeded();
  return rows;
}

export const get = (id) => all().find((w) => w.id === id) || null;

const byAt = (a, b) => String(a.at).localeCompare(String(b.at)) || a.id.localeCompare(b.id);

/** Every write-off raised against a claim — its residual, a denial on it, an aged item — oldest first. */
export const byClaim = (claimNo) => all().filter((w) => w.source?.claimNo === claimNo).sort(byAt);

/** Every write-off on one patient's account, either side, oldest first. */
export const byAccount = (mrn) => all().filter((w) => w.source?.mrn === mrn).sort(byAt);

export const isLive = (w) => ['Pending Approval', 'Approved', 'Posted'].includes(w?.status);

/** The requests a role can sign now — waiting, at a tier it holds, and not its own — oldest first. */
export const pendingFor = (role = currentRole()) =>
  all().filter((w) => w.status === 'Pending Approval' && tiersEngine.canDecide(w, role).ok).sort(byAt);

export const history = (id) => audit.forEntity(ENTITY, id);

export function statusTone(status) {
  return { 'Pending Approval': 'warning', Approved: 'info', Rejected: 'critical', Posted: 'success', Reversed: 'neutral' }[status] || '';
}

export const bandOf = (amount) => {
  const value = Number(amount) || 0;
  const i = AMOUNT_BANDS.findIndex((max) => value <= max);
  return i < 0 ? AMOUNT_BANDS.length : i;
};

export const bandLabel = (i) => {
  if (i === 0) return `Under ${usd(AMOUNT_BANDS[0])}`;
  if (i >= AMOUNT_BANDS.length) return `Over ${usd(AMOUNT_BANDS[AMOUNT_BANDS.length - 1])}`;
  return `${usd(AMOUNT_BANDS[i - 1])} – ${usd(AMOUNT_BANDS[i])}`;
};

export const payerOf = (w) => (w.source?.claimNo ? claims.get(w.source.claimNo)?.payerId || null : null);

export const payerName = (w) => payers.get(payerOf(w))?.nameEn || (w.side === 'Patient' ? 'Self-pay / patient' : '—');

/**
 * search(q, { status, source, reasonCode, classification, band, side, from, to, mine })
 * → rows, newest first, unless `mine` (pending my approval), which is oldest
 * first — a queue is worked from the front. `q` matches the id, the source
 * reference, the claim number, the MRN, the patient's name and the requester.
 */
export function search(q = '', {
  status = '', source = '', reasonCode = '', classification = '', band = '', side = '', from = '', to = '', mine = false,
} = {}) {
  const needle = q.trim().toLowerCase();
  const role = currentRole();
  const rows = mine ? pendingFor(role) : [...all()].sort((a, b) => byAt(b, a));
  return rows.filter((w) => {
    if (needle) {
      const patient = patients.get(w.source?.mrn);
      const hay = [w.id, w.source?.ref, w.source?.claimNo, w.source?.mrn, w.source?.encounterNo, w.requestedBy,
        patient?.nameEn, patient?.nameAr, payerName(w)].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (status && w.status !== status) return false;
    if (source && w.source?.kind !== source) return false;
    if (reasonCode && w.reasonCode !== reasonCode) return false;
    if (classification && w.classification !== classification) return false;
    if (band !== '' && bandOf(w.amountRequested) !== Number(band)) return false;
    if (side && w.side !== side) return false;
    const on = iso(w.at);
    if (from && compareDates(on, from) < 0) return false;
    if (to && compareDates(on, to) > 0) return false;
    return true;
  });
}

/** The rail. Every figure is over the whole register. */
export function counts() {
  const rows = all();
  const pending = rows.filter((w) => w.status === 'Pending Approval');
  const approved = rows.filter((w) => w.status === 'Approved');
  const mtd = periodRange('MTD');
  const postedMtd = rows.filter((w) => w.status === 'Posted' && inRange(w.posting?.at, mtd));
  const ytd = rows.filter((w) => w.status === 'Posted' && inRange(w.posting?.at, periodRange('YTD')));
  const ytdValue = sum(ytd, (w) => w.amountPosted);
  const discretionary = sum(ytd.filter((w) => w.classification === 'Discretionary'), (w) => w.amountPosted);
  return {
    pending: pending.length,
    pendingValue: sum(pending, (w) => w.amountRequested),
    mine: pendingFor().length,
    approved: approved.length,
    approvedValue: sum(approved, (w) => w.amountRequested),
    postedMtd: postedMtd.length,
    postedMtdValue: sum(postedMtd, (w) => w.amountPosted),
    discretionaryPct: ytdValue ? discretionary / ytdValue : 0,
    discretionaryValue: discretionary,
    postedYtdValue: ytdValue,
    postedYtd: ytd.length,
  };
}

// --- the source and what is outstanding on it -----------------------------------------

/** The denial a request answers, when the feature is loaded. */
export const denialOf = (w) => (w?.source?.kind === 'Denial' && peers.denials ? peers.denials.get(w.source.ref) : null);

/**
 * What can still be written off on a source right now: the patient's
 * outstanding balance on the patient side; on the payer side the denial's open
 * amount when a denial is named and the feature knows it, else the claim's
 * open balance.
 */
export function outstandingFor(source = {}, side = 'Payer') {
  if (side === 'Patient') return source.mrn ? Math.max(0, accounts.balances(source.mrn).outstanding) : 0;
  if (source.kind === 'Denial' && peers.denials) {
    const denial = peers.denials.get(source.ref);
    if (denial?.amounts && Number.isFinite(Number(denial.amounts.open))) return cents(Math.max(0, denial.amounts.open));
    if (denial && Number.isFinite(Number(denial.amount))) return cents(Math.max(0, denial.amount));
  }
  const claim = source.claimNo ? claims.get(source.claimNo) : null;
  return claim ? claims.openBalance(claim) : 0;
}

/** Days the balance has been waiting: since the claim's service, or since the oldest open charge. */
export function agingOf(source = {}, side = 'Payer') {
  const today = todayIso();
  if (side === 'Patient') {
    const open = source.mrn ? accounts.openCharges(source.mrn) : [];
    const oldest = open.length ? iso(open[0].at) : null;
    return oldest ? daysBetween(oldest, today) : 0;
  }
  const claim = source.claimNo ? claims.get(source.claimNo) : null;
  const since = claim?.submittedAt || claim?.dateOfService || null;
  return since ? daysBetween(iso(since), today) : 0;
}

/**
 * Everything the request and decision screens show beside the amount: the
 * records behind the source, what is outstanding, how old it is, and the
 * write-offs already raised on the same claim or account.
 */
export function contextFor(source = {}, side = 'Payer', { excludeId = null } = {}) {
  const claim = source.claimNo ? claims.get(source.claimNo) : null;
  const patient = patients.get(source.mrn || claim?.patientMrn);
  const encounter = encounters.get(source.encounterNo || claim?.encounterNo);
  const denial = source.kind === 'Denial' && peers.denials ? peers.denials.get(source.ref) : null;
  const payer = payers.get(claim?.payerId);
  const prior = [...new Map([...(claim ? byClaim(claim.claimNo) : []), ...(patient ? byAccount(patient.mrn) : [])]
    .filter((w) => w.id !== excludeId).map((w) => [w.id, w])).values()].sort(byAt);
  return {
    side,
    claim,
    patient,
    encounter,
    denial,
    payer,
    outstanding: outstandingFor(source, side),
    agingDays: agingOf(source, side),
    balances: patient ? accounts.balances(patient.mrn) : null,
    prior,
    priorValue: sum(prior.filter((w) => w.status === 'Posted'), (w) => w.amountPosted),
  };
}

/** The side a source kind is written on. */
export const sideOf = (kind) => (kind === 'PatientBalance' ? 'Patient' : 'Payer');

/**
 * The sources a request may be raised against, for the picker: open denials
 * (when the feature is loaded), claims with a residual balance, aged claims
 * still with the payer, and patient accounts owing. Each is { kind, ref,
 * claimNo, mrn, encounterNo, label, outstanding }.
 */
export function sourceOptions(kind) {
  if (kind === 'Denial') {
    if (!peers.denials) return [];
    const open = (peers.denials.worklist ? peers.denials.worklist() : peers.denials.all().filter((d) => d.status === 'Open'));
    return open.map((d) => ({
      kind, ref: d.id, claimNo: d.claimNo, mrn: d.patientMrn || claims.get(d.claimNo)?.patientMrn || null,
      encounterNo: d.encounterNo || claims.get(d.claimNo)?.encounterNo || null,
      label: `${d.id} · ${d.claimNo} · ${peers.denials.denialCodeLabel ? peers.denials.denialCodeLabel(d.code) : d.reason}`,
      outstanding: outstandingFor({ kind, ref: d.id, claimNo: d.claimNo }, 'Payer'),
      reasonCode: REASON_OF_DENIAL[d.reasonCode] || 'W06',
    })).filter((s) => s.outstanding > 0);
  }
  if (kind === 'ClaimResidual') {
    return claims.all().filter((c) => c.status === 'Partially Paid' && claims.openBalance(c) > 0)
      .sort((a, b) => claims.openBalance(b) - claims.openBalance(a))
      .map((c) => ({ kind, ref: c.claimNo, claimNo: c.claimNo, mrn: c.patientMrn, encounterNo: c.encounterNo,
        label: `${c.claimNo} · ${payers.get(c.payerId)?.nameEn || c.payerId} · ${usd(claims.openBalance(c))} open`,
        outstanding: claims.openBalance(c), reasonCode: 'W01' }));
  }
  if (kind === 'AgedItem') {
    // A claim the payer has gone quiet on — and one whose chain a nullification
    // ended (A32: Rejected, never resubmitted, now Void with `nullification.path`),
    // whose balance is exactly what a write-off review picks up.
    const ended = (c) => c.status === 'Void' && (c.nullification?.path === 'EndChain' || c.chainEnded);
    return claims.all().filter((c) => (claims.isPending(c) || ended(c)) && claims.openBalance(c) > 0)
      .sort((a, b) => compareDates(a.submittedAt || a.dateOfService, b.submittedAt || b.dateOfService))
      .map((c) => ({ kind, ref: c.claimNo, claimNo: c.claimNo, mrn: c.patientMrn, encounterNo: c.encounterNo,
        label: `${c.claimNo} · ${payers.get(c.payerId)?.nameEn || c.payerId} · ${ended(c)
          ? `chain ended ${c.nullification?.no || ''}`.trim()
          : `with the payer ${daysBetween(iso(c.submittedAt || c.dateOfService), todayIso())} d`}`,
        outstanding: claims.openBalance(c), reasonCode: ended(c) ? 'W02' : 'W07' }));
  }
  if (kind === 'PatientBalance') {
    return accounts.search('', { outstanding: 'owing' })
      .map((a) => ({ kind, ref: a.mrn, claimNo: null, mrn: a.mrn, encounterNo: null,
        label: `${a.mrn} · ${a.patient?.nameEn || a.mrn} · ${usd(a.balances.outstanding)} owing`,
        outstanding: a.balances.outstanding, reasonCode: a.balances.outstanding < 25 ? 'W03' : 'W05' }));
  }
  return [];
}

// --- writes: request → decision → posting → reversal ---------------------------------

export function nextNo(year = new Date().getFullYear()) {
  const prefix = `WO-${year}-`;
  const max = all().reduce((n, row) => {
    if (!String(row.id).startsWith(prefix)) return n;
    const digits = Number(String(row.id).slice(prefix.length));
    return Number.isFinite(digits) && digits > n ? digits : n;
  }, 46);
  return prefix + String(max + 1).padStart(6, '0');
}

/**
 * validate(data) → problems[]. What the request screen shows live and what
 * `request` refuses on: a positive amount no larger than what is outstanding,
 * a reason the list knows, a justification, evidence when the reason wants it,
 * and no other live request on the same source.
 */
export function validate({ source = {}, side = 'Payer', amount, reasonCode, justification = '', hardshipEvidence = null, mode } = {}, { excludeId = null } = {}) {
  const problems = [];
  const value = cents(amount);
  if (!source.kind || !source.ref) problems.push('Pick what is being written off.');
  const outstanding = outstandingFor(source, side);
  if (!(value > 0)) problems.push('Enter an amount above zero.');
  else if (value > outstanding) problems.push(`The amount is more than the ${usd(outstanding)} outstanding.`);
  if (!reason(reasonCode)) problems.push('Pick a reason.');
  if (!String(justification).trim()) problems.push('Say why it should be written off.');
  if (EVIDENCE_REASONS.includes(reasonCode) && !hardshipEvidence?.fileName) problems.push('A hardship write-off needs evidence on file — attach it.');
  if (mode && !tiersEngine.MODES.includes(mode)) problems.push('Pick an approval mode.');
  const clash = all().find((w) => w.id !== excludeId && isLive(w) && w.status !== 'Posted'
    && w.source?.kind === source.kind && w.source?.ref === source.ref);
  if (clash) problems.push(`${clash.id} is already ${clash.status.toLowerCase()} on this ${SOURCE_LABELS[source.kind]?.toLowerCase() || 'source'}.`);
  return problems;
}

/**
 * request({ source, side, amount, reasonCode, justification, hardshipEvidence,
 * mode, rerequestOf }, { at, by, commit }) → the row, or { error }. The tier
 * ladder is computed from the amount and the mode; the requester is stamped
 * and can never sign it.
 */
export function request(data = {}, { at = null, by = null, commit = true } = {}) {
  const side = data.side || sideOf(data.source?.kind);
  const problems = validate({ ...data, side });
  if (problems.length) return { error: problems.join(' ') };
  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  const mode = data.mode || tiersEngine.defaultMode();
  const row = {
    id: nextNo(new Date(when).getFullYear()),
    source: {
      kind: data.source.kind,
      ref: data.source.ref,
      encounterNo: data.source.encounterNo || null,
      claimNo: data.source.claimNo || null,
      mrn: data.source.mrn || null,
    },
    side,
    amountRequested: cents(data.amount),
    amountPosted: null,
    reasonCode: data.reasonCode,
    classification: classificationOf(data.reasonCode),
    justification: String(data.justification).trim(),
    hardshipEvidence: data.hardshipEvidence?.fileName ? { fileName: data.hardshipEvidence.fileName, size: data.hardshipEvidence.size || 0 } : null,
    status: 'Pending Approval',
    tier: tiersEngine.tierBlock(data.amount, mode),
    requestedBy: who,
    at: when,
    decision: null,
    posting: null,
    reversal: null,
    rerequestOf: data.rerequestOf || null,
  };
  all().push(row);
  if (row.rerequestOf) {
    const earlier = get(row.rerequestOf);
    if (earlier) earlier.rerequestId = row.id;
  }
  log(row, 'Requested', `${usd(row.amountRequested)} · ${row.reasonCode} ${reasonLabel(row.reasonCode)} (${row.classification}) · ${SOURCE_LABELS[row.source.kind]} ${row.source.ref} · ${tiersEngine.tierLabel(row.tier.required)}, ${row.tier.mode.toLowerCase()}${row.rerequestOf ? ` · re-request of ${row.rerequestOf}` : ''}`, when, who);
  if (commit) store.commit('writeoffs.request');
  return row;
}

/**
 * requestFromDenial(denial, amount?) → the row or { error }. What the denial
 * router calls when it routes a denial here: a payer-side request at the
 * denied amount still open, with the reason read off the payer's code and the
 * justification naming the denial.
 */
export function requestFromDenial(denial, amount = null, opts = {}) {
  if (!denial?.id) return { error: 'No denial given' };
  const claim = claims.get(denial.claimNo);
  const open = Number.isFinite(Number(denial.amounts?.open)) ? denial.amounts.open : denial.amount;
  const codeLabel = peers.denials?.denialCodeLabel ? peers.denials.denialCodeLabel(denial.code) : (denial.reason || denial.code || 'denied');
  return request({
    source: {
      kind: 'Denial', ref: denial.id, claimNo: denial.claimNo,
      encounterNo: denial.encounterNo || claim?.encounterNo || null,
      mrn: denial.patientMrn || claim?.patientMrn || null,
    },
    side: 'Payer',
    amount: amount ?? open,
    reasonCode: REASON_OF_DENIAL[denial.reasonCode] || 'W06',
    justification: opts.justification || `Routed from denial ${denial.id} on ${denial.claimNo} — ${codeLabel}${denial.payerReason?.text ? `: ${denial.payerReason.text}` : ''}`,
    mode: opts.mode,
  }, opts);
}

/**
 * decide(id, { approved, note }, { at, by, commit }) → the row or { error }.
 * Signs the step that is waiting. A refusal needs a note and ends the ladder;
 * the last approval makes the request Approved — and posts it at once when
 * CONFIG says to.
 */
export function decide(id, { approved, note = '' } = {}, { at = null, by = null, commit = true, role = null } = {}) {
  const row = get(id);
  if (!row) return { error: `No write-off ${id}` };
  const signer = role || currentRole();
  const gate = tiersEngine.canDecide(row, signer);
  if (!gate.ok) return { error: gate.why };
  if (!approved && !String(note).trim()) return { error: 'Say why it is being rejected.' };
  const when = at || new Date().toISOString();
  const who = by || signer.name;
  const step = tiersEngine.currentStep(row.tier);
  const result = tiersEngine.decide(row.tier, { by: who, approved: Boolean(approved), note: String(note).trim(), at: when });
  row.tier = result.tier;
  if (result.rejected) {
    row.status = 'Rejected';
    row.decision = { by: who, at: when, note: String(note).trim(), outcome: 'Rejected' };
    log(row, 'Rejected', `${tiersEngine.tierLabel(step.tier)} — ${note}`, when, who);
  } else if (result.complete) {
    row.status = 'Approved';
    row.decision = { by: who, at: when, note: String(note).trim() || null, outcome: 'Approved' };
    log(row, 'Approved', `${tiersEngine.tierLabel(step.tier)}${note ? ` — ${note}` : ''}${row.tier.steps.length > 1 ? ' · ladder complete' : ''}`, when, who);
  } else {
    log(row, 'Step approved', `${tiersEngine.tierLabel(step.tier)}${note ? ` — ${note}` : ''} · next ${tiersEngine.tierLabel(tiersEngine.currentStep(row.tier).tier)}`, when, who);
  }
  if (commit) store.commit('writeoffs.decide');
  if (row.status === 'Approved' && tiersEngine.autoPostOnApproval()) return post(id, { at: when, by: who, commit });
  return row;
}

/**
 * post(id, { at, by, commit }) → the row or { error }. Re-validates against
 * what is outstanding now: less than requested caps the posting with a note,
 * nothing left refuses. Payer side → claims.adjust, and the denial resolved
 * when one is named; patient side → an Adjustment on the ledger allocated
 * oldest charge first, so the open charges shrink with the balance.
 */
export function post(id, { at = null, by = null, commit = true } = {}) {
  const row = get(id);
  if (!row) return { error: `No write-off ${id}` };
  if (row.status !== 'Approved') return { error: row.status === 'Posted' ? 'Already posted' : 'Only an approved write-off can be posted' };
  const outstanding = outstandingFor(row.source, row.side);
  if (outstanding <= 0) return { error: `Nothing is left to write off — the ${row.side === 'Patient' ? 'balance' : 'claim'} has been settled since the request` };
  const amount = cents(Math.min(row.amountRequested, outstanding));
  const cappedNote = amount < row.amountRequested
    ? `Capped at ${usd(amount)}: ${usd(row.amountRequested)} was requested and ${usd(outstanding)} was outstanding at posting`
    : null;
  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  const txIds = [];
  const label = `${row.reasonCode} ${reasonLabel(row.reasonCode)}`;

  if (row.side === 'Payer') {
    const claim = claims.adjust(row.source.claimNo, { amount, reasonCode: row.reasonCode, writeoffId: row.id, at: when, by: who, commit: false });
    if (!claim) return { error: `Claim ${row.source.claimNo} could not be adjusted` };
    txIds.push(`${claim.claimNo}:${claims.adjustmentsOf(claim).slice(-1)[0].id}`);
    if (row.source.kind === 'Denial' && peers.denials?.resolveWrittenOff) {
      peers.denials.resolveWrittenOff(row.source.ref, row.id, amount);
    }
  } else {
    const mrn = row.source.mrn;
    accounts.ensure(mrn);
    const { allocations } = accountEngine.allocate(amount, accounts.openCharges(mrn));
    const firstCharge = allocations.length ? ledger.get(allocations[0].chargeTxId) : null;
    const tx = ledger.append({
      at: when, by: who, patientMrn: mrn,
      encounterNo: row.source.encounterNo || firstCharge?.encounterNo || null,
      type: 'Adjustment', amount, side: 'patient',
      detail: { origin: { writeoffId: row.id }, purpose: 'Write-off', reasonCode: row.reasonCode, reason: label, classification: row.classification, allocations },
      reason: label,
    }, { silent: true });
    txIds.push(tx.id);
    audit.all().push({
      id: store.nextId('audit', 'AU-'), entity: 'account', entityId: mrn, action: 'Adjustment', user: who, at: when,
      details: `Written off ${usd(amount)} — ${label} · ${row.id}${cappedNote ? ' (capped)' : ''}`,
    });
  }

  row.amountPosted = amount;
  row.posting = { txIds, at: when, by: who, cappedNote };
  row.status = 'Posted';
  log(row, 'Posted', `${usd(amount)} ${row.side === 'Payer' ? `off ${row.source.claimNo}` : `off account ${row.source.mrn}`}${cappedNote ? ` — ${cappedNote}` : ''}`, when, who);
  if (commit) store.commit('writeoffs.post');
  return row;
}

/**
 * reverse(id, { reason }, { at, by, role, commit }) → the row or { error }.
 * Needs a role at the request's tier or higher and a reason. The posting is
 * undone by its own counter — the ledger's Reversal row, the claim's
 * adjustment put back — and both directions stay linked.
 */
export function reverse(id, { reason: why = '' } = {}, { at = null, by = null, role = null, commit = true } = {}) {
  const row = get(id);
  if (!row) return { error: `No write-off ${id}` };
  const signer = role || currentRole();
  const gate = tiersEngine.canReverse(row, signer);
  if (!gate.ok) return { error: gate.why };
  if (!String(why).trim()) return { error: 'Say why it is being reversed.' };
  const when = at || new Date().toISOString();
  const who = by || signer.name;
  const txIds = [];
  if (row.side === 'Payer') {
    const claim = claims.reverseAdjustment(row.source.claimNo, { writeoffId: row.id, reason: why, at: when, by: who, commit: false });
    if (!claim) return { error: 'The claim adjustment could not be found to reverse' };
    txIds.push(`${claim.claimNo}:reversal`);
    if (row.source.kind === 'Denial' && peers.denials?.reopenFromWriteoff) {
      peers.denials.reopenFromWriteoff(row.source.ref, row.id, row.amountPosted);
    }
  } else {
    for (const txId of row.posting?.txIds || []) {
      const undo = ledger.reverse(txId, `Write-off ${row.id} reversed — ${why}`);
      if (undo) txIds.push(undo.id);
    }
  }
  row.status = 'Reversed';
  row.reversal = { by: who, tier: tiersEngine.highestTier(signer), reason: String(why).trim(), txIds, at: when };
  log(row, 'Reversed', `${usd(row.amountPosted)} put back — ${why}`, when, who);
  if (commit) store.commit('writeoffs.reverse');
  return row;
}

// --- analytics ---------------------------------------------------------------------------

/** { from, to } for MTD / QTD / YTD, to today. */
export function periodRange(period = 'MTD') {
  const today = todayIso();
  const year = today.slice(0, 4);
  const month = Number(today.slice(5, 7));
  if (period === 'YTD') return { from: `${year}-01-01`, to: today, label: 'Year to date' };
  if (period === 'QTD') return { from: `${year}-${String(Math.floor((month - 1) / 3) * 3 + 1).padStart(2, '0')}-01`, to: today, label: 'Quarter to date' };
  return { from: `${year}-${String(month).padStart(2, '0')}-01`, to: today, label: 'Month to date' };
}

/** What was posted and stands (not reversed) inside the period. */
export const posted = (period = 'MTD') => {
  const range = typeof period === 'string' ? periodRange(period) : period;
  return all().filter((w) => w.status === 'Posted' && inRange(w.posting?.at, range));
};

/** postedTotals(period) → the figures Denials' analytics and a future DTR reconcile read. */
export function postedTotals(period = 'MTD') {
  const rows = posted(period);
  const payerRows = rows.filter((w) => w.side === 'Payer');
  const denialRows = payerRows.filter((w) => w.source.kind === 'Denial');
  return {
    count: rows.length,
    total: sum(rows, (w) => w.amountPosted),
    payer: sum(payerRows, (w) => w.amountPosted),
    patient: sum(rows.filter((w) => w.side === 'Patient'), (w) => w.amountPosted),
    denialSourced: sum(denialRows, (w) => w.amountPosted),
    contractual: sum(rows.filter((w) => w.classification === 'Contractual'), (w) => w.amountPosted),
    discretionary: sum(rows.filter((w) => w.classification === 'Discretionary'), (w) => w.amountPosted),
  };
}

/** The analytics screen's whole read. */
export function analytics(period = 'MTD') {
  const range = periodRange(period);
  const rows = posted(range);
  const requested = all().filter((w) => inRange(w.at, range));
  const totals = postedTotals(range);
  const group = (keyOf, labelOf = (k) => k) => {
    const map = new Map();
    for (const w of rows) {
      const key = keyOf(w) || '—';
      const cur = map.get(key) || { key, label: labelOf(key, w), count: 0, value: 0, contractual: 0, discretionary: 0 };
      cur.count += 1;
      cur.value = cents(cur.value + w.amountPosted);
      if (w.classification === 'Contractual') cur.contractual = cents(cur.contractual + w.amountPosted);
      else cur.discretionary = cents(cur.discretionary + w.amountPosted);
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => b.value - a.value);
  };
  const decided = requested.filter((w) => w.decision?.at);
  const approvedRows = requested.filter((w) => ['Approved', 'Posted', 'Reversed'].includes(w.status));
  const rejectedRows = requested.filter((w) => w.status === 'Rejected');
  return {
    period, range, totals,
    split: CLASSIFICATIONS.map((c) => ({
      classification: c,
      count: rows.filter((w) => w.classification === c).length,
      value: c === 'Contractual' ? totals.contractual : totals.discretionary,
      share: totals.total ? (c === 'Contractual' ? totals.contractual : totals.discretionary) / totals.total : 0,
    })),
    byReason: group((w) => w.reasonCode, (k) => `${k} ${reasonLabel(k)}`),
    byPayer: group((w) => (w.side === 'Payer' ? payerOf(w) : 'patient'), (k) => (k === 'patient' ? 'Patient balances' : payers.get(k)?.nameEn || k)),
    byDepartment: group((w) => departmentOf(w), (k) => k),
    byServiceLine: group((w) => serviceLineOf(w), (k) => k),
    byRequester: group((w) => w.requestedBy),
    trend: trend(6),
    approvals: {
      requested: requested.length,
      requestedValue: sum(requested, (w) => w.amountRequested),
      approved: approvedRows.length,
      rejected: rejectedRows.length,
      rejectedValue: sum(rejectedRows, (w) => w.amountRequested),
      pending: requested.filter((w) => w.status === 'Pending Approval').length,
      rate: approvedRows.length + rejectedRows.length ? approvedRows.length / (approvedRows.length + rejectedRows.length) : 0,
      avgDecisionDays: decided.length ? decided.reduce((n, w) => n + daysBetween(iso(w.at), iso(w.decision.at)), 0) / decided.length : 0,
      capped: rows.filter((w) => w.posting?.cappedNote).length,
    },
    repeats: repeats(),
    reconciliation: reconciliation(range),
  };
}

/** Month by month, newest last: what was posted, split by classification. */
export function trend(months = 6) {
  const today = new Date();
  const out = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const rows = all().filter((w) => w.status === 'Posted' && String(w.posting?.at || '').slice(0, 7) === key);
    out.push({
      key,
      label: d.toLocaleDateString('en-GB', { month: 'short' }),
      count: rows.length,
      contractual: sum(rows.filter((w) => w.classification === 'Contractual'), (w) => w.amountPosted),
      discretionary: sum(rows.filter((w) => w.classification === 'Discretionary'), (w) => w.amountPosted),
      total: sum(rows, (w) => w.amountPosted),
    });
  }
  return out;
}

/** Accounts and payer-reason pairs that keep coming back — two or more write-offs, whatever their state. */
export function repeats() {
  const byMrn = new Map();
  const byPair = new Map();
  for (const w of all()) {
    if (w.status === 'Rejected') continue;
    if (w.source?.mrn) {
      const cur = byMrn.get(w.source.mrn) || { key: w.source.mrn, label: patients.get(w.source.mrn)?.nameEn || w.source.mrn, count: 0, value: 0 };
      cur.count += 1;
      cur.value = cents(cur.value + (w.amountPosted ?? w.amountRequested));
      byMrn.set(w.source.mrn, cur);
    }
    const payerId = payerOf(w);
    if (payerId) {
      const key = `${payerId}·${w.reasonCode}`;
      const cur = byPair.get(key) || { key, label: `${payers.get(payerId)?.nameEn || payerId} · ${w.reasonCode} ${reasonLabel(w.reasonCode)}`, count: 0, value: 0 };
      cur.count += 1;
      cur.value = cents(cur.value + (w.amountPosted ?? w.amountRequested));
      byPair.set(key, cur);
    }
  }
  const twoPlus = (map) => [...map.values()].filter((r) => r.count >= 2).sort((a, b) => b.count - a.count || b.value - a.value);
  return { accounts: twoPlus(byMrn), payerReasons: twoPlus(byPair) };
}

/**
 * Posted payer-side write-offs sourced from denials against what the denials
 * register says was written off — the F7 reconciliation. When the denials
 * feature publishes `analytics(period)` its figure is read from there; else
 * the register's own `amounts.writtenOff` is summed.
 */
export function reconciliation(range = periodRange('YTD')) {
  const fromDenials = posted(range).filter((w) => w.side === 'Payer' && w.source.kind === 'Denial');
  let theirs = null;
  let source = peers.denials ? 'the denials feature does not resolve write-offs yet' : 'denials not loaded';
  let unresolvable = 0;
  let mine = sum(fromDenials, (w) => w.amountPosted);
  if (peers.denials?.resolveWrittenOff) {
    // A write-off naming a denial the register does not hold (a seeded
    // stand-in on a Denied claim) has nothing to reconcile against and is
    // counted beside the check rather than inside it.
    const held = fromDenials.filter((w) => peers.denials.get(w.source.ref));
    unresolvable = fromDenials.length - held.length;
    mine = sum(held, (w) => w.amountPosted);
    const ids = new Set(held.map((w) => w.source.ref));
    theirs = sum(peers.denials.all().filter((d) => ids.has(d.id)), (d) => d.amounts?.writtenOff ?? 0);
    source = 'denials.amounts.writtenOff over the denials these write-offs answer';
  }
  return { mine, theirs, source, unresolvable, pass: theirs === null ? null : Math.abs(mine - theirs) < 0.005 };
}

export function selfCheck() {
  const r = reconciliation(periodRange('YTD'));
  const line = r.pass === null ? `[writeoffs] self-check skipped — ${r.source}`
    : `[writeoffs] self-check ${r.pass ? 'pass' : 'FAIL'} — posted from denials ${usd(r.mine)} vs denials written off ${usd(r.theirs)}${
      r.unresolvable ? ` (${r.unresolvable} naming no denial record, outside the check)` : ''}`;
  if (r.pass === false) console.warn(line); else console.info(line);
  return r;
}

/** The analytics as CSV — one section per breakdown. */
export function exportCsv(period = 'MTD') {
  const a = analytics(period);
  const lines = [];
  const push = (cells) => lines.push(cells.map(quote).join(','));
  push(['Write-offs', a.range.label, `${a.range.from} to ${a.range.to}`]);
  push([]);
  push(['Classification', 'Count', 'Value (USD)', 'Share (%)']);
  for (const s of a.split) push([s.classification, s.count, s.value.toFixed(2), (s.share * 100).toFixed(1)]);
  for (const [title, rows] of [['Reason', a.byReason], ['Payer', a.byPayer], ['Department', a.byDepartment], ['Service line', a.byServiceLine], ['Requester', a.byRequester]]) {
    push([]);
    push([title, 'Count', 'Value (USD)', 'Contractual (USD)', 'Discretionary (USD)']);
    for (const r of rows) push([r.label, r.count, r.value.toFixed(2), r.contractual.toFixed(2), r.discretionary.toFixed(2)]);
  }
  push([]);
  push(['Month', 'Count', 'Contractual (USD)', 'Discretionary (USD)', 'Total (USD)']);
  for (const m of a.trend) push([m.key, m.count, m.contractual.toFixed(2), m.discretionary.toFixed(2), m.total.toFixed(2)]);
  push([]);
  push(['Approvals', 'Requested', 'Approved', 'Rejected', 'Rejected value (USD)', 'Approval rate (%)', 'Avg decision days']);
  push(['', a.approvals.requested, a.approvals.approved, a.approvals.rejected, a.approvals.rejectedValue.toFixed(2), (a.approvals.rate * 100).toFixed(1), a.approvals.avgDecisionDays.toFixed(1)]);
  return lines.join('\r\n');
}

// --- seed and merge -------------------------------------------------------------------------

// Resolving a seeded denial commits, and a commit redraws every screen that
// reads this table — while it is still empty. The guard is what keeps that
// redraw from building the seed a second time inside the first.
let seeding = false;

function ensureSeeded() {
  const rows = store.table(TABLE);
  if (rows.length || !settled || seeding) return;
  seeding = true;
  try {
    rows.push(...buildWriteoffs({ denials: peers.denials }));
  } finally {
    seeding = false;
  }
  selfCheck();
}

// A reset empties the table with everything else; the next tick rebuilds it
// once the other registers have, so a seeded request still names a denial.
store.subscribe((why) => { if (why === 'reset') setTimeout(ensureSeeded, 0); });

patients.relinkHooks.push({
  label: 'Write-offs',
  count: (mrn) => byAccount(mrn).length,
  relink: (fromMrn, toMrn) => {
    const moving = byAccount(fromMrn);
    for (const row of moving) {
      row.source.mrn = toMrn;
      if (row.source.kind === 'PatientBalance') row.source.ref = toMrn;
      log(row, 'Re-linked', `Moved from ${fromMrn} to ${toMrn} on merge`);
    }
    return moving.length;
  },
});

// --- internals ---------------------------------------------------------------------------------

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;
const sum = (rows, f) => cents(rows.reduce((n, r) => n + (Number(f(r)) || 0), 0));
const daysBetween = (a, b) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 86400000));
const inRange = (at, range) => Boolean(at) && compareDates(iso(at), range.from) >= 0 && compareDates(iso(at), range.to) <= 0;
const quote = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

function departmentOf(w) {
  const claim = w.source?.claimNo ? claims.get(w.source.claimNo) : null;
  const enc = encounters.get(w.source?.encounterNo || claim?.encounterNo);
  return claim?.department || enc?.department || 'No visit on file';
}

function serviceLineOf(w) {
  const claim = w.source?.claimNo ? claims.get(w.source.claimNo) : null;
  if (claim?.serviceGroup) return claim.serviceGroup;
  return w.side === 'Patient' ? 'Patient balance' : '—';
}

function log(row, action, details, at = null, by = null) {
  audit.all().push({
    id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: row.id, action, details,
    user: by || currentRole().name, at: at || new Date().toISOString(),
  });
}
