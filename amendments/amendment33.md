# Amendment 33 — Claima: Write-Off Management  (TAG: A33 — runs in parallel with A31, A32)

## Parallel protocol
Follow `modules/claima/COORDINATION.md` with the relaxed rule for this set: tagged `A33` sections (new helpers only) in `claims.js`. You own `modules/claima/features/writeoffs/`, `data/seed/writeoffs.js`, `data/repositories/writeoffs.js`, `data/seed/writeoff-reasons.js`, `data/engines/writeoff-tiers.js`. **You are the only session of this set allowed Frontis touches**: patient-side postings go through the existing ledger `Adjustment` type with `detail.origin = {writeoffId}` — no new type; reversals use the existing counter pattern (`Adjustment` with `reversesTxId`). Do not edit Frontis code, only call it.

## Interfaces (fixed)
**You publish**: `writeoffs.requestFromDenial(denial)` (A31 calls at routing), `writeoffs.byClaim(claimNo)`, `writeoffs.byAccount(mrn)`, `writeoffs.pendingFor(user)`, `writeoffs.postedTotals(period)` (A31 analytics + future DTR reconcile), `writeoffs.analytics(period)`.
**You consume**: `denials.resolveWrittenOff(denialId, writeoffId, amount)` (A31); `claims.byPatient`/`totals`, a new tagged helper `claims.adjust(claimNo, {amount, reasonCode, writeoffId})` in your A33 section (payer-side adjustment on claim totals + audit); Frontis `ledger.append`, `accountEngine.balances(mrn)`, `settlementEngine.reconcile`, `accounts.*` (patient side); `lifecycle.followups`/`claimEvents.byClaim` (A30) for pursuit history display.

## Speed rules
Read only CLAUDE.md, COORDINATION.md, `claims.js`, `denials.js` (resolveWrittenOff), `data/repositories/ledger.js`, `data/engines/account-engine.js` (balances), `settlement-engine.js`, `modules/frontis/features/accounts/adjustment-form.js` (pattern), `shared/roles.js`, `shared/config.js`, your files. Seed: reason list, tier config, ~10 requests across states + 3 postings. Verify: `node --check`, load each route once, request → approve → post one write-off. Reply: routes + published helpers + open requests.

## Entities
```
writeoff: id ("WO-2026-000058"), source { kind: Denial|ClaimResidual|PatientBalance|AgedItem, ref, encounterNo|null, claimNo|null, mrn|null }, side (Payer|Patient),
  amountRequested, amountPosted|null, reasonCode, classification (Contractual|Discretionary — from reason), justification, hardshipEvidence {fileName}|null,
  status (Pending Approval|Approved|Rejected|Posted|Reversed), tier { required, mode (Single|Sequential), steps:[{tier, approver|null, decision|null, note|null, at|null}] },
  requestedBy, at, decision { by, at, note }|null, posting { txIds:[], at, by, cappedNote|null }|null, reversal { by, tier, reason, txIds, at }|null, rerequestOf|null
writeoffReasons: W01 Contractual adjustment (Contractual), W02 Timely filing (Discretionary), W03 Small balance (Contractual), W04 Charity/hardship (Discretionary), W05 Bad debt (Discretionary), W06 Administrative error (Discretionary), W07 Payer non-response (Discretionary), W99 Other
CONFIG.claima.writeoffs = { tiers: [{tier:1, max:500, role:"canApproveWO1"}, {tier:2, max:5000, role:"canApproveWO2"}, {tier:3, max:null, role:"canApproveWO3"}], mode: "Single", autoPostOnApproval: false }
```
**Tiers engine**: `tierFor(amount)`, `stepsFor(amount, mode)`; requester ≠ approver enforced at request and at every step; self-approval blocked. **Posting** `post(id)`: re-validate against current outstanding (`balances` for patient side; claim open balance for payer side): balance shrank → cap with note; grew → never expand. Payer side → `claims.adjust` + `denials.resolveWrittenOff` when denial-sourced. Patient side → ledger `Adjustment` (origin writeoff) → `settlementEngine.reconcile` → SOA shows it. Immutable chain request → decision → posting. **Reversal**: role tier ≥ original, reason → counter `Adjustment`/claim adjustment reversal, status Reversed, both directions linked. `autoPostOnApproval` honoured.

## Screens
**Worklist** `#/claima/writeoffs`: rail (Pending approval value, Approved unposted, Posted MTD, Discretionary %). Table: ID, Source (kind chip + linked ref), Patient, Side, Amount, Reason + Contractual/Discretionary badge, Status, Requester, Pending tier, Approver. Search; filters Status / Source / Reason / Classification / Amount band / Side / Dates. **Pending my approval** toggle (oldest first) for approver roles.
**Request** `#/claima/writeoffs/new?denial=&claim=&mrn=&item=`: source picker (or prefilled from denial at denied amount); **context card**: outstanding balance, aging, pursuit history (follow-ups / timeline excerpt), prior write-offs on this account/claim; Amount* (live validation ≤ outstanding), Reason* (→ classification badge), Justification*, hardship evidence upload; Submit → tier shown.
**Decision** `#/claima/writeoffs/:id`: request + context + prior write-off history; Approve (optional note) / Reject (note*); sequential mode shows step ladder; post-approval: Post (or auto), Reverse (role/tier + reason). Chain view and audit.
**Analytics** `#/claima/writeoffs/analytics`: Contractual vs Discretionary primary split; by Reason / Payer / Department / Service line / Requester; MTD/QTD/YTD trends; approval stats (rate, avg decision days, rejected value); repeat patterns; export CSV; reconciliation footnote: posted payer-side totals = denials written-off totals (`selfCheck` against `denials.analytics`).

## Done when
Worklist + approver queue, request with live context and validation, tiered approval with self-approval blocked and sequential mode, posting with re-validation to both ledgers and denial resolution, reversal as linked counter, analytics reconciling with F7. Append `### 33`; COORDINATION Status; if last to finish, run the full-tree check.