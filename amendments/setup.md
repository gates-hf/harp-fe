# 00 — Setup

High-fidelity clickable prototype for client demos. Many interconnected modules, built feature by feature from numbered files in `amendments/`. This file only lays the foundation. Build nothing else. Work fast: no exploration beyond what's listed, no reports, no extra docs.

## Read first (only these)
`design-system/README.md`, `design-system/SKILL.md`, `design-system/_ds_manifest.json`. Open other design-system files only when you need a specific component. The design system is the single source of truth — use it as-is, never write custom CSS in a module.

## Stack
Plain HTML + CSS + vanilla JS ES modules. No framework, no build step. `python -m http.server` (or equivalent) for dev. If the design system clearly requires something else, stop and ask.

## Structure
```
index.html            thin shell only: loads app/, nothing else
app/                  router (hash-based, deep-linkable), layout, nav from module manifests
shared/               toast, modal, formatting, mock roles
data/store.js         in-memory store, sessionStorage persistence, resetToSeed()
data/repositories/    one file per entity — the only way modules read/write data
data/seed/            one file per entity
modules/<module>/module.js            manifest: id, name, nav, routes → lazy import() of features
modules/<module>/features/<feature>/  <feature>.html + <feature>.js (one feature per folder)
modules/<module>/components/          shared within that module only
modules/_template/                    copy to start a module
amendments/
CLAUDE.md
```

Hard rules: no monolith — one feature per folder, one entity per seed/repository file, ~300-line max per file. Modules connect only via routes and repositories, never by importing each other's files.

## CLAUDE.md (write it; keep under 40 lines)
- Structure and hard rules above.
- One owner per entity; cross-module references share the same IDs.
- Seed data: realistic Lebanese context (names, cities, phone formats, LBP/USD, current-year dates); 30–60 rows per main entity — enough for lists and filters, no more.
- Everything clickable: every button navigates, opens modal/drawer, mutates the store with feedback, or is disabled with a tooltip. Forms validate and save.
- Applying an amendment: read it, reuse existing entities/repositories, implement, load each new screen once to confirm it renders, append a 2–3 line changelog entry at the bottom of CLAUDE.md. Nothing else.
- Ambiguous data model/navigation → ask. Ambiguous UI → design-system default, note it in changelog.
- Replies: what was built, open questions. No summaries.

## Do now
1. Create the structure. Shell: sidebar nav from manifests, breadcrumb, user menu with role switcher, "Reset demo data" button.
2. `data/store.js` + repository pattern with one example entity and seed.
3. `modules/_template` with `module.js` and `features/example/` wired as a lazy route.
4. `CLAUDE.md` with an empty `## Changelog`.
5. Start the dev server, confirm the shell and template route render. Reply with the dev command and open questions only.

Then wait for `amendments/01-*.md`.