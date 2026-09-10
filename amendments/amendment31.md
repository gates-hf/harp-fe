# Amendment 31 — Claima: Denial Triage & Routing  (TAG: A31 — runs in parallel with A32, A33)

## Parallel protocol
Follow `modules/claima/COORDINATION.md`. Amendments 25–30 are finished, so the ownership rule relaxes one notch for this set: you may **add a tagged `A31` section** (new helpers only, never edits) to repositories owned by finished amendments (`claims.js`, `charges.js`, `coding.js`, `remittances.js`, `batches.js`). You take **ownership of `data/repositories/denials.js` + seed** from A29 (its stub); keep its published helpers working. You own `modules/claima/features/denials/`, `data/engines/denial-router.js`, `data/seed/root-causes.js`. Peer helpers missing → feature-detect + Request. No Frontis/Pactum files (Defensio hand-offs go through the existing `handoffs` repository).

Note: the source document interleaves F7 US-2's acceptance criteria after F8 US-5 — they are: detail view with denied lines (billed/expected/denied), stamped contract version, linked auth/referral/documents, timeline excerpt; triage requires class + root cause; route auto-suggested and overridable; triage mandatory before routing; changes audited.

## Interfaces (fixed)
**You publish**: `denials.worklist()`, `denials.byClaim(claimNo)`, `denials.resolveWrittenOff(denialId, writeoffId, amount)` (A33 calls), `denials.resolveFromRemittance(claimNo, lines)` (subscribed to `remittances.afterPostHooks`), `denials.resolveFromHandoff(handoffId, outcome)` (Defensio stub hook), `denials.nearDeadline(days)` (home), `denials.analytics(period)`.
**You consume**: `remittances.afterPostHooks`, `denials` stub data (A29); `coding.requestRecode` (A26); `charges.hold`/`charges.byEncounter` + a new tagged helper `charges.requestCorrection(lineId, {source, ref, reason})` you add in your A31 section of `charges.js` (creates a Held line with Disputed flag); `claims.assembleFor`, `claims.markStale`, `claims.resubmit` (A27/A28); `preauth.requestRecode`-equivalent: Frontis `preauth-requests.resubmit(no)` exists — call it for auth rework; `handoffs.create` (Pactum); `writeoffs.requestFromDenial?.(denial)` (A33).

## Speed rules
Read only CLAUDE.md, COORDINATION.md, `denials.js` (stub), `remittances.js` (hooks), `claims.js`, `handoffs.js`, `modules/claima/features/lifecycle/` (timeline excerpt component — copy), `modules/pactum/features/performance/perf-charts.js` (copy), `shared/config.js`, your files. Seed: root-cause list (hand-written ~15), extend A29's denials to ~14 across states; payer appeal windows. Verify: `node --check`, load each route once, triage + route one denial. Reply: routes + published helpers + open requests.

## Entities
```
denial += scope (Claim|Line), payerReason {code, text}, class (Corrigible|Appealable|Write-Off Candidate)|null, rootCauseId|null,
  route { kind: Recode|ChargeCorrection|AuthRework|Refresh|DefensioHandoff|PayerReconsideration|WriteOff, ref, at, by, reason|null, active: bool }|null, routeHistory:[],
  status (Untriaged|Triaged|Routed|In Progress|Recovered|Partially Recovered|Written Off|Lost|Deadline Passed|Manually Resolved),
  assignee|null, deadline { appealBy, passed: bool }, repeatCount, previousDenialId|null,
  amounts { denied, recovered, writtenOff, lost, open }, resolvedAt|null, resolution {kind, ref, by, reason|null, manual: bool}|null
rootCause: id, label, group (Registration|Eligibility|Authorization|Coding|Charge|Documentation|Contract|Payer), suggestedClass, suggestedRoute
CONFIG.claima.denials = { appealWindowDays: {default: 30, byPayer: {}}, deadlineWarnDays: 7 }
```
**Router** `suggest(denial)` → class + route from root cause (overridable). Routing creates the linked work item via the consumer helpers and stores `route.ref`; one active route; re-route requires reason (previous kept in `routeHistory`). **Derived resolution**: on `remittances.afterPostHooks` for a claim in the denial's family: paid ≥ denied → Recovered; 0 < paid < denied → Partially Recovered and a new denial for the remainder (`previousDenialId`, `repeatCount+1`); denied again → reopen repeat. `resolveWrittenOff` → Written Off. Hand-off outcomes Won/Lost/Settled → Recovered/Lost/Partially. Manual resolve: role `canResolveDenial` + reason, flagged. Invariant checked in `selfCheck()`: denied = recovered + lost + writtenOff + open for every denial. Deadlines computed on read; passing sets Deadline Passed status without write-off.

## Screens
**Worklist** `#/claima/denials`: rail (Open value, Untriaged, In progress, Recovered MTD, Written off MTD). Table: Untriaged first then amount desc; columns Denial, Claim, Patient, Payer, Amount, Scope, Payer reason, Class, Root cause, Route (chip + link), Status, Assignee, Age, Appeal deadline (countdown, amber ≤ 7d, red passed). Search; filters Payer / Status / Class / Reason / Root cause / Route / Amount band / Dates / Deadline. Bulk triage for selected same-reason denials (class + root cause + route applied to all, audited per denial). Assign / self-assign.
**Denial page** `#/claima/denials/:id`: header + amounts strip (denied / recovered / written off / lost / open). Evidence: denied lines (billed, expected stamped, denied, code), contract version chip, linked auth / referral / documents, claim timeline excerpt (last 8 events, link to full). **Triage panel**: Class*, Root cause* (grouped select), suggested route (auto, override select), Route button → creates the work item and shows its link; re-route (reason). Resolution panel (derived state + manual resolve for roles). Repeat chain links. History.
**Analytics** `#/claima/denials/analytics`: period; side-by-side **Payer reasons vs Root causes** (count, amount, recovery rate, avg resolution days, monthly trend); breakdowns by Payer / Department / Service line / Doctor; repeat patterns (root cause × payer with repeatCount ≥ 2); **Prevention feed** ranked by denied value with the owning feature named; export CSV; footnote reconciliation with Pactum Performance denial figures (`selfCheck`).

## Done when
Worklist ordering + bulk triage, evidence-based triage with suggested routing, all seven route kinds create navigable work items, derived resolutions on remittance/hand-off/write-off, invariant self-check, deadlines, analytics + prevention feed, `denials.nearDeadline` published. Append `### 31`; COORDINATION Status.