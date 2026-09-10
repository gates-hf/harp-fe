# Amendment 22 — Frontis: Patient Accounts (Part B — Settlement, Adjustments & Refunds, SOA, Flags)

Completes F10 on top of amendment 21's ledger. Everything here is either a computed view over the ledger (reconciliation, flags) or a new append-only transaction type (adjustment, refund, reversal pair) or an immutable document (SOA).

## Speed rules
- Read only CLAUDE.md, `data/repositories/ledger.js`, `accounts.js`, `data/engines/account-engine.js`, `features/accounts/account-view.js` + `account-tabs.js`, `features/estimates/estimate-view.js` (print layout), `features/encounters/encounter-board.js` + `encounter-view.js`, `data/repositories/encounters.js` (`reclassify`), `shared/config.js`, `shared/roles.js`, and the files named here.
- Purely additive, except: `encounters.reclassify` now posts reversal + repost pairs for unsettled charges; account view's Generate SOA and the By Encounter settlement column go live.
- Seed: no new base data — add the handful of adjustments/refunds/settlements needed to show each state, plus 2 generated SOAs.
- Verify: `node --check`, load each route once, settle one encounter and generate one SOA, stop.
- Reply: route list + open questions only.

## Files
```
data/engines/settlement-engine.js              pure: reconcile(encounter) → estimated vs actual vs paid, outcome
data/seed/soa.js  data/repositories/soa.js     immutable statements
modules/frontis/features/accounts/
  settlement-panel.js                          reconciliation view + actions (used in By Encounter expand and encounter Financial tab)
  adjustment-form.js                           adjustment / refund / write-off dialogs
  soa-generate.html / soa-generate.js          #/frontis/accounts/:mrn/soa/new
  soa-view.html / soa-view.js                  #/frontis/accounts/soa/:no  (printable, EN/AR)
  account-flags.js                             flag computation + list/home consumers
shared/config.js                               CONFIG.accounts += { unsettledAfterDays: 3, adjustmentReasons: [...], refundReasons: [...] }
```
Nav: none new. Encounter board: **Settled ✓** marker (column or chip in Status). Encounter page Financial tab: settlement panel. Account view: settlement status in By Encounter, SOA list on Receipts & Documents tab, Generate SOA action live.

## Settlement engine — `settlement-engine.js`
`reconcile(encounterNo)` → 
```
{ estimatedShare (acknowledged estimate's patient share | null), actualShare (Σ patient portions of posted charges, net of reversals/adjustments),
  paid (payments allocated + deposits applied to this encounter), difference = actualShare − paid,
  outcome: "Settled" | "Unsettled" (difference > 0) | "Excess" (difference < 0) | "Pending" (no charges yet),
  drivers: [ { chargeTxId, item, estimated|null, actual, delta, isOverage } ]   // lines causing estimate-vs-actual gaps, overage first
  mode: Deposit | Upfront Settlement | None, runsContinuously: mode === Upfront }
```
`markSettled(no)` → ledger row type `Settlement` (amount = actualShare, references the reconciling txs) + `encounter.settlement = { status: Settled, at, by }`; audited. Triggers: **continuous** on Upfront-mode encounters (after every posting/payment, if difference === 0 → auto-mark); **at completion** for Deposit-mode (on Discharge/Complete: auto-apply held deposits oldest-first, then reconcile; Settled if zero, else leave Unsettled with residual); **manual** "Settle now" by cashier from the panel. A Settled encounter with a later posting reverts to Unsettled (audited).

## Settlement panel — `settlement-panel.js`
Three-column strip: Estimated share → Actual share → Paid, then **Difference** with outcome badge (Settled ✓ / Residual $x / Excess $x / Pending). Drill-down table of drivers (item, estimated, actual, delta; overage rows highlighted; "not in estimate" rows tagged). Actions by outcome: Unsettled → Record payment (prefilled residual) · Write-off (Adjustment, role `canAdjust`, reason*); Excess → Refund (role `canRefund`, reason*) · Hold as credit (records patient consent: "Patient consented to hold $x as credit" — Consent by name*, method*) — choice audited; Settled → none; Pending → "Post charges". Note line: "Estimates never settle — only actual charges do."

## Adjustments, refunds, reversals — `adjustment-form.js`
- **Adjustment**: references original Charge tx*, Reason* (config list: Contract correction, Duplicate posting, Write-off — management approval, Goodwill, Other), Amount* (≤ remaining patient portion), note → Adjustment row (reduces patient portion), role `canAdjust`, audited.
- **Refund**: references Payment/Deposit tx*, Reason*, Amount* (≤ unallocated/credit), Method, Reference → Refund row, role `canRefund`, receipt-style **refund voucher** printable, audited.
- **Reclassification pairs**: `encounters.reclassify` → for every unsettled Charge on the encounter: Reversal row (reversesTxId) + new Charge row re-priced through `postCharge` against the new classification; both tagged "Re-classification PA…/policy change"; visible as paired rows in Transactions; Settled encounters are not touched (blocked with a message).
All rows append-only; nothing edits a prior row.

## SOA — `soa-generate.js`, `soa-view.js`
Generate (`/accounts/:mrn/soa/new`): Scope* (Account | Encounter(s) picker | Period from–to), Detail* (Summary | Detailed lines), Language* (EN | AR — RTL layout, Arabic labels from a small dictionary; numbers Latin), then Preview → **Generate** → `soa.create` freezes `{ no ("SOA-2026-000089"), mrn, params, generatedAt, by, snapshot: { header figures, encounters:[{no,type,dates,charges,payerShare,patientShare,payments,deposits,adjustments,settlementStatus,lines?}], totals, balanceDue } }`, audited. Reconciliation check at generation: snapshot totals must equal `balances(mrn)` for the scope — assert and refuse with an error if not.
View (`/accounts/soa/:no`): printable statement — hospital header, patient, statement no./date/scope, per-encounter blocks with portions and settlement status, payments/deposits/adjustments/refunds section, totals ending in **Balance Due**; "Reprint" prints identically from the snapshot; "Generate new" → new number. PDF via print. SOAs list on the Receipts & Documents tab.

## Flags — `account-flags.js`
Computed on every ledger write (repository `afterWrite`), stored on `account.flags`:
- `OutstandingOverThreshold` (outstanding ≥ CONFIG.accounts.outstandingThreshold)
- `UnsettledCompleted` (Discharged/Completed encounter with outcome Unsettled for ≥ `unsettledAfterDays`)
- `UnappliedDeposit` (DepositHeld with remaining > 0 and no open charges on its encounter, or encounter terminal)
- `ExcessToResolve` (outcome Excess with no refund/consent recorded)
Rendered as chips on the accounts list (filterable) and exposed via `accounts.flagged(kind)` for the Home screen (F0). Flags clear automatically when recomputed false.

## Board & encounter page
Board: Settled ✓ marker on encounters with `settlement.status === Settled`; filter "Unsettled completed". Encounter Financial tab: settlement panel below the classification card. Discharge dialog: after LOS confirm, show the reconciliation result inline ("Deposits applied $620 — residual $80") before closing.

## Seed additions
One Settled ✓ upfront IP; one Discharged Deposit-mode IP with residual (Unsettled, flagged after 3 days); one Excess with patient consent held as credit; one Excess refunded (voucher); one re-classified encounter showing reversal/repost pairs; one adjustment (duplicate posting). Two generated SOAs (one EN detailed account-scope, one AR summary encounter-scope).

## Done when
Reconciliation with drivers and all four outcomes, auto-settlement on upfront and at discharge, manual settle, adjustments/refunds/write-offs with roles and reasons, reclassification pairs, SOA generation in EN/AR with reconciliation assert and identical reprint, flags on list + `accounts.flagged()` ready for Home, Settled ✓ on the board. Changelog entry. Reply with route list + open questions.