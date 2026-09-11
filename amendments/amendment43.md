# Amendment 43 — Defensio F0: Home Screen
# TAG: A43 — SINGLE SESSION, the final Defensio amendment.
# Run AFTER parallel set 2 (A40–A42) is complete.

## Speed rules (standing)
- Read ONLY the files named here. No repo-wide scans.
- Purely additive except replacing the A36 home placeholder and the nav
  default route.
- No new entities, no seed (read-only screen over existing stores).
- Verification = syntax check only (node --check per JS file).
- Reply with: route list + files written + COORDINATION.md entries + open questions.

## Coordination (read modules/defensio/COORDINATION.md first)
- A43 OWNS: the Defensio home screen. Register.
- CONSUME ONLY published helpers (feature-detect each; a missing helper
  renders that card/table in a neutral "pending" state — never fake numbers,
  never read another feature's store directly):
  A36 denials store summary + worklist filter routes (untriaged counts,
  filing deadlines); A37 RCA/accountability summaries (open, overdue,
  pending-response/decider/HR — masked labels); A39 getF4HomeFlags()
  (in-flight, response-overdue, recovered MTD, awaiting-recovery aging);
  A40 getPreventionSummary() (patterns, no-plan causes) + risk-rule counts;
  A41 getDenialMetrics() (win rate MTD only — do NOT recompute);
  A42 getTpaFeeSummary() (overcharge open).
- If a needed summary helper is missing, ADD it to the owning feature's data
  file as a one-function append (log each addition in COORDINATION.md under
  the owner's section) — do not inline store reads in home code.

## Read first (only these)
- modules/defensio/COORDINATION.md (the published-helpers registry — this is
  the map)
- modules/defensio/home placeholder file from A36 (route + nav wiring)
- One reference home for pattern parity: modules/claima home (A35) — layout,
  card, table, empty-state components only
- design-system tokens

## Task 1 — Screen (modules/defensio/)
- home.html+js replacing the A36 placeholder (keep the route; set it as the
  module's default landing in the nav — the only nav edit).
- KPI row (6 cards) per spec: values via helpers; warning styling conditions;
  click-throughs with filter params matching each owner's worklist filters
  (reuse the exact query-param names those screens read — check each
  worklist's filter param list in COORDINATION notes); card 6 split-click
  (two halves, two hrefs).
- Tables (5 × 5 rows) per spec:
  UntriagedDenials (A36 data, amount-desc, deadline chip);
  DeadlineCritical (MERGED: A36 filing deadlines + A39 response deadlines →
  one array, days-remaining ascending, type label per row, red when
  overdue);
  PendingDecisions (A37 — render masked labels exactly as A37 provides them,
  assert no personId in scope);
  PreventionGaps (A40 — item-type label + contextual action link);
  RecentActivity (last 5 audit entries across defensio stores — if no
  central audit reader is published, add getRecentAudit(n) to A36's data
  file per the coordination rule above).
  Positive empty states on all five (copy tone from claima home).
- Quick actions bar per spec (5 links with focus/sort params).

## Task 2 — Reconciliation guard
- Dev-only console.assert per card: card value === length/sum of the target
  worklist's filtered dataset (call the same helper the target screen uses).
  Any mismatch logs the card name — this is the numbers-reconcile rule made
  executable.

## Consistency requirements
- Zero local formulas: every number is a helper's return (win rate from A41,
  never recomputed).
- Thresholds read from owners' config values (7d filing band, 45d recovery
  aging, tolerance values) — no literals duplicated in home code.
- Identity masking preserved verbatim from A37 outputs.
- Layout/component parity with the other three module homes (same card/table
  patterns).

## Reply checklist
Routes (home as default landing) · files · COORDINATION entries (ownership +
any helper functions appended to owners) · feature-detect status per helper ·
reconciliation-assert results on seed data · open questions.