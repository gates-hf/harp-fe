# Amendment 23 — Frontis: Home Screen

F0, built last so every panel reads a real helper. Copy the Pactum Home (amendment 10) structure exactly: KPI grid → attention panels → quick actions. Nothing here computes its own logic; each number and row comes from the owning feature's repository/engine.

## Speed rules
- Read only CLAUDE.md, `modules/pactum/features/home/home.js` + `home-kpis.js` + `home-attention.js` + `home-quick-actions.js` (copy these), `modules/frontis/module.js`, and the repository files named in the table below (signatures only).
- Purely additive, except: `module.js` default route → home, and the target lists must honour the query-string filters listed (add any that are missing, same pattern as amendment 10).
- No new seed.
- Verify: `node --check`, load `#/frontis`, click every card and quick action once, stop.
- Reply: route list + open questions only.

## Files
```
modules/frontis/features/home/
  home.html / home.js                     #/frontis  (module default; first nav entry "Home")
  home-kpis.js
  home-attention.js                       five panels
  home-quick-actions.js
```

## KPI cards — value, sub-line, target (number must equal the target list's row count; both from the same helper)
| Card | Helper | Sub-line | Target |
|---|---|---|---|
| Registrations Today | `patients.createdToday()` | "n via pre-registration" | `#/frontis/patients?created=today` |
| Active Encounters | `encounters.activeNow()` | "OP n · IP n · ER n" | `#/frontis/encounters?status=Active` |
| Expected Arrivals | `prereg.today()` (Pending+Ready) | "n ready to convert" | `#/frontis/prereg?date=today` |
| Pending Eligibility | `encounters.pendingEligibility()` = Active/Planned whose clearance item 1 is Pending/Failed | "n re-checks needed" | `#/frontis/clearance?item=eligibility` |
| Pending Pre-Auths | `preauth.needsAction()` | "n expiring ≤ 7 days" | `#/frontis/preauth?view=needs-action` |
| Not Financially Cleared | `encounters.byClearance("Blocked")` | "n conditional" | `#/frontis/clearance?status=Blocked` |
Highlight (amber) Pending Pre-Auths when expiring-soon > 0 and Not Financially Cleared when > 0. Use `.kpi__sub` and the fluid rail (6 cards, one row).

## Attention panels (max 5 rows, "View all →", positive empty states, row click opens the record)
1. **Blocked patients** — `clearance` worklist source filtered Blocked, sorted pendingSince asc: Patient (name + MRN), Encounter type chip, Blocking items (chips from `clearance.blocking`, max 2 + "+n"), Blocked for (relative, red > 24h). Row → `#/frontis/encounters/:no/clearance`. View all → clearance worklist. Empty: "Everyone is cleared."
2. **Pre-auths requiring attention** — `preauth.needsAction()` sorted: expiring soonest first, then Submitted by pending-since desc: Patient, Services (first + "+n"), Status badge, Expires in / Pending since. Row → request page. View all → worklist (needs action). Empty: "No pre-auth needs attention."
3. **Expected arrivals** — `prereg.today()` then upcoming to fill 5, sorted expectedAt: Patient (name; MRN or "New" chip), Expected (time today / date), Completeness (bar + %), **Convert** button (Pending/Ready) → `#/frontis/prereg/:no/convert`. View all → prereg worklist. Empty: "No arrivals expected today."
4. **Potential duplicates** — `duplicates.open()` sorted detectedAt desc: Patient A (name + MRN), Patient B, Basis chip, Detected, **Review** → `#/frontis/patients/merge?survivor=&duplicate=`. View all → duplicates worklist. Empty: "Registry is clean."
5. **Account flags** (bonus, from amendment 22) — `accounts.flagged()` top 5 by outstanding: Patient, Flag chips, Outstanding. View all → accounts list. Empty: "No accounts need follow-up." Omit the panel entirely if amendment 22 has not landed yet (feature-detect the helper).

Layout: 2 + 2 grid of panels, flags full width below; stack on narrow. Recent activity: reuse Pactum's `home-activity` component pointed at Frontis entities (patients, policy, eligibility, encounter, prereg, estimate, referral, preauth, clearance, account) with links resolving to each record page; View all → `#/pactum/activity?module=frontis` (add a module filter to that list if trivial, else link unfiltered).

## Quick actions (header row)
Register Patient → `#/frontis/patients/new` (duplicate check is inherent). New Encounter → patient search dialog (reuse the encounter step-1 picker in a modal) → `#/frontis/encounters/new?mrn=`. Check Eligibility → same picker → `#/frontis/eligibility/new?mrn=`. Cost Estimate → `#/frontis/estimates/new` (subject choice inside). Pre-Register → `#/frontis/prereg/new`.

## Module
`module.js`: route `#/frontis` → home, first nav entry, default route. Landing on `/` still follows the shell's first module.

## Done when
Six KPIs reconcile with their target lists, five panels (four if accounts flags absent) link correctly, quick actions land in the right flows, all live via `ctx.onData`. Changelog entry. Reply with route list + open questions.