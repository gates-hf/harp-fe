# Amendment 6 — Pactum: Pre-Authorization

Part D of Payer Contract Management. Fills the **Pre-Auth** tab of the contract page. Smallest part so far — one tab, one modal, one helper.

## Speed rules
- Read only CLAUDE.md, `features/contracts/tab-coverage.js`, `coverage-form.js`, and the files named here.
- Purely additive. Copy the Coverage tab/modal patterns (single plan-less matrix this time); no refactors.
- Seed: pre-auth rows for the 2 seeded Active contracts only.
- Verify: `node --check` on new JS, load the contract page once, stop.
- Reply: route list + open questions only.

## Files
```
modules/pactum/features/contracts/
  tab-preauth.html / tab-preauth.js       replaces the placeholder Pre-Auth tab
  preauth-form.js                         add/edit row modal
data/repositories/contracts.js            extend with pre-auth helpers
data/seed/contracts.js                    extend 2 contracts
```

## Entity (nested on contract — replaces the `preAuth{}` placeholder with an array)
```
preAuth: [{ id, scopeLevel (Service Group|Category|Item), scopeValue, required: bool, threshold|null, updatedAt }]
```
Scope value pickers reused from Coverage. One row per scope+value; duplicates rejected. Not a gate for activation (an empty matrix means nothing requires pre-auth).

Repository helpers: `preAuthOverlap(contract, row)`, `resolvePreAuth(contract, item, amount)` → Item → Category → Service Group; returns `{ required, source: row|null, reason }` where `required` is true only if the winning row has `required=true` and (`threshold` is null or `amount > threshold`). An Item row with `required=false` wins over a requiring Category/Group row (exemption). Rule-engine overrides come in part F — leave a one-line hook comment where it will merge.

Seed: contract 1 — Service Group Inpatient required (no threshold), Category Radiology required above $300, Item MRI Brain required (always), Item Chest X-ray **not** required (exemption inside Radiology), Category Pharmacy required above $1,000. Contract 2 — Category Surgery required.

## Pre-Auth tab
Info banner: "Item rows override category rows, which override service-group rows. An item-level 'No' exempts it. Blank threshold = always required. Conditional pre-auth (diagnosis, age, LOS…) is configured in the Rules tab and overrides this matrix." Button: Add Row. Table: Scope Level, Scope Value, Pre-Auth Required (badge Yes/No — a "No" row gets a subtle "Exemption" tag when a broader row requires it), Threshold ("Above $300" or "Always"), actions Edit · Remove. Empty state: "No pre-authorization requirements. All services can be delivered without prior approval." Read-only on non-editable contracts.

**"Check an item" strip** (same pattern as Coverage's Try it): item picker + amount → result chip: "Pre-auth required — Item rule: MRI Brain (always)" / "Required above $300 — amount $450 exceeds" / "Not required (exempt by item rule)" / "Not required".

**Row modal**: Scope Level* → Scope Value*, Pre-Auth Required toggle (default Yes), Threshold Amount (optional, > 0; disabled and cleared when Required = No). Duplicate-scope error names the existing row. Save → audit with diffs.

## Done when
Pre-Auth tab with add/edit/remove, exemption tagging, and the check strip resolving correctly for the seeded cases (MRI, Chest X-ray, a $450 CT, a $200 CT). Changelog entry. Reply with route list + open questions.