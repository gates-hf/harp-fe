# Amendment 25 — Claima: Charge Capture  (TAG: A25 — runs in parallel with A26, A27)

## Parallel protocol
Read `modules/claima/COORDINATION.md` first and follow it exactly. You own ONLY: `modules/claima/features/charge-capture/`, `data/seed/charges.js`, `data/repositories/charges.js`, `data/seed/feeds.js`, `data/repositories/feeds.js`. Shared files: one-line/one-block edits under `A25`. Everything cross-feature goes through the interfaces below. If a peer helper you need isn't in "Published helpers" yet, call it behind a feature-detect (`repo.fn?.(…)`) and file a Request; never wait idle — build your own screens first.

## Interfaces (fixed — A26/A27 were written against these exact signatures)
**You publish** (in `data/repositories/charges.js`, list them in COORDINATION.md as soon as they exist):
- `charges.byEncounter(no)` → all capture lines
- `charges.releasedByEncounter(no)` → released lines only
- `charges.release(no, lineIds|null, user)` → releases (null = all clean); pushes `{encounterNo, lineIds, at}` to `charges.afterReleaseHooks[]`
- `charges.afterReleaseHooks` (array) — A26 subscribes to feed the coding worklist
- `charges.afterCorrectionHooks` (array) — fired on reversal/repost/hold after release; A27 subscribes to mark claims Stale
- `charges.lateCharges(no)` → lines flagged Late
**You consume**: `accountEngine.postCharge(encounter, line, at)` + `ledger.append` (F10, exists), `encounters.*`, `cdm.findActive()`, `claims.onLateCharge?.(encounterNo, lineIds)` (published by A27).

## Speed rules
Read only CLAUDE.md, COORDINATION.md, `data/engines/account-engine.js` (`postCharge`), `data/repositories/ledger.js`, `encounters.js`, `modules/frontis/features/accounts/post-charges.js` (reuse its line editor + preview), `shared/config.js`, and your own files. Seed: generate capture lines from existing posted ledger charges (every Charge tx becomes a capture line with provenance) + ~10 unreleased lines and 3 feed events; hand-write nothing else. Verify: `node --check`, load each route once. Reply: routes + published helpers + open requests.

## Files
```
modules/claima/features/charge-capture/
  unbilled-worklist.html/.js         #/claima/charges          (encounter-grouped, expandable)
  manual-charge.js                   modal: encounter + CDM item + DOS + qty + doctor + reason
  charge-line-actions.js             edit / replace (reversal+repost) / cancel / hold / release / late-charge dialogs
  capture-health.html/.js            #/claima/charges/health   (gaps, zero-price, feed status)
  feed-simulator.js                  "Run feeds now" — processes seeded order/event triggers
  charge-history.js
data/seed/charges.js  data/repositories/charges.js
data/seed/feeds.js    data/repositories/feeds.js
```
Nav: Claima → Charges (badge = encounters with unreleased lines). Encounter page (Frontis): Linked Records → "Charges" row (count + link) via `encounters.linkRecord` — request A? no: this is a Frontis file; only add the row through the existing generic Linked Records list if it accepts a registration hook, otherwise link from your worklist only.

## Entities
```
chargeLine: id, encounterNo, patientMrn, itemId, qty, dateOfService, doctorId|null,
  source { type: Order|Event|Procedure|Manual, ref, capturedBy ("System"|user), reason|null },
  pricing { gross, allowed, payerShare, patientShare, undecided, isOverage, componentId|null, trace }, ledgerTxIds: [],
  status: Unreleased | Held | Released | Reversed, holdReason|null, flags: [Late|ZeroPrice|Manual|CdmGap|Disputed],
  releasedAt|null, releasedBy|null, late { window: bool, approvedBy|null, reason|null }|null, reversesId|null, createdAt
feedEvent: id, type (Order|Event|Procedure), ref, encounterNo, itemId, qty, dateOfService, trigger (OnOrder|OnCompletion|Midnight), status (Pending|Captured|Failed), capturedLineId|null, at
CONFIG.claima.capture = { lateWindowDays: 7, triggers: { Lab: "OnCompletion", Radiology: "OnCompletion", Pharmacy: "OnOrder", Procedure: "OnCompletion", "Room & Board": "Midnight" } }
```
Repository: `capture(encounterNo, line, source)` → validates encounter (not Cancelled; DOS within start..end), prices via `postCharge`, appends ledger rows, stores `ledgerTxIds`, flags ZeroPrice when allowed===0 && gross===0, flags Late when encounter Discharged/Completed or already released (window check vs `lateWindowDays`; outside → requires `role.canLateCharge` + reason), audits; `edit(id, {qty,dateOfService,doctorId})` → reversal + repost pair (unreleased only); `replace(id, newItemId)`; `cancel(id, reason)`; `hold/unhold(id, reason)`; `release(...)`; `byEncounter`, `unbilledGrouped()` (sorted Discharged first, then oldest line), `lateCharges`, `zeroPrice()`, `gaps()` (encounters with IP nights but no Room & Board line for a night → per seed), feeds: `run()` (Pending events → capture; `lastRunAt`, counts per source).

## Screens
**Unbilled worklist** `#/claima/charges`: rail (Encounters unreleased, Lines, Gross unreleased, Held). Grouped table: Encounter (no + patient), Type, Department, Encounter status, Lines, Gross, Payer, Flags chips, Oldest charge age; expand → lines: DOS, CDM code + desc, Qty, Source (type chip + ref), Gross, Payer/Patient, Status, Flags; row actions Edit · Replace · Cancel · Hold/Unhold · Release line. Group actions: Release encounter (clean lines only; held/flagged lines listed as excluded). Search + filters (Department, Line status, Flags, DOS range, Source type). Buttons: Manual charge, Run feeds now, Capture health.
**Manual charge**: encounter picker (Active/Discharged, not Cancelled), CDM picker (Active), DOS (bounded), Qty, Doctor (required when item category needs one), Reason* → preview via `postCharge` (read-only amounts) → Capture. Late banner when applicable; outside window → role gate.
**Capture health** `#/claima/charges/health`: three panels — Gaps (encounter, signal, missing item, link), Zero-price lines (item, encounter, link + "Open in CDM"), Feed status (source, last run, captured today, failed) + Run now.

## Seed
Every existing Charge ledger tx → a Released capture line with source Order/Event/Procedure inferred from category (Manual for two). Add ~10 Unreleased lines on 3 Active encounters (one Held, one ZeroPrice, one Late within window, one Late beyond window pending approval), 1 Discharged encounter with unreleased lines (sorts first), 5 feed events Pending (2 midnight bed-nights, 2 lab completions, 1 procedure) so "Run feeds now" captures visibly. One gap (IP encounter with 3 nights, 2 room lines).

## Done when
Worklist grouped/expandable with all actions, manual capture priced by engine, feeds run, health panels link, release fires hooks, late window + role gate, history. Append `### 25` to CLAUDE.md; publish helpers; update COORDINATION Status.