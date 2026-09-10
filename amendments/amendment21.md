# Amendment 21 — Frontis: Patient Accounts (Part A — Ledger, Posting, Payments, Deposits)

F10 is split in two to fit a session. **Part A**: the account + append-only ledger, charge posting through the billing engine, payments with receipts and allocation, deposits lifecycle, upfront settlement mode, and migration of F9's clearance-side payments. **Part B (amendment 22)**: reconciliation/settlement, adjustments & refunds, SOA, flags.

## Speed rules
- Read only CLAUDE.md, `data/engines/billing-engine.js` (`evaluateCharge`), `data/engines/clearance-engine.js` (item 5), `data/repositories/payments.js` (F9), `acknowledgments.js`, `estimates.js` (result shape), `encounters.js` (financial stamp, `linkRecord`, `chargesPosted`), `features/clearance/payment-dialog.js`, `shared/config.js`, `shared/roles.js`, and the files named here.
- Purely additive, except: F9's `payments` repository becomes a thin facade over the ledger (same API, writes ledger rows), and the clearance engine's item 5 reads from the account (`deposits held + upfront paid`), with Upfront Settlement mode now real.
- Seed: ledgers for ~8 seeded patients derived from existing encounters/estimates/payments (generate transactions from those, don't hand-write ledgers).
- Verify: `node --check`, load each route once, post charges to one encounter and record one payment, stop.
- Reply: route list + open questions only.

## Files
```
data/seed/accounts.js  data/repositories/accounts.js        account header + balances (computed from ledger)
data/repositories/ledger.js (+ seed/ledger.js)              append-only transactions; the only financial write path
data/engines/account-engine.js                              pure: balances, allocation, deposit lifecycle, upfront auto-apply
modules/frontis/features/accounts/
  accounts-list.html / accounts-list.js                     #/frontis/accounts
  account-view.html / account-view.js                       #/frontis/accounts/:mrn  (tabs: Transactions · By Encounter · Deposits · Receipts & Documents · History)
  account-tabs.js                                           tab renderers
  post-charges.html / post-charges.js                       #/frontis/encounters/:no/post-charges
  payment-form.js                                           capture payment (replaces F9's dialog, reused by clearance)
  deposit-actions.js                                        apply / refund dialogs
  receipt-view.js                                           printable receipt (RCP-…)
  account-history.js                                        copy bound to "account"
shared/roles.js                                             add canRefund, canAdjust
shared/config.js                                            CONFIG.clearance.paymentMode.IP may now be "Upfront Settlement"; CONFIG.accounts = { outstandingThreshold: 500 }
```
Nav: Frontis → Accounts (badge = accounts with outstanding). Patient record: header **Account** button; Encounter page: Linked Records → Account row live; header action **Post charges** (Active, not Cancelled); board gains a "Settled ✓" marker column later (Part B). Push a merge re-link hook (ledger rows re-point `patientMrn`).

## Entities
```
account: mrn (1:1 with patient), openedAt, status (Open|Closed), flags [] (Part B), updatedAt
ledgerTx: id, seq (global sequential), at, by, patientMrn, encounterNo|null,
  type: Charge | Payment | DepositHeld | DepositApplied | DepositRefund | Adjustment | Refund | Reversal
  amount (positive), side: "patient"|"payer" (Charge carries both portions in detail; ledger balance uses patient side),
  detail: { itemId, qty, gross, allowed, payerShare, patientShare, isOverage, componentId, trace (billing engine trace ref) }  // Charge
          { purpose (Settlement|Deposit|Balance payment), method, reference, receiptNo, allocations:[{chargeTxId, amount}] }  // Payment
          { sourceReceiptNo, appliedTo:[{chargeTxId, amount}] }                                                              // Deposit*
  reversesTxId|null, reason|null, status (Posted|Reversed)
receipt: receiptNo ("RCP-2026-000512", sequential), txId, printedAt[]
```
Ledger repository: `append(tx)` only (assigns `seq`, audits); `byPatient(mrn)`, `byEncounter(no)`, `reverse(txId, reason)` → new Reversal row (never edits). No update/delete.

## Engine — `account-engine.js`
- `balances(mrn)` → `{ totalCharges, payerShare, patientShare, paid, depositsHeld, outstanding = patientShare − paid − depositsApplied }` and per-encounter `{ charges, patientShare, paid, depositsApplied, upfrontPaid, unpaid }`.
- `openCharges(mrn)` → patient-side charge lines with unpaid remainder, oldest first.
- `allocate(paymentAmount, charges, selection|null)` → oldest-first allocations unless a manual selection is given; unallocated remainder stays as credit on the encounter (or account when no encounter).
- `postCharge(encounter, line, at)` → runs `evaluateCharge(contractVersionAt(encounter.financial, at), planId, patientCtx, encounterCtx, line)`; Self-Pay → gross at CDM standard, patientShare 100%, no engine; returns one Charge row per priced line plus separate rows flagged `isOverage` for overage lines and per-component consumption rows for bundles. **Upfront auto-apply**: if `paymentMode` for the encounter type is Upfront Settlement and the encounter has an unallocated upfront Payment (purpose Settlement), allocate its remaining credit to the new charge's patient portion immediately (append allocation to the payment's detail via a new `DepositApplied`-like row `PaymentApplied`… keep it simpler: record allocation on the Payment's `allocations` through a dedicated `allocate` ledger row type `Allocation`).
- `depositLifecycle(mrn)` → each DepositHeld with applied/refunded rows → status Held | Applied | Partially applied | Refunded.

## Accounts list — `#/frontis/accounts`
Metric rail: Outstanding total, Accounts over threshold, Deposits held, Payments today. Table sorted outstanding desc: Patient (name + MRN), Open encounters (count + types), Total charges / Patient share, Payments + Deposits, **Outstanding** (bold, red over threshold), Last transaction, Flags (chips — Part B fills the logic; render `account.flags`). Search (patient), filters Outstanding (any / over threshold / zero), Flags, Activity period. Row → account view.

## Account view — `#/frontis/accounts/:mrn`
Header: patient banner + six figures (Total Charges, Payer Share, Patient Share, Paid, Deposits Held, Outstanding). Actions: Record payment, Post charges (menu of the patient's Active encounters), Generate SOA (Part B — disabled with tooltip for now).
Tabs:
- **Transactions**: full ledger with running patient-side balance; columns Seq, Date, Encounter, Type chip, Description (item / purpose / reason), Payer portion, Patient portion, Paid/Applied, Running balance, By; filters Type / Encounter / Date range; Reversed rows struck-through with link to the reversal.
- **By Encounter**: one row per encounter: no., type, status, Charges, Payer share, Patient share, Paid, Deposits applied, Unpaid, Settlement status (placeholder "—" until Part B); expand → charge lines with overage lines highlighted and bundle component consumption.
- **Deposits**: Held/Applied/Refunded table with source receipt, encounter, amount, applied/refunded rows, actions Apply to charges (manual) · Refund (role `canRefund`, Reason*).
- **Receipts & Documents**: receipts (no., date, amount, purpose, Print) + acknowledgment/signed-copy documents linked from encounters.
- **History**: audit.

## Post charges — `#/frontis/encounters/:no/post-charges`
Left: encounter/classification banner (payer/plan/contract version at posting date, or Self-Pay); lines table (reuse estimate-lines: CDM picker incl. bundles, qty, consumption sub-table for bundles), "Load from estimate" (prefills lines from the encounter's linked issued estimate), posting date (default now). Right: **Preview** via `postCharge` without writing — per-line gross/allowed/payer/patient, overage lines, held-for-approval lines (pre-auth) shown amber. Button **Post** → appends Charge rows, sets `encounter.chargesPosted = true`, links account, recomputes clearance, toast; upfront auto-apply happens here when applicable. Manual entry of payer/patient split is not possible anywhere.

## Payment — `payment-form.js` (from account header, encounter page, and F9 clearance)
Amount*, Purpose* (Settlement | Deposit | Balance payment), Method*, Reference, Encounter (optional; required for Deposit and Settlement). Purpose Settlement on an Upfront-mode encounter pre-fills the acknowledged estimate's patient share and shows "Upfront settlement — will auto-apply as charges post". Allocation panel: oldest-first proposal over `openCharges` with checkboxes to override. Save → Payment row (+ allocations) or DepositHeld row → receipt (sequential) → printable receipt view → clearance recompute → audit.
F9 migration: existing seeded clearance payments become DepositHeld rows with `sourceReceiptNo`; `payments.js` API kept, delegating to the ledger.

## Deposits — `deposit-actions.js`
Apply: pick charges (oldest first default) → DepositApplied row(s). Refund: role `canRefund`, Reason*, Method, Reference → DepositRefund row. Both audited; lifecycle visible on the tab.

## Clearance item 5 (update in `clearance-engine.js`)
Deposit mode: received = Σ DepositHeld − Refunds for the encounter. Upfront Settlement mode: required = acknowledged estimate's patient share; received = Σ Payments with purpose Settlement for the encounter; Passed when ≥ required. Detail text names the mode.

## Seed
Generate from existing data: for each Discharged/Completed seeded encounter, post its estimate lines (or 2–3 CDM lines) at its start date via `postCharge`; add payments so that examples exist of: fully paid, partially paid, unpaid with deposit held, an Upfront-mode IP with settlement pre-paid and charges partly posted (credit remaining), and one overage line. Receipts numbered sequentially in date order. Migrate F9 seeded payments.

## Done when
Accounts list and account view with all five tabs, posting through the engine with preview and overage/bundle rows, payments with receipts and allocation, deposits held/applied/refunded, upfront auto-apply, F9 clearance reading from the ledger, F9 payments migrated. Changelog entry. Reply with route list + open questions.