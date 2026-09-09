# Amendment 16 — Frontis: Pre-Registration

F5. Pre-registrations capture what is known before arrival and convert into Patient Master + Encounter with zero re-entry. Everything reuses F1–F4: the registration form, the policy modal, the eligibility check, and the encounter flow.

## Speed rules
- Read only CLAUDE.md, `features/patient-master/patient-form.js` + `duplicate-check.js` (exports), `features/insurance/policy-form.js` (export an `openPolicyModal({ patientMrn|null, onSave })` if not already exported), `features/eligibility/eligibility-check.js` (`runAutoCheck`, `latestValid`), `features/encounters/encounter-new.js` (make the flow accept a `?prefill=` payload — see below), `data/seed/reference.js`, and the files named here.
- Purely additive, except the two small export/prefill hooks named above.
- Seed: 8 hand-written pre-regs (today × 4, upcoming × 2, one Expired, one Converted).
- Verify: `node --check`, load each route once, convert one pre-reg end to end, stop.
- Reply: route list + open questions only.

## Files
```
data/seed/prereg.js  data/repositories/prereg.js
modules/frontis/features/prereg/
  prereg-worklist.html / prereg-worklist.js     #/frontis/prereg
  prereg-form.html / prereg-form.js             #/frontis/prereg/new, #/frontis/prereg/:no  (single page, 4 sections)
  prereg-completeness.js                        computeCompleteness(prereg) — the one definition
  prereg-convert.js                             conversion orchestration
  prereg-history.js                             copy of encounter-history bound to "prereg"
```
Nav: Frontis → Expected Arrivals (badge = today's Pending/Ready). Patient record: header button **Pre-Register** (prefilled MRN); patient Encounters tab shows upcoming pre-regs in a small "Expected" section. Push a merge re-link hook.

## Entity
```
prereg: no ("PRE-2026-000045"), patientMrn|null, newPatient { nameEn, nameAr, dob, gender, phone, nationality, civilId, passportNo } | null,
  visit { type (OP|IP|ER|Day Case), expectedAt, department, doctorId|null, procedureItemId|null, admissionIntent: bool },
  insurance { mode: "policy"|"selfpay"|null, policyId|null (matched patient), pendingPolicy {…policy fields}|null (new patient) },
  precheck { status: Pending|Done|Failed, snapshotRef|null, at|null },
  status (Pending|Ready|Converted|Cancelled|Expired), cancelReason, convertedTo { mrn, encounterNo, at }|null,
  createdAt, updatedAt
CONFIG.preregExpiryHours = 48
```
Repository: `search(q, filters, {upcomingOnly})`, `today()`, `nextNo()`, `create/update` (recompute completeness + auto-flip Pending↔Ready on every save; audited), `cancel(no, reason)`, `expirePreregs()` on load (Pending/Ready with expectedAt + 48h < now → Expired), `reactivate(no, newExpectedAt)` (Expired → Pending, audited), `markConverted(no, mrn, encounterNo)`.

## Completeness — `prereg-completeness.js`
Four groups, each a checklist; % = passed items / total items:
- **Identity**: nameEn, nameAr, dob, gender, phone, ≥1 identifier (matched patient → read from the patient record and always complete if the record has them).
- **Insurance**: policy attached or Self-Pay marked.
- **Eligibility**: precheck Done.
- **Visit**: type, expectedAt, department (+ ward/bed class not required here; IP details are completed at conversion).
Returns `{ pct, missing: ["Arabic name", "Identifier (Civil ID or passport)", "Insurance or Self-Pay", …], groups }`. Used by worklist, form, home (later), and conversion.

## Worklist — `#/frontis/prereg`
Metric rail: Expected today, Ready, Pending follow-up, Pre-check failed. Toggle **Today + upcoming | All**. Table sorted by expectedAt: Pre-Reg No., Patient (name; MRN chip if matched, "New" chip otherwise), Expected Arrival (today rows first, relative time "in 2h"), Visit Type, Department / Doctor, Completeness (progress bar + % with tooltip listing missing), Pre-Check (Done ✓ / Pending / Failed badge → link to snapshot when Done/Failed), Status badge. Search (no., name, phone, civil ID), filters Status / Date range / Department / Visit type. Row actions: Open/Edit, Convert (Pending/Ready only), Cancel, View History. Button: New Pre-Registration.

## Form — `#/frontis/prereg/new`, `/:no` (one page, four panels, autosaves on Save button only)
1. **Patient** — search existing (MRN/name/ID/phone) → on match: patient banner + "Linked to MRN-…" (unlink button). No match → **minimal new-patient fields**: Name EN*, DOB*, Gender*, Mobile*, plus optional Name AR, Nationality, Civil ID, Passport. When an identifier is typed, run `duplicate-check` softly: hard match → banner "Already registered as MRN-… — link instead?" [Link]; fuzzy/phone → informational banner only.
2. **Expected visit** — Type*, Expected arrival date/time*, Department*, Doctor (filtered), Planned procedure (CDM Active item/bundle picker), IP admission intent toggle (auto-on for IP).
3. **Insurance** — buttons Attach Policy (opens the F2 policy modal: matched patient → saves to their record and stores `policyId`; new patient → stores `pendingPolicy` on the pre-reg) · Mark Self-Pay. Shows the attached policy card or "Self-Pay" chip. For matched patients also show their existing chain with a "Use this" action per policy.
4. **Eligibility pre-check** — button Run Pre-Check (enabled when insurance is set; Self-Pay → records a Self-Pay snapshot): calls `runAutoCheck({ mrn: patientMrn ?? null, policy: policyId ?? pendingPolicy, services: [procedureItemId], visitType })` — extend `runAutoCheck` to accept a `pendingPolicy` object and a null MRN (snapshot stores `preregNo` instead; add `preregNo|null` to the snapshot entity). Result card inline (badge, conditions), `precheck.status` = Done (Eligible / With Conditions / Self-Pay) or Failed (Not Eligible); link to snapshot. Re-run allowed.
Right rail: **Completeness card** — % ring/bar + missing checklist, live as fields change; status chip Pending/Ready. Footer: Save, Convert (if Pending/Ready), Cancel (reason). Cancelled/Expired/Converted → read-only banner; Expired gets "Reactivate" (edit expected date dialog → `reactivate`).

## Conversion — `prereg-convert.js` (`#/frontis/prereg/:no/convert`)
Stepper, 3 steps, Back in panel header.
1. **Complete identity** — if new patient: mount the real `patient-form` (register mode) in the page, **prefilled** from `newPatient`, with the conversion-required fields (Name AR, identifier) highlighted; full duplicate detection incl. hard block runs on Save → creates the patient, then attach `pendingPolicy` to the new MRN via the policies repository (audited), set `patientMrn`. If matched: show the record summary; if the pre-reg captured newer values (phone, AR name, identifier) offer a "Merge new data into record" checklist → patient update audited. Next.
2. **Encounter** — hand off to the F4 flow: navigate to `#/frontis/encounters/new?mrn=…&prefill=<preregNo>`. `encounter-new.js` reads `prefill`, pre-fills step 2 from `visit` (type, dept, doctor, start = expectedAt or now, IP intent → asks ward/bed class/LOS), pre-selects the pre-reg's policy in step 3 and offers the pre-check snapshot via the existing `latestValid` card (window 7 days; else auto re-check), and on create calls `prereg.markConverted(no, mrn, encounterNo)` and returns to the encounter page with toast "PRE-… converted → ENC-…".
3. (No separate step — completion happens inside the encounter flow; the convert screen's last panel just says "Continue to encounter" and links.)

## Seed
Today: one Ready matched patient with pre-check Done (the happy-path demo), one Pending new patient missing AR name + identifier with pre-check Done, one matched patient with pre-check Failed (use the no-contract plan patient from amendment 14), one Self-Pay Ready. Upcoming ×2 (one IP with admission intent + procedure Appendectomy Package). One Expired (expected 3 days ago). One Converted (linked to a seeded encounter).

## Done when
Worklist with completeness and pre-check badges, form with all four panels and live completeness/Ready flip, policy attach in both modes, real pre-check snapshots, expiry + reactivate + cancel, conversion for both new and matched patients ending in a created encounter with the pre-check snapshot reused. Changelog entry. Reply with route list + open questions.