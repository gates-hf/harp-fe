// Seed — charge capture lines. Owner: modules/claima.
//
// The register is read off the ledger rather than written out: every Charge
// transaction the patient ledger already carries is a line that was captured
// and released, because the visits it sits on were billed and closed. A line
// captured by a feed names the order, result or procedure that raised it, and
// two are hand-entered — the demo's examples of a Manual source.
//
// On top of that, a short table of intents puts unreleased work on today's
// board: an intensive-care stay whose results are landing, an emergency
// arrival, the surgical admission whose package was released this morning (so
// anything that lands now is late), and a discharge from before the late
// window whose physiotherapy turned up in the notes. Each intent is priced by
// the same engine a live capture is priced by and appended to the ledger the
// way a live capture is, so the capture register and the account can only
// disagree where the contract does.
//
// data/store.js does not import this file: it reads the ledger, the board and
// the charge master to exist. data/repositories/charges.js builds on first read
// of an empty table — the shape data/seed/ledger.js already uses.

import { store } from '../store.js';
import * as ledger from '../repositories/ledger.js';
import * as encounters from '../repositories/encounters.js';
import * as cdm from '../repositories/cdm.js';
import { postCharge } from '../engines/account-engine.js';
import { CONFIG } from '../../shared/config.js';
import { ROLES } from '../../shared/roles.js';
import { iso, todayIso } from '../../shared/format.js';

const CODER = ROLES.find((r) => r.id === 'coder').name;
const NURSE = ROLES.find((r) => r.id === 'nurse').name;

/**
 * Which feed a charge-master category arrives from. A pharmacy or a consumable
 * is charged off an order, a procedure or an operation off the procedure log,
 * and everything else — a result, a scan, a bed-night, a consultation — off an
 * event the department files. The repository re-exports this: a feed event and
 * a seeded line read the same map.
 */
export const SOURCE_OF_CATEGORY = {
  Pharmacy: 'Order', Consumables: 'Order',
  Procedure: 'Procedure', Surgery: 'Procedure', Bundle: 'Procedure',
};

export const sourceTypeOf = (category) => SOURCE_OF_CATEGORY[category] || 'Event';

/** The reference each feed stamps on what it sends. */
const REF_PREFIX = { Order: 'ORD-2026-', Event: 'EVT-2026-', Procedure: 'PROC-2026-' };

/** The two released lines entered by hand: the first of each of these codes. */
const MANUAL = {
  'CON-0002': 'Consultation given on the ward — not on the order set',
  'PRF-0001': 'Surgeon time logged from the theatre sheet',
};

/**
 * Unreleased work on the board, as intents. [visit, code, qty, days before
 * today, source type, reference, extras] — the visit is found on the board by
 * patient and type rather than by number, since the register hands the numbers
 * out; 'lateIP' is the admission discharged before the late window closed.
 */
const UNRELEASED = [
  // Yesterday's ICU admission: results landing, one scan waiting on the
  // radiologist, one consult nobody ordered.
  [{ mrn: 'MRN-000105', type: 'IP' }, 'LAB-0008', 2, 1, 'Event', 'EVT-2026-018702', {}],
  [{ mrn: 'MRN-000105', type: 'IP' }, 'RAD-0002', 1, 1, 'Event', 'EVT-2026-004415', {}],
  [{ mrn: 'MRN-000105', type: 'IP' }, 'PHA-0004', 3, 1, 'Order', 'ORD-2026-031160', {}],
  [{ mrn: 'MRN-000105', type: 'IP' }, 'RAD-0003', 1, 0, 'Event', 'EVT-2026-004431',
    { hold: 'Radiologist to confirm contrast was given before the CT is billed' }],
  [{ mrn: 'MRN-000105', type: 'IP' }, 'CON-0002', 1, 0, 'Manual', '',
    { by: NURSE, reason: 'Cardiology consult on the ward — not on the order set' }],
  // This morning's emergency arrival.
  [{ mrn: 'MRN-000110', type: 'ER' }, 'PRC-0003', 1, 0, 'Procedure', 'PROC-2026-000388', {}],
  [{ mrn: 'MRN-000110', type: 'ER' }, 'RAD-0002', 1, 0, 'Event', 'EVT-2026-004428', {}],
  [{ mrn: 'MRN-000110', type: 'ER' }, 'PHA-0001', 1, 0, 'Order', 'ORD-2026-031172', {}],
  // The surgical admission whose package was released: nursing hours arrive
  // late, and the fund's own rule absorbs the antibiotic — a line priced at
  // nothing.
  [{ mrn: 'MRN-000101', type: 'IP' }, 'PRF-0002', 4, 0, 'Event', 'EVT-2026-000917', {}],
  [{ mrn: 'MRN-000101', type: 'IP' }, 'PHA-0002', 2, 0, 'Order', 'ORD-2026-031168', {}],
  // Discharged before the window closed: the physiotherapy waits for a role
  // that can approve a late charge, the report copy was approved already.
  ['lateIP', 'PRC-0004', 2, 1, 'Procedure', 'PROC-2026-000341', {}],
  ['lateIP', 'NCL-0001', 1, 0, 'Manual', '',
    { by: CODER, reason: 'Report copy requested by the patient after discharge', approved: true }],
];

export function buildCharges() {
  const rows = [];
  let n = 0;
  const id = () => `CHG-${String((n += 1)).padStart(4, '0')}`;
  const refs = { Order: 30900, Event: 18400, Procedure: 300 };
  const nextRef = (type) => `${REF_PREFIX[type]}${String((refs[type] += 1)).padStart(6, '0')}`;
  const manualSeen = new Set();

  // --- what the ledger already billed --------------------------------------
  for (const tx of ledger.all().filter((row) => row.type === 'Charge')) {
    const d = tx.detail || {};
    const enc = encounters.get(tx.encounterNo);
    if (!enc) continue;

    // A package's overage rows ride on the package's own line: they were
    // produced by capturing it, not captured on their own.
    if (d.isOverage && d.parentItemId) {
      const parent = [...rows].reverse().find((row) => row.encounterNo === tx.encounterNo && row.itemId === d.parentItemId);
      if (parent) {
        parent.ledgerTxIds.push(tx.id);
        parent.pricing.allowed = cents(parent.pricing.allowed + (d.allowed || 0));
        parent.pricing.payerShare = cents(parent.pricing.payerShare + (d.payerShare || 0));
        parent.pricing.patientShare = cents(parent.pricing.patientShare + (d.patientShare || 0));
        parent.pricing.undecided = cents(parent.pricing.allowed - parent.pricing.payerShare - parent.pricing.patientShare);
        parent.pricing.overageRows += 1;
        continue;
      }
    }

    const item = cdm.get(d.itemId);
    const manual = item && MANUAL[item.chargeCode] && !manualSeen.has(item.chargeCode);
    if (manual) manualSeen.add(item.chargeCode);
    const type = manual ? 'Manual' : sourceTypeOf(item?.category);
    const reversed = tx.status === 'Reversed';
    const reversal = reversed ? ledger.reversalOf(tx.id) : null;
    const releasedAt = shift(tx.at, 3);

    rows.push({
      id: id(),
      encounterNo: tx.encounterNo,
      patientMrn: tx.patientMrn,
      itemId: d.itemId,
      qty: d.qty || 1,
      dateOfService: iso(tx.at),
      doctorId: enc.doctorId || null,
      consumption: (d.consumption || []).map((c) => ({ ...c })),
      source: {
        type,
        ref: manual ? '' : nextRef(type),
        capturedBy: manual ? tx.by : 'System',
        reason: manual ? MANUAL[item.chargeCode] : null,
      },
      pricing: {
        gross: cents(d.gross ?? d.allowed),
        allowed: cents(d.allowed),
        payerShare: cents(d.payerShare),
        patientShare: cents(d.patientShare),
        undecided: cents((d.allowed || 0) - (d.payerShare || 0) - (d.patientShare || 0)),
        isOverage: false,
        componentId: null,
        overageRows: 0,
        status: d.status || 'Priced',
        trace: d.selfPay
          ? { selfPay: true }
          : { contractId: d.contractId, contractNo: d.contractNo, version: d.version, rules: [] },
      },
      ledgerTxIds: [tx.id],
      status: reversed ? 'Reversed' : 'Released',
      holdReason: null,
      flags: [...(manual ? ['Manual'] : []), ...((d.allowed || 0) === 0 && !reversed ? ['ZeroPrice'] : [])],
      releasedAt: reversed ? null : releasedAt,
      releasedBy: reversed ? null : tx.by,
      late: null,
      reversesId: null,
      reversedAt: reversal ? reversal.at : null,
      reversalReason: reversal ? reversal.reason : null,
      createdAt: tx.at,
      updatedAt: reversal ? reversal.at : releasedAt,
    });
  }

  // --- unreleased work on the board --------------------------------------------
  const window = CONFIG.claima.capture.lateWindowDays;
  const today = todayIso();
  const lateIP = encounters.all()
    .filter((enc) => enc.type === 'IP' && enc.status === 'Discharged' && daysBetween(iso(enc.endAt), today) > window)
    .sort((a, b) => String(b.endAt).localeCompare(String(a.endAt)))[0] || null;

  for (const [where, code, qty, daysAgo, type, ref, extras] of UNRELEASED) {
    const enc = where === 'lateIP'
      ? lateIP
      : encounters.all().find((row) => row.patientMrn === where.mrn && row.type === where.type && row.status === 'Active');
    const item = cdm.getByCode(code);
    if (!enc || !item) continue;

    // The date of service sits inside the visit whatever day the demo runs.
    const end = enc.endAt ? iso(enc.endAt) : today;
    const dos = clampDate(shiftDate(end, -daysAgo), iso(enc.startAt), end);
    const at = enc.endAt ? `${dos}T11:30:00.000Z` : dos === today ? hoursAgo(2 + n % 3) : `${dos}T16:10:00.000Z`;
    const priced = postCharge(enc, { itemId: item.id, qty, consumption: [] }, at);
    if (!priced.rows.length) continue;

    const by = extras.by || 'System';
    const txs = appendLedger(priced.rows, by);
    enc.chargesPosted = true;

    // Late when the visit has closed or already released something; beyond
    // the window when that was more than lateWindowDays ago.
    const since = enc.endAt
      ? enc.endAt
      : rows.filter((row) => row.encounterNo === enc.no && row.status === 'Released')
        .map((row) => row.releasedAt).sort().pop() || null;
    const late = since ? { window: daysBetween(iso(since), today) <= window, since, approvedBy: null, reason: null } : null;
    if (late && !late.window && extras.approved) Object.assign(late, { approvedBy: by, reason: extras.reason });
    const pendingApproval = late && !late.window && !late.approvedBy;

    const first = priced.rows[0].detail;
    const allowed = cents(priced.rows.reduce((sum, row) => sum + (row.detail.allowed || 0), 0));
    const payer = cents(priced.rows.reduce((sum, row) => sum + (row.detail.payerShare || 0), 0));
    const patient = cents(priced.rows.reduce((sum, row) => sum + (row.detail.patientShare || 0), 0));

    rows.push({
      id: id(),
      encounterNo: enc.no,
      patientMrn: enc.patientMrn,
      itemId: item.id,
      qty,
      dateOfService: dos,
      doctorId: enc.doctorId || null,
      consumption: [],
      source: { type, ref, capturedBy: by, reason: extras.reason || null },
      pricing: {
        gross: cents(first.gross ?? allowed),
        allowed,
        payerShare: payer,
        patientShare: patient,
        undecided: cents(allowed - payer - patient),
        isOverage: false,
        componentId: null,
        overageRows: priced.rows.length - 1,
        status: first.status || 'Priced',
        trace: traceOf(priced),
      },
      ledgerTxIds: txs.map((tx) => tx.id),
      status: pendingApproval || extras.hold ? 'Held' : 'Unreleased',
      holdReason: pendingApproval ? 'Late charge beyond the window — awaiting approval' : extras.hold || null,
      flags: [
        ...(type === 'Manual' ? ['Manual'] : []),
        ...(late ? ['Late'] : []),
        ...(allowed === 0 ? ['ZeroPrice'] : []),
      ],
      releasedAt: null,
      releasedBy: null,
      late,
      reversesId: null,
      reversedAt: null,
      reversalReason: null,
      createdAt: at,
      updatedAt: at,
    });
  }

  return rows;
}

/**
 * The register's own trail, written with the times the events happened at —
 * audit.log() would stamp every one of them with now and with whoever is
 * signed in.
 */
export function buildChargeTrail(rows) {
  const entries = [];
  const entry = (row, at, action, details, user) => entries.push({
    entity: 'charges', entityId: row.id, action, user, at, details,
  });
  for (const row of rows) {
    const item = cdm.get(row.itemId);
    const label = `${item?.chargeCode || row.itemId} ×${row.qty}`;
    entry(row, row.createdAt, 'Captured',
      `${label} on ${row.encounterNo} — ${row.source.type}${row.source.ref ? ` ${row.source.ref}` : ''}${
        row.source.reason ? ` — ${row.source.reason}` : ''}`, row.source.capturedBy);
    if (row.status === 'Held') entry(row, row.createdAt, 'Held', row.holdReason, row.source.capturedBy);
    if (row.late?.approvedBy) entry(row, row.createdAt, 'Late charge approved', row.late.reason, row.late.approvedBy);
    if (row.status === 'Released') entry(row, row.releasedAt, 'Released', `${label} released to billing`, row.releasedBy);
    if (row.status === 'Reversed') entry(row, row.reversedAt, 'Cancelled', row.reversalReason || 'Reversed', CODER);
  }
  return entries;
}

// --- internals ----------------------------------------------------------------

const cents = (v) => Math.round((Number(v) || 0) * 100) / 100;

const shift = (at, hours) => new Date(Date.parse(at) + hours * 3600000).toISOString();

const hoursAgo = (hours) => new Date(Date.now() - hours * 3600000).toISOString();

const shiftDate = (day, days) => new Date(Date.parse(`${day}T00:00:00.000Z`) + days * 86400000).toISOString().slice(0, 10);

const clampDate = (day, from, to) => (day < from ? from : day > to ? to : day);

const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86400000);

/**
 * The rows a live capture would append, written straight into the ledger the
 * way data/seed/ledger.js writes its own: the same shape, the next ids and
 * sequence numbers, no commit — a seed never notifies a screen.
 */
function appendLedger(priced, by) {
  const table = ledger.all();
  let seq = table.reduce((max, row) => Math.max(max, Number(row.seq) || 0), 0);
  return priced.map((row) => {
    const tx = { ...row, id: store.nextId('ledger', 'LDG-'), seq: (seq += 1), by, status: 'Posted', reversesTxId: null, reason: null };
    table.push(tx);
    return tx;
  });
}

/** The five answers a line keeps from its trace: enough to say why, not the trace. */
export function traceOf(priced) {
  if (!priced || priced.selfPay || !priced.trace) return { selfPay: true };
  const [s1, , s3, s4, s5] = priced.trace.steps;
  return {
    contractId: priced.trace.contractId,
    contractNo: priced.trace.contractNo,
    version: priced.trace.version,
    methodology: `${s1.method} · ${s1.scope}`,
    coverage: `${s3.share} · ${s3.scope}`,
    preAuth: Boolean(s4.required),
    rules: s5.fired.map((r) => `${r.id} ${r.name}`),
    overrides: s5.overrides.map((o) => `${o.what}: was ${o.was} → now ${o.now} (${o.ruleName})`),
  };
}
