// Seed — corrective actions (amendment 37, Defensio F2). One table keyed on
// the root-cause case's seed key: the action each seeded case raised, who
// owns it, when it was due, and how far it got. The root-cause register's
// builder drives these through data/repositories/corrective-actions.js as it
// builds each case — an action is raised before the case concludes, marked
// done and verified after — with the dates the work happened on. Imports
// nothing from data/.

const SUPERVISOR = 'ST-0005';   // Nour Khalil
const COORDINATOR = 'ST-0004';  // Bilal Chahine, pre-authorisation
const CODER = 'coder';          // Tarek Solh
const CMO = 'exec';             // Georges Khoury

export const INTENTS = {
  'closed-registration': [
    { key: 'elig-gate', type: 'Process', ownerId: SUPERVISOR, raisedDaysAgo: 29, dueDaysAgo: 15,
      action: 'Eligibility check runs before an insured visit is activated — clearance reads Blocked without one',
      doneDaysAgo: 16, doneNote: 'Desk instruction issued; the clearance item is the gate', verifiedDaysAgo: 13, verifiedBy: CMO,
      verificationNote: 'Ten insured visits opened since the instruction, every one with a check on its cover before activation.' },
  ],
  'closed-filing': [
    { key: 'deadline-report', type: 'Process', ownerId: SUPERVISOR, raisedDaysAgo: 25, dueDaysAgo: 12,
      action: 'Filing-deadline report reviewed each morning; a finalized claim inside ten days of its window goes into the next batch whatever is missing',
      doneDaysAgo: 14, doneNote: 'Report on the submission workbench; reviewed daily since', verifiedDaysAgo: 11, verifiedBy: CMO,
      verificationNote: 'Nothing on the ministry queue older than forty days on two spot checks a week apart.' },
    { key: 'batch-from-claim', type: 'Training', ownerId: SUPERVISOR, raisedDaysAgo: 25, dueDaysAgo: 18,
      action: 'Batch building reads the claim page’s attachments, not the paper file — walked through with the billing clerks',
      doneDaysAgo: 19, doneNote: 'Session held with both clerks', verifiedDaysAgo: 11, verifiedBy: CMO,
      verificationNote: 'Both clerks built the last two ministry batches from the workbench; no claim held back for a document already attached.' },
  ],
  'closed-preauth-matrix': [
    { key: 'matrix-row', type: 'Configuration', ownerId: COORDINATOR, raisedDaysAgo: 21, dueDaysAgo: 10, target: 'contract-preauth',
      action: 'Add an item-level pre-authorisation row for CT chest with contrast on the NSSF matrix',
      doneDaysAgo: 12, doneNote: 'Row added on the Pre-Auth tab', verifiedDaysAgo: 5, verifiedBy: CODER,
      verificationNote: 'A fresh eligibility check on an NSSF second-class cover with the scan anticipated raises the pre-authorisation condition at registration.' },
  ],
  'concluded-recode': [
    { key: 'coding-refresher', type: 'Training', ownerId: SUPERVISOR, raisedDaysAgo: 3, dueDaysIn: 10,
      action: 'Specificity refresher for the emergency coders — every document on the chart is opened before the principal is chosen' },
  ],
};

/**
 * Raise the actions for one case through the repository; called by the
 * root-cause builder before the case concludes. Returns the rows. `api` is
 * { create, markDone, verify, targetFor(row, name) }.
 */
export function buildActions(api, key, rcaCase, first, { at, by }) {
  const out = [];
  for (const a of INTENTS[key] || []) {
    const targetRef = a.target ? api.targetFor(first, a.target) : null;
    const row = api.create({
      rcaCaseId: rcaCase.id, action: a.action, type: a.type, targetRef, ownerId: a.ownerId,
      dueDate: a.dueDaysIn != null ? at(-a.dueDaysIn).slice(0, 10) : at(a.dueDaysAgo).slice(0, 10),
    }, { at: at(a.raisedDaysAgo, 15), by, commit: false });
    if (!row || row.error) { console.warn('[rca seed] action refused', key, a.key, row?.error); continue; }
    out.push({ intent: a, row });
  }
  return out;
}

/** Done and verified, after the case has concluded. */
export function settleActions(api, built, { at }) {
  for (const { intent: a, row } of built) {
    if (a.doneDaysAgo != null) {
      const r = api.markDone(row.id, a.doneNote || '', { at: at(a.doneDaysAgo, 16), by: a.ownerId });
      if (r?.error) console.warn('[rca seed] done refused', row.id, r.error);
    }
    if (a.verifiedDaysAgo != null) {
      const r = api.verify(row.id, { verificationNote: a.verificationNote }, { at: at(a.verifiedDaysAgo, 17), by: a.verifiedBy });
      if (r?.error) console.warn('[rca seed] verify refused', row.id, r.error);
    }
  }
}
