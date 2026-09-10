// Repository — business days and the daily transaction report. Owner:
// modules/claima (amendment 34).
//
// A business day is the register's answer to "what happened at the desk
// today": Open while the day is being worked, Closed once its report is
// frozen, Reopened when somebody with the right to has unlocked it again. A
// close writes a version — the whole report as JSON, numbered DTR-YYYY-DDDD-vN
// — and a re-close writes the next; every version is kept. Nothing here holds
// a total: `compute(date)` builds one world of posted rows from ten registers
// and hands it to data/engines/dtr-engine.js, and a closed day's report is
// read back from its stored version and never recomputed.
//
// What a close changes is where a later posting lands. The ledger's
// afterAppend hook below tags a row whose own date is already closed with
// `priorDay: { postedOn, originalDate }` — the next open day carries it,
// flagged, and the original date never changes — and hands a cash row to the
// cashier's open session the moment it is taken. `dtr.today()` is what the
// module home reads.
//
// Reads every register the report sums over and the sessions; none of them
// reads this file. The engine is a leaf, so importing it here forms no cycle.
// The table seeds itself once the claim repository's peers have settled
// (data/seed/business-days.js), because four of the registers it freezes seed
// the same way, and again after a reset.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as ledger from './ledger.js';
import * as charges from './charges.js';
import * as encounters from './encounters.js';
import * as batches from './batches.js';
import * as claims from './claims.js';
import * as nullifications from './nullifications.js';
import * as remittances from './remittances.js';
import * as unapplied from './unapplied.js';
import * as denials from './denials.js';
import * as writeoffs from './writeoffs.js';
import * as handoffs from './handoffs.js';
import * as payers from './payers.js';
import * as patients from './patients.js';
import * as cdm from './cdm.js';
import * as cashSessions from './cash-sessions.js';
import * as engine from '../engines/dtr-engine.js';
import { CONFIG } from '../../shared/config.js';
import { current as currentRole } from '../../shared/roles.js';
import { compareDates, todayIso } from '../../shared/format.js';
import { buildBusinessDays } from '../seed/business-days.js';

const TABLE = 'businessDays';
const ENTITY = 'businessDays';

export const STATUSES = ['Open', 'Closed', 'Reopened'];
export const { SECTIONS, CHECKS, CATEGORIES, METHODS } = engine;
export { csvOf, checkTone } from '../engines/dtr-engine.js';

const FLAGS = () => CONFIG.claima?.dtr?.roles || {};
export const closeFlag = () => FLAGS().canCloseDay || 'canCloseDay';
export const reopenFlag = () => FLAGS().canReopenDay || 'canReopenDay';
export const exceptionFlag = () => FLAGS().canDocumentException || 'canDocumentException';

// --- reads ------------------------------------------------------------------------------

let seeding = false;

export const all = () => store.table(TABLE);

export const get = (date) => all().find((d) => d.date === date) || null;

export const isClosed = (date) => get(date)?.status === 'Closed';

/** Newest first. */
export const list = () => [...all()].sort((a, b) => compareDates(b.date, a.date));

export const history = (date) => audit.forEntity(ENTITY, date);

export const latestVersion = (day) => day?.versions?.[day.versions.length - 1] || null;

export const dtrNoFor = (date, version) => `DTR-${date.slice(0, 4)}-${String(dayOfYear(date)).padStart(4, '0')}-v${version}`;

/**
 * Today's row — the day being worked. Created on first touch, without a
 * commit: a read never notifies, and the row is rebuilt identically if the
 * tab reloads before anything else is written.
 */
export function current(on = todayIso()) {
  let row = get(on);
  if (!row) {
    row = blank(on);
    all().push(row);
  }
  return row;
}

/**
 * The earliest day on or after `date` that is not closed — where a late
 * posting lands. With today closed and nothing open after it, that is
 * tomorrow, opened here: a posting after the close has to land somewhere.
 */
export function nextOpenDay(date) {
  const open = all().filter((d) => d.status !== 'Closed' && compareDates(d.date, date) >= 0).sort((a, b) => compareDates(a.date, b.date))[0];
  if (open) return open.date;
  let d = compareDates(date, todayIso()) > 0 ? date : todayIso();
  while (isClosed(d)) d = plusDays(d, 1);
  return current(d).date;
}

const previousDayOf = (date) => all().filter((d) => compareDates(d.date, date) < 0).sort((a, b) => compareDates(b.date, a.date))[0] || null;

/** The latest version of the most recent closed day before `date`, with its number. */
export function priorSnapshotOf(date) {
  const day = all().filter((d) => d.status === 'Closed' && compareDates(d.date, date) < 0).sort((a, b) => compareDates(b.date, a.date))[0];
  const v = latestVersion(day);
  return v ? { ...v.snapshot, dtrNo: v.dtrNo } : null;
}

/** The one world the engine reads: every register's rows, never a stored total. */
export function world(date) {
  const role = currentRole();
  const prev = previousDayOf(date);
  const row = get(date);
  return {
    date,
    previousDay: prev ? { date: prev.date, status: prev.status } : null,
    priorSnapshot: priorSnapshotOf(date),
    exceptions: row?.exceptions || [],
    sessions: cashSessions.onDate(date),
    ledger: ledger.all(),
    charges: charges.all().map((r) => ({ ...r, department: encounters.get(r.encounterNo)?.department || '—' })),
    batches: batches.all().map((b) => ({ ...b, value: batches.valueOf(b) })),
    nullifications: nullifications.all(),
    remittances: remittances.all(),
    unapplied: unapplied.all(),
    denials: denials.all(),
    writeoffs: writeoffs.all(),
    handoffs: handoffs.all().map((h) => ({ ...h, claimNo: claims.get(h.claimId)?.claimNo || h.claimId })),
    writeoffTotals: writeoffs.postedTotals({ from: date, to: date }),
    names: {
      patient: (mrn) => patients.view(patients.get(mrn), role)?.nameEn || mrn || '—',
      payer: (id) => payers.get(id)?.nameEn || id || '—',
      item: (id) => cdm.get(id)?.chargeCode || id,
      claimValue: (no) => cents(claims.get(no)?.totals?.payerShare),
      denialWrittenOff: (id) => cents(denials.get(id)?.amounts?.writtenOff),
    },
  };
}

/** compute(date) → the live report for that day. */
export const compute = (date) => engine.compute(world(date));

/** report(date) → the frozen version of a closed day, else the live report. */
export function report(date, version = null) {
  const day = get(date);
  if (day?.status === 'Closed' || version) {
    const v = version ? day?.versions?.find((x) => x.version === Number(version)) : latestVersion(day);
    if (v) return { ...v.snapshot, dtrNo: v.dtrNo, version: v.version, frozen: true, closedAt: v.closedAt, closedBy: v.closedBy, reopenReason: v.reopenReason };
  }
  return { ...compute(date), dtrNo: null, version: null, frozen: false };
}

/** dtr.today() → the compact shape the module home reads. */
export const today = () => engine.compact(compute(current().date), current());

/** The transactions behind a cell — the same selector the row was built from. */
export const drill = (d) => engine.select(world(d?.filter?.date || current().date), d);

/** The archive: every day with a version, newest first. */
export const archive = () => list().filter((d) => d.versions.length).map((d) => ({ ...d, latest: latestVersion(d) }));

/**
 * The month's closed days rolled up per section and category, latest version
 * each. Informational: a sum of snapshots, not a report anybody closes.
 */
export function mtd(on = todayIso()) {
  const month = on.slice(0, 7);
  const days = list().filter((d) => d.status === 'Closed' && d.date.startsWith(month) && d.versions.length).sort((a, b) => compareDates(a.date, b.date));
  const sections = SECTIONS.map((def) => {
    const cats = CATEGORIES[def.key].map(([key, label]) => ({ key, label, movement: 0, count: 0 }));
    let total = 0;
    let count = 0;
    for (const d of days) {
      const s = latestVersion(d).snapshot.sections.find((x) => x.key === def.key);
      if (!s) continue;
      total = cents(total + s.total);
      count += s.count;
      for (const c of cats) {
        const sc = s.categories.find((x) => x.key === c.key);
        c.movement = cents(c.movement + (sc?.movement || 0));
        c.count += s.rows.filter((r) => r.category === c.key).reduce((n, r) => n + r.count, 0);
      }
    }
    return { key: def.key, label: def.label, totalLabel: def.totalLabel, total, count, categories: cats };
  });
  return { month, from: days[0]?.date || null, to: days[days.length - 1]?.date || null, days: days.length, sections };
}

// --- writes ---------------------------------------------------------------------------

/** Why the day cannot close, or ''. */
export function closeBlocker(date, role = currentRole()) {
  const day = get(date);
  if (!day) return `No business day ${date}`;
  if (day.status === 'Closed') return 'This day is already closed';
  if (!role[closeFlag()]) return `${role.name} cannot close the day — a role with day-close rights can`;
  const open = cashSessions.counts(date).open;
  if (open) return `${open} cash session${open === 1 ? ' is' : 's are'} still open`;
  const r = compute(date);
  if (r.undocumentedReds) return `${r.undocumentedReds} RED check${r.undocumentedReds === 1 ? '' : 's'} not fixed or documented`;
  return '';
}

/** closeDay(date) → { error, day, version }. Freezes the report as the next version and locks the day. */
export function closeDay(date, { at = null, by = null, role = currentRole() } = {}) {
  const why = closeBlocker(date, role);
  if (why) return { error: why, day: get(date), version: null };
  const day = get(date);
  const when = at || new Date().toISOString();
  const who = by || role.name;
  const n = day.versions.length + 1;
  const version = {
    version: n, dtrNo: dtrNoFor(date, n), snapshot: compute(date), closedAt: when, closedBy: who,
    reopenReason: day.status === 'Reopened' ? day.reopenEvents[day.reopenEvents.length - 1]?.reason || null : null,
    exceptions: day.exceptions.map((e) => ({ ...e })),
  };
  day.versions.push(version);
  day.status = 'Closed';
  day.closedAt = when;
  day.closedBy = who;
  log(day, n === 1 ? 'Closed' : 'Re-closed', `${version.dtrNo} · ${version.snapshot.redCount} RED check${version.snapshot.redCount === 1 ? '' : 's'}${
    version.exceptions.length ? `, ${version.exceptions.length} documented` : ''}${version.reopenReason ? ` — ${version.reopenReason}` : ''}`, when, who);
  store.commit('businessDays.close');
  return { error: '', day, version };
}

export function reopenBlocker(date, role = currentRole()) {
  const day = get(date);
  if (!day) return `No business day ${date}`;
  if (day.status !== 'Closed') return 'This day is not closed';
  if (!role[reopenFlag()]) return `${role.name} cannot reopen a closed day — a role with reopen rights can`;
  return '';
}

/** reopenDay(date, reason) → { error, day }. The day is worked again; its next close is the next version. */
export function reopenDay(date, reason = '', { at = null, by = null, role = currentRole() } = {}) {
  const why = reopenBlocker(date, role);
  if (why) return { error: why, day: get(date) };
  if (!String(reason).trim()) return { error: 'Say why the day is being reopened', day: get(date) };
  const day = get(date);
  const when = at || new Date().toISOString();
  const who = by || role.name;
  day.reopenEvents.push({ at: when, by: who, reason: String(reason).trim() });
  day.status = 'Reopened';
  day.closedAt = null;
  day.closedBy = null;
  log(day, 'Reopened', `after ${latestVersion(day)?.dtrNo} — ${String(reason).trim()}`, when, who);
  store.commit('businessDays.reopen');
  return { error: '', day };
}

/** documentException(date, checkKey, note) → { error, day }. One note per check; it persists into the next version. */
export function documentException(date, checkKey, note = '', { at = null, by = null, role = currentRole() } = {}) {
  const day = get(date);
  if (!day) return { error: `No business day ${date}`, day: null };
  if (day.status === 'Closed') return { error: 'A closed day takes no note — reopen it first', day };
  if (!role[exceptionFlag()]) return { error: `${role.name} cannot document an exception — a role with that right can`, day };
  if (!CHECKS.some((c) => c.key === checkKey)) return { error: 'No such check', day };
  if (!String(note).trim()) return { error: 'Write the note', day };
  const when = at || new Date().toISOString();
  const who = by || role.name;
  day.exceptions = day.exceptions.filter((e) => e.checkKey !== checkKey);
  day.exceptions.push({ checkKey, note: String(note).trim(), by: who, at: when });
  log(day, 'Exception documented', `${CHECKS.find((c) => c.key === checkKey).label} — ${String(note).trim()}`, when, who);
  store.commit('businessDays.exception');
  return { error: '', day };
}

// --- the ledger hook -------------------------------------------------------------------

/**
 * Every ledger row, the moment it is appended. A row dated on a day that is
 * closed — or on a day before the current one that was never opened — is
 * carried by the next open day and flagged prior-day; a cash row joins its
 * cashier's open session on the day it is reported on, or stays loose for
 * the cash-integrity check to name.
 */
function onLedgerAppend(row) {
  const d = String(row.at).slice(0, 10);
  let tagged = false;
  // Only once the register holds a closed day: a row appended while the
  // registers are still seeding is history being written, not a late posting.
  // A row dated on a closed day, or before the register on a day it never
  // opened, is carried by the next open day.
  const live = all().some((x) => x.status === 'Closed');
  const beforeRegister = compareDates(d, current().date) < 0 && !get(d);
  if (!row.priorDay && live && (isClosed(d) || beforeRegister)) {
    row.priorDay = { postedOn: nextOpenDay(d), originalDate: d };
    tagged = true;
  }
  let joined = null;
  if (engine.isCashRow(row)) joined = cashSessions.attach(row.id, row.by, engine.ledgerDay(row));
  if (tagged && !joined) store.commit('ledger.priorDay');
}
ledger.afterAppendHooks.push(onLedgerAppend);
cashSessions.openGuards.push((date) => (isClosed(date) ? `Business day ${date} is closed — no session can open on it` : ''));

// --- seed --------------------------------------------------------------------------------

/**
 * Once, into an empty table, after the registers the report freezes have
 * settled — the nullification, denial and write-off seeds all run behind the
 * claim repository's peers. Runs again after a reset. Returns whether it wrote.
 */
export function seed() {
  if (seeding || all().some((d) => d.versions.length)) return false;
  seeding = true;
  try {
    for (const mod of [charges, batches, nullifications, remittances, unapplied, denials, writeoffs, handoffs]) mod.all();
    cashSessions.all();
    buildBusinessDays({ rows: all(), blank, compute, dtrNoFor, log });
    store.commit('businessDays.seed');
  } finally {
    seeding = false;
  }
  return true;
}

const PEERS = () => [claims.peersReady, nullifications.ready, denials.peersReady, writeoffs.peersReady];
const settle = () => Promise.allSettled(PEERS()).then(() => new Promise((r) => setTimeout(r, 0)));

export const ready = settle().then(seed);
store.subscribe((reason) => { if (reason === 'reset') settle().then(seed); });

// --- internals ---------------------------------------------------------------------------

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;

function blank(date, openedAt = null) {
  return { date, status: 'Open', openedAt: openedAt || new Date().toISOString(), closedAt: null, closedBy: null, versions: [], reopenEvents: [], exceptions: [] };
}

function plusDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dayOfYear(date) {
  const d = new Date(`${date}T00:00:00Z`);
  return Math.round((d - new Date(Date.UTC(d.getUTCFullYear(), 0, 1))) / 86400000) + 1;
}

function log(day, action, details, at = null, by = null) {
  audit.all().push({
    id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: day.date, action, details,
    user: by || currentRole().name, at: at || new Date().toISOString(),
  });
}
