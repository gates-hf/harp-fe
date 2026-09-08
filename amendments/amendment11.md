# Amendment 11 — Pactum: Performance

Feature 4. Read-only analytics over claims/remittance data. No claims module exists, so this amendment adds a **generated claims dataset** owned by Pactum for now (a future claims module will take ownership; the repository API stays), and a **metrics engine** with one set of definitions that every screen reads from — that is how the reconciliation stories are satisfied by construction.

## Speed rules
- Read only CLAUDE.md, `data/repositories/contracts.js`, `data/repositories/cdm.js`, `data/repositories/payers.js`, `features/home/home-kpis.js` (card pattern), and the files named here.
- Purely additive; no refactors.
- Seed: **generated**, not hand-written — a deterministic generator (seeded PRNG) producing ~600 claims. Hand-write only the denial-reason list and per-payer "personality" knobs.
- Charts: inline SVG built by a tiny helper (bars, sparkline, monthly columns). No chart library.
- Verify: `node --check`, load both routes once, run the reconciliation assertions in the engine's self-check, stop.
- Reply: route list + open questions only.

## Files
```
data/seed/claims.js                       generator + denial reasons + payer knobs
data/repositories/claims.js               query helpers (by payer, contract, period, service group)
data/engines/performance-engine.js        pure metrics: single definitions, payer + contract + service-line rollups, score
modules/pactum/features/performance/
  payer-performance.html / .js            #/pactum/performance
  contract-performance.html / .js         #/pactum/performance/contracts/:id
  perf-charts.js                          svg helpers: bar, colour-coded bar, sparkline, monthly columns
  perf-defensio-handoff.js                hand-off dialog + stored hand-offs (stub for Defensio)
data/repositories/handoffs.js + seed      underpayment hand-offs (shared entity; Defensio will own it later)
```
Nav: Pactum → Performance. Home screen: no change.

## Claims data (`data/seed/claims.js`)
```
claim: id, claimNo, payerId, planId, contractId (version active on dateOfService), dateOfService, submittedAt,
  serviceGroup, category, itemId, qty, grossBilled, allowedExpected (from billing engine or resolvedPrice; if the
  engine is too slow for 600 rows, use resolvedPrice(contract,item,date) × qty), allowedPaid, paidAt|null,
  status (Paid|Partially Paid|Denied|Pending), denialReasonCode|null, appealed: bool
denialReasons (extensible list): PA_MISSING "Prior auth missing", COV_RULE "Coverage rule trip", LATE_FILING "Late filing",
  CODE_MISMATCH "Code mismatch", MEMBER_INELIG "Member ineligible", DUPLICATE "Duplicate claim", DOC_MISSING "Documentation missing"
```
Generator: for each payer with ≥1 contract (Active or Expired this year), spread claims Jan → today across its contracts by dateOfService, across service groups weighted by category, items from Active CDM. Per-payer knobs (hand-written map): `denialRate` (0.04–0.22), `daysToPay` mean (18–75), `underpayRate` (0.02–0.15, fraction of paid claims where allowedPaid < allowedExpected by 5–40%), `trend` (improving|flat|worsening). Make one payer clearly bad (NSSF-style: slow + high denial) and one clearly good, so the table sorts meaningfully. Deterministic seed so numbers are stable across resets.

## Metrics engine (`data/engines/performance-engine.js`) — the only place definitions live
```
denialRate   = denied claims / adjudicated claims (Paid+Partially Paid+Denied), by count
daysToPay    = mean(paidAt − submittedAt) over paid claims
effectiveRate= Σ allowedPaid / Σ grossBilled
variance     = Σ (allowedExpected − allowedPaid) over paid claims where expected > paid   (underpayment $)
variancePct  = variance / Σ allowedExpected
netRevenueYTD= Σ allowedPaid this year
underpaymentsFlagged = count of claims with expected − paid > max($25, 5% of expected)
varianceCaptured (contract) = Σ variance of claims with a hand-off
varianceRecovered (payer/global) = Σ recoveredAmount from hand-offs with status Recovered
calibratedScore = 100 − (w1·norm(denialRate) + w2·norm(daysToPay) + w3·norm(variancePct)), weights {0.4, 0.3, 0.3}
  norm: linear 0→1 against fixed ceilings (denial 25%, days 90, variance 20%); clamp 0–100; weights exported as CONFIG
targets: daysToPay 30, effectiveRate = contracted target (Σ allowedExpected / Σ grossBilled)
```
API: `payerRollup(payerId, period)`, `allPayers(period)`, `contractRollup(contractId, period)`, `serviceLines(contractId, period)`, `monthlyBilled(contractId)`, `denialReasons(scope)` (ranked with % share), `sparkline(payerId)` (monthly denial rate). `period` = YTD by default; `lastQuarter` for the comparison. Include `selfCheck()` that asserts, for every payer, Σ contract rollups = payer rollup (billed, allowed, variance, denied count) and Σ service lines = contract totals; log a single line pass/fail on load in dev.

## Payer Performance — `#/pactum/performance`
KPI cards: Payers Tracked, Avg Denial Rate (delta vs last quarter, green/amber arrow), Avg Days to Pay (vs target 30), Variance Recovered YTD, Underpayments Flagged (click → filters table to payers with flags). Table, sortable, one row per payer: Payer (name + code), Active Contracts, Net Revenue YTD, Denial Rate (colour-coded bar: green < 8%, amber 8–15%, red > 15%), Days to Pay, Variance %, Calibrated Score (chip + tooltip listing the three inputs and weights), Trend (sparkline). Row click → payer's contract performance (first Active contract) — `#/pactum/performance/contracts/:id`. Read-only; note "Analytics computed from claims and remittances against contract configuration" in the panel header.

## Contract Performance — `#/pactum/performance/contracts/:id`
Header: contract selector (Contract No. + Name, grouped by payer), version chip note "expected amounts use the version active on each date of service". KPI cards: Gross Billed YTD, Allowed YTD, Effective Rate (vs contracted target), Denial Rate, Variance Captured (with "n handed off to Defensio"). Panels:
- **Monthly billed trend** (columns, YTD) and **Top denial reasons** (ranked horizontal bars with % share), side by side.
- **Service-line breakdown** table: Service Line, Volume, Charged, Allowed, Effective Rate, Denial % (colour bar), Variance ($, highest highlighted). Footer row totals must equal the KPI cards.
- **Underpayments** table (claims flagged): Claim No., Date, Item, Expected, Paid, Variance, status; row action **Hand off to Defensio** → dialog (reason preselected from denial/underpay, note) → creates a hand-off record {claimId, contractId, payerId, amount, status: Handed off|In appeal|Recovered, recoveredAmount, createdAt}, audit, chip "Handed off" on the row; seed a few hand-offs including some Recovered so Variance Recovered YTD is non-zero. Link on the chip → `#/defensio` (route will 404 to the shell's error screen until Defensio exists — acceptable; label the chip "Defensio ↗").

## Done when
Both routes render, `selfCheck()` passes, sorting/colour thresholds/score tooltip work, contract selector switches, hand-off creates a record and moves the Variance Captured / Recovered numbers. Changelog entry. Reply with route list + open questions.