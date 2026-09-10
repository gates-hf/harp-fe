# Amendment 36 — Defensio module bootstrap + F1 Denial Intake, Triage & Routing
# TAG: A36 — SINGLE SESSION (bootstrap + Claima takeover; parallel sets start at A37)

## Speed rules (standing)
- Read ONLY the files named here. No repo-wide scans.
- Purely additive except the named Claima takeover edits below.
- Small hand-written seed; no generators.
- Verification = syntax check only (node --check per JS file).
- Reply with: route list + files written + open questions.

## Context
New module: **Defensio** (denial management) at `modules/defensio`, same design
system and shell as pactum/frontis/claima. This amendment bootstraps the module
AND takes over denial management from Claima (built in A31 as claima F7).
Claima keeps POSTING denials (A29 remittance engine); Defensio owns everything
after: worklist, triage, routing, resolution.

## Read first (only these)
- design-system/ (tokens + shell, as used by modules/claima)
- modules/claima/COORDINATION.md (entity ownership + published helpers)
- The A31 denials files (listed in COORDINATION.md under denials ownership):
  denials entity/store, denials worklist + detail screens, triage logic
- modules/claima/data/ remittance-posting engine (A29) — ONLY the function that
  creates denial records on posting (do not modify its posting math)

## Task 1 — Bootstrap modules/defensio
- modules/defensio/ with module home placeholder (F0 comes last), nav entry
  "Defensio — Denial Management", module color per design system pattern.
- Create modules/defensio/COORDINATION.md (copy claima's format): declare
  Defensio owns the `denials` entity from this amendment on; future parallel
  sessions (A37+) register here.

## Task 2 — Takeover (the ONLY non-additive edits)
1. Move denials entity ownership: relocate the denials store/data to
   modules/defensio/data/denials.js (keep record shape; extend per Task 3).
   Claima's remittance engine keeps calling the SAME published helper
   `createDenialRecord(...)` — re-export it from its old path so A29 code is
   untouched.
2. Claima denials screens (A31 worklist/detail): replace body with a redirect
   stub → Defensio worklist/detail routes ("Denial management has moved to
   Defensio" + auto-link). Do not delete files.
3. Claima home (A35): "Open Denials" KPI + "Untriaged Denials" table now count
   from the Defensio store and link to Defensio routes (edit the data source +
   hrefs only).
4. Claim timeline (A30): denial events' links point to Defensio detail route.
5. Log all four edits in BOTH COORDINATION.md files (claima: "denials revoked
   → defensio A36").

## Task 3 — F1 screens & logic (modules/defensio, per the F1 user stories)
- **Worklist** (defensio/denials.html + js): columns incl. separation badge,
  triage class, route link, status, appeal countdown; header stats (open,
  untriaged, recovered MTD, written-off MTD, separated-out MTD); untriaged-first
  then amount-desc; filters + bulk triage (same-reason multi-select).
- **Detail & one-pass triage** (denial-detail.html + js): evidence panel
  (denied lines billed/expected/denied, stamped contract version, linked
  auth/referral/docs, timeline excerpt — read via published claima helpers, do
  not duplicate data); triage form = category (clinical/technical/admin) +
  three-tier (hard/soft/underpayment) + separation (true/contractual/tpa) +
  for true denials: class + root cause (internal list) + auto-suggested
  overridable route + assignee + notes. Tier → class suggestion map as specced.
- **Separation behavior:** contractual → status Reclassified + reconciliation
  note record linked to the claim; tpa → Reclassified + create
  `tpaFeeAccruals` stub record (entity owned by future A42/F7 — create the
  store file with a TODO header, register in COORDINATION.md).
- **Routing:** create linked work-item records via existing published creators:
  claima recode request (A26), charge-correction flag (A25), reassembly-refresh
  flag (A27), frontis preauth rework (frontis F8 store), claima write-off
  request (A33). Appealable → create `appealCases` stub record (owned by
  future A38/F3 — stub store + TODO, register). One active route per denial;
  re-route requires reason; both-way links.
- **Resolution engine** (defensio/data/engines/denial-resolution.js): derive
  Recovered/Partially/Reopened-repeat from claima remittance postings of
  resubmitted claims; Written Off from A33 postings; manual resolution
  role+reason flagged. Ledger assert: denied = recovered + lost + writtenOff +
  reclassified + open (console.assert on load).
- **Appeal windows:** per-payer appealWindowDays (default 30) read from pactum
  payer record if present else default; countdown on record; DeadlinePassed
  flag; ≤7-day highlight.

## Seed (hand-written, extend claima's seeded denials)
- Re-tag ~10 existing seeded denial records across states: 3 untriaged, 2
  corrigible-routed (1 recode, 1 auth), 2 appealable (1 with appeal-case stub),
  1 write-off-routed, 1 reclassified-contractual, 1 reclassified-tpa; 1 with
  deadline ≤ 5 days; keep claim/remittance refs consistent with A29 seed.

## Consistency requirements
- Shared denial-reason list: import from its existing single source — never
  copy it.
- Never recompute expected amounts — always the claim's stamped evaluation via
  claima helpers.
- Audit entries on every triage/route/resolution mutation (same audit pattern
  as claima).
- RCM chain intact: Claima F5 posts → Defensio intakes → routes → Claima/
  Frontis execute → remittance/write-off resolves → figures reconcile.

## Reply checklist
Routes added/changed · files written · COORDINATION.md entries (both modules) ·
open questions.