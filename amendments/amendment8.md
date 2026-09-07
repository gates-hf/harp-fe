# Amendment 8 — Pactum: Billing Evaluation

Part F of Payer Contract Management. No claims module exists yet, so this amendment delivers the **evaluation engine** as a pure module plus a **Billing Simulator** screen that runs it and shows the traceable breakdown. Claims/invoicing modules will later call the same engine.

## Speed rules
- Read only CLAUDE.md, `data/repositories/contracts.js`, `data/repositories/cdm.js`, `features/rules/rule-evaluator.js`, `features/contracts/contract-actions.js`, and the files named here.
- Purely additive; no refactors. Reuse existing helpers (`resolveMethodology`, `resolvedPrice`, `resolveCoverage`, `patientShare`, `resolvePreAuth`, `evaluate`, `componentSum`, bundle limits).
- Seed: 3 canned scenarios only.
- Verify: `node --check`, load the simulator once, run the 3 scenarios, stop.
- Reply: route list + open questions only.

## Files
```
modules/pactum/features/billing-eval/
  billing-engine.js                        pure: evaluateCharge(), evaluateEncounter() — no DOM
  overage-engine.js                        pure: per-component consumption vs limits
  simulator.html / simulator.js            #/pactum/billing-simulator
  breakdown-panel.js                       traceable breakdown renderer (reused later by claims)
  scenarios.js                             3 canned scenarios
data/repositories/contracts.js             add contractForService(payerId, planId, dateOfService), CDM-populated check in activationBlockers
```
Nav: Pactum → Billing Simulator. Contract page header gets a "Simulate billing" link that opens the simulator pre-filled with that contract's payer/plan.

## `billing-engine.js`
`evaluateCharge(contract, planId, patientCtx, encounterCtx, line)` where `line = { itemId, qty, consumption?: [{componentId, qty|amount}] }`. Returns a **trace** object built step by step:
```
{ item, version, steps: [
  {1 Methodology:   rule used (scope), allowedAmount},
  {2 Overage:       only for bundles — from overage-engine, per-component rows + overage lines},
  {3 Coverage:      row used, patientShare, payerShare},
  {4 PreAuth:       required, source, reason},
  {5 Rules:         fired rules (priority order), outcome, what they overrode} ],
  result: { allowed, patientShare, payerShare, preAuthRequired, status (Priced|Held for approval|Not billable),
            overageLines:[…] , rulesFired:[ids] } }
```
Rule outcomes applied after step 4: Not Billable → allowed 0 both shares 0; % Discount / Fixed Rate / Ceiling → recompute allowed then re-run coverage; Co-pay → replace step-3 share; Requires Prior Approval → preAuthRequired true (overrides matrix); Route to Payer/Patient → shares 100/0 or 0/100; Override Overage Action → re-run overage lines with that action. Every override is recorded in the trace as "was X → now Y (Rule name)".

`evaluateEncounter(payerId, planId, patientCtx, encounterCtx, lines[])` → picks the contract version via `contractForService` (Active on dateOfService; falls back with a clear error "No active contract for plan on date"), evaluates each line, returns totals + all traces.

## `overage-engine.js`
`evaluateOverage(contract, methodologyRow, bundle, consumption)`:
- Flatten the bundle's components; nested bundles explode to their items for consumption but limits are the parent's rows (per US-22).
- Per component: included (limit qty or allowance), consumed, overage = max(0, consumed − included) (qty or amount valued at CDM price).
- Policy = component override if present else bundle policy. Apply tolerance first (% of included or amount); within tolerance → action "Absorbed (tolerance)".
- Actions: Not Billable → absorbed; Bill Payer at Contract Rate → overage qty priced through `resolvedPrice` for that item; Bill Patient → patient 100%; Split per Coverage → price then `resolveCoverage`; Requires Approval → held, amount computed but status pending.
- Returns rows `{component, included, consumed, overage, tolerance, action, source (override|default), amount, payer, patient, status}` and separate **overage lines** flagged `isOverage: true` for the invoice.

## Activation prerequisites (US-23)
Existing `activationBlockers` already covers Default methodology, per-plan Default coverage, bundle rows without policy. Add: "CDM has no active items" and, per Case Rate row, "Bundle <name> has components without limits". Also, on the Methodologies/Overage/Coverage/Pre-Auth tabs, show a blocking empty state "Populate the CDM before configuring contracts" when `cdm.findActive()` is empty.

## Simulator — `#/pactum/billing-simulator`
Left panel **Inputs**: Payer → Plan (active plans of that payer) → Date of service (default today; shows resolved contract + version chip or the no-contract error), Patient (age, gender, nationality), Encounter (admission type, department, LOS, diagnosis code), then **Charge lines** table: item picker (items + bundles), qty; bundle lines expand a **Consumption** sub-table pre-filled with included limits (editable consumed qty/amount per component, nested items shown under their inner bundle). Buttons: Load scenario (3 canned), Run, Clear.
Right panel **Result**: totals card (Allowed, Payer share, Patient share, Held for approval, Not billable, overage total), then one `breakdown-panel` per line: collapsible 5-step trace with the values above; overage table with included / consumed / overage / tolerance / action / source / amount; rules fired with before→after; pre-auth chip. An **Invoice preview** table at the bottom lists all lines with overage lines separately marked (badge "Overage") and a claim-style split column. Export button → CSV. Nothing here writes to the store.

## `scenarios.js`
1. Outpatient Gold plan, Lab items + one Consumable under $20 → shows fee schedule pricing, coverage, and the Not Billable rule firing.
2. Appendectomy Package with 3 extra nights and $150 over the consumables allowance → per-component overage with override vs default, tolerance absorbing one, Bill Payer vs Split per Coverage.
3. Emergency admission LOS 7 with MRI and a $450 CT → pre-auth matrix (threshold) plus the LOS rule forcing prior approval; date of service inside an older contract version to show version selection.
Scenario data must fire on the seeded contracts CTR-0001 / CTR-0005 — adjust the seed minimally if a scenario cannot fire.

## Done when
Engine returns correct traces for the 3 scenarios, simulator renders inputs and breakdown, invoice preview marks overage lines, activation gate includes the CDM checks. Changelog entry. Reply with route list + open questions.