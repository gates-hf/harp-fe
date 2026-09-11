// Seed — appeal tracking & resolution (amendment 39). Four appeal cases
// carried past submission to the four answers a payer gives, written as
// intents and driven through the repositories' own writes with the dates the
// events happened on — a denial created on a generated Denied claim, triaged
// and routed to an appeal (which opens the case), the case submitted (the
// four fields amendment 38 writes, flat and nested), then followed up,
// marked under review, decided, disposed of, paid and closed as each intent
// says. The conceded halves are paid through Claima's own remittance entry
// and posting, so the recovery is matched by the hook that matches a live
// one, and the remittance is on the workbench like any other. Amendment 38's
// own Submitted case is left Submitted with its response deadline twelve
// days out.
//
// Claims are picked by rule, never by number: the largest Denied generated
// claim of the first payer in the list with one free — no denial on file, no
// batch, no remittance, no assembly kind — so the ids are the same whatever
// order the registers load in, and nothing another seed wrote a trail on is
// touched.

import * as remittances from '../repositories/remittances.js';

const CODER = 'Tarek Solh';
const CMO = 'Georges Khoury';

/**
 * One intent per case. Days are before today: `landed` the denial, `submitted`
 * the appeal, `review` the payer's acknowledgment (optional), `decided` the
 * answer, `paid` the remittance for the conceded share (optional), `closed`.
 */
export const INTENTS = [
  // Won outright: the fund accepted medical necessity on the operative note. Nothing has been paid yet — twenty days waiting.
  { key: 'won', payers: ['PY-0001', 'PY-0006', 'PY-0003'], code: 'CO-50', rootCauseId: 'RC-15',
    landed: 44, submitted: 38, review: 30, decided: 20,
    method: 'Portal', reference: 'APL-2026-0912', reviewRef: 'NSSF-RV-44871',
    outcome: { type: 'Won', share: 1, payerRef: 'DEC-2026-3310', rationale: { code: 'CO-50', text: 'Medical necessity accepted on review of the operative note; the line is payable at the contracted rate.' }, document: 'nssf-decision-3310.pdf' },
    followUps: [
      { daysAgo: 12, method: 'Phone', contact: 'Fund appeals desk', note: 'Decision letter promised inside the week', nextDue: 5 },
      { daysAgo: 5, method: 'Email', contact: 'appeals desk', note: 'Remittance date requested — the decision names no payment run', nextDue: -2 },
    ] },
  // Partially won: two of the four disputed days conceded, paid nine days on; the other two go to the write-off loop.
  { key: 'partial', payers: ['PY-0003', 'PY-0002', 'PY-0009'], code: 'CO-50', rootCauseId: 'RC-17',
    landed: 36, submitted: 31, decided: 12, paid: 5,
    method: 'Email', reference: 'APL-2026-0931',
    outcome: { type: 'PartiallyWon', share: 0.5, payerRef: 'DEC-2026-3342', rationale: { code: 'CO-50', text: 'The first two days of the stay are accepted as necessary; the last two are held as observation the plan does not cover.' },
      disposition: 'writeOffLoop', reason: 'The fund holds the last two days as observation — not worth a second round', document: 'decision-3342.pdf' },
    remittance: { reference: 'APL-PAY-0931', method: 'EFT', adjCode: 'CO-50' } },
  // Lost, escalated: the ministry refused on protocol; the protocol names the test, so level 2 is raised on it.
  { key: 'lost', payers: ['PY-0002', 'PY-0007', 'PY-0006'], code: 'CO-50', rootCauseId: 'RC-15',
    landed: 40, submitted: 34, review: 25, decided: 8, disposed: 7,
    method: 'Courier', reference: 'APL-2026-0925', reviewRef: 'MOPH-RV-2211',
    outcome: { type: 'Lost', share: 0, payerRef: 'DEC-2026-3355', rationale: { code: 'CO-50', text: 'The test is not on the ministry’s protocol for the admitting diagnosis.' }, document: 'moph-refusal-3355.pdf' },
    disposition: { kind: 'escalate', by: CMO, reason: 'The ministry’s own protocol names the test for this diagnosis — level 2 on the protocol, with the page cited' } },
  // Settled at sixty per cent to close the dispute; paid, accepted, closed.
  { key: 'settled', payers: ['PY-0007', 'PY-0009', 'PY-0011', 'PY-0001'], code: 'CO-50', rootCauseId: 'RC-15',
    landed: 50, submitted: 44, decided: 15, paid: 9, closed: 8,
    method: 'Portal', reference: 'APL-2026-0904',
    outcome: { type: 'Settled', share: 0.6, payerRef: 'DEC-2026-3298', rationale: { code: 'CO-45', text: 'Settled at sixty per cent of the disputed amount without admission; the balance is not pursued by either side.' },
      disposition: 'acceptWithReason', reason: 'Settled at sixty per cent to close the dispute — the remainder was conceded in the settlement', by: CMO, document: 'settlement-3298.pdf' },
    remittance: { reference: 'SETTLE-0904', method: 'Transfer', adjCode: 'CO-45' } },
];

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;
const daysAfter = (isoDate, n) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function buildAppealTracking(api) {
  const { today, appealCases, denials, claims, payers, audit, store } = api;
  const daysAgo = (n) => daysAfter(today, -n);
  const at = (n, hour = 10) => `${daysAgo(n)}T${String(hour).padStart(2, '0')}:15:00.000Z`;
  const used = new Set();

  for (const intent of INTENTS) {
    const claim = pickClaim(claims, denials, intent, used);
    if (!claim) { console.warn('[appeal-tracking seed] no free denied claim for', intent.key, intent.payers.join('/')); continue; }
    used.add(claim.claimNo);
    const line = claim.lines[0];
    claim.denialReasonCode = denials.reasonOf(intent.code);

    // The denial, its triage and the appeal route that opens the case.
    const denial = denials.create({
      claimNo: claim.claimNo, claimId: claim.id, lineId: line?.id || null, remittanceNo: null, payerId: claim.payerId,
      code: intent.code, amount: line?.payerShare ?? claim.totals.payerShare, scope: line ? 'Line' : 'Claim', at: at(intent.landed, 9), by: CODER,
    });
    const t = denials.triage(denial.id, { class: 'Appealable', rootCauseId: intent.rootCauseId, tier: 'Hard', category: 'Clinical', separation: 'True', assignee: CODER,
      note: intent.key === 'lost' ? 'The ministry’s protocol names the test — appeal on the protocol' : 'Worth an appeal on the record' }, { at: at(intent.landed - 1, 11), by: CODER });
    if (t?.error) { console.warn('[appeal-tracking seed] triage refused', denial.id, t.error); continue; }
    const r = denials.route(denial.id, 'Appeal', {}, { at: at(intent.landed - 2, 12), by: CODER });
    if (r?.error || !r?.route?.ref) { console.warn('[appeal-tracking seed] route refused', denial.id, r?.error); continue; }
    const c = appealCases.get(r.route.ref);
    if (!c) continue;
    c.seedTag = 'A39';

    // Submitted — the four fields amendment 38 writes, flat and nested, and its trail line.
    const submittedAt = at(intent.submitted, 14);
    Object.assign(c, { status: 'Submitted', submittedAt: daysAgo(intent.submitted), method: intent.method, reference: intent.reference, packageRef: `PKG-${c.id}-v1`, updatedAt: submittedAt });
    c.submission = { method: intent.method, reference: intent.reference, submittedAt: daysAgo(intent.submitted), lateOverride: null, packageRef: c.packageRef };
    audit.all().push({ id: store.nextId('audit', 'AU-'), entity: 'appealCases', entityId: c.id, action: 'Submitted',
      details: `${intent.method} · ref ${intent.reference} · ${c.packageRef}`, user: CODER, at: submittedAt });

    for (const f of intent.followUps || []) {
      api.logFollowUp(c.id, { method: f.method, contact: f.contact, note: f.note, nextDue: daysAgo(f.nextDue) }, { at: at(f.daysAgo, 11), by: CODER, commit: false });
    }
    if (intent.review) api.setUnderReview(c.id, { ref: intent.reviewRef, at: at(intent.review, 15), by: CODER, commit: false });

    // The decision, allocated over the one denial the case disputes.
    const o = intent.outcome;
    const disputed = cents(c.disputedAmount ?? c.amount);
    const conceded = cents(disputed * o.share);
    const lost = cents(disputed - conceded);
    const captured = api.captureOutcome(c.id, {
      type: o.type, decisionDate: daysAgo(intent.decided), payerRef: o.payerRef, concededTotal: conceded,
      allocations: [{ denialId: denial.id, concededShare: conceded, lostShare: lost, lostDisposition: o.disposition || null, reason: o.reason || '' }],
      payerRationale: o.rationale, documentRef: o.document ? { fileName: o.document, size: 184320 } : null,
    }, { at: at(intent.decided, 16), by: o.by || CODER, commit: false });
    if (captured?.error) { console.warn('[appeal-tracking seed] outcome refused', c.id, captured.error); continue; }

    if (intent.disposition) {
      const d = api.setDisposition(c.id, denial.id, intent.disposition.kind, { reason: intent.disposition.reason }, { at: at(intent.disposed, 10), by: intent.disposition.by || CODER, commit: false });
      if (d?.error) console.warn('[appeal-tracking seed] disposition refused', c.id, d.error);
    }

    // The conceded share paid through Claima's own remittance entry — the hook matches it.
    if (intent.remittance && conceded > 0) {
      const payer = payers.get(claim.payerId);
      const made = remittances.createManual({ payerId: claim.payerId, payment: { reference: intent.remittance.reference, date: daysAgo(intent.paid), method: intent.remittance.method, total: conceded }, at: at(intent.paid, 9), by: CODER });
      if (made.error) { console.warn('[appeal-tracking seed] remittance refused', made.error); continue; }
      const added = remittances.addClaim(made.remittance.remittanceNo, claim.claimNo, { payerClaimRef: `${payer?.id || 'PY'}-${o.payerRef}` });
      if (added.error) { console.warn('[appeal-tracking seed] claim refused on remittance', added.error); continue; }
      remittances.updateLines(made.remittance.remittanceNo, claim.claimNo, [{ claimLineId: line.id, paid: conceded, adjustment: lost, adjCode: intent.remittance.adjCode, denied: 0 }]);
      const posted = remittances.post(made.remittance.remittanceNo, { at: at(intent.paid, 10), by: CODER });
      if (posted.error) console.warn('[appeal-tracking seed] posting refused', posted.error);
    }
    if (intent.closed) {
      const closed = api.closeCase(c.id, { reason: 'Settlement paid in full' }, { at: at(intent.closed, 9), by: CMO, commit: false });
      if (closed?.error) console.warn('[appeal-tracking seed] close refused', c.id, closed.error);
    }
  }
  store.commit('appealTracking.seed');
}

/** Amendment 38's Submitted case: left as it is, the payer's answer due twelve days out. Returns whether one was found. */
export function stampSubmittedCase(api) {
  const { today, appealCases } = api;
  const c = appealCases.all().find((x) => x.status === 'Submitted' && x.seedTag !== 'A39' && !x.tracking?.responseDeadline);
  if (!c) return false;
  c.tracking = { ...(c.tracking || {}), responseDeadline: daysAfter(today, 12), followUps: c.tracking?.followUps || [], underReview: c.tracking?.underReview || null };
  return true;
}

/** The largest Denied generated claim of the first payer with one free — no denial, no batch, no remittance, no assembly kind. */
function pickClaim(claims, denials, intent, used) {
  for (const payerId of intent.payers) {
    const free = claims.all()
      .filter((c) => c.payerId === payerId && c.status === 'Denied' && !c.kind && !c.batchId && !c.remittanceId && !c.nullification
        && !used.has(c.claimNo) && (c.lines || []).length === 1 && !denials.byClaim(c.claimNo).length)
      .sort((a, b) => (b.totals?.payerShare || 0) - (a.totals?.payerShare || 0));
    if (free.length) return free[0];
  }
  return null;
}
