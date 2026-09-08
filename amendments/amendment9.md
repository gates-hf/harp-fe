# Amendment 9 — Pactum: Integration Audit & Fixes

Feature-building pause. Amendments 1–8 were built by several sessions, sometimes concurrently; the module now has wiring gaps that break the demo. This amendment is a **consistency pass across all of Pactum** — find and fix, no new features. One session only.

## Speed rules (adjusted for this amendment)
- You may read every file under `modules/pactum/`, `data/`, `app/` and `shared/`. Do not read the design system beyond `components.css` / `shell.css` when fixing layout.
- Fix in place; no restructuring, no renames beyond what a fix needs.
- Verify each item in the checklist once in the browser — this amendment is the exception to syntax-only verification.
- Reply: list of defects found → fixed (one line each) + anything you could not resolve.

## Known defects — reproduce, root-cause, fix
1. **New contracts don't show in Contracts.** A contract created from a payer's Contracts screen does not appear in `#/pactum/contracts` after activation, and possibly not in the payer list without a reload. Check: store write → subscribers → list re-render; global list filter (Active only, `expireContracts` not mis-expiring); `activeOnly()` date logic; sessionStorage persistence vs in-memory copy divergence.
2. **Simulator says "No active contract for this plan" for a contract the user created with valid dates.** Check `contractForService(payerId, planId, dateOfService)`: plan id type/shape mismatch (plan id vs plan name vs index), date parsing (the form uses `08-Sep-2026`, seed uses ISO — normalise every date comparison to ISO strings or Date objects, one helper in `shared/format.js`), inclusive start/end boundaries, effectiveDate vs startDate, status check, and the plan selector listing "No active plan" when the payer has active plans (payer → plans wiring in the simulator).
3. **Simulator UI is broken.** Left panel is too narrow and the scenario picker/loader is confused (a scenario appears selected as a focused control before anything is loaded). Rebuild the layout with the design-system grid: inputs panel ~40% / result ~60% on desktop, stacked on narrow; scenario chooser as a plain dropdown + "Load" button in the panel header, not a fake selected card; consistent field rows (label left, control right, same widths as the contract forms); charge-line cards with item picker + qty on one row, consumption sub-table only for bundles; empty-state result centred. No custom CSS beyond app.css glue.

## Audit checklist — verify every flow end to end on a **fresh Reset demo data**, fix whatever fails
Payer Master
- Add payer → appears in list without reload; edit persists; deactivate hides it from `findActive()` and from every payer picker (contracts, simulator).
- Payer → Contracts link and "Contracts (n)" count are correct and live.
CDM
- Add item / import / deactivate → flags parent bundles; deactivated items disappear from every picker (fee schedule, methodology Item scope, coverage, pre-auth, rules attribute options, simulator charge lines).
- Bundle builder save → bundle visible in CDM list, bundles list, methodology Case Rate picker, simulator; limits show in tree.
Contracts
- Create Draft under payer → visible in payer list immediately; global list shows it only once Active; global metric rail counts update.
- Activate blocked with the full gate list; after filling Default methodology + coverage per plan + overage policy → activates; effective date respected; global list + simulator pick it up immediately.
- Change edit → v2 Draft, activate → v1 Expired/closed at effective date, simulator picks v1 for dates before and v2 after.
- Terminate → read-only everywhere (all tabs, wizard, simulator refuses dates after termination).
- Version switcher on the contract page shows the selected version's tabs, not always the latest.
Configuration tabs
- Every scope picker (Service Group, Category, Item, Admission Type, plan) uses the same source lists and the same value shapes as the engines expect (ids vs labels — pick one, ids, and map labels for display).
- Fee report, coverage "Try it", pre-auth "Check an item", rule simulation, and the billing simulator all agree on the same item/plan/date — run one item through all five and compare.
Engines
- `data/engines/*` are the only evaluators; no duplicate logic left in feature files. `evaluateEncounter` uses `contractForService`, and the trace's resolved methodology/coverage/pre-auth rows are the same rows shown on the tabs.
Simulator
- Three canned scenarios load, resolve a contract, run, and show a full breakdown and invoice preview with overage lines marked. Manually built encounter on a user-created contract works too.
Shell
- Sidebar counts (Payer Master, CDM, Bundles, Contracts) are live and consistent with the lists' totals. Breadcrumbs correct on every route. No console errors on any route. Reset demo data restores everything.

## Consistency rules to enforce while fixing (add to CLAUDE.md)
- IDs everywhere in data; labels only at render time.
- All dates stored as ISO `YYYY-MM-DD`; compare with the one shared helper; display with the one shared formatter.
- Every list subscribes to the store and re-renders on change; no screen relies on reload.
- Every picker of payers/plans/items/bundles/contracts calls the repository's `findActive()`-style helper; no local copies of lists.

## Done when
The three known defects are fixed, every checklist line passes on a fresh reset, and the same item gives the same numbers in the fee report, the coverage/pre-auth strips, the rule simulation, and the billing simulator. Changelog entry. Reply with defects fixed + unresolved items.