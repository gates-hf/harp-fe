# HARP prototype

High-fidelity clickable prototype for client demos. Plain HTML + CSS + vanilla JS ES modules, no framework, no build step. Serve with `python serve.py` from the repo root — http://127.0.0.1:8000. Not `python -m http.server`: on Windows it serves `.js` as `text/plain`, Chrome refuses every module and the page renders blank.

## Structure
```
index.html            thin shell: loads app/, nothing else
app/                  router (hash-based, deep-linkable), layout, nav from module manifests
shared/               toast, modal, formatting, mock roles
data/store.js         in-memory store, sessionStorage persistence, resetToSeed()
data/repositories/    one file per entity — the only way modules read/write data
data/seed/            one file per entity
modules/<module>/module.js            manifest: id, name, nav, routes -> lazy import() of features
modules/<module>/features/<feature>/  <feature>.html + <feature>.js (one feature per folder)
modules/<module>/components/          shared within that module only
modules/_template/                    copy to start a module, then register in app/modules.js
```

## Hard rules
- No monolith: one feature per folder, one entity per seed/repository file, ~300-line max per file. One entity, one repository file overrides the 300-line cap.
- Modules connect only via routes and repositories — never by importing each other's files.
- `design-system/` is the single source of truth. Use its classes as-is; never write CSS in a module. `app/app.css` holds shell glue only — link resets, popover placement, page rhythm — never module or component styles.
- Navigation is registry-driven: `app/modules.js` lists the manifests, the topbar `.mod-tabs` pick the module, the sidebar shows only that module's screens under `.mod-side-head`. Adding a module is one line in the registry; the shell does not change.
- One owner per entity; cross-module references share the same IDs. Ownership is a note in the owning module's manifest or README — the repository and seed stay in `data/`, they never move. `patients` is shared scaffolding until an amendment names its owner.
- Seed data: realistic Lebanese context (names, cities, +961 phones, LBP/USD, current-year dates); 30–60 rows per main entity.
- Page actions go in the panel header, not `ctx.actions`.
- Everything clickable: every button navigates, opens a modal/drawer, mutates the store with feedback, or is disabled with a tooltip saying why. Forms validate and save.
- Voice: sentence case, second person, present tense, no exclamation marks, no emoji.

## Speed
- Read only this file and the files the amendment names. No re-reading the design system, other features, or the repo.
- Purely additive: never refactor an existing feature unless the amendment says so.
- Seed data: hand-write 8–10 rows, generate the rest by combining short lists. No large literal arrays.
- Verify with `node --check` on new JS and one load of each new route. No end-to-end walkthroughs; the user tests.
- Copy the patterns in `features/payer-master` (list, modal, importer) instead of designing new ones.
- Reply: route list + open questions, nothing else.

## Applying an amendment
Read it, reuse existing entities and repositories, implement, load each new screen once to confirm it renders, append a 2–3 line changelog entry below. Nothing else.

Ambiguous data model or navigation → ask. Ambiguous UI → design-system default, note it in the changelog.
Replies: what was built, open questions. No summaries.

## Changelog

### 01 — Pactum: Payer Master
Added module `pactum` (owner of `payers`) with Payer Master at `#/pactum/payers`: list with search, type/status filters, sorting, paging and row actions; 4-tab add/edit modal; history drawer; bulk import at `#/pactum/payers/import`. New shared `audit` entity (append-only) plus `isEmail`/`fileSize` in shared/format.js.
UI calls: the tab error dot is a filled critical `error` icon; documents are transactional — the modal edits a draft and the repository writes the Document added/removed entries on save, so Cancel discards.
Shell: `app/main.js` now replaces the `#page-body` node on every route render, so listeners a feature binds to its mount retire with it — features bind delegated listeners the ordinary way.
Added `shared/drawer.js`, the right-side sheet (title, sub, icon, body, foot; Escape, backdrop and X close it; it shares the modal's `.scrim` stack and focus trap). View history opens in it. Its placement lives in `app/app.css` in design-system tokens, because the design system ships no drawer and one module is below its bar for graduating a component — move that block to `design-system/components.css` when a second module needs a sheet.

### 02 — Pactum: CDM
Added the charge master under `pactum`: `#/pactum/cdm` (items and bundles in one list), `/import` (4-step importer, items only), `/bundles` (expandable component trees, flags, clear flag) and `/bundles/new|<id>` (3-step builder with a cycle-blocking picker). New entity `cdm` — one collection, `kind: 'item' | 'bundle'` — with `findActive`, `componentSum`, `parentsOf`, `wouldCreateCycle`/`cyclePath`, `flagParents`, `clearFlag` and `expireBundles()` on load.
Bundle routes sit under the CDM screen, so a nav entry may now carry a deeper path (`cdm/bundles`) and `app/layout.js` highlights the deepest nav path the route sits under.
UI calls: `componentSum` counts a nested bundle at its own price, not at the sum inside it; the builder's running totals sit under the step body (the design system has no sticky footer); the component tree indents with `--space-4` since the system ships no tree.
View history is `cdm-history.js`, the payer trail copied for the `cdm` entity (items and bundles alike) in the shared drawer; the payer version is untouched.

### 03 — Pactum: page header removed
The topbar breadcrumb already names the screen, so every Pactum screen dropped its `ctx.actions` block and the shell's header bar collapses when a screen leaves it empty (`app/app.css`) — the `<h1>` stays in the document, clipped, so the page keeps its heading. Other modules that still fill `ctx.actions` (`_template`) keep the bar; nothing in `app/layout.js` or the breadcrumb changed.
Each screen's actions moved to the panel header on the right: Bulk import beside Add new payer on Payer Master, Bundles and Bulk import beside Add item on the CDM, Back to CDM beside New bundle on Bundles.
UI call: the importers and the bundle builder have no panel to name, so their Back link sits at the end of the step panel's header after the hint rather than in a row of its own.

### 04 — Pactum: Contracts (part A)
Added the contract lifecycle under `pactum`: `#/pactum/contracts` (every active contract, metric rail, payer-type and expiring-within filters, amber "expires in N days" chip ≤90 days), `#/pactum/payers/:payerId/contracts` (one payer's agreements, versions of a lineage grouped under a "v1, v2…" expander, add/edit/terminate/history row actions) and `#/pactum/contracts/:id` (the contract page: banner, version switcher, General + History, and Methodologies / Overage / Coverage / Pre-Auth / Rules as counted placeholders). New entity `contracts` — versioned by `lineageId` + `version` — with `byPayer`, `activeOnly`, `versionsOf`, `nextVersion`, `isContractNoUnique`, `planOverlap`, `daysLeft`, `plansOf` and `expireContracts()` on load. Payer Master gained a Contracts row action and the payer editor a "Contracts (n)" link on General; `payer-list.js` hands the mount to `payer-contracts.js` on the deeper path, the way the CDM hands off to bundles.
Data model calls: versions of one agreement share the contract number, so `isContractNoUnique` and `planOverlap` skip the row's own lineage; audit entries are keyed on `lineageId` with the version in `details` ("v2 · …"), so one query returns the whole history and the History tab splits a corrective edit's `;`-separated diff into a line each. `create` also stamps `createdBy`/`createdAt` — the versions timeline names who drafted each version.
UI calls: the lists have filters but no paging or sortable headers (the amendment names neither; the global list sorts soonest-expiry first, which is the reason to open it); in-modal section headings are `.toolbar` + `.t-title-sm`, since `.panel-header` belongs to a panel; plans are checkbox rows in `.rule-child-row` because the design system ships no checkbox class of its own; and the design system gained `.field--area`, the multi-line variant of `.field` (the plain row is fixed at 32 px, so a taller textarea spilled out of its box) — the termination reason wears it.

### 05 — Pactum: Rate Methodologies & Overage
Filled the contract page's Methodologies and Overage tabs and added the fee schedule report at `#/pactum/contracts/:id/fee-report` (`contracts-global.js` hands the mount over on the deeper path, the way it already does for the contract page). Methodologies are nested on the contract: `scopeLevel`/`scopeValue`, `method`, `params`, effective dates, with `methodologyOverlap`, `hasDefaultMethodology`, `resolveMethodology`, `resolvedPrice`, `bundlePricedRows`, `bundleRowsNeedingOverage` and `activationBlockers` in `data/repositories/contracts.js`; `askActivate` opens a blocking dialog listing those blockers instead of the date prompt. Fixed Amount rows carry a fee schedule edited in the modal (`fee-schedule.js` — table and file format) with a nested 4-step importer (`fee-schedule-import.js`) whose rows are merged into the draft, so Cancel discards them. CDM bundle components gained `limitType`/`limitQty`/`limitAmount`, shown in the builder, the review step and `component-tree.js`.
Data model calls: a Fixed Amount row that covers a charge the schedule does not price falls back to the standard price rather than to the next methodology — the row still owns the scope; `resolveMethodology` takes admission type as an optional fourth argument, since it is a claim-time fact no screen knows yet; the fee report reads rates on a date the contract actually covers (clamped to its term), so a future draft reports the rates it will bill under; and removing a methodology removes the overage policy hanging off it.
UI calls: the two configured tabs render into a node contract-view.js creates for them (the shell's freshBody rule one level down) and the page's own `[data-act]` handler is scoped to `#cv-actions`, since a tab now owns buttons inside the panel; the methodology modal validates into one error box under the body rather than per field, because its fields swap with the chosen method; tolerance pairs and the fee schedule's item picker sit in `.toolbar` rows, the only design-system primitive that caps a field's width (a bare select sizes to its longest option and overflowed the dialog); a quantity limit reads through the component's UoM ("2 nights", "1 test") and says "included" for Each and Package.
Print: `app/app.css` gained an `@media print` block — the shell's chrome and anything marked `data-print="hide"` leave the printed page, which is what Export PDF (`window.print()`) hands the printer. Export Excel builds the CSV client-side and downloads it as `.csv`.

### 06 — Pactum: Coverage (part C)
Filled the contract page's Coverage tab: a plan selector (each plan shows ✓ or "Default missing"), the split table for the selected plan with add/edit/remove, Copy from plan… (Replace all rows or Merge — keep existing) and a "Try it" strip that runs an allowed amount through the resolved row and shows the patient and payer share live. Coverage is nested per plan on the contract — `coverage: [{ planId, rows: [{ scopeLevel, scopeValue, covered, shareType, shareValue, deductible, ceiling }] }]` — with `coverageFor`, `coverageOverlap`, `hasDefaultCoverage`, `plansMissingDefaultCoverage`, `resolveCoverage`, `patientShare`/`payerShare`, `shareSummary`, `copyCoverage`/`coverageCopyCount` and the writes `saveCoverageRow`/`removeCoverageRow` in `data/repositories/contracts.js`. The activation gate gained "Plan <name> has no Default coverage row" per plan, which `contract-actions.js` renders unchanged — it lists whatever `activationBlockers` returns. Seed: NSSF (CTR-0001) carries the worked split on both plans, AXA (CTR-0005) a $10 fixed co-pay on one of its two.
Data model calls: coverage carries no effective dates, so a plan holds one row per scope and `coverageOverlap` is a same-scope check rather than a date test; the ceiling caps the patient share after the share type is applied, and the share never exceeds the allowed amount; a charge no row covers leaves the whole allowed amount with the payer (`patientShare(x, null)` is 0), which the preview says in words; `copyCoverage` takes a contract or its id and re-ids every copied row, so ids stay unique within the contract.
UI calls: the plan selector is `.segmented` with `aria-pressed`, the design system's primitive for picking one of a few; the selected plan is the tab's own state and a save redraws the tab rather than the page, so the plan under edit stays selected — the tab never calls the `refresh` contract-view.js hands it; Covered is a Yes/No select, since the design system ships no checkbox and the methodology modal already asks its questions with selects; the table reads "Full amount" for an uncovered scope and "—" for a None share, and the preview line says "no patient share" instead of that bare dash.

### 07 — Pactum: Pre-Authorization (part D)
Filled the contract page's Pre-Auth tab: an info banner naming the precedence, the matrix with add/edit/remove, a subtle "Exemption" tag on a "No" row a broader row would have required, and a "Check an item" strip (item picker + amount) whose chip answers with the winning rule. The `preAuth{}` placeholder is now an array nested on the contract — `preAuth: [{ id, scopeLevel (Service Group|Category|Item), scopeValue, required, threshold|null, updatedAt }]` — with `preAuthRows`, `preAuthLabel`/`preAuthScopeName`, `thresholdLabel`, `preAuthOverlap`, `isPreAuthExemption`, `resolvePreAuth` and the writes `savePreAuth`/`removePreAuth` in `data/repositories/contracts.js`. Nothing here gates activation, so `activationBlockers` is untouched. Seed: NSSF (CTR-0001) carries the worked ladder — Inpatient always, Radiology above $300, MRI Brain always, Chest X-ray exempt inside it, Pharmacy above $1,000 — and AXA (CTR-0005) requires it on Surgery.
Data model calls: `resolvePreAuth(contract, item, amount)` walks Item → Category → Service Group and the narrowest row wins outright, so an item row with `required: false` exempts a charge a wider row would have held; a threshold only ever narrows a requiring row, so a "No" row clears and disables it; with no amount the check is `0 > threshold`, which reads as not required. The rule engine's conditional pre-auth merges into `resolvePreAuth` in part F — the hook is a comment on its doc block.
UI calls: the required answer is a Yes/No `.segmented` toggle (the design system ships no switch, and Coverage already picks one of a few this way) while the rest of the modal stays selects; the exemption tag is a plain `.badge` beside the tinted Yes/No one, the subtlest pairing the system offers; the check strip mirrors Coverage's "Try it" panel and defaults the amount to the item's standard price, so it answers before anything is typed.
