// Repository — TPA fee accruals. Owner: modules/defensio (amendment 42 took
// the entity over from the amendment-36 stub; the ids and the `create`
// contract are kept — data/repositories/denials.js still calls it as it
// reclassifies a denial as a TPA fee, and that call is the separation hook).
// Over the file cap on purpose: one entity, one file — the accrual, its
// basis, its matching, the overlays a dispute and an amendment write onto
// it, and the ledger over the whole register are one set of rules.
//
// An accrual is the fee a third-party administrator withheld from one
// remittance on one claim: `actual` (the separations — the denial ids the
// desk reclassified — and their sum) against `expected` (what the schedule
// version in force on the remittance date allows, through
// data/engines/tpa-matching.js). The basis is read from the remittance
// Claima posted when there is one and from the claim's own payment stamps
// otherwise; the administrator is the one linked on the payer on that date.
// The matching runs when the accrual is created, again on load once the
// peers have settled, and again whenever a remittance posts or a schedule
// gains a version — never on a row a dispute or an amendment has frozen.
//
// States: Matched, Overcharged, Undercharged, Unscheduled are the matching's
// answer (`matchState`, always kept); Disputed, Settled and Amended are
// overlays the dispute and amendment registers write through `setDispute`
// and `applyAmendment`, with the pre-amendment figures snapshotted so the
// ledger (see the engine's bucketsOf) still adds up. `status` mirrors
// `state` and `amount` mirrors `actual.amount` for the amendment-36
// readers. Audit entity `tpaFeeAccruals`, keyed on the accrual id.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as claims from './claims.js';
import * as payers from './payers.js';
import { serviceGroupOf } from './contracts.js';
import * as tpas from './tpas.js';
import * as schedules from './tpa-fee-schedules.js';
import * as engine from '../engines/tpa-matching.js';
import { current as currentRole } from '../../shared/roles.js';
import { iso, todayIso, usd, withinDates } from '../../shared/format.js';
import { buildTpaFeeAccruals } from '../seed/tpa-fee-accruals.js';

const TABLE = 'tpaFeeAccruals';
const ENTITY = 'tpaFeeAccruals';

export const STATUSES = engine.STATES;
export const { STATES, MATCH_STATES, OVERLAY_STATES, cents, bucketsOf, basisLabel } = engine;

// --- peers -------------------------------------------------------------------------------

const peers = { denials: null, remittances: null };
let settled = false;
let seeding = false;
let resolveSeedReady;
/** Resolves once this register's own seed has run (after the denials'); the dispute and amendment registers build behind it. */
export const seedReady = new Promise((resolve) => { resolveSeedReady = resolve; });
export const peerStatus = () => ({ denials: Boolean(peers.denials), remittances: Boolean(peers.remittances) });

export const peersReady = Promise.allSettled([
  import('./denials.js').then((m) => { peers.denials = m; return m.seedReady; }),
  import('./remittances.js').then((m) => { peers.remittances = m; m.afterPostHooks?.push(() => matchAll()); }),
]).then(() => { settled = true; ensureSeeded(); });

// --- reads -------------------------------------------------------------------------------

export function all() {
  const rows = store.table(TABLE);
  for (const row of rows) if (row.actual === undefined) upgrade(row);
  return rows;
}

export const get = (id) => all().find((a) => a.id === id) || null;
/** The accruals a denial's separation landed on — the denial's id sits in `actual.separationRefs`. */
export const byDenial = (denialId) => all().filter((a) => a.denialId === denialId || (a.actual?.separationRefs || []).includes(denialId));
export const byPayer = (payerId) => all().filter((a) => a.payerId === payerId);
export const byTpa = (tpaId) => all().filter((a) => a.tpaId === tpaId);
export const byClaim = (claimNo) => all().filter((a) => a.claimNo === claimNo);
export const byRemittance = (ref) => all().filter((a) => a.remittanceRef === ref);
export const history = (id) => audit.forEntity(ENTITY, id);
export const isOverlay = (row) => OVERLAY_STATES.includes(row?.state);
export const isDisputable = (row) => row?.matchState === 'Overcharged' && !row.dispute && row.state !== 'Amended';

/** getAccrualForSeparation(denialId | accrual id) → the accrual, or null — what the denial page's chip reads. */
export function getAccrualForSeparation(ref) {
  if (!ref) return null;
  return get(ref) || byDenial(ref)[0] || null;
}

export const tpaName = (row) => tpas.nameOf(row?.tpaId) || '—';
export const payerName = (row) => payers.get(row?.payerId)?.nameEn || row?.payerId || '—';

export function counts() {
  const rows = all();
  const by = (state) => rows.filter((a) => a.state === state);
  const ledger = engine.ledgerOf(rows);
  const overcharged = rows.filter(isDisputable);
  return {
    total: rows.length,
    // Amendment-36 readers: what is still accrued and its value.
    accrued: rows.filter((a) => !['Settled', 'Amended'].includes(a.state)).length,
    amount: cents(rows.filter((a) => !['Settled', 'Amended'].includes(a.state)).reduce((n, a) => n + a.actual.amount, 0)),
    matched: by('Matched').length, overcharged: overcharged.length, undercharged: by('Undercharged').length,
    unscheduled: by('Unscheduled').length, disputed: by('Disputed').length, settled: by('Settled').length, amended: by('Amended').length,
    attention: overcharged.length + by('Unscheduled').length,
    actual: ledger.actual, expected: ledger.expected, variance: cents(ledger.actual - ledger.expected),
    overchargeOpen: cents(ledger.openUndisputed + ledger.openDisputed), overchargeUndisputed: ledger.openUndisputed,
    unscheduledValue: ledger.unscheduled, disputedValue: ledger.openDisputed, recovered: ledger.recovered, writtenOff: ledger.writtenOff,
  };
}

export const SLICES = ['overcharged', 'disputed', 'unscheduled', 'variance', 'amended', 'settled', 'matched'];
function inSlice(row, slice) {
  if (!slice) return true;
  if (slice === 'overcharged') return isDisputable(row);
  if (slice === 'disputed') return row.state === 'Disputed';
  if (slice === 'unscheduled') return row.state === 'Unscheduled';
  if (slice === 'variance') return row.matchState === 'Overcharged' || row.matchState === 'Undercharged';
  if (slice === 'amended') return row.state === 'Amended';
  if (slice === 'settled') return row.state === 'Settled';
  if (slice === 'matched') return row.state === 'Matched';
  return true;
}

/**
 * search(q, { tpaId, payerId, state, from, to, slice, sort }) → rows.
 * Default order is what the desk works: the largest open overcharge first,
 * then the widest variance, then the newest remittance.
 */
export function search(q = '', f = {}) {
  const needle = String(q || '').trim().toLowerCase();
  const rows = all().filter((a) => {
    if (needle && ![a.id, a.claimNo, a.remittanceRef, tpaName(a), payerName(a), ...(a.actual.separationRefs || [])].some((s) => String(s || '').toLowerCase().includes(needle))) return false;
    if (f.tpaId && a.tpaId !== f.tpaId) return false;
    if (f.payerId && a.payerId !== f.payerId) return false;
    if (f.state && a.state !== f.state) return false;
    if ((f.from || f.to) && !withinDates(a.remittanceDate, f.from, f.to)) return false;
    return inSlice(a, f.slice);
  });
  const openOf = (a) => { const b = bucketsOf(a); return b.openUndisputed + b.openDisputed; };
  const sorters = {
    overcharge: (x, y) => openOf(y) - openOf(x) || Math.abs(y.variance) - Math.abs(x.variance) || String(y.remittanceDate).localeCompare(String(x.remittanceDate)) || y.id.localeCompare(x.id),
    newest: (x, y) => String(y.remittanceDate).localeCompare(String(x.remittanceDate)) || y.id.localeCompare(x.id),
    actual: (x, y) => y.actual.amount - x.actual.amount || y.id.localeCompare(x.id),
    variance: (x, y) => y.variance - x.variance || y.id.localeCompare(x.id),
  };
  return rows.sort(sorters[f.sort] || sorters.overcharge);
}

export const filterOptions = () => ({
  states: STATES.filter((s) => s !== 'Accrued'),
  tpas: tpas.all().map((t) => ({ id: t.id, name: t.name })),
  payers: [...new Set(all().map((a) => a.payerId))].map((id) => ({ id, name: payers.get(id)?.nameEn || id })),
});

/** periodRange('MTD' | 'QTD' | 'YTD' | 'last30' | 'all' | { from, to }) → { from, to }. */
export function periodRange(period = 'all', on = todayIso()) {
  if (period && typeof period === 'object') return { from: iso(period.from) || '', to: iso(period.to) || '' };
  const y = on.slice(0, 4);
  const m = Number(on.slice(5, 7));
  if (period === 'MTD') return { from: `${on.slice(0, 7)}-01`, to: on };
  if (period === 'QTD') return { from: `${y}-${String(m - ((m - 1) % 3)).padStart(2, '0')}-01`, to: on };
  if (period === 'YTD') return { from: `${y}-01-01`, to: on };
  if (period === 'last30') { const d = new Date(`${on}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 30); return { from: d.toISOString().slice(0, 10), to: on }; }
  return { from: '', to: '' };
}

/**
 * getTpaFeeSummary(period) → { from, to, count, expected, actual, variance,
 * overchargeOpen, unscheduled, byTpa[{ tpaId, name, count, expected, actual,
 * variance, overchargeOpen, unscheduled, disputed }] } — the published
 * figure amendment 41's misclassification view and the Defensio home read,
 * over the accruals whose remittance date falls in the period.
 */
export function getTpaFeeSummary(period = 'all') {
  const { from, to } = periodRange(period);
  const rows = all().filter((a) => withinDates(a.remittanceDate, from, to));
  const roll = (list) => {
    const l = engine.ledgerOf(list);
    return { count: list.length, expected: l.expected, actual: l.actual, variance: cents(l.actual - l.expected), overchargeOpen: cents(l.openUndisputed + l.openDisputed), unscheduled: l.unscheduled, disputed: l.openDisputed, recovered: l.recovered, writtenOff: l.writtenOff, amendmentNet: l.amendmentNet };
  };
  const ids = [...new Set(rows.map((a) => a.tpaId || null))];
  return {
    from, to, ...roll(rows),
    byTpa: ids.map((tpaId) => ({ tpaId, name: tpaId ? tpas.nameOf(tpaId) : 'No administrator linked', ...roll(rows.filter((a) => (a.tpaId || null) === tpaId)) }))
      .sort((x, y) => y.overchargeOpen - x.overchargeOpen || y.actual - x.actual),
  };
}

/** ledger() → the engine's totals over the whole register, with the rows that fail the identity. */
export const ledger = () => engine.ledgerOf(all());

/** selfCheck() — asserts every accrual's ledger line and logs one `[tpa] self-check` line. */
export function selfCheck() {
  const l = ledger();
  console.assert(l.holds, '[tpa] ledger identity fails', l.problems);
  console.log(`[tpa] self-check ${l.holds ? 'pass' : 'FAIL'} — ${l.count} accruals, actual ${usd(l.actual)} = agreed ${usd(l.agreed)} + recovered ${usd(l.recovered)} + written off ${usd(l.writtenOff)} + disputed ${usd(l.openDisputed)} + open ${usd(l.openUndisputed)} + unscheduled ${usd(l.unscheduled)} ± amendments ${usd(l.amendmentNet)}${l.holds ? '' : ` — ${l.problems.join('; ')}`}`);
  return l;
}

// --- the basis and the matching ------------------------------------------------------------

/**
 * What the fee is read against, from the remittance Claima posted on the
 * claim when one is on file, else the claim's own payment stamps, else the
 * separation itself: { paid, billed, remittanceRef, remittanceDate, source }.
 */
export function basisOf(row, claim = claims.get(row.claimId || row.claimNo)) {
  const posted = peers.remittances?.byClaim?.(row.claimNo) || [];
  const rem = posted.find((p) => p.remittanceNo === row.remittanceRef) || posted[posted.length - 1] || null;
  if (rem) return { paid: cents(rem.paid), billed: cents(claim?.totals?.gross || 0), remittanceRef: rem.remittanceNo, remittanceDate: iso(rem.at), source: 'remittance' };
  if (claim) {
    const denial = peers.denials?.get?.(row.denialId) || null;
    const date = iso(claim.paidAt) || iso(denial?.createdAt) || iso(row.landedAt) || iso(row.createdAt);
    return { paid: cents(claim.totals?.paid || 0), billed: cents(claim.totals?.gross || 0), remittanceRef: row.remittanceRef || claim.remittanceId || null, remittanceDate: date, source: claim.paidAt ? 'claim' : 'separation' };
  }
  return { paid: 0, billed: 0, remittanceRef: row.remittanceRef || null, remittanceDate: iso(row.landedAt) || iso(row.createdAt), source: 'separation' };
}

/** The matching context for one row: its basis, its service group, its place on the remittance and in the period. */
export function contextOf(row, rows = all()) {
  const siblings = row.remittanceRef ? rows.filter((a) => a.remittanceRef === row.remittanceRef && a.id !== row.id && a.id < row.id) : [];
  const key = engine.periodKeyOf(row.remittanceDate);
  const earlier = rows.filter((a) => a.id !== row.id && a.tpaId === row.tpaId && a.payerId === row.payerId && engine.periodKeyOf(a.remittanceDate) === key
    && (String(a.remittanceDate) < String(row.remittanceDate) || (a.remittanceDate === row.remittanceDate && a.id < row.id)));
  return {
    paid: row.basis?.paid || 0, billed: row.basis?.billed || 0, serviceGroup: row.serviceGroup || null,
    remitIndex: siblings.length, periodUsed: cents(earlier.reduce((n, a) => n + (a.expected?.amount || 0), 0)),
  };
}

/** The schedule version an accrual is read against — always the one in force on its remittance date. */
export function versionOf(row) {
  if (!row?.tpaId) return null;
  const v = schedules.versionAt(row.tpaId, row.payerId, row.remittanceDate);
  console.assert(!v || engine.covers(v, row.remittanceDate), `[tpa] ${row.id}: expected read from ${v?.ref}, not in force on ${row.remittanceDate}`);
  return v;
}

/** Re-read the basis and re-run the matching on one row; a frozen row (disputed, settled, amended) keeps its figures unless forced. */
export function rematch(row, { force = false, rows = all() } = {}) {
  if (!row) return false;
  const before = JSON.stringify([row.expected, row.matchState, row.basis, row.tpaId, row.remittanceDate]);
  const claim = claims.get(row.claimId || row.claimNo);
  const basis = basisOf(row, claim);
  row.basis = { paid: basis.paid, billed: basis.billed, source: basis.source };
  row.remittanceRef = basis.remittanceRef || row.remittanceRef || null;
  row.remittanceNo = row.remittanceRef;
  row.remittanceDate = basis.remittanceDate || row.remittanceDate;
  row.serviceGroup = claim ? (claim.serviceGroup || serviceGroupOf(claim.category)) : row.serviceGroup || null;
  row.tpaId = tpas.forPayer(row.payerId, row.remittanceDate)?.id || null;
  if (isOverlay(row) && !force) return false;
  const version = versionOf(row);
  const m = engine.match(row.actual.amount, version, contextOf(row, rows));
  row.expected = m.expected;
  row.basisAmount = version?.basis === 'pctBilled' ? row.basis.billed : version?.basis === 'flatClaim' || version?.basis === 'flatRemit' ? 1 : row.basis.paid;
  row.variance = m.variance;
  row.tolerance = m.tolerance;
  row.matchState = m.matchState;
  if (!isOverlay(row)) { row.state = m.matchState; row.status = row.state; }
  row.matchedAt = new Date().toISOString();
  return before !== JSON.stringify([row.expected, row.matchState, row.basis, row.tpaId, row.remittanceDate]);
}

/** matchAll() — every accrual in remittance order; commits once when anything moved. */
export function matchAll({ commit = true } = {}) {
  const rows = all().slice().sort((x, y) => String(x.remittanceDate).localeCompare(String(y.remittanceDate)) || x.id.localeCompare(y.id));
  let moved = 0;
  for (const row of rows) if (rematch(row, { rows })) moved += 1;
  if (moved && commit && !seeding) store.commit('tpaFeeAccruals.match');
  return moved;
}

// --- writes ------------------------------------------------------------------------------

/**
 * create({ denialId, claimNo, claimId, payerId, remittanceNo, amount, note,
 * landedAt }, { at, by, commit }) → the accrual. The amendment-36 contract:
 * a denial already on the register hands its accrual back; a second
 * separation on the same claim and remittance joins the accrual there
 * (actual grows, the denial id joins `separationRefs`); anything else is a
 * new accrual, matched at once.
 */
export function create(data = {}, { at = null, by = null, commit = true } = {}) {
  const existing = data.denialId ? byDenial(data.denialId)[0] : null;
  if (existing) return existing;
  const when = at || data.at || new Date().toISOString();
  const who = by || data.by || currentRole().name;
  const amount = cents(data.amount);
  const claim = claims.get(data.claimId || data.claimNo);
  const rows = store.table(TABLE);
  const probe = { denialId: data.denialId || null, claimNo: data.claimNo || claim?.claimNo || null, claimId: data.claimId || claim?.id || null, remittanceRef: data.remittanceNo || null, landedAt: data.landedAt || when, createdAt: when };
  const basis = basisOf(probe, claim);
  const twin = rows.find((a) => a.claimNo === probe.claimNo && (a.remittanceRef || null) === (basis.remittanceRef || null) && !isOverlay(a));
  if (twin) {
    twin.actual = { amount: cents(twin.actual.amount + amount), separationRefs: [...twin.actual.separationRefs, data.denialId].filter(Boolean) };
    twin.amount = twin.actual.amount;
    if (data.note) twin.note = twin.note ? `${twin.note} · ${data.note}` : data.note;
    twin.updatedAt = when;
    rematch(twin, { rows });
    log(twin, 'Separation added', `${data.denialId || '—'} · ${usd(amount)} — actual now ${usd(twin.actual.amount)}${twin.expected ? `, expected ${usd(twin.expected.amount)}` : ''} · ${twin.state}`, when, who);
    if (commit) store.commit('tpaFeeAccruals.create');
    return twin;
  }
  const row = {
    id: store.nextId(TABLE, 'TPA-'),
    denialId: data.denialId || null,
    claimNo: probe.claimNo,
    claimId: probe.claimId,
    payerId: data.payerId || claim?.payerId || null,
    tpaId: null,
    remittanceRef: basis.remittanceRef || null,
    remittanceNo: basis.remittanceRef || null,
    remittanceDate: basis.remittanceDate,
    landedAt: data.landedAt || when,
    basisAmount: basis.paid,
    basis: { paid: basis.paid, billed: basis.billed, source: basis.source },
    serviceGroup: claim ? (claim.serviceGroup || serviceGroupOf(claim.category)) : null,
    expected: null,
    actual: { amount, separationRefs: [data.denialId].filter(Boolean) },
    amount,
    variance: amount,
    tolerance: 0,
    matchState: 'Unscheduled',
    state: 'Accrued',
    status: 'Accrued',
    dispute: null,
    amendment: null,
    preAmendmentSnapshot: null,
    note: data.note || '',
    seedTag: seeding ? 'A42' : null,
    createdAt: when, createdBy: who, updatedAt: when, matchedAt: null,
  };
  rows.push(row);
  rematch(row, { rows });
  log(row, 'Accrued', `${row.denialId || '—'} · ${row.claimNo || '—'} · ${usd(amount)} withheld${row.tpaId ? ` by ${tpas.nameOf(row.tpaId)}` : ' — no administrator linked'}${
    row.expected ? ` · expected ${usd(row.expected.amount)} (${row.expected.versionRef})` : ' · no schedule version covers the date'} · ${row.state}${row.note ? ` — ${row.note}` : ''}`, when, who);
  if (commit) store.commit('tpaFeeAccruals.create');
  return row;
}

/**
 * setDispute(id, { id, status, recovered, writtenOff }, { at, by }) — the
 * dispute register writes its answer onto the accrual: Raised or
 * Acknowledged reads Disputed, Settled or WrittenOff reads Settled. The
 * matching figures are frozen from here on.
 */
export function setDispute(id, dispute, { at = null, by = null, commit = false } = {}) {
  const row = get(id);
  if (!row) return null;
  const when = at || new Date().toISOString();
  row.dispute = dispute ? { id: dispute.id, status: dispute.status, recovered: cents(dispute.recovered || 0), writtenOff: cents(dispute.writtenOff || 0), at: when } : null;
  if (row.state !== 'Amended') {
    row.state = !dispute ? row.matchState : ['Settled', 'WrittenOff'].includes(dispute.status) ? 'Settled' : 'Disputed';
    row.status = row.state;
  }
  row.updatedAt = when;
  log(row, dispute ? `Dispute ${dispute.status.toLowerCase()}` : 'Dispute withdrawn', dispute ? `${dispute.id}${dispute.recovered ? ` · recovered ${usd(dispute.recovered)}` : ''}${dispute.writtenOff ? ` · written off ${usd(dispute.writtenOff)}` : ''} · ${row.state}` : '', when, by || currentRole().name);
  if (commit) store.commit('tpaFeeAccruals.dispute');
  return row;
}

/**
 * applyAmendment(id, { amendmentId, match, correction }, { at, by }) — the
 * amendment register restates the accrual: the figures that stood are
 * snapshotted (expected, state, what was agreed, the overcharge a dispute
 * was raised on), the new match is written, and the row reads Amended.
 * A row whose correction is zero and whose state does not move is only
 * noted — it stays what it was.
 */
export function applyAmendment(id, { amendmentId, match, correction = 0 }, { at = null, by = null, commit = false } = {}) {
  const row = get(id);
  if (!row) return null;
  const when = at || new Date().toISOString();
  const changed = cents(correction) !== 0 || match.matchState !== row.matchState;
  if (!changed) {
    // Nothing moved, but the row is read against the restatement from here on — the version ref says so.
    if (!isOverlay(row)) { row.expected = match.expected; row.variance = match.variance; row.tolerance = match.tolerance; row.matchedAt = when; }
    log(row, 'Recomputed', `${amendmentId} — no change (expected ${usd(match.expected?.amount || 0)}, ${match.matchState})`, when, by || currentRole().name);
    return row;
  }
  const b = bucketsOf(row);
  row.preAmendmentSnapshot = row.preAmendmentSnapshot || {
    expected: row.expected, variance: row.variance, tolerance: row.tolerance, matchState: row.matchState, state: row.state,
    agreed: row.matchState === 'Unscheduled' ? row.actual.amount : b.agreed, overcharge: b.overcharge, at: when,
  };
  row.expected = match.expected;
  row.variance = match.variance;
  row.tolerance = match.tolerance;
  row.matchState = match.matchState;
  row.state = 'Amended';
  row.status = 'Amended';
  row.amendment = { id: amendmentId, correction: cents(correction), at: when };
  row.updatedAt = when;
  log(row, 'Amended', `${amendmentId} · expected ${usd(row.preAmendmentSnapshot.expected?.amount || 0)} → ${usd(match.expected?.amount || 0)} · ${row.preAmendmentSnapshot.state} → Amended (${match.matchState}) · correction ${usd(correction)}`, when, by || currentRole().name);
  if (commit) store.commit('tpaFeeAccruals.amend');
  return row;
}

// --- seed ---------------------------------------------------------------------------------

function ensureSeeded() {
  const rows = store.table(TABLE);
  if (!settled || seeding || !peers.denials || rows.some((r) => r.seedTag === 'A42')) return;
  seeding = true;
  try {
    store.batch(() => {
      // A row here before this seed runs is the denials seed's (TPA-0001); it keeps that provenance.
      peers.denials.all();
      for (const row of store.table(TABLE)) if (!row.seedTag) row.seedTag = 'A36';
      buildTpaFeeAccruals({ denials: peers.denials, claims, accruals: { all: () => store.table(TABLE), get }, today: todayIso() });
      matchAll({ commit: false });
      store.commit('tpaFeeAccruals.seed');
    });
  } finally {
    seeding = false;
  }
  resolveSeedReady();
}
// A reset empties the table with everything else; the next tick rebuilds it once the denials have.
store.subscribe((why) => {
  if (why === 'reset') setTimeout(ensureSeeded, 0);
  // A schedule gaining a version or a remittance posting is what moves an Unscheduled or a provisional row.
  else if (settled && !seeding && (why.startsWith('tpaFeeSchedules.') || why.startsWith('tpas.'))) matchAll();
});

// --- internals -----------------------------------------------------------------------------

/** A stub-shaped row (an older snapshot) gains the fields the register reads now. */
function upgrade(row) {
  row.actual = { amount: cents(row.amount), separationRefs: [row.denialId].filter(Boolean) };
  row.remittanceRef = row.remittanceNo || null;
  row.remittanceDate = iso(row.createdAt);
  row.landedAt = row.createdAt;
  row.basis = { paid: 0, billed: 0, source: 'separation' };
  row.basisAmount = 0;
  row.tpaId = null;
  row.expected = null;
  row.variance = row.actual.amount;
  row.tolerance = 0;
  row.matchState = 'Unscheduled';
  row.state = row.status || 'Accrued';
  row.dispute = null;
  row.amendment = null;
  row.preAmendmentSnapshot = null;
}

function log(row, action, details, at, user) {
  audit.all().push({ id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: row.id, action, details, user, at });
}
