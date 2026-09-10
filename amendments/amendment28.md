# Amendment 28 — Claima: Claim Submission  (TAG: A28 — runs in parallel with A29, A30)

## Parallel protocol
Follow `modules/claima/COORDINATION.md`. Re-read it fully first: A25–A27 published helpers you depend on. You own ONLY `modules/claima/features/submission/`, `data/seed/batches.js`, `data/repositories/batches.js` (batches + submission files + acknowledgments + rejections), `data/seed/rejection-reasons.js`, and your `A28` section of `data/repositories/claims.js`. No Frontis/Pactum files. Peer helpers missing → feature-detect + Request.

## Interfaces (fixed)
**You publish**:
- `batches.byClaim(claimNo)` → `[{batchNo, cycle, status, submittedAt, method, reference}]`
- `batches.afterSubmitHooks[]` `{batchNo, claimNos, at}`, `afterAckHooks[]` `{batchNo, accepted[], rejected[], at}`, `afterRejectHooks[]` `{claimNo, code, at}` — A30 subscribes (timeline, follow-up clearing)
- `claims.resubmit(claimNo)` → after re-finalize: sets `cycle+1`, links `previousCycleNo`/`nextCycleNo`, status Ready (A30 shows chains)
- `claims.rejectionsWorklist()` → Rejected claims with code/reason
**You consume**: `claims.readyForSubmission()`, `claims.setStatus`, `claims.markStale`, `claims.assembleFor` (A27); `coding.requestRecode` (A26); `policies.*` (Frontis, member-ID fix routing); `remittances.byClaim?.()` (A29, read-only display).

## Speed rules
Read only CLAUDE.md, COORDINATION.md, `data/repositories/claims.js`, `payers.js`, `modules/claima/features/claims-assembly/portfolio.js` (row/bulk pattern) + `claim-view.js` (add a Submission tab via its tab registry if it has one; else link only), `shared/config.js`, your files. Seed: 6 batches across 3 payers in all statuses + 3 rejections + payer submission profiles. Verify: `node --check`, load each route once, create + submit + acknowledge one batch. Reply: routes + published helpers + open requests.

## Entities
```
payerSubmissionProfile (CONFIG.claima.submission.profiles[payerId]): { mode: Electronic|Manual, cycle: Daily|Weekly(day)|Monthly(day), methods: [...] }
batch: batchNo ("BAT-2026-000142"), payerId, mode, status (Open|Generated|Submitted|Acknowledged|Partially Rejected|Rejected|Closed),
  claimNos:[], exclusions:[{claimNo, reason, by, at}], ejected:[{claimNo, cause, at}],
  files:[{ version, kind (Submission|Manifest|Forms|CoverSheets|BatchCover), generatedAt, by, fileName, content (string, stored) }],
  submission { at, by, method, reference, fileVersion }|null,
  acknowledgment { at, payerRef, receivedCount, acceptedCount, rejectedCount, document, by }|null,
  rejections:[{ claimNo, code, reason, document, at, by }], createdAt
claim += cycle (1..n), previousCycleNo|null, nextCycleNo|null, submission { batchNo, at, method, reference }|null, acknowledgedAt|null, rejection { code, reason, at }|null
rejectionReasons: R01 Member ID invalid → fix: Policy, R02 Missing/invalid data → fix: Refresh, R03 Coding format → fix: Recode, R04 Duplicate claim, R05 Filing limit exceeded, R06 Provider not recognised, … (extensible list with fixRoute)
```
Repository: `readyQueueByPayer()` (count, value, mode, cycle due-today flag, oldest age), `create(payerId)` → auto-includes Ready non-Stale claims not in another open batch; `exclude(batchNo, claimNo, reason)`; `validate(batchNo)` → ejects Stale (cause), blocks double-batching; `generate(batchNo)` → Electronic: submission file (JSON-lines or CSV of claim headers + lines) + manifest; Manual: claim forms (HTML per claim), cover sheets (attachments per claim), batch cover with manifest; each generation = new version, previous kept; `markSubmitted(batchNo, {method, reference, at})` → batch + claims Submitted, `claims.setStatus`, hooks; `acknowledge(batchNo, ack)` → blocked unless included = accepted + rejected + ejected; accepted claims → Acknowledged; rejected → `reject`; `reject(batchNo, claimNo, code, reason, doc)` → claim Rejected, batch Partially/Rejected, hooks; `fixAndResubmit(claimNo)` → routes by `fixRoute` (Policy → link to patient's Insurance tab; Refresh → `claims.assembleFor` + reopen; Recode → `coding.requestRecode`) and sets claim Draft with `rejectedCycle` kept; when re-finalized → `claims.resubmit` chains cycle+1 and it joins the payer's next Open batch.

## Screens
**Workbench** `#/claima/submission`: rail (Ready value, Due today, Open batches, Rejected). Two panels: **Ready queue by payer** (payer, count, value, mode badge, cycle + "due today", oldest age, button Create batch) and **Batches** table (batch no., payer, contents (n claims · value), mode, status badge, created/submitted/acknowledged dates, actions Open · Generate · Mark submitted · Acknowledge · Rejections). Search across batches and claims; filters Payer / Status / Dates. Empty state "Nothing waiting for submission."
**Batch page** `#/claima/submission/:batchNo`: header + status timeline (Open → Generated → Submitted → Acknowledged/Rejected). Tabs: Claims (included with exclude action while Open; ejected list with causes), Files (versions, download; Forms preview printable), Submission (method/reference/date form → Mark submitted), Acknowledgment (form with the reconciliation strip "included n = accepted + rejected + ejected"), Rejections (add rejection: claim, code → reason autofill, document), History.
**Rejections worklist** `#/claima/submission/rejections`: claim, payer, code/reason, cycle, batch, age; action **Fix & Resubmit** (shows the routed fix, confirm) · Open claim. Claim view: chain strip "Cycle 1 (Rejected R01) → Cycle 2 (Ready)" both ways.

## Seed
Profiles for all seeded payers (NSSF Electronic Daily, AXA Manual Weekly Tuesday, others mixed). Batches: 1 Open with 2 exclusions, 1 Generated v1+v2, 1 Submitted (electronic), 1 Submitted manual with forms, 1 Acknowledged fully, 1 Partially Rejected (2 rejections, one already resubmitted as cycle 2 in the Open batch). Ready claims from A27 fill the queue.

## Done when
Queue + batches, clean batch creation with validation/ejection/exclusion, electronic and manual generation with versions, submit/acknowledge/reject with reconciliation, fix & resubmit chains visible on claims, hooks published. Append `### 28`; COORDINATION Status.