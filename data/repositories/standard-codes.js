// Repository — standard codes. Owner: modules/pactum (amendment 44).
// One row per code per version: a code is unique inside its version and never
// deleted (deactivated instead), and every mutation appends to the shared
// audit trail under the `standardCodes` key — a bulk import logs each code
// and one summary line on the version it landed in.
//
// This is also where the platform looks a code up. lookupCodes() resolves the
// version to read for a system — the one whose term covers the date asked
// about, else the current one, else the newest active one — and it never
// comes back empty in silence: a fallback is warned once per system and date,
// so a coder reading a 2024 chart against a 2026 release is told so in the
// console rather than handed the wrong display quietly. Claima's coding
// pickers read through here (data/repositories/code-sets.js is the adapter
// that keeps amendment 26's shape).
//
// Reads versions and systems; imported by neither, so the three stack one way.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as systems from './code-systems.js';
import * as versions from './code-system-versions.js';
import { compareDates, iso } from '../../shared/format.js';

const TABLE = 'standardCodes';
export const ENTITY = TABLE;
export const STATUSES = ['Active', 'Inactive'];

/** The optional facts a code carries beside its display — what the coder's sanity checks read. */
export const ATTRIBUTES = ['sex', 'ageMin', 'ageMax', 'category', 'chapter'];

export function all() {
  return store.table(TABLE);
}

export const get = (id) => all().find((row) => row.id === id) || null;

export const normalizeCode = (code) => String(code || '').trim().toUpperCase();

/** Every code of one version, in code order. */
export const byVersion = (versionId) =>
  all().filter((row) => row.codeSystemVersionId === versionId).sort((a, b) => a.code.localeCompare(b.code));

export const find = (versionId, code) => {
  const needle = normalizeCode(code);
  return all().find((row) => row.codeSystemVersionId === versionId && row.code === needle) || null;
};

export function isCodeUnique(versionId, code, excludeId = null) {
  const needle = normalizeCode(code);
  return !all().some((row) => row.codeSystemVersionId === versionId && row.id !== excludeId && row.code === needle);
}

/**
 * Code prefix first, then every word of the query somewhere in the display —
 * the order amendment 26's catalogue searched in, kept so a coder's habits
 * still land on the same hit first.
 */
export function matches(rows, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return rows;
  const words = needle.split(/\s+/).filter(Boolean);
  const byCode = rows.filter((row) => row.code.toLowerCase().startsWith(needle));
  const byDisplay = rows.filter((row) =>
    !byCode.includes(row) && words.every((w) => row.display.toLowerCase().includes(w)));
  return [...byCode, ...byDisplay];
}

/** The codes tab's list: one version, a search, a status. */
export function search(versionId, q = '', { status = '' } = {}) {
  const rows = byVersion(versionId).filter((row) => !status || row.status === status);
  return matches(rows, q);
}

export function counts(versionId) {
  const rows = byVersion(versionId);
  return {
    total: rows.length,
    active: rows.filter((row) => row.status === 'Active').length,
    inactive: rows.filter((row) => row.status !== 'Active').length,
  };
}

export const statusTone = (status) => (status === 'Active' ? 'success' : '');

export function validate(data, excludeId = null) {
  const errors = {};
  const version = versions.get(data.codeSystemVersionId);
  if (!version) errors.codeSystemVersionId = 'No such version';
  const code = normalizeCode(data.code);
  if (!code) errors.code = 'Enter a code';
  else if (version && !isCodeUnique(version.id, code, excludeId)) errors.code = `${code} is already in version ${version.versionLabel}`;
  if (!String(data.display || '').trim()) errors.display = 'Enter the display text';
  if (data.validFrom && !iso(data.validFrom)) errors.validFrom = 'Enter a date';
  return errors;
}

// --- lookup -----------------------------------------------------------------

const warned = new Set();

function warnOnce(key, message) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[standard-codes] ${message}`);
}

/**
 * Which version answers for a system on a date: the active version whose
 * term covers `atDate`; with no date, the current one. When that fails, the
 * fallback is named on the result and warned once — `fallback` is '' when
 * the resolution is clean, 'no-cover' when no version covers the date and the
 * current one answers instead, 'no-current' when the newest active version
 * stands in for a current one, and 'none' when the system has nothing active.
 */
export function resolveVersion(system, atDate = '') {
  const on = iso(atDate);
  const name = system.name;
  if (on) {
    const covering = versions.versionFor(system.id, on);
    if (covering) return { system, version: covering, fallback: '' };
  }
  const current = versions.currentOf(system.id);
  if (current) {
    if (on) warnOnce(`${system.id}|${on}`, `No version of ${name} covers ${on} — resolving on the current version ${current.versionLabel}`);
    return { system, version: current, fallback: on ? 'no-cover' : '' };
  }
  const latest = versions.latestActiveOf(system.id);
  if (latest) {
    warnOnce(`${system.id}|current`, `${name} has no current version — resolving on the newest active version ${latest.versionLabel}`);
    return { system, version: latest, fallback: 'no-current' };
  }
  warnOnce(`${system.id}|none`, `${name} has no active version — nothing to look up`);
  return { system, version: null, fallback: 'none' };
}

/** The systems a lookup reads: one by id, or every active one of a type. */
export function resolveVersions({ systemType = '', codeSystemId = '', atDate = '' } = {}) {
  const pool = codeSystemId
    ? [systems.get(codeSystemId)].filter(Boolean)
    : systems.findActive(systemType);
  return pool.map((system) => resolveVersion(system, atDate));
}

/**
 * The published lookup. Active codes from the version resolved for each
 * system asked about, matched against `query` (code prefix, then display
 * words), each row carrying the system and version it came from and its
 * attributes flattened beside the display.
 *
 * lookupCodes({ systemType | codeSystemId, query, atDate, limit }) → rows
 */
export function lookupCodes({ systemType = '', codeSystemId = '', query = '', atDate = '', limit = 0 } = {}) {
  const out = [];
  for (const { system, version, fallback } of resolveVersions({ systemType, codeSystemId, atDate })) {
    if (!version) continue;
    const rows = matches(byVersion(version.id).filter((row) => row.status === 'Active'), query);
    for (const row of rows) {
      out.push({
        ...row,
        ...row.attributes,
        desc: row.display,
        codeSystemId: system.id,
        systemName: system.name,
        systemType: system.systemType,
        versionId: version.id,
        versionLabel: version.versionLabel,
        fallback,
      });
    }
  }
  return limit > 0 ? out.slice(0, limit) : out;
}

// --- the landing's view -------------------------------------------------------

/** Every system with what its versions and codes add up to — the landing's rows. */
export function systemRows({ q = '', systemType = '', status = '', noCurrent = false, sort = 'name', dir = 'asc' } = {}) {
  const needle = q.trim().toLowerCase();
  const rows = systems.all()
    .map((system) => {
      const list = versions.bySystem(system.id);
      const current = versions.currentOf(system.id);
      return {
        system,
        current,
        versions: list.length,
        codes: current ? counts(current.id).active : 0,
        updatedAt: [system.updatedAt, ...list.map((v) => v.updatedAt)].sort().pop(),
      };
    })
    .filter(({ system, current }) => {
      if (systemType && system.systemType !== systemType) return false;
      if (status && system.status !== status) return false;
      if (noCurrent && (current || system.status !== 'Active')) return false;
      if (!needle) return true;
      return system.name.toLowerCase().includes(needle) || system.id.toLowerCase().includes(needle)
        || systems.typeLabel(system.systemType).toLowerCase().includes(needle);
    });
  const sign = dir === 'desc' ? -1 : 1;
  const key = (r) => (sort === 'current' ? (r.current?.versionLabel || '') : sort === 'versions' || sort === 'codes' ? r[sort] : sort === 'updatedAt' ? r.updatedAt : r.system[sort] ?? '');
  return rows.sort((a, b) => {
    const x = key(a);
    const y = key(b);
    return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * sign;
  });
}

export function systemCounts() {
  const c = systems.counts();
  const v = versions.counts();
  const inForce = versions.all().filter((row) => row.isCurrent && row.status === 'Active');
  return {
    ...c,
    versions: v.total,
    currentVersions: inForce.length,
    noCurrent: v.noCurrent,
    codesInForce: inForce.reduce((n, row) => n + counts(row.id).active, 0),
  };
}

// --- writes -----------------------------------------------------------------

/** Ids run to six digits: a version holds hundreds of codes. */
function nextId() {
  const max = all().reduce((n, row) => {
    const digits = Number(String(row.id).replace('SC-', ''));
    return Number.isFinite(digits) && digits > n ? digits : n;
  }, 0);
  return `SC-${String(max + 1).padStart(6, '0')}`;
}

const cleanAttributes = (attributes = {}) => ({
  sex: attributes.sex === 'F' || attributes.sex === 'M' ? attributes.sex : null,
  ageMin: Number.isFinite(Number(attributes.ageMin)) && attributes.ageMin !== '' && attributes.ageMin !== null ? Number(attributes.ageMin) : null,
  ageMax: Number.isFinite(Number(attributes.ageMax)) && attributes.ageMax !== '' && attributes.ageMax !== null ? Number(attributes.ageMax) : null,
  category: attributes.category ? String(attributes.category).trim() : null,
  chapter: attributes.chapter ? String(attributes.chapter).trim() : null,
});

function insert(data, details) {
  const version = versions.get(data.codeSystemVersionId);
  const now = new Date().toISOString();
  const row = {
    id: nextId(),
    codeSystemVersionId: version.id,
    code: normalizeCode(data.code),
    display: String(data.display).trim(),
    status: STATUSES.includes(data.status) ? data.status : 'Active',
    validFrom: iso(data.validFrom) || version.validFrom,
    attributes: cleanAttributes(data.attributes),
    createdAt: now,
    updatedAt: now,
  };
  all().push(row);
  store.commit('standardCodes.create');
  audit.log({ entity: TABLE, entityId: row.id, action: 'Created', details: details || `${row.code} — ${row.display} · ${versions.label(version)}` });
  return row;
}

export function create(data, { details = '' } = {}) {
  const errors = validate(data);
  if (Object.keys(errors).length) return { error: Object.values(errors)[0], errors };
  return { row: insert(data, details) };
}

/**
 * The importer's write: every valid row in one batch (one notification for
 * the whole file), each code audited as imported from the file and one
 * summary line on the version. Rows the caller did not validate are checked
 * again here and skipped with the reason — the repository never trusts a
 * preview it did not draw.
 */
export function createMany(versionId, rows, { source = 'bulk import' } = {}) {
  const version = versions.get(versionId);
  if (!version) return { error: 'No such version', created: [], skipped: [] };
  const created = [];
  const skipped = [];
  store.batch(() => {
    for (const data of rows) {
      const errors = validate({ ...data, codeSystemVersionId: versionId });
      if (Object.keys(errors).length) {
        skipped.push({ ...data, reason: Object.values(errors)[0] });
        continue;
      }
      created.push(insert({ ...data, codeSystemVersionId: versionId }, `${normalizeCode(data.code)} — imported from ${source}`));
    }
    audit.log({
      entity: versions.ENTITY, entityId: versionId, action: 'Bulk import',
      details: `${created.length} imported, ${skipped.length} skipped — ${source}`,
    });
  });
  return { created, skipped };
}

/**
 * Copy a version's active codes into another — the "create from previous"
 * helper. Codes the target already holds are left alone, so the copy can be
 * run onto a version that was started by hand. One trail line on the target
 * names the count and the source.
 */
export function createFromPrevious(versionId, fromVersionId = '') {
  const target = versions.get(versionId);
  if (!target) return { error: 'No such version', copied: 0 };
  const source = fromVersionId
    ? versions.get(fromVersionId)
    : versions.bySystem(target.codeSystemId).find((v) => v.id !== versionId && compareDates(v.validFrom, target.validFrom) <= 0);
  if (!source) return { error: 'No earlier version to copy from', copied: 0 };
  if (source.codeSystemId !== target.codeSystemId) return { error: 'Versions belong to different systems', copied: 0 };
  let copied = 0;
  store.batch(() => {
    for (const row of byVersion(source.id)) {
      if (row.status !== 'Active' || !isCodeUnique(versionId, row.code)) continue;
      insert({
        codeSystemVersionId: versionId, code: row.code, display: row.display, validFrom: target.validFrom, attributes: row.attributes,
      }, `${row.code} — copied from version ${source.versionLabel}`);
      copied += 1;
    }
    audit.log({
      entity: versions.ENTITY, entityId: versionId, action: 'Codes copied',
      details: `${copied} codes from version ${source.versionLabel}`,
    });
  });
  return { copied, source };
}

export function updateDisplay(id, display) {
  const row = get(id);
  const next = String(display || '').trim();
  if (!row) return { error: 'No such code' };
  if (!next) return { error: 'Enter the display text' };
  if (next === row.display) return { row };
  const was = row.display;
  row.display = next;
  row.updatedAt = new Date().toISOString();
  store.commit('standardCodes.update');
  audit.log({ entity: TABLE, entityId: id, action: 'Updated', details: `${row.code} display: ${was} → ${next}` });
  return { row };
}

export function setStatus(id, status, reason = '') {
  const row = get(id);
  if (!row || !STATUSES.includes(status) || row.status === status) return null;
  row.status = status;
  row.updatedAt = new Date().toISOString();
  store.commit('standardCodes.status');
  audit.log({ entity: TABLE, entityId: id, action: status === 'Active' ? 'Activated' : 'Deactivated', details: reason || `${row.code} status set to ${status}` });
  return row;
}

/**
 * The system page's History tab: the system's own trail, its versions' and
 * their codes' in one list, newest first, each entry saying which level it
 * belongs to. One pass over the audit table — a version holds hundreds of
 * codes, and asking the trail per code would be hundreds of scans.
 */
export function historyOf(systemId) {
  const versionRows = versions.bySystem(systemId);
  const versionById = new Map(versionRows.map((v) => [v.id, v]));
  const codeById = new Map();
  for (const row of all()) {
    if (versionById.has(row.codeSystemVersionId)) codeById.set(row.id, row);
  }
  const out = [];
  for (const entry of audit.all()) {
    if (entry.entity === systems.ENTITY && entry.entityId === systemId) {
      out.push({ ...entry, level: 'system', label: 'System' });
    } else if (entry.entity === versions.ENTITY && versionById.has(entry.entityId)) {
      out.push({ ...entry, level: 'version', label: `Version ${versionById.get(entry.entityId).versionLabel}` });
    } else if (entry.entity === TABLE && codeById.has(entry.entityId)) {
      const code = codeById.get(entry.entityId);
      out.push({ ...entry, level: 'code', label: `Code ${code.code} · v${versionById.get(code.codeSystemVersionId)?.versionLabel || ''}` });
    }
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)) || String(b.id).localeCompare(a.id));
}

export const history = (id) => audit.forEntity(TABLE, id);
