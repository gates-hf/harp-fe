# Amendment 37 — Defensio F2: Root Cause & Accountability
# TAG: A37 — parallel set 1 (with A38 F3 Appeal Prep, A39 F4 Appeal Tracking)
# Run AFTER A36 is complete.

## Speed rules (standing)
- Read ONLY the files named here. No repo-wide scans.
- Purely additive. Do not modify A36 files except the two registry hooks below.
- Small hand-written seed; no generators.
- Verification = syntax check only (node --check per JS file).
- Reply with: route list + files written + COORDINATION.md entries + open questions.

## Coordination (read modules/defensio/COORDINATION.md first)
- A37 OWNS: `rcaCases`, `accountabilityCases`, `correctiveActions` entities +
  all F2 screens. Register ownership.
- A38 owns appealCases (taking over the A36 stub); A39 owns appeal outcomes.
  F2 needs "appeal lost" as an RCA trigger: do NOT read A38/A39 files — consume
  the PUBLISHED INTERFACE below and code against it; if the helper doesn't
  exist yet, feature-detect and skip (trigger activates when A39 lands).
- PUBLISHED INTERFACE (agreed in COORDINATION.md, A39 implements):
  `getLostAppeals()` → [{appealCaseId, denialIds[], outcome, decidedAt}]
- A37 PUBLISHES for A40 (F5 prevention): `getConcludedRcaCases()` →
  [{caseId, confirmedRootCause, causeNature, configGap:{present,target,note},
  correctiveAction:{type,target,status}, denialIds[], departmentId}]
  — write this helper + register it.

## Read first (only these)
- modules/defensio/COORDINATION.md
- modules/defensio/data/denials.js (A36 — record shape, root-cause list import,
  repeat counters, status values)
- modules/claima/COORDINATION.md (published audit/evidence helpers list only)
- design-system tokens as used by A36 screens

## Task 1 — Data (modules/defensio/data/)
- rca-cases.js: {id, trigger(amount|repeat|appealLost|manual), denialIds[],
  status(Open|InAnalysis|Concluded|Closed), analystId, targetDays:14,
  analysis:{problem, whys[{why,because}], confirmedRootCause, causeNature
  (systemic|individual|payerSide), configGap}, causer:{personId, roleInFailure,
  evidenceRefs[](REQUIRED ≥1 when set), analystNote}, timestamps, audit[]}
- corrective-actions.js: {id, rcaCaseId, action, type(+targetRef for
  Configuration), ownerId, dueDate, status(Open|Done|Verified),
  verificationNote, attachments[], audit[]}
- accountability-cases.js: {id, rcaCaseId, personId, employeeResponse{text,
  attachments[], respondedAt|noResponseRecordedAt, windowDays:7},
  decision{type(noAction|coaching|warning|deductionRecommendation), rationale,
  deduction{amount, basis}, decidedBy, decidedAt}, appeal{text, reviewedBy,
  outcome(Upheld|Modified|Overturned), versions[]},
  deductionTracking{status(Recommended|SentToHR|OutcomeCaptured), sentRef,
  hrOutcome, hrRef}, audit[]}
- Trigger engine (data/engines/rca-triggers.js): evaluate on load — amount ≥
  500, repeat ≥3/90d same confirmed-or-tagged cause + origin (cluster into ONE
  case covering the denial set), lost appeals via the published interface
  (feature-detect). Auto-create Open cases; idempotent (no duplicate cases per
  denial set).

## Task 2 — Screens (modules/defensio/)
- rca-worklist.html+js: columns/stats/filters per spec; overdue highlight;
  "+ New RCA Case" (manual, multi-select denials, reason).
- rca-case.html+js: 4 tabs. Evidence tab assembles the origin trail via
  claima/frontis PUBLISHED helpers only (registration, eligibility+overrides,
  auths, coding+recodes, charges, assembly+warnings, submission) — read-only,
  attributed. Analysis tab: five-whys repeatable rows (≥2 enforced), confirmed
  cause (update denial's F1 tag on Conclude, audited old→new), nature radio,
  configGap toggle. Causer tab: enabled only when nature=individual; person
  lookup (add a small staff.js reference list if none exists — register it),
  roleInFailure, evidence multi-link to trail entries (≥1 enforced), prior
  cases for person+role auto-shown. Corrective Action tab per spec.
  Conclude/Close gating per spec.
- accountability-case.html+js: response-before-decision enforced (window,
  no-response recording), decision form (decider≠analyst check), appeal flow
  (higher role, versioned outcomes), deduction tracking stepper
  (Recommended→SentToHR→OutcomeCaptured). NEVER any payroll posting.
- accountability-register.html+js: authorized-roles gate; identities masked
  elsewhere ("Individual — case #N" on RCA worklist/case for non-authorized).

## Task 3 — Hooks (the only edits outside new files)
1. A36 denial detail: add "RCA Case" link chip when a case covers the denial
   (one line via a lookup helper you publish).
2. A36 worklist filters: add "Has RCA case" filter reading your store.
Log both in COORDINATION.md.

## Seed (hand-written)
- 4 RCA cases: 1 Open (amount trigger), 1 InAnalysis (repeat cluster of 3
  seeded denials, whys started), 1 Concluded-individual (causer with 2
  evidence refs, corrective action Open, accountability case pending employee
  response), 1 Closed-systemic (configGap→Pactum preauth matrix, action
  Verified). 1 accountability case Decided(warning)+appeal Upheld +
  1 deductionRecommendation SentToHR. Reuse A36 seeded denials/staff — keep
  refs consistent.

## Consistency requirements
- Root-cause list: import the single source (A36) — never copy.
- Evidence = real audit records via published helpers — never synthesize
  entries.
- Role separation asserts: causer requires evidence; decider≠analyst;
  appeal reviewer>decider (console.assert on save paths).
- Audit entries on every mutation, same pattern as A36.

## Reply checklist
Routes · files · COORDINATION entries (ownership + published
getConcludedRcaCases + hooks) · whether getLostAppeals was feature-detected ·
open questions.