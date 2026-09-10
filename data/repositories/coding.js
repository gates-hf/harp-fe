// Repository — encounter coding. Owner: modules/claima (amendment 26).
//
// A chart is a closed visit whose charges have been released, and coding is
// what turns the evidence on it into the diagnoses and procedures a claim is
// built from. The record keeps every version ever marked coded — a recode adds
// one and never edits the last — and the draft under work is simply the newest
// version without a codedAt.
//
// Two tables, one owner: `coding` is the chart, `cdiQueries` the questions a
// coder puts to the physician while working it. A query moves the chart's
// status (Query Pending while one is with the physician) and the chart's
// validation reads them (no open query at Mark Coded), so they live together.
//
// The released lines are the charge-capture register's (amendment 25): a
// line is coded once it is Released, and its id is what a procedure links to.
// The ledger's posted charges stand in only where that register has no answer,
// so the worklist has charts to show either way.
//
// The dataset seeds itself on first read (data/seed/coding.js) rather than
// through data/store.js: it reads the board and the ledger to exist.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as encounters from './encounters.js';
import * as ledger from './ledger.js';
import * as charges from './charges.js';
import * as cdm from './cdm.js';
import * as patients from './patients.js';
import * as claims from './claims.js';
import { icd, proc, isUnspecified, sanity } from './code-sets.js';
import { buildCoding, CODERS } from '../seed/coding.js';
import { doctorName } from '../seed/reference.js';
import { CONFIG } from '../../shared/config.js';
import { ROLES, current as currentRole } from '../../shared/roles.js';
import { compareDates, iso, todayIso } from '../../shared/format.js';

const TABLE = 'coding';
const QUERIES = 'cdiQueries';
const ENTITY = 'coding';

export const STATUSES = ['Unassigned', 'Assigned', 'In Progress', 'Query Pending', 'Coded', 'Recode Requested'];
export const QUERY_TYPES = ['Missing Documentation', 'Clarification', 'Specificity', 'Conflicting'];
export const QUERY_STATUSES = ['Open', 'Answered', 'Resolved', 'Withdrawn'];
export const RECODE_SOURCES = ['Denial', 'LateCharge', 'Manual'];
export const POA = ['Y', 'N', 'U'];
export { CODERS };

/** Fired with { encounterNo, codingVersion } on Mark Coded — claim assembly subscribes. */
export const afterCodedHooks = [];
/** Fired with { encounterNo, oldVersion, newVersion, reason } when a recode opens — claims go stale. */
export const afterRecodeHooks = [];

const config = () => CONFIG.claima?.coding || { slaDays: { OP: 3, IP: 5, ER: 3 }, linkedCategories: [], ageBands: [1, 3, 7] };

export const slaFor = (enc) => config().slaDays?.[enc?.type] ?? 3;

export const coderName = (id) =>
  CODERS.find((c) => c.id === id)?.name || ROLES.find((r) => r.id === id)?.name || id || '—';

/** The coders a chart can be handed to: the seeded three plus any role that codes. */
export const coders = () => {
  const out = [...CODERS];
  for (const role of ROLES) if (role.canCode && !out.some((c) => c.id === role.id)) out.push({ id: role.id, name: role.name });
  return out;
};

// --- released charge lines -----------------------------------------------------

// A release from charge capture puts the chart in the pool; the hook array is
// read defensively because that repository owns it.
if (Array.isArray(charges.afterReleaseHooks)) charges.afterReleaseHooks.push((payload) => onReleased(payload));

/** One shape whichever register the line came from. */
const lineOf = (row, item) => ({
  id: row.id,
  itemId: row.itemId || item?.id || '',
  chargeCode: item?.chargeCode || row.chargeCode || '',
  description: row.description || cdm.label(item) || row.itemId || '',
  category: item?.category || row.category || '',
  qty: row.qty ?? 1,
  amount: Number(row.amount) || 0,
  at: row.at || '',
  dateOfService: row.dateOfService || String(row.at || '').slice(0, 10),
  doctorId: row.doctorId || '',
  isOverage: Boolean(row.isOverage),
});

/**
 * The charge lines a chart is coded against: the capture register's Released
 * lines, priced at what the payer allows. The ledger's posted charges answer
 * only where the register cannot.
 */
export function releasedLines(no) {
  const published = typeof charges.releasedByEncounter === 'function' ? charges.releasedByEncounter(no) : null;
  if (Array.isArray(published)) {
    return published.map((row) => lineOf({
      id: row.id,
      itemId: row.itemId,
      qty: row.qty,
      amount: row.pricing?.allowed ?? row.amount ?? 0,
      at: row.releasedAt || row.dateOfService || '',
      dateOfService: row.dateOfService,
      doctorId: row.doctorId,
      isOverage: row.pricing?.isOverage,
    }, cdm.get(row.itemId)));
  }
  return ledger.byEncounter(no)
    .filter((row) => row.type === 'Charge' && ledger.isLive(row))
    .map((row) => lineOf({ ...row.detail, id: row.id, amount: row.amount, at: row.at }, cdm.get(row.detail?.itemId)));
}

/** Whether a line must be accounted for by a procedure code. */
export const isLinkable = (line) => (config().linkedCategories || []).includes(line.category);

const latestAt = (lines) => lines.reduce((latest, l) => (String(l.at) > latest ? String(l.at) : latest), '');

/** Charge capture released a visit's charges: the chart joins the pool. */
function onReleased(payload) {
  const no = typeof payload === 'string' ? payload : payload?.encounterNo || payload?.no;
  if (!no || !encounters.get(no)) return;
  const rec = ensure(no);
  rec.releasedAt = payload?.at || new Date().toISOString();
  rec.updatedAt = rec.releasedAt;
  store.commit('coding.released');
}

// --- reads --------------------------------------------------------------------

export function all() {
  const rows = store.table(TABLE);
  if (!rows.length) {
    const built = buildCoding(releasedLines);
    rows.push(...built.records);
    store.table(QUERIES).push(...built.queries);
    // The seeded trail, with the times the events happened at. audit.log()
    // would stamp every entry with now and with whoever is signed in.
    const trail = audit.all();
    for (const entry of built.trail) trail.push({ id: store.nextId('audit', 'AU-'), ...entry });
  }
  return rows;
}

export const get = (no) => all().find((row) => row.encounterNo === no) || null;

/** The newest version, coded or not — what the workspace edits. */
export const currentVersion = (rec) => rec?.versions[rec.versions.length - 1] || null;

/** The newest version that was marked coded — what a claim is built from. */
export const lastCoded = (rec) => [...(rec?.versions || [])].reverse().find((v) => v.codedAt) || null;

export const isOpen = (rec) => Boolean(rec) && rec.status !== 'Coded';

/**
 * The published read: the chart's status and its current coded version. A
 * chart under recode reports the version still standing with a status that
 * says it is being redone.
 */
export function byEncounter(no) {
  const rec = get(no);
  const v = rec ? lastCoded(rec) : null;
  return {
    status: rec?.status || 'Unassigned',
    version: v?.version || 0,
    diagnoses: v?.diagnoses || [],
    procedures: v?.procedures || [],
    codedAt: v?.codedAt || null,
    codedBy: v?.codedBy || null,
  };
}

/** Closed, billed, not cancelled: the visits the worklist is made of. */
export const candidates = () =>
  encounters.all().filter((enc) =>
    ['Discharged', 'Completed'].includes(enc.status) && releasedLines(enc.no).length > 0);

const DAY = 86400000;
const daysBetween = (from, to) => Math.max(0, (Date.parse(to) - Date.parse(from)) / DAY);

/**
 * The clock a chart is measured on: released → now while it is open, released
 * → coded once it is done. A chart sent back for recode starts a fresh clock
 * at the request, since the first coding was on time.
 */
function clockStart(rec, releasedAt) {
  const request = (rec?.recodeRequests || []).filter((r) => r.status === 'Open' || r.status === 'Accepted').pop();
  return request ? request.at : releasedAt;
}

/** One row per chart, with the age and the SLA answer the worklist paints. */
export function row(enc, rec = get(enc.no)) {
  const lines = releasedLines(enc.no);
  const releasedAt = rec?.releasedAt || latestAt(lines) || enc.endAt || enc.startAt;
  const status = rec?.status || 'Unassigned';
  const slaDays = rec?.slaDays ?? slaFor(enc);
  const start = clockStart(rec, releasedAt);
  const end = status === 'Coded' ? rec.completedAt || start : new Date().toISOString();
  const ageDays = daysBetween(start, end);
  return {
    no: enc.no,
    enc,
    patientMrn: enc.patientMrn,
    type: enc.type,
    department: enc.department,
    doctorId: enc.doctorId,
    completedAt: enc.endAt,
    releasedAt,
    lines: { count: lines.length, value: lines.reduce((s, l) => s + l.amount, 0) },
    status,
    assignedTo: rec?.assignedTo || null,
    codedAt: status === 'Coded' ? rec.completedAt : null,
    ageDays,
    slaDays,
    dueAt: new Date(Date.parse(start) + slaDays * DAY).toISOString(),
    beyondSla: ageDays > slaDays,
    record: rec,
  };
}

/** Every chart, worst first: beyond SLA, then oldest release. */
export const worklist = () =>
  candidates().map((enc) => row(enc)).sort((a, b) => {
    const aOpen = a.status !== 'Coded';
    const bOpen = b.status !== 'Coded';
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    if (aOpen && a.beyondSla !== b.beyondSla) return a.beyondSla ? -1 : 1;
    return String(a.releasedAt).localeCompare(String(b.releasedAt));
  });

/** The band an age falls in, as its index into bandLabels(). */
export function bandOf(ageDays) {
  const bands = config().ageBands || [1, 3, 7];
  const i = bands.findIndex((max) => ageDays <= max);
  return i === -1 ? bands.length : i;
}

export function bandLabels() {
  const bands = config().ageBands || [1, 3, 7];
  return bands.map((max, i) => (i === 0 ? `0–${max} d` : `${bands[i - 1] + 1}–${max} d`)).concat([`${bands[bands.length - 1] + 1}+ d`]);
}

/**
 * search(q, filters) over the worklist. `view` is 'all' or 'mine' (charts
 * assigned to the signed-in role); `band` is an index into bandLabels().
 */
export function search(q = '', {
  view = 'all', status = '', coder = '', department = '', type = '', band = '', from = '', to = '',
  beyondSla = false, awaiting = false, working = false,
} = {}) {
  const needle = q.trim().toLowerCase();
  const me = currentRole().id;
  return worklist().filter((r) => {
    if (view === 'mine' && r.assignedTo !== me) return false;
    if (status && r.status !== status) return false;
    if (coder && r.assignedTo !== coder) return false;
    if (department && r.department !== department) return false;
    if (type && r.type !== type) return false;
    if (band !== '' && band !== null && bandOf(r.ageDays) !== Number(band)) return false;
    // The three rail slices with no select of their own.
    if (beyondSla && !(r.status !== 'Coded' && r.beyondSla)) return false;
    if (awaiting && !(r.status === 'Unassigned' || r.status === 'Assigned')) return false;
    if (working && !(r.status === 'In Progress' || r.status === 'Recode Requested')) return false;
    const day = String(r.completedAt || r.releasedAt).slice(0, 10);
    if (from && compareDates(day, from) < 0) return false;
    if (to && compareDates(day, to) > 0) return false;
    if (!needle) return true;
    return r.no.toLowerCase().includes(needle)
      || r.patientMrn.toLowerCase().includes(needle)
      || (patients.get(r.patientMrn)?.nameEn || '').toLowerCase().includes(needle);
  });
}

/** The rail's figures over the whole worklist. */
export function counts(rows = worklist()) {
  return {
    awaiting: rows.filter((r) => r.status === 'Unassigned' || r.status === 'Assigned').length,
    beyondSla: rows.filter((r) => r.status !== 'Coded' && r.beyondSla).length,
    inProgress: rows.filter((r) => r.status === 'In Progress' || r.status === 'Recode Requested').length,
    queryPending: rows.filter((r) => r.status === 'Query Pending').length,
    coded: rows.filter((r) => r.status === 'Coded').length,
  };
}

// --- assignment ---------------------------------------------------------------

function blank(no) {
  const enc = encounters.get(no);
  const now = new Date().toISOString();
  return {
    id: no,
    encounterNo: no,
    status: 'Unassigned',
    assignedTo: null,
    versions: [],
    releasedAt: latestAt(releasedLines(no)) || enc?.endAt || now,
    completedAt: null,
    slaDays: slaFor(enc),
    assignments: [],
    recodeRequests: [],
    createdAt: now,
    updatedAt: now,
  };
}

function ensure(no) {
  let rec = get(no);
  if (!rec) {
    rec = blank(no);
    all().push(rec);
  }
  return rec;
}

/** Why a role may not hand this chart to a coder, or ''. */
export function assignBlocked(rec, role = currentRole()) {
  if (!role.canAssignCoding) return `${role.title} cannot assign charts — a coding supervisor does.`;
  if (rec?.status === 'Coded') return 'This chart is coded — there is nothing to assign.';
  return '';
}

export function assign(no, coderId, reason = '') {
  const role = currentRole();
  const rec = ensure(no);
  if (assignBlocked(rec, role) || !coderId) return null;
  const before = rec.assignedTo;
  rec.assignedTo = coderId;
  rec.assignments.push({ by: role.name, to: coderId, at: new Date().toISOString(), reason });
  if (rec.status === 'Unassigned') rec.status = 'Assigned';
  touch(rec, 'coding.assign');
  log(rec, before ? 'Reassigned' : 'Assigned',
    `${before ? `${coderName(before)} → ` : 'To '}${coderName(coderId)}${reason ? ` — ${reason}` : ''}`);
  return rec;
}

/** Why the signed-in role may not take this chart, or ''. */
export function selfAssignBlocked(rec, role = currentRole()) {
  if (!role.canCode) return `${role.title} cannot code a chart.`;
  if (rec?.status === 'Coded') return 'This chart is coded.';
  if (rec?.assignedTo === role.id) return 'This chart is already yours.';
  if (rec?.assignedTo && !role.canAssignCoding) return `Assigned to ${coderName(rec.assignedTo)} — ask a supervisor to reassign it.`;
  return '';
}

export function selfAssign(no) {
  const role = currentRole();
  const rec = ensure(no);
  if (selfAssignBlocked(rec, role)) return null;
  rec.assignedTo = role.id;
  rec.assignments.push({ by: role.name, to: role.id, at: new Date().toISOString(), reason: 'Self-assigned' });
  if (rec.status === 'Unassigned') rec.status = 'Assigned';
  touch(rec, 'coding.assign');
  log(rec, 'Self-assigned', role.name);
  return rec;
}

/** The chart goes back to the pool; the draft stays with it. */
export function releaseToPool(no) {
  const rec = get(no);
  const role = currentRole();
  if (!rec || !rec.assignedTo || rec.status === 'Coded') return null;
  if (rec.assignedTo !== role.id && !role.canAssignCoding) return null;
  const before = rec.assignedTo;
  rec.assignedTo = null;
  rec.assignments.push({ by: role.name, to: null, at: new Date().toISOString(), reason: 'Released to pool' });
  if (rec.status !== 'Query Pending' && rec.status !== 'Recode Requested') rec.status = 'Unassigned';
  touch(rec, 'coding.release');
  log(rec, 'Released to pool', `Was ${coderName(before)}`);
  return rec;
}

// --- the draft ----------------------------------------------------------------

/** Why the signed-in role may not edit this chart, or ''. */
export function editBlocked(rec, role = currentRole()) {
  if (!role.canCode) return `${role.title} cannot code a chart. An RCM coder does.`;
  if (rec?.status === 'Coded') return 'This chart is coded — Recode opens a new version.';
  if (rec?.status === 'Recode Requested') return 'A recode has been requested — Recode opens a new version to work in.';
  if (rec?.assignedTo && rec.assignedTo !== role.id && !role.canAssignCoding) {
    return `Assigned to ${coderName(rec.assignedTo)} — ask a supervisor to reassign it.`;
  }
  return '';
}

const cleanDx = (d) => ({
  code: String(d.code || '').toUpperCase().trim(),
  desc: d.desc || icd.get(d.code)?.desc || '',
  principal: Boolean(d.principal),
  poa: POA.includes(d.poa) ? d.poa : null,
});

const cleanPx = (p) => ({
  code: String(p.code || '').trim(),
  desc: p.desc || proc.get(p.code)?.desc || '',
  date: iso(p.date) || '',
  doctorId: p.doctorId || '',
  chargeLineIds: [...new Set((p.chargeLineIds || []).filter(Boolean))],
});

/**
 * Save the working copy. An unassigned chart becomes the saver's on the first
 * save — a coder who has typed a diagnosis has taken the chart, whatever the
 * worklist said a minute ago.
 */
export function saveDraft(no, { diagnoses = [], procedures = [], warningsAcknowledged = [] } = {}) {
  const role = currentRole();
  const rec = ensure(no);
  if (editBlocked(rec, role)) return null;
  if (!rec.assignedTo) {
    rec.assignedTo = role.id;
    rec.assignments.push({ by: role.name, to: role.id, at: new Date().toISOString(), reason: 'Self-assigned on first save' });
    log(rec, 'Self-assigned', `${role.name} — on first save`);
  }
  let v = currentVersion(rec);
  if (!v || v.codedAt) {
    v = { version: (v?.version || 0) + 1, diagnoses: [], procedures: [], warningsAcknowledged: [], codedAt: null, codedBy: null, reason: null };
    rec.versions.push(v);
  }
  v.diagnoses = diagnoses.map(cleanDx).filter((d) => d.code);
  v.procedures = procedures.map(cleanPx).filter((p) => p.code);
  v.warningsAcknowledged = warningsAcknowledged.filter((w) => w?.code && w?.reason).map((w) => ({ code: w.code, reason: w.reason }));
  if (rec.status !== 'Query Pending') rec.status = 'In Progress';
  touch(rec, 'coding.draft');
  log(rec, 'Draft saved', `${plural(v.diagnoses.length, 'diagnosis', 'diagnoses')}, ${plural(v.procedures.length, 'procedure')}`);
  return rec;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// --- validation ---------------------------------------------------------------

/**
 * What stands between this chart and Mark Coded. `draft` is the working copy
 * on screen when the workspace asks before saving; otherwise the stored
 * version is read. Blocking entries carry the section to jump to; warnings are
 * answered by an acknowledgment with a reason, and an unanswered one blocks.
 */
export function validate(no, draft = null) {
  const rec = get(no);
  const enc = encounters.get(no);
  const v = draft || currentVersion(rec) || { diagnoses: [], procedures: [], warningsAcknowledged: [] };
  const patient = patients.get(enc?.patientMrn);
  const lines = releasedLines(no);
  const blocking = [];
  const warnings = [];
  const block = (key, label, jumpTo) => blocking.push({ key, label, jumpTo });
  const warn = (key, label, jumpTo) => warnings.push({ key, label, jumpTo });

  const dxs = v.diagnoses || [];
  const pxs = v.procedures || [];
  if (!dxs.length) block('no-diagnosis', 'Add at least one diagnosis', 'diagnoses');
  const principals = dxs.filter((d) => d.principal).length;
  if (dxs.length && principals !== 1) block('principal', principals ? 'Only one diagnosis can be principal' : 'Choose the principal diagnosis', 'diagnoses');
  const seen = new Set();
  for (const d of dxs) {
    if (seen.has(d.code)) block(`dup:${d.code}`, `${d.code} is listed twice`, 'diagnoses');
    seen.add(d.code);
    if (enc?.type === 'IP' && !POA.includes(d.poa)) block(`poa:${d.code}`, `Set present on admission for ${d.code}`, 'diagnoses');
    const row = icd.get(d.code);
    if (!row) block(`unknown:${d.code}`, `${d.code} is not in the ICD-10 catalogue`, 'diagnoses');
    for (const why of sanity(row, patient)) warn(`sanity:${d.code}`, why, 'diagnoses');
    if (isUnspecified(row)) warn(`unspecified:${d.code}`, `${d.code} is unspecified — check the documentation for a more specific code`, 'diagnoses');
  }

  const linked = new Set(pxs.flatMap((p) => p.chargeLineIds || []));
  for (const line of lines.filter(isLinkable)) {
    if (!linked.has(line.id)) block(`line:${line.id}`, `Link “${line.description}” to a procedure`, 'lines');
  }
  const start = String(enc?.startAt || '').slice(0, 10);
  const end = String(enc?.endAt || todayIso()).slice(0, 10);
  for (const p of pxs) {
    const row = proc.get(p.code);
    if (!row) block(`unknown:${p.code}`, `${p.code} is not in the procedure catalogue`, 'procedures');
    if (!(p.chargeLineIds || []).length) block(`nolines:${p.code}`, `Link ${p.code} to at least one charge line`, 'procedures');
    if (!p.date) block(`date:${p.code}`, `Enter the date ${p.code} was performed`, 'procedures');
    else if (compareDates(p.date, start) < 0 || compareDates(p.date, end) > 0) {
      block(`date:${p.code}`, `${p.code} is dated outside the visit (${start} to ${end})`, 'procedures');
    }
    if (!p.doctorId) warn(`doctor:${p.code}`, `${p.code} names no performing doctor`, 'procedures');
    for (const why of sanity(row, patient)) warn(`sanity:${p.code}`, why, 'procedures');
  }

  const open = openQueries(no);
  if (open.length) block('queries', `${plural(open.length, 'query', 'queries')} still open with the physician`, 'queries');

  const acked = new Set((v.warningsAcknowledged || []).map((w) => w.code));
  const unanswered = warnings.filter((w) => !acked.has(w.key));
  if (unanswered.length) block('warnings', `Acknowledge or fix the ${plural(unanswered.length, 'warning')}`, 'warnings');

  return { blocking, warnings, acknowledged: acked, ok: blocking.length === 0 };
}

// --- coding -------------------------------------------------------------------

/** Mark the current version coded, or say what still blocks it. */
export function markCoded(no) {
  const role = currentRole();
  const rec = get(no);
  if (!rec || editBlocked(rec, role)) return { ok: false, blocking: [{ key: 'role', label: editBlocked(rec, role) || 'No chart to code' }] };
  const result = validate(no);
  if (!result.ok) return { ok: false, ...result };
  const v = currentVersion(rec);
  const now = new Date().toISOString();
  v.codedAt = now;
  v.codedBy = role.id;
  rec.status = 'Coded';
  rec.completedAt = now;
  for (const r of rec.recodeRequests) if (r.status === 'Open' || r.status === 'Accepted') r.status = 'Done';
  touch(rec, 'coding.coded');
  log(rec, 'Marked coded', `v${v.version} · ${plural(v.diagnoses.length, 'diagnosis', 'diagnoses')}, ${plural(v.procedures.length, 'procedure')}${v.reason ? ` — recode: ${v.reason}` : ''}`);
  for (const fn of afterCodedHooks) fn({ encounterNo: no, codingVersion: v });
  return { ok: true, version: v };
}

/** Why the signed-in role may not recode this chart, or ''. */
export function recodeBlocked(rec, role = currentRole()) {
  if (!role.canRecode) return `${role.title} cannot recode a chart.`;
  if (!rec || !lastCoded(rec)) return 'Nothing has been coded yet — there is no version to reopen.';
  if (rec.status !== 'Coded' && rec.status !== 'Recode Requested') return 'A new version is already open on this chart.';
  return '';
}

/**
 * Reopen a coded chart as a new version. The old one is kept as it was; the
 * new one starts as its copy, carries the reason, and is what the workspace
 * edits until it is marked coded in turn. The claim built on the old version
 * is told it is stale.
 */
export function recode(no, reason = '') {
  const role = currentRole();
  const rec = get(no);
  if (recodeBlocked(rec, role) || !reason) return null;
  const old = lastCoded(rec);
  const next = {
    version: old.version + 1,
    diagnoses: old.diagnoses.map((d) => ({ ...d })),
    procedures: old.procedures.map((p) => ({ ...p, chargeLineIds: [...p.chargeLineIds] })),
    warningsAcknowledged: old.warningsAcknowledged.map((w) => ({ ...w })),
    codedAt: null,
    codedBy: null,
    reason,
  };
  rec.versions.push(next);
  rec.status = 'In Progress';
  rec.completedAt = null;
  if (role.canCode) rec.assignedTo = role.id;
  for (const r of rec.recodeRequests) if (r.status === 'Open') r.status = 'Accepted';
  touch(rec, 'coding.recode');
  log(rec, 'Recode started', `v${old.version} → v${next.version} — ${reason}`);
  for (const fn of afterRecodeHooks) fn({ encounterNo: no, oldVersion: old, newVersion: next, reason });
  claims.markStale?.(no, reason);
  return rec;
}

/**
 * Somebody wants this chart looked at again — a denial routed back, a charge
 * that arrived after coding, a reviewer. Published for amendments 25 and 27.
 */
export function requestRecode(no, { source = 'Manual', ref = '', reason = '' } = {}) {
  if (!encounters.get(no) || !reason) return null;
  const rec = ensure(no);
  const n = all().reduce((m, r) => m + (r.recodeRequests || []).length, 0) + 1;
  const req = {
    id: `RCR-${String(n).padStart(4, '0')}`,
    source: RECODE_SOURCES.includes(source) ? source : 'Manual',
    ref,
    reason,
    at: new Date().toISOString(),
    by: currentRole().name,
    status: 'Open',
  };
  rec.recodeRequests.push(req);
  if (rec.status === 'Coded') rec.status = 'Recode Requested';
  touch(rec, 'coding.recodeRequest');
  log(rec, 'Recode requested', `${req.id} · ${req.source}${ref ? ` · ${ref}` : ''} — ${reason}`);
  return req;
}

export function dismissRecodeRequest(no, id, reason = '') {
  const rec = get(no);
  const req = rec?.recodeRequests.find((r) => r.id === id);
  if (!req || req.status !== 'Open' || !reason || !currentRole().canRecode) return null;
  req.status = 'Dismissed';
  req.dismissReason = reason;
  if (rec.status === 'Recode Requested' && !rec.recodeRequests.some((r) => r.status === 'Open')) rec.status = 'Coded';
  touch(rec, 'coding.recodeRequest');
  log(rec, 'Request dismissed', `${id} — ${reason}`);
  return req;
}

export const openRecodeRequests = (rec) => (rec?.recodeRequests || []).filter((r) => r.status === 'Open' || r.status === 'Accepted');

// --- CDI queries --------------------------------------------------------------

export function queriesAll() {
  all();
  return store.table(QUERIES);
}

export const getQuery = (id) => queriesAll().find((q) => q.id === id) || null;

/** Open or answered: still waiting on somebody. */
export const isQueryOpen = (q) => q?.status === 'Open' || q?.status === 'Answered';

const oldestFirst = (a, b) => String(a.raisedAt).localeCompare(String(b.raisedAt));

export const queriesFor = (no) => queriesAll().filter((q) => q.encounterNo === no).sort(oldestFirst);

export const openQueries = (no) => queriesFor(no).filter(isQueryOpen);

/** A physician's queue, oldest first; every physician's when no id is given. */
export const queriesForPhysician = (doctorId = '', { openOnly = true } = {}) =>
  queriesAll()
    .filter((q) => (!doctorId || q.physicianId === doctorId) && (!openOnly || isQueryOpen(q)))
    .sort(oldestFirst);

/** What the physicians' badge counts: questions nobody has answered yet. */
export const awaitingAnswer = () => queriesAll().filter((q) => q.status === 'Open');

/** Days from raised to answered — or to now while the physician still has it. */
export const queryTat = (q) => daysBetween(q.raisedAt, q.answeredAt || new Date().toISOString());

function nextQueryId() {
  const max = queriesAll().reduce((n, q) => Math.max(n, Number(String(q.id).replace('CDQ-', '')) || 0), 0);
  return `CDQ-${String(max + 1).padStart(4, '0')}`;
}

/** The chart follows its queries: with the physician while one is open. */
function syncQueryStatus(rec) {
  if (!rec || rec.status === 'Coded' || rec.status === 'Recode Requested') return;
  const waiting = queriesFor(rec.encounterNo).some((q) => q.status === 'Open');
  if (waiting) rec.status = 'Query Pending';
  else if (rec.status === 'Query Pending') rec.status = 'In Progress';
}

export function raiseQuery(no, { type, physicianId, question, refs = {} } = {}) {
  const role = currentRole();
  const rec = ensure(no);
  if (editBlocked(rec, role) || !QUERY_TYPES.includes(type) || !physicianId || !String(question || '').trim()) return null;
  const now = new Date().toISOString();
  const q = {
    id: nextQueryId(),
    encounterNo: no,
    type,
    physicianId,
    question: question.trim(),
    refs: { chargeLineIds: refs.chargeLineIds || [], docIds: refs.docIds || [] },
    status: 'Open',
    raisedBy: role.id,
    thread: [{ at: now, by: role.name, role: 'Coder', text: question.trim() }],
    raisedAt: now,
    answeredAt: null,
    resolvedAt: null,
  };
  queriesAll().push(q);
  if (!rec.assignedTo) rec.assignedTo = role.id;
  syncQueryStatus(rec);
  touch(rec, 'coding.query');
  log(rec, 'Query raised', `${q.id} · ${type} → ${doctorName(physicianId)}`);
  return q;
}

export function answerQuery(id, text) {
  const role = currentRole();
  const q = getQuery(id);
  if (!q || !role.isPhysician || q.status !== 'Open' || !String(text || '').trim()) return null;
  const now = new Date().toISOString();
  q.thread.push({ at: now, by: role.name, role: 'Physician', text: text.trim() });
  q.status = 'Answered';
  q.answeredAt = now;
  const rec = get(q.encounterNo);
  syncQueryStatus(rec);
  touch(rec, 'coding.query');
  log(rec, 'Query answered', `${q.id} · ${role.name}`);
  return q;
}

export function resolveQuery(id, note = '') {
  const role = currentRole();
  const q = getQuery(id);
  if (!q || !role.canCode || !isQueryOpen(q)) return null;
  const now = new Date().toISOString();
  if (note.trim()) q.thread.push({ at: now, by: role.name, role: 'Coder', text: note.trim() });
  q.status = 'Resolved';
  q.resolvedAt = now;
  const rec = get(q.encounterNo);
  syncQueryStatus(rec);
  touch(rec, 'coding.query');
  log(rec, 'Query resolved', `${q.id}${note.trim() ? ` — ${note.trim()}` : ''}`);
  return q;
}

export function reopenQuery(id, text) {
  const role = currentRole();
  const q = getQuery(id);
  if (!q || !role.canCode || q.status === 'Open' || q.status === 'Withdrawn' || !String(text || '').trim()) return null;
  const now = new Date().toISOString();
  q.thread.push({ at: now, by: role.name, role: 'Coder', text: text.trim() });
  q.status = 'Open';
  q.answeredAt = null;
  q.resolvedAt = null;
  const rec = get(q.encounterNo);
  syncQueryStatus(rec);
  touch(rec, 'coding.query');
  log(rec, 'Query reopened', `${q.id} — ${text.trim()}`);
  return q;
}

export function withdrawQuery(id, reason) {
  const role = currentRole();
  const q = getQuery(id);
  if (!q || !role.canCode || !isQueryOpen(q) || !String(reason || '').trim()) return null;
  const now = new Date().toISOString();
  q.thread.push({ at: now, by: role.name, role: 'Coder', text: `Withdrawn — ${reason.trim()}` });
  q.status = 'Withdrawn';
  q.resolvedAt = now;
  const rec = get(q.encounterNo);
  syncQueryStatus(rec);
  touch(rec, 'coding.query');
  log(rec, 'Query withdrawn', `${q.id} — ${reason.trim()}`);
  return q;
}

// --- metrics ------------------------------------------------------------------

/**
 * The four panels of the metrics screen, computed from the worklist and the
 * queries so a figure here is the count of rows on the worklist under the same
 * filter — backlog by age band and department, charts coded per day per coder
 * over the last fourteen days, open queries by physician, and turnaround with
 * the share inside SLA by visit type.
 */
export function metrics() {
  const rows = worklist();
  const open = rows.filter((r) => r.status !== 'Coded');
  const labels = bandLabels();
  const departments = [...new Set(open.map((r) => r.department))].sort();
  const backlog = departments.map((department) => {
    const cells = labels.map(() => 0);
    for (const r of open.filter((x) => x.department === department)) cells[bandOf(r.ageDays)] += 1;
    return { department, cells, total: cells.reduce((s, n) => s + n, 0) };
  });

  const days = Array.from({ length: 14 }, (_, i) => new Date(Date.now() - (13 - i) * DAY).toISOString().slice(0, 10));
  const versions = all().flatMap((rec) => rec.versions.filter((v) => v.codedAt).map((v) => ({ by: v.codedBy, day: String(v.codedAt).slice(0, 10) })));
  const coderIds = [...new Set([...CODERS.map((c) => c.id), ...versions.map((v) => v.by)])];
  const perCoder = coderIds.map((id) => {
    const counts = days.map((day) => versions.filter((v) => v.by === id && v.day === day).length);
    return { id, name: coderName(id), counts, total: counts.reduce((s, n) => s + n, 0) };
  });

  const physicianIds = [...new Set(queriesAll().map((q) => q.physicianId))];
  const queries = physicianIds.map((doctorId) => {
    const mine = queriesAll().filter((q) => q.physicianId === doctorId);
    const answered = mine.filter((q) => q.answeredAt);
    return {
      doctorId,
      name: doctorName(doctorId),
      open: mine.filter((q) => q.status === 'Open').length,
      answered: mine.filter((q) => q.status === 'Answered').length,
      total: mine.length,
      avgAnswerDays: answered.length ? answered.reduce((s, q) => s + queryTat(q), 0) / answered.length : null,
      oldestOpen: mine.filter((q) => q.status === 'Open').sort(oldestFirst)[0]?.raisedAt || null,
    };
  }).sort((a, b) => b.open - a.open || b.total - a.total);

  const coded = rows.filter((r) => r.status === 'Coded');
  const byType = Object.fromEntries(encounters.TYPES.map((type) => {
    const mine = coded.filter((r) => r.type === type);
    const within = mine.filter((r) => !r.beyondSla).length;
    return [type, {
      n: mine.length,
      avgDays: mine.length ? mine.reduce((s, r) => s + r.ageDays, 0) / mine.length : null,
      within,
      pct: mine.length ? within / mine.length : null,
      slaDays: config().slaDays?.[type] ?? 3,
    }];
  }));
  const tat = {
    n: coded.length,
    avgDays: coded.length ? coded.reduce((s, r) => s + r.ageDays, 0) / coded.length : null,
    within: coded.filter((r) => !r.beyondSla).length,
    pct: coded.length ? coded.filter((r) => !r.beyondSla).length / coded.length : null,
    byType,
  };

  return { backlog: { labels, rows: backlog, total: open.length }, perCoder: { days, coders: perCoder }, queries, tat };
}

// --- merge --------------------------------------------------------------------

// A chart hangs off the encounter and the encounter follows the patient on a
// merge, so nothing here moves; the trail is keyed on the encounter number too.

// --- internals ----------------------------------------------------------------

function touch(rec, reason) {
  rec.updatedAt = new Date().toISOString();
  store.commit(reason);
}

function log(rec, action, details) {
  audit.log({ entity: ENTITY, entityId: rec.encounterNo, action, details });
}

export const history = (no) => audit.forEntity(ENTITY, no);

// The register and its seeded trail exist before any screen reads them, the
// way the other self-seeding registers sweep on load: Recent activity on a
// dashboard that never opened a chart still shows what happened to one.
all();
