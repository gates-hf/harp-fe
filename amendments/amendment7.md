# Amendment 7 — Pactum: Rule Engine

Part E of Payer Contract Management. Fills the **Rules** tab and makes the "No. of Rules" column real. Largest part — the wizard is a full page, not a modal.

## Speed rules
- Read only CLAUDE.md, `features/contracts/contract-view.js`, `tab-preauth.js`, `preauth-form.js`, `features/cdm/bundle-builder.js` (for the stepper pattern), and the files named here.
- Purely additive; no refactors.
- Seed: 6 rules across the 2 seeded Active contracts, hand-written.
- Verify: `node --check` on new JS, load each new route once, run the evaluator on the seeded simulation examples, stop.
- Reply: route list + open questions only.

## Files
```
modules/pactum/features/rules/
  tab-rules.html / tab-rules.js            replaces the Rules placeholder tab on the contract page
  rule-wizard.html / rule-wizard.js        #/pactum/contracts/:id/rules/new  and  /rules/:ruleId
  condition-builder.js                     step 2 component (rows, AND/OR, groups)
  rule-attributes.js                       static attribute catalog
  rule-evaluator.js                        pure functions: evaluate, summarize, conflicts
  rule-simulator.js                        step 4 simulation panel
data/repositories/contracts.js             extend with rule helpers (thin wrappers over the evaluator)
data/seed/contracts.js                     extend 2 contracts
```

## Entity (nested on contract)
```
contract.ruleEvaluation: "first-match" | "all-match"   (default first-match)
rule: { id, name, description, priority (int, lower runs first), status (Active|Inactive),
  conditions: group,   // group = { op: "AND"|"OR", items: [condition | group] }
  action: { type, params }, updatedAt }
condition: { attr, operator, value }   // value: scalar | [list] | {from,to} for between
operators: = ≠ > < ≥ ≤ in not_in contains between
action.type ∈ Not Billable | % Discount {percent} | Fixed Rate {amount} | Requires Prior Approval |
  Co-pay {shareType, value} | Ceiling {amount} | Route to Payer | Route to Patient |
  Override Overage Action {action}
```

## `rule-attributes.js` — catalog (static, grouped)
```
Patient:   plan (list of contract's plans), age (number), gender (Male|Female), nationality (text), memberSince (date)
Item:      chargeCode, description, category (CDM categories), serviceGroup, standardPrice, allowedAmount, quantity, isBundle
Encounter: admissionType (Elective|Emergency|Maternity|Day Case), department, lengthOfStay (days), diagnosisCode (ICD-10 text), attendingDoctor, dateOfService
Financial: claimTotal, overageAmount, overageComponent, patientBalance, preAuthNumber (text, may be empty)
```
Each attribute: `{ key, label, group, type: number|text|date|enum|bool, options? }`. Operator list filters by type (`between`/`>`/`<` for number & date; `contains` for text; `in`/`not_in` for enum & text). Value input swaps by type (number, text, date, select, multi-select chips).

## `rule-evaluator.js` — pure, no DOM
- `evalCondition(cond, ctx)`, `evalGroup(group, ctx)` (recursive AND/OR).
- `evaluate(contract, ctx)` → `{ fired: [rule…], outcome: action(s) }`; sort Active rules by priority; first-match stops at first fired, all-match collects all; later actions of the same type override earlier ones in all-match.
- `summarize(rule)` → "IF Patient Plan = Gold AND (Item Category = Consumables OR Item Price < $20) THEN Not Billable" — parenthesize nested groups, format values by type.
- `findConflicts(contract)` → pairs of Active rules that (a) share ≥ 1 attribute with overlapping literal ranges/values (cheap heuristic: same attr with equal value, or numeric ranges that intersect) and (b) have contradictory actions (different type from the pricing set {Not Billable, % Discount, Fixed Rate, Co-pay, Ceiling}, or Route to Payer vs Route to Patient, or different Override Overage actions). Returns `[{a, b, reason}]`.
- `isReadOnly` follows the contract's editability rule from amendment 3.

## Rules tab — on the contract page
Header row: evaluation setting toggle (First match | All match — saved on change, audited), conflict banner (amber, "N conflicts" → expands to list "Rule A vs Rule B — both match Item Category = Consumables with contradictory actions"), button New Rule. Table sorted by priority: Priority, Rule Name, Conditions summary (truncated, full on tooltip), Action summary, Status badge, actions Edit · Deactivate/Activate · Duplicate (copies with " (copy)" suffix, Inactive, priority +1, opens wizard) · View history. Empty state. Read-only on non-editable contracts (row actions hidden, New Rule hidden). "No. of Rules" on the global list = Active rules count.

## Rule Wizard — `#/pactum/contracts/:id/rules/new` and `/rules/:ruleId`
Full-page 4-step stepper (copy bundle-builder pattern), Back-to-contract in the panel header.
1. **Details**: Name*, Description, Priority* (default = max existing + 10), Status* (default Active).
2. **Conditions** — `condition-builder.js`: a root group with rows; each row = Attribute (grouped select), Operator (filtered), Value (typed input); "+ Condition", "+ Group" (nested group with its own AND/OR toggle, visually indented with a bracket), remove; AND/OR toggle per group. At least one condition. Live summary line at the bottom of the step.
3. **Action**: radio list of action types; parameter fields swap (percent, amount, share type + value, overage action). One action per rule.
4. **Review & Test**: full `summarize()` sentence in a callout + conflict check against the contract's other Active rules (warning list, non-blocking) + **Simulation panel** (`rule-simulator.js`): inputs auto-generated for every attribute referenced by this rule plus a "More attributes…" expander; buttons "Load example" (fills a firing case) and "Run"; result shows this rule ✓/✗, then "Contract evaluation" listing all rules that would fire in priority order under the current setting and the final outcome. Simulation reads only; never writes. Save → upsert rule, audit with diffs (summary text old → new), toast, back to Rules tab.

Seed rules (contract 1): consumables under $20 on Gold → Not Billable; Emergency admission & LOS > 5 → Requires Prior Approval; age < 12 & category Consultation → 10% discount; overageAmount > 500 → Override Overage Action = Requires Approval; conflicting pair: category Pharmacy → Not Billable vs category Pharmacy & plan Silver → 20% discount. Contract 2: one rule.

## Done when
Rules tab with conflict banner and evaluation toggle; wizard with nested conditions, action, summary, simulation; evaluator returns correct results for the seeded examples; duplicate/deactivate/edit audited; rule counts show on the global list. Changelog entry. Reply with route list + open questions.