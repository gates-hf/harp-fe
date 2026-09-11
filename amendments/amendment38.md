# Amendment 38 — Defensio F3: Appeal Preparation & Submission
# TAG: A38 — parallel set 1 (with A37 F2, A39 F4). Run AFTER A36.

## Speed rules (standing)
- Read ONLY the files named here. No repo-wide scans.
- Purely additive. Do not modify A36 files except the registry hooks below.
- Small hand-written seed; no generators.
- Verification = syntax check only (node --check per JS file).
- Reply with: route list + files written + COORDINATION.md entries + open questions.

## Coordination (read modules/defensio/COORDINATION.md first)
- A38 TAKES OVER the `appealCases` stub created in A36 — register takeover;
  A38 OWNS appealCases + all F3 screens + letter templates.
- A39 (F4) owns post-submission tracking/outcomes. FIXED INTERFACE (write into
  COORDINATION.md): A38 sets case.status='Submitted' with
  {submittedAt, method, reference, packageRef}; A39 reads Submitted cases and
  owns every status after. A39 publishes `getAppealOutcome(appealCaseId)` →
  {outcome, decidedAt} — A38 uses it ONLY to enable Level-2 creation
  (feature-detect; disabled until A39 lands).
- A37 (F2) publishes getConcludedRcaCases() — feature-detect to show RCA
  conclusion in the case tab (skip silently if absent).
- Do NOT read A37/A39 files.

## Read first (only these)
- modules/defensio/COORDINATION.md
- modules/defensio/data/denials.js (A36 — appealable routing, appeal-window
  deadline field, appealCases stub shape)
- modules/claima/COORDINATION.md (published helpers: claim detail, stamped
  contract version accessor, timeline event writer, scrub trail, submission
  cycles, remittance line detail)
- modules/pactum published contract-config readers (as listed in pactum/claima
  COORDINATION notes) — for the citation picker
- Frontis published helpers list (eligibility snapshot, auth record, encounter
  documents accessors)
- design-system tokens as used by A36 screens

## Task 1 — Data (modules/defensio/data/)
- appeal-cases.js (replaces stub, keep id scheme): {id, level(1|2),
  parentCaseId, denialIds[], claimId, payerId, disputedAmount, grounds{primary,
  secondary[]}, citations[{sourceRef(contract-version config pointer),
  renderedText, argument}], bundle[{type, source(system|upload), ref|file,
  description, included, order}], letter{templateId, versions[{html,
  generatedAt, manuallyEdited}], finalLockedAt}, review{rounds[{reviewerId,
  action(approve|return), note, at}], requiredTier}, status(Draft|InReview|
  ApprovedToSubmit|Returned|Submitted|Withdrawn), submission{method, reference,
  submittedAt, lateOverride{by, reason}, packageRef}, filingDeadline(from
  denial), audit[]}
- letter-templates.js: 2 seed templates (EN generic contract-violation, EN
  medical-necessity; AR placeholder) with merge fields.
- Citation renderer (data/engines/citation-renderer.js): given a stamped
  contract-version pointer (methodology row / coverage row / preauth entry /
  rule), return human-readable text "Contract {no} v{n}, {section}: {summary},
  effective at DOS" via pactum readers. NEVER read current contract state —
  always the stamped version accessor.

## Task 2 — Screens (modules/defensio/)
- appeals-workbench.html+js: columns/stats per spec; deadline-ascending
  default; ≤7d highlight; filters; Submitted rows visible read-only (A39 will
  extend).
- appeal-case.html+js: 4 tabs per spec.
  Tab1 auto-assembly via published claima/frontis helpers (+A37
  feature-detect). Tab2 grounds + citation picker (browse the stamped
  version's config lists → add row → rendered text + argument; ≥1 enforced for
  contract grounds). Tab3 bundle: suggested list (one-click attach via
  helpers), uploads, include-toggle, order controls, grounds↔evidence warning
  map. Tab4 letter: generate (merge), rich-text edit (contenteditable is
  fine), regenerate versions, manual-edit flag.
- Review flow: Submit for Review (tier by disputedAmount ≥5000 → senior),
  reviewer approve/return with notes, preparer≠reviewer assert, rounds kept.
- Submission dialog: method/reference/date, deadline validation (late →
  role-gated override + reason, flagged), package generation (letter + bundle
  index + cover sheet as a print-view route, stored ref), on submit: status,
  denial chip update, claim timeline event via published writer.
- Level-2 creation: on lost outcome (feature-detected via A39 helper) — new
  case level 2, parent link, pre-loaded package refs.
- Withdrawal (pre-submission): reason → Withdrawn → denial returns to F1
  re-triage (call A36's re-triage/reopen helper).

## Task 3 — Hooks (only edits outside new files)
1. A36 denial detail: "Appeal case #" chip + status (lookup helper you
   publish: getAppealCaseForDenial()).
2. A36 worklist: "Has appeal" filter.
Log both in COORDINATION.md.

## Seed (hand-written)
- 4 appeal cases on A36's seeded appealable denials: 1 Draft (citations
  started, deadline 5 days — deadline-critical), 1 InReview (senior tier),
  1 ApprovedToSubmit (full bundle + locked-ready letter), 1 Submitted
  (package ref, method=portal) for A39 to pick up. Keep denial/claim refs
  consistent with A36 seed.

## Consistency requirements
- Citations: stamped-version accessor ONLY (assert no current-config import).
- Evidence: system items by reference via published helpers — never copy data.
- Immutability: locked letter + submitted package never mutate (freeze pattern
  as claima's generated files).
- Audit every mutation, A36 pattern.

## Reply checklist
Routes · files · COORDINATION entries (stub takeover, A39 interface, published
getAppealCaseForDenial, hooks) · feature-detect status (A37/A39) · open
questions.