// Repository — payers. Owner: modules/pactum (Payer & Contract Management).
// The only way any module reads or writes payers; other modules reference
// payer ids and read findActive() for their pickers.
//
// A payer owns its nested contacts, plans and documents — one entity, one
// repository. Payers are never deleted: they are deactivated. Every mutation
// here appends to the shared audit trail.

import { store } from '../store.js';
import * as audit from './audit.js';

const TABLE = 'payers';

export const TYPES = ['Government', 'Private', 'Self Pay', 'International'];
export const STATUSES = ['Active', 'Inactive'];
export const CONTACT_ROLES = ['Medical Director', 'Claims Manager', 'IT', 'Other'];
export const DOCUMENT_TYPES = ['License Copy', 'Contract', 'Agreement', 'Correspondence', 'Other'];

/** Type is the only field that changes whether a licence number is required. */
export const NO_LICENSE_TYPE = 'Self Pay';

const FIELD_LABELS = {
  nameEn: 'name (EN)',
  nameAr: 'name (AR)',
  type: 'type',
  status: 'status',
  licenseNo: 'licence no.',
  email: 'email',
  phone: 'phone',
  address: 'address',
};

export function all() {
  return store.table(TABLE);
}

export function get(id) {
  return all().find((p) => p.id === id) || null;
}

export function statusTone(status) {
  return status === 'Active' ? 'success' : '';
}

/** First contact, formatted "Name · Role" — the list column. */
export function primaryContact(payer) {
  const c = payer.contacts?.[0];
  return c ? `${c.name} · ${c.role}` : '';
}

/** list({ q, type, status, sort, dir }) — filtered and sorted copy. */
export function list({ q = '', type = '', status = '', sort = 'nameEn', dir = 'asc' } = {}) {
  const needle = q.trim().toLowerCase();
  const rows = all().filter((p) => {
    if (type && p.type !== type) return false;
    if (status && p.status !== status) return false;
    if (!needle) return true;
    return (
      p.nameEn.toLowerCase().includes(needle) ||
      p.nameAr.includes(q.trim()) ||
      (p.licenseNo || '').toLowerCase().includes(needle)
    );
  });
  const sign = dir === 'desc' ? -1 : 1;
  return rows.sort((a, b) => String(a[sort] ?? '').localeCompare(String(b[sort] ?? '')) * sign);
}

/**
 * Active payers carrying their Active plans only — what other modules put in
 * an eligibility or claim picker. Inactive payers and inactive plans never
 * appear here; Payer Master still shows and edits them.
 */
export function findActive() {
  return all()
    .filter((p) => p.status === 'Active')
    .map((p) => ({ ...p, plans: p.plans.filter((plan) => plan.status === 'Active') }));
}

/** Both names are unique across payers. Pass excludeId when editing. */
export function isNameUnique(nameEn, nameAr, excludeId = null) {
  const en = String(nameEn || '').trim().toLowerCase();
  const ar = String(nameAr || '').trim();
  return {
    nameEn: !all().some((p) => p.id !== excludeId && p.nameEn.trim().toLowerCase() === en),
    nameAr: !all().some((p) => p.id !== excludeId && p.nameAr.trim() === ar),
  };
}

export function counts() {
  const rows = all();
  return {
    total: rows.length,
    active: rows.filter((p) => p.status === 'Active').length,
    inactive: rows.filter((p) => p.status !== 'Active').length,
    activePlans: rows.reduce((n, p) => n + p.plans.filter((pl) => pl.status === 'Active').length, 0),
  };
}

/** Id for a nested row — contacts, plans and documents added in the browser. */
export function newId(prefix) {
  return `${prefix}${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

// --- writes -----------------------------------------------------------------

export function create(data, { details = 'Payer registered' } = {}) {
  const row = {
    id: store.nextId(TABLE, 'PY-'),
    nameEn: '',
    nameAr: '',
    type: 'Private',
    status: 'Active',
    licenseNo: '',
    email: '',
    phone: '',
    address: '',
    ...data,
    contacts: clone(data.contacts),
    plans: clone(data.plans),
    documents: clone(data.documents),
    updatedAt: new Date().toISOString(),
  };
  all().push(row);
  store.commit('payer.create');
  audit.log({ entity: TABLE, entityId: row.id, action: 'Created', details });
  logDocuments(row.id, [], row.documents);
  return row;
}

/**
 * Replace the editable fields of one payer. The trail records which fields
 * changed, and each document added or removed gets its own entry — the modal
 * is transactional, so document changes land here on save.
 */
export function update(id, patch) {
  const row = get(id);
  if (!row) return null;

  const before = { ...row, contacts: clone(row.contacts), plans: clone(row.plans), documents: clone(row.documents) };
  Object.assign(row, patch, {
    contacts: clone(patch.contacts ?? row.contacts),
    plans: clone(patch.plans ?? row.plans),
    documents: clone(patch.documents ?? row.documents),
    updatedAt: new Date().toISOString(),
  });
  store.commit('payer.update');

  const changed = changedFields(before, row);
  if (changed.length) {
    audit.log({ entity: TABLE, entityId: id, action: 'Updated', details: `Changed ${changed.join(', ')}` });
  }
  logDocuments(id, before.documents, row.documents);
  return row;
}

/** Activate or deactivate. Payers are never deleted. */
export function setStatus(id, status) {
  const row = get(id);
  if (!row || row.status === status) return row;
  row.status = status;
  row.updatedAt = new Date().toISOString();
  store.commit('payer.status');
  audit.log({
    entity: TABLE,
    entityId: id,
    action: status === 'Active' ? 'Activated' : 'Deactivated',
    details: `Status set to ${status}`,
  });
  return row;
}

/** One entry for a bulk import run, beside the per-payer Created entries. */
export function logImport(fileName, imported, skipped) {
  audit.log({
    entity: TABLE,
    entityId: null,
    action: 'Imported',
    details: `${fileName} — ${imported} imported, ${skipped} skipped`,
  });
}

// --- internals ---------------------------------------------------------------

const clone = (rows) => (rows || []).map((row) => ({ ...row }));

function changedFields(before, after) {
  const changed = Object.keys(FIELD_LABELS).filter((key) => before[key] !== after[key]).map((key) => FIELD_LABELS[key]);
  if (JSON.stringify(before.contacts) !== JSON.stringify(after.contacts)) changed.push('contacts');
  if (JSON.stringify(before.plans) !== JSON.stringify(after.plans)) changed.push('plans');
  if (JSON.stringify(before.documents) !== JSON.stringify(after.documents)) changed.push('documents');
  return changed;
}

function logDocuments(payerId, before, after) {
  const had = new Set(before.map((d) => d.id));
  const has = new Set(after.map((d) => d.id));
  for (const doc of after) {
    if (!had.has(doc.id)) {
      audit.log({ entity: TABLE, entityId: payerId, action: 'Document added', details: `${doc.type} — ${doc.fileName}` });
    }
  }
  for (const doc of before) {
    if (!has.has(doc.id)) {
      audit.log({ entity: TABLE, entityId: payerId, action: 'Document removed', details: `${doc.type} — ${doc.fileName}` });
    }
  }
}
