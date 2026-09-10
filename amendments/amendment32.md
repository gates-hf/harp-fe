# Amendment 32 — Claima: Claim Nullification  (TAG: A32 — runs in parallel with A31, A33)

## Parallel protocol
Follow `modules/claima/COORDINATION.md` with the relaxed rule for this set: tagged `A32` sections (new helpers only) allowed in `claims.js`, `batches.js`, `charges.js`. You own `modules/claima/features/nullification/`, `data/seed/nullifications.js`, `data/repositories/nullifications.js`, `data/seed/nullification-reasons.js`. No Frontis/Pactum files except calling existing helpers.

## Interfaces (fixed)
**You publish**: `nullifications.byClaim(claimNo)`, `nullifications.log(filters)`, `nullifications.stats(period)`, `claims.nullify(claimNo, payload)` (in your A32 section; A31 may reference it in messaging).
**You consume**: `claims.setStatus`, `claims.assembleFor(encounterNo, {kind, replaces})`, family links (A27); `batches.removeClaim(batchNo, claimNo, reason)` — add in your A32 section of `batches.js` (Open batches only; audited); `charges.returnFromClaim(lineIds, {nullificationNo, hold: bool, reason})` — add in your A32 section of `charges.js` (Released → Unreleased or Held, history line); `remittances.reversePosting` (A29, routing only); `denials.byClaim` (A31, routing only); `encounters.reclassify` (Frontis, wrong-payer path).

## Speed rules
Read only CLAUDE.md, COORDINATION.md, `claims.js`, `batches.js` (`byClaim`), `charges.js` (line status), `modules/claima/features/claims-assembly/claim-view.js` (header actions registry), `shared/roles.js`, `shared/config.js`, your files. Seed: 6 nullifications across paths incl. one with a replacement and one two-approver. Verify: `node --check`, load each route once, nullify one Ready claim with replacement. Reply: routes + published helpers + open requests.

## Entities
```
nullification: no ("NUL-2026-000019"), claimNo, statusAtNullification, path (Direct|PayerNotified|EndChain), reasonCode, reasonText|null, justification,
  payerNotification { method, reference, date, note }|null, disposition { kind: ReturnToUnbilled|ReturnAndHold, reason|null, lineIds:[] },
  replacement { claimNo|null, kind (Fresh|WrongPayerReclass), at }|null, actors { requestedBy, approvedBy|null (second approver) }, valueAtNullification, at
nullificationReasons: N01 Wrong payer, N02 Duplicate, N03 Wrong encounter, N04 Coding error requiring full rebuild, N05 Payer instruction, N06 Internal test/erroneous assembly, N99 Other (text required)
CONFIG.claima.nullification = { secondApproverThreshold: 2000, roles: canNullifyClaim, canApproveNullification }
claim += nullification { no, at }|null, replacedBy|null, replaces|null; status Void when nullified
```
**Path resolver** `pathFor(claim)`: Draft/Stale/ScrubFailed/Ready → Direct (Ready also `batches.removeClaim` from any Open batch); Submitted/Acknowledged → PayerNotified (notification record required); Paid/Partially Paid → **blocked** with routing card to `#/claima/remittances/:no` reversal + replacement; Denied → blocked with routing to `#/claima/denials/:id`; Rejected → EndChain (nullify, note on family "chain ended"). Nullify flow: reason*, justification*, path-specific fields, disposition* (default ReturnToUnbilled; hold requires reason), value ≥ threshold → second approver* (different user; role `canApproveNullification`; requester ≠ approver) → `claims.nullify` → status Void, `charges.returnFromClaim`, audit, optional **Cancel-and-replace**: `claims.assembleFor(encounterNo, {kind: "Primary", replaces: no})` — always fresh assembly, never a copy; Wrong payer → first opens Frontis `encounters.reclassify` dialog, then assembles against the new classification; links both ways; cycle count increments on family.

## Screens
**Claim view action** "Nullify" (role-gated) → dialog implementing the flow; blocked paths show the routing card instead. **Nullification log** `#/claima/nullifications`: rail (MTD count, MTD value, Replacement rate, Top reason). Table: Nullification no., Claim, Patient, Payer, Value, Status at nullification, Reason, Payer notification (✓/—), Disposition, Replacement (link), Requested by / Approved by, At. Search; filters Reason / Path / Disposition / Payer / Dates / Has replacement; export CSV. **Detail** `#/claima/nullifications/:no`: full record, charge round-trip (lines returned, their current status with link to F1 pool), family strip with nullified ↔ replacement, timeline excerpt. Immutable.

## Seed
Direct (Ready, removed from an Open batch, replaced fresh); PayerNotified (Acknowledged, notification by portal); EndChain (Rejected cycle 2); WrongPayer with reclass + replacement; one ≥ threshold with two actors; one ReturnAndHold. Blocked examples don't need seeds — verify the routing cards on a Paid and a Denied claim.

## Done when
Path resolver with all five behaviours, reasoned + role/tier-gated nullification, charges round-trip visible in F1 with history, fresh replacement chained both ways incl. wrong-payer reclass, immutable log with stats/export. Append `### 32`; COORDINATION Status.