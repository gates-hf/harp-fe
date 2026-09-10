// Seed — remittances (amendment 29). Six remittances written as a table of
// intents — this payer, this many days ago, these claims answered this way —
// and driven through the remittance repository's own writes with the dates the
// events happened on, so every seeded posting is one the posting engine ran:
// the denials, the patient shifts on the ledger, the Defensio hand-off, the
// unapplied cash and the activated secondary all come out of it rather than
// being written by hand beside it.
//
// The claims are the generated in-flight ones (data/seed/claims.js): per payer
// the LARGEST payer share that clears each answer's floor, so the money the
// screens show is worth reading, and never one the submission feature's seed
// has put in a batch — that claim's answer arrives through its batch.
// data/store.js does not import this file: data/repositories/remittances.js
// reads it on first read of an empty table and hands it its own API.

import * as claims from '../repositories/claims.js';
import * as payers from '../repositories/payers.js';
import * as unapplied from '../repositories/unapplied.js';
import { RESOLUTIONS } from './unapplied.js';
import { todayIso } from '../../shared/format.js';

const CODER = 'Tarek Solh';
const CASHIER = 'Nadine Rizk';

// --- answers -------------------------------------------------------------------
// How a payer answers one line, as a function of what it was expected to pay.

const full = (e) => ({ paid: e });
const withinTolerance = (e) => { const a = Math.min(12, r2(e * 0.02)); return { paid: r2(e - a), adjustment: a, adjCode: 'CO-45' }; };
const beyondTolerance = (e) => ({ paid: r2(e * 0.72), adjustment: r2(e - r2(e * 0.72)), adjCode: 'CO-45' });
const denied = (code) => (e) => ({ paid: 0, denied: e, denialCode: code });
const shift = (share, code = 'PR-1') => (e) => ({ paid: r2(e - r2(e * share)), adjustment: r2(e * share), adjCode: code });
const over = (extra) => (e) => ({ paid: r2(e + extra) });

/**
 * One intent per remittance, oldest first. `daysAgo` is the payment date;
 * `claims` picks the payer's oldest in-flight claims in turn, each answered by
 * `answer` on every line; `residue` is cash no row accounts for; `via` says
 * how it was captured; `state` how far it went.
 */
const INTENTS = [
  // NSSF pays four claims in July, one a few dollars under inside its tolerance,
  // and $40 nobody asked for — held ever since, which is the row the 30-day
  // warning paints. Posted the next morning, closed the day after.
  { payerId: 'PY-0001', daysAgo: 44, via: 'Manual', method: 'EFT', reference: 'NSSF/EFT/2026/07/0091',
    claims: [{ answer: full }, { answer: withinTolerance, minShare: 120 }, { answer: full }, { answer: full }],
    residue: 40, state: 'Closed', postedDaysAgo: 43, closedDaysAgo: 42, by: CODER },

  // Bankers' file: one row names no claim number and nothing the desk can match
  // it by, so every claim of theirs in flight could be it (ambiguous, still
  // open); one is paid $35 over its share (the overpayment, still open); one is
  // clean. Posted with those two exceptions.
  { payerId: 'PY-0007', daysAgo: 21, via: 'File', method: 'Cheque', reference: 'BNK-CHQ-778102',
    claims: [{ answer: full, ambiguous: true }, { answer: over(35), minShare: 40, maxShare: 300 }, { answer: full, maxShare: 100 }],
    residue: 25, state: 'Posted with Exceptions', postedDaysAgo: 20, by: CASHIER },

  // NSSF answers a dependant's claim net of coinsurance — which is what the AXA
  // cover behind it is for: the posting activates the secondary and chains it.
  // The $75 residue was applied to the fund's next claim three days on.
  { payerId: 'PY-0001', daysAgo: 14, via: 'Manual', method: 'EFT', reference: 'NSSF/EFT/2026/08/0138',
    claims: [{ answer: shift(0.2, 'PR-2'), secondary: true }, { answer: full }],
    residue: 75, state: 'Posted', postedDaysAgo: 13, by: CODER },

  // Bupa's transfer, last week: one claim paid well under the contracted rate
  // (the hand-off to Defensio), one paid net of a deductible the patient now
  // owes (the shift on the account), one refused outright for a missing
  // pre-authorisation (the denial).
  { payerId: 'PY-0025', daysAgo: 6, via: 'Manual', method: 'Transfer', reference: 'BUPA-TRF-2026-090407',
    claims: [{ answer: beyondTolerance, minShare: 150 }, { answer: shift(0.25, 'PR-1'), minShare: 100 }, { answer: denied('CO-197'), minShare: 60, maxShare: 200 }],
    residue: 0, state: 'Posted', postedDaysAgo: 5, by: CODER },

  // The Army fund's file, uploaded three days ago and not yet posted: two of its
  // rows could not be read, and the parse report says which.
  { payerId: 'PY-0003', daysAgo: 3, via: 'File', bad: true, method: 'EFT', reference: 'LAHF-ERA-26-0930',
    claims: [{ answer: full }, { answer: withinTolerance, minShare: 120 }, { answer: full }],
    residue: 0, state: 'Unposted', by: CASHIER },

  // Allianz's cheque, being typed in yesterday: the first claim entered, the
  // second still at zero, so the strip shows what is left to account for.
  { payerId: 'PY-0009', daysAgo: 1, via: 'Manual', method: 'Cheque', reference: 'ALZ-CHQ-0091447',
    claims: [{ answer: full }, { answer: full, blank: true }],
    residue: 0, state: 'Unposted', by: CASHIER },
];

// --- the run ---------------------------------------------------------------------

/** Drives the repository's own writes; returns nothing — the table fills as it goes. */
export function buildRemittances(api) {
  const used = new Set();
  INTENTS.forEach((intent, i) => {
    // A payer answers claims it has received: the picks are submitted before
    // the payment date, and when too few are, the payment moves after them.
    let payDate = daysAgo(intent.daysAgo);
    let picks = pickClaims(intent, used, payDate);
    if (picks.length < intent.claims.length) {
      for (const { claim } of picks) used.delete(claim.claimNo);
      picks = pickClaims(intent, used, null);
      if (picks.length < intent.claims.length) { console.warn('[remittances seed] not enough claims for', intent.reference); return; }
      const latest = picks.map((x) => x.claim.submittedAt).sort().pop();
      if (latest >= payDate) payDate = daysAfter(latest, 1);
    }
    const payerId = picks[0].claim.payerId;
    const at = `${payDate}T09:${String(10 + i * 6).padStart(2, '0')}:00.000Z`;
    const rows = picks.map(({ claim, spec }) => ({ claim, spec, lines: answer(claim, spec) }));
    const paid = r2(rows.reduce((n, r) => n + r.lines.reduce((m, l) => m + l.paid, 0), 0));
    const payment = { reference: intent.reference, date: payDate, method: intent.method, total: r2(paid + (intent.residue || 0)) };

    let rem;
    if (intent.via === 'File') {
      const text = eraCsv({ payerId, payment, rows, bad: Boolean(intent.bad) });
      rem = api.createFromFile({ fileName: `${payerCode(payerId)}-era-${payDate}.csv`, text, at, by: intent.by }).remittance;
    } else {
      rem = api.createManual({ payerId, payment, at, by: intent.by }).remittance;
      for (const row of rows) {
        api.addClaim(rem.remittanceNo, row.claim.claimNo, { payerClaimRef: payerRef(payerId, row.claim) });
        if (!row.spec.blank) api.updateLines(rem.remittanceNo, row.claim.claimNo, row.lines);
      }
    }
    if (!rem || intent.state === 'Unposted') return;

    const postedAt = `${later(daysAgo(intent.postedDaysAgo), daysAfter(payDate, 1))}T10:${String(20 + i * 4).padStart(2, '0')}:00.000Z`;
    const res = api.post(rem.remittanceNo, { at: postedAt, by: intent.by });
    if (res.error) console.warn('[remittances seed]', rem.remittanceNo, res.error);
    if (intent.state === 'Closed') api.close(rem.remittanceNo, { at: `${later(daysAgo(intent.closedDaysAgo), daysAfter(payDate, 2))}T11:05:00.000Z`, by: intent.by });

    const resolution = RESOLUTIONS[rem.remittanceNo];
    if (resolution) {
      const row = unapplied.byRemittance(rem.remittanceNo).find((r) => r.status === 'Held');
      // The oldest claim the residue settles whole, else the oldest there is.
      const open = api.inFlightClaims(payerId).filter((c) => seedable(c) && !used.has(c.claimNo)).sort(bySubmitted);
      const next = open.find((c) => row && c.totals.payerShare <= row.amount) || open[0];
      if (row && next) {
        used.add(next.claimNo);
        unapplied.apply(row.id, next.claimNo, {
          reason: resolution.reason, by: resolution.by,
          at: `${daysAgo(intent.postedDaysAgo - resolution.daysAfter)}T14:30:00.000Z`,
        });
      }
    }
  });
}

// --- picking ---------------------------------------------------------------------

/**
 * The payer's in-flight claims submitted before `before` that fit each spec,
 * in order, largest payer share first and never reused. A spec that cannot be
 * met inside its floor and ceiling is met at any amount; a secondary that no
 * claim of this payer can carry is found on another payer, and the whole
 * remittance moves there.
 */
function pickClaims(intent, used, before = null) {
  const poolOf = (payerId) => claims.all()
    .filter((c) => (!payerId || c.payerId === payerId) && seedable(c) && !used.has(c.claimNo) && (!before || c.submittedAt < before))
    .sort(byShare);
  let payerId = intent.payerId;
  if (intent.claims.some((s) => s.secondary) && !poolOf(payerId).some((c) => claims.secondaryPolicyOf(c))) {
    payerId = poolOf(null).find((c) => claims.secondaryPolicyOf(c))?.payerId || payerId;
  }
  const pool = poolOf(payerId);
  const fits = (c, spec, floor, ceiling) =>
    !used.has(c.claimNo)
    && c.totals.payerShare >= floor && c.totals.payerShare <= ceiling
    && (!spec.secondary || claims.secondaryPolicyOf(c))
    && (!spec.ambiguous || pool.filter((o) => !used.has(o.claimNo)).length > 1);
  const out = [];
  for (const spec of intent.claims) {
    const hit = pool.find((c) => fits(c, spec, spec.minShare || 20, spec.maxShare || Infinity)) || pool.find((c) => fits(c, spec, 0, Infinity));
    if (!hit) break;
    used.add(hit.claimNo);
    out.push({ claim: hit, spec });
  }
  return out;
}

const byShare = (a, b) => b.totals.payerShare - a.totals.payerShare || String(a.submittedAt).localeCompare(String(b.submittedAt)) || a.claimNo.localeCompare(b.claimNo);
const bySubmitted = (a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)) || a.claimNo.localeCompare(b.claimNo);

/**
 * A claim this seed may answer: in flight, worth something, and in no
 * submission batch — a batched claim's answer arrives through that batch's
 * acknowledgment (amendment 28), and a remittance seeded over it would pay a
 * claim the payer has not acknowledged.
 */
const seedable = (c) => claims.isPending(c) && !c.batchId && c.totals.payerShare > 0;

/** The payer's answer on every line of the claim, in the remittance's line shape. */
function answer(claim, spec) {
  return claim.lines.map((l) => {
    const a = spec.answer(r2(l.payerShare));
    return {
      lineRef: l.id, claimLineId: l.id, chargeCode: l.chargeCode || l.itemId, billed: l.grossBilled,
      paid: r2(a.paid), adjustment: r2(a.adjustment), adjCode: a.adjustment > 0 ? a.adjCode : null,
      denied: r2(a.denied), denialCode: a.denied > 0 ? a.denialCode : null,
    };
  });
}

// --- the file -------------------------------------------------------------------------

export const ERA_HEADER = 'type,f1,f2,f3,f4,f5,f6,f7,f8,f9';

/**
 * The payer's flat file: an H record, then a C and its L records per claim.
 * An ambiguous row is written the way a payer's advice sometimes reads — no
 * claim number, only what it echoes back (a date, or a billed amount) — with
 * its lines keyed by the payer's reference. `bad` adds the two rows that
 * cannot be read: a paid amount with a letter in it, and a line for a claim
 * the file never introduced.
 */
export function eraCsv({ payerId, payment, rows, bad = false }) {
  const out = [ERA_HEADER];
  out.push(['H', payerId, payment.reference, payment.date, payment.method, money(payment.total)].join(','));
  rows.forEach((row, i) => {
    const ref = payerRef(payerId, row.claim);
    const probe = row.spec?.ambiguous ? probeOf(row.claim, payerId) : null;
    const key = probe ? ref : row.claim.claimNo;
    out.push(['C', probe ? '' : row.claim.claimNo, ref, memberOf(row.claim),
      probe ? probe.dateOfService : row.claim.dateOfService, probe ? probe.billed : money(row.claim.totals.gross)].join(','));
    for (const l of row.lines) {
      out.push(['L', key, l.lineRef, l.chargeCode || '', money(l.billed), money(l.paid), money(l.adjustment),
        l.adjCode || '', money(l.denied), l.denialCode || ''].join(','));
    }
    if (bad && i === 0) out.push(['L', key, 'L9', 'LAB-0001', '85.00', '8O.00', '0.00', '', '0.00', ''].join(','));
    if (bad && i === 1) out.push(['L', 'CLM-2026-000009', 'L1', 'CON-0001', '40.00', '40.00', '0.00', '', '0.00', ''].join(','));
  });
  return out.join('\r\n');
}

/**
 * What the advice echoes for a row with no claim number: the date when another
 * claim shares it, else the billed amount when another claim shares that, else
 * nothing at all — and then every claim of the payer's in flight could be it.
 */
function probeOf(claim, payerId) {
  const twins = claims.all().filter((c) => c.payerId === payerId && claims.isPending(c) && !c.batchId && c.claimNo !== claim.claimNo);
  if (twins.some((c) => c.dateOfService === claim.dateOfService)) return { dateOfService: claim.dateOfService, billed: '' };
  if (twins.some((c) => c.totals.gross === claim.totals.gross)) return { dateOfService: '', billed: money(claim.totals.gross) };
  return { dateOfService: '', billed: '' };
}

/**
 * The built-in sample the upload screen offers: Bupa's answer to its four
 * largest claims still in flight — one paid well under the rate, one in full,
 * one refused for missing documents, one net of coinsurance — with $30 nobody
 * asked for and the two rows that fail to parse. Built on demand off the
 * claims table, so it is a remittance that can be posted whenever it is loaded.
 */
export const SAMPLE_FILE = 'bupa-era-sample.csv';
export function sampleEra(payerId = 'PY-0025') {
  const pool = claims.all().filter((c) => c.payerId === payerId && seedable(c) && c.totals.payerShare >= 40).sort(byShare);
  const specs = [{ answer: beyondTolerance }, { answer: full }, { answer: denied('CO-16') }, { answer: shift(0.2, 'PR-2') }];
  const rows = specs.map((spec, i) => (pool[i] ? { claim: pool[i], spec, lines: answer(pool[i], spec) } : null)).filter(Boolean);
  const paid = r2(rows.reduce((n, r) => n + r.lines.reduce((m, l) => m + l.paid, 0), 0));
  const payment = { reference: `BUPA-EFT-${todayIso().replace(/-/g, '')}-07`, date: todayIso(), method: 'EFT', total: r2(paid + 30) };
  return { fileName: SAMPLE_FILE, text: eraCsv({ payerId, payment, rows, bad: true }), claims: rows.length };
}

// --- internals ------------------------------------------------------------------------

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n) => r2(n).toFixed(2);

const daysAgo = (n) => daysAfter(todayIso(), -n);

const daysAfter = (isoDate, n) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const later = (a, b) => (a > b ? a : b);

const payerCode = (payerId) => (payers.get(payerId)?.nameEn || payerId).split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '') || payerId.toLowerCase();

/** How the payer refers to our claim on its advice — its own reference, ours inside it. */
const payerRef = (payerId, claim) => `${payerCode(payerId).toUpperCase().slice(0, 4)}-${String(claim.claimNo).slice(-6)}-${claim.dateOfService.slice(5, 7)}`;

const memberOf = (claim) => claim.policyId || '';
