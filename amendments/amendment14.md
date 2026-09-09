# Amendment 14 — Frontis: Eligibility Check

F3. Eligibility runs the patient's policy chain against Pactum's contract configuration and stores each attempt as an immutable snapshot. The verification logic is a **pure engine in `data/engines/`** so Encounter Registration (F4) can call the same function inline.

## Speed rules
- Read only CLAUDE.md, `data/repositories/policies.js`, `data/repositories/patients.js`, `data/repositories/contracts.js` (`contractForService`, `resolveCoverage`, `patientShare`, `resolvePreAuth`, `resolvedPrice`), `data/engines/billing-engine.js` (signature only), `modules/frontis/features/insurance/tab-insurance.js`, `modules/pactum/features/billing-eval/simulator.js` (patient/service pickers), and the files named here.
- Purely additive; no refactors.
- Seed: ~15 snapshots across 8 patients, hand-written outcomes (generate the reference numbers/timestamps).
- Verify: `node --check`, load each route once, run one check + one cascade in the browser, stop.
- Reply: route list + open questions only.

## Files
```
data/engines/eligibility-engine.js              pure: verify(patient, policy, ctx) → result object
data/seed/eligibility.js  data/repositories/eligibility.js   snapshots (append-only)
modules/frontis/features/eligibility/
  eligibility-worklist.html / .js               #/frontis/eligibility
  eligibility-check.html / eligibility-check.js #/frontis/eligibility/new?mrn=&policyId=&encounterId=
  eligibility-result.html / eligibility-result.js  #/frontis/eligibility/:ref  (snapshot page, printable)
  eligibility-override.js                       override dialog
  tab-eligibility.js                            Eligibility tab on the patient record (history)
shared/roles.js                                 add canOverrideEligibility
```
Nav: Frontis → Eligibility (badge = checks today). Patient record: new tab **Eligibility** (after Insurance) and header button **Check Eligibility** → check screen prefilled. Insurance tab: successful checks set `policy.lastVerifiedAt`.

## Engine — `eligibility-engine.js`
`verify({ patient, policy | "SELF_PAY", date, visitType|null, services: [{itemId, qty}] })` → 
```
{ result: Eligible | Not Eligible | Eligible with Conditions | Self-Pay,
  steps: [ {key, label, pass: bool, detail} ]  in fixed order:
    1 patientStatus   — Active only (Deceased/Blocked/Merged fail)
    2 policyValidity  — status Active and date within validFrom..validTo
    3 contract        — contractForService(payerId, planId, date) exists; record contractId + version
    4 coverage        — resolveCoverage for each service (or Default row when no services): covered?, share rule, ceiling
    5 preAuth         — resolvePreAuth per service; any required → condition
  conditions: [ "Pre-auth required: MRI Brain", "Item X not covered — patient responsibility", "Ceiling $500 applies" ],
  failureReasons: [ … ],           // populated when any of steps 1–3 fail
  coverageSummary: { rows:[{service, covered, shareRule, ceiling, estimatedPatientShare}], defaultRule, ceilingRemaining|null (= ceiling, no accumulation yet), exclusions:[…] },
  contract: { id, no, version } | null }
```
Result rule: any of steps 1–3 fail → Not Eligible; all pass and no conditions → Eligible; conditions present → Eligible with Conditions. `"SELF_PAY"` short-circuits to result Self-Pay with steps skipped. No DOM, no writes.

## Snapshot entity — `eligibility` (append-only repository)
```
snapshot: ref ("ELG-2026-000123"), patientMrn, policyId|null (null = Self-Pay), payerId, planId, checkType (Manual|Auto-Registration|Re-check),
  visitType|null, services[], checkedAt, checkedBy, systemResult, steps, conditions, failureReasons, coverageSummary, contract,
  override: { result, reason (Payer phone confirmation|Payer portal|Management decision|Other), payerRef, contact, by, at } | null,
  finalResult (= override.result ?? systemResult), encounterId|null, attemptOf (ref of first attempt in a cascade)|null
```
Repository: `create(snapshot)` (audit), `byPatient(mrn)`, `latestValid(mrn, policyId, days=7)` (for F4 reuse), `attachEncounter(ref, encounterId)` (only field that may be set after creation; audited), `applyOverride(ref, override)` (stores alongside, never replaces systemResult; audited). No update/delete otherwise. Reference numbers sequential per year from a store counter.

## Worklist — `#/frontis/eligibility`
Metric rail: Checked today, Eligible, With conditions, Not eligible, Overridden. Table: Patient (name + MRN), Payer / Plan (or Self-Pay), Check Type, Result badge (⚑ "Overridden" marker when override present), Reference No., Checked by / at, Linked Encounter (link or —). Search (patient, ref), filters Result / Date range / Payer. Row actions: View Result, Re-check (→ check screen prefilled with the same patient + policy, checkType Re-check), View History (→ patient Eligibility tab). Button: New Check.

## Check screen — `#/frontis/eligibility/new`
Left: **Patient** picker (search by MRN/name/ID; prefilled by `?mrn`), showing status banner if not Active. **Policy chain** list from `policies.chain(mrn)` + final Self-Pay row: radio per row, highest priority pre-selected (or `?policyId`), each row shows payer/plan/validity. **Optional service context**: Visit type (Outpatient|Inpatient|Emergency|Day Case), Anticipated services (CDM item picker with qty, multi). Date defaults today. Button **Run Check**.
Right: **Result panel** renders the engine output: result badge, the 5 steps as a checklist with pass/fail and detail, conditions list, coverage table, failure reasons in red. On completion the snapshot is created immediately (immutable) and the panel shows its Reference No. with buttons **Open snapshot**, **Print**, **Override** (role-gated), and — when result is Not Eligible and a next chain policy exists — a **cascade prompt**: "Try next policy: AXA · Gold?" [Check next] which runs and stores another snapshot (`attemptOf` = first ref) and stacks results as collapsible cards. When the chain is exhausted: "All policies failed — proceed as Self-Pay?" [Record Self-Pay] creates a Self-Pay snapshot. Selecting Self-Pay directly records without verification.

## Snapshot page — `#/frontis/eligibility/:ref`
Printable layout (print stylesheet): header with ref, patient, policy, checked by/at, contract no + version, result (system) and override block if any (both visible, override flagged), steps, conditions, coverage summary, anticipated services with pre-auth flags, linked encounter. Buttons: Print, Re-check, Override (role-gated, absent if already overridden), Back. Read-only.

## Override — `eligibility-override.js`
Dialog: Result*, Reason*, Payer reference* + Contact* when reason is payer phone/portal, Note. Visible/enabled only for `canOverrideEligibility` roles (otherwise button disabled with tooltip). `applyOverride` → audit "Eligibility overridden: Not Eligible → Eligible (Payer phone confirmation, ref 4471)". Overridden snapshots show the ⚑ marker in worklist, patient tab, snapshot page.

## Patient tab — `tab-eligibility.js`
Newest first: Date, Policy (or Self-Pay), Result (final, with ⚑ if overridden and system result on hover), Ref (link), Linked encounter, Checked by. Button Check Eligibility. Read-only.

## Hooks for F4 (implement now, tiny)
`eligibility.latestValid(mrn, policyId, 7)` and export `runAutoCheck({ mrn, policyId, encounterId, visitType, services })` from `eligibility-check.js` that runs the engine, creates a snapshot with checkType Auto-Registration and `encounterId`, and returns it — F4 calls this inline.

## Seed
~15 snapshots: mix of results, two cascades (first fails on validity, second Eligible), one overridden, one Self-Pay, several dated 2–10 days back so the 7-day window can be demoed by F4. `checkedBy` from roles.

## Done when
Worklist, check with cascade to Self-Pay, immutable snapshots with printable page, override with role gate and dual result, patient tab, `lastVerifiedAt` updated on Eligible. Changelog entry. Reply with route list + open questions.