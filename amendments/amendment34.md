# Amendment 34 — Claima: Daily Transaction Report  (TAG: A34 — runs in parallel with A35)

## Parallel protocol
Follow `modules/claima/COORDINATION.md` (relaxed rule: tagged `A34` new-helper sections allowed in finished Claima repositories). You own `modules/claima/features/dtr/`, `data/seed/business-days.js`, `data/repositories/business-days.js` (days + snapshots), `data/seed/cash-sessions.js`, `data/repositories/cash-sessions.js`, `data/engines/dtr-engine.js`. **One Frontis touch allowed** (you are the only session doing so): if `data/repositories/ledger.js` has no `afterAppendHooks[]`, add it (additive) so post-close postings can be tagged Prior-Day. A35 (Home) consumes `dtr.today()` — publish early.

## Interfaces (fixed)
**You publish**: `dtr.today()` → `{date, status, sections (compact), checks:[{key, status: OK|RED, …}], openSessions}`, `dtr.compute(date)`, `businessDays.current()`, `cashSessions.open(user)`, `cashSessions.close(...)`, `businessDays.closeDay/reopenDay`.
**You consume (read-only, drill-down links)**: Frontis `ledger` (patient cash, deposits, refunds, adjustments, PortionShift), `charges` (A25: by department/source, late, reversals), `batches` (A28), `nullifications` (A32), `remittances` + `unapplied` (A29), `denials` (A31), `writeoffs.postedTotals` (A33), `handoffs` (Pactum). Every consumed figure is a sum over posted rows in that repository filtered by business day — never a stored total.

## Speed rules
Read only CLAUDE.md, COORDINATION.md, the repository files above (query helpers only), `modules/frontis/features/accounts/soa-view.js` (frozen-snapshot + print pattern), `shared/config.js`, `shared/roles.js`, your files. Seed: 5 business days (3 closed incl. one reopened v2, yesterday closed with one documented exception, today open) + 3 cash sessions today (2 open, 1 closed with variance). Verify: `node --check`, load each route once, close a session and close today. Reply: routes + published helpers + open requests.

## Entities
```
businessDay: date, status (Open|Closed|Reopened), openedAt, closedAt|null, closedBy|null, versions:[{ version, snapshot (full DTR JSON), dtrNo ("DTR-2026-0251-v1"), closedAt, closedBy, reopenReason|null, exceptions:[{checkKey, note, by, at}] }], reopenEvents:[{at, by, reason}]
cashSession: id ("CS-2026-000871"), date, cashier, openedAt, closedAt|null, status (Open|Closed), systemTotals {Cash, Card, Transfer, Cheque}, declared {…}|null, variance {…}|null, varianceReason|null, countersign {by, at}|null, receiptNos:[]
CONFIG.claima.dtr = { sessionVarianceCountersignThreshold: 50, roles: { canCloseDay, canReopenDay, canDocumentException, canCountersign } }
ledger/claims rows written after a day's close carry priorDay: { postedOn: <next open day>, originalDate } (set by the afterAppend hook; original dates never change)
```
**Engine** `compute(date)` → sections, each `{ rows:[{label, amount, count, priorDayAmount, drill:{repo, filter}}], total }`:
1. Charges — by department, by source type, late (separate), reversals.
2. Claims — batches created/submitted/acknowledged (count/value), rejections, nullifications.
3. Payer cash — remittances captured/posted, contractual adjustments, denials created, unapplied movements, Defensio hand-offs.
4. Patient cash — payments by method, by session, deposits held/applied/refunded, refunds.
5. Adjustments & write-offs — patient-side adjustments, payer-side write-offs (from A33), reversals.
Each section: opening (prior closed snapshot's closing) + movement = closing, per category. `checks`: cashIntegrity (Σ methods = Σ sessions = patient cash total), payerPostingEquation (paid + adj + denied + unapplied = remittance totals posted today), openingMovementClosing (per category), writeoffReconciliation (section 5 payer-side = `writeoffs.postedTotals(date)` = denials written-off today), allSessionsClosed. A zero-activity day computes and can close.
Sessions: receipts attach to the cashier's open session at payment time (`cashSessions.attach(receiptNo, cashier)` called from a Frontis-side `ledger.afterAppendHooks` subscriber you register — receipts keyed by `receivedBy` + date). Close session: system totals per method vs declared → variance; non-zero → reason*; above threshold → countersign* (role, different user); closed = immutable, receipts locked. Day close: all sessions closed + zero undocumented REDs → freeze snapshot vN, lock day; posting hooks after close route to next open day with `priorDay`. Reopen: role `canReopenDay` + reason → status Reopened; re-close → v+1 with reason on the new version; all versions kept.

## Screens
**Today's DTR** `#/claima/dtr` (also `/dtr/:date`): header (date, status badge, DTR no./version, Close day / Reopen buttons role-gated), **Checks strip** (five checks OK/RED; RED expands to offending transactions with links; "Document exception" role-gated note that persists into the snapshot). Sections as collapsible tables with "of which prior-day" sub-rows; every cell drills to a transaction list panel (repo + filter); nothing editable. Sessions panel: open/closed sessions with totals, Close session action.
**Session close** dialog: system totals per method, declared inputs, live variance, reason, countersign (second user via role switcher for the demo).
**Archive** `#/claima/dtr/archive`: table date, DTR no., versions, closed by/at, exceptions count, reopen history; open → frozen snapshot view (renders from the stored JSON only, never recomputes) with Export PDF (print) / Excel (CSV built from the snapshot). **MTD roll-up** panel: sum of the month's closed snapshots per section, labelled informational.

## Seed
Five days as described; today has real movements from all repositories (they exist), one deliberate RED (a payment with no session → cashIntegrity) that the demo fixes by attaching/closing; yesterday's v1 with a documented exception; one earlier day reopened and re-closed v2 with reason; one prior-day flagged row today.

## Done when
Engine computes all five sections + checks from posted rows only, drill-downs work, sessions open/close with variance + countersign, day close freezes v1 and locks, prior-day flagging after close, reopen/re-close versions, archive with identical export and MTD roll-up, `dtr.today()` published. Append `### 34`; COORDINATION Status.