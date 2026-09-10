# Amendment 26 — Claima: Encounter Coding & CDI  (TAG: A26 — runs in parallel with A25, A27)

## Parallel protocol
Read `modules/claima/COORDINATION.md` first and follow it exactly. You own ONLY: `modules/claima/features/coding/`, `data/seed/coding.js`, `data/repositories/coding.js`, `data/seed/code-sets.js`, `data/repositories/code-sets.js`, `data/seed/clinical-docs.js`, `data/repositories/clinical-docs.js`. Shared files: one-line/one-block edits under `A26`. Peer helpers not yet published → feature-detect + Request; build your screens first.

## Interfaces (fixed)
**You publish**:
- `coding.byEncounter(no)` → current coding version `{ status, diagnoses[], procedures[], version, codedAt, codedBy }`
- `coding.afterCodedHooks[]` — fired with `{encounterNo, codingVersion}` on Mark Coded; A27 subscribes for auto-assembly
- `coding.afterRecodeHooks[]` — fired with `{encounterNo, oldVersion, newVersion, reason}`; A27 subscribes to mark claims Stale
- `coding.requestRecode(encounterNo, {source, ref, reason})` → creates a Recode Request (A27 calls it on denial routing; A25 on late procedure charges)
- `clinicalDocs.byEncounter(no)` → documents `{id, type, title, fileName, date, author}`; A27 uses it for attachments
- `codeSets.icd.search(q)`, `codeSets.proc.search(q)`
**You consume**: `charges.releasedByEncounter(no)` and `charges.afterReleaseHooks` (A25 — feature-detect; until published, seed the worklist from encounters that have posted ledger Charge txs), `encounters.*`, `claims.markStale?.(encounterNo, reason)` (A27).

## Speed rules
Read only CLAUDE.md, COORDINATION.md, `data/repositories/encounters.js`, `ledger.js` (fallback source), `modules/frontis/features/encounters/encounter-view.js` (banner), `shared/roles.js`, `shared/config.js`, and your own files. Seed: ~150 ICD-10 codes + ~60 procedure codes (hand-write 20 common each, generate plausible rest), coding for 6 encounters (2 Coded, 2 In Progress, 1 Query Pending, 1 Recode Request), 3 queries, 8 clinical docs. Verify: `node --check`, load each route once. Reply: routes + published helpers + open requests.

## Files
```
modules/claima/features/coding/
  coding-worklist.html/.js          #/claima/coding            (SLA highlight, My work, assignment)
  coding-workspace.html/.js         #/claima/coding/:encounterNo  (left evidence · right coding panel)
  coding-panel.js                   diagnoses / procedures editors, validations, Mark Coded
  cdi-queries.js                    raise / thread / answer / resolve / withdraw
  physician-queries.html/.js        #/claima/coding/queries    (physician view, oldest first)
  recode.js                         recode dialog + requests list
  coding-metrics.html/.js           #/claima/coding/metrics
  coding-history.js
data/seed+repositories: coding, code-sets, clinical-docs
```
Nav: Claima → Coding (badge = beyond SLA), Coding → Queries, Metrics as sub-entries. Roles: add `canAssignCoding` (supervisor), `canRecode`, `isPhysician`.

## Entities
```
codingRecord: encounterNo, status (Unassigned|Assigned|In Progress|Query Pending|Coded|Recode Requested), assignedTo|null,
  versions: [{ version, diagnoses:[{code, desc, principal: bool, poa: Y|N|U|null}], procedures:[{code, desc, date, doctorId, chargeLineIds:[]}],
              warningsAcknowledged:[{code, reason}], codedAt, codedBy, reason|null (recode) }],
  releasedAt (from A25 hook or ledger), completedAt, slaDays (3 OP / 5 IP from CONFIG.claima.coding), assignments:[{by, to, at, reason}],
  recodeRequests:[{id, source (Denial|LateCharge|Manual), ref, reason, at, status}]
cdiQuery: id, encounterNo, type (Missing Documentation|Clarification|Specificity|Conflicting), physicianId, question, refs:{chargeLineIds, docIds},
  status (Open|Answered|Resolved|Withdrawn), thread:[{at, by, role, text}], raisedAt, answeredAt|null, resolvedAt|null
clinicalDoc: id, encounterNo, type (Discharge Summary|Operative Note|Progress Note|Lab Report|Imaging Report|Consent), title, fileName, date, author, textPreview
```
Repository highlights: `worklist()` (Discharged/Completed with released charges, not Cancelled; age + SLA breach), `assign/self-assign/releaseToPool`, `saveDraft`, `validate(encounterNo)` → `{blocking:[{key,label,jumpTo}], warnings:[…]}` (one principal; POA on IP; every procedure-category released line linked; every procedure has ≥1 line; no open queries; sanity: age/gender/date), `markCoded` (validate → new/updated version → hooks), `recode(encounterNo, reason)` (role; new version; old preserved; hooks; `claims.markStale?.`), `metrics()` (backlog by age band/department, coded-per-day per coder 14d, open queries by physician, TAT, SLA % by type).

## Screens
**Worklist**: rail (Awaiting, Beyond SLA, In progress, Query pending). Table: Encounter/Patient, Type, Dept/Doctor, Completed, Released charges (count + value), Status, Coder, Age (red beyond SLA). Toggle My work. Filters Status/Coder/Dept/Type/Age band/Dates. Actions: Assign (role) · Self-assign · Open.
**Workspace** `/coding/:no`: 40/60 split. Left (read-only): patient banner, visit summary, released charge lines table, documents list with inline viewer (text preview panel). Right: Diagnoses (ICD search, Principal radio, POA select on IP, remove), Procedures (code search, date bounded, doctor, link charge lines via multi-select of procedure-category lines), Queries strip (open count + Raise), validation panel (blocking list with jump-to, warnings with Acknowledge + reason), buttons Save draft · Mark Coded · Release to pool · Recode (Coded only, role).
**Queries**: raise dialog (type, physician default attending, template picker → editable question, refs); thread drawer; physician view `/coding/queries` (their open queries oldest first, Answer); coder Resolve / Reopen / Withdraw (reason).
**Metrics** `/coding/metrics`: four panels with inline SVG (reuse Pactum perf-charts helpers by copying, not importing).

## Done when
Worklist with SLA + assignment rules; workspace codes from evidence; validations block correctly; queries full loop with TAT; recode versions with hooks; metrics. Append `### 26`; publish helpers; update COORDINATION Status.