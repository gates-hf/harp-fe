# Amendment 29 — Claima: ERA Processing & Payment Posting  (TAG: A29 — runs in parallel with A28, A30)

## Parallel protocol
Follow `modules/claima/COORDINATION.md`. You own ONLY `modules/claima/features/remittance/`, `data/seed/remittances.js`, `data/repositories/remittances.js`, `data/seed/denials.js`, `data/repositories/denials.js` (stub owner until F7 — keep API minimal), `data/seed/unapplied.js`, `data/repositories/unapplied.js`, `data/engines/posting-engine.js`, your `A29` section of `claims.js`. **You are the only Claima session allowed two Frontis touches**: add ledger tx type `PortionShift` in `data/repositories/ledger.js` (additive) and call `settlementEngine.reconcile` after posting. No other session touches Frontis.

## Interfaces (fixed)
**You publish**:
- `remittances.byClaim(claimNo)` → `[{remittanceNo, at, paid, adjusted, denied, lines}]`
- `remittances.afterPostHooks[]` `{remittanceNo, claimNos, at}` — A30 subscribes (timeline, follow-up clearing, first-payment stats)
- `denials.byClaim(claimNo)`, `denials.worklist()` — F7 will take over
- `unapplied.byPayer()`
**You consume**: `claims.setStatus`, `claims.assembleFor` (secondary activation), claim `lines[].allowedExpected` (stamped — never recompute) (A27); `batches.byClaim` (A28, display); `ledger.append`, `settlementEngine.reconcile`, `accounts.*` (Frontis F10); `handoffs` repository (Pactum amendment 11 — create Defensio hand-offs with `{claimNo, lineId, contractId, amount, tolerance}`); `contracts.*` for payer tolerance (`CONFIG.claima.posting.tolerance[payerId] ?? {pct: 0.05, amount: 25}`).

## Speed rules
Read only CLAUDE.md, COORDINATION.md, `claims.js`, `ledger.js` (types + append), `data/engines/settlement-engine.js` (reconcile signature), `data/repositories/handoffs.js`, `modules/pactum/features/payer-master/bulk-import.js` (parse/preview pattern), `shared/config.js`, your files. Seed: 6 remittances (states below) + a built-in sample ERA file (CSV) with 2 bad rows. Verify: `node --check`, load each route once, post the sample remittance. Reply: routes + published helpers + open requests.

## Entities
```
remittance: remittanceNo ("RMT-2026-000077"), payerId, payment { reference, date, method (EFT|Cheque|Transfer), total }, capture { mode: File|Manual, fileName|null, storedFile (string)|null, parseReport {read, failed:[{row, reason}]}|null, by, at },
  claims:[{ claimNo|null, payerClaimRef, matchStatus (Matched|Ambiguous|Unmatched), candidates:[claimNo], lines:[{ lineRef, claimLineId|null, billed, expected, paid, adjustment, adjCode|null, denied, denialCode|null, variance, outcome (Paid in full|Underpaid|Overpaid|Denied|Adjusted), matchStatus }] }],
  status (Unposted|Posted with Exceptions|Posted|Closed), exceptions:[{id, kind (AmbiguousMatch|Unmatched|Residue|Overpayment), ref, amount, resolution|null}], unapplied, postedAt|null, postings:[{ txIds, claimNos, at, by, reversedBy|null }]
denial: id, claimNo, lineId, remittanceNo, code, reason, amount, status (Open), createdAt      // F7 owns later
unappliedCash: id, payerId, remittanceNo, amount, since, status (Held|Applied|Refunded|Adjusted), resolution {kind, ref, reason, by, at}|null
CONFIG.claima.posting = { unappliedAgeWarnDays: 30, tolerance: {...}, adjCodes: [CO-45 Contractual, CO-97 Bundled, PR-1 Deductible, PR-2 Coinsurance, OA-23 Prior payer, …] }
```
**Posting engine** `post(remittance)` → for each Matched claim with all lines matched: per line compare paid/adj/denied vs `expected`; outcomes; ledger: claim Paid / Partially Paid / Denied via `claims.setStatus`; contractual adjustments recorded on claim lines with code; **denied line → exactly one `denials` record**; patient-responsibility shift (PR-* codes) → ledger `PortionShift` row on the encounter's account `{payerShare: −x, patientShare: +x, origin: {remittanceNo, claimNo, lineId}}` then `settlementEngine.reconcile(encounterNo)` (Settled → Unsettled regression happens there); underpayment beyond tolerance → `handoffs.create`; overpayment → exception Overpayment (role-resolved: refund payer / apply / adjust); residue → `unapplied`. Control: block unless Σpaid + Σadj + Σdenied + unapplied === total. Clean claims post while exceptions remain → status Posted with Exceptions; zero exceptions → Posted; explicit Close → Closed. Corrections: `reversePosting(postingId, reason)` → reversal rows + repost. **Secondary**: after posting a Primary claim whose encounter has a secondary policy → `claims.assembleFor(encounterNo, {kind: "Secondary", primaryPayment: {...}})`; chain both ways.

## Screens
**Workbench** `#/claima/remittances`: rail (Unposted, Unposted value, Exceptions open, Unapplied cash). Table sorted Unposted first, oldest: Remittance no., Payer, Payment ref / date / method, Total, Claims covered, Matched/Unmatched, Posting status badge, Unapplied, Captured by/at. Search (remittance, payer ref, claim); filters Payer / Status / Dates / Has unapplied. Buttons: Upload ERA · Manual entry · Unapplied cash.
**Upload** `#/claima/remittances/upload`: stepper (file → parse report with downloadable failures → review → save as Unposted); "Load sample file"; file stored immutably (shown read-only later).
**Manual entry** `#/claima/remittances/new`: header (Payer*, Reference*, Date*, Method*, Total* as control figure); claim lookup (validates exists, Submitted/Acknowledged, payer match) → auto-loads lines; per line paid / adjustment + code / denied + code; sticky strip Entered vs Total vs Remaining; failed file rows can be entered here on the same remittance.
**Remittance page** `#/claima/remittances/:no`: header + status; **Match & reconcile grid** per claim: Billed, Expected (stamped), Paid, Adj (+code), Denied (+code), Variance, Outcome badge, match status; ambiguous rows open a side-by-side matcher (candidates with amounts/dates; choose); control strip; button **Post** (partial allowed) → fan-out summary dialog ("3 claims posted · 2 denials created · 1 patient shift $120 · 1 Defensio hand-off · $75 unapplied"); Exceptions panel (kind, ref, amount, resolution path button); Close (zero exceptions); Postings tab (append-only, reverse with reason → pair); History.
**Unapplied cash** `#/claima/remittances/unapplied`: by payer: remittance, amount, age (red > 30d); actions Apply to claim (lookup) · Refund to payer (role + reason) · Adjust (role + reason); every movement audited.

## Seed
6 remittances: 2 Unposted (one file-captured with parse failures, one manual partially entered), 1 Posted with Exceptions (1 ambiguous, 1 overpayment), 1 Posted with a denial + patient shift + Defensio hand-off, 1 Closed, 1 whose primary posting spawned a Secondary. Unapplied: 3 rows, one > 30 days. Denials: as created. Sample ERA CSV with header/claim/line rows, 2 invalid.

## Done when
Workbench, both capture paths, matching grid with control block, partial post with exception list and full fan-out (claims, denials, account shift + settlement recompute, hand-off, unapplied), reversal pairs, unapplied resolutions, secondary activation with chain. Append `### 29`; COORDINATION Status.