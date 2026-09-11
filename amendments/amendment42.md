# Amendment 42 — Defensio F7: TPA Fee Accounting
# TAG: A42 — parallel set 2 (with A40 F5, A41 F6). Run AFTER set 1 (A37–A39).

## Speed rules (standing)
- Read ONLY the files named here. No repo-wide scans.
- Purely additive. Only the named hooks touch other files.
- Small hand-written seed; no generators.
- Verification = syntax check only (node --check per JS file).
- Reply with: route list + files written + COORDINATION.md entries + open questions.

## Coordination (read modules/defensio/COORDINATION.md first)
- A42 TAKES OVER the `tpaFeeAccruals` stub created in A36 — register takeover;
  A42 OWNS: `tpas`, `tpaFeeSchedules`, `tpaFeeAccruals`, `tpaDisputes`,
  `tpaAmendments` + all F7 screens.
- CONSUME (published, feature-detect): A36 denials store — TPA-fee separation
  records (Reclassified-tpa) with amounts + claim/remittance refs;
  claima published: remittance detail reader (paid/billed per claim, dates),
  posting pipeline correction writer (the reversal/repost creator published
  for A29-adjacent corrections — if only a hook point exists, post correction
  records to your own store and register a pending-integration note),
  write-off request creator (A33).
- A42 PUBLISHES (register): `getTpaFeeSummary(period)` → {expected, actual,
  overchargeOpen, byTpa[]} — A41's misclassification view and A43 home read
  this.
- Do NOT read A40/A41 implementation files.

## Read first (only these)
- modules/defensio/COORDINATION.md
- modules/defensio/data/denials.js (A36 — separation record shape, the
  tpaFeeAccruals stub file)
- modules/claima/COORDINATION.md (published readers/creators listed above)
- design-system tokens as used by A36 screens; F9-tier config pattern ref
  (claima write-off tiers) from claima COORDINATION notes

## Task 1 — Data + Engines (modules/defensio/data/)
- tpas.js: {id, name, contact, status, payerLinks[{payerId, from, to}]}
- tpa-fee-schedules.js: per link, versioned: {id, tpaId, payerId,
  versions[{basis(pctPaid|pctBilled|flatClaim|flatRemit), rate, scopes[
  {level(all|serviceGroup), ref, rate?}], capPerClaim?, capPerPeriod?,
  effectiveFrom, effectiveTo, retrospective:false}]} — non-overlap validation
  per scope; append-only (edit past version → blocked with amendment link).
- tpa-fee-accruals.js (replaces stub, keep ids): {id, claimId, payerId, tpaId,
  remittanceRef, remittanceDate, basisAmount, expected{amount,
  scheduleVersionRef}|null, actual{amount, separationRefs[]},
  variance, state(Accrued|Matched|Overcharged|Undercharged|Unscheduled|
  Disputed|Settled|Amended), preAmendmentSnapshot?, audit[]}
- Matching engine (engines/tpa-matching.js): on load + on separation event
  (hook if published): find/create accrual per claim, compute expected from
  the version active at remittanceDate (most-specific scope wins, caps
  applied), tolerance (max(1%, 5)) → state; Unscheduled when no version
  covers. Ledger assert: actual = matchedAgreed + settled + writtenOff +
  openDisputed ± amendmentNet (console.assert).
- tpa-disputes.js: {id, tpaId, accrualIds[], totalOvercharge, evidence
  {computedRefs}, status(Raised|Acknowledged|Settled|WrittenOff),
  settlement{recovered, at}, writeOffRequestRef?, audit[]}
- tpa-amendments.js + engine (engines/tpa-amendment.js): {id, tpaId, payerId,
  period{from,to}, reason(code+text), restatedVersionRef(marked
  retrospective:true), documentRef, impact[{accrualId, oldExpected,
  newExpected, correction, oldState, newState}], totals, approval{tier(reuse
  F9 tier thresholds pattern — read config values, don't import claima code),
  requestedBy, approvedBy(≠requester), note}, status(Draft|InReview|Approved|
  Posted|Rejected), postingRefs[], audit[]} — compute impact (recompute every
  in-period accrual), preview, approve, post: write reversal/repost via the
  claima correction creator (or pending-integration store per coordination
  note), set accruals Amended with preAmendmentSnapshot, auto-update affected
  disputes, freeze the amendment.

## Task 2 — Screens (modules/defensio/)
- tpa-ledger.html+js: header stats (incl. Unscheduled chip); Tab1 Accruals
  per spec (filters, overcharge-desc default, bulk Dispute per TPA); Tab2
  Schedules (registry + link mgmt, version list, add-version flow, past-edit
  block message linking amendments); Tab3 Disputes (raise from bulk, status
  flow, settlement capture → F9 request for remainder via published creator).
- tpa-amendment.html+js: 4-step flow per spec (header → computed impact list
  with totals → tiered review → post) + amendments archive list.

## Task 3 — Hooks (only cross-file edits)
1. A36 denial detail: on Reclassified-tpa records, "TPA accrual" chip →
   ledger (helper you publish: getAccrualForSeparation()).
2. Defensio nav: TPA Ledger entry.
Log both in COORDINATION.md.

## Seed (hand-written)
- 2 TPAs (one administering 2 payers), schedules: 1 pctPaid 3% all-claims +
  serviceGroup override 2% lab, 1 flatClaim 4.000; versions dated to cover
  the A29 seeded remittance dates.
- 6 accruals off existing seeded tpa separations + remittances: 2 Matched,
  1 Overcharged (in a Raised dispute), 1 Settled (partial recovery + linked
  F9 request Requested), 1 Unscheduled, 1 Amended (with preAmendmentSnapshot)
  belonging to: 1 Posted amendment (period last month, reason=TPA error,
  impact of 3 accruals, tier-approved). Keep every ref consistent with
  A36/A29/A33 seeds.

## Consistency requirements
- TPA fees never touch denial metrics (no writes to denial states beyond the
  existing Reclassified linkage).
- Expected always from the version at remittanceDate — assert no
  current-version lookup on historical accruals.
- Append-only schedules; amendments = the only past-period path; originals
  never mutate (freeze pattern).
- Audit every mutation (A36 pattern).

## Reply checklist
Routes · files · COORDINATION entries (stub takeover, ownership, 2 published
helpers, claima correction path used: direct creator vs pending-integration)
· feature-detect status (separation hook, F9 creator) · open questions.