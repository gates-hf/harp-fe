// Repository — code system versions. Owner: modules/pactum (amendment 44).
// A version is one release of a code system with the term it is valid over.
// At most one version of a system is current, and setCurrent() is the one
// write that moves the flag: it clears the previous version and sets the new
// one in a single commit, audits both, and asserts exactly one current
// version stands afterwards. Versions of one system never overlap in time,
// and a version is never deleted — it is deactivated, which also clears its
// current flag, since an inactive version is not a source anybody resolves on.
//
// Every mutation appends to the shared audit trail under the
// `codeSystemVersions` key; a version added or made current is also noted on
// the system's own trail, so the system's history reads whole.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as systems from './code-systems.js';
import { compareDates, iso, withinDates } from '../../shared/format.js';

const TABLE = 'codeSystemVersions';
export const ENTITY = TABLE;
export const STATUSES = ['Active', 'Inactive'];

export function all() {
  return store.table(TABLE);
}

export const get = (id) => all().find((row) => row.id === id) || null;

/** Every version of one system, newest term first. */
export const bySystem = (systemId) =>
  all().filter((row) => row.codeSystemId === systemId)
    .sort((a, b) => compareDates(b.validFrom, a.validFrom) || String(b.id).localeCompare(a.id));

export const currentOf = (systemId) => bySystem(systemId).find((row) => row.isCurrent && row.status === 'Active') || null;

export const activeOf = (systemId) => bySystem(systemId).filter((row) => row.status === 'Active');

/** The newest active version by term — the fallback when nothing is current. */
export const latestActiveOf = (systemId) => activeOf(systemId)[0] || null;

/** The active version whose term covers a date, or null when none does. */
export const versionFor = (systemId, atDate) =>
  activeOf(systemId).find((row) => withinDates(atDate, row.validFrom, row.validTo)) || null;

export const label = (row) => (row ? `${systems.get(row.codeSystemId)?.name || row.codeSystemId} ${row.versionLabel}` : '');

export const statusTone = (status) => (status === 'Active' ? 'success' : '');

/** Labels are unique within a system. Pass excludeId when editing. */
export function isLabelUnique(systemId, versionLabel, excludeId = null) {
  const needle = String(versionLabel || '').trim().toLowerCase();
  return !all().some((row) =>
    row.codeSystemId === systemId && row.id !== excludeId && row.versionLabel.trim().toLowerCase() === needle);
}

/**
 * The version whose term a proposed term overlaps, or null. Every version of
 * the system counts, retired ones included — a retired release still says what
 * was valid when, and a new term written over it would answer two ways for one
 * date. An open-ended term reaches forward without limit — except that a new
 * release starting after it is what closes it (`closableBy`), the way a
 * publisher's next edition ends the last: create() writes the day before the
 * new start as its valid-to, audited on both.
 */
export function overlapOf(systemId, from, to, excludeId = null) {
  const start = iso(from);
  const end = iso(to) || '9999-12-31';
  return all().find((row) => {
    if (row.codeSystemId !== systemId || row.id === excludeId) return false;
    const rowEnd = iso(row.validTo) || '9999-12-31';
    return start <= rowEnd && iso(row.validFrom) <= end;
  }) || null;
}

/** Whether an overlapping version is the open-ended one a new term starting after it closes. */
export const closableBy = (row, from) => Boolean(row) && !row.validTo && iso(row.validFrom) < iso(from);

const dayBefore = (isoDate) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

export function validate(data, excludeId = null) {
  const errors = {};
  if (!systems.get(data.codeSystemId)) errors.codeSystemId = 'No such code system';
  const versionLabel = String(data.versionLabel || '').trim();
  if (!versionLabel) errors.versionLabel = 'Enter a version label';
  else if (!isLabelUnique(data.codeSystemId, versionLabel, excludeId)) errors.versionLabel = `Version ${versionLabel} already exists on this system`;
  if (!iso(data.releaseDate)) errors.releaseDate = 'Enter the release date';
  if (!iso(data.validFrom)) errors.validFrom = 'Enter the date the version is valid from';
  if (data.validTo && compareDates(data.validTo, data.validFrom) < 0) errors.validTo = 'Valid to is before valid from';
  if (!errors.validFrom && !errors.validTo && !errors.codeSystemId) {
    const clash = overlapOf(data.codeSystemId, data.validFrom, data.validTo, excludeId);
    // An open-ended earlier term is closed by the new one on create; an edit
    // to an existing version's dates gets no such favour.
    if (clash && !(excludeId === null && closableBy(clash, data.validFrom))) {
      errors.validFrom = `Overlaps version ${clash.versionLabel} (${clash.validFrom} – ${clash.validTo || 'open'}, ${clash.status})`;
    }
  }
  return errors;
}

/** Active systems with no current version — the landing's highlight and the lookup's warning. */
export const systemsWithoutCurrent = () => systems.findActive().filter((sys) => !currentOf(sys.id));

export function counts() {
  const rows = all();
  return {
    total: rows.length,
    active: rows.filter((row) => row.status === 'Active').length,
    current: rows.filter((row) => row.isCurrent).length,
    noCurrent: systemsWithoutCurrent().length,
  };
}

/** Exactly-one-current: the invariant setCurrent() asserts after every swap. */
export function assertOneCurrent(systemId) {
  const n = bySystem(systemId).filter((row) => row.isCurrent).length;
  console.assert(n === 1, `[code-systems] ${systemId} has ${n} current versions after a swap`);
  return n === 1;
}

// --- writes -----------------------------------------------------------------

export function create(data) {
  const errors = validate(data);
  if (Object.keys(errors).length) return { error: Object.values(errors)[0], errors };
  const now = new Date().toISOString();
  const row = {
    id: store.nextId(TABLE, 'CSV-'),
    codeSystemId: data.codeSystemId,
    versionLabel: String(data.versionLabel).trim(),
    releaseDate: iso(data.releaseDate),
    isCurrent: false,
    status: 'Active',
    validFrom: iso(data.validFrom),
    validTo: iso(data.validTo) || null,
    createdAt: now,
    updatedAt: now,
  };
  // The open-ended term before this one ends the day before it starts.
  const open = overlapOf(data.codeSystemId, row.validFrom, row.validTo);
  const closed = closableBy(open, row.validFrom) ? open : null;
  if (closed) {
    closed.validTo = dayBefore(row.validFrom);
    closed.updatedAt = now;
  }
  all().push(row);
  store.commit('codeSystemVersions.create');
  const term = `valid ${row.validFrom}${row.validTo ? ` – ${row.validTo}` : ' onward'}`;
  audit.log({ entity: TABLE, entityId: row.id, action: 'Created', details: `${row.versionLabel} · released ${row.releaseDate} · ${term}` });
  if (closed) {
    audit.log({ entity: TABLE, entityId: closed.id, action: 'Term closed', details: `valid to ${closed.validTo} — ${row.versionLabel} starts ${row.validFrom}` });
  }
  audit.log({ entity: systems.ENTITY, entityId: row.codeSystemId, action: 'Version added', details: `${row.versionLabel} · ${term}${closed ? ` · closes ${closed.versionLabel} on ${closed.validTo}` : ''}` });
  return { row, closed };
}

export function update(id, patch) {
  const row = get(id);
  if (!row) return { error: 'No such version' };
  const next = { ...row, ...patch };
  const errors = validate(next, id);
  if (Object.keys(errors).length) return { error: Object.values(errors)[0], errors };
  const changed = [];
  const fields = { versionLabel: 'label', releaseDate: 'release date', validFrom: 'valid from', validTo: 'valid to' };
  for (const [key, name] of Object.entries(fields)) {
    if (!(key in patch)) continue;
    const value = key === 'versionLabel' ? String(patch[key]).trim() : key === 'validTo' ? (iso(patch[key]) || null) : iso(patch[key]);
    if (value !== row[key]) {
      changed.push(`${name} ${row[key] ?? '—'} → ${value ?? '—'}`);
      row[key] = value;
    }
  }
  if (!changed.length) return { row };
  row.updatedAt = new Date().toISOString();
  store.commit('codeSystemVersions.update');
  audit.log({ entity: TABLE, entityId: id, action: 'Updated', details: changed.join('; ') });
  return { row };
}

/** Why this version cannot be made current, or ''. */
export function setCurrentBlocked(row) {
  if (!row) return 'No such version';
  if (row.status !== 'Active') return 'An inactive version cannot be current — activate it first';
  if (row.isCurrent) return 'This version is already current';
  return '';
}

/**
 * The atomic swap: the previous current version (if any) loses the flag and
 * this one gains it in one commit, both audited, and the invariant is checked
 * before anybody is told.
 */
export function setCurrent(id) {
  const row = get(id);
  const why = setCurrentBlocked(row);
  if (why) return { error: why };
  const previous = currentOf(row.codeSystemId);
  const now = new Date().toISOString();
  if (previous) {
    previous.isCurrent = false;
    previous.updatedAt = now;
  }
  row.isCurrent = true;
  row.updatedAt = now;
  const ok = assertOneCurrent(row.codeSystemId);
  store.commit('codeSystemVersions.current');
  if (previous) {
    audit.log({ entity: TABLE, entityId: previous.id, action: 'Current cleared', details: `Superseded by ${row.versionLabel}` });
  }
  audit.log({ entity: TABLE, entityId: id, action: 'Set as current', details: previous ? `Replaces ${previous.versionLabel}` : `First current version of ${label(row)}` });
  audit.log({ entity: systems.ENTITY, entityId: row.codeSystemId, action: 'Current version', details: previous ? `${previous.versionLabel} → ${row.versionLabel}` : row.versionLabel });
  return { row, previous, ok };
}

/**
 * Deactivating the current version clears its flag first — the system is then
 * without a current version, and the landing says so — and is audited as two
 * moves, since they are two facts about the row.
 */
export function setStatus(id, status, reason = '') {
  const row = get(id);
  if (!row || !STATUSES.includes(status) || row.status === status) return null;
  const now = new Date().toISOString();
  if (status === 'Inactive' && row.isCurrent) {
    row.isCurrent = false;
    audit.log({ entity: TABLE, entityId: id, action: 'Current cleared', details: `Version deactivated — ${systems.get(row.codeSystemId)?.name || row.codeSystemId} has no current version` });
  }
  row.status = status;
  row.updatedAt = now;
  store.commit('codeSystemVersions.status');
  audit.log({ entity: TABLE, entityId: id, action: status === 'Active' ? 'Activated' : 'Deactivated', details: reason || `Status set to ${status}` });
  return row;
}

export const history = (id) => audit.forEntity(TABLE, id);
