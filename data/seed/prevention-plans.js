// Seed — prevention plans (amendment 40, Defensio F5). Two plans, hand-
// written and driven through the repository's own writes with the dates the
// events happened on, so each trail reads the way a live plan's does:
//
// - PP-0001, closed effective yesterday: the coding supervisor's answer to
//   NSSF's unspecified-diagnosis refusals (the pattern at the any-service
//   level). Two actions, both done with evidence before the plan was
//   activated in June; the baseline is hand-written — it was frozen over the
//   quarter before the register's own seed begins, and a frozen figure is
//   never recomputed — while the measured figure is what the engine reads
//   off the register today (this week's recode denial, DN-0020, is the one
//   inside the window).
// - PP-0002, active since the start of August: the pre-authorisation desk's
//   answer to NSSF's lab-panel refusals. One action of its own (the item-
//   level matrix rows, done, with the screenshot and a note as evidence) and
//   one adopted from amendment 37's closed pre-authorisation case — the
//   Configuration action that added the CT row — whose status is read from
//   that register. Its baseline was frozen from the register at activation.
//   Every action is done, so Start measurement is the next thing to press.
//
// Imports nothing from data/: the repository hands `buildPlans` its own API.
// The pattern ids are computed from the same dimensions the pattern seed
// names, so the two never drift.

import { PATTERN_DIMS } from './denial-patterns.js';

const CODER = 'Tarek Solh';
const CMO = 'Georges Khoury';
const SUPERVISOR = 'ST-0005';    // Nour Khalil, revenue cycle supervisor
const COORDINATOR = 'ST-0004';   // Bilal Chahine, pre-authorisation coordinator
const EXEC = 'exec';             // Georges Khoury, the sponsor

/**
 * Drives the repository. `api` is { today, patternId(dims), get, create,
 * addAction, adoptF2Action, markActionDone, addEvidence, activate,
 * stampUnderPlan(patternId, at, planId), startMeasurement, close, log }. Returns
 * the plans by key.
 */
export function buildPlans(api) {
  const out = {};
  const at = (n, hour = 10) => `${daysAgo(api.today, n)}T${String(hour).padStart(2, '0')}:30:00.000Z`;

  // --- PP-0001 — closed effective ------------------------------------------------------
  {
    const dated = (n, hour) => ({ at: at(n, hour), by: CODER, commit: false });
    const plan = api.create({
      title: 'Specific principal diagnosis on NSSF claims',
      description: 'Three NSSF claims in a quarter were refused CO-4 on an unspecified principal diagnosis and recoded after the fact. The chart names the finding every time; the coder never opened the second document. The fix is a habit and a check, not a rule.',
      targets: [{ type: 'pattern', ref: api.patternId(PATTERN_DIMS.nssfCodeAny) }],
      ownerId: SUPERVISOR, sponsorId: EXEC, seedTag: 'A40',
    }, dated(99, 9));
    if (plan?.id) {
      out.closedEffective = plan;
      api.addAction(plan.id, { kind: 'own', type: 'Training', text: 'Every document on the chart is opened before the principal is chosen — walked through with the day and night coders', ownerId: SUPERVISOR, dueDate: daysAgo(api.today, 92) }, dated(99, 10));
      api.addAction(plan.id, { kind: 'own', type: 'Process', text: 'An unspecified-code scrub warning (K04) is acknowledged only with the note reference in the reason', ownerId: 'coder', dueDate: daysAgo(api.today, 90) }, dated(99, 10));
      api.addEvidence(plan.id, 'A1', { kind: 'file', fileName: 'coding-refresher-attendance-2026-06.pdf', size: 184320 }, { at: at(95, 15), by: SUPERVISOR, commit: false });
      api.addEvidence(plan.id, 'A1', { kind: 'note', text: 'Session held on 8 June, both shifts; the night coder took it the following week.' }, { at: at(95, 15), by: SUPERVISOR, commit: false });
      api.markActionDone(plan.id, 'A1', { note: 'Both shifts walked through; attendance attached' }, { at: at(95, 16), by: SUPERVISOR, commit: false });
      api.addEvidence(plan.id, 'A2', { kind: 'note', text: 'Acknowledgment reasons on K04 warnings checked for a fortnight — every one names the document the code was read from.' }, { at: at(93, 11), by: CODER, commit: false });
      api.markActionDone(plan.id, 'A2', { note: 'In place on the scrub tab; reasons checked' }, { at: at(93, 11), by: CODER, commit: false });
      api.activate(plan.id, { baseline: { count: 6, value: 1240, note: 'Frozen at activation over the quarter before the plan; the register’s own seed begins after four of the six' } }, { at: at(92, 9), by: SUPERVISOR, commit: false });
      api.startMeasurement(plan.id, { at: at(91, 9), by: SUPERVISOR, commit: false });
      const r = api.close(plan.id, {}, { at: at(1, 17), by: CMO, commit: false });
      if (r?.error) console.warn('[plans seed] close refused', plan.id, r.error);
    }
  }

  // --- PP-0002 — active ----------------------------------------------------------------
  {
    const dated = (n, hour) => ({ at: at(n, hour), by: CODER, commit: false });
    const plan = api.create({
      title: 'Pre-authorisation for NSSF lab panels before the sample is taken',
      description: 'The fund refused three lab panels in July for a missing pre-authorisation and accepted two retrospective requests. The requirement never reaches the desk: the matrix flags the category above a price, and a panel has no price at the time of the check. Name the panels on the matrix and the clearance checklist raises the item at registration.',
      targets: [{ type: 'pattern', ref: api.patternId(PATTERN_DIMS.nssfAuthLab) }],
      ownerId: COORDINATOR, sponsorId: EXEC, seedTag: 'A40',
    }, dated(43, 10));
    if (plan?.id) {
      out.active = plan;
      api.addAction(plan.id, { kind: 'own', type: 'Configuration', text: 'Item-level Yes rows on the NSSF pre-authorisation matrix for the lab panels the fund wants approved', targetRef: '#/pactum/contracts/CTR-0001/preauth', ownerId: COORDINATOR, dueDate: daysAgo(api.today, 20) }, dated(43, 10));
      api.adoptF2Action(plan.id, { seedKey: 'closed-preauth-matrix', type: 'Configuration' }, dated(42, 11));
      api.activate(plan.id, {}, { at: at(41, 9), by: COORDINATOR, commit: false });
      api.stampUnderPlan(api.patternId(PATTERN_DIMS.nssfAuthLab), at(41, 9), plan.id);
      api.addEvidence(plan.id, 'A1', { kind: 'file', fileName: 'nssf-matrix-lab-rows.png', size: 96412 }, { at: at(24, 14), by: COORDINATOR, commit: false });
      api.addEvidence(plan.id, 'A1', { kind: 'note', text: 'Four item-level rows added on the Pre-Auth tab of CTR-0001 (v2): the three panels refused in July and the metabolic panel the fund flagged on the phone.' }, { at: at(24, 14), by: COORDINATOR, commit: false });
      api.markActionDone(plan.id, 'A1', { note: 'Rows on the matrix; a fresh check on a second-class cover raises the item' }, { at: at(24, 15), by: COORDINATOR, commit: false });
    }
  }
  return out;
}

const daysAfter = (isoDate, n) => {
  const d = new Date(`${String(isoDate || '').slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const daysAgo = (today, n) => daysAfter(today, -n);
