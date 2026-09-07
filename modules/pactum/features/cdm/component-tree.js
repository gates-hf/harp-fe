// The component tree — one bundle's contents, expandable to item level.
// Shared by the bundles list (inside an expanded row) and the bundle builder
// (components picker and review step), so both read a bundle the same way.
//
// Nesting is a table row per component, indented in design-system spacing. The
// design system ships no tree, and one feature is below the bar for adding a
// component to it, so the indent is an inline value built from --space-4 and
// nothing else — no new colours, no new type.

import * as cdm from '../../../../data/repositories/cdm.js';
import { esc, usd } from '../../../../shared/format.js';

/**
 * Depth-first rows: [{ path, depth, row, qty, lineTotal, limit…, isBundle }].
 * A bundle already on the way down is not walked again, so a catalogue that
 * somehow holds a loop still renders.
 */
export function nodes(rootId) {
  const out = [];
  walk(rootId, 0, 'n', out, new Set([rootId]));
  return out;
}

function walk(id, depth, path, out, seen) {
  cdm.componentRows(id).forEach((part, i) => {
    const nodePath = `${path}-${i}`;
    const isBundle = cdm.isBundle(part.row) && !seen.has(part.row.id);
    out.push({ ...part, path: nodePath, depth, isBundle });
    if (isBundle) walk(part.row.id, depth + 1, nodePath, out, new Set([...seen, part.row.id]));
  });
}

/**
 * What the bundle price covers on this line — "2 nights", "$200.00 allowance".
 * A unit that reads badly counted ("3 each") says "included" instead.
 */
const UNCOUNTED = { Each: 'included', Package: 'included' };

export function limitText({ limitType, limitQty, limitAmount, row }) {
  if (limitType === 'Amount Allowance') {
    return limitAmount > 0 ? `${usd(limitAmount)} allowance` : '—';
  }
  const qty = Number(limitQty) || 0;
  if (!qty) return '—';
  const uom = row?.uom || 'Each';
  return `${qty} ${UNCOUNTED[uom] || `${uom.toLowerCase()}${qty === 1 ? '' : 's'}`}`;
}

/** treeHtml(bundleId, { expandAll }) — the whole tree as one table. */
export function treeHtml(rootId, { expandAll = false } = {}) {
  const rows = nodes(rootId);
  if (!rows.length) {
    return '<p class="t-body-sm">This bundle has no components yet. Add at least one to price it.</p>';
  }
  return `
    <table class="tbl">
      <thead>
        <tr><th>Code</th><th>Component</th><th class="num">Qty</th><th>Limit</th><th class="num">Unit price</th><th class="num">Line total</th></tr>
      </thead>
      <tbody>${rows.map((node) => rowHtml(node, expandAll)).join('')}</tbody>
    </table>`;
}

function rowHtml(node, expandAll) {
  const { row, depth, path, qty, lineTotal, isBundle } = node;
  const limit = limitText(node);
  const inactive = row.status !== 'Active';
  return `
    <tr data-node="${path}" data-depth="${depth}" ${depth > 0 && !expandAll ? 'hidden' : ''}>
      <td class="t-mono-sm" style="padding-inline-start: calc(10px + var(--space-4) * ${depth})">
        ${isBundle ? toggleHtml(path, expandAll) : ''}${esc(row.chargeCode)}
      </td>
      <td>
        ${esc(cdm.label(row))}
        ${isBundle ? '<span class="badge badge--accent">Bundle</span>' : ''}
        ${inactive ? '<span class="badge badge--warning"><span class="dot"></span>Inactive</span>' : ''}
      </td>
      <td class="num t-mono-sm">${esc(qty)}</td>
      <td class="t-mono-sm">${esc(limit)}</td>
      <td class="num t-mono-sm">${usd(row.standardPrice)}</td>
      <td class="num t-mono-sm">${usd(lineTotal)}</td>
    </tr>`;
}

function toggleHtml(path, open) {
  return `
    <button class="btn btn--ghost btn--icon btn--sm" data-tree-toggle="${path}"
            aria-expanded="${open}" title="${open ? 'Hide components' : 'Show components'}">
      <span class="icon icon--sm">${open ? 'expand_more' : 'chevron_right'}</span>
    </button>`;
}

/**
 * Call from the host's click handler. Returns true when it handled the click,
 * so the host can stop there — the tree owns no listener of its own.
 */
export function handleTreeClick(e) {
  const btn = e.target.closest('[data-tree-toggle]');
  if (!btn) return false;
  setOpen(btn.closest('tbody'), btn.dataset.treeToggle, btn.getAttribute('aria-expanded') !== 'true');
  return true;
}

function setOpen(body, path, open) {
  const btn = body.querySelector(`[data-tree-toggle="${path}"]`);
  if (!btn) return;
  mark(btn, open);
  const childDepth = Number(btn.closest('tr').dataset.depth) + 1;

  // Expanding shows the direct children only; collapsing hides the whole
  // subtree and folds every toggle inside it, so reopening starts shallow.
  for (const tr of body.querySelectorAll(`tr[data-node^="${path}-"]`)) {
    tr.hidden = open ? Number(tr.dataset.depth) !== childDepth : true;
    const inner = tr.querySelector('[data-tree-toggle]');
    if (inner && !open) mark(inner, false);
  }
}

function mark(btn, open) {
  btn.setAttribute('aria-expanded', String(open));
  btn.title = open ? 'Hide components' : 'Show components';
  btn.querySelector('.icon').textContent = open ? 'expand_more' : 'chevron_right';
}
