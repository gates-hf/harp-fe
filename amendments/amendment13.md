# Amendment 13 — Frontis: Insurance & Plan Capture

F2. Adds patient policies as an **Insurance** tab on the patient record, sourced from Pactum's payers/plans/contracts. Policies are their own entity (encounters, eligibility and billing will reference them by id).

## Speed rules
- Read only CLAUDE.md, `modules/frontis/features/patient-master/patient-view.js`, `patient-history.js`, `data/repositories/patients.js`, `data/repositories/payers.js`, `data/repositories/contracts.js` (only `contractForService` / `activeOnly`), and the files named here.
- Purely additive; no refactors. Copy the Documents tab pattern for the tab and the payer-form modal pattern for the policy modal.
- Seed: hand-write policies for 8 seeded patients (incl. one with 3 policies, one with a suspended and an expired policy, one with none).
- Verify: `node --check`, load the record page once, stop.
- Reply: route list + open questions only.

## Files
```
modules/frontis/features/insurance/
  tab-insurance.html / tab-insurance.js     Insurance tab on #/frontis/patients/:mrn (tab id "insurance")
  policy-form.js                            add/edit modal
  policy-actions.js                         suspend / reactivate / cancel / reorder dialogs
  policy-history.js                         copy of patient-history bound to entity "policy"
data/seed/policies.js  data/repositories/policies.js
```
Register the tab in `patient-view.js` (tab order: Insurance, Documents, History). Push a re-link hook into `patients.relinkHooks` so the merge preview counts policies and `merge()` re-points `patientMrn`.

## Entity
```
policy: id, patientMrn, payerId, planId, memberId, policyNo, relationship (Self|Spouse|Child|Parent|Other),
  holderName|null, validFrom, validTo, priority (1|2|3|null when out of chain),
  status (Active|Suspended|Cancelled|Expired), statusReason, lastVerifiedAt|null (set by Eligibility later),
  cardFront {fileName,size}|null, cardBack|null, usedInEncounters: bool (false until Encounters exist; Encounter feature flips it),
  createdAt, updatedAt
```
Repository: `byPatient(mrn)` (sorted priority asc, then out-of-chain by updatedAt), `chain(mrn)` → Active policies in priority order (this is what Eligibility/Billing consume; Self-Pay is not a record — callers append it), `isMemberIdUnique(payerId, memberId, excludeId)`, `overlaps(mrn, payerId, from, to, excludeId)` → conflicting policy or null, `planHasActiveContract(planId, date)` (via contracts `contractForService`), `reorder(mrn, orderedIds)` (reassigns 1..n; audited with old → new order), `setStatus(id, status, reason)` (Suspend/Cancel remove priority and compact the chain; Reactivate appends at the end of the chain), `expirePolicies()` on load (Active past validTo → Expired, drop from chain, compact). Compaction rule: remaining chain re-numbered 1..n, audited as a reorder.

## Insurance tab
Header line: coverage summary chip — "Primary: NSSF · Hospitalization first class" or "Self-Pay" when the chain is empty. Buttons: Add Policy, Reorder (enabled when chain length ≥ 2). Table (chain first, then out-of-chain rows muted): Priority (1 Primary / 2 Secondary / 3 Tertiary / —), Payer, Plan, Member ID, Policy No., Validity (From – To; amber "expires in N days" ≤ 30), Status badge, Last verified. **Final fixed row**: "Self-Pay — fallback (always applies)" styled muted, no actions. Row actions: View/Edit, Suspend (Active) / Reactivate (Suspended; blocked if validTo passed → toast "Renew dates first"), Cancel (Active/Suspended), View History. Cancelled/Expired rows read-only except View History. Tab is read-only when the patient is Merged/Deceased (same rule as the record page). VIP masking does not apply to policies, but the tab still hides under a masked record's restricted note.

## Policy modal — `policy-form.js`
Payer* (select of `payers.findActive()`; in edit, if the current payer is inactive, keep it as a disabled first option "(inactive)"), Plan* (that payer's Active plans, same inactive rule), Member ID* (unique per payer), Policy No., Relationship* (default Self), Policy Holder Name* when Relationship ≠ Self (hidden otherwise), Valid From*, Valid To* (> From), Card front / back (image or PDF ≤ 10 MB, metadata only, thumbnails as icons). On Save:
- Warnings (non-blocking, shown in a confirm step before saving): "This plan has no active Pactum contract on <From> — eligibility will fail" when `planHasActiveContract` is false; "Overlaps with policy <No.> (<payer>) valid until <date>" when `overlaps` returns one.
- Edit guard: if `usedInEncounters` and payer or plan changed → Reason* prompt, recorded in audit.
- Create → status Active, priority = chain length + 1 (max 3; a 4th active policy is rejected: "Only three chain positions — suspend or cancel one first"). Audit with diffs.

## Reorder dialog — `policy-actions.js`
List of chain policies with up/down buttons (or drag if the design system has a sortable list); preview "1 NSSF → 2 AXA → 3 …"; Confirm → `reorder` → audit "Priority order changed: [old] → [new]". Suspend / Cancel / Reactivate: Reason* → `setStatus` → audit → toast. Reactivate also runs `overlaps` and warns.

## Seed
Patient with 3 policies (NSSF primary, AXA secondary, Bankers tertiary, one Child relationship with holder name); patient with Active + Suspended; patient with Expired only (shows Self-Pay chip); patient whose plan has no active contract (to demo the warning); rest one Active policy each. Member IDs realistic (NSSF numeric, private alphanumeric).

## Done when
Insurance tab lists chain + Self-Pay row, add with both warnings, edit with the reason guard, reorder, suspend/reactivate/cancel with chain compaction, expiry on load, history; merge preview counts policies. Changelog entry. Reply with route list + open questions.