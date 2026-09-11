# Amendment 41 — Defensio F6: Denial Analytics & Payer Scorecard
# TAG: A41 — parallel set 2 (with A40 F5, A42 F7). Run AFTER set 1 (A37–A39).

## Speed rules (standing)
- Read ONLY the files named here. No repo-wide scans.
- Purely additive. READ-ONLY feature: no writes to any operational store —
  the only entity you create is scorecards.
- Small hand-written seed; no generators.
- Verification = syntax check only (node --check per JS file).
- Reply with: route list + files written + COORDINATION.md entries + open questions.

## Coordination (read modules/defensio/COORDINATION.md first)
- A41 OWNS: `scorecards` entity, metric-definitions module, all F6 screens.
  Register.
- CONSUME (published readers, feature-detect each — render "pending Fx" empty
  states where absent, never fake data):
  A36 denials store (ledger, reasons, tags, separations, resolutions);
  A37 getConcludedRcaCases() (confirmed causes, nature, actions);
  A39 getAppealOutcome/getLostAppeals + appealCases Submitted+ states +
  expectedRecoveries (recovery truth);
  A40 getPreventionSummary() + risk-rule stats.
- Claima published readers: adjudicated claim/line volumes + values per
  period, remittance dates (cash-date boundary). Do NOT touch claima stores.
- A41 PUBLISHES (register): `getDenialMetrics(payerId?, period)` → the full
  definitions-table object — Pactum Performance's denial columns will read
  THIS (log a note in pactum's COORDINATION/notes: "denial figures source =
  defensio A41"; one-line dependency note only, no pactum code edits in this
  amendment).
- Do NOT read A40/A42 implementation files — interfaces only.

## Read first (only these)
- modules/defensio/COORDINATION.md (all published interfaces)
- modules/defensio/data/denials.js (A36 — statuses, separation values,
  resolution states, date fields)
- modules/claima/COORDINATION.md (published volume/value readers list)
- design-system tokens + the chart pattern used by pactum performance
  (modules/pactum performance chart helper if published; else the shared
  chart include named in design-system)

## Task 1 — Metrics core (modules/defensio/data/)
- metric-definitions.js: ONE exported table — {key, label, formula(fn over
  stores), dateBoundary('intake'|'decision'|'cash'), format} for: denialRateValue,
  denialRateCount, recoveryRate, overturnRate, appealTurnaround,
  avgResolutionDays, misclassificationRate, firstPassPrevention,
  netDenialLoss, openExposure. Rules baked in: Reclassified excluded from
  denial rates and counted ONLY in misclassification; recovered =
  cash-confirmed (expectedRecoveries.Recovered) only.
- analytics engine (engines/denial-analytics.js): compute(metricKeys, {period,
  compare?, sliceBy?(payer|department|serviceLine|doctor|encounterType)})
  → figures + record-id lists per figure (the drill-through payload). All six
  views and the scorecard call ONLY this engine — no view-local math.
- Publish getDenialMetrics() wrapping the engine.

## Task 2 — Screens (modules/defensio/)
- denial-analytics.html+js: global period/compare/export bar; 6 views as
  sub-tabs per spec —
  Overview (cards + deltas + monthly trend chart);
  ReasonsVsCauses (two ranked panels + divergence rows w/ drill links);
  Breakdowns (slice picker → table + top-N chart, cells drill to A36
  worklist via filter params);
  AppealFunnel (stage values + leakage incl. appealable-never-appealed, win
  by ground/level, turnaround by payer, shortfall aging);
  Governance (RCA throughput/overdue, nature split, causer BY ROLE ONLY —
  assert no personId ever rendered — actions by status, plan verdicts,
  prevented-value with 'estimate' badge, rule quality);
  Misclassification (trend + by payer, contractual vs TPA, link to F7 route
  — plain href, feature-tolerant).
  Every figure element carries its drill href (filtered worklist routes).
- payer-scorecard.html+js: generate form (payer, period, optional compare) →
  rendered document per spec section table (headline vs prior + all-payer
  avg, profile + divergence, appeal record, misclassification, financial
  summary, 6-month trend, notes textarea captured at generation) →
  Save = immutable snapshot {scorecardNo(sequential), payerId, period,
  figures(frozen), notes, generatedBy/At, version} in scorecards.js;
  regeneration same payer+period → new version, both listed.
- scorecard-archive.html+js: list + re-export (render from the frozen
  snapshot ONLY — assert no engine call on archived render); print-view route
  for PDF export, Excel via the shared export helper.

## Task 3 — Hooks (only cross-file edits)
1. Defensio nav: Analytics + Scorecard entries (module home placeholder
   links).
2. Pactum dependency note: append one line to pactum's coordination/notes
   file as stated above.
Log both.

## Seed (hand-written)
- No operational seed (read-only feature). 1 archived scorecard snapshot for
  the top seeded payer, prior month, v1 — hand-frozen figures consistent with
  the seeded stores (compute once by hand, keep plausible).

## Consistency requirements
- ONE engine, no view-local formulas (grep-level check: no arithmetic on
  store values outside the engine).
- Reclassified never in denial rates; recovered = cash-confirmed only;
  identities never rendered (role strings only).
- Date boundaries per metric family stated on each view (small caption).
- Archived scorecards render from snapshots, never recompute.

## Reply checklist
Routes · files · COORDINATION entries (ownership, getDenialMetrics, pactum
note) · feature-detect status per consumed interface · open questions.