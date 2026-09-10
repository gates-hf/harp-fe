# Amendment 35 — Claima: Home Screen  (TAG: A35 — runs in parallel with A34)

## Parallel protocol
Follow `modules/claima/COORDINATION.md`. You own `modules/claima/features/home/` only, plus replacing the A24 placeholder route. Everything is read from published helpers; **you compute nothing yourself**. Feature-detect `dtr.today()` (A34 runs alongside) and render "DTR arriving" until it exists. Copy the Frontis Home (amendment 23) structure and components.

## Speed rules
Read only CLAUDE.md, COORDINATION.md (Published helpers), `modules/frontis/features/home/*` (copy), `modules/claima/module.js`, `shared/config.js`, your files. No seed. Verify: `node --check`, load `#/claima`, click every card, quick action and View all once. Reply: routes + open requests.

## KPI cards (value / sub-line / warning / target — every number from the owning helper; target list must reconcile)
| Card | Helper | Sub-line | Warning when | Target |
|---|---|---|---|---|
| Unbilled Charges | `charges.unbilledGrouped()` | "n encounters · oldest N d" | oldest > CONFIG.claima.capture.lateWindowDays | `#/claima/charges` (discharged-first) |
| Coding Backlog | `coding.worklist()` | "n beyond SLA" | beyondSLA > 0 | `#/claima/coding?sla=breached` (oldest-first) |
| Ready to Submit | `claims.readyForSubmission()` + `batches.readyQueueByPayer()` | "n batches due today" | dueToday > 0 | `#/claima/submission` |
| Awaiting Payer | `lifecycle.silent()` count/value | "n escalated" | escalated > 0 | `#/claima/followups?escalated=1` (oldest-silent) |
| Open Denials | `denials.worklist()` open | "n untriaged · nearest deadline N d" | untriaged > 0 or nearest ≤ deadlineWarnDays | `#/claima/denials?status=Untriaged` (untriaged-first) |
| Cash Posted Today | `dtr.today()` patient + payer cash (fallback: ledger + remittances sums) | "payer $x · patient $y · n unposted" | unposted > 0 | `#/claima/remittances?status=Unposted` |
Fluid rail, one row, `.kpi__sub`; amber warning styling.

## Attention panels (max 5, worst-first, View all, positive empty states, rows link)
1. **Scrub-failed & stale claims** — `claims` where scrub Fail or `stale.flag`, by value desc → claim view. Empty: "All claims clean."
2. **Escalated & silent** — `lifecycle.silent()` escalated first then silent days desc → timeline. Empty: "No payer silence."
3. **Untriaged denials** — `denials.worklist()` Untriaged, amount desc, appeal countdown chip → denial page. Empty: "Nothing to triage."
4. **Remittances pending posting** — `remittances` Unposted + Posted with Exceptions, oldest first, unapplied shown → remittance page. Empty: "All cash posted."
5. **Recent activity** — reuse the shared activity component scoped to Claima entities (links via `shared/activity-trail.js` branches). View all → `#/pactum/activity?module=claima`.
Layout 2 + 2 grid, activity full width.

## Quick actions
Manual Charge → `#/claima/charges?action=manual` (opens the modal on load — add that query handling in your feature only via a hash param the charges screen already supports, else link to the screen). Create Batch → `#/claima/submission` (Ready queue focused). New Remittance → `#/claima/remittances/new`. Denials Queue → `#/claima/denials?status=Untriaged`. Today's DTR → `#/claima/dtr` (label "Close Day" variant shown only for `canCloseDay` roles).

## Module
Replace the A24 placeholder: `#/claima` → home, first nav entry "Home". Sidebar badge = escalated + untriaged.

## Done when
Six KPIs reconcile with targets, five panels link correctly, quick actions land with the right focus, role gating on the DTR action, everything via `ctx.onData`. Append `### 35`; COORDINATION Status; if last to finish, run the full-tree check.