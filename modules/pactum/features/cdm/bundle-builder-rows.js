// Markup for the bundle builder's three steps. No state and no listeners —
// bundle-builder.js owns the draft and the events and calls in here for HTML,
// the same split as payer-form.js / payer-form-rows.js.

import * as cdm from '../../../../data/repositories/cdm.js';
import { usd, esc } from '../../../../shared/format.js';
import { treeHtml } from './component-tree.js';

/** Step 1 — the bundle's own fields. `editing` fixes the code and drops autofocus. */
export function stepDetails(draft, editing) {
  const promotional = draft.bundleType === 'Promotional';
  return `
    <dl class="dl">
      <dt><label for="bb-code">Bundle code *</label></dt>
      <dd>
        <label class="field">
          <input id="bb-code" name="chargeCode" placeholder="PKG-ORT-009" value="${esc(draft.chargeCode)}"
                 ${editing ? 'readonly title="The code is fixed once the bundle exists"' : 'autofocus'}>
        </label>
        <p class="t-body-sm">Unique across the whole catalogue, items and bundles.</p>
      </dd>
      <dt><label for="bb-name">Name *</label></dt>
      <dd><label class="field"><input id="bb-name" name="name" placeholder="Knee arthroscopy package" value="${esc(draft.name)}"></label></dd>
      <dt><label for="bb-type">Type *</label></dt>
      <dd>
        <label class="field">
          <select id="bb-type" name="bundleType">
            ${cdm.BUNDLE_TYPES.map((t) => `<option value="${t}"${t === draft.bundleType ? ' selected' : ''}>${esc(cdm.bundleTypeLabel(t))}</option>`).join('')}
          </select>
        </label>
      </dd>
      <dt><label for="bb-price">Bundle price *</label></dt>
      <dd>
        <label class="field">
          <span class="icon icon--sm">attach_money</span>
          <input id="bb-price" name="standardPrice" type="number" min="0" step="0.01" placeholder="1450.00" value="${esc(draft.standardPrice)}">
        </label>
      </dd>
      ${promotional ? `
      <dt><label for="bb-from">Valid from *</label></dt>
      <dd><label class="field"><input id="bb-from" name="validFrom" type="date" value="${esc(draft.validFrom)}"></label></dd>
      <dt><label for="bb-to">Valid to *</label></dt>
      <dd><label class="field"><input id="bb-to" name="validTo" type="date" value="${esc(draft.validTo)}"></label></dd>` : ''}
      <dt><label for="bb-status">Status *</label></dt>
      <dd>
        <label class="field">
          <select id="bb-status" name="status">
            ${cdm.STATUSES.map((s) => `<option value="${s}"${s === draft.status ? ' selected' : ''}>${s}</option>`).join('')}
          </select>
        </label>
      </dd>
    </dl>
    ${promotional ? '<p class="t-body-sm">A promotional bundle retires itself the day after its validity ends.</p>' : ''}`;
}

/** Step 2 — the shell: the catalogue on the left, the bundle on the right. */
export function stepComponents(query) {
  return `
    <div class="split split--even">
      <div>
        <div class="toolbar">
          <label class="field field--grow">
            <span class="icon icon--sm">search</span>
            <input type="search" id="bb-search" placeholder="Search active charge lines" aria-label="Search charge lines" value="${esc(query)}">
          </label>
        </div>
        <table class="tbl">
          <thead><tr><th>Code</th><th>Description</th><th class="num">Price</th><th></th></tr></thead>
          <tbody id="bb-picker"></tbody>
        </table>
      </div>
      <div>
        <table class="tbl">
          <thead>
            <tr><th>Code</th><th>Component</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Line total</th><th></th></tr>
          </thead>
          <tbody id="bb-chosen"></tbody>
        </table>
      </div>
    </div>`;
}

/** The candidates, with the ones that cannot be added disabled and told why. */
export function pickerRows(rows, { bundleId, chosen }) {
  if (!rows.length) return '<tr><td colspan="4">No active charge line matches.</td></tr>';
  return rows.map((r) => {
    const cycle = cdm.wouldCreateCycle(bundleId, r.id);
    const added = chosen.has(r.id);
    const why = cycle ? 'Would create a circular reference' : added ? 'Already in this bundle' : `Add ${r.chargeCode}`;
    return `
      <tr>
        <td class="t-mono-sm">${esc(r.chargeCode)}</td>
        <td>${esc(cdm.label(r))}${cdm.isBundle(r) ? ' <span class="badge badge--accent">Bundle</span>' : ''}</td>
        <td class="num">${usd(r.standardPrice)}</td>
        <td>
          <button class="btn btn--secondary btn--sm" data-add="${r.id}" ${cycle || added ? 'disabled' : ''} title="${esc(why)}">
            ${added ? 'Added' : 'Add'}
          </button>
        </td>
      </tr>`;
  }).join('');
}

/** What is in the bundle: quantity, line total, and a nested bundle unfolds. */
export function chosenRows(components, open) {
  if (!components.length) return '<tr><td colspan="6">No components yet. Add at least one from the list on the left.</td></tr>';
  return components.map((c) => {
    const row = cdm.get(c.refId);
    if (!row) return '';
    const nested = cdm.isBundle(row);
    const isOpen = open.has(c.refId);
    return `
      <tr data-ref="${c.refId}">
        <td class="t-mono-sm">
          ${nested ? `<button class="btn btn--ghost btn--icon btn--sm" data-expand="${c.refId}" aria-expanded="${isOpen}"
                        title="${isOpen ? 'Hide' : 'Show'} what is inside ${esc(row.chargeCode)}">
                        <span class="icon icon--sm">${isOpen ? 'expand_more' : 'chevron_right'}</span>
                      </button>` : ''}${esc(row.chargeCode)}
        </td>
        <td>${esc(cdm.label(row))}${nested ? ' <span class="badge badge--accent">Bundle</span>' : ''}</td>
        <td class="num">
          <label class="field">
            <input type="number" min="1" step="1" value="${esc(c.qty)}" data-qty="${c.refId}" aria-label="Quantity for ${esc(row.chargeCode)}">
          </label>
        </td>
        <td class="num">${usd(row.standardPrice)}</td>
        <td class="num" data-line="${c.refId}">${usd(row.standardPrice * Number(c.qty || 0))}</td>
        <td>
          <button class="btn btn--ghost btn--icon btn--sm" data-remove="${c.refId}" title="Remove ${esc(row.chargeCode)}">
            <span class="icon icon--sm">delete</span>
          </button>
        </td>
      </tr>
      ${isOpen ? `<tr><td colspan="6">${treeHtml(c.refId, { expandAll: true })}</td></tr>` : ''}`;
  }).join('');
}

/** Step 3 — the whole bundle read back, every nested bundle expanded. */
export function stepReview(draft, { total, gap }) {
  const promotional = draft.bundleType === 'Promotional';
  return `
    <dl class="dl">
      <dt>Bundle code</dt><dd class="t-mono-sm">${esc(draft.chargeCode)}</dd>
      <dt>Name</dt><dd>${esc(draft.name)}</dd>
      <dt>Type</dt><dd>${esc(cdm.bundleTypeLabel(draft.bundleType))}</dd>
      <dt>Validity</dt><dd class="t-mono-sm">${promotional ? `${esc(draft.validFrom)} – ${esc(draft.validTo)}` : '—'}</dd>
      <dt>Components</dt><dd>${draft.components.length}</dd>
      <dt>Sum of components</dt><dd class="t-mono-sm">${usd(total)}</dd>
      <dt>Bundle price</dt><dd class="t-mono-sm">${usd(Number(draft.standardPrice || 0))}${esc(gap)}</dd>
      <dt>Status</dt><dd>${esc(draft.status)}</dd>
    </dl>
    <table class="tbl">
      <thead><tr><th>Code</th><th>Component</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Line total</th></tr></thead>
      <tbody>${draft.components.map(reviewRow).join('')}</tbody>
    </table>`;
}

function reviewRow(c) {
  const row = cdm.get(c.refId);
  if (!row) return '';
  const nested = cdm.isBundle(row);
  return `
    <tr>
      <td class="t-mono-sm">${esc(row.chargeCode)}</td>
      <td>${esc(cdm.label(row))}${nested ? ' <span class="badge badge--accent">Bundle</span>' : ''}</td>
      <td class="num">${esc(c.qty)}</td>
      <td class="num">${usd(row.standardPrice)}</td>
      <td class="num">${usd(row.standardPrice * Number(c.qty || 0))}</td>
    </tr>
    ${nested ? `<tr><td colspan="5">${treeHtml(c.refId, { expandAll: true })}</td></tr>` : ''}`;
}
