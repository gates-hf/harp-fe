// Seed — accountability cases (amendment 37, Defensio F2). Keyed on the
// root-cause case's seed key: what happened after each individual finding,
// in the order the register enforces — the response (or the window closing),
// the decision by somebody who did not analyse the case, the appeal and its
// review by somebody senior to the decider, the deduction on its way to HR.
// The root-cause register's builder drives these through
// data/repositories/accountability-cases.js once the case has concluded
// (which is what opens the accountability case) with the dates the events
// happened on. Imports nothing from data/.
//
// Three states: decided with a warning and the appeal upheld by the director;
// a deduction recommended and sent to HR, whose answer is still to come; and
// the coder's case opened three days ago, inside its response window.

const CMO = 'exec';              // Georges Khoury decides — never the analyst
const DIRECTOR = 'ST-0006';      // Samir Abou Khalil, senior to the CMO, reviews the appeal

export const INTENTS = {
  'closed-registration': {
    response: { daysAgo: 25, text: 'The patient is a regular and showed the same card as last time; I was not told the fund had lapsed it. I ran the check on the renewal the next day when the family brought it.' },
    decision: { daysAgo: 22, by: CMO, type: 'warning',
      rationale: 'The check takes a minute and the desk instruction is clear; the loss is the whole visit. A first finding — a warning, on the record.' },
    appeal: { daysAgo: 20, text: 'The instruction to check every returning patient was circulated after this visit, not before it; I ask that the warning be withdrawn.',
      review: { daysAgo: 15, by: DIRECTOR, outcome: 'Upheld',
        rationale: 'The instruction restated a rule that was already in the desk procedure; the warning stands, and the process action on the case is what changes for everybody.' } },
    closedDaysAgo: 12,
  },
  'closed-filing': {
    response: { daysAgo: 21, text: 'I held the claim for the signed summary because the paper file did not have it. I did not open the claim page to check the attachments.' },
    decision: { daysAgo: 18, by: CMO, type: 'deductionRecommendation', deduction: { amount: 50, basis: 'One-off; a share of the $360 written off, capped at the policy’s ceiling for a first finding' },
      rationale: 'The window was known, the document was on the claim, and $360 was written off for nothing. The policy allows a recommendation on a first finding at this size; HR decides whether it is applied.' },
    sentToHr: { daysAgo: 16, ref: 'HR-2026-0142' },
  },
  'concluded-recode': {
    // Opened by the conclusion three days ago; the window is still open and nothing has been said.
  },
};

/**
 * Drive one case's accountability through the repository. `api` is
 * { open, byCase, recordResponse, decide, fileAppeal, reviewAppeal, sendToHr,
 *   captureHrOutcome, close, nameOf(staffId) }. The case was opened by the
 * root-cause conclusion; this fills in what followed.
 */
export function buildAccountability(api, key, rcaCase, { at }) {
  const intent = INTENTS[key];
  if (!intent) return null;
  const row = api.byCase(rcaCase.id)[0];
  if (!row) { console.warn('[rca seed] no accountability case opened for', key); return null; }
  const say = (r, what) => { if (r?.error) console.warn('[rca seed] accountability', what, 'refused', key, r.error); };
  if (intent.response) say(api.recordResponse(row.id, { text: intent.response.text }, { at: at(intent.response.daysAgo, 9), by: api.nameOf(rcaCase.analystId) }), 'response');
  if (intent.decision) {
    const d = intent.decision;
    say(api.decide(row.id, { type: d.type, rationale: d.rationale, deduction: d.deduction || null }, { at: at(d.daysAgo, 15), by: api.nameOf(d.by) }), 'decision');
  }
  if (intent.appeal) {
    const a = intent.appeal;
    say(api.fileAppeal(row.id, { text: a.text }, { at: at(a.daysAgo, 10), by: api.nameOf(rcaCase.analystId) }), 'appeal');
    if (a.review) say(api.reviewAppeal(row.id, { outcome: a.review.outcome, rationale: a.review.rationale }, { at: at(a.review.daysAgo, 16), by: api.nameOf(a.review.by) }), 'review');
  }
  if (intent.sentToHr) say(api.sendToHr(row.id, { sentRef: intent.sentToHr.ref }, { at: at(intent.sentToHr.daysAgo, 11), by: api.nameOf(CMO) }), 'HR');
  if (intent.closedDaysAgo != null) say(api.close(row.id, {}, { at: at(intent.closedDaysAgo, 12), by: api.nameOf(CMO) }), 'close');
  return row;
}
