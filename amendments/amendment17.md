# Amendment 17 — Frontis: Cost Estimation

F6. Estimates run Pactum's **billing engine** (amendment 8) against the patient's policy and anticipated services, then freeze the result as an immutable, printable document. Nothing is posted. The Pactum billing simulator already renders the same trace — reuse its breakdown panel and consumption inputs.

## Speed rules
- Read only CLAUDE.md, `data/engines/billing-engine.js` + `overage-engine.js` (signatures), `modules/pactum/features/billing-eval/simulator-inputs.js`, `breakdown-panel.js`, `features/eligibility/eligibility-result.js` (print layout), `features/encounters/encounter-new.js` (`?prefill=` handling), `features/prereg/prereg-convert.js` (prospect → registration pattern), `data/repositories/policies.js`, `contracts.js` (`contractForService`, `planHasActiveContract`), and the files named here.
- Purely additive, except: extend `encounter-new.js` `?prefill=` to also accept an estimate no. (`?estimate=`), and export `breakdown-panel.js` / consumption sub-table from Pactum if not already exported.
- Seed: 8 hand-written estimates (mix below).
- Verify: `node --check`, load each route once, build + issue one estimate, stop.
- Reply: route list + open questions only.

## Files
```
data/seed/estimates.js  data/repositories/estimates.js
modules/frontis/features/estimates/
  estimate-list.html / estimate-list.js         #/frontis/estimates
  estimate-builder.html / estimate-builder.js   #/frontis/estimates/new?mrn=&encounterNo=   (draft; also /:no while Draft)
  estimate-view.html / estimate-view.js         #/frontis/estimates/:no  (issued document, printable)
  estimate-lines.js                             service picker + lines table + bundle consumption tree (wraps Pactum's)
  estimate-actions.js                           issue / duplicate / convert / cancel dialogs
  estimate-history.js                           copy bound to "estimate"
shared/config.js                                (create if absent) CONFIG.estimateValidityDays = 14, CONFIG.estimateDisclaimer = "…"
```
Nav: Frontis → Estimates (badge = Issued & valid). Patient record: header button **Cost Estimate**; patient gets an **Estimates** section on the Encounters tab (or its own tab if simpler). Encounter page: Linked Records → Estimates row now live (list + Create). Push a merge re-link hook.

## Entity
```
estimate: no ("EST-2026-000031"), status (Draft|Issued|Converted|Expired|Superseded|Cancelled),
  subject: { kind: "patient", mrn } | { kind: "prospect", name, phone },
  policy: { policyId|null, payerId|null, planId|null, selfPay: bool },      // prospect: payer/plan picked manually
  context { visitType, department, dateOfService (default today) },
  lines [{ itemId, qty, consumption[]|null }],
  result (frozen on issue): { contract {id,no,version}|null, lines:[trace…], totals {gross, allowed, payerShare, patientShare, held, notBillable, overageExposure},
                             preAuthFlags:[…], exclusions:[…], disclaimer, computedAt },
  issuedAt, issuedBy, validUntil, supersededBy|null, supersedes|null, encounterNo|null, convertedAt,
  createdAt, createdBy, updatedAt
```
Repository: `search(q, filters)`, `nextNo()`, `create/updateDraft` (Draft only; audited), `issue(no)` (runs the engine one final time, freezes `result`, sets Issued + validUntil = today + CONFIG days, then **supersede**: any other Issued estimate for the same subject with the same set of itemIds → Superseded with `supersededBy`; audited both), `duplicate(no)` → new Draft copying subject/policy/context/lines with `supersedes` = source (source stays Issued until the copy is issued), `markConverted(no, encounterNo)`, `cancel(no, reason)` (Draft/Issued), `expireEstimates()` on load (Issued past validUntil → Expired), `byPatient(mrn)`, `byEncounter(no)`, `validForClearance(mrn)` (Issued & valid — F9 reads this). Simulation: `simulate(estimate)` → `evaluateEncounter(payerId, planId, patientCtx, encounterCtx, lines)`; for prospects pass minimal ctx; for Self-Pay skip the contract and price at CDM standard with patient share 100%.

## List — `#/frontis/estimates`
Metric rail: Issued & valid, Drafts, Expiring ≤ 3 days, Converted this month. Table: Estimate No., Patient (name + MRN chip, or name + "Prospect" chip), Payer / Plan or Self-Pay, Services (first 2 + "+n"), Total charges, **Patient share** (bold), Valid until (amber ≤ 3 days), Status badge, Created by / at, Linked Encounter. Search (no., patient), filters Status / Payer / Date range / Creator. Row actions: Open, Duplicate, Print/Export (PDF via print), Convert to Encounter (Issued & valid only), View History. Button: New Estimate (menu: For patient · Walk-in prospect).

## Builder — `#/frontis/estimates/new`, `/:no` (Draft)
Left **Inputs** (same layout as the Pactum simulator, reuse its rail markup):
1. **Subject** — toggle Patient | Prospect. Patient: search picker (prefilled `?mrn`), banner; Prospect: Name*, Phone* and a visible "Prospect — not linked to a patient" tag.
2. **Policy** — Patient: chain radios + Self-Pay, highest active pre-selected; Prospect: Payer (Active) → Plan (Active) selects, or Self-Pay. Warning banner when `planHasActiveContract` is false on the date of service.
3. **Context** — Visit type*, Department*, Date of service (default today).
4. **Services** — `estimate-lines.js`: CDM picker (Active items + bundles), qty, remove; bundle rows expand to the component tree with included limits and an editable consumption sub-table (reuse Pactum's); footer **Running gross total** live (Σ standardPrice × qty).
Buttons in the panel header: Save draft · Simulate · Issue.
Right **Result** (after Simulate): totals card with **Patient share** as the headline, then allowed / payer share / held for approval / not billable / overage exposure; contract chip "CTR-… v2"; per-line collapsible `breakdown-panel` traces; bundle lines add a **limits & exposure** block: per component "Included: 2 nights · beyond 2 nights → Bill Payer at contract rate (tolerance 10%)"; pre-auth flags list; exclusions (not-covered items); disclaimer text. Re-simulate updates in place; Issue is enabled only after a simulation matching the current inputs (dirty flag).
**Issue** → confirm dialog showing validity date (editable, default +14 days) → `issue` → navigate to the document.

## Document — `#/frontis/estimates/:no` (Issued/Converted/Expired/Superseded)
Printable layout like the eligibility snapshot page: header (estimate no., status stamp, subject, payer/plan, contract no + version, issued by/at, valid until), lines table (item, qty, gross, allowed, payer, patient, flags), bundle detail blocks, totals with patient share headline, pre-auth flags, exclusions, disclaimer. **Prospect watermark** (diagonal "PROSPECT ESTIMATE — NOT LINKED TO A PATIENT", print-visible) for prospect subjects. Status banners: Expired / Superseded (link to the newer one) / Converted (link to encounter). Actions: Print / Export PDF, Duplicate, Convert to Encounter (Issued & valid), Cancel, View History. Read-only.

## Convert — `estimate-actions.js`
Patient subject: navigate to `#/frontis/encounters/new?mrn=…&estimate=<no>`; `encounter-new.js` pre-fills step 2 from context (type, dept, start now), step 3 policy from `policy`, and passes `lines` as anticipated services for the eligibility check; on create → `markConverted`, encounter `linkRecord(no, "estimates", estNo)`, toast. Prospect subject: first open the patient registration form prefilled with name + phone (in the same drawer pattern as pre-reg conversion); on save, update the estimate's subject to the new MRN (audited "Prospect linked to MRN-…"), then continue to the encounter flow.

## Seed
Patient estimates: 2 Issued & valid (one with a bundle showing overage exposure, one with a pre-auth flag), 1 Draft, 1 Expired, 1 Superseded + its newer Issued, 1 Converted (linked to a seeded encounter). 1 Prospect Issued. Disclaimer text in `shared/config.js` (Arabic-friendly wording optional).

## Done when
List, builder for patient and prospect with live gross total and full simulation, issue with freeze + supersede, printable document with watermark for prospects, duplicate, convert for both subject kinds ending in an encounter linked back, expiry on load, history; encounter Linked Records shows estimates. Changelog entry. Reply with route list + open questions.