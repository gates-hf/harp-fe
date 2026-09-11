// Repository — denials. Owner: modules/defensio (amendment 36 took the entity
// over from Claima; amendment 29 wrote the stub, amendment 31 the register).
// Over the file cap on purpose: one entity, one file — the record, its
// triage, its routing, its derived resolutions and the analytics over them
// are one set of rules. The file stays in data/, the way every owned entity
// does: Claima's remittance engine keeps calling `create` as it posts, and a
// module never imports another module's files.
//
// Amendment 36 — the one-pass triage: a category, a tier and a separation
// join the class and the root cause; a denial separated as a contractual
// adjustment or a TPA fee leaves the worklist Reclassified with the money in
// `amounts.reclassified` (a reconciliation note on the claim's trail for the
// one, a TPA fee accrual for the other); an appealable denial routes to an
// appeal case; and the identity gains a bucket — denied = recovered + lost +
// writtenOff + reclassified + transferred + open, asserted by selfCheck() and
// again by data/engines/denial-resolution.js on load.
//
// A denial is one remittance line the payer refused, created by
// data/repositories/remittances.js as it posts (the A29 contract, kept:
// `create`, `reverse`, `seedHooks`, `byRemittance` and the catalogue). From
// there it is the desk's: triaged (a class and a root cause), routed (one
// active route, which creates the work item in the feature that fixes it and
// keeps the reference), and resolved — mostly by what other registers do. A
// remittance that pays the line recovers it; a Defensio hand-off's outcome,
// a write-off's posting and a manual close with a reason are the other
// three doors. The money is five figures that always add up: denied =
// recovered + lost + writtenOff + transferred + open, where `transferred`
// is what moved onto a successor denial (the remainder after a partial
// recovery) — over a whole chain the amendment's four-bucket identity
// holds, and selfCheck() asserts both on load.
//
// One denial per claim line while it is open: a line denied again on a later
// remittance is the same record reopened as a repeat (repeatCount + 1), so
// the money is never counted twice; a line denied again after its denial was
// resolved is a new record chained to the old one through previousDenialId.
//
// data/engines/denial-router.js decides class, route and deadline and reads no
// repository; this file resolves the facts it needs. The remittance and
// coding registers are reached by dynamic import (both import files that
// import this one), the write-off register is feature-detected (A33).

import { store } from '../store.js';
import * as audit from './audit.js';
import * as claims from './claims.js';
import * as payers from './payers.js';
import * as encounters from './encounters.js';
import * as handoffs from './handoffs.js';
import * as charges from './charges.js';
import * as followups from './followups.js';
import * as preauth from './preauth-requests.js';
import * as appealCases from './appeal-cases.js';
import * as tpaFeeAccruals from './tpa-fee-accruals.js';
import * as router from '../engines/denial-router.js';
import { DENIAL_CODES, denialCode, denialCodeLabel, reasonOf, codeFor, buildDenials, buildIntent } from '../seed/denials.js';
import { ROOT_CAUSES, GROUPS, OWNERS, rootCause, rootCauseLabel, groupedRootCauses } from '../seed/root-causes.js';
import { doctorName } from '../seed/reference.js';
import { current as currentRole } from '../../shared/roles.js';
import { CONFIG } from '../../shared/config.js';
import { compareDates, iso, todayIso, usd } from '../../shared/format.js';

const TABLE = 'denials';
const ENTITY = 'denials';

export const STATUSES = [...router.STATUSES, router.WITHDRAWN];
export const { CLASSES, ROUTES, OPEN_STATUSES, RESOLVED_STATUSES, AMOUNT_BANDS } = router;
export const {
  routeLabel, ROUTE_LABELS, ROUTE_ICONS, ROUTE_HINTS, classTone, statusTone, isOpen, isResolved, bandOf, payerReasonLabel,
  deadlineTone, appealWindowDays,
} = router;
// A36 — the one-pass triage's vocabulary, re-exported so a screen has one import.
export const {
  CATEGORIES, TIERS, TIER_CLASS, TIER_ROUTE, SEPARATIONS, SEPARATION_LABELS, tierTone, separationTone, separationLabel,
  defaultSeparation, classFor,
} = router;

// A36 — the payer's own record is asked for its appeal window first; the config entry and the default follow.
router.windowResolvers.push((payerId) => payers.get(payerId)?.appealWindowDays || null);
export { DENIAL_CODES, denialCode, denialCodeLabel, reasonOf, codeFor };
export { ROOT_CAUSES, GROUPS, OWNERS, rootCause, rootCauseLabel, groupedRootCauses };

/** The remittance repository pushes its seeder here; an empty table runs it once. */
export const seedHooks = [];

// --- peers ------------------------------------------------------------------------------

const peers = { remittances: null, coding: null, writeoffs: null };
export const peerStatus = () => ({ remittances: Boolean(peers.remittances), coding: Boolean(peers.coding), writeoffs: Boolean(peers.writeoffs) });

/** Settled once the three peers have been tried: remittances (its hook), coding and write-offs. */
export const peersReady = Promise.allSettled([
  import('./remittances.js').then((m) => {
    peers.remittances = m;
    m.afterPostHooks?.push(onRemittancePosted);
  }),
  import('./coding.js').then((m) => { peers.coding = m; }),
  import('./writeoffs.js').then((m) => { peers.writeoffs = m; }).catch(() => { peers.writeoffs = null; }),
]);

// --- reads ------------------------------------------------------------------------------

let claimsSettled = false;
claims.peersReady?.then(() => { claimsSettled = true; });
let seeding = false;   // a seed is running through this file — no commits
let building = false;  // the A31 intents specifically — their rows are tagged
let ready = false;
export function all() {
  const rows = store.table(TABLE);
  // A ready register with an empty table is a reset read before this file's
  // own reset subscriber ran (the sidebar's badges redraw on the reset commit
  // in subscription order) — rebuild now rather than hand back nothing, or
  // the write-off seed reading the worklist a moment later names stand-ins.
  if (!seeding && (!ready || !rows.length)) {
    seeding = true;
    try {
      // One batch: the seeds below write through helpers that commit (a
      // claim's status, a hand-off), and a subscriber reading this register
      // on one of those commits — the sidebar's badges, the write-off seed
      // they fire — would read it half built. store.batch holds every
      // notification until the table is whole, then announces each reason
      // once, so what they read is what the seed meant.
      store.batch(() => {
        if (!rows.length) {
          // The remittance seed (a hook below) activates a secondary claim as
          // it posts; after a reset, when the claim peers have long settled,
          // the assembly claims are asked for first — the order the first load
          // gets. Before the peers settle the call would seed lines off the
          // ledger, so it waits.
          if (claimsSettled) claims.ensureAssembled?.();
          for (const fn of seedHooks) fn();
        }
        for (const row of rows) upgrade(row);
        if (!rows.some((r) => r.seedTag === 'A31')) {
          building = true;
          try { buildDenials(seedApi); } finally { building = false; }
        }
        sweep();
      });
      ready = true;
      scheduleDeferred();
    } finally {
      seeding = false;
    }
  }
  return rows;
}
// A reset empties every table; the next read seeds and sweeps again.
store.subscribe((reason) => { if (reason === 'reset') { seeding = false; ready = false; } });

export const get = (id) => all().find((d) => d.id === id) || null;

/** The denials on one claim, oldest first — what a claim page and a timeline read. */
export const byClaim = (claimNo) => all().filter((d) => d.claimNo === claimNo).sort(byAt);

export const byRemittance = (remittanceNo) =>
  all().filter((d) => d.remittanceNo === remittanceNo || (d.repeats || []).some((r) => r.remittanceNo === remittanceNo)).sort(byAt);

export const history = (id) => audit.forEntity(ENTITY, id);

export const claimOf = (denial) => claims.get(denial?.claimId || denial?.claimNo);

/** The claim line the denial names, or null on a claim-scoped one. */
export const lineOf = (denial) => {
  const claim = claimOf(denial);
  return claim && denial?.lineId ? claim.lines.find((l) => l.id === denial.lineId) || null : null;
};

/**
 * The capture-register line behind the denied claim line, or null: by the
 * id the assembler stamped, or — for a claim assembled before the register
 * loaded, whose lines carry ledger ids — by the ledger row the two share
 * (the assembler's own sameLine rule).
 */
export function chargeLineOf(denial) {
  const claim = claimOf(denial);
  const line = lineOf(denial);
  if (!claim || !line) return null;
  const direct = line.chargeLineId ? charges.get(line.chargeLineId) : null;
  if (direct) return direct;
  const txs = new Set([...(line.ledgerTxIds || []), line.chargeLineId].filter(Boolean));
  return claim.encounterNo
    ? charges.byEncounter(claim.encounterNo).find((row) => row.status !== 'Reversed' && (row.ledgerTxIds || []).some((tx) => txs.has(tx))) || null
    : null;
}

/** What the router needs to know about the claim behind a denial. */
export function facts(denial) {
  const claim = claimOf(denial);
  return {
    hasEncounter: Boolean(claim?.encounterNo && encounters.get(claim.encounterNo)),
    hasChargeLine: Boolean(chargeLineOf(denial)),
    hasWriteoffs: Boolean(peers.writeoffs?.requestFromDenial),
    openAmount: denial?.amounts?.open || 0,
    claimStatus: claim?.status || null,
  };
}

export const suggest = (denial) => router.suggest(denial, facts(denial));
export const routeOptions = (denial) => router.routeOptions(facts(denial));
export const deadline = (denial, on = todayIso()) => router.deadlineOf(denial, on);

/** Whole days since the denial landed. */
export const ageDays = (denial, on = todayIso()) =>
  Math.max(0, Math.round((Date.parse(on) - Date.parse(iso(denial?.createdAt) || on)) / 86400000));

/** The chain a denial sits in, oldest first: every predecessor, then the row, then its successors. */
export function chainOf(denial) {
  if (!denial) return [];
  const rows = all();
  const back = [];
  let cur = denial;
  const seen = new Set([denial.id]);
  while (cur?.previousDenialId && !seen.has(cur.previousDenialId)) {
    cur = rows.find((d) => d.id === cur.previousDenialId);
    if (!cur) break;
    seen.add(cur.id);
    back.unshift(cur);
  }
  const forward = [];
  cur = denial;
  while (cur) {
    const next = rows.find((d) => d.previousDenialId === cur.id && !seen.has(d.id));
    if (!next) break;
    seen.add(next.id);
    forward.push(next);
    cur = next;
  }
  return [...back, denial, ...forward];
}

/** Where the route's work item is read: { label, href } or null. */
export function linkOf(denial) {
  const r = denial?.route;
  if (!r) return null;
  const claim = claimOf(denial);
  switch (r.kind) {
    case 'Recode': return { label: r.ref || 'Recode request', href: claim?.encounterNo ? `#/claima/coding/${claim.encounterNo}` : '#/claima/coding' };
    case 'ChargeCorrection': return { label: r.ref || 'Charge line', href: claim?.encounterNo ? `#/claima/charges?encounter=${claim.encounterNo}` : '#/claima/charges' };
    case 'AuthRework': return { label: r.ref || 'Pre-auth request', href: r.ref ? `#/frontis/preauth/${r.ref}` : '#/frontis/preauth' };
    case 'Refresh': return { label: r.ref || denial.claimNo, href: `#/claima/claims/${denial.claimNo}` };
    // The appeal page is amendment 38's; until it lands the shell sends the path to the Defensio home.
    case 'Appeal': return { label: r.ref || 'Appeal case', href: r.ref ? `#/defensio/appeals/${r.ref}` : '#/defensio' };
    case 'DefensioHandoff': return { label: r.ref || 'Hand-off', href: handoffs.DEFENSIO_PATH };
    case 'PayerReconsideration': return { label: r.ref || 'Follow-up', href: `#/claima/timeline/${denial.claimNo}` };
    case 'WriteOff': return { label: r.ref || 'Write-off request', href: r.ref ? `#/claima/writeoffs/${r.ref}` : '#/claima/writeoffs' };
    default: return null;
  }
}

/**
 * search(q, { payerId, status, class, code, rootCauseId, route, band, from,
 * to, deadline ('week' | 'passed' | 'open'), assignee, scope, repeat, tier,
 * category, separation }) →
 * rows, Untriaged first, then everything else open, then resolved, largest
 * open amount first inside each. `q` matches the id, the claim number, the
 * patient's MRN or name and the payer's reason.
 */
export function search(q = '', f = {}) {
  const needle = String(q || '').trim().toLowerCase();
  const me = currentRole().name;
  return all()
    .filter((d) => d.status !== router.WITHDRAWN)
    .filter((d) => {
      if (f.payerId && d.payerId !== f.payerId) return false;
      if (f.status && d.status !== f.status) return false;
      if (f.class && d.class !== f.class) return false;
      if (f.code && (d.payerReason?.code || d.code) !== f.code) return false;
      if (f.rootCauseId && d.rootCauseId !== f.rootCauseId) return false;
      if (f.route && d.route?.kind !== f.route) return false;
      if (f.tier && d.tier !== f.tier) return false;
      if (f.category && d.category !== f.category) return false;
      if (f.separation && (d.separation || (d.class ? 'True' : '')) !== f.separation) return false;
      if (f.band && router.bandOf(d.amounts.denied) !== f.band) return false;
      if (f.scope && d.scope !== f.scope) return false;
      if (f.from && compareDates(d.createdAt, f.from) < 0) return false;
      if (f.to && compareDates(d.createdAt, f.to) > 0) return false;
      if (f.assignee && d.assignee !== (f.assignee === 'me' ? me : f.assignee)) return false;
      if (f.repeat && !(d.repeatCount >= 2)) return false;
      if (f.open && !router.isOpen(d)) return false;
      if (f.resolvedFrom && (!d.resolvedAt || compareDates(d.resolvedAt, f.resolvedFrom) < 0)) return false;
      if (f.deadline) {
        const dl = router.deadlineOf(d);
        if (f.deadline === 'passed' && !dl.passed) return false;
        if (f.deadline === 'week' && !dl.warn) return false;
        if (f.deadline === 'open' && !(dl.binding && !dl.passed)) return false;
      }
      if (!needle) return true;
      const claim = claimOf(d);
      const patient = claim ? claims.search(needle, { patientMrn: claim.patientMrn }).length > 0 : false;
      return patient || [d.id, d.claimNo, d.payerReason?.code, d.payerReason?.text, d.reason]
        .some((v) => String(v || '').toLowerCase().includes(needle));
    })
    .sort(byRank);
}

/** The open denials — Untriaged first, then by open amount — the A29 contract's meaning of the word; `search()` is the whole register. */
export const worklist = (filters = {}) => search('', { ...filters, open: true });

export function counts(on = todayIso()) {
  const rows = all().filter((d) => d.status !== router.WITHDRAWN);
  const open = rows.filter(router.isOpen);
  const month = on.slice(0, 7);
  const mtd = (status) => rows.filter((d) => d.status === status && String(d.resolvedAt || '').slice(0, 7) === month);
  const sum = (list, key) => cents(list.reduce((n, d) => n + (d.amounts?.[key] || 0), 0));
  const recovered = [...mtd('Recovered'), ...mtd('Partially Recovered')];
  const writtenOff = mtd('Written Off');
  const reclassified = mtd('Reclassified');
  return {
    total: rows.length,
    open: open.length,
    amount: sum(open, 'open'),
    openValue: sum(open, 'open'),
    untriaged: rows.filter((d) => d.status === 'Untriaged').length,
    inProgress: rows.filter((d) => d.status === 'Routed' || d.status === 'In Progress').length,
    recoveredMtd: { count: recovered.length, amount: sum(recovered, 'recovered') },
    writtenOffMtd: { count: writtenOff.length, amount: sum(writtenOff, 'writtenOff') },
    // A36 — separated out this month: contractual adjustments and TPA fees that were never denials.
    reclassifiedMtd: { count: reclassified.length, amount: sum(reclassified, 'reclassified') },
    reclassified: rows.filter((d) => d.status === 'Reclassified').length,
    deadlinePassed: rows.filter((d) => d.status === 'Deadline Passed').length,
    nearDeadline: nearDeadline().length,
  };
}

/** Open denials whose appeal window closes inside `days` — soonest first; what the home reads. */
export function nearDeadline(days = Number(CONFIG.claima?.denials?.deadlineWarnDays) || 7, on = todayIso()) {
  return all()
    .filter((d) => router.isOpen(d))
    .map((d) => ({ denial: d, deadline: router.deadlineOf(d, on) }))
    .filter(({ deadline: dl }) => dl.binding && !dl.passed && dl.daysLeft <= days)
    .sort((a, b) => a.deadline.daysLeft - b.deadline.daysLeft || b.denial.amounts.open - a.denial.amounts.open)
    .map(({ denial: d }) => d);
}

// --- writes: the A29 contract ------------------------------------------------------------

/**
 * create({ claimNo, claimId, lineId, remittanceNo, payerId, code, amount,
 * scope, at, by }) → the row. One denial per claim line while it is open: a
 * line already open here is denied again — the same record, reopened as a
 * repeat — and a line whose last denial was resolved starts a new record
 * chained to it. `at`/`by` let the seed date the record.
 */
export function create(data = {}) {
  const rows = store.table(TABLE);
  const same = (d) => d.claimNo === data.claimNo && (d.lineId || null) === (data.lineId || null) && d.status !== router.WITHDRAWN;
  const open = rows.find((d) => same(d) && router.isOpen(d));
  if (open) {
    if (open.remittanceNo === data.remittanceNo || (open.repeats || []).some((r) => r.remittanceNo === data.remittanceNo)) return open;
    return repeat(open, data);
  }
  const previous = rows.filter((d) => same(d) && router.isResolved(d)).sort(byAt).pop() || null;
  const at = data.at || new Date().toISOString();
  const by = data.by || currentRole().name;
  const claim = claims.get(data.claimId || data.claimNo);
  const amount = cents(data.amount);
  const row = {
    id: store.nextId(TABLE, 'DN-'),
    claimNo: data.claimNo,
    claimId: data.claimId || claim?.id || null,
    lineId: data.lineId || null,
    remittanceNo: data.remittanceNo || null,
    payerId: data.payerId || claim?.payerId || null,
    patientMrn: claim?.patientMrn || null,
    encounterNo: claim?.encounterNo || null,
    contractId: claim?.contractId || null,
    scope: data.scope || (data.lineId ? 'Line' : 'Claim'),
    code: data.code || null,
    reason: denialCode(data.code)?.label || data.reason || 'Refused by the payer',
    reasonCode: reasonOf(data.code),
    payerReason: { code: data.code || null, text: denialCode(data.code)?.label || data.reason || 'Refused by the payer' },
    amount,
    amounts: router.amountsOf({ denied: amount }),
    class: null,
    rootCauseId: null,
    triageNote: '',
    category: null,
    tier: null,
    separation: null,
    reclassification: null,
    route: null,
    routeHistory: [],
    status: 'Untriaged',
    assignee: null,
    deadline: { appealBy: router.appealBy(at, data.payerId || claim?.payerId), passed: false },
    repeatCount: (previous?.repeatCount || 0) + 1,
    previousDenialId: previous?.id || null,
    repeats: [],
    resolvedAt: null,
    resolution: null,
    seedTag: building ? 'A31' : null,
    createdAt: at,
    createdBy: by,
    updatedAt: at,
  };
  rows.push(row);
  log(row, 'Created', `${row.claimNo} · ${row.lineId || 'claim'} · ${usd(amount)} — ${denialCodeLabel(row.code)}${
    previous ? ` · repeat of ${previous.id}` : ''}`, at, by);
  if (!seeding) store.commit('denials.create');
  return row;
}

/** The same line refused again on a later remittance: the record reopens as a repeat. */
function repeat(row, data) {
  const at = data.at || new Date().toISOString();
  const by = data.by || currentRole().name;
  row.repeats = [...(row.repeats || []), { remittanceNo: data.remittanceNo || null, code: data.code || null, amount: cents(data.amount), at }];
  row.repeatCount = (row.repeatCount || 1) + 1;
  row.remittanceNo = data.remittanceNo || row.remittanceNo;
  if (data.code) {
    row.code = data.code;
    row.reason = denialCode(data.code)?.label || row.reason;
    row.reasonCode = reasonOf(data.code);
    row.payerReason = { code: data.code, text: denialCode(data.code)?.label || row.reason };
  }
  if (row.route?.active) endRoute(row, `Denied again on ${data.remittanceNo || 'a later remittance'}`, at);
  row.status = row.class && row.rootCauseId ? 'Triaged' : 'Untriaged';
  row.updatedAt = at;
  log(row, 'Denied again', `Repeat ${row.repeatCount} · ${denialCodeLabel(row.code)} · ${usd(data.amount)} on ${data.remittanceNo || '—'}`, at, by);
  if (!seeding) store.commit('denials.repeat');
  return row;
}

/**
 * A reversed posting takes its denials with it. A repeat that posting made
 * is popped and the record stands as it was; a first denial is withdrawn.
 */
export function reverse(id, reason = '', { at = null, by = null, remittanceNo = null } = {}) {
  const row = get(id);
  if (!row || row.status === router.WITHDRAWN) return row;
  const when = at || new Date().toISOString();
  const last = (row.repeats || [])[row.repeats.length - 1];
  if (last && (!remittanceNo || last.remittanceNo === remittanceNo)) {
    row.repeats = row.repeats.slice(0, -1);
    row.repeatCount = Math.max(1, row.repeatCount - 1);
    row.remittanceNo = row.repeats[row.repeats.length - 1]?.remittanceNo || row.remittanceNo;
    log(row, 'Repeat withdrawn', reason, when, by);
    store.commit('denials.reverse');
    return row;
  }
  row.status = router.WITHDRAWN;
  row.reversedAt = when;
  row.reversalReason = reason;
  if (row.route?.active) endRoute(row, 'Posting reversed', when);
  log(row, 'Reversed', reason, when, by);
  store.commit('denials.reverse');
  return row;
}

// --- writes: triage and routing ---------------------------------------------------------

export function assign(id, assignee, { at = null, by = null } = {}) {
  const row = get(id);
  if (!row) return null;
  const who = assignee === 'me' ? currentRole().name : assignee || null;
  if (row.assignee === who) return row;
  const was = row.assignee;
  row.assignee = who;
  touch(row, at);
  log(row, who ? 'Assigned' : 'Unassigned', who ? `${who}${was ? ` (was ${was})` : ''}` : `Was ${was}`, at, by);
  if (!seeding) store.commit('denials.assign');
  return row;
}

/**
 * triage(id, { class, rootCauseId, note, category, tier, separation,
 * assignee }) → the row or { error }. The one-pass form (A36): a separation
 * other than a true denial hands off to reclassify() and the rest is not
 * asked; a true denial needs a class and a root cause, and takes its category
 * and tier off the root cause when they are not given. A resolved denial is
 * not retriaged. Untriaged → Triaged; a routed denial keeps its status and
 * the change is audited, since re-reading a cause is ordinary.
 */
export function triage(id, { class: cls, rootCauseId, note = '', category = null, tier = null, separation = 'True', assignee } = {}, { at = null, by = null } = {}) {
  const row = get(id);
  if (!row) return { error: 'No such denial' };
  if (!router.isOpen(row)) return { error: `A ${row.status.toLowerCase()} denial is not retriaged` };
  if (separation && separation !== 'True') {
    if (!router.SEPARATIONS.includes(separation)) return { error: 'Pick a separation' };
    return reclassify(id, separation, { note, category, tier, assignee }, { at, by });
  }
  if (!router.CLASSES.includes(cls)) return { error: 'Pick a class' };
  const rc = rootCause(rootCauseId);
  if (!rc) return { error: 'Pick a root cause' };
  const cat = router.CATEGORIES.includes(category) ? category : rc.category || null;
  const tr = router.TIERS.includes(tier) ? tier : rc.tier || null;
  const changed = row.class !== cls || row.rootCauseId !== rootCauseId || (note || '') !== (row.triageNote || '')
    || row.category !== cat || row.tier !== tr || row.separation !== 'True';
  row.class = cls;
  row.rootCauseId = rootCauseId;
  row.triageNote = String(note || '').trim();
  row.category = cat;
  row.tier = tr;
  row.separation = 'True';
  if (row.status === 'Untriaged' || row.status === 'Deadline Passed') row.status = router.deadlineOf(row).passed ? 'Deadline Passed' : 'Triaged';
  touch(row, at);
  if (changed) log(row, 'Triaged', `${cat || '—'} · ${tr || '—'} · ${cls} · ${rootCauseLabel(rootCauseId)}${row.triageNote ? ` — ${row.triageNote}` : ''}`, at, by);
  if (assignee !== undefined) assign(id, assignee, { at, by });
  if (!seeding) store.commit('denials.triage');
  return row;
}

/**
 * reclassify(id, 'Contractual' | 'TPA', { note, category, tier, assignee })
 * → the row or { error }. A36's separation: the money was never a denial.
 * What is open moves to `amounts.reclassified`, the denial reads
 * Reclassified (resolved — nothing to pursue), an active route is ended, and
 * the record the separation calls for is written: a contractual adjustment
 * puts a reconciliation note on the claim's own trail (and keeps it on the
 * denial), a TPA fee creates an accrual on the TPA register (a stub until
 * amendment 42). A note is required — it is the reconciliation.
 */
export function reclassify(id, separation, { note = '', category = null, tier = null, assignee } = {}, { at = null, by = null } = {}) {
  const row = get(id);
  if (!row) return { error: 'No such denial' };
  if (!router.isOpen(row)) return { error: `A ${row.status.toLowerCase()} denial is not reclassified` };
  if (separation !== 'Contractual' && separation !== 'TPA') return { error: 'A separation is contractual or a TPA fee' };
  const why = String(note || '').trim();
  if (!why) return { error: separation === 'Contractual' ? 'Say what the contract says — the note is the reconciliation' : 'Say what the administrator withheld and under which agreement' };
  const claim = claimOf(row);
  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  const amount = row.amounts.open;
  if (assignee !== undefined) assign(id, assignee, { at: when, by: who });
  row.separation = separation;
  row.category = router.CATEGORIES.includes(category) ? category : row.category || 'Administrative';
  row.tier = router.TIERS.includes(tier) ? tier : row.tier || (separation === 'TPA' ? 'Underpayment' : 'Soft');
  row.amounts.reclassified = cents(row.amounts.reclassified + amount);
  recompute(row);
  if (row.route?.active) endRoute(row, `Reclassified as ${router.separationLabel(separation).toLowerCase()}`, when);
  let ref = null;
  if (separation === 'Contractual') {
    ref = `RN-${row.id}`;
    row.reclassification = { kind: separation, ref, claimNo: row.claimNo, amount, note: why, at: when, by: who };
    if (claim) {
      audit.all().push({
        id: store.nextId('audit', 'AU-'), entity: 'claims', entityId: claim.id, action: 'Reconciliation note',
        details: `${ref} · ${row.id} · ${usd(amount)} reclassified as a contractual adjustment — ${why}`, user: who, at: when,
      });
    }
  } else {
    const accrual = tpaFeeAccruals.create({
      denialId: row.id, claimNo: row.claimNo, claimId: row.claimId, payerId: row.payerId, remittanceNo: row.remittanceNo,
      amount, note: why,
    }, { at: when, by: who, commit: false });
    ref = accrual.id;
    row.reclassification = { kind: separation, ref, claimNo: row.claimNo, amount, note: why, at: when, by: who };
  }
  settle(row, 'Reclassified', { kind: separation === 'TPA' ? 'TPAFee' : 'Contractual', ref, reason: why, manual: false }, when, who);
  if (!seeding) store.commit('denials.reclassify');
  return row;
}

/** Bulk triage: one class, one root cause and (optionally) one route over several denials, audited on each. */
export function triageMany(ids = [], { class: cls, rootCauseId, note = '', route: kind = '', category = null, tier = null } = {}) {
  const done = [];
  const problems = [];
  for (const id of ids) {
    const t = triage(id, { class: cls, rootCauseId, note, category, tier });
    if (t?.error) { problems.push(`${id}: ${t.error}`); continue; }
    if (kind) {
      const r = route(id, kind, { reason: null });
      if (r?.error) { problems.push(`${id}: ${r.error}`); continue; }
    }
    done.push(get(id));
  }
  return { done, problems };
}

/**
 * route(id, kind, { reason }) → the row or { error }. Triage first; one
 * active route at a time, so a second route needs a reason and the first is
 * kept in routeHistory. The work item is created in the feature that fixes
 * the denial and its reference stored on the route.
 */
export function route(id, kind, { reason = null } = {}, { at = null, by = null } = {}) {
  const row = get(id);
  if (!row) return { error: 'No such denial' };
  if (!router.isOpen(row)) return { error: `A ${row.status.toLowerCase()} denial is not routed` };
  if (!row.class || !row.rootCauseId) return { error: 'Triage the denial first — a class and a root cause' };
  const avail = router.availability(kind, facts(row));
  if (!avail.ok) return { error: avail.why };
  if (row.route?.active) {
    if (!String(reason || '').trim()) return { error: 'Say why the denial is being re-routed' };
    endRoute(row, `Re-routed to ${router.routeLabel(kind)} — ${String(reason).trim()}`, at || new Date().toISOString());
  }
  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  const made = createWorkItem(row, kind, { reason, at: when, by: who });
  if (made.error) return { error: made.error };
  row.route = { kind, ref: made.ref || null, at: when, by: who, reason: reason ? String(reason).trim() : null, active: true };
  row.status = 'Routed';
  touch(row, when);
  log(row, 'Routed', `${router.routeLabel(kind)}${made.ref ? ` · ${made.ref}` : ''}${reason ? ` — ${String(reason).trim()}` : ''}${made.note ? ` · ${made.note}` : ''}`, when, who);
  if (!seeding) store.commit('denials.route');
  return row;
}

function endRoute(row, why, at) {
  if (!row.route) return;
  row.routeHistory = [...(row.routeHistory || []), { ...row.route, active: false, endedAt: at, endedReason: why }];
  row.route = null;
}

/** The linked work item per route kind → { ref, note } or { error }. */
function createWorkItem(row, kind, { reason, at, by }) {
  const claim = claimOf(row);
  if (!claim) return { error: 'The claim behind this denial is gone' };
  const why = `Denial ${row.id} — ${denialCodeLabel(row.code)}${row.triageNote ? ` — ${row.triageNote}` : ''}`;
  const line = lineOf(row);
  const payer = payers.get(row.payerId);

  if (kind === 'Recode') {
    if (!peers.coding?.requestRecode) return { error: 'The coding feature is not loaded' };
    const req = peers.coding.requestRecode(claim.encounterNo, { source: 'Denial', ref: row.id, reason: why });
    if (!req) return { error: 'The chart could not take a recode request' };
    if (at && req.at > at) { req.at = at; req.by = by; }
    claims.openForDenial(claim.id, { denialId: row.id, code: row.code, reason: row.reason, at, by });
    return { ref: req.id, note: 'claim reopened as a draft' };
  }
  if (kind === 'Appeal') {
    const dl = router.deadlineOf(row, iso(at) || todayIso());
    const ac = appealCases.create({
      denialId: row.id, claimNo: row.claimNo, claimId: claim.id, payerId: row.payerId, amount: row.amounts.open,
      appealBy: dl.appealBy, reason: denialCodeLabel(row.code), note: row.triageNote || '',
    }, { at, by, commit: false });
    return { ref: ac.id, note: ac.createdAt === at ? 'appeal case opened' : 'appeal case already open' };
  }
  if (kind === 'ChargeCorrection') {
    const held = charges.requestCorrection(chargeLineOf(row)?.id, { source: 'Denial', ref: row.id, reason: why });
    if (!held) return { error: 'The charge line could not be put on hold' };
    return { ref: held.id, note: 'line held as disputed' };
  }
  if (kind === 'AuthRework') {
    const onVisit = claim.encounterNo ? preauth.byEncounter(claim.encounterNo) : [];
    const denied = onVisit.filter((r) => r.status === 'Denied' && !r.successorNo).pop();
    const lapsed = onVisit.filter((r) => (r.status === 'Expired' || r.status === 'Approved' || r.status === 'Partially Approved') && !r.successorNo).pop();
    let req = null;
    let note = '';
    if (denied) { req = preauth.resubmit(denied.no); note = `resubmission of ${denied.no}`; }
    else if (lapsed) { req = preauth.renew(lapsed.no); note = `renewal of ${lapsed.no}`; }
    if (!req) {
      req = preauth.create({
        patientMrn: claim.patientMrn, policyId: claim.policyId || null, payerId: claim.payerId, planId: claim.planId,
        encounterNo: claim.encounterNo || null,
        services: line ? [{ itemId: line.itemId, qty: line.qty || 1, requestedAmount: line.allowedExpected || line.payerShare || 0 }] : [],
        justification: `Raised from ${row.id}: ${denialCodeLabel(row.code)} on ${row.claimNo}.`,
      });
      note = 'new draft request';
    }
    if (!req) return { error: 'No pre-authorisation request could be raised' };
    return { ref: req.no, note };
  }
  if (kind === 'Refresh') {
    const opened = claims.openForDenial(claim.id, { denialId: row.id, code: row.code, reason: row.reason, at, by });
    if (!opened) return { error: `A ${claim.status.toLowerCase()} claim is not reopened for a denial` };
    if (claim.encounterNo) {
      const r = claims.refresh(claim.id);
      return { ref: claim.claimNo, note: r.error ? `draft — ${r.error}` : 're-assembled from the visit' };
    }
    // No visit to re-assemble from: resubmitted as filed on the next cycle, the submission feature's own call.
    claim.finalizedAt = at;
    claims.setStatus(claim.id, 'Ready', { reason: 'Resubmitted as filed', details: `Denial ${row.id} — corrected at the desk` });
    return { ref: claim.claimNo, note: 'resubmitted as filed on the next cycle' };
  }
  if (kind === 'DefensioHandoff') {
    const h = handoffs.create({
      claimId: claim.id, contractId: claim.contractId, payerId: claim.payerId, amount: row.amounts.open,
      reason: reasonOf(row.code) === 'PA_MISSING' ? 'Denied — prior auth on file' : reasonOf(row.code) === 'DOC_MISSING' ? 'Denied — documentation supplied' : 'Paid below contracted rate',
      note: `${row.id} · ${denialCodeLabel(row.code)}${row.triageNote ? ` · ${row.triageNote}` : ''}`,
    });
    if (at && h.createdAt > at) { h.createdAt = at; h.createdBy = by; }
    return { ref: h.id, note: h.status === 'Handed off' ? '' : `hand-off already ${h.status.toLowerCase()}` };
  }
  if (kind === 'PayerReconsideration') {
    if (claim.status === 'Denied') claims.setStatus(claim.id, 'Appealed', { reason: 'Payer reconsideration', details: why });
    const due = new Date(Date.parse(at) + 14 * 86400000).toISOString().slice(0, 10);
    const fu = followups.log({
      claimNo: claim.claimNo, method: 'Portal', contact: `${payer?.nameEn || row.payerId} claims desk`,
      note: `Reconsideration requested for ${row.id} — ${denialCodeLabel(row.code)}${row.triageNote ? `: ${row.triageNote}` : ''}`,
      nextDueAt: due,
    }, { commit: false });
    if (fu && at) { fu.at = at; fu.by = by; }
    return { ref: fu?.id || null, note: `follow-up due ${due}` };
  }
  if (kind === 'WriteOff') {
    const wo = peers.writeoffs?.requestFromDenial?.(row, null, { at, by, commit: !seeding });
    if (!wo || wo.error) return { error: wo?.error || 'No write-off request was raised' };
    return { ref: wo.id, note: 'pending approval' };
  }
  return { error: 'Not a route' };
}

// --- writes: resolutions ---------------------------------------------------------------

/**
 * resolveFromRemittance(claimNo, lines, { remittanceNo, at, by }) — a posting
 * on the claim pays the denied line back: paid ≥ open → Recovered; part of
 * it → Partially Recovered, with the remainder a new denial chained to this
 * one. A line denied again is the repeat `create()` already recorded, so a
 * denial this same posting touched is left alone here.
 */
export function resolveFromRemittance(claimNo, lines = [], { remittanceNo = null, at = null, by = null } = {}) {
  const out = [];
  for (const row of byClaim(claimNo)) {
    if (!router.isOpen(row)) continue;
    if (remittanceNo && (row.remittanceNo === remittanceNo || (row.repeats || []).some((r) => r.remittanceNo === remittanceNo))) continue;
    const mine = row.scope === 'Line' ? lines.filter((l) => l.lineId === row.lineId) : lines;
    const paid = cents(mine.reduce((n, l) => n + (Number(l.paid) || 0), 0));
    if (paid <= 0) continue;
    out.push(recover(row, paid, { kind: 'Remittance', ref: remittanceNo, at, by }));
  }
  return out;
}

/** Fired by the remittance repository after every posting (and every reversal, which is ignored here). */
function onRemittancePosted(event = {}) {
  if (event.reversed || !peers.remittances?.byClaim) return;
  for (const claimNo of event.claimNos || []) {
    const posting = peers.remittances.byClaim(claimNo).find((p) => p.remittanceNo === event.remittanceNo);
    if (posting) resolveFromRemittance(claimNo, posting.lines, { remittanceNo: event.remittanceNo, at: event.at });
  }
}

/**
 * resolveWrittenOff(denialId, writeoffId, amount) → the row. The write-off
 * feature calls it when a denial-sourced write-off posts: the amount leaves
 * `open` for `writtenOff`, and the denial is Written Off once nothing is open.
 */
export function resolveWrittenOff(denialId, writeoffId, amount, { at = null, by = null, reason = '' } = {}) {
  const row = get(denialId);
  if (!row || !router.isOpen(row)) return row;
  const take = Math.min(row.amounts.open, cents(amount == null ? row.amounts.open : amount));
  if (take <= 0) return row;
  const when = at || new Date().toISOString();
  row.amounts.writtenOff = cents(row.amounts.writtenOff + take);
  recompute(row);
  if (row.amounts.open <= 0) settle(row, 'Written Off', { kind: 'WriteOff', ref: writeoffId || null, reason: reason || null, manual: false }, when, by);
  else { touch(row, when); log(row, 'Partly written off', `${usd(take)}${writeoffId ? ` · ${writeoffId}` : ''}${reason ? ` — ${reason}` : ''}`, when, by); }
  if (!seeding) store.commit('denials.writeoff');
  return row;
}

/** A posted write-off reversed: the amount comes back onto the denial, open again. */
export function reopenFromWriteoff(denialId, writeoffId, amount, { at = null, by = null } = {}) {
  const row = get(denialId);
  if (!row) return null;
  const back = Math.min(row.amounts.writtenOff, cents(amount == null ? row.amounts.writtenOff : amount));
  if (back <= 0) return row;
  const when = at || new Date().toISOString();
  row.amounts.writtenOff = cents(row.amounts.writtenOff - back);
  recompute(row);
  if (router.isResolved(row) && row.amounts.open > 0) {
    row.status = row.class && row.rootCauseId ? 'Triaged' : 'Untriaged';
    row.resolvedAt = null;
    row.resolution = null;
  }
  touch(row, when);
  log(row, 'Write-off reversed', `${usd(back)} back on the denial${writeoffId ? ` · ${writeoffId}` : ''}`, when, by);
  if (!seeding) store.commit('denials.reopen');
  return row;
}

/**
 * resolveFromHandoff(handoffId | denialId, outcome, { amount }) — Defensio's
 * answer: Won recovers what is open, Lost loses it, Settled recovers the
 * hand-off's recovered amount and chains the remainder to a new denial.
 */
export function resolveFromHandoff(ref, outcome, { amount = null, at = null, by = null } = {}) {
  const row = get(ref) || all().find((d) => d.route?.kind === 'DefensioHandoff' && d.route.ref === ref && router.isOpen(d));
  if (!row || !router.isOpen(row)) return row || null;
  const h = row.route?.kind === 'DefensioHandoff' ? handoffs.get(row.route.ref) : null;
  const source = { kind: 'Handoff', ref: h?.id || row.route?.ref || null, at, by };
  if (outcome === 'Won') return recover(row, row.amounts.open, source);
  if (outcome === 'Lost') return lose(row, source);
  if (outcome === 'Settled') {
    const got = cents(amount == null ? h?.recoveredAmount || 0 : amount);
    return got > 0 ? recover(row, got, source) : row;
  }
  return row;
}

/**
 * resolveFromAppeal(appealId | denialId, 'Won' | 'Lost' | 'Settled', { amount })
 * — the appeal case's answer (amendment 38 calls it when a case ends; the
 * stub never does): Won recovers what is open, Lost loses it, Settled
 * recovers the amount and chains the remainder to a new denial.
 */
export function resolveFromAppeal(ref, outcome, { amount = null, at = null, by = null } = {}) {
  const row = get(ref) || all().find((d) => d.route?.kind === 'Appeal' && d.route.ref === ref && router.isOpen(d));
  if (!row || !router.isOpen(row)) return row || null;
  const source = { kind: 'Appeal', ref: row.route?.kind === 'Appeal' ? row.route.ref : appealCases.byDenial(row.id)[0]?.id || null, at, by };
  if (outcome === 'Won') return recover(row, row.amounts.open, source);
  if (outcome === 'Lost') return lose(row, source);
  if (outcome === 'Settled') {
    const got = cents(amount);
    return got > 0 ? recover(row, got, source) : row;
  }
  return row;
}

/**
 * resolveManual(id, { result: 'recovered' | 'lost', reason }) — a person
 * closes the denial: role-gated, the reason required, and the resolution
 * flagged manual so the analytics can tell it from a derived one.
 */
export function resolveManual(id, { result = 'lost', reason = '' } = {}, { at = null, by = null } = {}) {
  const row = get(id);
  if (!row) return { error: 'No such denial' };
  if (!router.isOpen(row)) return { error: `Already ${row.status.toLowerCase()}` };
  if (!by && !currentRole().canResolveDenial) return { error: 'Only the RCM coder and the CMO can resolve a denial by hand' };
  if (!String(reason || '').trim()) return { error: 'Say why the denial is being closed' };
  const when = at || new Date().toISOString();
  const open = row.amounts.open;
  const key = result === 'recovered' ? 'recovered' : 'lost';
  row.amounts[key] = cents(row.amounts[key] + open);
  recompute(row);
  if (row.route?.active) endRoute(row, 'Resolved by hand', when);
  settle(row, 'Manually Resolved', { kind: 'Manual', ref: null, reason: String(reason).trim(), manual: true, result: key }, when, by);
  if (!seeding) store.commit('denials.resolve');
  return row;
}

/** The desk records Defensio's answer on a hand-off: the hand-off moves, then the denial. */
export function recordHandoffOutcome(id, outcome, { amount = null, at = null, by = null } = {}) {
  const row = get(id);
  if (!row || row.route?.kind !== 'DefensioHandoff') return { error: 'This denial is not with Defensio' };
  const h = handoffs.get(row.route.ref);
  if (!h) return { error: 'The hand-off is gone' };
  if (outcome === 'Won') handoffs.setStatus(h.id, 'Recovered', row.amounts.open);
  else if (outcome === 'Settled') handoffs.setStatus(h.id, 'Recovered', amount);
  else if (outcome === 'Lost' && h.status === 'Handed off') handoffs.setStatus(h.id, 'In appeal');
  const done = resolveFromHandoff(row.id, outcome, { amount, at, by });
  return done || { error: 'Nothing changed' };
}

/**
 * recordPayerAnswer(id, 'Overturned' | 'Upheld', { note }) — the payer's
 * answer to a reconsideration. Overturned puts the claim back with the payer
 * (Acknowledged) so the remittance that pays it can be posted, and the denial
 * reads In Progress until it lands; Upheld ends the route and hands the
 * denial back triaged, for Defensio or a write-off.
 */
export function recordPayerAnswer(id, outcome, { note = '' } = {}) {
  const row = get(id);
  if (!row || row.route?.kind !== 'PayerReconsideration' || !row.route.active) return { error: 'This denial is not with the payer for reconsideration' };
  const claim = claimOf(row);
  const when = new Date().toISOString();
  const why = String(note || '').trim();
  if (outcome === 'Overturned') {
    if (claim && ['Appealed', 'Denied', 'Partially Paid'].includes(claim.status)) {
      claims.setStatus(claim.id, 'Acknowledged', { reason: 'Reconsideration granted', details: `${row.id}${why ? ` — ${why}` : ''}` });
    }
    row.status = 'In Progress';
    row.route.answer = { outcome, note: why, at: when };
    touch(row, when);
    log(row, 'In progress', `Payer overturned the denial${why ? ` — ${why}` : ''}; awaiting the remittance`, when);
  } else if (outcome === 'Upheld') {
    if (!why) return { error: 'Say what the payer said' };
    endRoute(row, `Payer upheld the denial — ${why}`, when);
    row.status = 'Triaged';
    touch(row, when);
    log(row, 'Triaged', `Payer upheld the denial — ${why}; route ended, pick the next one`, when);
  } else return { error: 'Overturned or upheld' };
  store.commit('denials.answer');
  return row;
}

// A hand-off Pactum's performance screen marks Recovered resolves the denial it was raised for.
let reacting = false;
store.subscribe((reason) => {
  if (reason !== 'handoff.status' || reacting || seeding) return;
  reacting = true;
  try {
    for (const row of store.table(TABLE)) {
      if (row.route?.kind !== 'DefensioHandoff' || !router.isOpen(row)) continue;
      const h = handoffs.get(row.route.ref);
      if (h?.status === 'Recovered') resolveFromHandoff(row.id, h.recoveredAmount >= row.amounts.open ? 'Won' : 'Settled', { amount: h.recoveredAmount });
    }
  } finally {
    reacting = false;
  }
});

function recover(row, paid, { kind, ref, at = null, by = null }) {
  const when = at || new Date().toISOString();
  const got = Math.min(row.amounts.open, cents(paid));
  if (got <= 0) return row;
  row.amounts.recovered = cents(row.amounts.recovered + got);
  recompute(row);
  if (row.route?.active) endRoute(row, `Resolved — ${kind}${ref ? ` ${ref}` : ''}`, when);
  if (row.amounts.open <= 0) {
    settle(row, 'Recovered', { kind, ref, reason: null, manual: false }, when, by);
  } else {
    const remainder = row.amounts.open;
    row.amounts.transferred = cents(row.amounts.transferred + remainder);
    recompute(row);
    const child = successor(row, remainder, when, by);
    settle(row, 'Partially Recovered', { kind, ref, reason: `${usd(remainder)} carried to ${child.id}`, manual: false, successorId: child.id }, when, by);
  }
  if (!seeding) store.commit('denials.resolve');
  return row;
}

function lose(row, { kind, ref, at = null, by = null }) {
  const when = at || new Date().toISOString();
  row.amounts.lost = cents(row.amounts.lost + row.amounts.open);
  recompute(row);
  if (row.route?.active) endRoute(row, `Resolved — ${kind}${ref ? ` ${ref}` : ''}`, when);
  settle(row, 'Lost', { kind, ref, reason: null, manual: false }, when, by);
  if (!seeding) store.commit('denials.resolve');
  return row;
}

/** The remainder after a partial recovery: a new denial chained to this one, triage carried across. */
function successor(row, amount, at, by) {
  const child = {
    ...row,
    id: store.nextId(TABLE, 'DN-'),
    amount,
    amounts: router.amountsOf({ denied: amount }),
    route: null,
    routeHistory: [],
    reclassification: null,
    status: row.class && row.rootCauseId ? 'Triaged' : 'Untriaged',
    deadline: { appealBy: router.appealBy(at, row.payerId), passed: false },
    repeatCount: (row.repeatCount || 1) + 1,
    previousDenialId: row.id,
    repeats: [],
    resolvedAt: null,
    resolution: null,
    createdAt: at,
    createdBy: by || currentRole().name,
    updatedAt: at,
  };
  store.table(TABLE).push(child);
  log(child, 'Created', `${usd(amount)} remaining after a partial recovery on ${row.id} — repeat ${child.repeatCount}`, at, by);
  return child;
}

function settle(row, status, resolution, at, by) {
  row.status = status;
  row.resolvedAt = at;
  row.resolution = { ...resolution, by: by || currentRole().name, at };
  row.deadline.passed = false;
  touch(row, at);
  log(row, status, `${resolution.kind}${resolution.ref ? ` · ${resolution.ref}` : ''}${resolution.reason ? ` — ${resolution.reason}` : ''}${
    resolution.manual ? ' · manual' : ''} · recovered ${usd(row.amounts.recovered)}, written off ${usd(row.amounts.writtenOff)}, lost ${usd(row.amounts.lost)}${
    row.amounts.reclassified ? `, reclassified ${usd(row.amounts.reclassified)}` : ''}`, at, by);
}

// --- the sweep ------------------------------------------------------------------------------

/**
 * sweep() — what a read derives: a deadline that has passed on a denial
 * nobody has routed sets Deadline Passed (no write-off, the money stays
 * open); a routed denial whose work item has moved on reads In Progress.
 * Runs on the first read of a session and after a reset; each move is
 * audited and the sweep is one commit.
 */
export function sweep(on = todayIso()) {
  let moved = 0;
  for (const row of store.table(TABLE)) {
    if (!router.isOpen(row)) continue;
    const dl = router.deadlineOf(row, on);
    row.deadline = { appealBy: dl.appealBy, passed: dl.passed };
    if (dl.passed && (row.status === 'Untriaged' || row.status === 'Triaged')) {
      row.status = 'Deadline Passed';
      log(row, 'Deadline passed', `Appeal window closed ${dl.appealBy} — ${usd(row.amounts.open)} still open`, `${on}T00:05:00.000Z`);
      moved += 1;
    }
    if (row.status === 'Routed' && progressOf(row)) {
      row.status = 'In Progress';
      log(row, 'In progress', progressOf(row));
      moved += 1;
    }
  }
  if (moved && !seeding) store.commit('denials.sweep');
  return moved;
}

/** Has the route's work item moved since it was created? The sentence that says so, or ''. */
export function progressOf(row) {
  const r = row?.route;
  if (!r?.active) return '';
  const claim = claimOf(row);
  if (r.kind === 'DefensioHandoff') { const h = handoffs.get(r.ref); return h?.status === 'In appeal' ? 'The appeal has been lodged on the hand-off' : ''; }
  // A38: the case starts as a Draft (the stub said Open); it has moved once it is anything else.
  if (r.kind === 'Appeal') { const a = appealCases.get(r.ref); return a && a.status !== 'Open' && a.status !== 'Draft' ? `Appeal ${(appealCases.statusLabel?.(a.status) || a.status).toLowerCase()}` : ''; }
  if (r.kind === 'Refresh') return claim && ['Ready', 'Submitted', 'Acknowledged'].includes(claim.status) ? `Claim ${claim.status.toLowerCase()} on cycle ${claims.cycleOf(claim)}` : '';
  if (r.kind === 'PayerReconsideration') return followups.byClaim(row.claimNo).some((f) => f.id !== r.ref && f.at > r.at) ? 'The payer’s desk has been followed up' : '';
  if (r.kind === 'AuthRework') { const p = preauth.get?.(r.ref); return p && p.status !== 'Draft' ? `Request ${p.status.toLowerCase()}` : ''; }
  if (r.kind === 'ChargeCorrection') { const l = charges.get(r.ref); return l && l.status !== 'Held' ? `Line ${l.status.toLowerCase()}` : ''; }
  if (r.kind === 'Recode') {
    const rec = peers.coding?.get?.(claim?.encounterNo);
    const req = rec?.recodeRequests?.find((x) => x.id === r.ref);
    return req && req.status !== 'Open' ? `Recode request ${req.status.toLowerCase()}` : '';
  }
  if (r.kind === 'WriteOff') { const w = peers.writeoffs?.get?.(r.ref); return w && /approved/i.test(w.status || '') ? `Write-off ${w.status.toLowerCase()}` : ''; }
  return '';
}

// --- analytics ------------------------------------------------------------------------------

/**
 * analytics({ from, to }) → the register over the denials that landed in the
 * range: payer reasons beside root causes (count, amount, recovery rate,
 * average days to resolve, monthly trend), the four breakdowns, the repeat
 * patterns and the prevention feed ranked by denied value.
 */
export function analytics({ from = '', to = '' } = {}) {
  const rows = all().filter((d) => d.status !== router.WITHDRAWN && (!from || compareDates(d.createdAt, from) >= 0) && (!to || compareDates(d.createdAt, to) <= 0));
  const months = monthsBetween(from || rows.map((d) => d.createdAt.slice(0, 10)).sort()[0] || todayIso(), to || todayIso());
  const group = (keyOf, labelOf) => {
    const map = new Map();
    for (const d of rows) {
      const key = keyOf(d) || '—';
      const g = map.get(key) || { key, label: labelOf(key, d), count: 0, amount: 0, recovered: 0, writtenOff: 0, lost: 0, open: 0, days: [], trend: months.map(() => 0), repeats: 0 };
      g.count += 1;
      g.amount = cents(g.amount + d.amounts.denied);
      g.recovered = cents(g.recovered + d.amounts.recovered);
      g.writtenOff = cents(g.writtenOff + d.amounts.writtenOff);
      g.lost = cents(g.lost + d.amounts.lost);
      g.open = cents(g.open + d.amounts.open);
      if (d.resolvedAt) g.days.push(Math.max(0, (Date.parse(d.resolvedAt) - Date.parse(d.createdAt)) / 86400000));
      const mi = months.findIndex((m) => m.key === String(d.createdAt).slice(0, 7));
      if (mi >= 0) g.trend[mi] += 1;
      if (d.repeatCount >= 2) g.repeats += 1;
      map.set(key, g);
    }
    return [...map.values()]
      .map((g) => ({ ...g, recoveryRate: g.amount ? g.recovered / g.amount : 0, avgDays: g.days.length ? Math.round(g.days.reduce((a, b) => a + b, 0) / g.days.length) : null }))
      .sort((a, b) => b.amount - a.amount || b.count - a.count || a.label.localeCompare(b.label));
  };
  const claimField = (d, key) => claimOf(d)?.[key] || null;
  const encField = (d, key) => { const c = claimOf(d); const e = c?.encounterNo ? encounters.get(c.encounterNo) : null; return e?.[key] || c?.[key] || null; };
  const repeats = new Map();
  for (const d of rows) {
    if (!(d.repeatCount >= 2)) continue;
    const key = `${d.rootCauseId || 'untriaged'}|${d.payerId}`;
    const r = repeats.get(key) || { rootCauseId: d.rootCauseId, rootCause: d.rootCauseId ? rootCauseLabel(d.rootCauseId) : 'Untriaged', payerId: d.payerId, payer: payers.get(d.payerId)?.nameEn || d.payerId, count: 0, amount: 0, maxRepeat: 0 };
    r.count += 1;
    r.amount = cents(r.amount + d.amounts.denied);
    r.maxRepeat = Math.max(r.maxRepeat, d.repeatCount);
    repeats.set(key, r);
  }
  const byGroup = group((d) => rootCause(d.rootCauseId)?.group || 'Untriaged', (k) => k);
  const prevention = byGroup.map((g) => ({
    ...g,
    owner: OWNERS[g.key] || { feature: 'Defensio · Denials — triage first', href: '#/defensio/denials?status=Untriaged' },
    causes: rows.filter((d) => (rootCause(d.rootCauseId)?.group || 'Untriaged') === g.key)
      .reduce((acc, d) => { const id = d.rootCauseId || 'untriaged'; const c = acc.find((x) => x.id === id) || acc[acc.push({ id, label: d.rootCauseId ? rootCauseLabel(id) : 'Not yet triaged', count: 0, amount: 0 }) - 1]; c.count += 1; c.amount = cents(c.amount + d.amounts.denied); return acc; }, [])
      .sort((a, b) => b.amount - a.amount),
  }));
  return {
    range: { from, to },
    months,
    rows,
    totals: {
      count: rows.length,
      amount: cents(rows.reduce((n, d) => n + d.amounts.denied, 0)),
      recovered: cents(rows.reduce((n, d) => n + d.amounts.recovered, 0)),
      open: cents(rows.reduce((n, d) => n + d.amounts.open, 0)),
      claims: new Set(rows.map((d) => d.claimNo)).size,
    },
    reasons: group((d) => d.payerReason?.code || d.code, (k) => denialCodeLabel(k)),
    rootCauses: group((d) => d.rootCauseId || 'untriaged', (k) => (k === 'untriaged' ? 'Not yet triaged' : rootCauseLabel(k))),
    byPayer: group((d) => d.payerId, (k) => payers.get(k)?.nameEn || k),
    byDepartment: group((d) => encField(d, 'department') || 'Not on a visit', (k) => k),
    byServiceLine: group((d) => claimField(d, 'serviceGroup') || claims.itemOf(claimOf(d))?.serviceGroup || '—', (k) => k),
    byDoctor: group((d) => encField(d, 'doctorId') || 'none', (k) => (k === 'none' ? 'No attending on record' : doctorName(k))),
    repeats: [...repeats.values()].sort((a, b) => b.amount - a.amount),
    prevention: prevention.sort((a, b) => b.amount - a.amount),
  };
}

/** Every reason, class, route and cause the worklist's filters list. */
export const filterOptions = () => ({
  codes: DENIAL_CODES,
  classes: router.CLASSES,
  routes: router.ROUTES.map((kind) => ({ kind, label: router.routeLabel(kind) })),
  statuses: router.STATUSES,
  bands: router.AMOUNT_BANDS,
  rootCauses: groupedRootCauses(),
  categories: router.CATEGORIES,
  tiers: router.TIERS,
  separations: router.SEPARATIONS.map((key) => ({ key, label: router.separationLabel(key) })),
});

// --- self-check ----------------------------------------------------------------------------

/**
 * selfCheck() → { pass, failures }. For every denial the six figures add
 * up (denied = recovered + lost + writtenOff + reclassified + transferred +
 * open); over every chain the amendment's buckets add up to the first denied
 * amount; every row names a claim that exists and a line on it. One line on
 * the console.
 */
export function selfCheck() {
  const failures = [];
  const rows = all().filter((d) => d.status !== router.WITHDRAWN);
  for (const d of rows) {
    const a = d.amounts;
    if (Math.abs(a.denied - (a.recovered + a.lost + a.writtenOff + (a.reclassified || 0) + a.transferred + a.open)) >= 0.005) failures.push(`${d.id}: ${usd(a.denied)} ≠ ${usd(a.recovered)} + ${usd(a.lost)} + ${usd(a.writtenOff)} + ${usd(a.reclassified || 0)} + ${usd(a.transferred)} + ${usd(a.open)}`);
    if (!claimOf(d)) failures.push(`${d.id}: claim ${d.claimNo} missing`);
    else if (d.lineId && !lineOf(d)) failures.push(`${d.id}: line ${d.lineId} not on ${d.claimNo}`);
    if (router.isOpen(d) && d.amounts.open <= 0) failures.push(`${d.id}: ${d.status} with nothing open`);
    if (router.isResolved(d) && d.amounts.open > 0) failures.push(`${d.id}: ${d.status} with ${usd(d.amounts.open)} open`);
  }
  for (const d of rows.filter((x) => !x.previousDenialId)) {
    const chain = chainOf(d);
    const sum = chain.reduce((n, x) => n + x.amounts.recovered + x.amounts.lost + x.amounts.writtenOff + (x.amounts.reclassified || 0) + x.amounts.open, 0);
    if (Math.abs(d.amounts.denied - sum) >= 0.005) failures.push(`${d.id} chain: ${usd(d.amounts.denied)} ≠ ${usd(sum)} over ${chain.length} denials`);
  }
  const pass = !failures.length;
  console[pass ? 'info' : 'warn'](`[denials] self-check ${pass ? 'pass' : 'FAIL'} — ${rows.length} denials`, ...(pass ? [] : [failures]));
  return { pass, failures };
}

// --- internals ------------------------------------------------------------------------------

const cents = router.cents;
const byAt = (a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id);
const rank = (d) => (d.status === 'Untriaged' ? 0 : router.isOpen(d) ? 1 : 2);
const byRank = (a, b) => rank(a) - rank(b) || b.amounts.open - a.amounts.open || b.amounts.denied - a.amounts.denied || byAt(b, a);

function recompute(row) {
  const a = row.amounts;
  if (a.reclassified == null) a.reclassified = 0;
  a.open = Math.max(0, cents(a.denied - a.recovered - a.lost - a.writtenOff - a.reclassified - a.transferred));
}

function touch(row, at = null) { row.updatedAt = at || new Date().toISOString(); }

/** A stub-era row (amendment 29's shape, restored from the session) reads as an untriaged denial. */
function upgrade(row) {
  if (row.amounts && row.payerReason && row.status !== 'Open') {
    if (row.amounts.transferred == null) row.amounts.transferred = 0;
    // A31-shaped rows restored from the session read as true denials with the category and tier off their cause.
    if (row.amounts.reclassified == null) row.amounts.reclassified = 0;
    if (row.separation === undefined) row.separation = row.class && row.rootCauseId ? 'True' : null;
    if (row.category === undefined) row.category = rootCause(row.rootCauseId)?.category || null;
    if (row.tier === undefined) row.tier = rootCause(row.rootCauseId)?.tier || null;
    if (row.reclassification === undefined) row.reclassification = null;
    return;
  }
  const claim = claims.get(row.claimId || row.claimNo);
  if (row.status === 'Open') row.status = 'Untriaged';
  Object.assign(row, {
    patientMrn: row.patientMrn || claim?.patientMrn || null,
    encounterNo: row.encounterNo || claim?.encounterNo || null,
    contractId: row.contractId || claim?.contractId || null,
    scope: row.scope || (row.lineId ? 'Line' : 'Claim'),
    payerReason: row.payerReason || { code: row.code || null, text: denialCode(row.code)?.label || row.reason || '' },
    amounts: row.amounts ? { transferred: 0, ...row.amounts } : { ...router.amountsOf({ denied: row.amount }), transferred: 0 },
    class: row.class ?? null,
    rootCauseId: row.rootCauseId ?? null,
    triageNote: row.triageNote || '',
    category: row.category ?? null,
    tier: row.tier ?? null,
    separation: row.separation ?? null,
    reclassification: row.reclassification ?? null,
    route: row.route ?? null,
    routeHistory: row.routeHistory || [],
    assignee: row.assignee ?? null,
    deadline: row.deadline || { appealBy: router.appealBy(row.createdAt, row.payerId), passed: false },
    repeatCount: row.repeatCount || 1,
    previousDenialId: row.previousDenialId ?? null,
    repeats: row.repeats || [],
    resolvedAt: row.resolvedAt ?? null,
    resolution: row.resolution ?? null,
    updatedAt: row.updatedAt || row.createdAt,
  });
}

function monthsBetween(from, to) {
  const out = [];
  const start = new Date(`${String(from).slice(0, 7)}-01T00:00:00Z`);
  const end = new Date(`${String(to).slice(0, 7)}-01T00:00:00Z`);
  for (let d = start; d <= end && out.length < 24; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    out.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }) });
  }
  return out;
}

function log(row, action, details, at, by) {
  audit.all().push({
    id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: row.id, action, details,
    user: by || currentRole().name, at: at || new Date().toISOString(),
  });
}

/**
 * A36 — the half of the seed that needs another register: an intent on a
 * claim assembled from a visit (those claims are seeded once the claim
 * repository's peers settle, after this register's first read) and a route
 * whose work item is a write-off request (the write-off register seeds
 * behind this one). Both wait for the peers, then run through the same
 * writes as the rest of the seed; a row already on the table (restored from
 * the session) is skipped. Scheduled from every build — a reset rebuilds and
 * schedules again — and one commit at the end so the screens redraw.
 * `seedReady` resolves after the first run, which is what the resolution
 * engine waits on before it asserts the ledger.
 */
const deferred = [];
const deferredIntents = [];
let resolveSeedReady;
export const seedReady = new Promise((resolve) => { resolveSeedReady = resolve; });
function scheduleDeferred() {
  Promise.allSettled([peersReady, claims.peersReady]).then(async () => {
    if (peers.writeoffs?.peersReady) await peers.writeoffs.peersReady;
    seeding = true;
    building = true;
    try {
      store.batch(() => {
        let moved = 0;
        // The assembly claims seed on the first read that asks for them; a reset empties them until one does.
        if (deferredIntents.length) claims.ensureAssembled?.();
        for (const intent of deferredIntents.splice(0)) {
          if (store.table(TABLE).some((d) => d.encounterNo === intent.encounterNo && d.seedTag === 'A31')) continue;
          if (buildIntent(seedApi, intent)) moved += 1;
        }
        // The write-off register seeds on its own first read; ask for it before a route writes there.
        if (deferred.length) peers.writeoffs?.all?.();
        for (const { id, kind, at, by } of deferred.splice(0)) {
          const row = get(id);
          if (!row || row.route || !router.isOpen(row)) continue;
          const r = route(id, kind, { reason: null }, { at, by });
          if (r?.error) console.warn('[denials seed] deferred route refused', id, kind, r.error);
          else moved += 1;
        }
        if (moved) store.commit('denials.seed');
      });
    } finally {
      building = false;
      seeding = false;
    }
    resolveSeedReady();
  });
}

/** What the seed drives — this file's own writes, dated by the seed. */
const seedApi = {
  today: todayIso(),
  pickClaim: (payerId, reasonCode, used) => {
    const pool = claims.all()
      .filter((c) => c.payerId === payerId && c.status === 'Denied' && !used.has(c.claimNo) && !c.encounterNo && c.totals.payerShare >= 5)
      .sort((x, y) => y.totals.payerShare - x.totals.payerShare || x.claimNo.localeCompare(y.claimNo));
    const hit = pool.find((c) => c.denialReasonCode === reasonCode) || pool[0] || null;
    if (hit && hit.denialReasonCode !== reasonCode) {
      hit.denialReasonCode = reasonCode;
      for (const l of hit.lines) if (l.status === 'Denied') l.denialReasonCode = reasonCode;
    }
    return hit;
  },
  create,
  assign,
  triage,
  reclassify,
  route,
  defer: (id, kind, { at, by }) => deferred.push({ id, kind, at, by }),
  deferIntent: (intent) => deferredIntents.push(intent),
  // A36 — the primary claim assembled from a visit, moved through the payer's
  // hands so a denial on it can be routed to its chart: submitted, then denied
  // on every line, both moves dated on the claim's own trail. Named by the
  // visit, since claim numbers are read off the table and a reset may deal
  // them in another order.
  denyClaim: (encounterNo, { reasonCode, submittedAt, deniedAt, by }) => {
    const claim = claims.all().find((c) => c.kind === 'Primary' && c.encounterNo === encounterNo && c.status !== 'Void') || null;
    if (!claim || claim.status !== 'Draft' || claim.submittedAt) return claim;
    const restamp = (at, who) => {
      const entries = audit.all();
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const e = entries[i];
        if (e.entity === 'claims' && e.entityId === claim.id && e.action === 'Status') { e.at = at; e.user = who; return; }
      }
    };
    claims.setStatus(claim.id, 'Submitted', { submittedAt, reason: 'Sent to the payer', details: 'Cycle 1 — filed direct' });
    restamp(`${submittedAt}T10:20:00.000Z`, by);
    for (const l of claim.lines) { l.status = 'Denied'; l.denialReasonCode = reasonCode; }
    // No paidAt: the generated dataset leaves it null on a Denied claim, and Performance reads paidAt as paid.
    claims.setStatus(claim.id, 'Denied', { denialReasonCode: reasonCode, reason: 'Answered outside a posted remittance', details: `${claims.denialLabel(reasonCode)} on every line` });
    restamp(`${deniedAt}T09:05:00.000Z`, by);
    return claims.get(claim.id);
  },
  handoffStatus: (id, status, amount) => { const row = get(id); if (row?.route?.ref) handoffs.setStatus(row.route.ref, status, amount); },
  resolveFromHandoff,
  resolveWrittenOff,
  resolveManual,
};

// --- A37: root cause & accountability -------------------------------------------------------

/**
 * retagRootCause(id, rootCauseId, { source, at, by }) → the row or
 * { error }. A concluded root-cause case confirms a cause the triage may not
 * have tagged, so the denial's F1 tag follows it — on a resolved denial too,
 * since the tag is about why it happened and not about what is still open.
 * Only `rootCauseId` moves (class, tier and category stay the desk's
 * reading); the change is audited old → new with the case that made it.
 */
export function retagRootCause(id, rootCauseId, { source = null, at = null, by = null } = {}) {
  const row = get(id);
  if (!row) return { error: 'No such denial' };
  const rc = rootCause(rootCauseId);
  if (!rc) return { error: 'Pick a root cause' };
  if (row.rootCauseId === rootCauseId) return row;
  const was = row.rootCauseId;
  row.rootCauseId = rootCauseId;
  if (row.separation == null) row.separation = 'True';
  if (!row.category) row.category = rc.category || null;
  if (!row.tier) row.tier = rc.tier || null;
  touch(row, at);
  log(row, 'Root cause retagged', `${was ? rootCauseLabel(was) : 'untagged'} → ${rootCauseLabel(rootCauseId)}${source ? ` (${source})` : ''}`, at, by);
  if (!seeding) store.commit('denials.retag');
  return row;
}

// --- A39: appeal tracking & resolution (amendment 39) ---------------------------------------
// The payer's answer to an appeal, per denial and per share. resolveFromAppeal
// above resolves a whole denial one way and chains a settlement's remainder to
// a successor; an appeal outcome is captured per allocation instead — this
// much conceded, this much lost — and lands on the one record. The conceded
// share reads as recovered the moment the payer concedes it (the cash state is
// the expected recovery's, on data/repositories/expected-recoveries.js) and
// the lost share as lost, so the denial is settled when the two cover what is
// open and a remittance that pays the conceded share later finds nothing open
// to take. An escalated share is the exception: it stays open, because the
// level-2 case is raised on an open denial and disputes it again.

/**
 * applyAppealOutcome(id, { recovered, lost, ref, note }, { at, by }) → the row
 * or { error }. `recovered` and `lost` are the case's conceded and lost
 * shares on this denial (an escalated share is passed as neither); together
 * they are at most what is open. Settled when nothing is left open —
 * Recovered, Lost, or Partially Recovered with no successor, read off the
 * denial's own figures — else logged and left open, In Progress.
 */
export function applyAppealOutcome(id, { recovered = 0, lost = 0, ref = null, note = '' } = {}, { at = null, by = null } = {}) {
  const row = get(id);
  if (!row) return { error: 'No such denial' };
  if (!router.isOpen(row)) return { error: `A ${row.status.toLowerCase()} denial takes no appeal outcome` };
  const got = cents(recovered);
  const gone = cents(lost);
  if (got < 0 || gone < 0) return { error: 'A share cannot be negative' };
  if (got + gone > row.amounts.open + 0.005) return { error: `${usd(got + gone)} allocated, ${usd(row.amounts.open)} open on ${row.id}` };
  const when = at || new Date().toISOString();
  row.amounts.recovered = cents(row.amounts.recovered + got);
  row.amounts.lost = cents(row.amounts.lost + gone);
  recompute(row);
  const why = `${[got > 0 && `${usd(got)} conceded`, gone > 0 && `${usd(gone)} lost`].filter(Boolean).join(', ') || 'nothing conceded yet'}${note ? ` — ${note}` : ''}`;
  if (row.amounts.open <= 0) {
    if (row.route?.active) endRoute(row, `Resolved — Appeal${ref ? ` ${ref}` : ''}`, when);
    // Read off what the denial holds, not this call's shares — a partial win lands in two calls, the lost share once it has a disposition.
    const a = row.amounts;
    const status = a.lost <= 0 ? 'Recovered' : a.recovered <= 0 ? 'Lost' : 'Partially Recovered';
    settle(row, status, { kind: 'Appeal', ref, reason: why, manual: false }, when, by);
  } else {
    row.status = 'In Progress';
    touch(row, when);
    log(row, 'Appeal outcome', `${why} · ${usd(row.amounts.open)} still open${ref ? ` · ${ref}` : ''}`, when, by);
  }
  if (!seeding) store.commit('denials.resolve');
  return row;
}

// --- A38: the appeal case talks back --------------------------------------------------------
// Three helpers the appeal register calls; nothing above changes. A case
// submitted to the payer is a line on the denial's trail (the route already
// names the case, so the status stays Routed and the deadline reads met); a
// case withdrawn before submission ends the Appeal route and hands the
// denial back to the worklist as Triaged, for a second triage or another
// route; a level-2 case re-points the route at itself so `linkOf` and
// `resolveFromAppeal(caseId)` follow the chain.

/** markAppealSubmitted(denialId, { caseId, method, reference, submittedAt, late }, { at, by }) → the row or null. */
export function markAppealSubmitted(denialId, { caseId, method, reference, submittedAt, late = false } = {}, { at = null, by = null } = {}) {
  const row = get(denialId);
  if (!row) return null;
  const when = at || new Date().toISOString();
  if (row.route?.kind === 'Appeal' && row.route.active) row.route.submittedAt = submittedAt || iso(when);
  touch(row, when);
  log(row, 'Appeal submitted', `${caseId || 'Appeal'} · ${method || '—'} · ref ${reference || '—'} · filed ${submittedAt || iso(when)}${late ? ' · late filing' : ''}`, when, by);
  if (!seeding) store.commit('denials.update');
  return row;
}

/** releaseAppealRoute(denialId, { caseId, reason }, { at, by }) → the row back on the worklist as Triaged, or null. */
export function releaseAppealRoute(denialId, { caseId, reason = '' } = {}, { at = null, by = null } = {}) {
  const row = get(denialId);
  if (!row || !router.isOpen(row)) return row || null;
  const when = at || new Date().toISOString();
  if (row.route?.kind === 'Appeal' && (!caseId || row.route.ref === caseId)) {
    endRoute(row, `Appeal ${caseId || ''} withdrawn — ${reason || 'no reason given'}`.trim(), when);
    row.status = row.class && row.rootCauseId ? 'Triaged' : 'Untriaged';
    touch(row, when);
    log(row, 'Route ended', `Appeal ${caseId || ''} withdrawn before submission — ${reason || 'no reason given'} · back for re-triage`.trim(), when, by);
    if (!seeding) store.commit('denials.route');
  }
  return row;
}

/** repointAppealRoute(denialId, { caseId, level }, { at, by }) → the row, its Appeal route now naming the level-2 case. */
export function repointAppealRoute(denialId, { caseId, level = 2 } = {}, { at = null, by = null } = {}) {
  const row = get(denialId);
  if (!row || row.route?.kind !== 'Appeal') return row || null;
  const when = at || new Date().toISOString();
  const previous = row.route.ref;
  row.route = { ...row.route, ref: caseId, level, previousRef: previous };
  touch(row, when);
  log(row, 'In progress', `Level ${level} appeal ${caseId} raised after ${previous || 'the first case'}`, when, by);
  if (!seeding) store.commit('denials.update');
  return row;
}
