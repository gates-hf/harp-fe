# Amendment 5 — Pactum: Coverage

Part C of Payer Contract Management. Fills the **Coverage** tab of the contract page. Small scope; keep it to the files below.

## Speed rules
- Read only CLAUDE.md, `features/contracts/tab-methodologies.js`, `methodology-form.js`, `contract-actions.js`, and the files named here.
- Purely additive. Copy the Methodologies tab/modal patterns; no refactors.
- Seed: coverage rows for the 2 seeded Active contracts only.
- Verify: `node --check` on new JS, load the contract page once, stop.
- Reply: route list + open questions only.

## Files
```
modules/pactum/features/contracts/
  tab-coverage.html / tab-coverage.js     replaces the placeholder Coverage tab
  coverage-form.js                        add/edit row modal + copy-from-plan dialog
data/repositories/contracts.js            extend with coverage helpers
data/seed/contracts.js                    extend 2 contracts
contract-actions.js                       extend the activation gate
```

## Entity (nested on contract)
```
coverage: [{ planId, rows:[{ id, scopeLevel (Default|Service Group|Category|Item), scopeValue,
  covered: bool, shareType (None|Co-pay %|Fixed Co-pay|Deductible then %), shareValue, deductible (Deductible then % only),
  ceiling|null, updatedAt }] }]
```
Scope value pickers: reuse the Methodologies ones (Service Group list, CDM categories, Active CDM item picker). Same-scope duplicate within a plan is rejected (no dates here, so one row per scope+value).

Repository helpers: `coverageFor(contract, planId)`, `coverageOverlap(contract, planId, row)`, `plansMissingDefaultCoverage(contract)`, `copyCoverage(contract, fromPlanId, toPlanId, mode)` (mode Replace | Merge-keep-existing), `resolveCoverage(contract, planId, item)` (Item → Category → Service Group → Default), `patientShare(allowed, row)`:
- covered=false → allowed
- None → 0
- Co-pay % → allowed × %
- Fixed Co-pay → min(fixed, allowed)
- Deductible then % → min(deductible, allowed) + (allowed − that) × %
- then cap at ceiling if set; payerShare = allowed − patientShare.

**Activation gate**: add "Plan <name> has no Default coverage row" to the existing gate list.

Seed: contract 1 — plan A: Default Co-pay 20% with ceiling $500, Category Pharmacy Co-pay 30%, Category Lab None, one Item Covered=No; plan B copied from A. Contract 2 — one plan, Default Fixed Co-pay $10.

## Coverage tab
Top: **plan selector** (segmented control or dropdown of the contract's linked plans; each shows ✓ or amber "Default missing"). Buttons: Add Row, Copy from plan… (disabled if only one plan). Table for the selected plan: Scope Level, Scope Value, Covered (badge Yes/No), Patient Share (formatted: "20%", "$10", "$100 then 20%", "—"), Ceiling, actions Edit · Remove. Precedence hint under the table. Read-only on non-editable contracts.

**Preview strip** under the table: "Try it" — item picker + Allowed Amount input (default from `resolvedPrice` if a methodology exists) → shows resolved row, Patient Share, Payer Share live. Cheap, and it makes the demo land.

**Row modal**: Scope Level* → Scope Value* (hidden for Default), Covered toggle (default Yes; when No, share fields hide and a note says "Fully patient responsibility"), Share Type*, Share Value* (% 0–100 or amount > 0; hidden for None), Deductible* (Deductible then % only), Ceiling (optional, > 0). Duplicate-scope error names the existing row. Save → audit with diffs.

**Copy from plan dialog**: Source plan*, Mode (Replace all rows | Merge — keep existing, add missing), preview count "Will copy N rows". Confirm → audit "Coverage copied from <plan>".

## Done when
Coverage tab works per plan with add/edit/remove, copy between plans, live preview, gate blocks activation when a plan lacks a Default row. Changelog entry. Reply with route list + open questions.