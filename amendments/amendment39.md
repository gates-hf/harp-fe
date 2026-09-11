# Amendment 39 — Defensio F4: Appeal Tracking & Resolution
# TAG: A39 — parallel set 1 (with A37 F2, A38 F3). Run AFTER A36.

## Speed rules (standing)
- Read ONLY the files named here. No repo-wide scans.
- Purely additive. Do not modify A36/A38-owned files except the named hooks.
- Small hand-written seed; no generators.
- Verification = syntax check only (node --check per JS file).
- Reply with: route list + files written + COORDINATION.md entries + open questions.

## Coordination (read modules/defensio/COORDINATION.md first)
- A39 OWNS: post-submission appeal lifecycle (statuses after 'Submitted'),
  `expectedRecoveries` entity, outcome/resolution logic, F4 screens. Register.
- FIXED INTERFACE with A38 (already in COORDINATION.md): consume appealCases
  where status='Submitted' ({submittedAt, method, reference, packageRef});
  A39 owns every later status. Do NOT edit A38's prep/review/submission code.
- A39 PUBLISHES (register both):
  `getAppealOutcome(appealCaseId)` → {outcome, decidedAt} — A38 uses for
  Level-2 enablement.
  `getLostAppeals()` → [{appealCaseId, denialIds[], outcome, decidedAt}] —
  A37 uses as RCA trigger.
- Level-2 creation itself is A38's code: on Lost disposition 'escalate', call
  A38's published level-2 creator if present, else write an
  `escalationRequests` row A38 picks up (feature-detect, note which path).
- Do NOT read A37/A38 implementation files — interfaces only.

## Read first (only these)
- modules/defensio/COORDINATION.md
- modules/defensio/data/denials.js (A36 — resolution states, re-triage helper,
  ledger assert)
- modules/defensio/data/appeal-cases.js SHAPE ONLY (fields list from
  COORDINATION.md entry, not the file logic)
- modules/claima/COORDINATION.md (published: remittance-posting hook points,
  write-off request creator (A33), claim timeline writer, claim/line refs)
- design-system tokens as used by A36 screens

## Task 1 — Data (modules/defensio/data/)
- expected-recoveries.js: {id, appealCaseId, denialId, claimId, lineRefs[],
  concededAmount, state(AwaitingRemittance|Recovered|Shortfall),
  recoveredAmount, remittanceRef, agingFrom, audit[]}
- Extend appealCases records ADDITIVELY (new fields only, via your own module
  — never rewrite A38 fields): tracking{responseDeadline, followUps[](append-
  only: date, method, contact, note, nextDue), underReview{ref, at}},
  outcome{type(Won|PartiallyWon|Lost|Settled), decisionDate, payerRef,
  concededTotal, allocations[{denialId, concededShare, lostShare,
  lostDisposition(escalate|writeOffLoop|acceptWithReason), reason}],
  payerRationale{code, text}, documentRef}, recoveryState, closedAt.
- Payer response window: read payer record field responseWindowDays (default
  30) — same pattern as A36's appealWindowDays; add the field default, don't
  edit pactum files.
- Resolution engine (data/engines/appeal-resolution.js):
  on outcome capture → validate (conceded ≤ disputed, allocations sum),
  create expectedRecoveries per conceded share, resolve F1 denials via A36
  helpers per allocation, write claim-timeline event, create F9 write-off
  requests via claima's published creator for writeOffLoop shares (linked),
  create escalation per the coordination note, expose the two published
  helpers. Recovery matching: register a callback with claima's
  remittance-posting hook point (published in claima COORDINATION) — on
  posting to an appealed claim/lines, match open expectedRecoveries →
  Recovered or Shortfall. Closure gate + ledger assert:
  disputed = recovered + writtenOff + accepted + escalated + openShortfall
  (console.assert).

## Task 2 — Screens (modules/defensio/)
- appeal-tracking.html+js: worklist per spec — response-deadline ascending,
  overdue highlight, recovery-state column, bulk follow-up (same payer),
  header stats (in-flight, overdue, decided MTD by outcome, recovered MTD,
  awaiting-recovery value).
- Extend appeal-case view via a TAB REGISTRY approach: add a "Tracking &
  Outcome" tab file that A38's case view loads if present (mirror claima's
  tab-registry pattern; if A38 shipped no registry, add your tab through a
  single registration line in a shared defensio/tabs.js you create and
  register in COORDINATION). Tab contents: response clock, follow-up log,
  Under Review setter, Outcome Capture form (allocation editor with live
  sum check, rationale from shared reason list, document upload), Lost
  Disposition chooser per share (role-gated accept), Recovery panel
  (expected records, states, shortfall options), Close Case (gated).
- Overdue + awaiting-recovery aging (45d default) flags: expose
  `getF4HomeFlags()` for the future A43 home screen (register).

## Task 3 — Hooks (only edits outside new files)
1. A36 denial detail: resolution chip now shows appeal-outcome detail
   (recovered/lost/awaiting) via your helper.
2. Claima remittance-posting hook registration (one registration call at the
   published extension point — no edits inside A29 logic).
Log both in COORDINATION.md.

## Seed (hand-written)
- On A38's seeded Submitted case: leave Submitted, deadline in 12 days.
- Add outcomes to complete the picture (extend A38 seed additively): 1 Won →
  expectedRecovery AwaitingRemittance (aging 20d); 1 PartiallyWon → half
  recovered (matched to an A29 seeded remittance line), half lost →
  writeOffLoop (F9 request created, Requested); 1 Lost → escalate (level-2
  escalationRequest or created case per path) + RCA trigger visible to A37;
  1 Settled → Recovered, case Closed. Keep every ref consistent with
  A36/A38/A29/A33 seeds.

## Consistency requirements
- Two clocks named distinctly everywhere: filingDeadline vs responseDeadline.
- Defensio never posts cash — recovery only via the claima hook match.
- Shared denial-reason list: import the single source.
- Allocation sums, ledger assert, audit on every mutation (A36 pattern).

## Reply checklist
Routes · files · COORDINATION entries (ownership, two published helpers, tab
registration, hooks, escalation path used) · feature-detect status (A37/A38
helpers) · open questions.