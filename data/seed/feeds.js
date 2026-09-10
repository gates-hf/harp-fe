// Seed — feed events. Owner: modules/claima.
//
// A feed event is what an order system, a laboratory, a procedure log or the
// midnight census sends the capture desk: this visit, this item, this many, on
// this date. Most of the register is read back off the capture lines that
// already carry a feed reference — an event that was captured is the line's
// provenance, and the two must name the same reference — and six are still
// Pending, so "Run feeds now" has something to do: two bed-nights, two results,
// one procedure, and one order for a charge the master has retired, which is
// the one that fails.
//
// data/store.js does not import this file: it reads the capture register to
// exist. data/repositories/feeds.js builds on first read of an empty table.

import * as charges from '../repositories/charges.js';
import * as encounters from '../repositories/encounters.js';
import * as cdm from '../repositories/cdm.js';
import { CONFIG } from '../../shared/config.js';
import { iso, todayIso } from '../../shared/format.js';

/** When each feed fires, by the charge master's category — the config's map. */
export const triggerOf = (category) => CONFIG.claima.capture.triggers[category] || 'OnCompletion';

/**
 * What is still waiting. [visit, code, qty, days before today, reference] —
 * the visit is found on the board by patient and type, since the register
 * hands the numbers out.
 */
const PENDING = [
  // The census: last night in intensive care, and today's bed on the surgical ward.
  [{ mrn: 'MRN-000105', type: 'IP' }, 'RNB-0004', 1, 1, 'ADT-CENSUS-ICU'],
  [{ mrn: 'MRN-000103', type: 'IP' }, 'RNB-0001', 1, 0, 'ADT-CENSUS-3B'],
  // Two results filed this morning.
  [{ mrn: 'MRN-000105', type: 'IP' }, 'LAB-0003', 1, 0, 'EVT-2026-018733'],
  [{ mrn: 'MRN-000103', type: 'OP' }, 'LAB-0001', 1, 0, 'EVT-2026-018741'],
  // The dressing logged in the emergency room.
  [{ mrn: 'MRN-000110', type: 'ER' }, 'PRC-0001', 1, 0, 'PROC-2026-000412'],
  // A scan ordered against a line the charge master has retired: the feed
  // sends it anyway, and the run is what says no.
  [{ mrn: 'MRN-000116', type: 'OP' }, 'RAD-0006', 1, 0, 'EVT-2026-004440'],
];

export function buildFeedEvents() {
  const rows = [];
  let n = 0;
  const id = () => `FE-${String((n += 1)).padStart(4, '0')}`;
  const today = todayIso();

  // --- what the feeds already sent: the lines that carry their reference -----
  for (const line of charges.all()) {
    if (line.source.type === 'Manual' || !line.source.ref) continue;
    const item = cdm.get(line.itemId);
    rows.push({
      id: id(),
      type: line.source.type,
      ref: line.source.ref,
      encounterNo: line.encounterNo,
      itemId: line.itemId,
      qty: line.qty,
      dateOfService: line.dateOfService,
      trigger: triggerOf(item?.category),
      status: 'Captured',
      capturedLineId: line.id,
      at: line.createdAt,
      capturedAt: line.createdAt,
      error: null,
    });
  }

  // --- what is still waiting --------------------------------------------------
  for (const [where, code, qty, daysAgo, ref] of PENDING) {
    const enc = encounters.all().find((row) => row.patientMrn === where.mrn && row.type === where.type && row.status === 'Active');
    const item = cdm.all().find((row) => row.chargeCode === code);
    if (!enc || !item) continue;
    const dos = clamp(shiftDate(today, -daysAgo), iso(enc.startAt), today);
    const trigger = triggerOf(item.category);
    rows.push({
      id: id(),
      type: charges.sourceTypeOf(item.category),
      ref: ref.startsWith('ADT') ? `${ref}-${dos}` : ref,
      encounterNo: enc.no,
      itemId: item.id,
      qty,
      dateOfService: dos,
      trigger,
      status: 'Pending',
      capturedLineId: null,
      at: trigger === 'Midnight' ? `${dos}T23:59:00.000Z` : hoursAgo(1 + (n % 4)),
      capturedAt: null,
      error: null,
    });
  }

  return rows;
}

/** One run this morning, so the panel has a last run before the demo clicks. */
export function buildFeedRuns(events) {
  const at = `${todayIso()}T06:00:00.000Z`;
  const captured = events.filter((row) => row.status === 'Captured' && iso(row.capturedAt) === todayIso()).length;
  return [{ id: 'FR-0001', at, by: 'System', pending: captured, captured, failed: 0 }];
}

// --- internals ----------------------------------------------------------------

const hoursAgo = (hours) => new Date(Date.now() - hours * 3600000).toISOString();

const shiftDate = (day, days) => new Date(Date.parse(`${day}T00:00:00.000Z`) + days * 86400000).toISOString().slice(0, 10);

const clamp = (day, from, to) => (day < from ? from : day > to ? to : day);
