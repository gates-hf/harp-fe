# Amendment 40 — Defensio F5: Prevention & Risk
# TAG: A40 — parallel set 2 (with A41 F6 Analytics/Scorecard, A42 F7 TPA).
# Run AFTER parallel set 1 (A37–A39) is complete.

## Speed rules (standing)
- Read ONLY the files named here. No repo-wide scans.
- Purely additive. Only the named hooks touch other modules' files.
- Small hand-written seed; no generators.
- Verification = syntax check only (node --check per JS file).
- Reply with: route list + files written + COORDINATION.md entries + open questions.

## Coordination (read modules/defensio/COORDINATION.md first)
- A40 OWNS: `denialPatterns`, `preventionPlans`, `riskRules` entities + F5
  screens + the pattern engine. Register.
- CONSUME (published, feature-detect each):
  A36 denials store (intake events, root-cause tags, repeat linkage);
  A37 getConcludedRcaCases() (confirmed causes, corrective actions, config
  gaps); A39 getLostAppeals() (pattern sharpening).
- A40 PUBLISHES (register): `getActiveRiskRules()` →
  [{ruleId, patternId, conditions{payerId, reasonCode|rootCause, cdmRef|
  category|serviceGroup, originRef?}, message, status}] and
  `recordRiskRuleHit(ruleId, {acknowledged, claimId})` — the Claima wire.
- A41 (F6) will read patterns/plans/prevented-value via your stores — publish
  `getPreventionSummary()` → {activePatterns, plansByStatus,
  preventedValueEstimateMTD}. Do NOT read A41/A42 files.

## Read first (only these)
- modules/defensio/COORDINATION.md
- modules/defensio/data/denials.js (A36 — record shape, intake event hook
  point if one is published; else compute on load)
- modules/claima/COORDINATION.md (scrubber extension point from A27 — how
  warning-category edits register; if none exists, see Task 3 fallback)
- design-system tokens as used by A36 screens

## Task 1 — Data + Engines (modules/defensio/data/)
- patterns engine (engines/pattern-engine.js): detect over rolling window
  (config: threshold 3, windowDays 90) across {payerId, reasonCode OR
  confirmedRootCause, serviceDim(cdm|category|group — most specific ≥
  threshold), origin?}; live counters, deniedValue, recoveredValue (from A36
  resolution states), trend (compare half-windows), statuses
  (New|Acknowledged|UnderPlan|Faded|Reactivated); recompute on load + on
  intake event (hook if published); idempotent pattern IDs (stable hash of
  dimensions).
- denial-patterns.js store: pattern records + acknowledge action + denial-id
  lists.
- prevention-plans.js: {id, title, targets[{type(pattern|cause|f2Action),
  ref}], baseline{count, value, computedAt, windowDays}, actions[{text,
  type(+targetRef|riskRuleRef), ownerId, dueDate, status, evidence[{file|
  note}]}], planEvidence[], status(Draft|Active|InMeasurement|
  ClosedEffective|ClosedPartial|ClosedIneffective|Cancelled),
  measurement{windowDays:90, result{count, value, deltaPct}, closedAt},
  ownerId, sponsorId, audit[]} — F2 action adoption = link + one-way status
  read via A37 helper (never copy).
- risk-rules.js: {id, patternId|manual{reason}, conditions, message,
  severity:'warning'(const), status(Active|Suspended|Retired),
  hitStats{fired, ackSubmitted, deniedAnyway, paid}, audit[]} — auto-suspend
  proposal when source pattern Faded (flag, user confirms).
- effectiveness engine (engines/plan-effectiveness.js): on-demand + on-load
  for InMeasurement plans past window: measured vs baseline, verdict
  (Effective ≥ −50% value default), preventedValueEstimate accumulator
  (label 'estimate' in the record).

## Task 2 — Screens (modules/defensio/)
- prevention-dashboard.html+js: header stats; Zone A prevention feed (ranked
  causes, No-plan flag ≥ 1000, click→create plan prefilled); Zone B pattern
  alerts table per spec (acknowledge, create plan, create risk rule, view
  denials → A36 worklist filtered); Zone C plans summary (overdue highlight).
- prevention-plan.html+js: plan form per spec — targets picker, baseline
  auto-freeze display, actions rows with evidence upload, F2-adopt picker
  (via A37 helper), Done-without-evidence warning, status flow with
  measurement panel (delta, verdict, ineffective → reopen/escalate choice
  enforced).
- risk-rules.html+js: rules list with hit-stat columns + retirement flag
  (fired ≥ 20 && followThrough < 10%), rule editor (conditions mirrored from
  pattern, message editable, severity locked), suspend/retire with reason.

## Task 3 — The Claima wire (only cross-module edits)
1. Claima F3 scrubber: register a "Denial Risk (Defensio)" WARNING category
   via the A27 published extension point — conditions evaluated per claim
   (payer + lines vs getActiveRiskRules()), acknowledgment calls
   recordRiskRuleHit(). If no extension point exists: add ONE registration
   file modules/claima/scrub-extensions/defensio-risk.js loaded by the
   scrubber via a single one-line include edit — log the exact edit.
2. Hit follow-through: register with claima's remittance-posting hook (same
   point A39 used) — claims that fired a rule and later denied/paid update
   hitStats.
Log both in BOTH COORDINATION.md files.

## Seed (hand-written)
- 3 patterns from existing A36/A29 seeded denials: 1 Accelerating-New
  (payer X + missing-auth + radiology, 4 occurrences), 1 UnderPlan, 1 Faded.
- 2 plans: 1 Active (2 actions, 1 adopted F2 action, evidence on one),
  1 ClosedEffective (baseline 6/3,200 → measured 2/900, delta recorded).
- 2 risk rules: 1 Active tied to the accelerating pattern (hitStats: fired 5,
  ackSubmitted 3, deniedAnyway 2), 1 Retired (poor predictor). Keep all refs
  consistent with prior seeds.

## Consistency requirements
- Patterns/rules read reasons + causes from the single shared lists (import,
  never copy).
- Risk severity locked to warning — assert no 'error' severity path.
- Prevented value labeled estimate; never written to any claima/frontis
  ledger store.
- Audit every mutation (A36 pattern).

## Reply checklist
Routes · files · COORDINATION entries (ownership, 3 published helpers, scrub
extension path used, remittance hook) · feature-detect status (A36 intake
hook, A37, A39) · open questions.