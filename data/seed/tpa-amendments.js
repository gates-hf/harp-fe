// Seed — TPA fee amendments (amendment 42). One posted amendment: GlobeMed's
// notice of 20 July put Cigna's fee at four per cent from August and the
// desk entered it as v2; on 3 September GlobeMed wrote that the notice was
// issued in error and the agreement's three per cent stands. Hala Mansour
// drafted the restatement (TFS-0002/v3, in the schedule seed, unposted
// until here), the impact ran over August's three accruals — two lab claims
// at the untouched two per cent and the surgery claim taken at four — and
// Tarek Solh signed it at tier 1 and posted it: the surgery accrual reads
// Amended with its pre-amendment figures snapshotted and the $3.03
// correction stands as a pending-integration posting record, since Claima
// publishes no correction creator for a posted remittance. Driven through
// the register's own writes with the dates the events happened on.

import { ROLES } from '../../shared/roles.js';

const ANALYST = 'Hala Mansour';
const CODER = 'Tarek Solh';

export const INTENTS = [
  { key: 'cignaAugust', tpaId: 'TP-0001', payerId: 'PY-0026', existingRef: 'TFS-0002/v3', supersedesRef: 'TFS-0002/v2',
    period: { from: '2026-08-01', to: '2026-08-31' },
    reason: { code: 'TPA_ERROR', text: 'GlobeMed’s notice of 20 July put the Cigna fee at four per cent from 1 August; its letter of 3 September withdraws the notice — the agreement’s three per cent stands and August is restated.' },
    document: { fileName: 'globemed-letter-2026-09-03.pdf', size: 184000 },
    draftedAt: '2026-09-04T10:20:00.000Z', reviewAt: '2026-09-04T10:45:00.000Z', approvedAt: '2026-09-05T09:15:00.000Z', postedAt: '2026-09-05T09:20:00.000Z',
    approvalNote: 'Letter on file; the restated figures agree with GlobeMed’s re-issued August statement.' },
];

/** buildTpaAmendments({ amendments }) → the amendments created. */
export function buildTpaAmendments(api) {
  const { amendments } = api;
  const out = [];
  const signer = ROLES.find((r) => r.name === CODER) || { name: CODER, canApproveWO1: true };
  for (const intent of INTENTS) {
    const row = amendments.draft({
      tpaId: intent.tpaId, payerId: intent.payerId, period: intent.period, reason: intent.reason,
      existingRef: intent.existingRef, supersedesRef: intent.supersedesRef, documentRef: intent.document,
    }, { at: intent.draftedAt, by: ANALYST, commit: false });
    if (!row || row.error) { console.warn('[tpa seed] amendment refused', intent.key, row?.error); continue; }
    row.seedTag = 'A42';
    const sent = amendments.submitForReview(row.id, { at: intent.reviewAt, by: ANALYST, commit: false });
    if (sent?.error) { console.warn('[tpa seed] review refused', intent.key, sent.error); continue; }
    const ok = amendments.approve(row.id, { note: intent.approvalNote }, { role: signer, at: intent.approvedAt, by: CODER, commit: false });
    if (ok?.error) { console.warn('[tpa seed] approval refused', intent.key, ok.error); continue; }
    const posted = amendments.post(row.id, { at: intent.postedAt, by: CODER, commit: false });
    if (posted?.error) console.warn('[tpa seed] posting refused', intent.key, posted.error);
    out.push(row);
  }
  return out;
}
