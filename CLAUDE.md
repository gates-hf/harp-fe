# HARP prototype

High-fidelity clickable prototype for client demos. Plain HTML + CSS + vanilla JS ES modules, no framework, no build step. Serve with `python serve.py` from the repo root — http://127.0.0.1:8000. Not `python -m http.server`: on Windows it serves `.js` as `text/plain`, Chrome refuses every module and the page renders blank.

## Structure
```
index.html            thin shell: loads app/, nothing else
app/                  router (hash-based, deep-linkable), layout, nav from module manifests
shared/               toast, modal, formatting, mock roles
data/store.js         in-memory store, sessionStorage persistence, resetToSeed()
data/repositories/    one file per entity — the only way modules read/write data
data/engines/         pure logic shared by screens: evaluate, price, summarize. No DOM, no writes
data/seed/            one file per entity
modules/<module>/module.js            manifest: id, name, nav, routes -> lazy import() of features
modules/<module>/features/<feature>/  <feature>.html + <feature>.js (one feature per folder)
modules/<module>/components/          shared within that module only
modules/_template/                    copy to start a module, then register in app/modules.js
```

## Hard rules
- No monolith: one feature per folder, one entity per seed/repository file, ~300-line max per file. One entity, one repository file overrides the 300-line cap, and so does one entity, one seed file. Engines in `data/engines/` are exempt too — a set of definitions two screens read from is one file or it is not a single source of truth.
- Modules connect only via routes and repositories — never by importing each other's files.
- Layering is one-way: modules may import from `data/`, `data/` never imports from `modules/`. Inside `data/`, an engine may read repositories; a repository may import only a leaf engine — one that imports nothing from `data/` itself — so the two never form a cycle. Pure logic two screens share is an engine, not a copy in each feature.
- `design-system/` is the single source of truth. Use its classes as-is; never write CSS in a module. `app/app.css` holds shell glue only — link resets, popover placement, page rhythm — never module or component styles.
- KPI footer lines use `.metric-rail-card__sub`; a rail sizes its own columns and never wraps — only a rail inside a narrow column names a track count (`.metric-rail--N`).
- Every KPI card is a control, built by `shared/metric-card.js` and never by a local helper: it selects the rows it counts on the screen it sits on — the card's number is the row count under it, and `aria-pressed` says that slice is on screen — or it links to the screen that holds them. A card with nothing to select stays a plain number.
- Navigation is registry-driven: `app/modules.js` lists the manifests, the topbar `.mod-tabs` pick the module, the sidebar shows only that module's screens under `.mod-side-head`. Adding a module is one line in the registry; the shell does not change.
- One owner per entity; cross-module references share the same IDs. Ownership is a note in the owning module's manifest or README — the repository and seed stay in `data/`, they never move. `patients` is shared scaffolding until an amendment names its owner.
- Seed data: realistic Lebanese context (names, cities, +961 phones, LBP/USD, current-year dates); 30–60 rows per main entity. `data/seed/claims.js` is the one seed that derives from repositories rather than being written out, so `data/store.js` does not import it: `data/repositories/claims.js` generates on first read of an empty table, and `handoffs.js` does the same off the result. Any future generated dataset follows that shape.
- Page actions go in the panel header, not `ctx.actions`. A screen's create-actions may instead ride the floating action bar — `mountFab` from `shared/fab.js`, styled by `.fab` — which is the design system's and open to every module, not one screen's furniture.
- Everything clickable: every button navigates, opens a modal/drawer, mutates the store with feedback, or is disabled with a tooltip saying why. Forms validate and save.
- Voice: sentence case, second person, present tense, no exclamation marks, no emoji.
- Claima is built by parallel sessions under modules/claima/COORDINATION.md; those rules override the single-session norm for Claima only.

## Consistency rules
- IDs everywhere in data; labels only at render time.
- All dates stored as ISO `YYYY-MM-DD`; compare with the one shared helper (`iso`, `compareDates`, `withinDates`, `todayIso` in `shared/format.js`); display with the one shared formatter (`date`, `dateTime`).
- Every list subscribes to the store and re-renders on change (`ctx.onData(draw)`); no screen relies on a reload.
- Every picker of payers/plans/items/bundles/contracts calls the repository's `findActive()`-style helper; no local copies of lists.

## Speed
- Read only this file and the files the amendment names. No re-reading the design system, other features, or the repo.
- Purely additive: never refactor an existing feature unless the amendment says so.
- Seed data: hand-write 8–10 rows, generate the rest by combining short lists. No large literal arrays.
- Verify with `node --check` on new JS and one load of each new route. No end-to-end walkthroughs; the user tests.
- Verification must load each new route in the browser; `node --check` does not catch duplicate declarations.
- Copy the patterns in `features/payer-master` (list, modal, importer) instead of designing new ones.
- Every screen must use `ctx.onData` for store subscriptions; copy `_template` if unsure.
- Reply: route list + open questions, nothing else.

## Applying an amendment
Read it, reuse existing entities and repositories, implement, load each new screen once to confirm it renders, append a 2–3 line changelog entry to `CHANGELOG.md` — numbered after the amendment file, not after the entries already there (`amendment7.md` → `### 07`). Nothing else.

Ambiguous data model or navigation → ask. Ambiguous UI → design-system default, note it in the changelog.
Replies: what was built, open questions. No summaries.

## Changelog
The per-amendment entries live in `CHANGELOG.md` at the repo root — not here, so this file stays under the size the shell loads every session. Before applying an amendment, read that file's entries for the module it touches (search for the module name; an entry is a few paragraphs) — they hold the architecture and data-model calls the code does not say. Do not import the file into this one.
