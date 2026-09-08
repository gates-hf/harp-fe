# Amendment 10 — Pactum: Home Screen

Feature 0. A landing dashboard for Pactum computed live from existing repositories. Nothing new in the data layer except read helpers and filter-by-URL support on the existing lists.

## Speed rules
- Read only CLAUDE.md, `modules/pactum/module.js`, `app/router.js`, `features/contracts/contracts-global.js`, `features/cdm/bundle-list.js`, `features/payer-master/payer-list.js`, `features/cdm/cdm-list.js`, and the files named here.
- Purely additive; no refactors. Reuse the existing modals/wizards by calling their exported open functions (export them if they aren't yet).
- No new seed. Use `ctx.onData` so every number stays live.
- Verify: `node --check`, load `#/pactum`, click every card and quick action once, stop.
- Reply: route list + open questions only.

## Files
```
modules/pactum/features/home/
  home.html / home.js                      #/pactum  (module default route; sidebar entry "Home", first)
  home-kpis.js                             card definitions + counts
  home-attention.js                        three compact tables
  home-activity.js                         recent audit entries
  home-quick-actions.js                    buttons + the two chooser dialogs
```
Lists gain **query-string filters** so cards land pre-filtered: router passes `?key=value` params to screens; lists read them on mount and set the matching filter controls. Supported: `#/pactum/payers?status=Active`, `#/pactum/contracts?expiring=60`, `#/pactum/payers/all/contracts?status=Draft` → simpler: add a Status filter "Draft" support to the global contracts list via `?status=Draft` (global list currently Active-only; when `status` param is present, show that status instead), `#/pactum/cdm?status=Active`, `#/pactum/cdm/bundles?flagged=1`.

## KPI cards (`home-kpis.js`)
Grid of 6 using the design-system metric rail/card. Each: value, label, sub-line, click target.
| Card | Value | Sub-line | Target |
|---|---|---|---|
| Payers | total | "n active" | `payers?status=Active` |
| Active Contracts | Active count | "across n payers" | `contracts` |
| Expiring Soon | Active with endDate ≤ today+60 | "within 60 days" | `contracts?expiring=60` |
| Draft Contracts | Draft count | "n ready to activate" (zero blockers) | `contracts?status=Draft` |
| CDM Items | items (kind=item) total | "n active" | `cdm?status=Active` |
| Bundles | bundles total | "n flagged" | `cdm/bundles?flagged=1` |
Highlight (amber accent) Expiring Soon and Bundles when their attention count > 0. The number on the card must equal the row count of the list it opens — compute both from the same repository helper (`contracts.expiringWithin(days)`, `cdm.flaggedBundles()`, add if missing).

## Attention tables (`home-attention.js`)
Three panels side by side (stack on narrow), max 5 rows each, "View all →" in the panel header to the filtered list, row click opens the record.
- **Contracts Expiring Soon**: Payer, Contract, End date, Days left (amber chip), sorted ascending days.
- **Draft Contracts**: Payer, Contract, Missing (from `activationBlockers`, rendered as up to 2 short chips + "+n"; "Ready to activate" in green when empty), Last updated.
- **Bundles Flagged for Review**: Bundle, Reason (`flagReason`), Flagged since (`flaggedAt` — add to the flag helper if missing; fall back to updatedAt).
Positive empty states: "No contracts expiring in the next 60 days", "No drafts waiting", "All bundles are in good shape".

## Recent Activity (`home-activity.js`)
Last 5 audit entries across all entities, newest first: time (relative + full on hover), user, action + entity label, link resolving by entity type → payer editor / CDM item edit / bundle builder / contract page / rule wizard / import screen. "View all" opens a simple full audit list at `#/pactum/activity` (one table, filter by entity type, paginated — small extra file `activity-list.js`).

## Quick actions (`home-quick-actions.js`)
Header row of buttons: **Add Payer** (opens payer modal), **Add Contract** (dialog: payer picker of Active payers → opens the contract modal for that payer, then navigates to that payer's contracts on save), **Add CDM Item** (item modal), **Create Bundle** (navigates to builder /new), **Bulk Import** (dialog with two choice cards: Payers → `payers/import`, CDM Items → `cdm/import`). After a modal save, the dashboard re-renders via `ctx.onData`.

## Layout
Panel header "Pactum" + quick actions on the right; KPI grid; three attention panels; recent activity panel full width. Design-system components only; `.split` / grid utilities already in the system.

## Module changes
`module.js`: add route `#/pactum` → home, first nav entry "Home"; module default route becomes home (the shell's landing on `/` follows).

## Done when
`#/pactum` renders live KPIs that reconcile with their target lists, attention tables and activity link to the right records, all five quick actions work. Changelog entry. Reply with route list + open questions.