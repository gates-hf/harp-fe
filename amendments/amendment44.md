# Amendment 44 — Pactum F5: Standard Code Systems
# TAG: A44 — SINGLE SESSION (reference-data root + Claima lookup takeover).

## A36+ reality delta (standing conventions)
- Repositories live in data/repositories/ (CLAUDE.md rule); screens under
  modules/pactum/features/<feature>/; store.batch(fn) exists for seeds.
- Verification = node --check on every new/changed file + one browser load of
  your routes (Chrome catches what node misses).
- Log everything in the module coordination/notes file; conflicts attributed.

## Speed rules (standing)
- Read ONLY the files named here. No repo-wide scans.
- Purely additive except the named Claima takeover edits.
- Small hand-written seed; no generators.
- Reply with: route list + files written + coordination entries + open questions.

## Read first (only these)
- modules/pactum/NOTES.md (or COORDINATION.md if present) — register A44
- modules/claima/COORDINATION.md — locate the F2 coding reference lists
  (ICD list, procedure list from A26) and the lookup call sites
- The A26 coding lookup files themselves (only the ones COORDINATION names)
- design-system tokens as used by existing pactum screens

## Task 1 — Data (data/repositories/)
- code-systems.js: {code_system_id, name(unique), system_type(GENERAL|
  ALLERGEN|DRUG|LAB|PROCEDURE|DIAGNOSIS), status, valid_from, valid_to,
  audit[]}
- code-system-versions.js: {code_system_version_id, code_system_id,
  version_label(unique per system), release_date, is_current, status,
  valid_from, valid_to, audit[]} — setCurrent(versionId) atomic swap
  (un-current previous, both audited); non-overlap validation per system.
- standard-codes.js: {standard_code_master_id, code_system_version_id,
  code(unique per version), display, status, valid_from, audit[]} —
  createFromPrevious(versionId) copy helper; bulk create via store.batch.
- Published lookup (register in pactum notes AND claima COORDINATION):
  lookupCodes({systemType?|codeSystemId?, query?, atDate?}) → Active codes
  from the version whose validity covers atDate (default: is_current;
  no-current fallback = latest Active version + console.warn — never empty
  silently).

## Task 2 — Screens (modules/pactum/features/standard-codes/)
- standard-codes.html/.js: landing per spec (stats rail incl. no-current
  highlight; systems list; filters; Add System dialog).
- code-system-view.html/.js: 3 tabs — Versions (list, Add Version with
  create-from-previous option, Set as Current, deactivate), Codes (version
  selector defaulting current, search, add/inline-edit-display/deactivate,
  Bulk Import flow: template → upload → validate → Valid/Error preview →
  import valid only → error report, same pattern as pactum payer import),
  History (all three levels merged, read-only).
- Nav entry under Pactum ("Standard Codes"); route ?systemType=&status=
  on landing, ?version= on the system view.

## Task 3 — Claima takeover (the only cross-module edits)
1. Seed migration: create seeded systems ICD-10-CM (DIAGNOSIS) and
   Procedures (PROCEDURE), one current version each (label "2026",
   released, is_current), codes = the exact entries of A26's existing
   reference lists (copy content, then the old list files become thin
   re-exports reading from standard-codes via lookupCodes — do not break
   A26 import paths).
2. Claima F2 coding lookups: re-point the diagnosis and procedure pickers
   to lookupCodes({systemType, query, atDate: encounter DOS}) — edit only
   the call sites COORDINATION names.
3. Log the takeover in claima COORDINATION ("code reference lists →
   pactum A44") and pactum notes.

## Seed (hand-written, beyond the migration)
- 1 extra system: HCPCS Level II (PROCEDURE), current version 2026, 6 codes.
- 1 DIAGNOSIS system version pair demonstrating versioning: ICD-10-CM
  "2025" (non-current, valid last year, 3 codes incl. one whose display
  differs from 2026) + the current "2026" — so a dated lookup visibly
  resolves differently.
- 1 system with NO current version (LAB, "LOINC", one Inactive version) —
  feeds the broken-source highlight and the fallback warning.

## Consistency requirements
- Exactly-one-current enforced atomically (assert on setCurrent).
- Codes/versions/systems never deleted; unique-in-version on code.
- Claima coding must resolve era-correct: verify live — open a coding
  screen on a seeded old-DOS encounter and confirm the 2025 display
  appears where the 2026 differs.
- Audit every mutation (standard pattern); bulk import logged.

## Reply checklist
Routes · files · coordination entries (pactum ownership + published
lookupCodes, claima takeover log) · the era-correct live check result ·
open questions.