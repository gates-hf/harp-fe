# Amendment 2 — Pactum: CDM (Charge Description Master)

Second feature of `pactum`: the catalog of everything the hospital can sell — items, procedure compositions, promotional packages. Contract rules (later) will reference it.

## Speed rules (apply to this and every future amendment — add to CLAUDE.md as a "Speed" section)
- Read only CLAUDE.md and the files named in the amendment. Do not re-read the design system, other features, or explore the repo.
- Purely additive: never refactor existing features unless the amendment says so.
- Seed data: hand-write 8–10 rows, generate the rest programmatically by combining short lists (names, categories, prices). No large literal arrays.
- Verification: `node --check` on new JS, load each new route once, stop. No end-to-end browser walkthroughs; the user tests.
- Copy patterns from `features/payer-master` (list, modal, import) instead of designing new ones.
- Reply: route list + open questions, nothing else.

## Files
```
modules/pactum/features/cdm/
  cdm-list.html / cdm-list.js            #/pactum/cdm
  cdm-item-form.js                       add/edit item modal
  cdm-import.html / cdm-import.js        #/pactum/cdm/import
  bundle-list.html / bundle-list.js      #/pactum/cdm/bundles
  bundle-builder.html / bundle-builder.js  #/pactum/cdm/bundles/new, #/pactum/cdm/bundles/:id
  component-tree.js                      expandable tree, reused by builder + bundle list
data/seed/cdm.js  data/repositories/cdm.js
```
Copy the payer bulk-import stepper into `cdm-import.js` and adapt columns/validators; do not refactor the payer version.
Nav: Pactum → CDM, Bundles. Reuse `data/repositories/audit.js`.

## Entity (single repository `cdm`, one collection)
```
cdmItem: id, chargeCode (immutable), descriptionEn, category, uom, standardPrice, status, updatedAt,
  kind: "item" | "bundle"
  // bundle only:
  bundleType: "Promotional" | "Procedure", name, components[{refId, qty}],
  validFrom, validTo (Promotional only), flaggedForReview: bool, flagReason
```
Bundles are CDM rows with `kind:"bundle"`, `category:"Bundle"`, and `standardPrice` = bundle price, so they appear in the CDM list and can be sold/nested. Categories: Consultation, Lab, Radiology, Procedure, Surgery, Room & Board, Pharmacy, Consumables, Professional Fee, Non-Clinical, Bundle. UoM: Each, Hour, Night, Session, Test, Unit, Package.

Repository extras: `findActive()`, `isChargeCodeUnique(code)`, `componentSum(id)` (recursive; nested bundles counted at their own price), `parentsOf(id)`, `wouldCreateCycle(bundleId, componentId)`, `flagParents(id, reason)`, `expireBundles()` (runs on load: Promotional bundles past validTo → Inactive + flag parents).

Seed ~40 items across categories (10 hand-written, rest generated) with realistic USD prices (surgeon hour, room night, CBC, MRI, consumables…) and ~8 bundles: 3 procedure compositions (e.g. Appendectomy Package, Normal Delivery, Cataract Surgery), 4 promotional (Blood Panel, Cardiac Screening, Full Check-Up nesting the previous two + consultation, one already expired), 1 flagged for review because a component is Inactive. Audit entries for a few.

## CDM List — `#/pactum/cdm`
Columns: Charge Code, Description, Category, UoM, Standard Price, Status, Last Updated. Search (code, description), filters Category + Status, sort, pagination. Buttons: Add Item, Bulk Import, link to Bundles. Row actions: Edit, Activate/Deactivate, View History. Bundle rows show a small "Bundle" chip and Edit opens the Bundle Builder. Empty state points to Add / Import.

**Item modal**: Charge Code* (unique; read-only in edit), Description EN*, Category*, UoM*, Standard Price* (> 0), Status* (default Active). Save → upsert + audit with field diffs. **Deactivate** → status Inactive, `flagParents(id, "Component <code> deactivated")`, toast mentions how many bundles were flagged. Never delete.

## Bulk Import — `#/pactum/cdm/import`
`shared/bulk-import.js` with CDM columns (Charge Code, Description EN, Category, UoM, Standard Price, Status). Errors: duplicate code (existing or in-file), missing field, invalid price (≤0 / non-numeric), unknown category/UoM. Built-in sample CSV with ~10 rows, 3 invalid. Items only — no bundles. Audit entry on import.

## Bundles List — `#/pactum/cdm/bundles`
Columns: Code, Name, Type, No. of Components, Bundle Price, Sum of Components, Validity (Promotional only, else —), Status, plus a warning badge with tooltip when `flaggedForReview`. Expand-row shows the component tree. Row actions: View/Edit, Activate/Deactivate (flags parents), View History, and "Clear flag" on flagged rows. Button: New Bundle.

## Bundle Builder — full-page, 3 steps
1. **Details**: Code* (unique across CDM, immutable in edit), Name*, Type* (Promotional | Procedure Composition), Bundle Price* (> 0), Validity From/To* when Promotional.
2. **Components**: searchable picker of Active items and Active bundles (excluding self and anything that `wouldCreateCycle`, shown disabled with tooltip "Would create a circular reference"). Each row: code, description, unit price (read-only), qty (> 0), line total. Sticky footer: **Sum of components** vs **Bundle price**, with discount % or markup shown live. Nested bundles expandable inline via `component-tree.js`.
3. **Review**: full component tree expanded to item level, totals, validity. Save → upsert as CDM row (`kind:"bundle"`, category Bundle), audit, toast, back to bundles list. A cycle check runs again at save; on failure show a clear error naming the chain.

## History
Copy `payer-history.js` to `cdm-history.js` (entity + id). Entries show time, user, action, field-level old → new. No refactor of the payer version.

## Note
US-12 (CDM as rule-engine prerequisite) is truncated in the spec — implement nothing for it; the `findActive()` + immutable charge code already prepare for contract rules.

## Done when
CDM list + item modal + import, bundles list with flags, builder end to end including nesting and cycle blocking, history for both. Append changelog to CLAUDE.md. Reply with route list + open questions only.