// Repository — feed events. Owner: modules/claima.
//
// The inbound side of charge capture: what the order system, the laboratory,
// the procedure log and the midnight census send, and what became of each.
// An event is Pending until a run captures it — through charges.capture(), the
// same call a manual charge goes through, so a fed line and a typed line are
// priced and posted the same way — and Failed when the capture refused it,
// with the refusal kept on the event so the health screen can say why.
//
// Nothing here prices anything. A run is a loop over Pending events and a row
// in the runs table saying when it happened and what it did; the feeds are
// simulated, so "Run feeds now" is the demo's stand-in for the interfaces.
//
// The dataset seeds itself on first read (data/seed/feeds.js): it reads the
// capture register to exist.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as charges from './charges.js';
import * as cdm from './cdm.js';
import { buildFeedEvents, buildFeedRuns, triggerOf } from '../seed/feeds.js';
import { iso, todayIso } from '../../shared/format.js';

const TABLE = 'feeds';
const RUNS = 'feedRuns';

/** The trail is keyed on the feed as a whole: one entry per run. */
const ENTITY = 'feeds';

export const TYPES = ['Order', 'Event', 'Procedure'];
export const TRIGGERS = ['OnOrder', 'OnCompletion', 'Midnight'];
export const STATUSES = ['Pending', 'Captured', 'Failed'];

export const TYPE_LABELS = { Order: 'Orders', Event: 'Events', Procedure: 'Procedures' };

export { triggerOf };

export function all() {
  const rows = store.table(TABLE);
  if (!rows.length) {
    rows.push(...buildFeedEvents());
    store.table(RUNS).push(...buildFeedRuns(rows));
  }
  return rows;
}

export const runs = () => {
  all();
  return store.table(RUNS);
};

export const get = (id) => all().find((row) => row.id === id) || null;

/** Oldest first — a queue is worked in the order it filled. */
export const pending = () => all().filter((row) => row.status === 'Pending').sort((a, b) => String(a.at).localeCompare(String(b.at)));

export const failed = () => all().filter((row) => row.status === 'Failed').sort((a, b) => String(b.at).localeCompare(String(a.at)));

export const pendingFor = (encounterNo) => pending().filter((row) => row.encounterNo === encounterNo);

export const lastRun = () => runs().slice().sort((a, b) => String(b.at).localeCompare(String(a.at)))[0] || null;

/**
 * One row per source for the health screen: what each feed has waiting, what
 * it captured today, what it could not, and when it last delivered anything.
 */
export function bySource(on = todayIso()) {
  const rows = all();
  return TYPES.map((type) => {
    const mine = rows.filter((row) => row.type === type);
    const captured = mine.filter((row) => row.status === 'Captured');
    return {
      type,
      label: TYPE_LABELS[type],
      triggers: [...new Set(mine.map((row) => row.trigger))],
      pending: mine.filter((row) => row.status === 'Pending').length,
      capturedToday: captured.filter((row) => iso(row.capturedAt) === on).length,
      captured: captured.length,
      failed: mine.filter((row) => row.status === 'Failed').length,
      lastCapturedAt: captured.map((row) => row.capturedAt).sort().pop() || null,
    };
  });
}

/** The rail-sized answer: what is waiting, what failed, when the feeds last ran. */
export function counts(on = todayIso()) {
  const rows = all();
  return {
    pending: rows.filter((row) => row.status === 'Pending').length,
    failed: rows.filter((row) => row.status === 'Failed').length,
    capturedToday: rows.filter((row) => row.status === 'Captured' && iso(row.capturedAt) === on).length,
    lastRunAt: lastRun()?.at || null,
  };
}

// --- the run --------------------------------------------------------------------

/**
 * Process everything Pending. Each event is captured through the register's
 * own capture — a feed's line is late, held, or priced at nothing under exactly
 * the rules a typed line is — and a refusal is kept on the event rather than
 * thrown away. One run row, one trail entry, whatever the count.
 */
export function run(by = 'System') {
  const queue = pending();
  const at = new Date().toISOString();
  const captured = [];
  const refused = [];

  for (const event of queue) {
    const item = cdm.get(event.itemId);
    const res = charges.capture(event.encounterNo, {
      itemId: event.itemId, qty: event.qty, dateOfService: event.dateOfService,
    }, { type: event.type, ref: event.ref, capturedBy: 'System' });
    if (res.error) {
      Object.assign(event, { status: 'Failed', error: res.error, processedAt: at });
      refused.push(event);
    } else {
      Object.assign(event, { status: 'Captured', capturedLineId: res.line.id, capturedAt: at, error: null, processedAt: at });
      captured.push(event);
    }
    event.itemLabel = item ? `${item.chargeCode} — ${cdm.label(item)}` : event.itemId;
  }

  const row = { id: store.nextId(RUNS, 'FR-'), at, by, pending: queue.length, captured: captured.length, failed: refused.length };
  runs().push(row);
  store.commit('feeds.run');
  audit.log({
    entity: ENTITY, entityId: 'feeds', action: 'Run',
    details: `${queue.length} pending — ${captured.length} captured, ${refused.length} failed`,
    user: by,
  });
  return { at, captured, failed: refused, run: row };
}

/** A failed event put back in the queue — after the charge master was fixed. */
export function retry(id) {
  const event = get(id);
  if (!event || event.status !== 'Failed') return null;
  Object.assign(event, { status: 'Pending', error: null, processedAt: null });
  store.commit('feeds.retry');
  return event;
}

export const history = () => audit.forEntity(ENTITY, 'feeds');
