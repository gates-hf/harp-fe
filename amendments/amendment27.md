# Amendment 27 — Claima: Claim Assembly & Portfolio  (TAG: A27 — runs in parallel with A25, A26)

## Parallel protocol
Read `modules/claima/COORDINATION.md` first and follow it exactly. You own ONLY: `modules/claima/features/claims-assembly/`, `data/engines/claim-assembler.js`, `data/engines/claim-scrubber.js`, `data/seed/claim-attachments.js`, `data/repositories/claim-attachments.js`, plus **your TAG section** in `data/repositories/claims.js` and one Pactum addition (below). Peer helpers not yet published → feature-detect + Request; build screens first against seeded claims.

## Interfaces (fixed)
**You publish** (in your A27 section of `claims.js`):
- `claims.markStale(encounterNo, reason)` → flags open claims of that encounter Stale, voids scrub; A25 (corrections) and A26 (recode) call it
- `claims.onLateCharge(encounterNo, lineIds)` → adds lines to an open Draft flagged Late, or spawns a supplementary claim if Ready+
- `claims.assembleFor(encounterNo)` → runs the assembler (idempotent)
- `claims.readyForSubmission()` → Ready claims (future F4 submission consumes)
**You consume**: `coding.afterCodedHooks` + `coding.byEncounter`, `clinicalDocs.byEncounter` (A26); `charges.releasedByEncounter`, `charges.afterCorrectionHooks` (A25); `preauth.activeFor`, `referrals.byEncounter`/encounter `linked.referralId`, `contracts.contractForService`, `resolvePreAuth`, `referralRequired` (exist). Subscribe to hooks with feature-detect (`coding?.afterCodedHooks?.push(...)`) and re-check on load.

## Speed rules
Read only CLAUDE.md, COORDINATION.md, `data/repositories/claims.js`, `encounters.js`, `preauth-requests.js`, `referrals.js`, `contracts.js` (helpers above), `modules/pactum/features/contracts/tab-preauth.js` + `referral-required-form.js` (pattern for the Pactum addition), `shared/config.js`, and your own files. Seed: 12 claims in assembly states derived from existing coded/seeded encounters (hand-write states; generate numbers). Verify: `node --check`, load each route once, run one scrub + finalize. Reply: routes + published helpers + open requests.

## Files
```
modules/claima/features/claims-assembly/
  portfolio.html/.js               #/claima/claims            (header stats; views by payer / by status / flat)
  claim-view.html/.js              #/claima/claims/:no        (tabs Lines · Coding · Attachments · Scrub · History)
  claim-refresh.js                 refresh + diff renderer
  claim-attachments.js             requirements, auto-pull, upload, link-to-line
  claim-scrub.js                   run + results + acknowledge warnings
  claim-actions.js                 finalize / reopen / bulk
  claim-history.js
data/engines/claim-assembler.js    pure: assemble(encounter, coding, charges, ctx) → claim payload
data/engines/claim-scrubber.js     pure: scrub(claim, ctx) → findings[]
modules/pactum/features/contracts/documentation-required-form.js + section on tab-preauth.js   (Pactum: "Documentation Required" config — additive, same pattern as Referral Required)
```
Nav: Claima → Claims (badge = Ready). Roles: `canReopenClaim`, `canAcknowledgeScrubWarning`.

## Entities (extend the amendment-24 claim; keep flat fields synced)
```
claim += stale { flag, reason, at }|null, scrubRuns:[{ id, at, by, contractVersion, findings:[…], result: Pass|Warnings|Fail, acknowledgments:[{findingId, reason, by}] }],
         coding { version, principal, secondaries[], procedures[] }, attachments:[{id, docId|null, fileName, type, origin (Auto|Upload), lineIds:[], required: bool}],
         refreshes:[{ at, by, diff }], kind (Primary|Secondary|Supplementary), parentClaimNo|null, childClaimNos:[], lateLineIds:[], finalizedAt|null, reopenedAt|null
contract.documentationRequired: [{ id, scopeLevel (Contract|Service Group|Category|Item), scopeValue, docTypes:[…], thresholdAmount|null }]   // Pactum
CONFIG.claima.assembly = { valueBands: [0,500,2000,10000] }
```
**Assembler**: header from `encounter.financial` (payer, plan, policy, contractId/version, snapshotRef); lines = released charge lines with `payerShare > 0` (overage lines kept separate, `isOverage`); coding from current version; auth number stamped on lines where `resolvePreAuth` flags and `activeFor` returns one; referral ref from encounter link; attachments auto-pulled from `clinicalDocs` matching `documentationRequired` types (with threshold); Self-Pay → no claim; one Primary per encounter per payer; Secondary defined (kind Secondary, status Draft, `parentClaimNo`, not activated). Assembly also runs on load for Coded encounters lacking a claim (idempotent).
**Scrubber** categories → findings `{id, category (Completeness|Financial|Authorization|Referral|Documentation|Code Logic), severity (Error|Warning), lineId|null, message, jumpTo}`: required header fields; totals reconcile; each line's amounts equal engine re-evaluation at DOS on the stamped version; auth present/valid/covers service & qty where required; referral present when contract requires; required docs present; one principal, POA on IP, procedure lines linked, date logic. Result Pass / Warnings / Fail; stored on the claim.

## Screens
**Portfolio**: header stats (Value in assembly, Ready count + value, Stale, Avg age). View toggle: By payer (groups with totals), By status, Flat. Filters: Payer, Status, Scrub result, Value band, Age, Dates; search claim no./patient/encounter. Row actions: Open · Run scrub · Finalize · Refresh · History. Bulk: Scrub selection · Finalize all passing. Downstream statuses (Submitted+) rendered read-only rows with a "managed in Submission/Remittance" note.
**Claim view**: header (claim no., kind chip, status, payer/plan, contract version chip, stale banner with Refresh, value, age, parent/child chain links). Tabs: Lines (with overage rows, auth numbers, late chips), Coding (read-only snapshot + "Open coding"), Attachments (requirements list with missing indicator, auto/upload origin, link to lines, upload), Scrub (latest run grouped by category, severity, jump-to; acknowledge warnings with reason; Run scrub), History (assembly, refreshes with diff old→new, scrub runs, acknowledgments, finalize/reopen).
**Actions**: Finalize (Pass or all warnings acknowledged, not Stale) → Ready, locks lines/coding refs/attachments; Reopen (role + reason) → Draft, voids scrub; Refresh (re-assemble, diff shown, clears Stale).

## Seed
12 claims: 4 Draft (one Stale from a seeded recode, one with missing required doc), 3 scrubbed with warnings, 2 Ready, 1 Supplementary chained to a Ready, 1 Secondary defined, 1 Fail. Pactum: Documentation Required rows on NSSF (Contract: Discharge Summary; Surgery: Operative Note; threshold $2,000) and AXA (Imaging: Imaging Report).

## Done when
Auto-assembly on Coded, portfolio three views + bulk, claim view all tabs, stale → refresh with diff, attachments with requirements, six-category scrub with jump-to, finalize/reopen with locks, chains navigable, published helpers live. Append `### 27`; update COORDINATION Status; if last to finish, run the full-tree check.