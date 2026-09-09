# Amendment 18 — Frontis: Referral Management

F7. Inbound and outbound referrals, linked to encounters, with a small **Pactum-side addition**: a "Referral Required" configuration on the contract (US-5). That is the one cross-module touch; it is additive to the Pactum contract page (a section on the Pre-Auth tab, not a new tab).

## Speed rules
- Read only CLAUDE.md, `features/encounters/encounter-new.js` (step 2 + `?prefill=`), `encounter-view.js` (Linked Records), `data/repositories/encounters.js` (`linkRecord`), `data/engines/eligibility-engine.js` (conditions), `modules/pactum/features/contracts/tab-preauth.js` + `preauth-form.js` (pattern), `data/repositories/contracts.js` (`resolvePreAuth` shape), `data/seed/reference.js`, `features/prereg/prereg-form.js` (unregistered-person pattern), and the files named here.
- Purely additive, except: encounter step 2 gains a Referral field; eligibility engine gains a step-6 condition; Pactum Pre-Auth tab gains a Referral Required section.
- Seed: 10 hand-written referrals + a handful of source facilities/doctors.
- Verify: `node --check`, load each route once, link one referral to a new encounter, stop.
- Reply: route list + open questions only.

## Files
```
data/seed/referrals.js  data/repositories/referrals.js
data/seed/referral-sources.js  data/repositories/referral-sources.js     facilities + external doctors (reusable list)
modules/frontis/features/referrals/
  referral-worklist.html / .js                  #/frontis/referrals
  referral-form.html / referral-form.js         #/frontis/referrals/new?direction=&mrn=&encounterNo=, /:no (edit while New/Scheduled)
  referral-view.html / referral-view.js         #/frontis/referrals/:no/view  (read-only + printable outbound form)
  referral-actions.js                           link / reject / cancel / extend validity / schedule dialogs
  referral-history.js                           copy bound to "referral"
modules/pactum/features/contracts/tab-preauth.js + referral-required-form.js   Referral Required section (Pactum)
shared/config.js                                CONFIG.referralValidityDays = 30
```
Nav: Frontis → Referrals (badge = active inbound). Patient record: **Referrals** section (list + New inbound/outbound). Encounter page: Linked Records → Referral row live; header action "Refer out". Push a merge re-link hook. Pre-reg: when a pre-reg is created for an unregistered person, look up open referrals by phone and offer to link.

## Entities
```
referral: no ("REF-2026-000210"), direction (Inbound|Outbound), type (External|Internal),
  patientMrn|null, unregistered { name, phone }|null,
  source { facilityId|null, doctorId|null, internalDepartment|null }        // inbound: who referred; outbound: our dept/doctor
  destination { facilityId|null, doctorName|null, specialty, department|null } // inbound: our target; outbound: where sent
  reason, referralDate, validUntil, payerRef|null, letter {fileName,size}|null,
  visits { total: 1, remaining: 1 },            // multi-visit
  status (New|Scheduled|Used|Expired|Rejected|Cancelled), statusReason, scheduledPreregNo|null,
  encounterNos: [], createdAt, updatedAt
referralSource: id, kind (Facility|Doctor), name, facilityId|null (for doctors), specialty|null, phone|null, usageCount
contract.referralRequired: [{ id, scopeLevel (Contract|Service Group|Category|Item), scopeValue|null, required: bool, updatedAt }]   // Pactum
```
Repository (`referrals`): `search(q, filters)`, `activeInbound()`, `nextNo()`, `create/update`, `validForEncounter(mrn, specialty|department, date)` → New/Scheduled, validUntil ≥ date, remaining > 0, specialty/department compatible (match department, or specialty maps to department via reference list; if no specialty on the referral → compatible), `link(no, encounterNo)` (remaining −1, push encounterNo; remaining 0 → Used; audited), `schedule(no, preregNo)`, `reject/cancel(no, reason)`, `extend(no, newValidUntil, reason)` (audited; allowed on New/Scheduled/Expired → back to New), `expireReferrals()` on load, `byPatient(mrn)`, `byPhone(phone)` (unregistered), `attachMrn(no, mrn)` (called at registration when phone matches — hook into `patients.create` via a small post-create hook array `patients.afterCreateHooks`). `referral-sources`: `search(kind, q)`, `upsertFromForm` (typing a new facility/doctor name creates it; usageCount++ on each referral).
Contracts repository: `referralRequired(contract, item|null)` → most-specific scope wins (Item → Category → Service Group → Contract) → bool.

## Worklist — `#/frontis/referrals`
Metric rail: Active inbound, Expiring ≤ 7 days, Scheduled, Outbound this month. Toggle **Active inbound | All | Outbound**. Table: Referral No., Direction chip, Patient (name + MRN chip, or name + "Unregistered" chip), Source / Destination (facility · doctor), Specialty, Referral Date, Valid Until (amber ≤ 7 days), Visits (remaining/total when total > 1), Status badge, Linked Encounter(s). Search (no., patient, doctor/facility), filters Direction / Status / Specialty / Date range / Source. Row actions: Open/Edit, Link to Encounter (New/Scheduled), Reject, Cancel, View History. Button: New Referral (menu Inbound · Outbound).

## Form — `referral-form.js`
Direction fixed by entry. Common: Patient (search picker; inbound may instead toggle "Unregistered person": Name*, Phone*), Type* (External/Internal), Specialty*/Department (inbound: target; outbound: destination), Reason*, Referral date* (default today), Validity (inbound: default +30 days; outbound: optional), Payer referral reference, Letter upload (PDF/JPG/PNG ≤ 10 MB, metadata), Visits total (default 1, ≥ 1).
Inbound-specific: Referring facility (combobox over sources; free text creates a new source) and Referring doctor (combobox, filtered by facility; new → created). Internal type → referring department + our doctor instead.
Outbound-specific: Source encounter (patient's Active encounters, optional; prefilled by `?encounterNo`), Destination facility* (combobox), Destination doctor / specialty*. Save → New; audited. Outbound view page offers **Print referral form** (printable layout: hospital header, patient, encounter, referring doctor, destination, reason, date, signature line) or upload of the signed letter.

## Actions — `referral-actions.js`
**Link to Encounter** dialog: patient's Active/Planned encounters → confirm → `link` + `encounters.linkRecord(no, "referral", refNo)`. **Schedule**: pick a pre-reg of the patient (or create one prefilled) → Scheduled. **Reject / Cancel**: Reason*. **Extend validity**: New date* (> today) + Reason* → audited; Expired referrals only get this action. All others read-only on terminal states.

## Encounter integration
- Step 2 of `encounter-new.js` gains **Referral** (optional): lookup listing `validForEncounter(mrn, department, startAt)` with remaining count shown; expired ones absent (helper text "Expired referrals must be extended first"); choosing one → on create `link` + `linkRecord`. `?prefill` from a Scheduled referral's pre-reg carries the referral.
- Encounter page Linked Records: Referral row shows the linked referral (no., source, remaining visits) or "None" + Link button (Active only); header **Refer out** → outbound form prefilled.
- **Referral-required flag**: eligibility engine gets step 6 `referral` — when the resolved contract's `referralRequired(contract, service)` is true and the check context has no linked/selected referral → condition "Referral required by payer — missing". In encounter step 3 the classification card shows it amber and step 2's Referral field is highlighted; the encounter stores `flags.referralMissing = true` (clears when a referral is linked). Board: small "Referral missing" marker in the Clearance column tooltip; `clearance.items` gets "Referral required — missing" (F9 will treat it as blocking).

## Pactum — Referral Required section (on the Pre-Auth tab)
Below the pre-auth matrix: panel "Referral Required" with a contract-level toggle (row scopeLevel Contract) and a scoped rows table (Service Group / Category / Item, Required Yes/No, same pickers as pre-auth, exemptions by "No"). Add/edit modal copied from `preauth-form.js`. Audited. Seed: NSSF contract → Contract-level required, Category Consultation exempt; AXA → Category Radiology required.

## Seed
Sources: 6 facilities (clinics/hospitals in Beirut, Tripoli, Saida…), 8 external doctors. Referrals: 5 inbound New (one multi-visit 3/3, one expiring in 4 days, one unregistered person with a phone matching a seeded pre-reg), 1 Scheduled, 1 Used (linked to a seeded encounter), 1 Expired, 2 Outbound (one with printable form, one Used). One seeded Active encounter on the NSSF contract without a referral → shows the missing flag.

## Done when
Worklist (three views), inbound/outbound forms with growing source list, link with visit decrement → Used, schedule, reject/cancel/extend, expiry on load, printable outbound form, encounter Referral field + Linked Records + Refer out, referral-required flag from Pactum config through eligibility to the encounter, Pactum section with audit. Changelog entry. Reply with route list + open questions.