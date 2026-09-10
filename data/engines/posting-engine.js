// Engine — ERA processing and payment posting (amendment 29). Pure: no DOM,
// no writes, and it reads no repository. It is handed a remittance and the
// claims it names, and answers with what posting it would do — the per-line
// outcomes, the claim statuses, the denials, the patient shifts, the hand-offs,
// the exceptions and the residue — so data/repositories/remittances.js can
// execute that plan, and a screen can show it before anything is written.
//
// The one thing it will not do is recompute what the payer owed: a claim line's
// `payerShare` was stamped at assembly under the contract in force, and that
// stamp is what a remittance is measured against. A payer that pays less is
// underpaying; a payer that says the rate was lower is disagreeing, which is
// what a Defensio hand-off is for.

import { CONFIG } from '../../shared/config.js';

export const OUTCOMES = ['Paid in full', 'Underpaid', 'Overpaid', 'Denied', 'Adjusted'];
export const MATCH = ['Matched', 'Ambiguous', 'Unmatched'];
export const EXCEPTION_KINDS = ['AmbiguousMatch', 'Unmatched', 'Residue', 'Overpayment'];
export const METHODS = ['EFT', 'Cheque', 'Transfer'];

export const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;
const same = (a, b) => Math.abs(cents(a) - cents(b)) < 0.005;

// --- codes -------------------------------------------------------------------

export const adjCodes = () => CONFIG.claima?.posting?.adjCodes || [];
export const adjCode = (code) => adjCodes().find((c) => c.code === code) || null;
export const adjLabel = (code) => (adjCode(code) ? `${code} · ${adjCode(code).label}` : code || '—');

/** A PR-* code moves the amount to the patient; anything else is the payer's own adjustment. */
export const isPatientResponsibility = (code) => String(code || '').toUpperCase().startsWith('PR-');

/** The payer's tolerance: within the floor, or within the share of the line, whichever is kinder. */
export function toleranceOf(payerId) {
  const p = CONFIG.claima?.posting || {};
  return p.tolerance?.[payerId] || p.toleranceDefault || { pct: 0.05, amount: 25 };
}

export const withinTolerance = (variance, expected, tol) =>
  cents(variance) <= Math.max(cents(tol.amount), cents(expected * tol.pct));

export const toleranceLabel = (tol) => `${Math.round(tol.pct * 100)}% or ${cents(tol.amount)} USD`;

// --- one line ---------------------------------------------------------------

/**
 * What a remittance line says against what was expected. `expected` is the
 * stamped payer share. A PR-* adjustment is not money lost — it is money the
 * patient now owes — so it is taken off the variance and reported as a shift;
 * a CO or OA adjustment is the payer paying less, and stays in the variance.
 * With the payer's tolerance given, a coded shortfall inside it reads as
 * Adjusted — a contractual write-off the hospital accepts — and only a
 * shortfall past it, or one the payer gave no reason for, is Underpaid.
 */
export function evaluateLine(line, expected, tol = null) {
  const paid = cents(line.paid);
  const adjustment = cents(line.adjustment);
  const denied = cents(line.denied);
  const patientShift = isPatientResponsibility(line.adjCode) ? adjustment : 0;
  const contractual = cents(adjustment - patientShift);
  const covered = cents(paid + patientShift);
  const variance = cents(expected - covered);
  let outcome;
  if (covered > expected + 0.005) outcome = 'Overpaid';
  else if (same(covered, expected)) outcome = patientShift > 0 || contractual > 0 ? 'Adjusted' : 'Paid in full';
  else if (denied > 0 && paid === 0) outcome = 'Denied';
  else if (contractual > 0 && tol && withinTolerance(variance, expected, tol) && same(covered + contractual, expected)) outcome = 'Adjusted';
  else outcome = 'Underpaid';
  return { paid, adjustment, denied, patientShift, contractual, variance, outcome, expected: cents(expected) };
}

export function outcomeTone(outcome) {
  if (outcome === 'Paid in full') return 'success';
  if (outcome === 'Adjusted') return 'info';
  if (outcome === 'Denied') return 'critical';
  return 'warning';
}

// --- matching ----------------------------------------------------------------

/**
 * Which of our claims a remittance row is about. By claim number when the row
 * carries one that resolves to a claim of this payer; otherwise by what the
 * payer echoed — the date of service and the billed amount — over the payer's
 * claims still with it. One candidate is a match, several are ambiguous, none
 * is unmatched. `pool` is the payer's in-flight claims.
 */
export function matchClaim(row, pool = []) {
  const byNo = row.claimNo ? pool.filter((c) => c.claimNo === row.claimNo) : [];
  if (byNo.length === 1) return { matchStatus: 'Matched', claimNo: byNo[0].claimNo, candidates: [byNo[0].claimNo] };
  const echoed = pool.filter((c) =>
    (!row.dateOfService || c.dateOfService === row.dateOfService)
    && (!row.billed || same(c.totals?.gross, row.billed)));
  if (echoed.length === 1) return { matchStatus: 'Matched', claimNo: echoed[0].claimNo, candidates: [echoed[0].claimNo] };
  if (echoed.length > 1) return { matchStatus: 'Ambiguous', claimNo: null, candidates: echoed.map((c) => c.claimNo) };
  return { matchStatus: 'Unmatched', claimNo: null, candidates: [] };
}

/**
 * Pair a row's lines with the claim's. By our line id when the payer echoed
 * it, else by charge code in order; a line the claim does not carry stays
 * unmatched and the row cannot post until it is fixed.
 */
export function matchLines(lines = [], claim = null) {
  const free = [...(claim?.lines || [])];
  return lines.map((line) => {
    let hit = free.find((l) => l.id === line.lineRef);
    if (!hit && line.chargeCode) hit = free.find((l) => l.chargeCode === line.chargeCode || l.itemId === line.chargeCode);
    if (hit) free.splice(free.indexOf(hit), 1);
    return { ...line, claimLineId: hit?.id || null, matchStatus: hit ? 'Matched' : 'Unmatched' };
  });
}

// --- control ------------------------------------------------------------------

/**
 * The control strip. A remittance is cash: what its rows say was paid, plus
 * what nothing accounts for, has to equal the payment — adjustments and
 * denials are reasons, not money, and are shown beside it. `over` is the
 * shortfall when the rows claim more cash than the payment carries, which is
 * what blocks posting.
 */
export function control(remittance) {
  const rows = remittance?.claims || [];
  const lines = rows.flatMap((r) => r.lines || []);
  const sum = (key) => cents(lines.reduce((n, l) => n + (Number(l[key]) || 0), 0));
  const total = cents(remittance?.payment?.total);
  const paid = sum('paid');
  const unapplied = cents(total - paid);
  return {
    total, paid, adjusted: sum('adjustment'), denied: sum('denied'),
    entered: cents(paid + sum('adjustment') + sum('denied')),
    unapplied: Math.max(0, unapplied),
    over: unapplied < -0.005 ? cents(-unapplied) : 0,
    balanced: unapplied >= -0.005,
    rows: rows.length,
  };
}

// --- the plan ----------------------------------------------------------------

/**
 * plan(remittance, { claimOf, nextPolicyOf, handoffExists }) → what posting
 * would do. Each matched row whose lines all match becomes a posting entry;
 * an ambiguous or unmatched row becomes an exception and posts nothing; a
 * line paid over its expected share raises an Overpayment exception on the
 * entry; residue becomes unapplied cash. `claimOf(claimNo)` hands back the
 * claim as stored; `nextPolicyOf(claim)` the cover behind the claim's, or
 * null; `handoffExists(claim)` whether Defensio already holds one for it;
 * `unappliedHeld` what earlier postings of this remittance already hold.
 */
export function plan(remittance, { claimOf, nextPolicyOf = () => null, handoffExists = () => false, unappliedHeld = 0 } = {}) {
  const ctl = control(remittance);
  // Residue already held by an earlier posting of this remittance stays held;
  // only what a later posting adds is raised again.
  const residue = cents(ctl.unapplied - unappliedHeld);
  const entries = [];
  const exceptions = [];
  let n = 0;
  const exception = (kind, ref, amount, extra = {}) => {
    n += 1;
    exceptions.push({ id: `EX-${n}`, kind, ref, amount: cents(amount), resolution: null, ...extra });
  };

  for (const row of remittance.claims || []) {
    if (row.posted) continue;
    const cash = cents((row.lines || []).reduce((s, l) => s + (Number(l.paid) || 0), 0));
    if (row.matchStatus === 'Ambiguous') { exception('AmbiguousMatch', row.payerClaimRef, cash, { candidates: row.candidates }); continue; }
    if (row.matchStatus !== 'Matched' || !row.claimNo) { exception('Unmatched', row.payerClaimRef, cash); continue; }
    const claim = claimOf(row.claimNo);
    if (!claim) { exception('Unmatched', row.payerClaimRef, cash); continue; }
    const unmatched = (row.lines || []).filter((l) => !l.claimLineId);
    if (unmatched.length) {
      exception('Unmatched', `${row.claimNo} · ${unmatched.map((l) => l.lineRef || l.chargeCode).join(', ')}`, cash,
        { claimNo: row.claimNo, lines: unmatched.map((l) => l.lineRef) });
      continue;
    }
    entries.push(entryFor(row, claim, { nextPolicyOf, handoffExists, exception }));
  }
  if (residue > 0) exception('Residue', remittance.payment?.reference || remittance.remittanceNo, residue);

  return {
    entries,
    exceptions,
    unapplied: ctl.unapplied,
    residue: Math.max(0, residue),
    control: ctl,
    blocked: ctl.over ? `The rows say ${cents(ctl.paid)} USD was paid but the payment is ${cents(ctl.total)} USD — ${cents(ctl.over)} USD over` : '',
  };
}

function entryFor(row, claim, { nextPolicyOf, handoffExists, exception }) {
  const tol = toleranceOf(claim.payerId);
  const lines = row.lines.map((line) => {
    const claimLine = claim.lines.find((l) => l.id === line.claimLineId);
    const result = evaluateLine(line, claimLine?.payerShare || 0, tol);
    return { ...line, ...result, claimLine };
  });
  const sum = (key) => cents(lines.reduce((s, l) => s + (Number(l[key]) || 0), 0));
  const paid = sum('paid');
  const contractual = sum('contractual');
  const denied = sum('denied');
  const expected = sum('expected');
  const shift = sum('patientShift');

  const denials = lines.filter((l) => l.denied > 0).map((l) => ({
    lineId: l.claimLineId, code: l.denialCode || null, amount: l.denied,
  }));
  const shifts = lines.filter((l) => l.patientShift > 0).map((l) => ({
    lineId: l.claimLineId, code: l.adjCode, amount: l.patientShift,
  }));
  const beyond = lines.filter((l) => l.outcome === 'Underpaid' && l.variance > 0 && !withinTolerance(l.variance, l.expected, tol));
  const handoff = beyond.length && !handoffExists(claim)
    ? { amount: cents(beyond.reduce((s, l) => s + l.variance, 0)), lineIds: beyond.map((l) => l.claimLineId), tolerance: tol }
    : null;
  const over = lines.filter((l) => l.outcome === 'Overpaid');
  if (over.length) {
    exception('Overpayment', claim.claimNo, cents(over.reduce((s, l) => s - l.variance, 0)),
      { claimNo: claim.claimNo, lines: over.map((l) => l.claimLineId) });
  }

  // Denied outright when nothing was paid and something was refused; paid when
  // every line is covered; partially paid for anything in between.
  const nothingPaid = paid === 0 && shift === 0;
  const status = nothingPaid && denied > 0 ? 'Denied'
    : lines.every((l) => l.outcome === 'Paid in full' || l.outcome === 'Adjusted' || l.outcome === 'Overpaid') ? 'Paid'
      : 'Partially Paid';

  const next = nextPolicyOf(claim);
  const remaining = lines
    .map((l) => ({ lineId: l.claimLineId, remaining: cents(l.expected - l.paid) }))
    .filter((l) => l.remaining > 0);
  const secondary = next && remaining.length && status !== 'Denied'
    ? { policy: next, lines: remaining, amount: cents(remaining.reduce((s, l) => s + l.remaining, 0)) }
    : null;

  return {
    claimNo: claim.claimNo, claim, row, lines, status,
    paid, adjusted: contractual, denied, expected, patientShift: shift,
    variance: cents(expected - paid - shift),
    denials, shifts, handoff, secondary,
  };
}

/** One sentence per thing the posting did — the fan-out summary. */
export function summarize(result) {
  const parts = [];
  const n = result.claimNos?.length || 0;
  parts.push(`${n} claim${n === 1 ? '' : 's'} posted`);
  if (result.denials) parts.push(`${result.denials} denial${result.denials === 1 ? '' : 's'} created`);
  if (result.shifts) parts.push(`${result.shifts} patient shift${result.shifts === 1 ? '' : 's'} ${cents(result.shiftAmount)} USD`);
  if (result.handoffs) parts.push(`${result.handoffs} Defensio hand-off${result.handoffs === 1 ? '' : 's'}`);
  if (result.secondaries) parts.push(`${result.secondaries} secondary claim${result.secondaries === 1 ? '' : 's'} activated`);
  if (result.unapplied) parts.push(`${cents(result.unapplied)} USD unapplied`);
  if (result.exceptions) parts.push(`${result.exceptions} exception${result.exceptions === 1 ? '' : 's'} open`);
  return parts.join(' · ');
}

// --- the ERA file -------------------------------------------------------------
// One CSV, three record types by the first column: H (the payment), C (a claim
// the payer adjudicated), L (a line of it). Positional after the type, which is
// how a payer's flat file reads; the header row is optional and skipped.

export const ERA_COLUMNS = {
  H: ['payerId', 'paymentRef', 'paymentDate', 'method', 'total'],
  C: ['claimNo', 'payerClaimRef', 'memberId', 'dateOfService', 'billed'],
  L: ['claimNo', 'lineRef', 'chargeCode', 'billed', 'paid', 'adjustment', 'adjCode', 'denied', 'denialCode'],
};

/** Quote-aware CSV split, blank lines dropped — the payer importer's parser. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') { field += '"'; i += 1; }
      else quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

const money = (v) => {
  const t = String(v ?? '').trim();
  if (t === '') return 0;
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return NaN;
  return cents(Number(t));
};

/**
 * parseEra(text) → { header, claims, read, failed }. A row that cannot be
 * read is reported with its line number and skipped, and the file goes on —
 * a payer's file with two bad lines is still a remittance worth capturing,
 * and the two are entered by hand on the same remittance.
 */
export function parseEra(text) {
  const rows = parseCsv(text);
  const failed = [];
  let header = null;
  const claims = [];
  const byNo = new Map();
  let read = 0;
  rows.forEach((cells, i) => {
    const n = i + 1;
    const type = String(cells[0] || '').trim().toUpperCase();
    if (n === 1 && (type === 'TYPE' || type.startsWith('#'))) return;
    const fail = (reason) => failed.push({ row: n, reason, raw: cells.join(',') });
    if (!ERA_COLUMNS[type]) return fail(`Unknown record type "${cells[0] || ''}"`);
    read += 1;
    const rec = Object.fromEntries(ERA_COLUMNS[type].map((key, k) => [key, String(cells[k + 1] ?? '').trim()]));
    if (type === 'H') {
      const total = money(rec.total);
      if (!rec.payerId) return fail('Header names no payer');
      if (!rec.paymentRef) return fail('Header names no payment reference');
      if (Number.isNaN(total) || total <= 0) return fail(`Payment total "${rec.total}" is not an amount`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rec.paymentDate)) return fail(`Payment date "${rec.paymentDate}" is not YYYY-MM-DD`);
      if (!METHODS.includes(rec.method)) return fail(`Method "${rec.method}" is not one of ${METHODS.join(', ')}`);
      header = { ...rec, total };
      return undefined;
    }
    if (type === 'C') {
      if (!rec.claimNo && !rec.payerClaimRef) return fail('Claim row names neither our claim number nor the payer reference');
      const billed = money(rec.billed);
      if (Number.isNaN(billed)) return fail(`Billed "${rec.billed}" is not an amount`);
      const key = rec.claimNo || rec.payerClaimRef;
      const claim = { claimNo: rec.claimNo || null, payerClaimRef: rec.payerClaimRef || rec.claimNo, memberId: rec.memberId,
        dateOfService: rec.dateOfService || null, billed, lines: [] };
      claims.push(claim);
      byNo.set(key, claim);
      return undefined;
    }
    const claim = byNo.get(rec.claimNo);
    if (!claim) return fail(`Line for ${rec.claimNo || 'no claim'} — no claim row above it`);
    const nums = { billed: money(rec.billed), paid: money(rec.paid), adjustment: money(rec.adjustment), denied: money(rec.denied) };
    const bad = Object.entries(nums).find(([, v]) => Number.isNaN(v));
    if (bad) return fail(`${bad[0][0].toUpperCase()}${bad[0].slice(1)} "${rec[bad[0]]}" is not an amount`);
    if (nums.adjustment > 0 && rec.adjCode && !adjCode(rec.adjCode)) return fail(`Adjustment code "${rec.adjCode}" is not one the platform knows`);
    if (nums.adjustment > 0 && !rec.adjCode) return fail('Adjustment carries no reason code');
    if (nums.denied > 0 && !rec.denialCode) return fail('Denied amount carries no denial code');
    claim.lines.push({
      lineRef: rec.lineRef || null, chargeCode: rec.chargeCode || null, billed: nums.billed, paid: nums.paid,
      adjustment: nums.adjustment, adjCode: nums.adjustment > 0 ? rec.adjCode : null,
      denied: nums.denied, denialCode: nums.denied > 0 ? rec.denialCode : null,
    });
    return undefined;
  });
  if (!header) failed.unshift({ row: 0, reason: 'No H (payment header) record in the file', raw: '' });
  return { header, claims, read, failed };
}

/** Rows back out as the file the failures came from — the downloadable report. */
export function failuresCsv(failed = []) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return ['Row,Reason,Record', ...failed.map((f) => [f.row, q(f.reason), q(f.raw)].join(','))].join('\r\n');
}
