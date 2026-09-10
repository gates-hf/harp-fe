// Seed — denials (amendments 29 and 31). Two things live here. The catalogue:
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

export const DENIAL_CODES = [
  { code: 'CO-197', label: 'Pre-authorisation absent', reason: 'PA_MISSING' },
  { code: 'CO-50', label: 'Not deemed medically necessary', reason: 'COV_RULE' },
  { code: 'CO-96', label: 'Non-covered charge', reason: 'COV_RULE' },
  { code: 'CO-16', label: 'Claim lacks information or documentation', reason: 'DOC_MISSING' },
  { code: 'CO-29', label: 'Filing time limit expired', reason: 'LATE_FILING' },
  { code: 'CO-4', label: 'Procedure code inconsistent with the diagnosis', reason: 'CODE_MISMATCH' },
  { code: 'CO-27', label: 'Expenses incurred after coverage ended', reason: 'MEMBER_INELIG' },
  { code: 'CO-18', label: 'Duplicate claim or service', reason: 'DUPLICATE' },
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
 * never reused; `daysAgo` is when the denial landed (after the claim was
 * submitted, whatever the day says); `code` is the payer's own code; the rest
 * is what the desk did about it, in order.
 */
export const INTENTS = [
  // Recovered: the fund refused a consultation as unnecessary, Defensio won it back whole.
  { payerId: 'PY-0001', reason: 'COV_RULE', code: 'CO-50', daysAgo: 48, by: CODER,
    triage: { rootCauseId: 'RC-15', class: 'Appealable', daysAgo: 46 }, route: { kind: 'DefensioHandoff', daysAgo: 46 },
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
  // Routed: the scan was done without an approval; a request is drafted after the fact.
  { payerId: 'PY-0001', reason: 'PA_MISSING', code: 'CO-197', daysAgo: 14, by: CODER,
    triage: { rootCauseId: 'RC-05', class: 'Appealable', daysAgo: 13 }, route: { kind: 'AuthRework', daysAgo: 13 } },
  // Triaged and assigned, not yet routed.
  { payerId: 'PY-0002', reason: 'COV_RULE', code: 'CO-50', daysAgo: 12, by: CODER, assignee: CODER,
    triage: { rootCauseId: 'RC-17', class: 'Appealable', daysAgo: 11, note: 'The ministry’s own protocol names the test — ask it to reconsider' } },
  // Routed: the fund disputes the coding; asked to reconsider.
  { payerId: 'PY-0001', reason: 'CODE_MISMATCH', code: 'CO-4', daysAgo: 10, by: CODER,
    triage: { rootCauseId: 'RC-17', class: 'Appealable', daysAgo: 9 }, route: { kind: 'PayerReconsideration', daysAgo: 9 } },
  // Write-off candidate: the line was captured twice; the second one has nothing to appeal.
  { payerId: 'PY-0001', reason: 'DUPLICATE', code: 'CO-18', daysAgo: 8, by: CODER,
    triage: { rootCauseId: 'RC-10', class: 'Write-Off Candidate', daysAgo: 7, note: 'Second capture of one dressing — the first was paid' } },
  // Untriaged, five days from the ministry's sixty-day deadline — the amber countdown.
  { payerId: 'PY-0002', reason: 'COV_RULE', code: 'CO-96', daysAgo: 55, by: CODER },
  // Untriaged, this week.
  { payerId: 'PY-0001', reason: 'CODE_MISMATCH', code: 'CO-4', daysAgo: 5, by: CODER },
  { payerId: 'PY-0001', reason: 'PA_MISSING', code: 'CO-197', daysAgo: 3, by: CODER },
  { payerId: 'PY-0003', reason: 'DOC_MISSING', code: 'CO-16', daysAgo: 2, by: CODER },
];

/**
 * Drives the repository's own writes; returns the rows it created. `api` is
 * { pickClaim(payerId, reason, used), create, triage, route, assign,
 *   resolveFromHandoff, resolveWrittenOff, resolveManual, handoffStatus, today }.
 */
export function buildDenials(api) {
  const used = new Set();
  const out = [];
  for (const intent of INTENTS) {
    const claim = api.pickClaim(intent.payerId, intent.reason, used);
    if (!claim) { console.warn('[denials seed] no denied claim for', intent.payerId, intent.reason); continue; }
    used.add(claim.claimNo);
    const landed = later(daysAgo(api.today, intent.daysAgo), daysAfter(claim.submittedAt, 1));
    const at = (n, hour = 10) => `${later(daysAgo(api.today, n), landed)}T${String(hour).padStart(2, '0')}:15:00.000Z`;
    const line = claim.lines[0];
    const row = api.create({
      claimNo: claim.claimNo, claimId: claim.id, lineId: line?.id || null, remittanceNo: null, payerId: claim.payerId,
      code: intent.code, amount: line?.payerShare ?? claim.totals.payerShare, scope: 'Line',
      at: `${landed}T09:05:00.000Z`, by: intent.by,
    });
    if (!row) continue;
    out.push(row);
    if (intent.assignee) api.assign(row.id, intent.assignee, { at: at(intent.triage?.daysAgo ?? intent.daysAgo, 9), by: intent.by });
    if (intent.triage) {
      api.triage(row.id, { class: intent.triage.class, rootCauseId: intent.triage.rootCauseId, note: intent.triage.note || '' },
        { at: at(intent.triage.daysAgo, 11), by: intent.by });
    }
    if (intent.route) {
      api.route(row.id, intent.route.kind, { reason: null }, { at: at(intent.route.daysAgo, 12), by: intent.by });
      if (intent.progress) api.handoffStatus(row.id, intent.progress, null, { at: at(intent.route.daysAgo - 2, 14), by: intent.by });
    }
    const o = intent.outcome;
    if (!o) continue;
    if (o.kind === 'handoff') {
      const amount = o.result === 'Settled' ? Math.round(row.amounts.denied * (o.share || 0.5) * 100) / 100 : o.result === 'Won' ? row.amounts.denied : 0;
      api.handoffStatus(row.id, o.result === 'Lost' ? 'In appeal' : 'Recovered', amount, { at: at(o.daysAgo, 15), by: o.by || intent.by });
      api.resolveFromHandoff(row.id, o.result, { at: at(o.daysAgo, 15), by: o.by || intent.by });
    } else if (o.kind === 'writtenOff') {
      api.resolveWrittenOff(row.id, null, row.amounts.open, { at: at(o.daysAgo, 16), by: o.by || intent.by, reason: o.reason });
    } else if (o.kind === 'manual') {
      api.resolveManual(row.id, { result: o.result, reason: o.reason }, { at: at(o.daysAgo, 16), by: o.by || intent.by });
    }
  }
  return out;
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
