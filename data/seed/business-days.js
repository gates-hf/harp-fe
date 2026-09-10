// Seed — business days (Claima, amendment 34). Builds on first read of an
// empty table, after the registers it freezes have settled, rather than
// through data/store.js. Five days ending today, written as intents and
// produced by the engine: a hand-written snapshot of something that never
// ran would drift from the registers the moment any of them changed, so each
// closed day's version is `compute(date)` over the rows as they stand, in
// date order, each carrying the one before it as its opening.
//
// Four closed — the oldest three plain, one of them reopened by the CMO the
// next morning and re-closed as v2, and yesterday closed over one documented
// exception (the receipt a new cashier took before anybody had opened her a
// session) — and today open. The register's own trail is written with the
// times the closes happened at, not through audit.log().

import { ROLES } from '../../shared/roles.js';
import { todayIso } from '../../shared/format.js';
import { DAY_CLOSE_UTC, NIGHT_CASHIER, daysAgo } from './cash-sessions.js';

const CODER = ROLES.find((r) => r.id === 'coder').name;
const CMO = ROLES.find((r) => r.id === 'exec').name;

/** What a supervisor writes over a RED that is being closed rather than fixed. */
const NOTES = {
  cashIntegrity: (date) => `${NIGHT_CASHIER}’s first shift — the receipt was taken before a session had been opened for her; the drawer was counted by the supervisor at close on ${date} and agreed to the receipts on file`,
  payerPostingEquation: () => 'A remittance posted with an exception still open — the unmatched row is pending on the remittance workbench and will post when it is matched',
  openingMovementClosing: () => 'Opening balances carried from the last closed report; the gap is the register starting mid-month',
  writeoffReconciliation: () => 'Write-off posted on the register before the denial acknowledged it — reconciled by hand against the denial record',
  allSessionsClosed: () => 'Session left open at close — counted by the supervisor and closed the next morning',
};

/**
 * buildBusinessDays({ rows, blank, compute, dtrNoFor, log }) — fills `rows`.
 * `blank(date, openedAt)` is the repository's row shape, `compute(date)` its
 * live report (which reads `rows` as they are pushed, so each day sees the
 * one before it), `log(day, action, details, at, by)` its trail entry.
 */
export function buildBusinessDays({ rows, blank, compute, dtrNoFor, log }) {
  const today = todayIso();
  const stamp = (date, utc = DAY_CLOSE_UTC) => `${date}${utc}`;

  const closeAs = (day, by, at, reopenReason = null) => {
    const snapshot = compute(day.date);
    // Every RED the day is closed over carries a note, written before the
    // close so the version freezes it — yesterday's is the one the amendment
    // asks for; the earlier days are expected to have none.
    for (const check of snapshot.checks.filter((c) => c.status === 'RED' && !c.documented)) {
      const note = (NOTES[check.key] || (() => 'Closed over by the supervisor'))(day.date);
      day.exceptions.push({ checkKey: check.key, note, by, at: shift(at, -20) });
      check.documented = day.exceptions[day.exceptions.length - 1];
      log(day, 'Exception documented', `${check.label} — ${note}`, shift(at, -20), by);
    }
    snapshot.undocumentedReds = 0;
    const n = day.versions.length + 1;
    const version = { version: n, dtrNo: dtrNoFor(day.date, n), snapshot, closedAt: at, closedBy: by, reopenReason, exceptions: day.exceptions.map((e) => ({ ...e })) };
    day.versions.push(version);
    day.status = 'Closed';
    day.closedAt = at;
    day.closedBy = by;
    log(day, n === 1 ? 'Closed' : 'Re-closed', `${version.dtrNo} · ${snapshot.redCount} RED check${snapshot.redCount === 1 ? '' : 's'}${
      version.exceptions.length ? `, ${version.exceptions.length} documented` : ''}${reopenReason ? ` — ${reopenReason}` : ''}`, at, by);
    return version;
  };

  // Four days back to yesterday, oldest first, each opened at seven in the
  // morning Beirut time and closed at half past six in the evening.
  for (const n of [4, 3, 2, 1]) {
    const date = daysAgo(n, today);
    const day = blank(date, stamp(date, 'T04:00:00.000Z'));
    rows.splice(rows.findIndex((d) => d.date > date) === -1 ? rows.length : rows.findIndex((d) => d.date > date), 0, day);
    log(day, 'Opened', `Business day ${date}`, day.openedAt, CODER);
    closeAs(day, n === 2 ? CMO : CODER, stamp(date));

    if (n === 3) {
      // Reopened the next morning by the CMO — a payer's file that arrived
      // after close had been posted onto this date — and re-closed as v2.
      const next = daysAgo(2, today);
      const reason = `A remittance file received after close was posted onto ${date}; the report is re-run so the version on record carries the posting`;
      const reopenedAt = stamp(next, 'T06:10:00.000Z');
      day.reopenEvents.push({ at: reopenedAt, by: CMO, reason });
      day.status = 'Reopened';
      day.closedAt = null;
      day.closedBy = null;
      log(day, 'Reopened', `after ${day.versions[0].dtrNo} — ${reason}`, reopenedAt, CMO);
      closeAs(day, CMO, stamp(next, 'T06:25:00.000Z'), reason);
    }
  }

  // Today: open, being worked. A ledger hook may already have opened it.
  let day = rows.find((d) => d.date === today);
  if (!day) {
    day = blank(today, stamp(today, 'T04:00:00.000Z'));
    rows.push(day);
  } else {
    day.openedAt = stamp(today, 'T04:00:00.000Z');
  }
  log(day, 'Opened', `Business day ${today}`, day.openedAt, CODER);
  return rows;
}

function shift(iso, minutes) {
  return new Date(Date.parse(iso) + minutes * 60000).toISOString();
}
