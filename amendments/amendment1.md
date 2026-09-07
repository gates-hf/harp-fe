# 01 — Pactum: Payer Master

New module `pactum` (Payer & Contract Management). First feature: **Payer Master** — reference data for insurance payers, consumed later by claims, billing, eligibility. Build only what's below. Read CLAUDE.md first.

## Files
```
modules/pactum/module.js                         id "pactum", nav: Payer Master
modules/pactum/features/payer-master/
  payer-list.html / payer-list.js                #/pactum/payers
  payer-form.html / payer-form.js                add/edit modal, 4 tabs
  payer-history.js                               audit drawer
  bulk-import.html / bulk-import.js              #/pactum/payers/import
data/seed/payers.js  data/repositories/payers.js
data/seed/audit.js   data/repositories/audit.js  (shared, append-only, reused by every module)
```
Payer owns nested contacts[], plans[], documents[] — one entity, one repository. Split files further if any passes ~300 lines.

## Entity
```
payer: id, nameEn, nameAr, type (Government|Private|Self Pay|International), status (Active|Inactive),
  licenseNo, email, phone, address, updatedAt,
  contacts[{id,name,role(Medical Director|Claims Manager|IT|Other),email,phone}],
  plans[{id,name,code,status}],
  documents[{id,type(License Copy|Contract|Agreement|Correspondence|Other),fileName,size,description,uploadedBy,uploadedAt}]
audit: id, entity, entityId, action, user, at, details
```
Seed ~25 payers, Lebanese context: NSSF, MOPH, Army/ISF funds, Cooperative of Civil Servants, private insurers (e.g. Bankers, AXA ME, Allianz SNA, Medgulf, Arope, LIA, Fidelity), 2 international (Bupa, Cigna), 1 Self Pay. Give each 1–3 contacts, 1–4 plans, 0–3 documents, mixed statuses, a few audit entries. Arabic names required.

Repository extras: `findActive()` (Active payers with Active plans only — for other modules' pickers), `isNameUnique(en, ar, excludeId)`.

## Payer List — `#/pactum/payers`
Columns: Name (EN), Type, License No., Primary Contact (first contact "Name · Role", or —), Status badge, Last Updated. Search (name EN/AR, license no.), filters Type + Status, sortable, paginated. Buttons: Add New Payer, Bulk Import. Row actions: View/Edit, Activate/Deactivate (toast + audit), View History. Empty state: "No payers found. Click 'Add New Payer' to get started."

## Add/Edit Modal — 4 tabs (shared/modal.js)
Tabs show an error dot when they contain invalid fields.
- **General Info**: Name EN*, Name AR* (both unique), Type*, Status* (default Active), License No. (required unless Self Pay — hide the asterisk live when Self Pay is selected), Email* (format), Phone* (format), Address.
- **Contacts**: repeatable rows: Name*, Role*, Email*, Phone*. + Add Contact, delete per row. Zero rows allowed but show a soft warning "No contacts added" on save.
- **Plans**: repeatable rows: Name*, Code* (unique within payer), Status* (default Active). + Add Plan, delete per row.
- **Documents**: upload form (Type*, file input*, Description). Validate type PDF/JPG/PNG/DOCX/XLSX and size ≤ 10 MB; store metadata only (no real file). List: file name, type, description, uploaded by (current role's user), date, Download (toast "Downloaded <name>"), Delete (confirm → remove + audit).
- **Save**: validate all tabs, jump to first invalid tab, inline errors. Success → upsert, audit ("Created"/"Updated" with changed fields), toast, close. **Cancel** discards.

## View History — drawer
Reverse-chronological audit entries for the payer: action, user, timestamp, details. Read-only.

## Bulk Import — `#/pactum/payers/import`
4-step stepper: Download Template (generates a CSV with Tab-1 columns and triggers download) → Upload (CSV/XLSX, ≤ 5 MB; parse CSV client-side; for XLSX just accept and use a canned sample to keep it simple) → Validation & Preview (table, per-row Valid / Error + reason: duplicate name vs existing or within file, missing required, invalid email/phone, unknown type) → Import (only valid rows; summary "X imported, Y skipped", Download error report as CSV, audit entry with file name and counts). Include a "Load sample file" link that fills step 2 with a built-in CSV containing ~8 rows, 2–3 deliberately invalid, so the demo needs no real file.

## Rules to enforce
No delete for payers — deactivate only. Inactive payers/plans excluded from `findActive()` but always visible/editable here. Every create/update/activate/deactivate/document/import action writes an audit entry; audit is append-only.

## Done when
`#/pactum/payers`, the modal (all 4 tabs, add + edit), history drawer, and `#/pactum/payers/import` with the sample file all work end to end. Append changelog entry to CLAUDE.md. Reply with route list + open questions only.