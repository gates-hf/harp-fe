// Repository — patients. Owner: modules/frontis (Patient Access & Eligibility).
// The only way any module reads or writes the patient registry; every other
// module references the MRN, which is this entity's id.
//
// A patient owns its nested documents — one entity, one repository. Patients
// are never deleted: they are marked Deceased, Blocked or Merged into another
// record. Every mutation appends to the shared audit trail, keyed on the MRN.
//
// VIP masking is a read-time rule, not a stored one: view(patient, role)
// returns the copy a screen is allowed to draw, and every screen renders
// through it. Search still matches the real values — the register has to be
// findable — so a restricted record is reached and then read masked.

import { store } from '../store.js';
import * as audit from './audit.js';
import { similarity, normalizePhone, FUZZY_THRESHOLD } from '../engines/name-match.js';
import { iso, maskName, maskId, todayIso } from '../../shared/format.js';

const TABLE = 'patients';

export const STATUSES = ['Active', 'Deceased', 'Blocked', 'Merged'];
export const GENDERS = ['Male', 'Female'];
export const DOCUMENT_TYPES = ['Civil ID Copy', 'Passport Copy', 'Consent Form', 'Other'];

export const NATIONALITIES = [
  'Lebanese', 'Syrian', 'Palestinian', 'Iraqi', 'Egyptian', 'Jordanian', 'Armenian',
  'French', 'Canadian', 'Filipino', 'Ethiopian', 'Sudanese', 'Other',
];

/** A photo above this is kept as metadata only — the demo store is a session. */
export const MAX_PHOTO_BYTES = 300 * 1024;
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

const FIELD_LABELS = {
  nameEn: 'name (EN)',
  nameAr: 'name (AR)',
  dob: 'date of birth',
  gender: 'gender',
  nationality: 'nationality',
  civilId: 'civil ID',
  passportNo: 'passport no.',
  phone: 'phone',
  email: 'email',
  address: 'address',
  city: 'city',
  photo: 'photo',
};

/** The fields the merge screen offers a choice on, in the order it shows them. */
export const MERGE_FIELDS = [
  'nameEn', 'nameAr', 'dob', 'gender', 'nationality',
  'civilId', 'passportNo', 'phone', 'email', 'address', 'city',
];

export const fieldLabel = (key) => FIELD_LABELS[key] || key;

export function all() {
  return store.table(TABLE);
}

export function get(mrn) {
  return all().find((p) => p.mrn === mrn) || null;
}

/** Follow mergedInto to the record that survived. Loops cannot outlive the cap. */
export function resolve(mrn) {
  let row = get(mrn);
  for (let hops = 0; row && row.mergedInto && hops < 10; hops++) row = get(row.mergedInto);
  return row;
}

export function statusTone(status) {
  if (status === 'Active') return 'success';
  if (status === 'Deceased') return 'critical';
  if (status === 'Blocked') return 'warning';
  return '';
}

/** Deceased, Blocked and Merged records cannot start an encounter. */
export const canOpenEncounter = (patient) => Boolean(patient) && patient.status === 'Active';

export const cities = () => [...new Set(all().map((p) => p.city).filter(Boolean))].sort();

export const nationalitiesInUse = () =>
  [...new Set(all().map((p) => p.nationality).filter(Boolean))].sort();

// --- reading ------------------------------------------------------------------

/**
 * The copy a role is allowed to draw. A VIP record read by a role without
 * `canViewVip` comes back with the name as initials, identifiers as their last
 * two digits, phone, email, address and photo withheld, and `masked: true` so
 * the screen can say why. Every other record is returned as it is.
 */
export function view(patient, role) {
  if (!patient) return null;
  if (!patient.vip || role?.canViewVip) return patient;
  return {
    ...patient,
    nameEn: maskName(patient.nameEn),
    nameAr: maskName(patient.nameAr),
    civilId: patient.civilId ? maskId(patient.civilId) : null,
    passportNo: patient.passportNo ? maskId(patient.passportNo) : null,
    phone: '',
    email: '',
    address: '',
    photo: null,
    documents: [],
    masked: true,
  };
}

/**
 * search(q, filters, { includeMerged }) — the list screen's one query.
 * `q` matches part of the MRN, either name, either identifier or the phone.
 * Merged records are out unless asked for, because they are not people you can
 * register, admit or bill.
 */
export function search(q = '', filters = {}, { includeMerged = false } = {}) {
  const {
    status = '', gender = '', nationality = '', city = '', vip = false, created = '',
    sort = 'nameEn', dir = 'asc',
  } = filters;
  const createdDay = created === 'today' ? todayIso() : iso(created);
  const needle = String(q).trim().toLowerCase();
  const digits = normalizePhone(needle);

  const rows = all().filter((p) => {
    if (!includeMerged && p.status === 'Merged') return false;
    if (status && p.status !== status) return false;
    if (gender && p.gender !== gender) return false;
    if (nationality && p.nationality !== nationality) return false;
    if (city && p.city !== city) return false;
    if (vip && !p.vip) return false;
    if (createdDay && iso(p.createdAt) !== createdDay) return false;
    if (!needle) return true;
    return (
      p.mrn.toLowerCase().includes(needle) ||
      p.nameEn.toLowerCase().includes(needle) ||
      p.nameAr.includes(String(q).trim()) ||
      (p.civilId || '').toLowerCase().includes(needle) ||
      (p.passportNo || '').toLowerCase().includes(needle) ||
      Boolean(digits) && normalizePhone(p.phone).includes(digits)
    );
  });

  const sign = dir === 'desc' ? -1 : 1;
  return rows.sort((a, b) => String(a[sort] ?? '').localeCompare(String(b[sort] ?? '')) * sign);
}

/**
 * Registered today — the Frontis dashboard's headline. It is the list's own
 * `created=today` slice rather than a second count, so the card's number and
 * the rows under it are the same query.
 */
export const createdToday = (on = todayIso()) => search('', { created: iso(on) });

export function counts() {
  const rows = all();
  const live = rows.filter((p) => p.status !== 'Merged');
  return {
    total: live.length,
    active: rows.filter((p) => p.status === 'Active').length,
    deceased: rows.filter((p) => p.status === 'Deceased').length,
    blocked: rows.filter((p) => p.status === 'Blocked').length,
    merged: rows.filter((p) => p.status === 'Merged').length,
    vip: live.filter((p) => p.vip).length,
    withVisit: live.filter((p) => p.lastVisitAt).length,
  };
}

/** MRN-000123 — the next number in sequence, read off the registry itself. */
export function nextMrn() {
  const max = all().reduce((n, p) => {
    const digits = Number(String(p.mrn).replace('MRN-', ''));
    return Number.isFinite(digits) && digits > n ? digits : n;
  }, 0);
  return `MRN-${String(max + 1).padStart(6, '0')}`;
}

/** Id for a nested row — documents added in the browser. */
export const newId = (prefix) => `${prefix}${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

/** Both identifiers are unique across the registry. Pass the MRN when editing. */
export function isIdentifierUnique(civilId, passportNo, excludeMrn = null) {
  const civil = String(civilId || '').trim();
  const passport = String(passportNo || '').trim().toUpperCase();
  return {
    civilId: !civil || !all().some((p) => p.mrn !== excludeMrn && String(p.civilId || '').trim() === civil),
    passportNo:
      !passport ||
      !all().some((p) => p.mrn !== excludeMrn && String(p.passportNo || '').trim().toUpperCase() === passport),
  };
}

/**
 * findDuplicates(candidate, excludeMrn) -> { hard, fuzzy, phone }
 *
 * `hard` is one record already carrying the same civil ID or passport — the
 * same person on paper, so registration stops. `fuzzy` is a normalised name
 * similarity at or above the threshold on the same date of birth, and `phone`
 * is the same line on a different person: both are worth a look, neither is
 * proof, so they are shown and can be overridden with a justification.
 *
 * A hit that has since been merged resolves to the record that survived, so
 * the clerk is sent to the row they can actually use.
 */
export function findDuplicates(candidate, excludeMrn = null) {
  const others = all().filter((p) => p.mrn !== excludeMrn);
  const civil = String(candidate.civilId || '').trim();
  const passport = String(candidate.passportNo || '').trim().toUpperCase();

  const hardHit = others.find(
    (p) =>
      (civil && String(p.civilId || '').trim() === civil) ||
      (passport && String(p.passportNo || '').trim().toUpperCase() === passport),
  );
  const hard = hardHit ? resolve(hardHit.mrn) : null;

  const rest = others.filter((p) => p.status !== 'Merged' && p.mrn !== hard?.mrn);
  const fuzzy = rest.filter(
    (p) => p.dob === candidate.dob && similarity(p.nameEn, candidate.nameEn) >= FUZZY_THRESHOLD,
  );

  const line = normalizePhone(candidate.phone);
  const phone = line
    ? rest.filter((p) => !fuzzy.includes(p) && normalizePhone(p.phone) === line)
    : [];

  return { hard, fuzzy, phone };
}

// --- writes -------------------------------------------------------------------

export function create(data, { details = '', action = 'Registered' } = {}) {
  const now = new Date().toISOString();
  const row = {
    mrn: nextMrn(),
    nameEn: '',
    nameAr: '',
    dob: '',
    gender: 'Female',
    nationality: 'Lebanese',
    civilId: null,
    passportNo: null,
    phone: '',
    email: '',
    address: '',
    city: '',
    photo: null,
    status: 'Active',
    deceasedAt: null,
    blockReason: '',
    mergedInto: null,
    vip: false,
    lastVisitAt: null,
    ...data,
    documents: clone(data.documents),
    createdAt: now,
    updatedAt: now,
  };
  all().push(row);
  store.commit('patient.create');
  audit.log({
    entity: TABLE,
    entityId: row.mrn,
    action,
    details: details || `${row.mrn} — ${row.nameEn}`,
  });
  for (const hook of afterCreateHooks) hook(row);
  return row;
}

/**
 * What runs the moment an MRN exists. A hook is fn(patient) and is registered
 * by the module that owns the record it resolves — a referral taken for someone
 * with no record finds them here, by the phone number the clinic gave.
 *
 * It is the create-time twin of relinkHooks: this file never learns what a
 * referral or a policy is, it only says when a patient came into being.
 */
export const afterCreateHooks = [];

/**
 * Replace the editable fields of one patient. The trail records which fields
 * changed; a changed identifier is its own entry, with the reason the clerk
 * gave, because that is the change an auditor comes looking for.
 */
export function update(mrn, patch, { reason = '' } = {}) {
  const row = get(mrn);
  if (!row) return null;

  const before = { ...row };
  Object.assign(row, patch, { documents: clone(patch.documents ?? row.documents), updatedAt: new Date().toISOString() });
  store.commit('patient.update');

  const changed = Object.keys(FIELD_LABELS).filter((key) => before[key] !== row[key]);
  const identifiers = changed.filter((key) => key === 'civilId' || key === 'passportNo');
  const rest = changed.filter((key) => !identifiers.includes(key));

  if (rest.length) {
    audit.log({
      entity: TABLE,
      entityId: mrn,
      action: 'Updated',
      details: rest.map((key) => `${FIELD_LABELS[key]}: ${show(before[key])} → ${show(row[key])}`).join('; '),
    });
  }
  for (const key of identifiers) {
    audit.log({
      entity: TABLE,
      entityId: mrn,
      action: 'Identifier changed',
      details: `${FIELD_LABELS[key]}: ${show(before[key])} → ${show(row[key])}${reason ? ` — reason: ${reason}` : ''}`,
    });
  }
  return row;
}

/**
 * setStatus(mrn, status, payload) — the one door for Deceased, Blocked and the
 * return to Active. Merged is set by merge() alone: it carries a survivor.
 */
export function setStatus(mrn, status, payload = {}) {
  const row = get(mrn);
  if (!row || !STATUSES.includes(status)) return null;

  const wasBlocked = row.status === 'Blocked';
  row.status = status;
  row.deceasedAt = status === 'Deceased' ? payload.deceasedAt || todayIso() : null;
  row.blockReason = status === 'Blocked' ? payload.reason || '' : '';
  row.updatedAt = new Date().toISOString();
  store.commit('patient.status');

  const action = status === 'Deceased' ? 'Marked deceased' : status === 'Blocked' ? 'Blocked' : wasBlocked ? 'Unblocked' : 'Status changed';
  const details = status === 'Deceased'
    ? `Date of death ${row.deceasedAt}`
    : payload.reason ? `Reason: ${payload.reason}` : `Status set to ${status}`;
  audit.log({ entity: TABLE, entityId: mrn, action, details });
  return row;
}

export function setVip(mrn, on) {
  const row = get(mrn);
  if (!row || row.vip === on) return row;
  row.vip = Boolean(on);
  row.updatedAt = new Date().toISOString();
  store.commit('patient.vip');
  audit.log({
    entity: TABLE,
    entityId: mrn,
    action: on ? 'VIP set' : 'VIP cleared',
    details: on ? 'Record restricted to roles that may view VIP patients' : 'Record readable by every role',
  });
  return row;
}

export function addDocument(mrn, doc) {
  const row = get(mrn);
  if (!row) return null;
  const saved = { id: newId('DOC-'), uploadedAt: new Date().toISOString(), ...doc };
  row.documents.push(saved);
  row.updatedAt = saved.uploadedAt;
  store.commit('patient.document');
  audit.log({ entity: TABLE, entityId: mrn, action: 'Document added', details: `${saved.type} — ${saved.fileName}` });
  return saved;
}

export function removeDocument(mrn, docId) {
  const row = get(mrn);
  const doc = row?.documents.find((d) => d.id === docId);
  if (!doc) return null;
  row.documents.splice(row.documents.indexOf(doc), 1);
  row.updatedAt = new Date().toISOString();
  store.commit('patient.document');
  audit.log({ entity: TABLE, entityId: mrn, action: 'Document removed', details: `${doc.type} — ${doc.fileName}` });
  return doc;
}

/** One entry for a bulk import run, beside the per-patient Registered entries. */
export function logImport(fileName, imported, skipped) {
  audit.log({
    entity: TABLE,
    entityId: null,
    action: 'Imported',
    details: `${fileName} — ${imported} imported, ${skipped} skipped`,
  });
}

/** The clerk registered anyway over a warning. The trail keeps their reason. */
export function logOverride(mrn, matches, justification) {
  audit.log({
    entity: TABLE,
    entityId: mrn,
    action: 'Duplicate override',
    details: `Registered over ${matches.join(', ')} — reason: ${justification}`,
  });
}

// --- merge --------------------------------------------------------------------

/**
 * What follows a patient when their record is folded into another. Documents
 * are handled here; every other module pushes a hook rather than this file
 * learning about encounters, policies or accounts.
 *
 * A hook is { label, count(mrn) -> number, relink(fromMrn, toMrn) -> number }.
 */
export const relinkHooks = [];

/** [{ label, count }] — what the merge screen shows before anything moves. */
export function relinkPreview(mrn) {
  const row = get(mrn);
  return [
    { label: 'Documents', count: row?.documents.length || 0 },
    ...relinkHooks.map((hook) => ({ label: hook.label, count: hook.count(mrn) || 0 })),
  ];
}

/**
 * merge(survivorMrn, duplicateMrn, fieldChoices) — fieldChoices is
 * { field: 'survivor' | 'duplicate' } and only the fields it names as
 * 'duplicate' move across. The duplicate keeps its record and its MRN: it is
 * marked Merged and points at the survivor, so an old wristband still resolves.
 */
export function merge(survivorMrn, duplicateMrn, fieldChoices = {}) {
  const survivor = get(survivorMrn);
  const duplicate = get(duplicateMrn);
  if (!survivor || !duplicate || survivor.mrn === duplicate.mrn) return null;

  const taken = MERGE_FIELDS.filter(
    (key) => fieldChoices[key] === 'duplicate' && survivor[key] !== duplicate[key],
  );
  for (const key of taken) survivor[key] = duplicate[key];

  const relinked = [{ label: 'Documents', count: duplicate.documents.length }];
  for (const doc of duplicate.documents) survivor.documents.push({ ...doc, id: newId('DOC-') });
  duplicate.documents = [];
  for (const hook of relinkHooks) {
    relinked.push({ label: hook.label, count: hook.relink(duplicate.mrn, survivor.mrn) || 0 });
  }

  duplicate.status = 'Merged';
  duplicate.mergedInto = survivor.mrn;
  const now = new Date().toISOString();
  duplicate.updatedAt = now;
  survivor.updatedAt = now;
  store.commit('patient.merge');

  const moved = relinked.filter((r) => r.count).map((r) => `${r.count} ${r.label.toLowerCase()}`).join(', ') || 'nothing to re-link';
  const kept = taken.length ? `kept ${taken.map(fieldLabel).join(', ')} from ${duplicate.mrn}` : 'kept every field of the survivor';
  audit.log({ entity: TABLE, entityId: survivor.mrn, action: 'Merged in', details: `${duplicate.mrn} (${duplicate.nameEn}) — ${kept}; re-linked ${moved}` });
  audit.log({ entity: TABLE, entityId: duplicate.mrn, action: 'Merged', details: `Merged into ${survivor.mrn} (${survivor.nameEn}) — re-linked ${moved}` });

  return { survivor, duplicate, taken, relinked };
}

// --- internals ----------------------------------------------------------------

const clone = (rows) => (rows || []).map((row) => ({ ...row }));

const show = (value) => (value === null || value === undefined || value === '' ? '—' : String(value));
