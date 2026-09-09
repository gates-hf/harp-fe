# Amendment 19 — Frontis: Pre-Authorization Workflow

F8. Turns the pre-auth *flags* produced by Pactum's matrix, the eligibility engine and estimates into an actual request → submit → payer decision → validity lifecycle. Requests are created pre-filled from those flags; nothing is re-typed.

## Speed rules
- Read only CLAUDE.md, `features/eligibility/eligibility-result.js` (conditions + print layout), `features/estimates/estimate-view.js` (`preAuthFlags`), `features/encounters/encounter-view.js` (Linked Records) + `data/repositories/encounters.js` (`linkRecord`), `features/referrals/referral-form.js` (doc upload + printable form pattern), `data/repositories/contracts.js` (`resolvePreAuth`), `shared/config.js`, and the files named here.
- Purely additive, except: encounter Linked Records "Pre-auths" row goes live, and eligibility/estimate result panels gain a "Create auth request" action on flagged lines.
- Seed: 10 hand-written requests covering every status.
- Verify: `node --check`, load each route once, run one request Draft → Submit → Approve, stop.
- Reply: route list + open questions only.

## Files
```
data/seed/preauth-requests.js  data/repositories/preauth-requests.js
modules/frontis/features/preauth/
  preauth-worklist.html / .js                  #/frontis/preauth
  preauth-form.html / preauth-form.js          #/frontis/preauth/new?mrn=&encounterNo=&estimate=&snapshot=, /:no (Draft edit)
  preauth-view.html / preauth-view.js          #/frontis/preauth/:no  (request page: detail, decision, chain, comms, printable form)
  preauth-decision.js                          capture-response dialog (incl. per-service partial grid)
  preauth-actions.js                           submit / cancel / renew / resubmit dialogs + communication log entry
  preauth-history.js                           copy bound to "preauth"
shared/config.js                               CONFIG.preauthExpiryWarnDays = 7
```
Nav: Frontis → Pre-Auths (badge = needs action). Patient record: **Pre-Auths** section. Encounter page: Linked Records → Pre-auths row live (list + Create, prefilled). Eligibility snapshot page + estimate document: on each pre-auth-flagged line, a "Create auth request" button carrying the flagged services. Push a merge re-link hook.

## Entity
```
preauthRequest: no ("PA-2026-000078"), status (Draft|Submitted|Approved|Partially Approved|Denied|Expired|Cancelled),
  patientMrn, policyId|null, payerId, planId, encounterNo|null, estimateNo|null, snapshotRef|null,
  services: [{ itemId, qty, requestedAmount, approvedQty|null, approvedAmount|null, lineDecision (Approved|Denied|null), lineReason|null }],
  diagnosis, justification, doctorId, priority (Routine|Urgent),
  documents: [{ id, kind (Supporting|Payer response), fileName, size, uploadedBy, uploadedAt }],
  submittedAt|null, submittedBy|null,
  decision: { result, authNumber, validFrom, validTo, denialReasonCode|null, capturedAt, capturedBy, note } | null,
  consumption: { usedQty: {itemId: qty} },        // billing will increment later; seed a couple
  predecessorNo|null, successorNo|null,           // resubmission / renewal chain
  communications: [{ id, at, by, channel (Phone|Portal|Email|Fax), direction (Out|In), note }],
  createdAt, createdBy, updatedAt
denialReasons (reuse Pactum's list where sensible, add): NOT_MEDICALLY_NEC, INSUFFICIENT_DOC, NOT_COVERED, OUT_OF_NETWORK,
  ALT_TREATMENT_REQUIRED, LATE_REQUEST, MEMBER_INELIG, OTHER
```
Repository: `search(q, filters)`, `needsAction()` (Draft + Submitted + Approved/Partial expiring ≤ 7 days), `nextNo()`, `create/updateDraft` (Draft only), `submit(no)` (freeze services + justification; audited), `captureDecision(no, decision)` (sets status from result; audited), `cancel(no, reason)`, `renew(no)` / `resubmit(no)` → new Draft copying everything, `predecessorNo` set both ways (audited "Renewed as PA-…" / "Resubmitted as PA-…"), `expireAuths()` on load (Approved/Partial past validTo → Expired), `activeFor(mrn, itemId, date)` → Approved/Partial auth covering that item, in validity, with remaining qty (`approvedQty − usedQty`) > 0, else null, `chainOf(no)` → ordered predecessor/successor list, `byEncounter(no)`, `byPatient(mrn)`.

## Worklist — `#/frontis/preauth`
Metric rail: Needs action, Submitted (pending), Expiring ≤ 7 days, Denied this month. Toggle **Needs action | All**. Table: Request No., Patient (name + MRN), Payer / Plan, Services (first 2 + "+n"), Status badge, Submitted / Pending since (relative, red > 3 days for Urgent), Auth Number, Valid Until (amber ≤ 7 days, countdown "5 days left"), Linked Encounter. Search (no., auth number, patient), filters Status / Payer / Date range / Expiring within (7/14/30). Row actions: Open, Submit (Draft), Capture Response (Submitted), Cancel, View History. Button: New Request.

## Form — `#/frontis/preauth/new`, `/:no` (Draft only)
Prefill sources: `?mrn` (manual), `?encounterNo` (patient, policy, doctor, department from the encounter), `?snapshot=ELG-…` (patient, policy, and the services that carried pre-auth flags), `?estimate=EST-…` (patient, policy, flagged lines with qty and allowed amounts as requested amounts). Banner shows the origin ("Pre-filled from ELG-2026-000031 — 2 flagged services").
Panels: **Patient & policy** (picker + chain radios; read-only when prefilled from an encounter, with a change link), **Services*** (CDM picker, qty*, requested amount* — default to `resolvedPrice` × qty, editable; a per-line chip "Pre-auth required" when `resolvePreAuth` says so), **Clinical** (Diagnosis* ICD-10 text, Justification* textarea using `.field--area`, Treating doctor*, Priority* default Routine), **Documents** (upload Supporting docs, PDF/JPG/PNG ≤ 10 MB). Footer: Save draft · Submit. Draft auto-numbered on first save.

## Request page — `#/frontis/preauth/:no`
Header: request no., status badge, priority chip, patient banner, payer/plan, linked encounter/estimate/snapshot links, validity countdown when Approved/Partial. Panels:
- **Services** table: item, requested qty/amount, approved qty/amount, line decision, reason; **Remaining** column when Approved (approved − used).
- **Clinical**: diagnosis, justification, doctor.
- **Decision** (when captured): result, auth number, validity, denial reason, note, captured by/at, payer response document.
- **Chain**: predecessor/successor links with statuses ("Resubmission of PA-…", "Renewed as PA-…").
- **Communication log**: entries (date, by, channel, direction, note) + "Log communication" button (always available, including after submission).
- **Documents** and **History** tabs.
Actions by status: Draft → Edit · Submit · Cancel; Submitted → Capture Response · Log communication · Cancel; Approved/Partial → Renew · Log communication · Print; Denied → Resubmit (read-only otherwise); Expired → Renew; Cancelled → read-only. **Print request form** (printable layout: hospital header, patient, policy/member ID, doctor, diagnosis, justification, services table with requested qty/amounts, priority, signature line) available from Submitted onward, and regenerated identically from the frozen data.

## Submit & decision
**Submit** (`preauth-actions.js`): confirm dialog reminding that services and justification lock → `submit` → opens the printable form in a new view with Print/Export. **Capture Response** (`preauth-decision.js`): Result* (Approved | Partially Approved | Denied). Approved/Partial → Auth number*, Valid from*, Valid to* (> from). Partial → per-service grid: Approved qty*, Approved amount*, line decision, line reason (denial list) for reduced/denied lines; at least one line must differ from requested. Denied/Partial → Denial reason* from the list + note. Payer response document upload. Confirm → `captureDecision` → toast, audit, encounter `linkRecord`.

## Flag integration
- `activeFor(mrn, itemId, date)` is exported for the estimate builder, eligibility engine and F9: when a pre-auth flag exists **and** an active auth covers it, show "Authorized — PA-…, valid until …" instead of "Pre-auth required". Wire it into the eligibility engine's step 5 detail and the estimate's per-line flags (read-only change: the condition text, not the result).
- Encounter `clearance.items` gains "Pre-auth pending — PA-…" for Submitted, and "Pre-auth missing" when a flagged service has no request at all; F9 treats both as blocking. Consumption beyond `approvedQty` or outside validity → item "Pre-auth exceeded/expired".

## Seed
2 Drafts (one prefilled from a seeded estimate), 3 Submitted (one Urgent pending 4 days → red), 2 Approved (one expiring in 5 days with a countdown, one with usedQty partially consumed), 1 Partially Approved (2 of 3 lines reduced, one denied with reason), 1 Denied with a resubmission chain to a Draft, 1 Expired. Auth numbers payer-styled; communication log entries on two of them.

## Done when
Worklist with needs-action default and countdowns, request creation from all four prefill sources, submit locking + printable form, decision capture including per-service partial, renew/resubmit chains visible both ways, expiry on load, `activeFor` flipping flags to "Authorized" in eligibility and estimates, encounter Linked Records + clearance items. Changelog entry. Reply with route list + open questions.