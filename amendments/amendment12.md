# Amendment 12 — Frontis: Module Bootstrap + Patient Master

New module `frontis` (Patient Access & Eligibility). First feature: **Patient Master** — the MRN registry every downstream workflow (encounters, eligibility, pre-auth, clearance, billing) hangs off. Frontis takes ownership of the `patients` entity that has been scaffolding in `data/` since setup.

## Speed rules
- Read only CLAUDE.md, `modules/pactum/module.js`, `features/payer-master/payer-list.js`, `payer-form.js`, `payer-history.js`, `features/cdm/cdm-import.js`, `shared/roles.js`, `data/seed/patients.js`, `data/repositories/patients.js`, and the files named here.
- Purely additive to Pactum; you may **replace** the scaffolding patients seed/repository (they were placeholders). `_template` keeps working — point it at the new repository API if a call breaks.
- Seed: 10 hand-written patients (incl. 1 VIP, 1 Deceased, 1 Blocked, 1 Merged, 2 fuzzy-duplicate pairs), generate the rest to ~60 with a seeded PRNG.
- Verify: `node --check`, load each new route once, stop.
- Reply: route list + open questions only.

## Files
```
modules/frontis/module.js                       id "frontis", name "Frontis", nav: Patients (Home added later)
modules/frontis/features/patient-master/
  patient-list.html / patient-list.js           #/frontis/patients
  patient-form.html / patient-form.js           #/frontis/patients/new, #/frontis/patients/:mrn/edit  (full page, 3 tabs)
  patient-view.html / patient-view.js           #/frontis/patients/:mrn  (record page: banner, summary, tabs Documents / History)
  duplicate-check.js                            detection + the three dialogs
  duplicates-worklist.html / .js                #/frontis/patients/duplicates
  patient-merge.html / patient-merge.js         #/frontis/patients/merge?survivor=&duplicate=
  patient-status.js                             Deceased / Block / Unblock / VIP dialogs
  patient-import.html / patient-import.js       #/frontis/patients/import (copy of CDM importer)
  patient-history.js                            copy of payer-history
data/seed/patients.js                           replaced
data/repositories/patients.js                   replaced
data/repositories/duplicates.js + seed          potential-duplicate pairs worklist
shared/roles.js                                 add role flags: canBlockPatients, canViewVip
shared/format.js                                add ageFrom(dob), maskName/maskId helpers if missing
```

## Entity
```
patient: mrn (auto, "MRN-000123", sequential from a counter in the store), nameEn, nameAr, dob, gender (Male|Female),
  nationality, civilId|null, passportNo|null, phone, email, address, city, photo (data URL|null),
  status (Active|Deceased|Blocked|Merged), deceasedAt, blockReason, mergedInto (mrn|null), vip: bool,
  lastVisitAt|null, createdAt, updatedAt,
  documents[{id, type (Civil ID Copy|Passport Copy|Consent Form|Other), fileName, size, description, uploadedBy, uploadedAt}]
duplicatePair: id, mrnA, mrnB, basis (Name+DOB|Phone), detectedAt, status (Open|Dismissed|Merged), justification
```
Repository: `search(q, filters, {includeMerged:false})` (partial match on mrn, nameEn, nameAr, civilId, passportNo, phone), `nextMrn()`, `isIdentifierUnique(civilId, passportNo, excludeMrn)`, `findDuplicates(candidate, excludeMrn)` → `{hard: patient|null, fuzzy: [patient], phone: [patient]}` (fuzzy = normalised name similarity ≥ 0.8 — implement a small Levenshtein/token match — AND same DOB), `resolve(mrn)` (follows `mergedInto` chain), `merge(survivorMrn, duplicateMrn, fieldChoices)` → relinks documents (+ future encounters/policies via a `relinkHooks` array other modules can push into), sets duplicate Merged, audits, `setStatus(mrn, status, payload)`, `canOpenEncounter(patient)` → false for Deceased/Blocked/Merged. **VIP masking**: `view(patient, role)` returns a masked copy (name → initials, ids → •••• last 2, phone/address hidden, photo hidden) when `patient.vip && !role.canViewVip`; every screen renders through `view()`.

Seed: Lebanese names EN/AR, Civil IDs (numeric), passports for foreign nationals (Syrian, Iraqi, Egyptian, French…), +961 phones, cities. One VIP, one Deceased, one Blocked, one Merged into another, two fuzzy pairs already in the duplicates worklist. Roles: give one role `canViewVip: false` and `canBlockPatients: false` for the demo.

## Patient List — `#/frontis/patients`
Columns: MRN, Name (EN), Civil ID / Passport, DOB (age), Gender, Phone, Status badge (VIP tag alongside when visible to role), Last Visit. Search box (partial, all identifiers), filters Status / Gender / Nationality, "Include merged" checkbox (off), sort, pagination. Buttons: Register Patient, Bulk Import, Duplicates worklist (badge with open count). Row click → record page. Empty state → Register.

## Register / Edit — `#/frontis/patients/new`, `/:mrn/edit` (full page, tabs)
- **Demographics**: Name EN*, Name AR*, DOB* (≤ today; live Age readout), Gender*, Nationality* (select, default Lebanese), Phone* (format), Email, Address, City, Photo (file input → preview; store as data URL ≤ 300 KB, else metadata only), VIP toggle (visible to `canViewVip` roles only).
- **Identifiers**: Civil ID, Passport No. — at least one*; unique. In edit, changing either opens a **Reason** prompt* recorded in the audit.
- **Documents** (edit only; in create, shown disabled with "Save first").
MRN shown read-only in the header (edit) or "assigned on save" (create). Save (create) → run duplicate detection (below) → `nextMrn()` → create → audit → navigate to record. Save (edit) → validate → audit field diffs → record.

## Duplicate detection — `duplicate-check.js` (runs on create Save, also exported for later pre-registration)
1. **Hard**: Civil ID or Passport already exists → blocking dialog "Patient already registered as MRN-… (name)" with Open record button; no proceed.
2. **Fuzzy name + DOB**: side-by-side comparison dialog (new vs existing, differing fields highlighted). Buttons: Open existing · Proceed anyway (requires Justification* textarea; audited; creates a `duplicatePair` Open with basis Name+DOB).
3. **Phone**: informational banner in the same dialog or a light toast-style confirm "Same phone as MRN-… — continue?"; proceeding creates a Phone pair in the worklist.

## Duplicates Worklist — `#/frontis/patients/duplicates`
Table: Patient A (name+MRN), Patient B, Basis, Detected, Status; filters Basis/Status; actions Review (→ merge screen with both prefilled) · Dismiss (reason, audited). Empty state "No potential duplicates".

## Merge — `#/frontis/patients/merge?survivor=&duplicate=`
Step 1: pick Survivor and Duplicate (patient pickers; prefilled from the worklist; swap button). Step 2: **field-by-field table**: Field | Survivor | Duplicate | Keep (radio per row, default survivor; only rows where values differ are selectable, identical rows shown muted). Step 3: **Re-link preview**: counts of documents, and placeholders for encounters / policies / accounts pulled from `relinkHooks` (0 today, labelled "none yet"). Confirm → `merge()`; duplicate gets status Merged + `mergedInto`; the pair's status Merged; audit both records with the field choices and re-link counts; navigate to survivor.

## Record page — `#/frontis/patients/:mrn`
If `mergedInto` set → banner "Merged into MRN-… on <date>" with link; content read-only. Deceased → red banner with date, read-only. Blocked → amber banner with reason. VIP masked per role, with a "Restricted record" note. Header actions (role-aware): Edit, Mark Deceased, Block / Unblock (canBlockPatients only, otherwise disabled with tooltip), VIP toggle (canViewVip only), New Encounter (disabled with tooltip when `canOpenEncounter` false — it becomes live in the Encounter feature). Summary card of demographics + identifiers + photo. Tabs: **Documents** (upload: Type*, file* PDF/JPG/PNG ≤ 10 MB, Description; list with Download toast and Delete confirm + audit) · **History** (audit entries, field-level old → new, filter chips Edits / Status / Documents / Merge / Import).

## Status dialogs — `patient-status.js`
Mark Deceased: Date of death* (≤ today). Block: Reason*. Unblock: Reason*. VIP: on/off with confirm. Each → `setStatus` → audit → banner updates via `ctx.onData`.

## Bulk Import — `#/frontis/patients/import`
Copy of the CDM importer. Columns: Name EN, Name AR, DOB, Gender, Nationality, Civil ID, Passport, Phone, Email, City. Errors: duplicate Civil ID/Passport (existing or in-file), missing required, invalid DOB (future/unparseable), invalid phone, no identifier. MRNs assigned on import. Built-in sample with ~8 rows, 3 invalid. Audit entry.

## Module
`module.js` registers routes above; nav entry Patients (count = non-merged patients); module default route = patients list for now (Home comes later). Sidebar tab order: Pactum, Frontis, Template.

## Done when
List/search/filters, register with all three duplicate paths, edit with identifier reason, record page with banners and role masking, documents, status dialogs, worklist, merge end to end, import, history. Changelog entry. Reply with route list + open questions.