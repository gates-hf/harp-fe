// Seed — handoffs. Underpayment hand-offs from Pactum to Defensio (the appeals
// module, not built yet). Shared entity: Defensio takes ownership when it
// arrives and this shape is what it inherits.
//
// The claims are generated, so the seeded hand-offs are picked off the
// generated set rather than written by hand against ids that would drift. They
// are the largest underpayments there are, which clears the engine's flag
// threshold by a wide margin — the seed never has to restate that definition.

import * as claims from '../repositories/claims.js';

export const HANDOFF_STATUSES = ['Handed off', 'In appeal', 'Recovered'];

export const HANDOFF_REASONS = [
  'Paid below contracted rate',
  'Coverage split applied incorrectly',
  'Denied — prior auth on file',
  'Denied — documentation supplied',
  'Bundled line paid as a single charge',
  'Other',
];

/** Two recovered, one in appeal, three still open — so both rails read non-zero. */
const PLAN = [
  { status: 'Recovered', share: 1, user: 'Nadine Rizk', reason: 'Paid below contracted rate' },
  { status: 'Recovered', share: 0.72, user: 'Nadine Rizk', reason: 'Coverage split applied incorrectly' },
  { status: 'In appeal', share: 0, user: 'Georges Khoury', reason: 'Paid below contracted rate' },
  { status: 'Handed off', share: 0, user: 'Georges Khoury', reason: 'Bundled line paid as a single charge' },
  { status: 'Handed off', share: 0, user: 'Tarek Solh', reason: 'Paid below contracted rate' },
  { status: 'Handed off', share: 0, user: 'Tarek Solh', reason: 'Coverage split applied incorrectly' },
];

export function generateHandoffs() {
  const underpaid = claims
    .all()
    .filter((c) => c.status === 'Partially Paid')
    .map((c) => ({ claim: c, amount: round2(c.allowedExpected - c.allowedPaid) }))
    .sort((a, b) => b.amount - a.amount || a.claim.id.localeCompare(b.claim.id));

  // Every third of the largest, so the seeded hand-offs land on more than one
  // contract and the Variance Captured rail differs from contract to contract.
  const picked = underpaid.filter((_, i) => i % 3 === 0).slice(0, PLAN.length);

  return picked.map((row, i) => {
    const plan = PLAN[i];
    return {
      id: `HO-${String(i + 1).padStart(4, '0')}`,
      claimId: row.claim.id,
      contractId: row.claim.contractId,
      payerId: row.claim.payerId,
      amount: row.amount,
      status: plan.status,
      recoveredAmount: round2(row.amount * plan.share),
      reason: plan.reason,
      note: '',
      createdBy: plan.user,
      createdAt: `${row.claim.paidAt || row.claim.submittedAt}T09:${String(10 + i * 7).padStart(2, '0')}:00`,
    };
  });
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
