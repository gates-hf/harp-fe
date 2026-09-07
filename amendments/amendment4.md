# Amendment 4 — Pactum: Rate Methodologies & Overage

Part B of Payer Contract Management. Fills the **Methodologies** and **Overage** tabs of the contract page built in amendment 3, adds the Fee Schedule report, and extends the CDM Bundle Builder with component limits.

## Speed rules
- Read only CLAUDE.md and the files named here. No re-reading the design system or unrelated features.
- Purely additive. Copy patterns from `features/contracts`, `features/cdm` and the CDM importer; no refactors.
- Seed: hand-write methodology/overage rows for 3 existing contracts only.
- Verify: `node --check` on new JS, load each touched route once, stop.
- Reply: route list + open questions only.

## Files
```
modules/pactum/features/contracts/
  tab-methodologies.html / tab-methodologies.js   replaces the placeholder Methodologies tab
  methodology-form.js                             add/edit row modal with per-methodology params
  fee-schedule.js                                 inline fee schedule table for Fixed Amount rows
  fee-schedule-import.js                          copy of cdm-import stepper, scoped to one row
  tab-overage.html / tab-overage.js               replaces the placeholder Overage tab
  overage-form.js                                 bundle policy + component overrides
  fee-report.html / fee-report.js                 #/pactum/contracts/:id/fee-report
modules/pactum/features/cdm/bundle-builder.js    edit: add Limit Type / limit per component
modules/pactum/features/cdm/component-tree.js    edit: show limits
data/repositories/contracts.js                   extend: methodology + overage helpers below
data/seed/contracts.js                           extend 3 contracts
```
Contract page (amendment 3) already routes tabs; wire the two new tab files in, remove those two placeholders, keep Coverage / Pre-Auth / Rules placeholders.

## Entities (nested on contract)
```
methodology: id, scopeLevel (Default|Service Group|Category|Item|Admission Type), scopeValue (null for Default),
  method (% of Charges|Fixed Amount|Per Diem|Case Rate|DRG|Capitation), params {…}, effectiveFrom, effectiveTo, updatedAt
  params by method:
    % of Charges   { percent }
    Fixed Amount   { feeSchedule:[{itemId, price}] }
    Per Diem       { amount, wardType (General|Semi-Private|Private|ICU|NICU) }
    Case Rate      { amount, bundleId }            // priced bundle from CDM
    DRG            { baseRate, weightSource (Local|MS-DRG) }
    Capitation     { perMemberPerMonth, memberCount }
overagePolicy: id, methodologyId (a Case Rate / bundle-priced row), action, tolerance {type:%|Amount, value}|null,
  overrides:[{componentId, action, tolerance|null}]
  action ∈ Not Billable (Absorb) | Bill Payer at Contract Rate | Bill Patient | Split per Coverage | Requires Approval
bundle component (CDM): add limitType (Quantity|Amount Allowance), limitQty, limitAmount
```
Scope values: Service Group → list (Inpatient, Outpatient, Emergency, Day Case, Pharmacy, Lab, Imaging); Category → CDM categories; Item → CDM item picker (Active); Admission Type → (Elective, Emergency, Maternity, Day Case).

Repository helpers: `methodologyOverlap(contract, row)` (same scopeLevel+scopeValue with intersecting dates → conflicting row or null), `hasDefaultMethodology(contract)`, `resolveMethodology(contract, item, date)` (Item → Category → Service Group → Admission Type → Default; Service Group derived from category map, Admission Type ignored when not given), `resolvedPrice(contract, item, date)` (Fixed → schedule price; % → item.standardPrice × %; Per Diem/Case Rate/DRG/Capitation → their amount; else standardPrice), `bundleRowsNeedingOverage(contract)` (Case Rate rows without a policy). **Activation gate** in `contract-actions.js`: block Activate with a clear list if no Default row or any bundle row lacks an overage policy.

Seed: one contract with Default 80% + Category Lab Fixed schedule (6 items) + Per Diem + Case Rate (Appendectomy Package) with a full overage policy and 2 overrides; one with only a Default; one Draft with a Case Rate row and no policy (to demo the activation gate).

## Methodologies tab
Table: Scope Level, Scope Value, Methodology, Parameters summary (e.g. "80%", "$150 / night · Private", "$2,400 · Appendectomy Package", "24 items"), Effective From/To, actions Edit · Remove. Banner at top: "Default methodology: set ✓" or amber "Required before activation". Precedence hint line under the table. Button: Add Methodology. Read-only on non-editable contracts (same rule as amendment 3).

**Row modal**: Scope Level* → Scope Value* (picker changes per level; hidden for Default), Methodology* → parameter fields swap live, Effective From*/To. Fixed Amount reveals the **fee schedule** panel inside the modal: table Item (CDM picker, Active items, no duplicates), Agreed Price* (> 0), Remove; buttons Add Item, Bulk Import (stepper: template with Charge Code + Agreed Price; errors: unknown code, duplicate in file/schedule, price ≤ 0; built-in sample with 2 bad rows). Save → overlap check with error naming the conflicting row → audit with field diffs (fee schedule changes listed per item).

## Overage tab
Section per Case Rate / bundle-priced methodology row: header (scope, bundle name, amount), **Bundle policy**: Action*, Tolerance (None / % / Amount + value). **Component overrides** table: Component (picker limited to that bundle's component tree, flattened), Action*, Tolerance; Add Override, Remove. Rows without a policy show an amber "Policy required" badge. Empty state when the contract has no bundle-priced rows. Save per section → audit.

## Fee Schedule Report — `#/pactum/contracts/:id/fee-report`
Linked from the contract page header ("Fee schedule report"). Header: payer, contract, version, dates, generated at. Table over every **Active CDM item**: Charge Code, Description, Category, Standard Price, Resolved Methodology (scope shown, e.g. "Fixed Amount · Category: Lab"), Contract Price. Filters: Category, Methodology. Buttons: Export Excel (build CSV client-side, download as `.csv` — label it Excel), Export PDF (`window.print()` with a print stylesheet). Uses the version being viewed.

## CDM Bundle Builder — component limits
Each component row gets Limit Type* (Quantity | Amount Allowance) and either Included Qty* (defaults to qty) or Allowance Amount* (> 0). Show limits in `component-tree.js` ("2 nights", "$200 allowance") and in the review step. Update seed bundles with sensible limits.

## Done when
Methodologies tab with modal + fee schedule + import, overlap rejection, activation gate, Overage tab with policy + overrides, fee report with both exports, bundle limits visible in builder/tree. Changelog entry. Reply with route list + open questions.