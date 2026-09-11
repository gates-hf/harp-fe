// Seed — root-cause cases (amendment 37, Defensio F2). Hand-written intents
// driven through the repository's own writes with the dates the work happened
// on, so a seeded conclusion retagged its denials the way a live one does and
// a seeded trail reads as the register wrote it. Every denial is found on the
// register by rule — its cause, its status, its payer, the visit behind it —
// never by number, since a reset may deal the ids in another order; the
// evidence a causer is named on is found the same way, on the audit trail
// the other registers wrote. This file imports nothing from data/: the
// repository hands `buildRcaCases` its own API.
//
// Six cases. Two older ones, closed, each naming a person, exist because an
// accountability case has to hang off a concluded individual finding and the
// amendment asks for three of those in three states; the four it names are
// the Open amount case, the In-analysis repeat cluster, the Concluded
// individual case on the recode denial (the one denial with a chart and a
// coder behind it) and the Closed systemic case whose gap is a row on a
// Pactum pre-authorisation matrix. A seventh opens on load: the trigger
// engine finds the recovered $614 denial nobody cased and opens it.

const CODER = 'coder';           // Tarek Solh — the demo's RCM coder
const CMO = 'exec';              // Georges Khoury
const SUPERVISOR = 'ST-0005';    // Nour Khalil, never signs in
const REGISTRAR = 'ST-0003';     // Layal Karam
const CLERK = 'ST-0001';         // Rima Nassar
const ER_CODER = 'CD-0002';      // Rita Saba

export const INTENTS = [
  // Closed, individual: the cover had lapsed and nobody had checked — the appeal was lost, the registrar was named.
  { key: 'closed-registration', trigger: 'manual', openedDaysAgo: 34, by: CMO, analystId: CODER,
    detail: 'Cover lapsed on the date of service and the visit was registered as insured — raised after the appeal was lost',
    find: [{ rootCauseId: 'RC-03', status: 'Lost' }],
    analysis: { daysAgo: 30,
      problem: 'A visit was registered under a policy that had lapsed eleven days earlier; the fund refused the claim (CO-27) and the appeal on the renewal was lost.',
      whys: [
        { why: 'Why was the claim refused?', because: 'The policy on file had expired before the date of service.' },
        { why: 'Why was the visit registered under it?', because: 'The registrar activated the visit from the card on file without running an eligibility check.' },
        { why: 'Why was no check run?', because: 'The check was optional at the desk for a returning patient; nothing refused the activation without one.' },
      ],
      confirmedRootCause: 'RC-04', causeNature: 'individual', configGap: { present: false, target: '', note: '' } },
    causer: { daysAgo: 29, personId: REGISTRAR, roleInFailure: 'Registered the visit as insured without running the eligibility check',
      evidence: [{ entity: 'denials', self: true, action: 'Created' }, { entity: 'denials', self: true, action: 'Lost' }],
      analystNote: 'The card was eleven days out of date; a check would have refused the cover and the visit would have opened self-pay or on the renewal.' },
    concludedDaysAgo: 28, closedDaysAgo: 12, closeNote: 'Eligibility gate verified at the desk; the warning stands after review.' },

  // Closed, individual: the ministry's window missed — the claim sat on a clerk's desk; a deduction was recommended and sent to HR.
  { key: 'closed-filing', trigger: 'manual', openedDaysAgo: 30, by: CMO, analystId: SUPERVISOR,
    detail: 'Filed nine days past the ministry’s sixty-day window and written off',
    find: [{ rootCauseId: 'RC-16', status: 'Written Off' }],
    analysis: { daysAgo: 27,
      problem: 'The claim reached the ministry sixty-nine days after the date of service; the window is sixty, so it was refused outright (CO-29) and the amount was written off.',
      whys: [
        { why: 'Why was the claim filed late?', because: 'It waited in the manual batch pile for three weeks after it was finalized.' },
        { why: 'Why did it wait?', because: 'The clerk building the ministry batch held it back for a signed discharge summary that was already on the claim.' },
        { why: 'Why was the summary not seen?', because: 'The attachment list was read off the paper file rather than the claim page.' },
      ],
      confirmedRootCause: 'RC-16', causeNature: 'individual', configGap: { present: false, target: '', note: '' } },
    causer: { daysAgo: 26, personId: CLERK, roleInFailure: 'Held a finalized claim out of the ministry batch past the filing window',
      evidence: [{ entity: 'denials', self: true, action: 'Created' }, { entity: 'denials', self: true, action: 'Triaged' }],
      analystNote: 'The summary was attached on the claim eight days before the batch went out; the paper file was what was checked.' },
    concludedDaysAgo: 24, closedDaysAgo: 10, closeNote: 'Filing-deadline report in place and verified; the deduction is with HR.' },

  // Closed, systemic: a scan done without an approval — the matrix flagged the category above a price but not the item, and the desk never saw it.
  { key: 'closed-preauth-matrix', trigger: 'manual', openedDaysAgo: 26, by: CMO, analystId: CODER,
    detail: 'Radiology done without a pre-authorisation the contract required — the requirement never reached the desk',
    find: [{ rootCauseId: 'RC-05', route: 'AuthRework' }],
    analysis: { daysAgo: 22,
      problem: 'A contrast CT was performed without the fund’s approval; the contract requires one on radiology above $300, the claim was refused (CO-197) and a retrospective request had to be drafted.',
      whys: [
        { why: 'Why was no approval requested?', because: 'The clearance checklist did not list the scan as needing one.' },
        { why: 'Why did the checklist miss it?', because: 'The pre-authorisation matrix flags Radiology above a threshold, and the anticipated services carried no price at the time of the check.' },
        { why: 'Why did the services carry no price?', because: 'No item-level row named the scan, so the threshold rule had nothing to compare until the charge was captured — after the scan.' },
      ],
      confirmedRootCause: 'RC-05', causeNature: 'systemic',
      configGap: { present: true, target: 'contract-preauth', note: 'Add an item-level Yes row for CT chest with contrast on the NSSF matrix, so the requirement is read off the item and not off a price the check does not yet know.' } },
    concludedDaysAgo: 20, closedDaysAgo: 4, closeNote: 'Matrix row added and verified on a fresh check; the requirement now shows at registration.' },

  // Concluded, individual: the recode denial — the one with a coded chart behind it — and the coder who left the principal unspecified.
  { key: 'concluded-recode', trigger: 'manual', openedDaysAgo: 5, by: CMO, analystId: SUPERVISOR,
    detail: 'Unspecified principal diagnosis on a coded chart — refused as inconsistent with the procedure',
    find: [{ rootCauseId: 'RC-09', encounter: true }],
    analysis: { daysAgo: 4,
      problem: 'The emergency visit was coded with R07.9 (chest pain, unspecified) as the principal diagnosis while the note names the finding; the fund refused the procedure as inconsistent with it (CO-4).',
      whys: [
        { why: 'Why was the procedure refused?', because: 'The principal diagnosis was unspecified and the procedure code does not sit under it.' },
        { why: 'Why was an unspecified code used?', because: 'The chart was coded from the triage sheet; the physician’s note with the finding was on the second document.' },
        { why: 'Why was the second document not read?', because: 'The coder marked the chart coded under the emergency backlog without opening every document.' },
      ],
      confirmedRootCause: 'RC-09', causeNature: 'individual', configGap: { present: false, target: '', note: '' } },
    causer: { daysAgo: 3, personId: ER_CODER, roleInFailure: 'Marked the chart coded with an unspecified principal diagnosis the note contradicts',
      evidence: [{ entity: 'coding', encounter: true, action: 'Draft saved' }, { entity: 'coding', encounter: true, action: 'Marked coded' }],
      analystNote: 'Both entries are the coder’s own — the draft and the mark — on a chart whose second document names the finding. The recode request is open on the chart.' },
    concludedDaysAgo: 3 },

  // In analysis, repeat: the same cause four times in a month — the whys are started and no cause is confirmed yet; six days past its target.
  { key: 'repeat-medical-necessity', trigger: 'repeat', openedDaysAgo: 20, by: 'System', analystId: CODER, clusterKey: 'RC-17|Payer',
    detail: 'Medical necessity disputed by the payer (Payer) 3 times in 90 days — at or above 3',
    find: [{ rootCauseId: 'RC-17', many: 3 }],
    analysis: { daysAgo: 15,
      problem: 'Three payers have refused a consultation, an admission and a test as not medically necessary inside a month; each was appealed on its own and none of the refusals reads the same protocol.',
      whys: [
        { why: 'Why were the services refused?', because: 'Each payer read its own necessity protocol and the claims carried no clinical justification beyond the diagnosis.' },
        { why: 'Why did the claims carry no justification?', because: '' },
      ],
      confirmedRootCause: '', causeNature: '', configGap: { present: false, target: '', note: '' } } },

  // Open, amount: a $585 denial the trigger opened the day after it landed; nobody has taken it.
  { key: 'open-amount', trigger: 'amount', openedDaysAgo: 9, by: 'System', analystId: null,
    detail: null,
    find: [{ rootCauseId: 'RC-17', route: 'PayerReconsideration', minAmount: 500 }] },
];

/**
 * Drives the repository's writes; returns the rows it created, keyed by
 * intent. `api` is { today, findDenials(rule, used), findEvidence(denial,
 * spec), targetFor(denial, name), create, assign, saveAnalysis, saveCauser,
 * conclude, close, has(key) }. A row already on the table (restored from the
 * session, or built on an earlier pass) is skipped; an intent whose denials
 * are not on file yet is skipped and tried again on the next pass.
 */
export function buildRcaCases(api) {
  const out = {};
  const used = new Set();
  for (const intent of INTENTS) {
    const existing = api.has(intent.key);
    if (existing) { out[intent.key] = existing; for (const id of existing.denialIds) used.add(id); continue; }
    const denials = intent.find.flatMap((rule) => api.findDenials(rule, used));
    const want = intent.find.reduce((n, r) => n + (r.many || 1), 0);
    if (denials.length < want) { console.info('[rca seed] waiting for denials for', intent.key); continue; }
    for (const d of denials) used.add(d.id);
    const at = (n, hour = 10) => `${daysAgo(api.today, n)}T${String(hour).padStart(2, '0')}:20:00.000Z`;
    const first = denials[0];
    const row = api.create({
      trigger: intent.trigger, denialIds: denials.map((d) => d.id), detail: intent.detail, analystId: intent.analystId,
      clusterKey: intent.clusterKey || null, seedKey: intent.key,
    }, { at: at(intent.openedDaysAgo, 9), by: intent.by });
    if (!row || row.error) { console.warn('[rca seed] create refused', intent.key, row?.error); continue; }
    out[intent.key] = row;
    const a = intent.analysis;
    if (a) {
      const gap = a.configGap?.present ? { ...a.configGap, target: api.targetFor(first, a.configGap.target) } : a.configGap;
      const r = api.saveAnalysis(row.id, { ...a, configGap: gap }, { at: at(a.daysAgo, 11), by: intent.analystId });
      if (r?.error) console.warn('[rca seed] analysis refused', intent.key, r.error);
    }
    const c = intent.causer;
    if (c) {
      const evidenceRefs = c.evidence.map((spec) => api.findEvidence(first, spec)).filter(Boolean);
      const r = api.saveCauser(row.id, { personId: c.personId, roleInFailure: c.roleInFailure, evidenceRefs, analystNote: c.analystNote }, { at: at(c.daysAgo, 14), by: intent.analystId });
      if (r?.error) console.warn('[rca seed] causer refused', intent.key, r.error);
    }
    // Actions are raised before the conclusion, since a case does not conclude without one.
    api.actionsFor?.(intent.key, row, { at, by: intent.analystId });
    if (intent.concludedDaysAgo != null) {
      const r = api.conclude(row.id, { at: at(intent.concludedDaysAgo, 16), by: intent.analystId });
      if (r?.error) console.warn('[rca seed] conclude refused', intent.key, r.error);
    }
    api.accountabilityFor?.(intent.key, row, { at, by: intent.analystId });
    api.verifyFor?.(intent.key, row, { at });
    if (intent.closedDaysAgo != null) {
      const r = api.close(row.id, { note: intent.closeNote || '' }, { at: at(intent.closedDaysAgo, 17), by: intent.analystId });
      if (r?.error) console.warn('[rca seed] close refused', intent.key, r.error);
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

export const daysAgo = (today, n) => daysAfter(today, -n);
