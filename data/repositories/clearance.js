// Repository — financial clearance. Owner: modules/frontis.
//
// It owns no table. Clearance is derived, so what this file holds is the wiring
// the derivation needs: it runs data/engines/clearance-engine.js over the open
// encounters, writes the answer onto each as a stamp, and audits the moves —
// only the moves, because a status that recomputes to the same thing forty
// times a session is not forty events.
//
// It sits here rather than in data/repositories/encounters.js because the
// engine reads six repositories and three of them reach the encounter register
// through their own seeds: an import from encounters.js into the engine would
// close a cycle. So encounters.js keeps `stampClearance`, the dumb writer that
// decides nothing, and the deciding is done from here.
//
// Every screen that shows a clearance answer reads it through `indicator()`, so
// the board's chip, the encounter header and this feature's own worklist cannot
// disagree about what Blocked looks like.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as encounters from './encounters.js';
import * as patients from './patients.js';
import {
  compute, ITEM_KEYS, ITEM_LABELS, STATUSES, shortStatus, statusTone,
} from '../engines/clearance-engine.js';
import { CONFIG } from '../../shared/config.js';
import { compareDates, todayIso } from '../../shared/format.js';

export { STATUSES, statusTone, shortStatus, ITEM_KEYS, ITEM_LABELS };

/** The trail is keyed on the encounter: a clearance move is a fact about a visit. */
const ENTITY = 'encounters';

/** The set the sweep recomputes: the visits money can still be collected on. */
const inScope = (enc) => encounters.isOpen(enc);

// --- reading ------------------------------------------------------------------

export const stampOf = (enc) => enc?.clearance || { status: 'Not started', items: [], blocking: [] };

export const statusOf = (enc) => stampOf(enc).status || 'Not started';

/** One item off a visit's stamp, by key, or null when it was never computed. */
export const itemOf = (enc, key) => (stampOf(enc).items || []).find((item) => item.key === key) || null;

/**
 * Whether one item is still somebody's job. Passed and N/A are settled — never
 * asked is a different answer from failed, and neither is work.
 */
export function itemOutstanding(enc, key) {
  const item = itemOf(enc, key);
  return Boolean(item) && (item.state === 'Pending' || item.state === 'Failed');
}

/** Clearance work: the two answers that hold a visit up. */
export const needsAttention = (enc) =>
  statusOf(enc) === 'Blocked' || statusOf(enc) === 'Conditionally Cleared';

/**
 * What every screen draws a clearance answer from — the chip's word, its tone,
 * the icon beside a header line, and the whole answer for the tooltip.
 */
export function indicator(enc) {
  const stamp = stampOf(enc);
  const status = stamp.status || 'Not started';
  const blocking = stamp.blocking || [];
  const detail = blocking.length ? ` — ${blocking.join('; ')}` : '';
  if (status === 'Cleared') {
    return { status, short: 'Cleared', icon: 'check_circle', tone: 'success', label: 'Financially cleared' };
  }
  if (status === 'Blocked') {
    return { status, short: 'Blocked', icon: 'block', tone: 'critical', label: `Clearance blocked${detail}` };
  }
  if (status === 'Conditionally Cleared') {
    return {
      status, short: 'Conditional', icon: 'pending', tone: 'warning',
      label: `Conditionally cleared${detail}`,
    };
  }
  return { status, short: 'Not started', icon: 'radio_button_unchecked', tone: '', label: 'Clearance not computed yet' };
}

/** Hours the oldest unsettled item has been outstanding, or null when none is. */
export function hoursPending(enc, on = Date.now()) {
  const since = stampOf(enc).pendingSince;
  if (!since) return null;
  const at = Date.parse(since);
  return Number.isFinite(at) ? Math.max(0, (on - at) / 3600000) : null;
}

/** Outstanding longer than the desk's own patience — the red on the worklist. */
export const isOverdue = (enc) =>
  (hoursPending(enc) ?? 0) > CONFIG.clearance.pendingAgeWarnHours;

/** Worst first, then longest waiting: the order the desk works the list in. */
const RANK = { Blocked: 0, 'Conditionally Cleared': 1, Cleared: 2, 'Not started': 3 };

/**
 * search(q, filters) — the worklist's one query. `scope` is the toggle: the
 * work ('attention') or the whole board ('all'). `q` matches the encounter
 * number, the MRN and the patient's name — what is written on a wristband.
 */
export function search(q = '', {
  scope = 'attention', status = '', type = '', department = '', financial = '',
  item = '', from = '', to = '', overdue = false,
} = {}) {
  const needle = String(q).trim().toLowerCase();
  return encounters
    .all()
    .filter((enc) => {
      if (!inScope(enc)) return false;
      if (scope === 'attention' && !needsAttention(enc)) return false;
      // Time pending has no control of its own on the screen: how long a visit
      // has been waiting is a fact about the clock, not a filter a clerk picks,
      // so the card that counts them is their only control.
      if (overdue && !isOverdue(enc)) return false;
      if (status && statusOf(enc) !== status) return false;
      // The item filter is the desk's other question: not "how bad is this
      // visit" but "who is waiting on eligibility".
      if (item && !itemOutstanding(enc, item)) return false;
      if (type && enc.type !== type) return false;
      if (department && enc.department !== department) return false;
      if (financial === 'self' && enc.financial?.payerId) return false;
      if (financial && financial !== 'self' && enc.financial?.payerId !== financial) return false;
      const day = String(enc.startAt).slice(0, 10);
      if (from && compareDates(day, from) < 0) return false;
      if (to && compareDates(day, to) > 0) return false;
      if (!needle) return true;
      return [enc.no, enc.patientMrn, patients.get(enc.patientMrn)?.nameEn]
        .some((v) => String(v || '').toLowerCase().includes(needle));
    })
    .sort((a, b) =>
      (RANK[statusOf(a)] ?? 9) - (RANK[statusOf(b)] ?? 9)
      || String(stampOf(a).pendingSince || '9999').localeCompare(String(stampOf(b).pendingSince || '9999'))
      || String(a.startAt).localeCompare(String(b.startAt)));
}

/**
 * The rail's four figures, read off whatever list the worklist is showing so a
 * card's number and the row count under it are one figure. "Cleared today" is
 * today's own arrivals, not everything ever cleared — a number that only grows
 * says nothing at a glance.
 */
export function counts(rows = openEncounters()) {
  const today = todayIso();
  return {
    blocked: rows.filter((enc) => statusOf(enc) === 'Blocked').length,
    conditional: rows.filter((enc) => statusOf(enc) === 'Conditionally Cleared').length,
    clearedToday: rows.filter(
      (enc) => statusOf(enc) === 'Cleared' && String(enc.startAt).slice(0, 10) === today).length,
    overdue: rows.filter(isOverdue).length,
  };
}

export const openEncounters = () => encounters.all().filter(inScope);

/**
 * The two slices the Frontis dashboard counts, each one literally the rows the
 * worklist shows at the link behind the card — `?status=` and `?item=`.
 */
export const byStatus = (status) => search('', { scope: 'all', status });

export const outstandingItem = (key) => search('', { scope: 'all', item: key });

// --- the sweep ----------------------------------------------------------------

/** Guards the sweep against the commit it makes itself. */
let sweeping = false;

/**
 * Recompute one encounter and stamp it. Returns the stamp, or null when there
 * is no such encounter. Normally nobody calls this by hand — the Recompute
 * button on the clearance view does, which is what makes "it is computed"
 * demonstrable rather than merely claimed.
 */
export function refreshClearance(no, { on = todayIso(), commit = true } = {}) {
  const enc = encounters.get(no);
  if (!enc) return null;
  const changed = stamp(enc, on);
  if (changed && commit) store.commit('clearance.refresh');
  return stampOf(encounters.get(no));
}

/**
 * Recompute every open encounter — around thirty rows, each five reads. It runs
 * on load and after any write to the six registers clearance is derived from,
 * which is what makes regression automatic: nothing has to remember to ask.
 */
export function refreshAll({ on = todayIso() } = {}) {
  if (sweeping) return 0;
  sweeping = true;
  let changed = 0;
  try {
    for (const enc of encounters.all()) {
      if (!inScope(enc)) continue;
      if (stamp(enc, on)) changed += 1;
    }
    // Committed inside the guard on purpose: the commit notifies every screen,
    // and one of the subscribers is this sweep. With the flag still up it
    // returns at once, so a write costs one pass rather than two.
    if (changed) store.commit('clearance.refresh');
  } finally {
    sweeping = false;
  }
  return changed;
}

/**
 * One encounter's stamp. Writes only when the answer moved, and audits only
 * when the *status* moved — an item's wording changing under an unchanged
 * status is not an event the desk needs in the trail. The first computation on
 * a visit is not a transition either: there was no previous answer to move from.
 */
function stamp(enc, on) {
  const answer = compute(enc, { on });
  const next = {
    status: answer.status,
    items: answer.items.map(compact),
    blocking: answer.blocking,
    pendingSince: answer.pendingSince,
    computedAt: new Date().toISOString(),
  };
  const before = enc.clearance || {};
  if (before.computedAt && same(before, next)) return false;

  encounters.stampClearance(enc.no, next);
  if (before.computedAt && before.status !== next.status) {
    audit.log({
      entity: ENTITY,
      entityId: enc.no,
      action: 'Clearance',
      details: `Clearance: ${before.status} → ${next.status}${moveReason(before, next)}`,
    });
  }
  return true;
}

/**
 * What is kept on the encounter. Everything the board, the worklist and the
 * checklist draw, and nothing else — the engine's item carries its action as
 * two fields, so keeping it costs nothing and saves every reader recomputing
 * where a Failed item is answered.
 */
const compact = (item) => ({
  key: item.key, label: item.label, state: item.state, short: item.short,
  detail: item.detail, since: item.since, action: item.action || null,
});

/** Two stamps say the same thing when the status and every item state match. */
function same(before, next) {
  if (before.status !== next.status) return false;
  if ((before.items || []).length !== next.items.length) return false;
  return next.items.every((item, i) => {
    const was = before.items[i];
    return was && was.key === item.key && was.state === item.state && was.detail === item.detail;
  });
}

/**
 * " (payment / deposit passed)" — the item whose move carried the status with
 * it, which is the sentence the trail is read for. A stamp that carried no
 * items to compare against — the one the seed writes as of yesterday — names
 * what the new status rests on instead.
 */
function moveReason(before, next) {
  const was = new Map((before.items || []).map((item) => [item.key, item.state]));
  const moved = was.size ? next.items.filter((item) => was.get(item.key) !== item.state) : [];
  if (!moved.length) return next.blocking.length ? ` (${next.blocking.join(', ')})` : '';
  const words = moved.map((item) => {
    const label = String(ITEM_LABELS[item.key] || item.key).toLowerCase();
    if (item.state === 'Passed') return `${label} passed`;
    if (item.state === 'N/A') return `${label} no longer required`;
    return `${label} ${item.state === 'Failed' ? 'failed' : 'outstanding'}`;
  });
  return ` (${words.join(', ')})`;
}

// --- wiring -------------------------------------------------------------------

// Anything written anywhere can change a clearance answer — a check run, a
// referral linked, a decision captured, an estimate issued, a signature taken,
// a deposit collected. Rather than each of those learning what clearance is,
// the sweep runs after every commit that is not its own. Thirty encounters of
// five reads is cheaper than six registers each remembering to tell somebody.
store.subscribe((reason) => {
  if (reason === 'clearance.refresh') return;
  refreshAll();
});

// The board and the encounter page read the stamp, so it has to exist before
// any screen renders — the way the expiry sweeps do.
refreshAll();
