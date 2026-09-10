# Amendment 30 — Claima: Claim Lifecycle Tracking  (TAG: A30 — runs in parallel with A28, A29)

## Parallel protocol
Follow `modules/claima/COORDINATION.md`. You own ONLY `modules/claima/features/lifecycle/`, `data/seed/followups.js`, `data/repositories/followups.js`, `data/engines/claim-events.js`, `data/engines/payer-stats.js`, your `A30` section of `claims.js`. No Frontis/Pactum files. You are a **read-mostly consumer**: hooks from A27/A28/A29 may not exist when you start — feature-detect each (`batches?.afterSubmitHooks?.push`) and also derive events from the audit trail (`claims.history(id)`), so the timeline works even before peers publish.

## Interfaces (fixed)
**You publish**:
- `claimEvents.byClaim(claimNo)` → ordered `[{at, type, actor, summary, link}]` (A28/A29 may show it)
- `lifecycle.escalated()` → Escalated claims (the future Claima home reads this)
- `lifecycle.silent(payerId?)` → follow-up queue
- `payerStats.summary(period)`, `payerStats.trend(payerId, months)` — definitions shared with Pactum performance-engine
**You consume**: `claims.*` + `claims.history(id)` (A24/A27), `batches.byClaim` + hooks (A28), `remittances.byClaim` + hooks (A29), `denials.byClaim` (A29), `handoffs` (Pactum), `performance-engine` definitions (read `denialRate` etc. to reuse formulas, don't duplicate: import and call where the signature allows).

## Speed rules
Read only CLAUDE.md, COORDINATION.md, `claims.js`, `data/engines/performance-engine.js` (definitions), `modules/pactum/features/performance/perf-charts.js` (copy svg helpers), `shared/config.js`, your files. Seed: follow-ups for 5 silent claims; no other data (everything derives). Verify: `node --check`, load each route once, log one follow-up. Reply: routes + published helpers + open requests.

## Entities
```
claimEvent (derived, not stored): { at, type: Assembled|Refreshed|Scrubbed|Finalized|Reopened|Batched|FileGenerated|Submitted|Acknowledged|Rejected|Resubmitted|RemittancePosted|Denied|HandedOff|PatientShift|FollowUp|Escalated|Closed, actor, summary, link, sourceId }
followUp: id, claimNo, at, by, method (Phone|Portal|Email|Visit), contact, note, nextDueAt       // append-only
CONFIG.claima.lifecycle = { silentDays: {default: 30, byPayer: {}}, escalationDays: {default: 60, byPayer: {}}, boardColumns: [Draft, Ready, Submitted, Acknowledged, Rejected, Paid, Partially Paid, Denied, Appealed, Closed], hiddenColumns: [] }
```
**Events engine**: builds the timeline from audit entries keyed on the claim + batches/remittances/denials/handoffs/follow-ups lookups; each event carries a deep link (claim, batch, remittance, denial, hand-off, coding). `lastPayerEvent(claimNo)` = latest Acknowledged/Rejected/RemittancePosted/Denied. `daysInStatus`, `silentDays` (since submission or last payer event). Escalation and silence are **computed on every read** — never stored, so they set/clear automatically. `family(claimNo)` → original, cycles, supplementary, secondary.
**Payer stats**: per payer: Submit→Ack avg days, Submit→First payment avg days, rejection rate (rejected / submitted), resubmission rate, claim-level denial rate (reuse performance-engine formula), current silent count/value, escalated count; monthly trend arrays; `export(period)` → CSV. Add a `selfCheck()` asserting denial rate equals performance-engine's for the same scope.

## Screens
**Pipeline board** `#/claima/pipeline`: kanban of `boardColumns` (column header: count + value), cards: claim no., patient, payer, value, days-in-status chip (amber > 15, red > 30), kind chip (Supp/Secondary/Cycle n), escalated ⚑. Filters: Payer / Department / Type / Value band / Age / Dates / "Collapse families" (show one card per family). Search. Column visibility menu (persists in sessionStorage). No drag — cards move only on events (explain in an info tooltip).
**Aging** `#/claima/aging`: table status × buckets 0–15 / 16–30 / 31–60 / 60+ with count + value per cell; 60+ cells highlighted; cell click → filtered board/flat list; row and column totals; assert totals equal the board's.
**Claim timeline** `#/claima/claims/:no/timeline` (also a Timeline tab on the claim view if its tab registry allows): family strip (original ↔ cycles ↔ supplementary ↔ secondary, both ways), then chronological events with actor, summary, link. Read-only.
**Follow-up worklist** `#/claima/followups`: Submitted/Acknowledged claims silent beyond threshold, oldest-silent first: claim, payer, value, silent days, last follow-up, next due, Escalated ⚑; actions Log follow-up (method, contact, note, next due) · bulk log for selected same-payer claims; queue entry disappears automatically on a payer event. Rail: Silent count/value, Escalated, Due today.
**Payer statistics** `#/claima/payer-stats`: period selector; table per payer (metrics above) with sparklines; drill to trend chart per payer; Export to Excel (CSV). Footnote: "Same definitions as Pactum Performance" + selfCheck status.

## Done when
Board with live event-driven cards and family collapse, aging reconciling with the board, full timeline with deep links and family strip, follow-up queue with append-only logs and auto-clear, computed escalation exposed via `lifecycle.escalated()`, payer stats with export reconciling with Performance. Append `### 30`; COORDINATION Status; if last to finish, run the full-tree check.