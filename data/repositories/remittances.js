// Repository — remittances. Owner: modules/claima (amendment 29).
//
// A remittance is a payer's answer to a set of claims and the cash that came
// with it: captured from an ERA file or typed in, matched to the claims it
// names, and posted — which is where everything downstream happens at once.
// data/engines/posting-engine.js decides what a posting does; this file
// executes it: the claim moves through claims.applyRemittance, a refused line
// becomes a denial, a PR-* adjustment becomes a PortionShift on the patient's
// account, an underpayment past the payer's tolerance becomes a Defensio
// hand-off, an overpayment an exception to resolve, the residue unapplied
// cash, and a partial payment on a primary activates its secondary. A posting
// is append-only: a mistake is reversed as a pair and posted again.
//
// The dataset seeds itself on first read (data/seed/remittances.js) by driving
// this file's own writes with the dates the events happened on, so a seeded
// posting is one the engine actually ran. denials and unapplied are filled by
// those postings, which is why both repositories ask this one to seed first.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as claims from './claims.js';
import * as payers from './payers.js';
import * as ledger from './ledger.js';
import * as accounts from './accounts.js';
import * as handoffs from './handoffs.js';
import * as denials from './denials.js';
import * as unapplied from './unapplied.js';
import * as engine from '../engines/posting-engine.js';
import { buildRemittances } from '../seed/remittances.js';
import { current as currentRole } from '../../shared/roles.js';
import { compareDates, iso, todayIso, usd } from '../../shared/format.js';

const TABLE = 'remittances';
const ENTITY = 'remittances';

export const STATUSES = ['Unposted', 'Posted with Exceptions', 'Posted', 'Closed'];
export const { METHODS, MATCH, OUTCOMES, EXCEPTION_KINDS } = engine;
export const { control, toleranceOf, toleranceLabel, adjCodes, adjLabel, outcomeTone, evaluateLine } = engine;

/** Fired after every posting and every reversal: { remittanceNo, claimNos, at, reversed? }. */
export const afterPostHooks = [];

let seeding = false;
export function all() {
  const rows = store.table(TABLE);
  if (!rows.length && !seeding) {
    seeding = true;
    try { buildRemittances(seedApi); } finally { seeding = false; }
  }
  return rows;
}
// A reset empties every table; the next read seeds again.
store.subscribe((reason) => { if (reason === 'reset') seeding = false; });
denials.seedHooks.push(() => all());
unapplied.seedHooks.push(() => all());

export const get = (no) => all().find((r) => r.remittanceNo === no) || null;

export function statusTone(status) {
  if (status === 'Posted' || status === 'Closed') return 'success';
  if (status === 'Posted with Exceptions') return 'warning';
  return 'info';
}

export const matchTone = (m) => (m === 'Matched' ? 'success' : m === 'Ambiguous' ? 'warning' : 'critical');

export const openExceptions = (rem) => (rem?.exceptions || []).filter((e) => !e.resolution);
export const livePostings = (rem) => (rem?.postings || []).filter((p) => !p.reversal && !p.reversedBy);
export const unpostedRows = (rem) => (rem?.claims || []).filter((r) => !r.posted);

/** Sequential per year, read off the table: RMT-2026-000077 after the six seeded. */
export function nextNo(year = new Date().getFullYear()) {
  const prefix = `RMT-${year}-`;
  const max = store.table(TABLE).reduce((n, r) => {
    if (!String(r.remittanceNo).startsWith(prefix)) return n;
    const digits = Number(String(r.remittanceNo).slice(prefix.length));
    return Number.isFinite(digits) && digits > n ? digits : n;
  }, 70);
  return `${prefix}${String(max + 1).padStart(6, '0')}`;
}

// --- reading ---------------------------------------------------------------------

/**
 * search(q, { payerId, status, from, to, unapplied }) — Unposted first, then
 * oldest payment date. The text matches the remittance number, the payment
 * reference and any claim number or payer reference on it.
 */
export function search(q = '', { payerId = '', status = '', from = '', to = '', unapplied: hasUnapplied = '' } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  return all()
    .filter((r) => {
      if (payerId && r.payerId !== payerId) return false;
      if (status && r.status !== status) return false;
      if (from && compareDates(r.payment.date, from) < 0) return false;
      if (to && compareDates(r.payment.date, to) > 0) return false;
      if (hasUnapplied === '1' && !(r.unapplied > 0)) return false;
      if (!needle) return true;
      const hay = [r.remittanceNo, r.payment.reference, payers.get(r.payerId)?.nameEn,
        ...r.claims.flatMap((c) => [c.claimNo, c.payerClaimRef])];
      return hay.some((v) => String(v || '').toLowerCase().includes(needle));
    })
    .sort((a, b) => {
      const ua = a.status === 'Unposted' ? 0 : 1;
      const ub = b.status === 'Unposted' ? 0 : 1;
      return ua - ub || compareDates(a.payment.date, b.payment.date) || a.remittanceNo.localeCompare(b.remittanceNo);
    });
}

/** The rail: what waits, what it is worth, what is open, what is unapplied. */
export function counts() {
  const rows = all();
  const waiting = rows.filter((r) => r.status === 'Unposted');
  return {
    total: rows.length,
    unposted: waiting.length,
    unpostedValue: cents(waiting.reduce((n, r) => n + r.payment.total, 0)),
    exceptionsOpen: rows.reduce((n, r) => n + openExceptions(r).length, 0),
    withExceptions: rows.filter((r) => openExceptions(r).length).length,
    unappliedCash: unapplied.counts().heldAmount,
    unappliedRows: unapplied.counts().held,
  };
}

/** The payer's claims a remittance can be about: with the payer, not yet answered. */
export const inFlightClaims = (payerId) =>
  claims.all().filter((c) => c.payerId === payerId && claims.isPending(c));

/**
 * byClaim(claimNo) → [{ remittanceNo, at, paid, adjusted, denied, lines }],
 * oldest first — what a claim page and a timeline read of the payer's answer.
 */
export function byClaim(claimNo) {
  const out = [];
  for (const rem of all()) {
    for (const row of rem.claims) {
      if (row.claimNo !== claimNo || !row.posted) continue;
      const posting = rem.postings.find((p) => p.id === row.postingId);
      const sum = (key) => cents(row.lines.reduce((n, l) => n + (Number(l[key]) || 0), 0));
      out.push({
        remittanceNo: rem.remittanceNo, at: posting?.at || rem.postedAt, payerId: rem.payerId,
        paid: sum('paid'), adjusted: sum('adjustment'), denied: sum('denied'), patientShift: sum('patientShift'),
        lines: row.lines.map((l) => ({
          lineId: l.claimLineId, lineRef: l.lineRef, outcome: l.outcome, paid: l.paid, adjustment: l.adjustment,
          adjCode: l.adjCode, denied: l.denied, denialCode: l.denialCode, variance: l.variance, patientShift: l.patientShift,
        })),
      });
    }
  }
  return out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

export const history = (no) => audit.forEntity(ENTITY, no);

/** What posting would do now — the screen shows it before Post is pressed. */
export const planFor = (rem) => engine.plan(rem, {
  claimOf: (no) => claims.get(no),
  nextPolicyOf: (claim) => claims.secondaryPolicyOf(claim),
  handoffExists: (claim) => Boolean(handoffs.forClaim(claim.id)),
  unappliedHeld: heldByLivePostings(rem),
});

/** What this remittance's standing postings already hold as unapplied cash. */
function heldByLivePostings(rem) {
  const live = new Set(livePostings(rem).map((p) => p.id));
  return cents(unapplied.byRemittance(rem.remittanceNo)
    .filter((r) => live.has(r.postingId) && r.status !== 'Adjusted')
    .reduce((n, r) => n + r.amount, 0));
}

// --- capture ----------------------------------------------------------------------

/** A remittance claim row built from one of our claims: every line, nothing paid yet. */
export function rowFromClaim(claim, { payerClaimRef = null } = {}) {
  return {
    claimNo: claim.claimNo,
    payerClaimRef: payerClaimRef || claim.claimNo,
    memberId: null,
    dateOfService: claim.dateOfService,
    billed: claim.totals.gross,
    matchStatus: 'Matched',
    candidates: [claim.claimNo],
    posted: false,
    postingId: null,
    lines: claim.lines.map((l) => lineFrom({ lineRef: l.id, chargeCode: l.chargeCode || l.itemId, billed: l.grossBilled }, l)),
  };
}

const lineFrom = (line, claimLine) => ({
  lineRef: line.lineRef || null,
  chargeCode: line.chargeCode || null,
  claimLineId: claimLine?.id || null,
  matchStatus: claimLine ? 'Matched' : 'Unmatched',
  billed: cents(line.billed ?? claimLine?.grossBilled),
  expected: cents(claimLine?.payerShare),
  paid: cents(line.paid),
  adjustment: cents(line.adjustment),
  adjCode: line.adjCode || null,
  denied: cents(line.denied),
  denialCode: line.denialCode || null,
  outcome: null,
  variance: null,
  patientShift: 0,
});

/** A file's claim row, matched against the payer's in-flight claims. */
function matchRow(row, payerId) {
  const pool = inFlightClaims(payerId);
  const m = engine.matchClaim(row, pool);
  const claim = m.claimNo ? claims.get(m.claimNo) : null;
  const lines = engine.matchLines(row.lines || [], claim).map((l) => lineFrom(l, claim?.lines.find((c) => c.id === l.claimLineId)));
  return { ...row, ...m, posted: false, postingId: null, lines };
}

function blank(no, payerId, payment, capture) {
  return {
    remittanceNo: no,
    payerId,
    payment: { reference: payment.reference || '', date: iso(payment.date) || todayIso(), method: payment.method || 'EFT', total: cents(payment.total) },
    capture,
    claims: [],
    status: 'Unposted',
    exceptions: [],
    unapplied: 0,
    postedAt: null,
    closedAt: null,
    postings: [],
    createdAt: capture.at,
    updatedAt: capture.at,
  };
}

/**
 * createFromFile({ fileName, text, parsed, at, by }) → the Unposted remittance
 * with every claim row matched. The file is kept as it arrived and never
 * edited; what could not be read is in the parse report, entered by hand.
 */
export function createFromFile({ fileName, text, parsed = null, at = null, by = null } = {}) {
  const report = parsed || engine.parseEra(text);
  if (!report.header) return { error: 'The file has no payment header', remittance: null };
  const payerId = report.header.payerId;
  if (!payers.get(payerId)) return { error: `The file names payer ${payerId}, which is not on the Payer Master`, remittance: null };
  const when = at || new Date().toISOString();
  const rem = blank(nextNo(new Date(when).getFullYear()), payerId, {
    reference: report.header.paymentRef, date: report.header.paymentDate, method: report.header.method, total: report.header.total,
  }, { mode: 'File', fileName, storedFile: text, parseReport: { read: report.read, failed: report.failed }, by: by || currentRole().name, at: when });
  rem.claims = report.claims.map((row) => matchRow(row, payerId));
  all().push(rem);
  const matched = rem.claims.filter((r) => r.matchStatus === 'Matched').length;
  log(rem, 'Captured', `From ${fileName} — ${report.read} record${report.read === 1 ? '' : 's'} read, ${report.failed.length} failed · ${
    rem.claims.length} claim${rem.claims.length === 1 ? '' : 's'}, ${matched} matched · ${usd(rem.payment.total)} by ${rem.payment.method}`, when, by);
  store.commit('remittances.create');
  return { error: '', remittance: rem };
}

/** createManual({ payerId, payment, at, by }) → the Unposted remittance, no claims yet. */
export function createManual({ payerId, payment = {}, at = null, by = null } = {}) {
  if (!payers.get(payerId)) return { error: 'Choose a payer', remittance: null };
  if (!String(payment.reference || '').trim()) return { error: 'Enter the payment reference', remittance: null };
  if (!iso(payment.date)) return { error: 'Enter the payment date', remittance: null };
  if (!METHODS.includes(payment.method)) return { error: 'Choose the payment method', remittance: null };
  if (!(cents(payment.total) > 0)) return { error: 'Enter the payment total', remittance: null };
  const when = at || new Date().toISOString();
  const rem = blank(nextNo(new Date(when).getFullYear()), payerId,
    { ...payment, reference: String(payment.reference).trim() },
    { mode: 'Manual', fileName: null, storedFile: null, parseReport: null, by: by || currentRole().name, at: when });
  all().push(rem);
  log(rem, 'Captured', `Entered by hand — ${usd(rem.payment.total)} by ${rem.payment.method}, ref ${rem.payment.reference}`, when, by);
  store.commit('remittances.create');
  return { error: '', remittance: rem };
}

/** The header of an Unposted remittance may still be corrected. */
export function updateHeader(no, patch = {}) {
  const rem = get(no);
  if (!rem || rem.status !== 'Unposted') return null;
  Object.assign(rem.payment, {
    reference: patch.reference ?? rem.payment.reference,
    date: iso(patch.date) || rem.payment.date,
    method: METHODS.includes(patch.method) ? patch.method : rem.payment.method,
    total: patch.total != null ? cents(patch.total) : rem.payment.total,
  });
  touch(rem);
  log(rem, 'Updated', `Payment ${usd(rem.payment.total)} · ${rem.payment.method} · ${rem.payment.reference} · ${rem.payment.date}`);
  store.commit('remittances.update');
  return rem;
}

/**
 * addClaim(no, claimNo) → { error, row }. The claim has to exist, be this
 * payer's, still be with it, and not already be on the remittance.
 */
export function addClaim(no, claimNo, { payerClaimRef = null } = {}) {
  const rem = get(no);
  if (!rem || rem.status === 'Closed') return { error: 'This remittance is closed', row: null };
  const claim = claims.get(String(claimNo || '').trim());
  if (!claim) return { error: `No claim ${claimNo}`, row: null };
  if (claim.payerId !== rem.payerId) return { error: `${claim.claimNo} is with ${payers.get(claim.payerId)?.nameEn || claim.payerId}, not this payer`, row: null };
  if (!claims.isPending(claim)) return { error: `${claim.claimNo} is ${claim.status.toLowerCase()} — only a submitted or acknowledged claim can be remitted`, row: null };
  if (rem.claims.some((r) => r.claimNo === claim.claimNo)) return { error: `${claim.claimNo} is already on this remittance`, row: null };
  const row = rowFromClaim(claim, { payerClaimRef });
  rem.claims.push(row);
  touch(rem);
  log(rem, 'Claim added', `${claim.claimNo} — ${claim.lines.length} line${claim.lines.length === 1 ? '' : 's'}, ${usd(claim.totals.payerShare)} expected`);
  store.commit('remittances.update');
  return { error: '', row };
}

export function removeClaim(no, ref) {
  const rem = get(no);
  const row = rem?.claims.find((r) => keyOf(r) === ref);
  if (!rem || !row || row.posted) return null;
  rem.claims = rem.claims.filter((r) => r !== row);
  rem.exceptions = rem.exceptions.filter((e) => !(e.ref === row.payerClaimRef && !e.resolution && (e.kind === 'AmbiguousMatch' || e.kind === 'Unmatched')));
  touch(rem);
  log(rem, 'Claim removed', `${row.claimNo || row.payerClaimRef} taken off — its cash is residue`);
  store.commit('remittances.update');
  return rem;
}

/** The payer's answer on each line of one row, typed in or corrected. */
export function updateLines(no, ref, lines = []) {
  const rem = get(no);
  const row = rem?.claims.find((r) => keyOf(r) === ref);
  if (!rem || !row || row.posted) return null;
  for (const patch of lines) {
    const line = row.lines.find((l) => (l.claimLineId || l.lineRef) === (patch.claimLineId || patch.lineRef));
    if (!line) continue;
    line.paid = cents(patch.paid);
    line.adjustment = cents(patch.adjustment);
    line.adjCode = line.adjustment > 0 ? patch.adjCode || null : null;
    line.denied = cents(patch.denied);
    line.denialCode = line.denied > 0 ? patch.denialCode || null : null;
  }
  touch(rem);
  store.commit('remittances.lines');
  return row;
}

/** An ambiguous or unmatched row, matched by the desk to one claim. */
export function resolveMatch(no, ref, claimNo) {
  const rem = get(no);
  const row = rem?.claims.find((r) => keyOf(r) === ref);
  const claim = claims.get(claimNo);
  if (!rem || !row || row.posted || !claim) return { error: 'Nothing to match', row: null };
  if (claim.payerId !== rem.payerId) return { error: 'That claim is with another payer', row: null };
  if (rem.claims.some((r) => r !== row && r.claimNo === claim.claimNo)) return { error: `${claim.claimNo} is already on this remittance`, row: null };
  const was = row.matchStatus;
  row.claimNo = claim.claimNo;
  row.matchStatus = 'Matched';
  row.candidates = [claim.claimNo];
  row.lines = engine.matchLines(row.lines, claim).map((l) => lineFrom(l, claim.lines.find((c) => c.id === l.claimLineId)));
  for (const e of rem.exceptions) {
    if (!e.resolution && e.ref === row.payerClaimRef && (e.kind === 'AmbiguousMatch' || e.kind === 'Unmatched')) {
      e.resolution = { kind: 'Matched', ref: claim.claimNo, reason: '', by: currentRole().name, at: new Date().toISOString() };
    }
  }
  touch(rem);
  log(rem, 'Matched', `${row.payerClaimRef} → ${claim.claimNo}${was === 'Ambiguous' ? ' (was ambiguous)' : ''}`);
  store.commit('remittances.match');
  return { error: '', row };
}

// --- posting --------------------------------------------------------------------------

/**
 * post(no, { at, by }) → { error, result }. Every matched row whose lines all
 * match is posted; the rest become exceptions and wait. Blocked outright when
 * the rows claim more cash than the payment carries.
 */
export function post(no, { at = null, by = null } = {}) {
  const rem = get(no);
  if (!rem) return { error: `No remittance ${no}`, result: null };
  if (rem.status === 'Closed') return { error: 'A closed remittance is not posted again', result: null };
  const p = planFor(rem);
  if (p.blocked) return { error: p.blocked, result: null };
  if (!p.entries.length && !p.exceptions.length) return { error: 'Nothing to post — add the claims the payer answered', result: null };

  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  const posting = {
    id: `PST-${String(rem.postings.length + 1).padStart(3, '0')}`, at: when, by: who, reversal: false, reversedBy: null,
    txIds: [], claimNos: [], claims: [], denialIds: [], handoffIds: [], unappliedIds: [], secondaryClaimNos: [], summary: '',
  };
  const tally = { claimNos: [], denials: 0, shifts: 0, shiftAmount: 0, handoffs: 0, secondaries: 0, unapplied: 0, exceptions: 0 };

  for (const entry of p.entries) {
    const claim = entry.claim;
    posting.claims.push({ claimNo: claim.claimNo, previousStatus: claim.status });
    posting.claimNos.push(claim.claimNo);
    tally.claimNos.push(claim.claimNo);
    const firstDenial = entry.denials.find((d) => d.code);
    claims.applyRemittance(claim.id, {
      remittanceNo: rem.remittanceNo,
      lines: entry.lines.map((l) => ({
        lineId: l.claimLineId, paid: l.paid, adjustment: l.adjustment, adjCode: l.adjCode, denied: l.denied,
        denialCode: l.denialCode, patientShift: l.patientShift, outcome: l.outcome, variance: l.variance,
        denialReasonCode: l.denialCode ? denials.reasonOf(l.denialCode) : null,
      })),
      status: entry.status, paid: entry.paid, adjusted: entry.adjusted,
      paidAt: entry.paid > 0 ? rem.payment.date : null,
      denialReasonCode: firstDenial ? denials.reasonOf(firstDenial.code) : null,
      details: `${usd(entry.paid)} paid, ${usd(entry.adjusted)} adjusted, ${usd(entry.denied)} denied of ${usd(entry.expected)} expected`,
      at: when, by: who,
    });
    for (const d of entry.denials) {
      const row = denials.create({ claimNo: claim.claimNo, claimId: claim.id, lineId: d.lineId, remittanceNo: rem.remittanceNo,
        payerId: rem.payerId, code: d.code, amount: d.amount, at: when, by: who });
      posting.denialIds.push(row.id);
      tally.denials += 1;
    }
    for (const s of entry.shifts) {
      const tx = shift(rem, claim, s, when, who);
      posting.txIds.push(tx.id);
      tally.shifts += 1;
      tally.shiftAmount = cents(tally.shiftAmount + s.amount);
      log(rem, 'Patient shift', `${claim.claimNo} · ${s.lineId} · ${usd(s.amount)} moved to the patient (${s.code}) — ${tx.id}`, when, who);
    }
    if (entry.handoff) {
      const h = handoffs.create({
        claimId: claim.id, contractId: claim.contractId, payerId: claim.payerId, amount: entry.handoff.amount,
        reason: 'Paid below contracted rate',
        note: `${rem.remittanceNo} · ${entry.handoff.lineIds.join(', ')} · beyond tolerance ${toleranceLabel(entry.handoff.tolerance)}`,
      });
      if (at) { h.createdAt = when; h.createdBy = who; }
      posting.handoffIds.push(h.id);
      tally.handoffs += 1;
      log(rem, 'Handed off', `${claim.claimNo} · ${usd(entry.handoff.amount)} under expected on ${entry.handoff.lineIds.join(', ')} — ${h.id} to Defensio`, when, who);
    }
    if (entry.secondary) {
      const sec = claims.activateSecondary(claim.id, {
        remittanceNo: rem.remittanceNo, policy: entry.secondary.policy, lines: entry.secondary.lines,
        primaryPayment: { paid: entry.paid, adjusted: entry.adjusted, denied: entry.denied, reference: rem.payment.reference, date: rem.payment.date },
        at: when, by: who,
      });
      if (sec) {
        posting.secondaryClaimNos.push(sec.claimNo);
        tally.secondaries += 1;
        log(rem, 'Secondary activated', `${sec.claimNo} takes the ${usd(entry.secondary.amount)} ${payers.get(sec.payerId)?.nameEn || sec.payerId} is now billed for behind ${claim.claimNo}`, when, who);
      }
    }
    for (const l of entry.lines) {
      const target = entry.row.lines.find((x) => x.claimLineId === l.claimLineId);
      if (target) Object.assign(target, { outcome: l.outcome, variance: l.variance, patientShift: l.patientShift, expected: l.expected });
    }
    entry.row.posted = true;
    entry.row.postingId = posting.id;
  }

  // Exceptions this posting raised, beside the ones still open from before.
  for (const e of p.exceptions) {
    const dup = rem.exceptions.find((x) => !x.resolution && x.kind === e.kind && x.ref === e.ref);
    if (dup) { dup.amount = e.amount; continue; }
    const row = { ...e, id: `EX-${rem.exceptions.length + 1}`, postingId: posting.id, at: when };
    if (e.kind === 'Residue') {
      const uc = unapplied.create({ payerId: rem.payerId, remittanceNo: rem.remittanceNo, postingId: posting.id, amount: e.amount, at: when, by: who });
      row.resolution = { kind: 'Held as unapplied cash', ref: uc.id, reason: '', by: who, at: when };
      posting.unappliedIds.push(uc.id);
      tally.unapplied = cents(tally.unapplied + e.amount);
    }
    rem.exceptions.push(row);
  }
  rem.unapplied = p.unapplied;
  tally.exceptions = openExceptions(rem).length;

  posting.summary = engine.summarize(tally);
  rem.postings.push(posting);
  if (p.entries.length) rem.postedAt = rem.postedAt || when;
  rem.status = !livePostings(rem).length ? 'Unposted' : tally.exceptions || unpostedRows(rem).length ? 'Posted with Exceptions' : 'Posted';
  rem.updatedAt = when;
  log(rem, 'Posted', `${posting.id} — ${posting.summary}`, when, who);
  store.commit('remittances.post');
  fire({ remittanceNo: rem.remittanceNo, claimNos: posting.claimNos, at: when });
  return { error: '', result: { posting, ...tally, summary: posting.summary } };
}

/** The PortionShift row on the patient's account, and the settlement recompute behind it. */
function shift(rem, claim, s, at, by) {
  const line = claim.lines.find((l) => l.id === s.lineId);
  accounts.ensure(claim.patientMrn);
  const tx = ledger.append({
    at, by, patientMrn: claim.patientMrn, encounterNo: claim.encounterNo || null, type: 'PortionShift', amount: s.amount, side: 'patient',
    detail: {
      payerShare: -s.amount, patientShare: s.amount, adjCode: s.code, description: line?.description || line?.chargeCode || line?.itemId || s.lineId,
      origin: { remittanceNo: rem.remittanceNo, claimNo: claim.claimNo, lineId: s.lineId },
    },
  });
  if (claim.encounterNo) reconcile(claim.encounterNo);
  return tx;
}

// The settlement engine is amendment 22's (Frontis, not applied yet): when it
// exists, a shift on a settled visit is what turns it Unsettled again.
let settlement = null;
function reconcile(encounterNo) {
  const run = (mod) => { try { mod?.reconcile?.(encounterNo); } catch (err) { console.warn('[remittances] settlement reconcile', err); } };
  if (settlement) return run(settlement);
  import('../engines/settlement-engine.js').then((mod) => { settlement = mod; run(mod); }).catch(() => { settlement = {}; });
  return undefined;
}

/**
 * reversePosting(no, postingId, reason) → { error, reversal }. Every row the
 * posting wrote is answered: ledger reversals, the claims back where they
 * were, denials marked, unapplied cash adjusted, secondaries emptied. The
 * remittance's rows reopen for correction and Post runs again as a new pair.
 */
export function reversePosting(no, postingId, reason = '', { at = null, by = null } = {}) {
  const rem = get(no);
  const posting = rem?.postings.find((p) => p.id === postingId);
  if (!rem || !posting) return { error: 'No such posting', reversal: null };
  if (posting.reversal) return { error: 'A reversal is not reversed', reversal: null };
  if (posting.reversedBy) return { error: `Already reversed by ${posting.reversedBy}`, reversal: null };
  if (rem.status === 'Closed') return { error: 'Reopen is not offered — a closed remittance stands', reversal: null };
  if (!String(reason || '').trim()) return { error: 'Say why it is being reversed', reversal: null };

  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  const why = String(reason).trim();
  const reversal = {
    id: `PST-${String(rem.postings.length + 1).padStart(3, '0')}`, at: when, by: who, reversal: true, reverses: posting.id, reason: why,
    txIds: [], claimNos: [...posting.claimNos], claims: [], denialIds: [...posting.denialIds], handoffIds: [...posting.handoffIds],
    unappliedIds: [...posting.unappliedIds], secondaryClaimNos: [...posting.secondaryClaimNos], summary: '',
  };
  for (const txId of posting.txIds) {
    const undo = ledger.reverse(txId, `Posting ${posting.id} reversed — ${why}`);
    if (undo) reversal.txIds.push(undo.id);
  }
  for (const c of posting.claims) {
    const claim = claims.get(c.claimNo);
    if (claim) claims.revertRemittance(claim.id, { remittanceNo: rem.remittanceNo, status: c.previousStatus, reason: why, at: when, by: who });
  }
  for (const id of posting.denialIds) denials.reverse(id, why, { at: when, by: who });
  for (const id of posting.unappliedIds) {
    const uc = unapplied.get(id);
    if (uc?.status === 'Held') unapplied.adjust(id, { reason: `Posting ${posting.id} reversed — ${why}`, at: when, by: who });
  }
  for (const secNo of posting.secondaryClaimNos) {
    const sec = claims.get(secNo);
    if (sec) claims.deactivateSecondary(sec.id, `${rem.remittanceNo} posting ${posting.id} reversed — ${why}`, { at: when, by: who });
  }
  for (const row of rem.claims) {
    if (row.postingId !== posting.id) continue;
    row.posted = false;
    row.postingId = null;
    for (const l of row.lines) Object.assign(l, { outcome: null, variance: null, patientShift: 0 });
  }
  rem.exceptions = rem.exceptions.filter((e) => e.postingId !== posting.id || e.resolution);
  for (const e of rem.exceptions) {
    if (e.postingId === posting.id && e.resolution && e.kind !== 'Residue') e.resolution.reason = `${e.resolution.reason} (posting reversed)`.trim();
  }
  posting.reversedBy = reversal.id;
  reversal.summary = `Reversed ${posting.id}: ${posting.claimNos.length} claim${posting.claimNos.length === 1 ? '' : 's'} back to ${
    [...new Set(posting.claims.map((c) => c.previousStatus))].join(' / ') || 'in flight'}${
    posting.txIds.length ? `, ${posting.txIds.length} ledger row${posting.txIds.length === 1 ? '' : 's'} reversed` : ''}${
    posting.denialIds.length ? `, ${posting.denialIds.length} denial${posting.denialIds.length === 1 ? '' : 's'} withdrawn` : ''}${
    posting.handoffIds.length ? `, hand-off ${posting.handoffIds.join(', ')} left for Defensio to withdraw` : ''}`;
  rem.postings.push(reversal);
  rem.unapplied = engine.control(rem).unapplied;
  rem.status = livePostings(rem).length ? (openExceptions(rem).length || unpostedRows(rem).length ? 'Posted with Exceptions' : 'Posted') : 'Unposted';
  if (!livePostings(rem).length) rem.postedAt = null;
  rem.updatedAt = when;
  log(rem, 'Reversed', `${reversal.id} — ${reversal.summary} — ${why}`, when, who);
  store.commit('remittances.reverse');
  fire({ remittanceNo: rem.remittanceNo, claimNos: reversal.claimNos, at: when, reversed: true });
  return { error: '', reversal };
}

/**
 * resolveException(no, id, { kind, reason, reference }) → { error, exception }.
 * An overpayment is refunded to the payer, applied as credit (an unapplied
 * row) or adjusted; the role gate is the screen's, the reason is required.
 */
export function resolveException(no, id, { kind, reason = '', reference = '', at = null, by = null } = {}) {
  const rem = get(no);
  const e = rem?.exceptions.find((x) => x.id === id);
  if (!rem || !e) return { error: 'No such exception', exception: null };
  if (e.resolution) return { error: 'Already resolved', exception: e };
  if (e.kind !== 'Overpayment') return { error: 'Match the row to a claim, or remove it', exception: e };
  if (!String(reason || '').trim()) return { error: 'Say why', exception: e };
  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  let ref = reference || null;
  if (kind === 'Apply as credit') {
    const uc = unapplied.create({ payerId: rem.payerId, remittanceNo: rem.remittanceNo, amount: e.amount, at: when, by: who });
    ref = uc.id;
  }
  e.resolution = { kind, ref, reason: String(reason).trim(), by: who, at: when };
  rem.status = livePostings(rem).length ? (openExceptions(rem).length || unpostedRows(rem).length ? 'Posted with Exceptions' : 'Posted') : rem.status;
  rem.updatedAt = when;
  log(rem, 'Exception resolved', `${e.id} ${e.kind} ${usd(e.amount)} on ${e.ref} — ${kind}${ref ? ` · ${ref}` : ''} — ${e.resolution.reason}`, when, who);
  store.commit('remittances.exception');
  return { error: '', exception: e };
}

/** Explicit close: everything posted, nothing open. */
export function close(no, { at = null, by = null } = {}) {
  const rem = get(no);
  if (!rem) return { error: `No remittance ${no}`, remittance: null };
  const why = closeBlocker(rem);
  if (why) return { error: why, remittance: rem };
  const when = at || new Date().toISOString();
  rem.status = 'Closed';
  rem.closedAt = when;
  rem.updatedAt = when;
  log(rem, 'Closed', `${livePostings(rem).length} posting${livePostings(rem).length === 1 ? '' : 's'} stand · ${usd(rem.payment.total)} accounted for`, when, by);
  store.commit('remittances.close');
  return { error: '', remittance: rem };
}

export function closeBlocker(rem) {
  if (!rem) return 'No remittance';
  if (rem.status === 'Closed') return 'Already closed';
  if (!livePostings(rem).length) return 'Nothing has been posted yet';
  const open = openExceptions(rem).length;
  if (open) return `${open} exception${open === 1 ? '' : 's'} still open`;
  const left = unpostedRows(rem).length;
  if (left) return `${left} row${left === 1 ? '' : 's'} not posted yet`;
  return '';
}

// --- internals --------------------------------------------------------------------------

/** A row is addressed by our claim number when it has one, else by the payer's reference. */
export const keyOf = (row) => row.claimNo || row.payerClaimRef;

const cents = engine.cents;

function touch(rem) { rem.updatedAt = new Date().toISOString(); }

function fire(event) {
  for (const fn of afterPostHooks) {
    try { fn(event); } catch (err) { console.warn('[remittances] afterPostHook', err); }
  }
}

function log(rem, action, details, at = null, by = null) {
  audit.all().push({
    id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: rem.remittanceNo, action, details,
    user: by || currentRole().name, at: at || new Date().toISOString(),
  });
}

/** What the seed drives — this file's own writes, dated by the seed. */
const seedApi = {
  createFromFile, createManual, addClaim, updateLines, resolveMatch, post, resolveException, close,
  rowFromClaim, inFlightClaims, get,
  push: (rem) => store.table(TABLE).push(rem),
};
