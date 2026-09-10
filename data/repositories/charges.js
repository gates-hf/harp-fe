// Repository — charge capture lines. Owner: modules/claima.
//
// A capture line is the record of one charge arriving on a visit: from a feed
// (an order, a filed result, a logged procedure, the midnight census) or by
// hand, priced the moment it lands and posted to the patient ledger through the
// same act the accounts desk posts with. The line then waits — Unreleased, or
// Held with a reason — until it is released to billing, which is the moment
// the coding and claims features take it up through the hook arrays below.
//
// Nothing here prices anything and nothing here writes money: pricing is
// data/engines/account-engine.js and the write is accounts.postCharges(), so a
// captured charge, a posted charge and a quoted charge are one answer. A
// correction is what the ledger already makes it — a Reversal row and, for an
// edit, a fresh capture pointing back at the line it replaces; a line is never
// edited in place once it carries a ledger transaction.
//
// The dataset seeds itself on first read (data/seed/charges.js) rather than
// through data/store.js: it reads the ledger, the board and the charge master
// to exist — the shape data/seed/ledger.js and data/seed/claims.js already use.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as ledger from './ledger.js';
import * as encounters from './encounters.js';
import * as cdm from './cdm.js';
import * as accounts from './accounts.js';
import { postCharge } from '../engines/account-engine.js';
import { buildCharges, buildChargeTrail, sourceTypeOf, traceOf } from '../seed/charges.js';
import { CONFIG } from '../../shared/config.js';
import { current as currentRole } from '../../shared/roles.js';
import { compareDates, date, iso, todayIso, usd } from '../../shared/format.js';

const TABLE = 'charges';

/** The trail is keyed on this entity name; a line's id is its number. */
const ENTITY = 'charges';

export const STATUSES = ['Unreleased', 'Held', 'Released', 'Reversed'];
export const FLAGS = ['Late', 'ZeroPrice', 'Manual', 'CdmGap', 'Disputed'];
export const SOURCE_TYPES = ['Order', 'Event', 'Procedure', 'Manual'];

export const FLAG_LABELS = {
  Late: 'Late', ZeroPrice: 'Zero price', Manual: 'Manual', CdmGap: 'CDM gap', Disputed: 'Disputed',
};

/** Why a line was put on hold. The desk picks, so a month of holds can be counted. */
export const HOLD_REASONS = [
  'Awaiting clinical confirmation', 'Quantity to be checked', 'Disputed by the payer',
  'Wrong encounter suspected', 'Other',
];

/** The categories a charge needs an attending doctor on before it is captured. */
const DOCTOR_CATEGORIES = ['Consultation', 'Procedure', 'Surgery', 'Professional Fee'];

export { sourceTypeOf };

/**
 * A26 subscribes here to feed the coding worklist: every function is called
 * with { encounterNo, lineIds, at } after a release. A27 subscribes to the
 * second to mark a claim Stale: { encounterNo, lineIds, kind, at }, where kind
 * is 'cancel', 'repost' or 'hold', after a correction to a released line.
 */
export const afterReleaseHooks = [];
export const afterCorrectionHooks = [];

export function all() {
  const rows = store.table(TABLE);
  if (!rows.length) {
    rows.push(...buildCharges());
    const trail = audit.all();
    for (const entry of buildChargeTrail(rows)) {
      trail.push({ id: store.nextId('audit', 'AU-'), ...entry });
    }
  }
  return rows;
}

export const get = (id) => all().find((row) => row.id === id) || null;

/** Unreleased or Held: still the capture desk's, not billing's. */
export const isUnreleased = (line) => line?.status === 'Unreleased' || line?.status === 'Held';

/** Date of service first, then the order they arrived in. */
const byService = (a, b) => compareDates(a.dateOfService, b.dateOfService) || String(a.createdAt).localeCompare(String(b.createdAt));

export const byEncounter = (no) => all().filter((row) => row.encounterNo === no).sort(byService);

export const releasedByEncounter = (no) => byEncounter(no).filter((row) => row.status === 'Released');

export const lateCharges = (no) => byEncounter(no).filter((row) => row.flags.includes('Late') && row.status !== 'Reversed');

export const item = (line) => cdm.get(line?.itemId);

export const needsDoctor = (row) => DOCTOR_CATEGORIES.includes(row?.category);

export function statusTone(status) {
  if (status === 'Released') return 'success';
  if (status === 'Held') return 'warning';
  if (status === 'Reversed') return 'critical';
  return 'accent';
}

export function flagTone(flag) {
  if (flag === 'ZeroPrice' || flag === 'CdmGap' || flag === 'Disputed') return 'critical';
  if (flag === 'Late') return 'warning';
  return '';
}

/** What a flag says in full — the chip's tooltip. */
export function flagTitle(line, flag) {
  if (flag === 'Late' && line.late) {
    const since = `${line.late.since ? date(line.late.since) : '—'}`;
    if (!line.late.window) {
      return line.late.approvedBy
        ? `Captured beyond the ${CONFIG.claima.capture.lateWindowDays}-day window — approved by ${line.late.approvedBy}: ${line.late.reason}`
        : `Captured beyond the ${CONFIG.claima.capture.lateWindowDays}-day window (closed or released on ${since}) — awaiting approval`;
    }
    return `Captured after the visit closed or released on ${since} — inside the ${CONFIG.claima.capture.lateWindowDays}-day window`;
  }
  if (flag === 'ZeroPrice') return `Priced at nothing — ${zeroPriceReason(line)}`;
  if (flag === 'Manual') return `Entered by hand by ${line.source.capturedBy}${line.source.reason ? `: ${line.source.reason}` : ''}`;
  if (flag === 'CdmGap') return 'The charge master does not carry this item';
  if (flag === 'Disputed') return `Disputed${line.holdReason ? ` — ${line.holdReason}` : ''}`;
  return flag;
}

/** Why a line prices to nothing: the catalogue, or the contract. */
export function zeroPriceReason(line) {
  const row = item(line);
  if (row && !(Number(row.standardPrice) > 0)) return 'the standard price is $0 in the charge master';
  const trace = line.pricing?.trace || {};
  if (trace.rules?.length) return `${trace.contractNo || 'the contract'} v${trace.version} — ${trace.rules.join(', ')}`;
  return trace.contractNo ? `${trace.contractNo} v${trace.version} allows nothing on this charge` : 'no price resolved';
}

// --- the worklist's reads ------------------------------------------------------

/**
 * Unreleased work, one group per visit. Line filters narrow the lines a group
 * shows and drop the group when nothing is left; the search reads the visit
 * (number, patient, MRN) and the lines (code, description). Visits already
 * closed sort first — they are the ones a claim is waiting on — then the group
 * whose oldest line has waited longest.
 */
export function unbilledGrouped(q = '', { department = '', status = '', flag = '', source = '', from = '', to = '' } = {}) {
  const needle = q.trim().toLowerCase();
  const lines = all().filter((row) => {
    if (!isUnreleased(row)) return false;
    if (status && row.status !== status) return false;
    if (flag && !row.flags.includes(flag)) return false;
    if (source && row.source.type !== source) return false;
    if (from && compareDates(row.dateOfService, from) < 0) return false;
    if (to && compareDates(row.dateOfService, to) > 0) return false;
    return true;
  });

  const groups = new Map();
  for (const row of lines) {
    if (!groups.has(row.encounterNo)) groups.set(row.encounterNo, []);
    groups.get(row.encounterNo).push(row);
  }

  return [...groups.entries()]
    .map(([no, rows]) => groupOf(no, rows.sort(byService)))
    .filter((g) => g.encounter)
    .filter((g) => !department || g.encounter.department === department)
    .filter((g) => !needle || matches(g, needle))
    .sort((a, b) => Number(b.closed) - Number(a.closed) || String(a.oldestAt).localeCompare(String(b.oldestAt)));
}

function groupOf(no, rows) {
  const enc = encounters.get(no);
  return {
    encounterNo: no,
    encounter: enc,
    lines: rows,
    gross: cents(rows.reduce((sum, row) => sum + (row.pricing.gross || 0), 0)),
    allowed: cents(rows.reduce((sum, row) => sum + (row.pricing.allowed || 0), 0)),
    held: rows.filter((row) => row.status === 'Held').length,
    flags: [...new Set(rows.flatMap((row) => row.flags))],
    oldestAt: rows.map((row) => row.createdAt).sort()[0],
    closed: Boolean(enc) && !encounters.isOpen(enc),
    releasable: rows.filter((row) => !releaseBlocker(row)).length,
  };
}

function matches(group, needle) {
  const enc = group.encounter;
  const hay = [enc.no, enc.patientMrn, enc.department].join(' ').toLowerCase();
  if (hay.includes(needle)) return true;
  return group.lines.some((row) => {
    const it = item(row);
    return `${it?.chargeCode || ''} ${cdm.label(it)} ${row.source.ref || ''}`.toLowerCase().includes(needle);
  });
}

/** The rail: every figure is over the whole unreleased register, not the page. */
export function counts() {
  const open = all().filter(isUnreleased);
  return {
    encounters: new Set(open.map((row) => row.encounterNo)).size,
    lines: open.length,
    gross: cents(open.reduce((sum, row) => sum + (row.pricing.gross || 0), 0)),
    held: open.filter((row) => row.status === 'Held').length,
    late: open.filter((row) => row.flags.includes('Late')).length,
    zeroPrice: open.filter((row) => row.flags.includes('ZeroPrice')).length,
  };
}

/** Lines priced at nothing, oldest first — the health screen's second panel. */
export const zeroPrice = () =>
  all().filter((row) => row.status !== 'Reversed' && row.flags.includes('ZeroPrice')).sort(byService);

/**
 * Bed-nights nobody has charged for. An admission has spent a number of
 * midnights on the ward — its length of stay once discharged, the calendar
 * days since it opened while it is still in the building — and the Room &
 * Board it carries has to cover that many nights, whether on lines of its own
 * or inside a package's consumption. What is short is what the census feed
 * missed, and the gap names the room the visit's bed class would have charged.
 */
export function gaps(on = todayIso()) {
  return encounters.all()
    .filter((enc) => enc.type === 'IP' && (enc.status === 'Active' || enc.status === 'Discharged'))
    .map((enc) => {
      const nights = enc.status === 'Discharged'
        ? Number(enc.los) || encounters.lengthOfStay(enc.startAt, enc.endAt)
        : daysBetween(iso(enc.startAt), on);
      if (nights <= 0) return null;
      const captured = roomNights(byEncounter(enc.no).filter((row) => row.status !== 'Reversed'));
      if (captured >= nights) return null;
      const room = roomItemFor(enc);
      return {
        encounterNo: enc.no,
        encounter: enc,
        nights,
        captured,
        missing: nights - captured,
        item: room,
        signal: `${nights} night${nights === 1 ? '' : 's'} on ${enc.ward || 'the ward'} — ${captured} charged`,
        missingLabel: `${room?.chargeCode || 'Room & Board'} — ${nights - captured} night${nights - captured === 1 ? '' : 's'}`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.missing - a.missing || String(a.encounter.startAt).localeCompare(String(b.encounter.startAt)));
}

function roomNights(lines) {
  return lines.reduce((sum, row) => {
    const it = item(row);
    if (!it) return sum;
    if (it.category === 'Room & Board') return sum + (Number(row.qty) || 0);
    if (!cdm.isBundle(it)) return sum;
    return sum + (row.consumption || []).reduce((inner, c) =>
      inner + (cdm.get(c.componentId)?.category === 'Room & Board' ? Number(c.qty) || 0 : 0), 0);
  }, 0);
}

/** The bed a visit's class would be charged as: ICU, private, or shared. */
export function roomItemFor(enc) {
  const code = enc?.bedClass === 'ICU' ? 'RNB-0004' : enc?.bedClass === 'Private' ? 'RNB-0001' : 'RNB-0002';
  return cdm.getByCode(code) || cdm.findActive().find((row) => row.category === 'Room & Board') || null;
}

// --- capture --------------------------------------------------------------------

/** The dates a charge on this visit may carry: from its start to its end, or today. */
export function dosBounds(enc) {
  return { from: iso(enc?.startAt), to: enc?.endAt ? iso(enc.endAt) : todayIso() };
}

/**
 * Whether a charge landing on this visit now is late, and if so since when.
 * A visit that has closed, or one whose charges were already released, has
 * had its bill drawn up: anything after that is a late charge, inside the
 * window when the close or the release was lateWindowDays ago or less.
 */
export function lateness(enc, on = todayIso()) {
  if (!enc) return null;
  const closed = enc.status === 'Discharged' || enc.status === 'Completed';
  const since = closed
    ? enc.endAt
    : releasedByEncounter(enc.no).map((row) => row.releasedAt).sort().pop() || null;
  if (!since) return null;
  const days = daysBetween(iso(since), on);
  return {
    since,
    days,
    window: days <= CONFIG.claima.capture.lateWindowDays,
    why: closed
      ? `The visit was ${String(enc.status).toLowerCase()} on ${date(since)}`
      : `Charges on this visit were released on ${date(since)}`,
  };
}

/** Why a capture would be refused, or '' when it may go ahead. */
export function captureBlocked(enc, { itemId, qty, dateOfService, doctorId } = {}, { lateReason = '', role = currentRole(), system = false } = {}) {
  if (!enc) return 'No such encounter';
  if (enc.status === 'Cancelled') return 'A cancelled visit takes no charges';
  if (enc.status === 'Planned') return 'The visit has not opened yet';
  const row = cdm.get(itemId);
  if (!row) return 'Not in the charge master';
  if (row.status !== 'Active') return `${row.chargeCode} is inactive in the charge master`;
  if (!(Number(qty) >= 1)) return 'Quantity must be at least 1';
  const dos = iso(dateOfService);
  const { from, to } = dosBounds(enc);
  if (!dos) return 'Enter a date of service';
  if (dos < from || dos > to) return `The date of service must fall inside the visit (${date(from)} – ${date(to)})`;
  if (needsDoctor(row) && !doctorId) return `A ${row.category.toLowerCase()} charge needs the attending doctor`;
  const late = lateness(enc);
  if (late && !late.window && !system) {
    if (!role.canLateCharge) {
      return `${late.why}, more than ${CONFIG.claima.capture.lateWindowDays} days ago. ${role.title} cannot capture a charge beyond the late window.`;
    }
    if (!lateReason.trim()) return 'A late charge beyond the window needs a reason';
  }
  return '';
}

/** The price a capture would post, without posting it — what the dialog previews. */
export function preview(encounterNo, line = {}) {
  const enc = encounters.get(encounterNo);
  if (!enc) return { error: `No encounter ${encounterNo}`, rows: [], pricing: null };
  const priced = postCharge(enc, { itemId: line.itemId, qty: Math.max(1, Number(line.qty) || 1), consumption: line.consumption || [] }, atFor(iso(line.dateOfService)));
  return { ...priced, pricing: priced.rows.length ? pricingOf(priced) : null };
}

/**
 * Capture one charge. `source` is { type, ref, capturedBy, reason }; a feed
 * passes capturedBy 'System'. Prices through the engine, posts through the
 * accounts desk, keeps the ledger ids, flags what the line is (Manual, Late,
 * ZeroPrice) and holds it when a late charge beyond the window arrived from a
 * feed — a person with the right to capture one beyond the window approves it
 * as they capture it, by giving the reason.
 */
export function capture(encounterNo, line = {}, source = {}, opts = {}) {
  const enc = encounters.get(encounterNo);
  const system = source.capturedBy === 'System';
  const role = opts.role || currentRole();
  const spec = {
    itemId: line.itemId,
    qty: Math.max(1, Number(line.qty) || 1),
    dateOfService: iso(line.dateOfService) || todayIso(),
    doctorId: line.doctorId || enc?.doctorId || null,
    consumption: (line.consumption || []).map((c) => ({ ...c })),
  };
  const blocked = captureBlocked(enc, spec, { lateReason: opts.lateReason || '', role, system });
  if (blocked) return { error: blocked, line: null };

  const at = atFor(spec.dateOfService);
  const priced = postCharge(enc, spec, at);
  if (priced.error || !priced.rows.length) return { error: priced.error || 'This charge could not be priced', line: null };
  const posted = accounts.postCharges(enc.no, [spec], at);
  if (posted.error) return { error: posted.error, line: null };

  const late = lateness(enc);
  const inherit = opts.inherit || null;
  const approvedBy = late && !late.window
    ? (inherit?.late?.approvedBy || (system ? null : role.name))
    : null;
  const pendingApproval = Boolean(late && !late.window && !approvedBy);
  const pricing = pricingOf(priced);
  const now = new Date().toISOString();

  const row = {
    id: store.nextId(TABLE, 'CHG-'),
    encounterNo: enc.no,
    patientMrn: enc.patientMrn,
    itemId: spec.itemId,
    qty: spec.qty,
    dateOfService: spec.dateOfService,
    doctorId: spec.doctorId,
    consumption: spec.consumption,
    source: {
      type: SOURCE_TYPES.includes(source.type) ? source.type : 'Manual',
      ref: source.ref || '',
      capturedBy: source.capturedBy || role.name,
      reason: source.reason || null,
    },
    pricing,
    ledgerTxIds: posted.rows.map((tx) => tx.id),
    status: pendingApproval || opts.hold ? 'Held' : 'Unreleased',
    holdReason: pendingApproval ? 'Late charge beyond the window — awaiting approval' : opts.hold || null,
    flags: [...new Set([
      ...(source.type === 'Manual' || !source.type ? ['Manual'] : []),
      ...(late ? ['Late'] : []),
      ...(pricing.allowed === 0 ? ['ZeroPrice'] : []),
      ...(inherit?.flags || []).filter((f) => f === 'Disputed' || f === 'Manual'),
    ])],
    releasedAt: null,
    releasedBy: null,
    late: late
      ? { window: late.window, since: late.since, approvedBy, reason: approvedBy ? (opts.lateReason || inherit?.late?.reason || null) : null }
      : null,
    reversesId: opts.reversesId || null,
    reversedAt: null,
    reversalReason: null,
    createdAt: now,
    updatedAt: now,
  };
  all().push(row);
  store.commit('charges.capture');
  const it = cdm.get(row.itemId);
  log(row, 'Captured', `${it.chargeCode} ×${row.qty} on ${row.encounterNo} — ${row.source.type}${row.source.ref ? ` ${row.source.ref}` : ''} — ${usd(pricing.allowed)} allowed${
    row.source.reason ? ` — ${row.source.reason}` : ''}`, row.source.capturedBy);
  if (row.status === 'Held') log(row, 'Held', row.holdReason, row.source.capturedBy);
  if (row.late?.approvedBy) log(row, 'Late charge approved', row.late.reason || '', row.late.approvedBy);
  if (late) notifyLate(row);
  return { error: '', line: row, posted };
}

/**
 * The two features a late charge has to tell, reached through dynamic imports
 * because both import this file statically: the claim (A27) on the visit, and
 * the chart (A26) — but only a chart that already exists, since a visit that
 * was never released is put in the coding pool by its release, not by this.
 */
function notifyLate(row) {
  const it = cdm.get(row.itemId);
  const reason = `Late charge ${it?.chargeCode || row.itemId} ×${row.qty} captured on ${date(row.dateOfService)}`;
  import('./claims.js')
    .then((claims) => claims.onLateCharge?.(row.encounterNo, [row.id]))
    .catch(() => {});
  import('./coding.js')
    .then((coding) => {
      if (coding.get?.(row.encounterNo)) coding.requestRecode?.(row.encounterNo, { source: 'LateCharge', ref: row.id, reason });
    })
    .catch(() => {});
}

// --- corrections ------------------------------------------------------------------

/**
 * Edit an unreleased line. The ledger is never edited, so an edit is a reversal
 * and a fresh capture pointing back at the line it replaces — the trail keeps
 * both, and the new line carries what the old one was.
 */
export function edit(id, { qty, dateOfService, doctorId } = {}) {
  const line = get(id);
  if (!line) return { error: 'No such line', line: null };
  if (!isUnreleased(line)) return { error: 'Only an unreleased line can be edited — cancel a released one and capture it again', line: null };
  const next = {
    itemId: line.itemId,
    qty: qty === undefined ? line.qty : Math.max(1, Number(qty) || 1),
    dateOfService: dateOfService === undefined ? line.dateOfService : iso(dateOfService),
    doctorId: doctorId === undefined ? line.doctorId : (doctorId || null),
    consumption: line.consumption,
  };
  const changes = [];
  if (next.qty !== line.qty) changes.push(`qty ${line.qty} → ${next.qty}`);
  if (next.dateOfService !== line.dateOfService) changes.push(`date of service ${date(line.dateOfService)} → ${date(next.dateOfService)}`);
  if (next.doctorId !== line.doctorId) changes.push('doctor changed');
  if (!changes.length) return { error: 'Nothing changed', line };
  return repost(line, next, `Edited — ${changes.join(', ')}`);
}

/** Replace the charge itself: the same reversal-and-repost, under a new item. */
export function replace(id, newItemId) {
  const line = get(id);
  if (!line) return { error: 'No such line', line: null };
  if (!isUnreleased(line)) return { error: 'Only an unreleased line can be replaced', line: null };
  if (newItemId === line.itemId) return { error: 'Choose a different charge', line };
  const was = cdm.get(line.itemId);
  const now = cdm.get(newItemId);
  if (!now) return { error: 'Not in the charge master', line: null };
  return repost(line, { ...line, itemId: newItemId, consumption: [] }, `Replaced ${was?.chargeCode || line.itemId} with ${now.chargeCode}`);
}

function repost(line, next, why) {
  const enc = encounters.get(line.encounterNo);
  const blocked = captureBlocked(enc, next, { system: true });
  if (blocked) return { error: blocked, line: null };
  reverseRows(line, why);
  // A hold for a reason of the desk's own carries over; a hold that was only
  // the late window waiting for approval is decided again by the new capture.
  const pendingLate = line.late && !line.late.window && !line.late.approvedBy;
  const res = capture(line.encounterNo, next, { ...line.source },
    { inherit: line, reversesId: line.id, hold: line.status === 'Held' && !pendingLate ? line.holdReason : '' });
  if (res.error) return res;
  line.status = 'Reversed';
  line.reversedAt = new Date().toISOString();
  line.reversalReason = `${why} — reposted as ${res.line.id}`;
  line.updatedAt = line.reversedAt;
  store.commit('charges.repost');
  log(line, 'Reversed', line.reversalReason);
  return res;
}

/** Cancel a line: its ledger rows are reversed and the line is marked so. */
export function cancel(id, reason = '') {
  const line = get(id);
  if (!line || line.status === 'Reversed' || !reason.trim()) return null;
  const wasReleased = line.status === 'Released';
  reverseRows(line, reason);
  line.status = 'Reversed';
  line.reversedAt = new Date().toISOString();
  line.reversalReason = reason;
  line.updatedAt = line.reversedAt;
  store.commit('charges.cancel');
  log(line, 'Cancelled', reason);
  if (wasReleased) fire(afterCorrectionHooks, { encounterNo: line.encounterNo, lineIds: [line.id], kind: 'cancel', at: line.reversedAt });
  return line;
}

export function hold(id, reason = '') {
  const line = get(id);
  if (!line || line.status === 'Held' || line.status === 'Reversed' || !reason.trim()) return null;
  const wasReleased = line.status === 'Released';
  line.status = 'Held';
  line.holdReason = reason;
  if (wasReleased) Object.assign(line, { releasedAt: null, releasedBy: null });
  if (/disput/i.test(reason) && !line.flags.includes('Disputed')) line.flags = [...line.flags, 'Disputed'];
  line.updatedAt = new Date().toISOString();
  store.commit('charges.hold');
  log(line, 'Held', reason);
  if (wasReleased) fire(afterCorrectionHooks, { encounterNo: line.encounterNo, lineIds: [line.id], kind: 'hold', at: line.updatedAt });
  return line;
}

/** Why a hold cannot simply be lifted, or ''. */
export function unholdBlocked(line) {
  if (!line || line.status !== 'Held') return 'This line is not on hold';
  if (line.late && !line.late.window && !line.late.approvedBy) return 'A late charge beyond the window is released by approving it';
  return '';
}

export function unhold(id) {
  const line = get(id);
  if (!line || unholdBlocked(line)) return null;
  const was = line.holdReason;
  line.status = 'Unreleased';
  line.holdReason = null;
  line.flags = line.flags.filter((f) => f !== 'Disputed');
  line.updatedAt = new Date().toISOString();
  store.commit('charges.unhold');
  log(line, 'Hold lifted', was || '');
  return line;
}

/** A role with late-charge rights approves a feed's late line beyond the window. */
export function approveLate(id, reason = '', role = currentRole()) {
  const line = get(id);
  if (!line || !line.late || line.late.window || line.late.approvedBy || !reason.trim()) return null;
  if (!role.canLateCharge) return null;
  line.late = { ...line.late, approvedBy: role.name, reason };
  if (line.status === 'Held') {
    line.status = 'Unreleased';
    line.holdReason = null;
  }
  line.updatedAt = new Date().toISOString();
  store.commit('charges.late');
  log(line, 'Late charge approved', reason, role.name);
  return line;
}

// --- release ----------------------------------------------------------------------

/** Why a line cannot be released now, or '' when it is clean. */
export function releaseBlocker(line) {
  if (!line) return 'No such line';
  if (line.status === 'Released') return 'Already released';
  if (line.status === 'Reversed') return 'Reversed';
  if (line.status === 'Held') return `On hold — ${line.holdReason || 'no reason given'}`;
  if (line.flags.includes('CdmGap')) return 'Not in the charge master';
  if (line.flags.includes('Disputed')) return 'Disputed';
  if (line.flags.includes('ZeroPrice')) return 'Priced at nothing';
  if (line.late && !line.late.window && !line.late.approvedBy) return 'Late charge awaiting approval';
  return '';
}

/**
 * Release lines to billing. `lineIds` null releases every clean unreleased
 * line on the visit; a list releases those it names and reports the rest as
 * excluded with the reason. One commit, one hook call, a trail entry per line.
 */
export function release(encounterNo, lineIds = null, user = currentRole().name) {
  const candidates = byEncounter(encounterNo)
    .filter((row) => (lineIds ? lineIds.includes(row.id) : isUnreleased(row)));
  const at = new Date().toISOString();
  const released = [];
  const excluded = [];
  for (const row of candidates) {
    const why = releaseBlocker(row);
    if (why) {
      excluded.push({ line: row, why });
      continue;
    }
    row.status = 'Released';
    row.releasedAt = at;
    row.releasedBy = user;
    row.updatedAt = at;
    released.push(row);
  }
  if (released.length) {
    store.commit('charges.release');
    for (const row of released) {
      const it = cdm.get(row.itemId);
      log(row, 'Released', `${it?.chargeCode || row.itemId} ×${row.qty} released to billing — ${usd(row.pricing.allowed)} allowed`, user);
    }
    fire(afterReleaseHooks, { encounterNo, lineIds: released.map((row) => row.id), at });
  }
  return { released, excluded, at };
}

export const history = (id) => audit.forEntity(ENTITY, id);

// --- internals --------------------------------------------------------------------

const cents = (v) => Math.round((Number(v) || 0) * 100) / 100;

const daysBetween = (from, to) =>
  Math.floor((Date.parse(`${iso(to)}T00:00:00.000Z`) - Date.parse(`${iso(from)}T00:00:00.000Z`)) / 86400000);

/** The ledger's stamp: now for today's service, midday for an earlier date. */
const atFor = (dos) => (!dos || dos === todayIso() ? new Date().toISOString() : `${dos}T12:00:00.000Z`);

/** The figures a line keeps from the rows it produced, and the reasons behind them. */
function pricingOf(priced) {
  const rows = priced.rows;
  const first = rows[0].detail;
  const allowed = cents(rows.reduce((sum, row) => sum + (row.detail.allowed || 0), 0));
  const payer = cents(rows.reduce((sum, row) => sum + (row.detail.payerShare || 0), 0));
  const patient = cents(rows.reduce((sum, row) => sum + (row.detail.patientShare || 0), 0));
  return {
    gross: cents(first.gross ?? allowed),
    allowed,
    payerShare: payer,
    patientShare: patient,
    undecided: cents(allowed - payer - patient),
    isOverage: false,
    componentId: null,
    overageRows: rows.length - 1,
    status: first.status || 'Priced',
    trace: traceOf(priced),
  };
}

function reverseRows(line, reason) {
  for (const txId of line.ledgerTxIds || []) ledger.reverse(txId, reason);
}

function fire(hooks, payload) {
  for (const fn of hooks) {
    try {
      fn(payload);
    } catch (err) {
      console.error('[charges] hook failed', err);
    }
  }
}

function log(row, action, details, user) {
  audit.log({ entity: ENTITY, entityId: row.id, action, details, user });
}

// --- A32: the nullification round trip ---------------------------------------------
// A nullified claim hands its lines back to the pool: Released → Unreleased,
// or Held with a reason when the desk wants them looked at before they are
// billed again. A replacement claim then takes them out again through
// releaseForReplacement, which is release() without the hooks — the coding
// clock does not restart because a claim was rebuilt, and the claims
// repository is the one asking. Both write a trail line per line and one
// commit; `at`/`by` let the seed date what it writes.

/** A dated trail entry, or the ordinary one when the caller gave no date. */
function logAt(row, action, details, { at = null, by = null } = {}) {
  if (!at) return log(row, action, details, by);
  audit.all().push({ id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: row.id, action, details, user: by || currentRole().name, at });
  return null;
}

/**
 * returnFromClaim(lineIds, { nullificationNo, claimNo, hold, reason, at, by })
 * → { returned[], skipped[{ id, why }] }. Released lines only; a hold needs a
 * reason. Each line keeps `returnedFrom { claimNo, nullificationNo, at }` so
 * the pool can say where it came back from. No correction hook fires — the
 * claim the lines came off is already void.
 */
export function returnFromClaim(lineIds = [], { nullificationNo = '', claimNo = '', hold = false, reason = null, at = null, by = null } = {}) {
  const when = at || new Date().toISOString();
  const returned = [];
  const skipped = [];
  for (const id of lineIds) {
    const line = get(id);
    if (!line) { skipped.push({ id, why: 'No such line' }); continue; }
    if (line.status !== 'Released') { skipped.push({ id, why: `${line.status} — only a released line comes back` }); continue; }
    if (hold && !String(reason || '').trim()) { skipped.push({ id, why: 'A hold needs a reason' }); continue; }
    line.status = hold ? 'Held' : 'Unreleased';
    line.holdReason = hold ? String(reason).trim() : null;
    line.releasedAt = null;
    line.releasedBy = null;
    line.returnedFrom = { claimNo, nullificationNo, at: when };
    line.updatedAt = when;
    returned.push(line);
  }
  if (returned.length) {
    store.commit('charges.return');
    for (const line of returned) {
      const it = cdm.get(line.itemId);
      logAt(line, 'Returned from claim', `${claimNo} nullified (${nullificationNo}) — ${it?.chargeCode || line.itemId} ×${line.qty} back to the pool as ${
        hold ? `Held: ${line.holdReason}` : 'Unreleased'}`, { at: when, by });
    }
  }
  return { returned, skipped, at: when };
}

/**
 * releaseForReplacement(lineIds, { nullificationNo, claimNo, at, by }) →
 * { released[], excluded[{ line, why }] }. The lines a nullification returned,
 * released again for the fresh claim the same visit is assembled into. Clean
 * lines only, the release() rule; no hook fires.
 */
export function releaseForReplacement(lineIds = [], { nullificationNo = '', claimNo = '', at = null, by = null } = {}) {
  const when = at || new Date().toISOString();
  const user = by || currentRole().name;
  const released = [];
  const excluded = [];
  for (const id of lineIds) {
    const line = get(id);
    if (!line) continue;
    const why = releaseBlocker(line);
    if (why) { excluded.push({ line, why }); continue; }
    line.status = 'Released';
    line.releasedAt = when;
    line.releasedBy = user;
    line.updatedAt = when;
    released.push(line);
  }
  if (released.length) {
    store.commit('charges.release');
    for (const line of released) {
      const it = cdm.get(line.itemId);
      logAt(line, 'Released', `${it?.chargeCode || line.itemId} ×${line.qty} released again for the replacement of ${claimNo} (${nullificationNo})`, { at: when, by: user });
    }
  }
  return { released, excluded, at: when };
}

/** The register lines behind a claim's lines: by charge-line id, else by a shared ledger row. */
export function linesForClaim(claim) {
  const out = [];
  for (const cl of claim?.lines || []) {
    const direct = cl.chargeLineId ? get(cl.chargeLineId) : null;
    const line = direct || all().find((row) => row.status !== 'Reversed'
      && (row.ledgerTxIds || []).some((tx) => tx === cl.chargeLineId || (cl.ledgerTxIds || []).includes(tx)));
    if (line && !out.some((l) => l.id === line.id)) out.push(line);
  }
  return out;
}

// --- A31: denial routing -----------------------------------------------------------
// A denial routed to charge correction puts the line it names on hold as
// disputed and records who asked, so the capture desk finds it on the
// worklist with the denial beside it. The hold itself is the correction
// path the register already has; this only adds the request to the line.

/**
 * requestCorrection(lineId, { source, ref, reason }) → the line or null. A
 * Reversed line has nothing left to correct. The hold is audited by hold();
 * the request is its own entry and its own commit.
 */
export function requestCorrection(lineId, { source = 'Denial', ref = '', reason = '' } = {}) {
  const line = get(lineId);
  if (!line || line.status === 'Reversed') return null;
  const why = `Disputed — ${source}${ref ? ` ${ref}` : ''}${reason ? `: ${reason}` : ''}`;
  if (line.status !== 'Held') hold(lineId, why);
  if (!line.flags.includes('Disputed')) line.flags = [...line.flags, 'Disputed'];
  const n = all().reduce((m, r) => m + (r.corrections || []).length, 0) + 1;
  const req = { id: `CCR-${String(n).padStart(4, '0')}`, source, ref, reason, at: new Date().toISOString(), by: currentRole().name, status: 'Open' };
  line.corrections = [...(line.corrections || []), req];
  line.updatedAt = req.at;
  store.commit('charges.correction');
  log(line, 'Correction requested', `${req.id} · ${source}${ref ? ` · ${ref}` : ''}${reason ? ` — ${reason}` : ''}`);
  return line;
}
