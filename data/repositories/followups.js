// Repository — follow-ups. Owner: modules/claima (amendment 30). A follow-up
// is a call the desk made about a claim the payer has gone quiet on: when, by
// whom, how, to whom, what was said and when to call again. Append-only —
// there is no edit and no delete, because a record of a call is evidence, and
// the queue it feeds is computed on read (data/engines/claim-events.js) rather
// than kept here.
//
// Like the hand-offs, the seed derives from the generated claims, so
// data/store.js does not import it. It is not built on first read, though:
// the submission and remittance seeds move claims when they run, and a call
// seeded against a claim the payer then answers is a call about nothing — so
// data/engines/claim-events.js calls `seed()` once those registers have
// settled, and again after a reset. A follow-up logged in the browser lands in
// the same table and persists for the session.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as claims from './claims.js';
import { generateFollowups, describe, METHODS } from '../seed/followups.js';
import { current as currentRole } from '../../shared/roles.js';
import { iso, todayIso, compareDates } from '../../shared/format.js';

const TABLE = 'followups';

export { METHODS };

export const all = () => store.table(TABLE);

/**
 * The seeded calls and their trail, once into an empty table — the trail is
 * dated when the calls were made. Returns whether anything was written; the
 * commit is what redraws the queue and the badge that read an empty table.
 */
export function seed() {
  const rows = all();
  if (rows.length) return false;
  const { rows: seeded, trail } = generateFollowups();
  if (!seeded.length) return false;
  rows.push(...seeded);
  const entries = audit.all();
  for (const entry of trail) entries.push({ id: store.nextId('audit', 'AU-'), ...entry });
  store.commit('followups.seed');
  return true;
}

export const get = (id) => all().find((f) => f.id === id) || null;

/** Every call about one claim, oldest first — the order a timeline reads them in. */
export const byClaim = (claimNo) =>
  all().filter((f) => f.claimNo === claimNo).sort((a, b) => String(a.at).localeCompare(String(b.at)));

/** The most recent call about a claim, or null. */
export const latest = (claimNo) => byClaim(claimNo).slice(-1)[0] || null;

/**
 * When the next call on a claim is due, read off the latest follow-up — a
 * newer call that booked nothing clears an older booking, since the desk
 * decided that when it made the call.
 */
export const nextDue = (claimNo) => latest(claimNo)?.nextDueAt || null;

/** Whether a booked call is due on or before today. */
export const isDue = (claimNo, on = todayIso()) => {
  const due = nextDue(claimNo);
  return Boolean(due) && compareDates(due, on) <= 0;
};

/** Claim numbers with a call due on the day — the queue's third card. */
export const dueOn = (on = todayIso()) =>
  [...new Set(all().map((f) => f.claimNo))].filter((no) => compareDates(nextDue(no), on) === 0);

/** { total, claims, dueToday, overdue } over the register. */
export function counts(on = todayIso()) {
  const nos = [...new Set(all().map((f) => f.claimNo))];
  return {
    total: all().length,
    claims: nos.length,
    dueToday: nos.filter((no) => compareDates(nextDue(no), on) === 0).length,
    overdue: nos.filter((no) => nextDue(no) && compareDates(nextDue(no), on) < 0).length,
  };
}

// --- writes ----------------------------------------------------------------------

/**
 * log({ claimNo, method, contact, note, nextDueAt }) → the row, or null when
 * the claim is unknown or the method is not one of METHODS. Audited on the
 * claim itself — entity `claims`, the claim's id — so the claim's own history
 * and the timeline both carry the call.
 */
export function log({ claimNo, method, contact = '', note = '', nextDueAt = null } = {}, { commit = true } = {}) {
  const claim = claims.get(claimNo);
  if (!claim || !METHODS.includes(method)) return null;
  const row = {
    id: store.nextId(TABLE, 'FU-'),
    claimNo: claim.claimNo,
    at: new Date().toISOString(),
    by: currentRole().name,
    method,
    contact: String(contact || '').trim(),
    note: String(note || '').trim(),
    nextDueAt: iso(nextDueAt) || null,
  };
  all().push(row);
  if (commit) store.commit('followups.log');
  audit.log({ entity: 'claims', entityId: claim.id, action: 'Follow-up', details: describe(row) });
  return row;
}

/**
 * logMany(claimNos, fields) → the rows written. One call covering several
 * claims with the same payer — each claim gets its own row and its own trail
 * line, because each is chased on its own, in one commit.
 */
export function logMany(claimNos = [], fields = {}) {
  const rows = [];
  for (const claimNo of claimNos) {
    const row = log({ ...fields, claimNo }, { commit: false });
    if (row) rows.push(row);
  }
  if (rows.length) store.commit('followups.log');
  return rows;
}
