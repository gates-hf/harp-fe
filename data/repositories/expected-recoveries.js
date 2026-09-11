// Repository — expected recoveries. Owner: modules/defensio (amendment 39,
// F4 — appeal tracking & resolution). One row per conceded share of an
// appeal outcome: what the payer said it would pay back on one denial, and
// whether the cash has landed. Defensio never posts cash — a row moves to
// Recovered or Shortfall only when Claima's remittance posting hook, which
// this file subscribes to, matches a posting on the appealed claim's lines
// to it.
//
// Row: { id ('ER-0001'), appealCaseId, denialId, claimId, claimNo, lineRefs[],
// concededAmount, state (AwaitingRemittance | Recovered | Shortfall),
// recoveredAmount, remittanceRef, agingFrom, shortfall { how ('accept' |
// 'writeOff'), reason, writeoffId, at, by } | null, audit[] (the row's own
// trail, append-only, mirrored to the shared audit entity) }.
//
// The table is seeded by the tracking repository's seed (the cases and
// their outcomes come first); this file keeps the entity, its writes and the
// posting-hook match, and tells the tracking repository which cases moved
// through `afterMatchHooks`.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as remittances from './remittances.js';
import { current as currentRole } from '../../shared/roles.js';
import { iso, todayIso, usd } from '../../shared/format.js';
import { RECOVERY_STATES, cents, isAging, recoveryAge } from '../engines/appeal-resolution.js';

const TABLE = 'expectedRecoveries';
const ENTITY = 'expectedRecoveries';

export const STATES = RECOVERY_STATES;

export const all = () => store.table(TABLE);
export const get = (id) => all().find((r) => r.id === id) || null;
export const byCase = (appealCaseId) => all().filter((r) => r.appealCaseId === appealCaseId);
export const byDenial = (denialId) => all().filter((r) => r.denialId === denialId);
export const byClaim = (claimNo) => all().filter((r) => r.claimNo === claimNo);
export const open = () => all().filter((r) => r.state === 'AwaitingRemittance');
/** A shortfall nobody has answered yet — accepted, or sent to the write-off loop. */
export const unansweredShortfalls = () => all().filter((r) => r.state === 'Shortfall' && !r.shortfall);
export const history = (id) => audit.forEntity(ENTITY, id);
export { recoveryAge, isAging };

export function counts(on = todayIso()) {
  const rows = all();
  const awaiting = rows.filter((r) => r.state === 'AwaitingRemittance');
  const sum = (list, f) => cents(list.reduce((n, r) => n + (Number(f(r)) || 0), 0));
  return {
    total: rows.length,
    awaiting: awaiting.length,
    awaitingValue: sum(awaiting, (r) => r.concededAmount),
    aging: awaiting.filter((r) => isAging(r, on)).length,
    agingValue: sum(awaiting.filter((r) => isAging(r, on)), (r) => r.concededAmount),
    shortfalls: unansweredShortfalls().length,
    recoveredValue: sum(rows, (r) => r.recoveredAmount),
  };
}

/**
 * create({ appealCaseId, denialId, claimId, claimNo, lineRefs, concededAmount,
 * agingFrom }, { at, by, commit }) → the row, AwaitingRemittance. One row per
 * (case, denial): a second call hands the first back.
 */
export function create(data = {}, { at = null, by = null, commit = true } = {}) {
  const existing = all().find((r) => r.appealCaseId === data.appealCaseId && r.denialId === data.denialId);
  if (existing) return existing;
  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  const row = {
    id: store.nextId(TABLE, 'ER-'),
    appealCaseId: data.appealCaseId,
    denialId: data.denialId || null,
    claimId: data.claimId || null,
    claimNo: data.claimNo || null,
    lineRefs: [...(data.lineRefs || [])].filter(Boolean),
    concededAmount: cents(data.concededAmount),
    state: 'AwaitingRemittance',
    recoveredAmount: 0,
    remittanceRef: null,
    agingFrom: iso(data.agingFrom) || iso(when),
    shortfall: null,
    audit: [],
    createdAt: when,
    createdBy: who,
    updatedAt: when,
  };
  all().push(row);
  log(row, 'Created', `${usd(row.concededAmount)} conceded on ${row.denialId} · ${row.claimNo}${row.lineRefs.length ? ` · ${row.lineRefs.join(', ')}` : ''} — awaiting the remittance from ${row.agingFrom}`, when, who);
  if (commit) store.commit('appealTracking.recovery');
  return row;
}

/**
 * recordRecovery(id, { amount, remittanceRef, at, by }) → the row. What the
 * posting hook found on the claim: the conceded amount or more is Recovered,
 * less is a Shortfall carrying what did come. A row already answered is left
 * alone — a later posting is Claima's to explain.
 */
export function recordRecovery(id, { amount, remittanceRef = null, at = null, by = null, commit = true } = {}) {
  const row = get(id);
  if (!row || row.state !== 'AwaitingRemittance') return row;
  const got = cents(amount);
  if (got <= 0) return row;
  const when = at || new Date().toISOString();
  row.recoveredAmount = cents(Math.min(row.concededAmount, got));
  row.remittanceRef = remittanceRef;
  row.state = row.recoveredAmount >= row.concededAmount - 0.005 ? 'Recovered' : 'Shortfall';
  row.updatedAt = when;
  log(row, row.state === 'Recovered' ? 'Recovered' : 'Shortfall',
    `${usd(row.recoveredAmount)} of ${usd(row.concededAmount)} posted on ${remittanceRef || 'a remittance'}${row.state === 'Shortfall' ? ` — ${usd(row.concededAmount - row.recoveredAmount)} short` : ''}`, when, by);
  if (commit) store.commit('appealTracking.recovery');
  return row;
}

/**
 * answerShortfall(id, { how: 'accept' | 'writeOff', reason, writeoffId }) →
 * the row or { error }. The gap between what was conceded and what came is
 * accepted with a reason or sent to the write-off loop; the row stays a
 * Shortfall and the case's ledger moves the gap to that bucket.
 */
export function answerShortfall(id, { how, reason = '', writeoffId = null } = {}, { at = null, by = null, commit = true } = {}) {
  const row = get(id);
  if (!row) return { error: 'No such expected recovery' };
  if (row.state !== 'Shortfall') return { error: 'Only a shortfall is answered this way' };
  if (row.shortfall) return { error: `Already ${row.shortfall.how === 'accept' ? 'accepted' : 'in the write-off loop'}` };
  if (how !== 'accept' && how !== 'writeOff') return { error: 'Accept the shortfall or write it off' };
  if (how === 'accept' && !String(reason || '').trim()) return { error: 'Say why the shortfall is being accepted' };
  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  row.shortfall = { how, reason: String(reason || '').trim(), writeoffId: writeoffId || null, at: when, by: who };
  row.updatedAt = when;
  const gap = cents(row.concededAmount - row.recoveredAmount);
  log(row, how === 'accept' ? 'Shortfall accepted' : 'Shortfall to write-off', `${usd(gap)}${writeoffId ? ` · ${writeoffId}` : ''}${row.shortfall.reason ? ` — ${row.shortfall.reason}` : ''}`, when, who);
  if (commit) store.commit('appealTracking.recovery');
  return row;
}

/** Days waiting is what the row shows; `chase` only records that somebody asked. */
export function noteChase(id, note = '', { at = null, by = null, commit = true } = {}) {
  const row = get(id);
  if (!row) return null;
  const when = at || new Date().toISOString();
  row.updatedAt = when;
  log(row, 'Chased', String(note || '').trim() || 'The payer was asked for the remittance', when, by);
  if (commit) store.commit('appealTracking.recovery');
  return row;
}

function log(row, action, details, at, by) {
  const entry = { action, details, at: at || new Date().toISOString(), by: by || currentRole().name };
  row.audit.push(entry);
  audit.all().push({ id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: row.id, action, details, user: entry.by, at: entry.at });
}

// --- the remittance hook ----------------------------------------------------------------

/** Pushed by the tracking repository: called with { caseIds, remittanceNo, reversed, at } after a match. */
export const afterMatchHooks = [];

/**
 * Claima's posting hook: a posting on an appealed claim is matched to the
 * open expected recoveries on it — by line where the denial named one, by
 * the whole posting otherwise — and each becomes Recovered or Shortfall. A
 * reversal puts a row matched to that remittance back to waiting.
 */
function onRemittancePosted(event = {}) {
  const touched = new Set();
  store.batch(() => {
    for (const claimNo of event.claimNos || []) {
      const mine = byClaim(claimNo);
      if (!mine.length) continue;
      if (event.reversed) {
        for (const r of mine.filter((x) => x.remittanceRef === event.remittanceNo && !x.shortfall)) {
          r.state = 'AwaitingRemittance'; r.recoveredAmount = 0; r.remittanceRef = null; r.updatedAt = event.at || new Date().toISOString();
          log(r, 'Reversed', `The posting on ${event.remittanceNo} was reversed — waiting again`, r.updatedAt);
          touched.add(r.appealCaseId);
        }
        continue;
      }
      const posting = remittances.byClaim(claimNo).find((p) => p.remittanceNo === event.remittanceNo);
      if (!posting) continue;
      for (const r of mine.filter((x) => x.state === 'AwaitingRemittance')) {
        const lines = r.lineRefs.length ? posting.lines.filter((l) => r.lineRefs.includes(l.lineId)) : posting.lines;
        const paid = cents(lines.reduce((n, l) => n + (Number(l.paid) || 0), 0));
        if (paid <= 0) continue;
        recordRecovery(r.id, { amount: paid, remittanceRef: event.remittanceNo, at: event.at, commit: false });
        touched.add(r.appealCaseId);
      }
    }
    if (!touched.size) return;
    for (const fn of afterMatchHooks) {
      try { fn({ caseIds: [...touched], remittanceNo: event.remittanceNo, reversed: Boolean(event.reversed), at: event.at || null }); } catch (e) { console.warn('[expected-recoveries] hook failed', e); }
    }
    store.commit('appealTracking.recovery');
  });
}
remittances.afterPostHooks?.push(onRemittancePosted);
