# Amendment 24 — Claima: Module Bootstrap + Parallel Protocol

New module `claima` (Claims Management). **This amendment runs in ONE session first** (≈10 min). It creates the module skeleton, takes ownership of the `claims` entity that Pactum Performance generated in amendment 11, and writes the coordination file that the three parallel feature sessions will follow. Do not build any feature.

## Speed rules
- Read only CLAUDE.md, `modules/frontis/module.js`, `data/seed/claims.js`, `data/repositories/claims.js`, `data/engines/performance-engine.js` (only the claims fields it reads), `data/repositories/encounters.js` and `ledger.js` (signatures), `shared/config.js`.
- Purely additive to Pactum/Frontis; you may restructure `data/seed/claims.js` and `data/repositories/claims.js` as long as every field and helper Performance reads keeps working (`selfCheck()` must still pass).
- Verify: `node --check`, load `#/claima`, `selfCheck()` passes, stop.
- Reply: route list + confirmation that `modules/claima/COORDINATION.md` exists.

## Do
1. **Module**: `modules/claima/module.js` (id "claima", name "Claima", nav placeholder "Home" → `#/claima` rendering a temporary "Claima — features arriving" panel). Sidebar tab order: Pactum, Frontis, Claima, Template. Push a merge re-link hook for claims (`patientMrn`).
2. **Claims entity — ownership move**: keep the amendment-11 generator as the seed but extend the shape so features can build on it:
   ```
   claim: id, claimNo ("CLM-2026-000871"), patientMrn, encounterNo|null, payerId, planId, policyId|null, contractId (version at DOS),
     status: Draft | Ready | Submitted | Acknowledged | Paid | Partially Paid | Denied | Rejected | Appealed | Closed | Void,
     dateOfService, createdAt, submittedAt|null, batchId|null, remittanceId|null,
     lines: [{ id, itemId, qty, grossBilled, allowedExpected, payerShare, patientShare, isOverage, ledgerTxIds: [] , status, denialReasonCode|null }],
     totals: { gross, allowedExpected, payerShare, patientShare, paid, adjusted, balance },
     denialReasonCode|null, scrubberFindings: [], attachments: [], history: [] (use audit),
     // legacy flat fields kept for Performance: serviceGroup, category, itemId, qty, grossBilled, allowedExpected, allowedPaid, paidAt, appealed
   ```
   Map the existing single-line claims into `lines[0]` + `totals` while keeping the flat fields in sync. Repository keeps every existing helper and adds: `search(q, filters)`, `byStatus()`, `byPatient(mrn)`, `byEncounter(no)`, `nextClaimNo()`, `create/update` (Draft/Ready only), `setStatus(id, status, payload)` (audited), `recomputeTotals(id)`.
3. **Shared config**: `CONFIG.claima = { submissionDeadlineDays: 30, scrubberRules: [], ackSlaDays: 3 }` (features append their own keys).
4. **COORDINATION.md** — create `modules/claima/COORDINATION.md` with exactly these sections and rules (this file is the contract between sessions):

```
# Claima — parallel session coordination
Three sessions build three features at once. Each session has a TAG (the amendment number it is applying, e.g. A25).

## Ownership (who may write where)
- Each session writes ONLY inside modules/claima/features/<its-feature>/ and its own data/seed/<entity>.js + data/repositories/<entity>.js listed in its amendment.
- SHARED files (append-only, one-line edits, never rewrite): modules/claima/module.js (add your nav entry + routes inside the block marked with your TAG), shared/config.js (add keys under CONFIG.claima, never edit others'), CLAUDE.md (append your ### entry only), data/store.js (register your entity line only), this file.
- Never edit another session's feature folder or entity files. If you need something changed there, write a request in the Requests section below and stop that part of your work until it is answered.
- data/repositories/claims.js is shared: add helpers in a section headed by your TAG; never modify an existing helper's signature or behaviour.

## Contract (interfaces every session may rely on)
- claims repository helpers listed in amendment 24 + any helper published below under "Published helpers".
- Cross-feature links go through claim ids / claimNo, batch ids, remittance ids — never by importing another feature's files.
- All dates ISO YYYY-MM-DD; ids not labels; every screen uses ctx.onData; pickers use findActive() helpers.

## Protocol
1. On start: read this file fully, append "TAG started <time>" under Status.
2. Before editing any SHARED file: re-read it from disk, make the one-line/one-block change under your TAG, save immediately. Never hold a shared file open across other work.
3. When you add a helper others may use: list it under "Published helpers" with its signature and one-line semantics.
4. When you need something from another feature: write it under "Requests" as "TAG → TAG: need <helper/field>, signature <…>"; poll this file every few minutes; the owner answers under the request and implements it in their own files.
5. If you find a conflict, a broken import, or a failing selfCheck caused by another session: write it under "Conflicts" with file + line; do not fix files you don't own.
6. On finish: run node --check on the whole tree and load every Claima route, then append "TAG done <time>, routes: …" under Status. The last session to finish runs the full-tree check once more.

## Status
## Published helpers
## Requests
## Conflicts
```
5. Add to CLAUDE.md: "Claima is built by parallel sessions under modules/claima/COORDINATION.md; those rules override the single-session norm for Claima only."

## Done when
`#/claima` renders, Performance still passes `selfCheck()`, claims repository extended, COORDINATION.md in place. Then stop; the three feature sessions start from amendments 25, 26, 27.