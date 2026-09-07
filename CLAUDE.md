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
- `design-system/` is the single source of truth. Use its classes as-is. Never write custom CSS in a module; `app/app.css` is shell-only and does not grow.
- One owner per entity; cross-module references share the same IDs.
- Seed data: realistic Lebanese context (names, cities, +961 phones, LBP/USD, current-year dates); 30–60 rows per main entity.
- Everything clickable: every button navigates, opens a modal/drawer, mutates the store with feedback, or is disabled with a tooltip saying why. Forms validate and save.
- Voice: sentence case, second person, present tense, no exclamation marks, no emoji.

## Applying an amendment
Read it, reuse existing entities and repositories, implement, load each new screen once to confirm it renders, append a 2–3 line changelog entry below. Nothing else.

Ambiguous data model or navigation → ask. Ambiguous UI → design-system default, note it in the changelog.
Replies: what was built, open questions. No summaries.

## Changelog
