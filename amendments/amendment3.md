# Amendment 3 — Pactum: Contracts

Part A of Payer Contract Management. Later amendments fill the contract's configuration tabs (Methodologies, Overage, Coverage, Pre-Auth, Rules); this one builds the contract lifecycle only, with those tabs as placeholders.

## Speed rules
- Read only CLAUDE.md and the files named here. No re-reading the design system or other features.
- Purely additive. Copy patterns from `features/payer-master` and `features/cdm`; no refactors.
- Seed: hand-write ~8 contracts, generate nothing else.
- Verify: `node --check` on new JS, load each new route once, stop.
- Reply: route list + open questions only.

## Files
```
modules/pactum/features/contracts/
  contracts-global.html / contracts-global.js   #/pactum/contracts            (all active contracts)
  payer-contracts.html / payer-contracts.js     #/pactum/payers/:payerId/contracts
  contract-form.js                              add / edit modal (general info + plans + document)
  contract-view.html / contract-view.js         #/pactum/contracts/:id       (contract page with tabs)
  contract-actions.js                           edit-type chooser, activate, terminate dialogs
  contract-history.js                           copy of cdm-history.js
data/seed/contracts.js  data/repositories/contracts.js
```
Nav: Pactum → Contracts (global). Payer Master list gets a new row action "Contracts" → `#/pactum/payers/:id/contracts`, and the payer editor's General tab shows a "Contracts (n)" link. Reuse `audit` repository.

## Entity
```
contract: id, payerId, contractNo, name, version, lineageId (same across versions), status (Draft|Active|Expired|Terminated),
  startDate, endDate, effectiveDate (Active from), closedAt, terminationDate, terminationReason,
  planIds[], document {fileName,size,uploadedAt} | null, updatedAt,
  // placeholders for later amendments — keep empty structures now:
  methodologies[], overagePolicies[], coverage[], preAuth{}, rules[]
```
Repository extras: `byPayer(payerId)`, `activeOnly()`, `isContractNoUnique(payerId, no, excludeId)`, `planOverlap(planIds, start, end, excludeId)` → conflicting contract or null, `nextVersion(lineageId)`, `versionsOf(lineageId)`, `expireContracts()` on load (Active past endDate → Expired). Status label helper shared with lists. Rule count = `rules.length`.

Seed ~8 contracts across 5 payers: mix of Draft, Active (some expiring within 30/60/90 days), one lineage with v1 Expired + v2 Active, one Terminated. Plans reference real plan ids from the payer seed.

## Global Contracts — `#/pactum/contracts`
Only Active. Columns: Payer, Contract Name, Contract No., Version, Start, End, No. of Rules, Last Updated. Search (payer, name, number). Filters: Payer Type, Expiring within (Any / 30 / 60 / 90 days) — show an amber "expires in N days" chip on rows ≤ 90 days. Row click → contract page. Header: metric rail (Active, Expiring ≤30d, Draft, Payers covered).

## Payer Contracts — `#/pactum/payers/:payerId/contracts`
Header: payer name + Back to payers. Columns: Name, No., Version, Start, End, Status badge, Last Updated. Filter Status. Button: Add Contract. Row actions: View, Edit, Terminate (Active only), View History. Versions of one lineage are grouped: newest visible, older versions collapsed under a "v1, v2…" expander.

## Add / Edit Modal — `contract-form.js`
Fields: Name*, Contract No.* (unique within payer), Start*, End* (> Start), Plans* (multi-select of this payer's **Active** plans, at least one), Document (PDF/DOCX ≤ 10 MB, metadata only). On create: version 1, status Draft, new lineageId. Validation errors inline; plan overlap error names the conflicting contract ("Plan Gold already covered by CT-2026-004 (Active) until 31/12/2026"). Overlap check: only against Active/Draft contracts of the same plan whose date ranges intersect.

## Contract Page — `#/pactum/contracts/:id`
Header: name, No., version chip, status badge, payer link, dates, version switcher (dropdown of `versionsOf`). Actions by status:
- Draft: Edit, Activate, Delete draft (confirm; only Drafts can be deleted).
- Active: Edit (opens edit-type chooser), Terminate.
- Expired / Terminated / older versions: read-only banner, no actions except View History.
Tabs: **General** (info + linked plans table + document), **Methodologies**, **Overage**, **Coverage**, **Pre-Auth**, **Rules** — the last five render a placeholder panel "Configured in a later amendment" with the count from the placeholder array. **History** tab (see History below).

## Actions — `contract-actions.js`
- **Activate** (Draft): confirm dialog with Effective date (default = startDate, must be ≥ startDate). Re-run plan overlap; if this is a new version of a lineage, set previous Active version `closedAt = effectiveDate`, status Expired. Contract → Active. Audit. Toast "Contract activated — configuration is now live".
- **Edit on Active** → chooser dialog: **Corrective** ("fix a mistake, same version") opens the edit modal in place, audit records field diffs; **Change** ("agreement changed, new version") creates a deep copy with version+1, status Draft, same lineage, and navigates to the new contract page with a toast "Version N draft created".
- **Terminate** (Active): dialog with Termination date* (≥ today, ≤ endDate) and Reason* (textarea). Status Terminated, read-only. Audit.

## History — `contract-history.js` (History tab + "View History" row action)
Two sections, both read-only:
1. **Versions** — timeline of every version in the lineage (`versionsOf`): version, status badge, start/end, effective date, closed/terminated date, created by/at. Current version highlighted; clicking a row switches the page to that version.
2. **Changes** — audit entries for the whole lineage, newest first: timestamp, user, action (Created, Corrective edit, Change edit → vN, Activated, Terminated, Draft deleted), and for corrective edits a field-level old → new list. Filter chips: All / Corrective edits / Status changes.
Every create, corrective edit, change edit, activate, terminate, delete-draft writes an audit entry (entity "contract", entityId = lineageId, with version in details) so one query returns the full history.

## Done when
Global list, payer contracts list, add/edit modal with overlap rejection, contract page with version switcher and placeholder tabs, activate / corrective / change / terminate flows, history with versions timeline + change log. Changelog entry in CLAUDE.md. Reply with route list + open questions.