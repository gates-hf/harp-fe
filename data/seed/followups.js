// Seed — follow-ups. The calls the desk has already made on claims the payer
// has gone quiet on. Owned by modules/claima (amendment 30).
//
// The claims are generated, so the seeded follow-ups are picked off the
// generated set rather than written against numbers that would drift: the
// oldest claim still with each payer, five payers deep. Those are the rows the
// follow-up queue opens on, so the seed puts a call against each — one logged
// and due again today, one overdue, one with two calls behind it, one due
// later this week and one whose next call was never booked.
//
// Like the hand-offs it derives from repositories, so data/store.js does not
// import it: data/repositories/followups.js builds on first read of an empty
// table, and the register's own trail is written with the times the calls
// happened at rather than through audit.log().

import * as claims from '../repositories/claims.js';
import * as audit from '../repositories/audit.js';
import { todayIso, compareDates } from '../../shared/format.js';

export const METHODS = ['Phone', 'Portal', 'Email', 'Visit'];

/** How long a claim has to have been with the payer to be worth chasing here. */
const QUIET_DAYS = 30;

/**
 * Per picked claim, the calls made — `daysAgo` before today, `due` days from
 * today for the next one (null when none was booked). Contacts are the payer's
 * own desk: the names are what a caller writes down.
 */
const PLAN = [
  [
    { daysAgo: 12, method: 'Phone', by: 'Tarek Solh', contact: 'Rima Haddad — claims desk',
      note: 'Batch received and logged; the file is with the medical reviewer. Asked to call back in a week.', due: -5 },
    { daysAgo: 5, method: 'Portal', by: 'Tarek Solh', contact: 'Payer portal — claim status page',
      note: 'Still shows "Under review". No reviewer note attached. Will phone the desk.', due: 0 },
  ],
  [
    { daysAgo: 9, method: 'Email', by: 'Georges Khoury', contact: 'claims@ — payer mailbox',
      note: 'Sent a status request with the batch reference and the discharge summary attached. No reply yet.', due: -2 },
  ],
  [
    { daysAgo: 3, method: 'Phone', by: 'Tarek Solh', contact: 'Nabil Karam — provider relations',
      note: 'Confirmed the claim is in the payment run for the end of the month. Diary a check after the run.', due: 4 },
  ],
  [
    { daysAgo: 15, method: 'Visit', by: 'Georges Khoury', contact: 'Provider relations, head office',
      note: 'Raised with the account manager at the monthly meeting; they will pull the file.', due: 1 },
  ],
  [
    { daysAgo: 1, method: 'Phone', by: 'Tarek Solh', contact: 'Switchboard — no answer from the claims desk',
      note: 'Rang twice, no answer. Left a message with the claim number.', due: null },
  ],
];

/**
 * generateFollowups() → { rows, trail }. `rows` are the register's own; `trail`
 * are the audit entries for them, one per call, stamped when the call was
 * made and against the claim it was made about.
 */
export function generateFollowups() {
  const today = todayIso();
  // Only a claim nobody has touched since it was generated: the submission
  // and remittance seeds write a trail on the claims they move, and a call
  // logged against one of those would be a call about a claim the payer has
  // since answered.
  const untouched = (c) => !audit.forEntity('claims', c.id).length;
  const quiet = claims.all()
    .filter((c) => claims.isPending(c) && c.submittedAt && daysBetween(c.submittedAt, today) >= QUIET_DAYS && untouched(c))
    .sort((a, b) => compareDates(a.submittedAt, b.submittedAt) || a.claimNo.localeCompare(b.claimNo));

  // The oldest claim with each payer, in the order the payers went quiet.
  const picked = [];
  const seen = new Set();
  for (const claim of quiet) {
    if (seen.has(claim.payerId)) continue;
    seen.add(claim.payerId);
    picked.push(claim);
    if (picked.length === PLAN.length) break;
  }

  const rows = [];
  const trail = [];
  picked.forEach((claim, i) => {
    for (const call of PLAN[i]) {
      const n = rows.length + 1;
      const at = `${shift(today, -call.daysAgo)}T${String(9 + (n % 7)).padStart(2, '0')}:${String(15 + n * 5).padStart(2, '0')}:00.000Z`;
      const row = {
        id: `FU-${String(n).padStart(4, '0')}`,
        claimNo: claim.claimNo,
        at,
        by: call.by,
        method: call.method,
        contact: call.contact,
        note: call.note,
        nextDueAt: call.due == null ? null : shift(today, call.due),
      };
      rows.push(row);
      trail.push({
        entity: 'claims',
        entityId: claim.id,
        action: 'Follow-up',
        user: call.by,
        at,
        details: describe(row),
      });
    }
  });
  return { rows, trail };
}

/** The one line the trail carries for a call — the repository writes the same for a live one. */
export function describe(row) {
  return `${row.method} · ${row.contact} — ${row.note}${row.nextDueAt ? ` · next due ${row.nextDueAt}` : ''}`;
}

const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
const shift = (isoDate, days) => new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
