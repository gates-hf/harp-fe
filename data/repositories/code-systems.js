// Repository — code systems. Owner: modules/pactum (amendment 44).
// The root of the standard-code reference data: a system names a vocabulary
// (ICD-10-CM, LOINC…) and its type; its versions live in
// code-system-versions.js and the codes of each version in standard-codes.js.
//
// A system is never deleted — it is deactivated — and every mutation appends
// to the shared audit trail under the `codeSystems` key. This file imports
// neither of the two below it, so the three repositories stack one way:
// systems ← versions ← codes.

import { store } from '../store.js';
import * as audit from './audit.js';
import { compareDates, iso } from '../../shared/format.js';

const TABLE = 'codeSystems';
export const ENTITY = TABLE;

export const TYPES = ['GENERAL', 'ALLERGEN', 'DRUG', 'LAB', 'PROCEDURE', 'DIAGNOSIS'];
export const TYPE_LABELS = {
  GENERAL: 'General', ALLERGEN: 'Allergen', DRUG: 'Drug', LAB: 'Laboratory', PROCEDURE: 'Procedure', DIAGNOSIS: 'Diagnosis',
};
export const STATUSES = ['Active', 'Inactive'];

const FIELD_LABELS = { name: 'name', systemType: 'type', status: 'status', validFrom: 'valid from', validTo: 'valid to', description: 'description' };

export function all() {
  return store.table(TABLE);
}

export const get = (id) => all().find((row) => row.id === id) || null;

export const typeLabel = (type) => TYPE_LABELS[type] || type || '';
export const statusTone = (status) => (status === 'Active' ? 'success' : '');

/** Active systems, optionally of one type — what a lookup resolves over. */
export const findActive = (systemType = '') =>
  all().filter((row) => row.status === 'Active' && (!systemType || row.systemType === systemType));

/** Names are unique across systems. Pass excludeId when editing. */
export function isNameUnique(name, excludeId = null) {
  const needle = String(name || '').trim().toLowerCase();
  return !all().some((row) => row.id !== excludeId && row.name.trim().toLowerCase() === needle);
}

/** Field → message for what the form or the importer got wrong; empty when nothing. */
export function validate(data, excludeId = null) {
  const errors = {};
  const name = String(data.name || '').trim();
  if (!name) errors.name = 'Enter a name';
  else if (!isNameUnique(name, excludeId)) errors.name = `${name} is already on file`;
  if (!TYPES.includes(data.systemType)) errors.systemType = 'Choose a type';
  if (data.status && !STATUSES.includes(data.status)) errors.status = 'Choose a status';
  if (!iso(data.validFrom)) errors.validFrom = 'Enter the date the system is valid from';
  if (data.validTo && compareDates(data.validTo, data.validFrom) < 0) errors.validTo = 'Valid to is before valid from';
  return errors;
}

export function counts() {
  const rows = all();
  return {
    total: rows.length,
    active: rows.filter((row) => row.status === 'Active').length,
    inactive: rows.filter((row) => row.status !== 'Active').length,
  };
}

// --- writes -----------------------------------------------------------------

export function create(data) {
  const errors = validate(data);
  if (Object.keys(errors).length) return { error: Object.values(errors)[0], errors };
  const now = new Date().toISOString();
  const row = {
    id: store.nextId(TABLE, 'CS-'),
    name: String(data.name).trim(),
    systemType: data.systemType,
    status: STATUSES.includes(data.status) ? data.status : 'Active',
    validFrom: iso(data.validFrom),
    validTo: iso(data.validTo) || null,
    description: String(data.description || '').trim(),
    createdAt: now,
    updatedAt: now,
  };
  all().push(row);
  store.commit('codeSystems.create');
  audit.log({ entity: TABLE, entityId: row.id, action: 'Created', details: `${row.name} — ${typeLabel(row.systemType)}` });
  return { row };
}

/** Replace the editable fields; the trail names which ones moved. */
export function update(id, patch) {
  const row = get(id);
  if (!row) return { error: 'No such code system' };
  const next = { ...row, ...patch };
  const errors = validate(next, id);
  if (Object.keys(errors).length) return { error: Object.values(errors)[0], errors };

  const changed = [];
  for (const key of Object.keys(FIELD_LABELS)) {
    if (!(key in patch)) continue;
    const value = key === 'validFrom' ? iso(patch[key]) : key === 'validTo' ? (iso(patch[key]) || null) : key === 'name' || key === 'description' ? String(patch[key] || '').trim() : patch[key];
    if (value !== row[key]) {
      changed.push(FIELD_LABELS[key]);
      row[key] = value;
    }
  }
  if (!changed.length) return { row };
  row.updatedAt = new Date().toISOString();
  store.commit('codeSystems.update');
  audit.log({ entity: TABLE, entityId: id, action: 'Updated', details: `Changed ${changed.join(', ')}` });
  return { row };
}

export function setStatus(id, status, reason = '') {
  const row = get(id);
  if (!row || !STATUSES.includes(status) || row.status === status) return null;
  row.status = status;
  row.updatedAt = new Date().toISOString();
  store.commit('codeSystems.status');
  audit.log({
    entity: TABLE, entityId: id, action: status === 'Active' ? 'Activated' : 'Deactivated',
    details: reason || `Status set to ${status}`,
  });
  return row;
}

export const history = (id) => audit.forEntity(TABLE, id);
