# Amendment 15 — Frontis: Encounter / Visit Registration

F4. Encounters are the spine that later features hang off (pre-auth, clearance, estimates, referrals, accounts). This amendment creates the entity with **linked-record hooks** so those features register themselves without touching encounter code. Note: the spec's step numbering jumps 1 → 2 → 4; step 3 is the Financial Classification step (US-3).

## Speed rules
- Read only CLAUDE.md, `modules/frontis/features/eligibility/eligibility-check.js` (exports `runAutoCheck`, `latestValid`), `tab-eligibility.js`, `features/patient-master/patient-view.js`, `patient-list.js` (patient picker), `data/repositories/patients.js`, `policies.js`, `eligibility.js`, `shared/roles.js`, and the files named here.
- Purely additive; no refactors. Copy the bundle-builder stepper for the flow.
- Seed: ~25 encounters — 8 hand-written for today (OP/IP/ER mix, incl. one Planned, one Not-cleared shape), rest generated over the last 30 days with a seeded PRNG; each Active/Discharged encounter links an existing eligibility snapshot.
- Verify: `node --check`, load each route once, create one encounter end to end, stop.
- Reply: route list + open questions only.

## Files
```
data/seed/encounters.js  data/repositories/encounters.js
data/seed/reference.js                          departments, doctors (name + department), wards, bed classes  (shared reference lists)
modules/frontis/features/encounters/
  encounter-board.html / encounter-board.js     #/frontis/encounters
  encounter-new.html / encounter-new.js         #/frontis/encounters/new?mrn=   (4-step flow)
  encounter-steps.js                            step renderers (patient, visit, financial, review)
  encounter-view.html / encounter-view.js       #/frontis/encounters/:no  (tabs Visit Info · Financial · Linked Records · History)
  encounter-actions.js                          activate / cancel / discharge / reclassify dialogs
  encounter-history.js                          copy of patient-history bound to "encounter"
shared/roles.js                                 add canReclassifyEncounter, canCancelWithCharges
```
Nav: Frontis → Encounters (badge = Active today). Patient record: **New Encounter** button now live (routes to `/new?mrn=`), plus a new tab **Encounters** (patient's encounters, newest first). Push a merge re-link hook into `patients.relinkHooks`. Eligibility worklist "Linked Encounter" column now resolves to the encounter page.

## Entity
```
encounter: no ("ENC-2026-000123", sequential, never reused), patientMrn, type (OP|IP|ER), department, doctorId,
  visitReason (ER/IP), ward, bedClass (General|Semi-Private|Private|ICU), expectedLos (IP), startAt, endAt|null,
  status (Planned|Active|Discharged|Completed|Cancelled), cancelReason, los|null (computed at discharge, days, 1 min),
  financial: { policyId|null (null = Self-Pay), payerId, planId, snapshotRef, classifiedAt, classifiedBy, reason|null,
               overrideRef|null }            // current classification
  financialHistory: [ previous financial objects ],
  chargesPosted: bool (false; billing sets it later),
  clearance: { status: "Not started"|"Pending"|"Cleared"|"Blocked", items:[] }   // F9 owns the logic; this is the stamp
  linked: { referralId, preAuthIds:[], clearanceId, estimateIds:[], accountId }     // filled by later features
  createdAt, updatedAt
```
Repository: `today()`, `search(q, filters)`, `byPatient(mrn)`, `activeOfType(mrn, type)` (duplicate warning), `nextNo()`, `create(payload)` (status Planned if startAt > now else Active; audited), `activate(no)`, `cancel(no, reason)` (guard: `chargesPosted` → requires `canCancelWithCharges`), `discharge(no, at)` (IP/ER only; los = ceil days), `autoCompleteOutpatients()` on load (Active OP with startAt before today → Completed; `CONFIG.opAutoCompleteHour = 23`), `reclassify(no, {policyId, snapshotRef, reason})` (pushes old financial to history; audited), `linkRecord(no, kind, id)` for later features, `clearanceIndicator(enc)` → icon/label from `clearance.status`. Financial Class label = payer short name or "Self-Pay".

## Board — `#/frontis/encounters`
Metric rail: Active now, OP / IP / ER today (one card with split "12 · 4 · 3"), Planned today, Not cleared. Toggle **Today | All** (default Today). Table: Encounter No., Patient (name + MRN, VIP masked per role), Type chip, Department, Doctor, Financial Class, Status badge, Clearance (icon + tooltip), Start. Search (no., patient), filters Type / Status / Department / Doctor / Date range / Financial Class. Row actions: Open, Edit (Planned/Active: visit fields only), Cancel, Discharge (Active IP/ER), View History. Button: New Encounter.

## New Encounter flow — `#/frontis/encounters/new`
Stepper, 4 steps, Back-to-board in the panel header.
1. **Patient** — search picker (prefilled by `?mrn`). Banner: photo, name, MRN, age/gender, status, VIP tag. Deceased/Blocked → hard stop panel with reason, only "Back". Link "Register new patient" opens the registration form in a modal-sized drawer (reuse `patient-form` mounted in a drawer; on save returns with the new MRN selected). **Duplicate warning**: if `activeOfType(mrn, type)` exists (checked when type is chosen in step 2 as well as on entry), show a dialog with the existing encounter's no./dept/start: Open existing · Proceed anyway (audited "Proceeded despite active ENC-…").
2. **Visit** — Type* (OP/IP/ER), Department*, Doctor* (filtered by department), Start* (default now; future → Planned note), then type-specific: ER/IP Visit reason*; IP Ward*, Bed class*, Expected LOS*.
3. **Financial classification** — policy chain radios (`policies.chain` + Self-Pay), highest active pre-selected. On selection, auto-run: if `eligibility.latestValid(mrn, policyId, 7)` exists → card "Valid snapshot ELG-… from <date> — Reuse · Re-check"; else `runAutoCheck` immediately (encounterId assigned after create; pass a temp and call `attachEncounter` on save). Inline result (badge, conditions, failures) using the eligibility result renderer. On Not Eligible: buttons "Try next policy" (cascade) / "Use Self-Pay" / **"Proceed anyway"** (role `canOverrideEligibility` → opens the eligibility override dialog; the override ref is stamped). Next is disabled until a classification with an acceptable result (Eligible, With Conditions, Self-Pay, or overridden) is set.
4. **Review** — summary of all steps + classification card. Create → `nextNo()`, `create`, `attachEncounter(snapshotRef, no)`, set `policy.usedInEncounters = true`, `patient.lastVisitAt`, audit, navigate to the encounter page with toast "ENC-… created (Active)".

## Encounter page — `#/frontis/encounters/:no`
Header: patient banner (compact), encounter no., type chip, status badge, clearance indicator, actions by status: Planned → Activate · Edit · Cancel; Active → Edit · Discharge (IP/ER) · Cancel; terminal → none. Tabs:
- **Visit Info**: all step-2 fields; LOS for discharged IP.
- **Financial**: current classification card (payer/plan/policy no., snapshot ref → link opens `#/frontis/eligibility/:ref`, result badge with ⚑ if overridden, classified by/at) + button **Re-classify** (role-gated) → dialog: policy chain radios, Reason*, runs a fresh check inline, confirm → `reclassify`. Below: "Previous classifications" table from `financialHistory`.
- **Linked Records**: rows for Referral, Pre-auths, Clearance, Estimates, Account — each shows linked count/ids or "None yet" and a disabled "Create" button with tooltip "Available in a later feature" (F5–F10 wire these).
- **History**: audit trail.

## Dialogs — `encounter-actions.js`
Activate (confirm). Cancel: Reason*; if `chargesPosted` and role lacks `canCancelWithCharges` → disabled with tooltip. Discharge: Date/time* (≥ start) → los computed and shown before confirm. All audited.

## Seed
Doctors per department (Lebanese names), wards/bed classes. 8 today's encounters: 3 OP Active, 2 IP Active (one ICU), 1 ER Active, 1 Planned OP this afternoon, 1 Active IP with `clearance.status: "Blocked"` and items ["Pre-auth pending", "Deposit not collected"] so the indicator has something to show. Older ones Discharged/Completed with LOS; one Cancelled. Financial classifications reference seeded policies and snapshots; two encounters Self-Pay; one with an overridden snapshot.

## Done when
Board (today/all, filters), full 4-step creation with auto eligibility (reuse and re-check paths, cascade, override), duplicate warning, encounter page with all tabs, re-classify with history, lifecycle dialogs incl. LOS and charges guard, OP auto-complete on load, patient Encounters tab, eligibility links resolve. Changelog entry. Reply with route list + open questions.