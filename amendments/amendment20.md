# Amendment 20 — Frontis: Financial Clearance

F9. Clearance is a **computed view**, not a form: a pure engine reads eligibility snapshots, referral links, auth status, estimates/acknowledgments and payments, and derives the checklist and status. The encounter's `clearance` stamp (set in amendment 15 as a placeholder) becomes the engine's output, recomputed on every store change. Item 5 is built as **Payment / Deposit** with a per-encounter-type mode so F10 (Patient Accounts, with upfront settlement) slots in without reshaping.

## Speed rules
- Read only CLAUDE.md, `data/repositories/encounters.js` (clearance stamp, `linkRecord`), `eligibility.js` (`latestValid`, snapshot shape), `referrals.js` (`validForEncounter`), `preauth-requests.js` (`activeFor`, `byEncounter`), `estimates.js` (`validForClearance`, `byEncounter`), `contracts.js` (`referralRequired`, `resolvePreAuth`), `data/engines/eligibility-engine.js` (conditions shape), `features/encounters/encounter-board.js` + `encounter-view.js`, `shared/config.js`, and the files named here.
- Purely additive, except: encounter page gains a Clearance tab and the board's Clearance column reads the engine; the placeholder `clearance.items` writers from amendments 15/18/19 are replaced by the engine (remove those ad-hoc pushes).
- Seed: acknowledgments + payments for ~6 seeded encounters to produce Cleared / Conditional / Blocked / regressed examples.
- Verify: `node --check`, load each route once, collect one deposit and watch the status flip, stop.
- Reply: route list + open questions only.

## Files
```
data/engines/clearance-engine.js               pure: compute(encounter) → checklist + status
data/seed/acknowledgments.js + repositories/acknowledgments.js
data/seed/payments.js + repositories/payments.js      clearance-side payments; F10 migrates them to accounts
modules/frontis/features/clearance/
  clearance-worklist.html / .js                #/frontis/clearance
  clearance-view.html / clearance-view.js      #/frontis/encounters/:no/clearance  (also the encounter's Clearance tab)
  clearance-checklist.js                       renders items + jump-to actions
  acknowledge-dialog.js                        estimate acknowledgment
  payment-dialog.js                            collect deposit / payment
shared/config.js                               CONFIG.clearance (below)
```
Nav: Frontis → Clearance (badge = Blocked). Encounter page: **Clearance** tab (first tab when status ≠ Cleared) + header indicator now from the engine; Linked Records → Clearance row live. Board: Clearance column = engine status + tooltip listing blocking items.

## Config — `shared/config.js`
```
CONFIG.clearance = {
  acknowledgmentRequired: { OP: false, IP: true, ER: false, DayCase: true },
  ackMethods: ["Signed in person", "Verbal (documented)", "E-signature", "Guardian signed"],
  paymentMode: { OP: "None", IP: "Deposit", ER: "None", DayCase: "Deposit" },     // Deposit | Upfront Settlement | None  (F10 adds Upfront)
  depositPct: { selfPayIP: 1.0, insuredIP: 0.5, OP: 0 },
  pendingAgeWarnHours: 24 }
```

## Engine — `clearance-engine.js`
`compute(encounter, ctx)` → `{ status, items, blocking: [labels], pendingSince }`. Items, each `{ key, label, state: Passed|Pending|Failed|N/A, detail, action: {label, route}|null, since }`:
1. **Eligibility** — Self-Pay → N/A "Self-Pay encounter". Else read `encounter.financial.snapshotRef`: final result Eligible → Passed; With Conditions → Passed (conditions listed in detail); Not Eligible (not overridden) → Failed; snapshot missing or older than 7 days at service date → Pending "Re-check needed". Action: Re-check eligibility → `#/frontis/eligibility/new?mrn=&policyId=&encounterId=`.
2. **Referral** — Self-Pay → N/A. Contract's `referralRequired(contract, item)` false for all anticipated services (or no contract) → N/A "Not required by <payer>". Required and `encounter.linked.referralId` valid → Passed; missing → Failed "Referral required by payer — missing"; linked but expired/used-up → Failed. Action: Link referral → encounter page with the link dialog open.
3. **Pre-Auth** — Self-Pay → N/A. No flagged services (`resolvePreAuth` over encounter's anticipated services, from estimate/snapshot/lines) → N/A "No service requires prior approval". For each flagged service: `activeFor` → Passed; request Submitted → Pending "PA-… awaiting payer"; Denied/Expired/none → Failed. Item state = worst across services; detail lists each. Action: Open auth / Create request → `#/frontis/preauth/new?encounterNo=`.
4. **Estimate acknowledged** — `acknowledgmentRequired[type]` false → N/A "Not required for <type>". Required: no issued valid estimate linked → Failed "No estimate issued" (action Create estimate); estimate present, no acknowledgment → Pending "Awaiting patient acknowledgment" (action Acknowledge); acknowledged → Passed (who/method/when).
5. **Payment / Deposit** — `paymentMode[type]` None → N/A "No payment required before service". Deposit: required = patientShare (from the linked issued estimate's result; if none → Pending "Estimate needed to compute deposit") × pct (`selfPayIP` if Self-Pay, else `insuredIP`); detail shows the calculation "50% × $1,240 = $620"; received = Σ payments for the encounter; received ≥ required → Passed; 0 < received < required → Pending "$220 remaining"; 0 → Failed. Action: Collect deposit. (Upfront Settlement mode: reserved for F10 — treat as Deposit with pct 1.0 for now.)

Status: any Failed → **Blocked**; else any Pending → **Conditionally Cleared**; else **Cleared**. `pendingSince` = earliest `since` among non-passed items (used for "time pending", longest first). **Regression** is automatic because everything is computed: an expired auth or lapsed snapshot flips the item on the next compute.

Wiring: `encounters.refreshClearance(no)` calls the engine and writes the stamp `{ status, items (compact), blocking, pendingSince, computedAt }`; the store's subscribe hook calls `refreshClearance` for affected encounters whenever eligibility, referrals, preauth-requests, estimates, acknowledgments or payments change (repository-level `afterWrite` hooks; keep it simple: recompute all Active/Planned encounters, ~30 rows, on any of those writes). Audit only on **status transitions** ("Clearance: Blocked → Conditionally Cleared (deposit received)").

## Worklist — `#/frontis/clearance`
Metric rail: Blocked, Conditional, Cleared today, Pending > 24h. Toggle **Needs attention | All**. Table sorted status (Blocked, Conditional, Cleared) then pendingSince asc: Patient (name + MRN), Encounter (no. + type chip), Department, Expected service date (startAt), Financial Class, Clearance Status badge, Blocking item(s) (chips, max 2 + "+n"), Time pending (relative; red > 24h). Search (patient, encounter), filters Status / Type / Department / Financial class / Date range. Row click → clearance view. Positive empty state: "Everything is cleared — no patient is waiting on a financial blocker."

## Clearance view — `#/frontis/encounters/:no/clearance` (= encounter Clearance tab)
Header: status badge (large), computed at, "Recompute" button (calls engine; normally unnecessary), pending since. Checklist as five rows (`clearance-checklist.js`): icon by state, label, detail (with the N/A reason always present), "since", and the jump-to action button on Failed/Pending. Below: **Acknowledgment** card (estimate no., acknowledged by/method/when, signed copy) and **Payments** card (required, received, remaining, list of payments with receipt no., method, amount, by/at; Collect button). Read-only on terminal encounters.

## Dialogs
**Acknowledge** (`acknowledge-dialog.js`): estimate selector (issued, valid, linked to this encounter — usually one; link a patient's other valid estimate from here too), Acknowledged by* (Patient | Guardian + name), Method* (config list), Signed copy upload (PDF/JPG/PNG ≤ 10 MB), note. Creates `acknowledgment {id, encounterNo, estimateNo, by, byName, method, document, user, at}`; audited; estimates `markAcknowledged` (flag only).
**Collect payment** (`payment-dialog.js`): shows required/received/remaining, Amount* (default remaining), Method* (Cash | Card | Bank transfer | Cheque), Reference (card/transfer ref), note → creates `payment {id, receiptNo ("RCP-2026-000512"), encounterNo, patientMrn, kind: "Deposit", amount, method, reference, receivedBy, at, migratedToAccount: false}`, prints a simple receipt view, audited. Amount > 0; overpayment allowed with a confirm.

## Seed
Encounters: one IP insured with everything Passed (Cleared); one IP with deposit half-collected (Conditional); one IP Self-Pay with no estimate (Blocked: estimate + deposit); one IP with a Submitted pre-auth (Conditional) and one with a Denied (Blocked); one OP with referral required and missing (Blocked); one encounter whose auth expired yesterday (regressed → Blocked, audit shows the transition). Acknowledgments and payments accordingly; receipts numbered.

## Done when
Engine computes all five items with correct N/A reasons; worklist orders worst/longest first; clearance view with jump-to actions; acknowledgment and payment dialogs flip items live without refresh; board and encounter header show engine status; regression demonstrated by the expired-auth seed; ad-hoc clearance pushes from earlier amendments removed. Changelog entry. Reply with route list + open questions.