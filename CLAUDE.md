# HARP prototype

High-fidelity clickable prototype for client demos. Plain HTML + CSS + vanilla JS ES modules, no framework, no build step. Serve with `python -m http.server 8000` from the repo root.

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
- No monolith: one feature per folder, one entity per seed/repository file, ~300-line max per file.
- Modules connect only via routes and repositories — never by importing each other's files.
- `design-system/` is the single source of truth. Use its classes as-is; never write CSS in a module. `app/app.css` holds shell glue only — link resets, popover placement, page rhythm — never module or component styles.
- Navigation is registry-driven: `app/modules.js` lists the manifests, the topbar `.mod-tabs` pick the module, the sidebar shows only that module's screens under `.mod-side-head`. Adding a module is one line in the registry; the shell does not change.
- One owner per entity; cross-module references share the same IDs. Ownership is a note in the owning module's manifest or README — the repository and seed stay in `data/`, they never move. `patients` is shared scaffolding until an amendment names its owner.
- Seed data: realistic Lebanese context (names, cities, +961 phones, LBP/USD, current-year dates); 30–60 rows per main entity.
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
