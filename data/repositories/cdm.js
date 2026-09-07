// Repository — cdm (Charge Description Master). Owner: modules/pactum.
// The only way any module reads or writes the catalogue. Items and bundles
// share one collection: a bundle is a row with kind:"bundle" that carries its
// own price, so contract rules can reference either by the same id.
//
// Nothing is ever deleted — a line is deactivated, and every bundle that
// contains it is flagged for review. Every mutation appends to the audit trail.

import { store } from '../store.js';
import * as audit from './audit.js';

const TABLE = 'cdm';

export const CATEGORIES = [
  'Consultation', 'Lab', 'Radiology', 'Procedure', 'Surgery', 'Room & Board',
  'Pharmacy', 'Consumables', 'Professional Fee', 'Non-Clinical', 'Bundle',
];
/** Bundles own the Bundle category; the item form never offers it. */
export const ITEM_CATEGORIES = CATEGORIES.filter((c) => c !== 'Bundle');
export const UOMS = ['Each', 'Hour', 'Night', 'Session', 'Test', 'Unit', 'Package'];
export const STATUSES = ['Active', 'Inactive'];
export const BUNDLE_TYPES = ['Promotional', 'Procedure'];

const FIELD_LABELS = {
  chargeCode: 'charge code',
  descriptionEn: 'description',
  name: 'name',
  category: 'category',
  uom: 'UoM',
  standardPrice: 'standard price',
  status: 'status',
  bundleType: 'type',
  validFrom: 'valid from',
  validTo: 'valid to',
};

export function all() {
  return store.table(TABLE);
}

export function get(id) {
  return all().find((r) => r.id === id) || null;
}

export function getByCode(code) {
  const needle = String(code || '').trim().toLowerCase();
  return all().find((r) => r.chargeCode.toLowerCase() === needle) || null;
}

export const isBundle = (row) => row?.kind === 'bundle';

/** What a row is called on screen — a bundle carries a name, an item does not. */
export const label = (row) => (row ? row.name || row.descriptionEn : '');

export const bundleTypeLabel = (type) => (type === 'Procedure' ? 'Procedure composition' : 'Promotional');

/** list({ q, category, status, kind, sort, dir }) — filtered and sorted copy. */
export function list({ q = '', category = '', status = '', kind = '', sort = 'chargeCode', dir = 'asc' } = {}) {
  const needle = q.trim().toLowerCase();
  const rows = all().filter((r) => {
    if (kind && r.kind !== kind) return false;
    if (category && r.category !== category) return false;
    if (status && r.status !== status) return false;
    if (!needle) return true;
    return r.chargeCode.toLowerCase().includes(needle) || label(r).toLowerCase().includes(needle);
  });
  const sign = dir === 'desc' ? -1 : 1;
  return rows.sort((a, b) => {
    if (sort === 'standardPrice') return (Number(a.standardPrice) - Number(b.standardPrice)) * sign;
    const key = sort === 'descriptionEn' ? null : sort;
    const av = key ? a[key] : label(a);
    const bv = key ? b[key] : label(b);
    return String(av ?? '').localeCompare(String(bv ?? '')) * sign;
  });
}

/** What a picker or a contract rule may reference: Active rows only. */
export function findActive() {
  return all().filter((r) => r.status === 'Active');
}

/** Charge codes are unique across the whole catalogue. Pass excludeId on edit. */
export function isChargeCodeUnique(code, excludeId = null) {
  const needle = String(code || '').trim().toLowerCase();
  return !all().some((r) => r.id !== excludeId && r.chargeCode.toLowerCase() === needle);
}

export function counts() {
  const rows = all();
  return {
    total: rows.length,
    items: rows.filter((r) => r.kind === 'item').length,
    bundles: rows.filter((r) => r.kind === 'bundle').length,
    active: rows.filter((r) => r.status === 'Active').length,
    inactive: rows.filter((r) => r.status !== 'Active').length,
    flagged: rows.filter((r) => r.flaggedForReview).length,
  };
}

// --- composition -------------------------------------------------------------

/** [{ row, qty, lineTotal }] for one bundle, skipping components since deleted. */
export function componentRows(id) {
  const bundle = get(id);
  return (bundle?.components || [])
    .map((c) => {
      const row = get(c.refId);
      const qty = Number(c.qty) || 0;
      return row ? { row, qty, lineTotal: Number(row.standardPrice) * qty } : null;
    })
    .filter(Boolean);
}

/** What the components cost on their own. A nested bundle counts at its own price. */
export function componentSum(id) {
  return componentRows(id).reduce((sum, c) => sum + c.lineTotal, 0);
}

/** Bundles that hold this row directly. */
export function parentsOf(id) {
  return all().filter((r) => r.components?.some((c) => c.refId === id));
}

/** True when putting componentId inside bundleId would close a loop. */
export function wouldCreateCycle(bundleId, componentId) {
  if (!bundleId || !componentId) return false;
  if (bundleId === componentId) return true;
  return Boolean(cyclePath(componentId, bundleId));
}

/** The chain of charge codes from rootId down to targetId, or null. */
export function cyclePath(rootId, targetId, seen = new Set()) {
  const row = get(rootId);
  if (!row?.components || seen.has(rootId)) return null;
  seen.add(rootId);
  for (const c of row.components) {
    if (c.refId === targetId) return [row.chargeCode, get(targetId)?.chargeCode || targetId];
    const deeper = cyclePath(c.refId, targetId, seen);
    if (deeper) return [row.chargeCode, ...deeper];
  }
  return null;
}

/** Flag every bundle holding this row, at any depth. Returns how many. */
export function flagParents(id, reason) {
  const queue = [id];
  const seen = new Set();
  while (queue.length) {
    for (const parent of parentsOf(queue.shift())) {
      if (seen.has(parent.id)) continue;
      seen.add(parent.id);
      queue.push(parent.id);
      parent.flaggedForReview = true;
      parent.flagReason = reason;
      parent.updatedAt = new Date().toISOString();
      audit.log({ entity: TABLE, entityId: parent.id, action: 'Flagged for review', details: reason });
    }
  }
  if (seen.size) store.commit('cdm.flag');
  return seen.size;
}

export function clearFlag(id) {
  const row = get(id);
  if (!row?.flaggedForReview) return row;
  const reason = row.flagReason;
  row.flaggedForReview = false;
  row.flagReason = '';
  row.updatedAt = new Date().toISOString();
  store.commit('cdm.flag');
  audit.log({ entity: TABLE, entityId: id, action: 'Flag cleared', details: reason || 'Reviewed' });
  return row;
}

/**
 * Promotional bundles past their validity are retired and their parents
 * flagged. Runs once when this module loads, so the catalogue is current
 * before any screen reads it.
 */
export function expireBundles(today = new Date().toISOString().slice(0, 10)) {
  let expired = 0;
  for (const row of all()) {
    if (row.kind !== 'bundle' || row.bundleType !== 'Promotional') continue;
    if (row.status !== 'Active' || !row.validTo || row.validTo >= today) continue;
    row.status = 'Inactive';
    row.updatedAt = new Date().toISOString();
    expired += 1;
    audit.log({ entity: TABLE, entityId: row.id, action: 'Expired', details: `Validity ended ${row.validTo}` });
    flagParents(row.id, `Component ${row.chargeCode} expired`);
  }
  if (expired) store.commit('cdm.expire');
  return expired;
}

// --- writes ------------------------------------------------------------------

export function create(data, { details = 'Charge line created' } = {}) {
  const row = {
    id: store.nextId(TABLE, 'CDM-'),
    kind: 'item',
    chargeCode: '',
    descriptionEn: '',
    category: 'Consultation',
    uom: 'Each',
    standardPrice: 0,
    status: 'Active',
    ...data,
    updatedAt: new Date().toISOString(),
  };
  row.standardPrice = Math.round(Number(row.standardPrice) * 100) / 100;
  if (row.kind === 'bundle') {
    row.components = (data.components || []).map((c) => ({ ...c }));
    row.flaggedForReview = Boolean(data.flaggedForReview);
    row.flagReason = data.flagReason || '';
  }
  all().push(row);
  store.commit('cdm.create');
  audit.log({ entity: TABLE, entityId: row.id, action: 'Created', details });
  return row;
}

/** Replace the editable fields of one row; the trail records old → new. */
export function update(id, patch) {
  const row = get(id);
  if (!row) return null;

  const before = { ...row, components: (row.components || []).map((c) => ({ ...c })) };
  Object.assign(row, patch, {
    standardPrice:
      patch.standardPrice === undefined
        ? row.standardPrice
        : Math.round(Number(patch.standardPrice) * 100) / 100,
    updatedAt: new Date().toISOString(),
  });
  if (patch.components) row.components = patch.components.map((c) => ({ ...c }));
  store.commit('cdm.update');

  const changed = diff(before, row);
  if (changed.length) {
    audit.log({ entity: TABLE, entityId: id, action: 'Updated', details: changed.join('; ') });
  }
  return row;
}

/** Activate or deactivate. Charge lines are never deleted. */
export function setStatus(id, status) {
  const row = get(id);
  if (!row || row.status === status) return row;
  row.status = status;
  row.updatedAt = new Date().toISOString();
  store.commit('cdm.status');
  audit.log({
    entity: TABLE,
    entityId: id,
    action: status === 'Active' ? 'Activated' : 'Deactivated',
    details: `Status set to ${status}`,
  });
  return row;
}

/** One entry for an import run, beside the per-row Created entries. */
export function logImport(fileName, imported, skipped) {
  audit.log({
    entity: TABLE,
    entityId: null,
    action: 'Imported',
    details: `${fileName} — ${imported} imported, ${skipped} skipped`,
  });
}

// --- internals ---------------------------------------------------------------

const show = (v) => (v === '' || v == null ? '—' : String(v));

function diff(before, after) {
  const changed = Object.entries(FIELD_LABELS)
    .filter(([key]) => String(before[key] ?? '') !== String(after[key] ?? ''))
    .map(([key, text]) => `${text} ${show(before[key])} → ${show(after[key])}`);
  if (JSON.stringify(before.components) !== JSON.stringify(after.components)) {
    changed.push(`components ${(before.components || []).length} → ${(after.components || []).length} lines`);
  }
  return changed;
}

expireBundles();
