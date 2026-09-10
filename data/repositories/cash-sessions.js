// Repository — cash sessions. Owner: modules/claima (amendment 34).
//
// A session is one cashier's drawer for one business day: opened, filled by
// the receipts the ledger hands it as they are taken, and closed against what
// the desk counted. The system totals are never typed — they are the sum of
// the ledger rows attached to the session, computed by data/engines/
// dtr-engine.js the same way the daily report reads them, and frozen onto the
// row only at close, when the session becomes immutable and its receipts are
// locked. A variance is what the count says against that; a non-zero one
// needs a reason and, past the threshold, a second person's signature.
//
// Reads the ledger, which never reads this file. The business-day repository
// pushes into `openGuards` (a closed day takes no session) and calls `attach`
// from the ledger's afterAppend hook; this file knows nothing about days.
// The table seeds itself on first read (data/seed/cash-sessions.js).

import { store } from '../store.js';
import * as audit from './audit.js';
import * as ledger from './ledger.js';
import { CONFIG } from '../../shared/config.js';
import { ROLES, current as currentRole } from '../../shared/roles.js';
import { todayIso, usd } from '../../shared/format.js';
import { METHODS, cashEffect, isCashRow, ledgerDay, systemTotals as totalsOf } from '../engines/dtr-engine.js';
import { buildCashSessions } from '../seed/cash-sessions.js';

const TABLE = 'cashSessions';
const ENTITY = 'cashSessions';

export const STATUSES = ['Open', 'Closed'];
export { METHODS };

export const threshold = () => Number(CONFIG.claima?.dtr?.sessionVarianceCountersignThreshold ?? 50);
export const countersignFlag = () => CONFIG.claima?.dtr?.roles?.canCountersign || 'canCountersign';

/** Guards the day's owner pushes: (date) → '' or why no session may open on that day. */
export const openGuards = [];

let seeding = false;

export function all() {
  const rows = store.table(TABLE);
  if (!rows.length && !seeding) {
    seeding = true;
    try { buildCashSessions({ rows, nextId, ledger }); } finally { seeding = false; }
  }
  return rows;
}
store.subscribe((reason) => { if (reason === 'reset') seeding = false; });

export const get = (id) => all().find((s) => s.id === id) || null;

/** One day's sessions, in the order they were opened. */
export const onDate = (date = todayIso()) => all().filter((s) => s.date === date).sort(byOpened);

export const openFor = (cashier, date = todayIso()) => onDate(date).find((s) => s.cashier === cashier && s.status === 'Open') || null;

export const history = (id) => audit.forEntity(ENTITY, id);

/** The cash rows attached to a session, in ledger order. */
export const receiptsOf = (session) => ledger.all().filter((r) => (session?.txIds || []).includes(r.id)).sort((a, b) => a.seq - b.seq);

/** Per method — frozen on a closed session, live on an open one. */
export const systemTotals = (session) => (session?.status === 'Closed' && session.systemTotals ? session.systemTotals : totalsOf(session, ledger.all()));

export const totalOf = (totals = {}) => cents(METHODS.reduce((n, m) => n + (Number(totals[m]) || 0), 0));

/** What the count says against the system: per method and in all. */
export function varianceOf(session, declared = {}) {
  const system = systemTotals(session);
  const v = Object.fromEntries(METHODS.map((m) => [m, cents((Number(declared[m]) || 0) - (system[m] || 0))]));
  v.total = totalOf(v);
  return v;
}

/** Cash rows on a day that sit in no session — the cash-integrity offenders. */
export function unattached(date = todayIso()) {
  const ids = new Set(onDate(date).flatMap((s) => s.txIds));
  return ledger.all().filter((r) => isCashRow(r) && ledgerDay(r) === date && !ids.has(r.id));
}

export function counts(date = todayIso()) {
  const rows = onDate(date);
  return {
    total: rows.length,
    open: rows.filter((s) => s.status === 'Open').length,
    closed: rows.filter((s) => s.status === 'Closed').length,
    withVariance: rows.filter((s) => s.variance && s.variance.total !== 0).length,
    unattached: unattached(date).length,
  };
}

/** Who may countersign a variance: a role with the flag, other than the people named. */
export const countersigners = (exclude = []) => ROLES.filter((r) => r[countersignFlag()] && !exclude.includes(r.name));

export function nextId(year = new Date().getFullYear()) {
  const prefix = `CS-${year}-`;
  const max = store.table(TABLE).reduce((n, row) => {
    if (!String(row.id).startsWith(prefix)) return n;
    const digits = Number(String(row.id).slice(prefix.length));
    return Number.isFinite(digits) && digits > n ? digits : n;
  }, 867);
  return prefix + String(max + 1).padStart(6, '0');
}

// --- writes ---------------------------------------------------------------------------

/** Why a session cannot open for this cashier on this day, or ''. */
export function openBlocker(cashier, date = todayIso()) {
  if (!String(cashier || '').trim()) return 'Name the cashier';
  for (const guard of openGuards) { const why = guard(date); if (why) return why; }
  if (openFor(cashier, date)) return `${cashier} already has an open session on ${date}`;
  return '';
}

/** open(cashier, date) → { error, session }. */
export function open(cashier = currentRole().name, date = todayIso(), { at = null, by = null } = {}) {
  const why = openBlocker(cashier, date);
  if (why) return { error: why, session: null };
  const when = at || new Date().toISOString();
  const row = {
    id: nextId(Number(date.slice(0, 4)) || new Date().getFullYear()),
    date, cashier, openedAt: when, closedAt: null, status: 'Open',
    systemTotals: null, declared: null, variance: null, varianceReason: null, countersign: null,
    txIds: [], receiptNos: [],
  };
  all().push(row);
  log(row, 'Opened', `${cashier} · ${date}`, when, by);
  store.commit('cashSessions.open');
  return { error: '', session: row };
}

/**
 * attach(ref, cashier, date) → the session the receipt joined, or null when
 * the cashier has no open session on that day — which is what the daily
 * report's cash-integrity check then says. `ref` is a ledger transaction id
 * or a receipt number; the cashier defaults to whoever the ledger says took
 * the money, the day to the business day the row is reported on.
 */
export function attach(ref, cashier = null, date = null, { at = null, by = null } = {}) {
  const tx = ledger.get(ref) || (ledger.receipt(ref) ? ledger.get(ledger.receipt(ref).txId) : null);
  if (!tx || !isCashRow(tx)) return null;
  const session = openFor(cashier || tx.by, date || ledgerDay(tx));
  if (!session) return null;
  if (session.txIds.includes(tx.id)) return session;
  session.txIds.push(tx.id);
  const receiptNo = tx.detail?.receiptNo || ledger.receiptOf(tx.id)?.receiptNo || null;
  if (receiptNo) session.receiptNos.push(receiptNo);
  log(session, 'Receipt attached', `${receiptNo || tx.id} · ${usd(cashEffect(tx))}${tx.priorDay ? ` · taken ${tx.priorDay.originalDate}` : ''}`, at, by);
  store.commit('cashSessions.attach');
  return session;
}

/** The fix for a receipt in no session: open the cashier's session if need be, then attach. */
export function attachOrOpen(ref, { by = null } = {}) {
  const tx = ledger.get(ref);
  if (!tx) return { error: `No transaction ${ref}`, session: null };
  const date = ledgerDay(tx);
  let session = openFor(tx.by, date);
  if (!session) {
    const opened = open(tx.by, date, { by });
    if (opened.error) return opened;
    session = opened.session;
  }
  const joined = attach(tx.id, tx.by, date, { by });
  return joined ? { error: '', session: joined } : { error: 'The receipt could not be attached', session };
}

/**
 * Why a session cannot close with this count, or ''. Every method declared,
 * a reason for any variance, and a countersignature past the threshold from a
 * role that holds it — somebody other than the cashier and the closer.
 */
export function closeBlocker(session, { declared = {}, reason = '', countersignBy = '' } = {}, closer = currentRole().name) {
  if (!session) return 'No such session';
  if (session.status !== 'Open') return 'This session is already closed';
  for (const m of METHODS) {
    const v = declared[m];
    if (v === '' || v == null || !Number.isFinite(Number(v)) || Number(v) < 0) return `Declare the ${m.toLowerCase()} counted`;
  }
  const v = varianceOf(session, declared);
  if (v.total !== 0 && !String(reason).trim()) return `Say why the count is ${usd(Math.abs(v.total))} ${v.total < 0 ? 'short' : 'over'}`;
  if (Math.abs(v.total) > threshold()) {
    const who = countersigners([session.cashier, closer]).find((r) => r.name === countersignBy);
    if (!countersignBy) return `A variance above ${usd(threshold())} needs a countersignature`;
    if (!who) return `${countersignBy} cannot countersign this session`;
  }
  return '';
}

/** close(id, { declared, reason, countersignBy }) → { error, session }. Closed is final. */
export function close(id, form = {}, { at = null, by = null } = {}) {
  const session = get(id);
  const closer = by || currentRole().name;
  const why = closeBlocker(session, form, closer);
  if (why) return { error: why, session };
  const when = at || new Date().toISOString();
  session.systemTotals = systemTotals(session);
  session.declared = Object.fromEntries(METHODS.map((m) => [m, cents(form.declared[m])]));
  session.variance = varianceOf(session, session.declared);
  session.varianceReason = session.variance.total !== 0 ? String(form.reason).trim() : null;
  session.countersign = Math.abs(session.variance.total) > threshold() ? { by: form.countersignBy, at: when } : null;
  session.closedAt = when;
  session.status = 'Closed';
  log(session, 'Closed', `${usd(totalOf(session.systemTotals))} system · ${usd(totalOf(session.declared))} declared · variance ${usd(session.variance.total)}${
    session.varianceReason ? ` — ${session.varianceReason}` : ''}${session.countersign ? ` · countersigned by ${session.countersign.by}` : ''}`, when, closer);
  store.commit('cashSessions.close');
  return { error: '', session };
}

// --- internals ------------------------------------------------------------------------

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;
const byOpened = (a, b) => String(a.openedAt).localeCompare(String(b.openedAt)) || a.id.localeCompare(b.id);

function log(row, action, details, at = null, by = null) {
  audit.all().push({
    id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: row.id, action, details,
    user: by || currentRole().name, at: at || new Date().toISOString(),
  });
}
