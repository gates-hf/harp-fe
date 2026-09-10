// Seed — write-offs. A table of intents rather than rows written out: this
// source, this reason, this far along the chain, this many days ago. The
// sources are found on the registers by rule at build time (the largest
// residual NSSF still owes, the account with the smallest balance, the oldest
// claim the payer has gone quiet on), so a request always names a record that
// exists and whose balance it could have been raised against. Like the other
// derived seeds it reads repositories, so data/store.js does not import it:
// data/repositories/writeoffs.js builds it once the denials feature has
// loaded, which is what lets a request name the denial it answers.
//
// Postings are written the way the registers write them — claims.adjust for
// the payer side, an Adjustment row pushed straight into the ledger for the
// patient side — dated when they happened, and never committed here.

import { store } from '../store.js';
import * as audit from '../repositories/audit.js';
import * as claims from '../repositories/claims.js';
import * as accounts from '../repositories/accounts.js';
import * as ledger from '../repositories/ledger.js';
import * as accountEngine from '../engines/account-engine.js';
import * as tiers from '../engines/writeoff-tiers.js';
import { classificationOf, reasonLabel } from './writeoff-reasons.js';
import { usd } from '../../shared/format.js';

const ENTITY = 'writeoffs';
const FIRST = 47;

/** The requesters and signers who never sign in — the demo roles approve beside them. */
const CLERK = 'Rima Nassar';
const COLLECTOR = 'Hassan Kobeissi';
const CODER = 'Tarek Solh';
const CMO = 'Georges Khoury';

const REASON_OF_DENIAL = { LATE_FILING: 'W02', COV_RULE: 'W01' };

/** buildWriteoffs({ denials }) → the rows, with their postings and their trail written. */
export function buildWriteoffs({ denials = null } = {}) {
  ledger.all();
  const picks = pickSources(denials);
  const intents = [
    // Posted from a denial the payer would never pay: filing window missed.
    { src: picks.denialLate, reason: 'W02', by: CLERK, ago: 12, chain: 'posted', signer: CMO, decidedAgo: 10, postedAgo: 9,
      why: 'Claim filed after the payer’s 30-day window; the resubmission was refused on the same code. Nothing further to pursue.' },
    // Waiting at tier 1 — the signed-in coder or the CMO can decide it.
    { src: picks.denialSmall, reason: 'W06', by: CLERK, ago: 3, chain: 'pending',
      why: 'Pre-authorisation was never requested for this line; the desk owns the miss and the payer will not reconsider.' },
    // Waiting at tier 2 — management's signature.
    { src: picks.denialMid, reason: 'W01', by: COLLECTOR, ago: 5, chain: 'pending',
      why: 'The payer reads the item as outside the plan’s cover and the contract does not contradict it. Contractual, not recoverable.' },
    // Approved and waiting to be posted — the demo posts it.
    { src: picks.residualBig, reason: 'W01', by: CLERK, ago: 4, chain: 'approved', signer: CODER, decidedAgo: 2,
      why: 'Remittance paid at the fee-schedule rate; the residual is the difference between billed and allowed and was never collectable.' },
    // Posted residual on the payer side.
    { src: picks.residualMid, reason: 'W01', by: CLERK, ago: 24, chain: 'posted', signer: CODER, decidedAgo: 22, postedAgo: 20,
      why: 'Contractual difference after the remittance posted; no appeal ground.' },
    // A balance too small to chase, posted on the ledger.
    { src: picks.smallBalance, reason: 'W03', by: COLLECTOR, ago: 17, chain: 'posted', signer: CODER, decidedAgo: 16, postedAgo: 15,
      why: 'Under the statement floor; not worth the stamp.' },
    // Hardship, sequential: tier 1 signed, tier 2 waiting for management.
    { src: picks.hardship, reason: 'W04', by: COLLECTOR, ago: 6, chain: 'pending', mode: 'Sequential', firstSigner: CODER, firstAgo: 1,
      evidence: { fileName: 'social-worker-assessment.pdf', size: 184320 },
      why: 'Social worker’s assessment on file: single income, two dependants, no cover. Recommended for full hardship write-off.' },
    // Refused — pursue first.
    { src: picks.badDebt, reason: 'W05', by: COLLECTOR, ago: 9, chain: 'rejected', signer: CMO, decidedAgo: 6,
      note: 'Two calls is not collection. Pursue for another month — statement, then a visit — before this comes back.',
      why: 'Two calls unanswered; no payment since discharge.' },
    // …and back, re-requested after the pursuit the refusal asked for.
    { src: picks.badDebt, reason: 'W05', by: COLLECTOR, ago: 0, chain: 'pending', rerequest: 7,
      why: 'Statement sent, home visit made, three further calls logged over the month — no contact, no payment. Recommended as bad debt.' },
    // Posted and then reversed: the payer paid after all.
    { src: picks.residualSmall, reason: 'W06', by: CLERK, ago: 34, chain: 'reversed', signer: CODER, decidedAgo: 32, postedAgo: 30,
      reverser: CMO, reversedAgo: 25, reverseWhy: 'The payer settled the residual on its next remittance; the write-off was premature.',
      why: 'Posted twice against the same line on the remittance; the residual is the duplicate.' },
    // An aged item the payer has gone silent on — the follow-up queue's oldest.
    { src: picks.aged, reason: 'W07', by: COLLECTOR, ago: 1, chain: 'pending',
      why: 'Followed up past the escalation threshold with no answer from the fund. Closing the balance out as unrecoverable.' },
  ].filter((i) => i.src);

  const rows = [];
  intents.forEach((intent, i) => {
    const row = buildRow(intent, FIRST + i, rows);
    rows.push(row);
    if (intent.chain !== 'pending' || intent.firstSigner) {
      applyChain(row, intent, { denials });
    }
  });
  return rows;
}

// --- picking the sources --------------------------------------------------------------

function pickSources(denials) {
  const used = new Set();
  const take = (list) => {
    const hit = list.find((s) => s && !used.has(s.key));
    if (hit) used.add(hit.key);
    return hit || null;
  };

  const openDenials = denials ? (denials.worklist ? denials.worklist() : denials.all().filter((d) => d.status === 'Open')) : [];
  const denialSrc = (d) => {
    const claim = claims.get(d.claimNo);
    const open = Number.isFinite(Number(d.amounts?.open)) ? d.amounts.open : d.amount;
    return {
      key: d.id, kind: 'Denial', ref: d.id, claimNo: d.claimNo, encounterNo: d.encounterNo || claim?.encounterNo || null,
      mrn: d.patientMrn || claim?.patientMrn || null, amount: cents(open), reasonKey: d.reasonCode,
    };
  };
  // The denials feature triages its own seed and leaves the rows that are
  // write-offs classed as candidates with no route; those are the ones this
  // seed may take. A register that knows no classes (the stub) offers any
  // unrouted open denial. Everything else stays with the triage demo, and a
  // Denied claim with no denial record stands in for what is left over.
  const classed = openDenials.some((d) => 'class' in d);
  const unrouted = openDenials
    .filter((d) => (classed ? d.class === 'Write-Off Candidate' && !d.route : !d.route || d.route.kind === 'WriteOff'))
    .map(denialSrc).filter((s) => s.amount > 0);
  const byAmountDesc = [...unrouted].sort((a, b) => b.amount - a.amount || a.key.localeCompare(b.key));
  // Too few open denials on the register (or no denials feature loaded): a
  // Denied claim with no denial record stands in, keyed on its number.
  const named = new Set(unrouted.map((s) => s.claimNo));
  const deniedClaims = claims.all().filter((c) => c.status === 'Denied' && claims.openBalance(c) > 0 && !named.has(c.claimNo) && !audit.forEntity('claims', c.id).length)
    .sort((a, b) => claims.openBalance(b) - claims.openBalance(a) || a.claimNo.localeCompare(b.claimNo))
    .map((c) => ({ key: c.claimNo, kind: 'Denial', ref: c.claimNo, claimNo: c.claimNo, encounterNo: c.encounterNo, mrn: c.patientMrn, amount: claims.openBalance(c), reasonKey: c.denialReasonCode }));
  // A real denial record beats a stand-in whatever the reason, so the seeded
  // posting can resolve its denial and the reconciliation has something to read.
  const pick = (...preds) => [...preds.map((f) => byAmountDesc.find(f)), ...preds.map((f) => deniedClaims.find(f))];

  const denialLate = take(pick((s) => s.reasonKey === 'LATE_FILING' && s.amount >= 25, (s) => s.amount >= 25, () => true));
  const denialSmall = take(pick((s) => ['PA_MISSING', 'DOC_MISSING'].includes(s.reasonKey) && s.amount >= 10 && s.amount <= 500,
    (s) => s.amount >= 10 && s.amount <= 500, (s) => s.amount <= 500));
  const denialMid = take(pick((s) => s.reasonKey === 'COV_RULE' && s.amount > 500 && s.amount <= 5000,
    (s) => s.amount > 500 && s.amount <= 5000, (s) => s.amount > 100));

  const residual = (c) => ({ key: c.claimNo, kind: 'ClaimResidual', ref: c.claimNo, claimNo: c.claimNo, encounterNo: c.encounterNo, mrn: c.patientMrn, amount: claims.openBalance(c) });
  const residuals = claims.all().filter((c) => c.status === 'Partially Paid' && claims.openBalance(c) > 0 && !audit.forEntity('claims', c.id).length)
    .sort((a, b) => claims.openBalance(b) - claims.openBalance(a) || a.claimNo.localeCompare(b.claimNo)).map(residual);
  const residualBig = take([residuals.find((s) => s.amount > 200 && s.amount <= 500), residuals[0]]);
  const residualMid = take([residuals.find((s) => s.amount > 100 && s.amount <= 200), residuals.find((s) => s.amount > 50)]);
  const residualSmall = take([residuals.find((s) => s.amount > 40 && s.amount <= 100), residuals.find((s) => s.amount <= 100)]);

  const owing = accounts.search('', { outstanding: 'owing' })
    .map((a) => ({ key: a.mrn, kind: 'PatientBalance', ref: a.mrn, claimNo: null, encounterNo: null, mrn: a.mrn, amount: a.balances.outstanding }));
  const smallBalance = take([owing.find((s) => s.amount < 25), owing[owing.length - 1]]);
  const hardship = take([owing.find((s) => s.amount > 500 && s.amount <= 5000), owing[0]]);
  const badDebt = take([owing.find((s) => s.amount >= 100 && s.amount <= 300), owing.find((s) => s.amount >= 50)]);

  const inFlight = claims.all().filter((c) => claims.isPending(c) && claims.openBalance(c) > 0 && (c.submittedAt || c.dateOfService))
    .sort((a, b) => String(a.submittedAt || a.dateOfService).localeCompare(String(b.submittedAt || b.dateOfService)) || a.claimNo.localeCompare(b.claimNo));
  const aged = take(inFlight.map((c) => ({ key: c.claimNo, kind: 'AgedItem', ref: c.claimNo, claimNo: c.claimNo, encounterNo: c.encounterNo, mrn: c.patientMrn, amount: claims.openBalance(c) })));

  return { denialLate, denialSmall, denialMid, residualBig, residualMid, residualSmall, smallBalance, hardship, badDebt, aged };
}

// --- building one row ------------------------------------------------------------------

function buildRow(intent, n, rows) {
  const src = intent.src;
  const at = ago(intent.ago, 9 + (n % 6));
  const amount = cents(src.amount);
  const mode = intent.mode || tiers.defaultMode();
  const row = {
    id: `WO-${new Date(at).getFullYear()}-${String(n).padStart(6, '0')}`,
    source: { kind: src.kind, ref: src.ref, encounterNo: src.encounterNo || null, claimNo: src.claimNo || null, mrn: src.mrn || null },
    side: src.kind === 'PatientBalance' ? 'Patient' : 'Payer',
    amountRequested: amount,
    amountPosted: null,
    reasonCode: intent.reason,
    classification: classificationOf(intent.reason),
    justification: intent.why,
    hardshipEvidence: intent.evidence || null,
    status: 'Pending Approval',
    tier: tiers.tierBlock(amount, mode),
    requestedBy: intent.by,
    at,
    decision: null,
    posting: null,
    reversal: null,
    rerequestOf: null,
  };
  if (intent.rerequest !== undefined) {
    const earlier = rows[intent.rerequest];
    if (earlier) {
      row.rerequestOf = earlier.id;
      earlier.rerequestId = row.id;
    }
  }
  log(row, 'Requested', `${usd(amount)} · ${row.reasonCode} ${reasonLabel(row.reasonCode)} (${row.classification}) · ${labelOf(src.kind)} ${src.ref} · ${tiers.tierLabel(row.tier.required)}, ${row.tier.mode.toLowerCase()}${row.rerequestOf ? ` · re-request of ${row.rerequestOf}` : ''}`, at, intent.by);
  return row;
}

/** Walk the row down its chain as far as the intent says, dating each step. */
function applyChain(row, intent, { denials }) {
  if (intent.firstSigner) {
    const at = ago(intent.firstAgo, 15);
    const step = tiers.currentStep(row.tier);
    row.tier = tiers.decide(row.tier, { by: intent.firstSigner, approved: true, at }).tier;
    log(row, 'Step approved', `${tiers.tierLabel(step.tier)} · next ${tiers.tierLabel(tiers.currentStep(row.tier).tier)}`, at, intent.firstSigner);
    return;
  }
  const decidedAt = ago(intent.decidedAgo, 14);
  const step = tiers.currentStep(row.tier);
  if (intent.chain === 'rejected') {
    row.tier = tiers.decide(row.tier, { by: intent.signer, approved: false, note: intent.note, at: decidedAt }).tier;
    row.status = 'Rejected';
    row.decision = { by: intent.signer, at: decidedAt, note: intent.note, outcome: 'Rejected' };
    log(row, 'Rejected', `${tiers.tierLabel(step.tier)} — ${intent.note}`, decidedAt, intent.signer);
    return;
  }
  // Approved: every step signed by the one signer, in order.
  let tier = row.tier;
  while (tiers.currentStep(tier)) tier = tiers.decide(tier, { by: intent.signer, approved: true, at: decidedAt }).tier;
  row.tier = tier;
  row.status = 'Approved';
  row.decision = { by: intent.signer, at: decidedAt, note: null, outcome: 'Approved' };
  log(row, 'Approved', `${tiers.tierLabel(row.tier.required)}${row.tier.steps.length > 1 ? ' · ladder complete' : ''}`, decidedAt, intent.signer);
  if (intent.chain === 'approved') return;

  const postedAt = ago(intent.postedAgo, 11);
  const amount = row.amountRequested;
  const txIds = [];
  if (row.side === 'Payer') {
    const claim = claims.adjust(row.source.claimNo, { amount, reasonCode: row.reasonCode, writeoffId: row.id, at: postedAt, by: intent.signer, commit: false });
    if (claim) txIds.push(`${claim.claimNo}:${claims.adjustmentsOf(claim).slice(-1)[0].id}`);
    if (row.source.kind === 'Denial' && denials?.resolveWrittenOff && denials.get?.(row.source.ref)) {
      denials.resolveWrittenOff(row.source.ref, row.id, amount);
    }
  } else {
    txIds.push(patientAdjustment(row, amount, postedAt, intent.signer).id);
  }
  row.amountPosted = amount;
  row.posting = { txIds, at: postedAt, by: intent.signer, cappedNote: null };
  row.status = 'Posted';
  log(row, 'Posted', `${usd(amount)} ${row.side === 'Payer' ? `off ${row.source.claimNo}` : `off account ${row.source.mrn}`}`, postedAt, intent.signer);
  if (intent.chain !== 'reversed') return;

  const reversedAt = ago(intent.reversedAgo, 16);
  const undo = [];
  if (row.side === 'Payer') {
    claims.reverseAdjustment(row.source.claimNo, { writeoffId: row.id, reason: intent.reverseWhy, at: reversedAt, by: intent.reverser, commit: false });
    undo.push(`${row.source.claimNo}:reversal`);
  } else {
    for (const txId of txIds) {
      const tx = ledger.get(txId);
      if (tx) { tx.status = 'Reversed'; undo.push(pushLedger({ ...tx, type: 'Reversal', detail: { ...tx.detail, reversedType: 'Adjustment' }, reversesTxId: tx.id, reason: intent.reverseWhy }, reversedAt, intent.reverser).id); }
    }
  }
  row.status = 'Reversed';
  row.reversal = { by: intent.reverser, tier: 3, reason: intent.reverseWhy, txIds: undo, at: reversedAt };
  log(row, 'Reversed', `${usd(amount)} put back — ${intent.reverseWhy}`, reversedAt, intent.reverser);
}

/** The ledger's Adjustment row, allocated oldest charge first, pushed the way data/seed/ledger.js pushes its own. */
function patientAdjustment(row, amount, at, by) {
  const mrn = row.source.mrn;
  const { allocations } = accountEngine.allocate(amount, accounts.openCharges(mrn));
  const first = allocations.length ? ledger.get(allocations[0].chargeTxId) : null;
  const label = `${row.reasonCode} ${reasonLabel(row.reasonCode)}`;
  const tx = pushLedger({
    patientMrn: mrn,
    encounterNo: first?.encounterNo || null,
    type: 'Adjustment',
    amount,
    side: 'patient',
    detail: { origin: { writeoffId: row.id }, purpose: 'Write-off', reasonCode: row.reasonCode, reason: label, classification: row.classification, allocations },
    reason: label,
  }, at, by);
  audit.all().push({
    id: store.nextId('audit', 'AU-'), entity: 'account', entityId: mrn, action: 'Adjustment', user: by, at,
    details: `Written off ${usd(amount)} — ${label} · ${row.id}`,
  });
  return tx;
}

function pushLedger(tx, at, by) {
  const rows = ledger.all();
  const row = {
    id: store.nextId('ledger', 'LDG-'),
    seq: rows.reduce((n, r) => Math.max(n, Number(r.seq) || 0), 0) + 1,
    at,
    by,
    patientMrn: tx.patientMrn,
    encounterNo: tx.encounterNo || null,
    type: tx.type,
    amount: cents(tx.amount),
    side: tx.side || 'patient',
    detail: tx.detail || {},
    reversesTxId: tx.reversesTxId || null,
    reason: tx.reason || null,
    status: 'Posted',
  };
  rows.push(row);
  return row;
}

// --- internals -------------------------------------------------------------------------------

const LABELS = { Denial: 'Denial', ClaimResidual: 'Claim residual', PatientBalance: 'Patient balance', AgedItem: 'Aged item' };
const labelOf = (kind) => LABELS[kind] || kind;
const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;

function ago(days, hour = 10) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 12 + (days % 40), 0, 0);
  return d.toISOString();
}

function log(row, action, details, at, by) {
  audit.all().push({ id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: row.id, action, details, user: by, at });
}
