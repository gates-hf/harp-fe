// Seed — denials (amendments 29 and 31; re-tagged by 36 for Defensio's
// one-pass triage). Two things live here. The catalogue:
// the payer's reason codes and how each reads back into the seven denial
// reasons Pactum's Performance ranks, so a line denied CO-197 on a remittance
// counts as "Prior auth missing" on the payer table — written by amendment 29
// and unchanged. And the intents (amendment 31): the denials the triage
// worklist opens on, each one a generated Denied claim (data/seed/claims.js)
// the payer's answer is written against, driven through the repository's own
// writes with the dates the events happened on, so a seeded route created the
// hand-off or the follow-up it names and a seeded resolution moved the money
// the way a live one does.
//
// A29's remittance seed still creates its own denial by posting (the Bupa
// CO-197); the intents below sit beside it and never touch an in-flight claim,
// which is A29's pool. This file imports nothing from data/: the repository
// hands `buildDenials` its own API, the way data/seed/remittances.js is
// driven, so data/engines/denial-router.js can read the catalogue and stay a
// leaf.
//
// Amendment 36 re-tags the intents for the one-pass triage (a category, a
// tier and a separation on each triaged row — most read off the root cause,
// the rest named here) and adds the states Defensio's worklist opens on: a
// recode route on a claim assembled from a visit (the only kind with a chart
// to send back), an appeal case, a write-off request raised through the
// route, and two denials that were never denials — a contractual adjustment
// and a TPA fee, reclassified out. Two payer codes join the catalogue for
// them.

export const DENIAL_CODES = [
  { code: 'CO-197', label: 'Pre-authorisation absent', reason: 'PA_MISSING' },
  { code: 'CO-50', label: 'Not deemed medically necessary', reason: 'COV_RULE' },
  { code: 'CO-96', label: 'Non-covered charge', reason: 'COV_RULE' },
  { code: 'CO-16', label: 'Claim lacks information or documentation', reason: 'DOC_MISSING' },
  { code: 'CO-29', label: 'Filing time limit expired', reason: 'LATE_FILING' },
  { code: 'CO-4', label: 'Procedure code inconsistent with the diagnosis', reason: 'CODE_MISMATCH' },
  { code: 'CO-27', label: 'Expenses incurred after coverage ended', reason: 'MEMBER_INELIG' },
  { code: 'CO-18', label: 'Duplicate claim or service', reason: 'DUPLICATE' },
  // A36 — the two codes that usually say the money was never a denial.
  { code: 'CO-45', label: 'Charge exceeds the fee schedule or contracted rate', reason: 'COV_RULE' },
  { code: 'OA-23', label: 'Adjusted by the third-party administrator', reason: 'COV_RULE' },
];

export const denialCode = (code) => DENIAL_CODES.find((c) => c.code === code) || null;

export const denialCodeLabel = (code) => (denialCode(code) ? `${code} · ${denialCode(code).label}` : code || '—');

/** The Performance reason a payer's code reads as; an unknown code is a coverage rule trip. */
export const reasonOf = (code) => denialCode(code)?.reason || 'COV_RULE';

/** The payer's code that reads as a Performance reason — the first that does. */
export const codeFor = (reasonCode) => DENIAL_CODES.find((c) => c.reason === reasonCode)?.code || 'CO-50';

// --- intents ----------------------------------------------------------------------

const CODER = 'Tarek Solh';
const CMO = 'Georges Khoury';

/**
 * One intent per denial, oldest first. `payerId` and `reason` pick the
 * payer's largest generated Denied claim with that Performance reason (or,
 * when it has none left, its largest Denied claim, whose reason is restamped
 * from the payer's code — the register is what says why a claim was denied),
 * never reused; `encounterNo` (A36) names the visit whose primary claim the
 * denial lands on instead — a claim assembled from a visit, which the seed
 * submits and denies first so the denial has a chart behind it; `daysAgo` is when the denial landed (after the claim was submitted,
 * whatever the day says); `code` is the payer's own code; the rest is what
 * the desk did about it, in order. A triage may name `tier` and `category`
 * where the root cause's own reading is not the desk's; `separation` in
 * place of a class reclassifies the denial out; `route.deferred` waits for
 * the peer register the route writes to.
 */
export const INTENTS = [
  // Recovered: the fund refused a consultation as unnecessary, Defensio won it back whole.
  { payerId: 'PY-0001', reason: 'COV_RULE', code: 'CO-50', daysAgo: 48, by: CODER,
    triage: { rootCauseId: 'RC-15', class: 'Appealable', tier: 'Hard', category: 'Clinical', daysAgo: 46 }, route: { kind: 'DefensioHandoff', daysAgo: 46 },
    outcome: { kind: 'handoff', result: 'Won', daysAgo: 20 } },
  // Write-off candidate: filed too late for the ministry's window — triaged, left for the write-off desk (A33's seed posts it).
  { payerId: 'PY-0002', reason: 'LATE_FILING', code: 'CO-29', daysAgo: 45, by: CODER,
    triage: { rootCauseId: 'RC-16', class: 'Write-Off Candidate', daysAgo: 44, note: 'Sixty-day window missed by nine days — nothing to appeal' } },
  // Deadline passed: a duplicate nobody looked at for six weeks.
  { payerId: 'PY-0007', reason: 'DUPLICATE', code: 'CO-18', daysAgo: 40, by: CODER },
  // Lost: Defensio appealed the lapsed cover and the payer held.
  { payerId: 'PY-0003', reason: 'MEMBER_INELIG', code: 'CO-27', daysAgo: 38, by: CODER,
    triage: { rootCauseId: 'RC-03', class: 'Appealable', daysAgo: 37, note: 'The policy shows a renewal — worth an appeal' },
    route: { kind: 'DefensioHandoff', daysAgo: 37 }, outcome: { kind: 'handoff', result: 'Lost', daysAgo: 12 } },
  // Manually resolved: the payer upheld its reading on the phone and the amount is not worth Defensio's time.
  { payerId: 'PY-0006', reason: 'COV_RULE', code: 'CO-50', daysAgo: 33, by: CODER,
    triage: { rootCauseId: 'RC-17', class: 'Appealable', daysAgo: 32 },
    outcome: { kind: 'manual', daysAgo: 31, by: CMO, result: 'lost', reason: 'Payer upheld the refusal on the phone — below the threshold for an appeal' } },
  // Partially recovered: the cover was renewed mid-month, Defensio settled the covered days, the rest is a new denial.
  { payerId: 'PY-0009', reason: 'MEMBER_INELIG', code: 'CO-27', daysAgo: 30, by: CODER,
    triage: { rootCauseId: 'RC-03', class: 'Appealable', daysAgo: 29 }, route: { kind: 'DefensioHandoff', daysAgo: 29 },
    outcome: { kind: 'handoff', result: 'Settled', share: 0.5, daysAgo: 8 } },
  // In progress: hand-off with Defensio, appeal lodged.
  { payerId: 'PY-0003', reason: 'COV_RULE', code: 'CO-50', daysAgo: 24, by: CODER,
    triage: { rootCauseId: 'RC-17', class: 'Appealable', daysAgo: 23 }, route: { kind: 'DefensioHandoff', daysAgo: 23 }, progress: 'In appeal' },
  // In progress: the documentation was fixed and the claim went back out on its next cycle.
  { payerId: 'PY-0001', reason: 'DOC_MISSING', code: 'CO-16', daysAgo: 16, by: CODER,
    triage: { rootCauseId: 'RC-12', class: 'Corrigible', daysAgo: 15 }, route: { kind: 'Refresh', daysAgo: 15 } },
  // Corrigible, routed to auth rework: the scan was done without an approval; a request is drafted after the fact.
  { payerId: 'PY-0001', reason: 'PA_MISSING', code: 'CO-197', daysAgo: 14, by: CODER,
    triage: { rootCauseId: 'RC-05', class: 'Corrigible', tier: 'Soft', daysAgo: 13, note: 'The fund accepts a retrospective request inside thirty days — a correction, not an appeal' },
    route: { kind: 'AuthRework', daysAgo: 13 } },
  // Appealable, with an appeal case opened (a stub until amendment 38): the ministry's own protocol names the test.
  { payerId: 'PY-0002', reason: 'COV_RULE', code: 'CO-50', daysAgo: 12, by: CODER, assignee: CODER,
    triage: { rootCauseId: 'RC-17', class: 'Appealable', daysAgo: 11, note: 'The ministry’s own protocol names the test — appeal on the protocol' },
    route: { kind: 'Appeal', daysAgo: 10 } },
  // Routed: the fund disputes the coding; asked to reconsider.
  { payerId: 'PY-0001', reason: 'CODE_MISMATCH', code: 'CO-4', daysAgo: 10, by: CODER,
    triage: { rootCauseId: 'RC-17', class: 'Appealable', daysAgo: 9 }, route: { kind: 'PayerReconsideration', daysAgo: 9 } },
  // Write-off candidate, routed: the line was captured twice; the second one has nothing to appeal. The request is raised once the write-off register has seeded.
  { payerId: 'PY-0001', reason: 'DUPLICATE', code: 'CO-18', daysAgo: 8, by: CODER,
    triage: { rootCauseId: 'RC-10', class: 'Write-Off Candidate', daysAgo: 7, note: 'Second capture of one dressing — the first was paid' },
    route: { kind: 'WriteOff', daysAgo: 6, deferred: true } },
  // Untriaged, five days from the ministry's sixty-day deadline — the amber countdown.
  { payerId: 'PY-0002', reason: 'COV_RULE', code: 'CO-96', daysAgo: 55, by: CODER },
  // Corrigible, routed to recode: the oncology emergency visit's claim, refused on an unspecified principal
  // diagnosis — the one claim with a coded chart behind it, so the route reaches the coder.
  { encounterNo: 'ENC-2026-000401', submittedAt: 19, reason: 'CODE_MISMATCH', code: 'CO-4', daysAgo: 5, by: CODER,
    triage: { rootCauseId: 'RC-09', class: 'Corrigible', daysAgo: 4, note: 'R07.9 is unspecified chest pain; the note supports a specific code' },
    route: { kind: 'Recode', daysAgo: 4 } },
  // Untriaged, this week.
  { payerId: 'PY-0001', reason: 'PA_MISSING', code: 'CO-197', daysAgo: 3, by: CODER },
  { payerId: 'PY-0003', reason: 'DOC_MISSING', code: 'CO-16', daysAgo: 2, by: CODER },
  // Reclassified, contractual: Bankers paid the line at its fee schedule and the balance is the contract's, not a denial.
  { payerId: 'PY-0007', reason: 'COV_RULE', code: 'CO-45', daysAgo: 9, by: CODER,
    triage: { separation: 'Contractual', category: 'Administrative', tier: 'Soft', daysAgo: 7,
      note: 'Annex B prices the consultation at the fee-schedule rate; the difference is a contractual adjustment' } },
  // Reclassified, TPA fee: the administrator withheld its cut from Arope's remittance — accrued, not pursued.
  { payerId: 'PY-0011', reason: 'COV_RULE', code: 'OA-23', daysAgo: 6, by: CODER,
    triage: { separation: 'TPA', category: 'Administrative', tier: 'Underpayment', daysAgo: 5,
      note: 'GlobeMed’s 4% administration fee under the Arope agreement, withheld on the remittance' } },
];

/**
 * Drives the repository's own writes; returns the rows it created. `api` is
 * { pickClaim(payerId, reason, used), denyClaim(claimNo, …), create, triage,
 *   reclassify, route, defer, deferIntent, assign, resolveFromHandoff,
 *   resolveWrittenOff, resolveManual, handoffStatus, today }.
 *
 * An intent that names a visit (`encounterNo`) is handed to
 * `api.deferIntent` rather than built here: the assembly claims are
 * seeded once the claim repository's peers settle, after this register's
 * first read, so the repository builds those intents through buildIntent()
 * when they exist — always after the generated ones, so the ids are the
 * same whatever order the registers loaded in.
 */
export function buildDenials(api) {
  const used = new Set();
  const out = [];
  for (const intent of INTENTS) {
    if (intent.encounterNo) { api.deferIntent(intent); continue; }
    const row = buildIntent(api, intent, used);
    if (row) out.push(row);
  }
  return out;
}

/** One intent through the repository's writes — the row, or null when its claim is not on file. */
export function buildIntent(api, intent, used = new Set()) {
  const claim = intent.encounterNo
    ? api.denyClaim(intent.encounterNo, {
      reasonCode: intent.reason, by: intent.by,
      submittedAt: daysAgo(api.today, intent.submittedAt ?? intent.daysAgo + 14), deniedAt: daysAgo(api.today, intent.daysAgo),
    })
    : api.pickClaim(intent.payerId, intent.reason, used);
  if (!claim) { console.warn('[denials seed] no denied claim for', intent.encounterNo || intent.payerId, intent.reason); return null; }
  used.add(claim.claimNo);
  const landed = later(daysAgo(api.today, intent.daysAgo), daysAfter(claim.submittedAt, 1));
  const at = (n, hour = 10) => `${later(daysAgo(api.today, n), landed)}T${String(hour).padStart(2, '0')}:15:00.000Z`;
  const whole = Boolean(intent.encounterNo);
  const line = whole ? null : claim.lines[0];
  const row = api.create({
    claimNo: claim.claimNo, claimId: claim.id, lineId: line?.id || null, remittanceNo: null, payerId: claim.payerId,
    code: intent.code, amount: line?.payerShare ?? claim.totals.payerShare, scope: whole ? 'Claim' : 'Line',
    at: `${landed}T09:05:00.000Z`, by: intent.by,
  });
  if (!row) return null;
  if (intent.assignee) api.assign(row.id, intent.assignee, { at: at(intent.triage?.daysAgo ?? intent.daysAgo, 9), by: intent.by });
  if (intent.triage) {
    const t = intent.triage;
    const r = api.triage(row.id, {
      class: t.class, rootCauseId: t.rootCauseId, note: t.note || '', category: t.category || null, tier: t.tier || null,
      separation: t.separation || 'True',
    }, { at: at(t.daysAgo, 11), by: intent.by });
    if (r?.error) console.warn('[denials seed] triage refused', row.id, r.error);
  }
  if (intent.route) {
    if (intent.route.deferred) api.defer(row.id, intent.route.kind, { at: at(intent.route.daysAgo, 12), by: intent.by });
    else {
      const r = api.route(row.id, intent.route.kind, { reason: null }, { at: at(intent.route.daysAgo, 12), by: intent.by });
      if (r?.error) console.warn('[denials seed] route refused', row.id, intent.route.kind, r.error);
    }
    if (intent.progress) api.handoffStatus(row.id, intent.progress, null, { at: at(intent.route.daysAgo - 2, 14), by: intent.by });
  }
  const o = intent.outcome;
  if (o?.kind === 'handoff') {
    const amount = o.result === 'Settled' ? Math.round(row.amounts.denied * (o.share || 0.5) * 100) / 100 : o.result === 'Won' ? row.amounts.denied : 0;
    api.handoffStatus(row.id, o.result === 'Lost' ? 'In appeal' : 'Recovered', amount, { at: at(o.daysAgo, 15), by: o.by || intent.by });
    api.resolveFromHandoff(row.id, o.result, { at: at(o.daysAgo, 15), by: o.by || intent.by });
  } else if (o?.kind === 'writtenOff') {
    api.resolveWrittenOff(row.id, null, row.amounts.open, { at: at(o.daysAgo, 16), by: o.by || intent.by, reason: o.reason });
  } else if (o?.kind === 'manual') {
    api.resolveManual(row.id, { result: o.result, reason: o.reason }, { at: at(o.daysAgo, 16), by: o.by || intent.by });
  }
  return row;
}

// --- internals -----------------------------------------------------------------------

const daysAfter = (isoDate, n) => {
  const d = new Date(`${String(isoDate || '').slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const daysAgo = (today, n) => daysAfter(today, -n);

const later = (a, b) => (a > b ? a : b);
