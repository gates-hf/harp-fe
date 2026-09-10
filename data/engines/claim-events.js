// Engine — claim events and the lifecycle read on top of them. Owner:
// modules/claima (amendment 30). Pure reads: no DOM, no writes, no screen
// state. Import it as `lifecycle` — the future Claima home reads
// `escalated()` and `silent()` from here.
//
// A claim event is derived, never stored. The timeline is built from the audit
// trail keyed on the claim, from the claim's own stamps where the trail is
// silent (the 600 generated claims carry no trail), and from the registers
// beside it — batches, remittances, denials, hand-offs and follow-ups. The
// three Claima peers are loaded dynamically and feature-detected, so the
// timeline works before any of them exists and gains their events the moment
// they do. Silence and escalation are computed on every read from the last
// thing the payer did, so a remittance or an acknowledgment clears them by
// arriving — there is nothing to reset.

import { store } from '../store.js';
import * as claims from '../repositories/claims.js';
import * as audit from '../repositories/audit.js';
import * as handoffs from '../repositories/handoffs.js';
import * as followups from '../repositories/followups.js';
import * as payers from '../repositories/payers.js';
import { CONFIG } from '../../shared/config.js';
import { iso, todayIso, usd, compareDates } from '../../shared/format.js';

export const TYPES = [
  'Assembled', 'Refreshed', 'Scrubbed', 'Finalized', 'Reopened', 'Batched', 'FileGenerated', 'Submitted',
  'Acknowledged', 'Rejected', 'Resubmitted', 'RemittancePosted', 'Denied', 'HandedOff', 'PatientShift',
  'FollowUp', 'Escalated', 'Closed',
];

/** The events that are the payer speaking — what silence is measured from. */
export const PAYER_TYPES = ['Acknowledged', 'Rejected', 'RemittancePosted', 'Denied'];

/** The status a lifecycle event puts the claim in, for days-in-status. */
const STATUS_OF = {
  Assembled: 'Draft', Reopened: 'Draft', Finalized: 'Ready', Submitted: 'Submitted', Acknowledged: 'Acknowledged',
  Rejected: 'Rejected', Denied: 'Denied', Closed: 'Closed',
};

export const BOARD_COLUMNS = CONFIG.claima?.lifecycle?.boardColumns || claims.STATUSES.filter((s) => s !== 'Void');

export const BUCKETS = [
  { id: 'b1', label: '0 – 15', min: 0, max: 15 },
  { id: 'b2', label: '16 – 30', min: 16, max: 30 },
  { id: 'b3', label: '31 – 60', min: 31, max: 60 },
  { id: 'b4', label: '60+', min: 61, max: Infinity },
];

// --- peers ------------------------------------------------------------------------

const peers = { batches: null, remittances: null, denials: null };

export const peerStatus = () => ({
  batches: Boolean(peers.batches), remittances: Boolean(peers.remittances), denials: Boolean(peers.denials),
});

const PEERS = [['batches', '../repositories/batches.js'], ['remittances', '../repositories/remittances.js'], ['denials', '../repositories/denials.js']];

/**
 * The follow-up seed runs after the peer registers have seeded, since those
 * seeds move the claims they touch: a call seeded against a claim the
 * remittance seed then pays would be a call about nothing. Reading each
 * register is what seeds it; the same runs again after a reset.
 */
function seedFollowups() {
  for (const mod of Object.values(peers)) mod?.all?.();
  followups.seed();
}

/** Settles once each peer has loaded or been found missing — a screen redraws on it. */
export const peersReady = Promise.allSettled(PEERS.map(([key, path]) => import(path).then((mod) => { peers[key] = mod; })))
  .then(seedFollowups);
store.subscribe((reason) => { if (reason === 'reset') queueMicrotask(seedFollowups); });

// --- thresholds -------------------------------------------------------------------

const LIFECYCLE = CONFIG.claima?.lifecycle || {};

/** The silent or escalation threshold for a claim's payer, in days. */
export function thresholdFor(claim, which = 'silentDays') {
  const knob = LIFECYCLE[which] || {};
  return Number(knob.byPayer?.[claim?.payerId] ?? knob.default ?? (which === 'silentDays' ? 30 : 60));
}

// --- the timeline -----------------------------------------------------------------

/**
 * byClaim(claimNo) → the claim's events in order, each
 * { at, type, actor, summary, link: { label, href } | null, sourceId, status? }.
 * `index` is an optional map of claim id → audit entries, built once by the
 * board and the aging table so 600 claims do not each scan the whole trail.
 */
export function byClaim(claimNo, index = null) {
  const claim = claims.get(claimNo);
  if (!claim) return [];
  const out = [];
  const trail = index ? (index.get(claim.id) || []) : claims.history(claim.id);
  for (const entry of [...trail].reverse()) {
    const ev = fromAudit(entry, claim);
    if (ev) out.push(ev);
  }
  fromStamps(claim, out);
  fromPeers(claim, out);
  for (const f of followups.byClaim(claim.claimNo)) {
    out.push(event(f.at, 'FollowUp', f.by, `${f.method} · ${f.contact || 'no contact named'} — ${f.note || 'no note'}${
      f.nextDueAt ? ` · next due ${f.nextDueAt}` : ''}`, link('Follow-ups', '#/claima/followups'), f.id));
  }
  const esc = escalatedAt(claim, out);
  if (esc) {
    out.push(event(esc, 'Escalated', 'System',
      `Escalated — silent ${silentDaysOf(claim, out)} days, the threshold for ${payerName(claim)} is ${thresholdFor(claim, 'escalationDays')}`,
      link('Follow-ups', `#/claima/followups?payerId=${claim.payerId}`), `${claim.claimNo}:escalated`));
  }
  return out.sort((a, b) => String(a.at).localeCompare(String(b.at)) || TYPES.indexOf(a.type) - TYPES.indexOf(b.type));
}

const event = (at, type, actor, summary, lnk = null, sourceId = null, extra = {}) =>
  ({ at, type, actor: actor || 'System', summary, link: lnk, sourceId, ...extra });
const link = (label, href) => ({ label, href });
const claimLink = (claim, tab = '') => link(claim.claimNo, `#/claima/claims/${claim.claimNo}${tab ? `/${tab}` : ''}`);
const payerName = (claim) => payers.get(claim.payerId)?.nameEn || claim.payerId || 'the payer';

/** One audit entry on the claim → one event, or null for the entries the History tab keeps to itself. */
function fromAudit(entry, claim) {
  const { action, details = '', user, at, id } = entry;
  const mk = (type, summary, lnk, extra) => event(at, type, user, summary, lnk || claimLink(claim), id, extra);
  if (action === 'Created') return mk('Assembled', details || 'Assembled', claimLink(claim, 'lines'), { status: 'Draft' });
  if (action === 'Refreshed') return mk('Refreshed', details, claimLink(claim, 'history'));
  if (action === 'Late charge added') return mk('Refreshed', `Late charge — ${details}`, claimLink(claim, 'lines'));
  if (action === 'Scrubbed') return mk('Scrubbed', details, claimLink(claim, 'scrub'));
  if (action === 'Follow-up') return null; // read from the register, with its own fields
  if (action === 'Batched' || action === 'Unbatched') {
    const no = batchNoIn(details);
    return event(at, 'Batched', user, details, no ? link(no, `#/claima/submission/${no}`) : claimLink(claim), no || id);
  }
  if (action === 'Resubmitted') return mk('Resubmitted', details, claimLink(claim, 'history'));
  if (action === 'Activated') return mk('Assembled', details, claimLink(claim, 'lines'), { status: 'Draft' });
  if (action === 'Deactivated') return mk('Reopened', `Deactivated — ${details}`, claimLink(claim), { status: 'Draft' });
  if (action !== 'Status') return null;
  const m = /^(.+?) → (.+?)(?: — (.*))?$/.exec(details);
  if (!m) return null;
  const [, from, to, why = ''] = m;
  const note = why ? ` — ${why}` : '';
  if (to === 'Ready') return mk('Finalized', `Finalized${note}`, claimLink(claim), { status: 'Ready' });
  if (to === 'Draft' && from === 'Ready') return mk('Reopened', `Reopened${note}`, claimLink(claim), { status: 'Draft' });
  if (to === 'Draft') return mk('Reopened', `Back to draft from ${from}${note}`, claimLink(claim), { status: 'Draft' });
  const batch = batchLink(claim, details);
  const remit = remittanceLink(claim, details);
  if (to === 'Submitted') return mk('Submitted', `Submitted to ${payerName(claim)}${note}`, batch || claimLink(claim), { status: 'Submitted' });
  if (to === 'Acknowledged') return mk('Acknowledged', `Acknowledged by ${payerName(claim)}${note}`, batch || claimLink(claim), { status: 'Acknowledged' });
  if (to === 'Rejected') return mk('Rejected', `Rejected by ${payerName(claim)}${note}`, batch || claimLink(claim), { status: 'Rejected' });
  // A posting's status line names its remittance, which is the key the
  // remittance register's own event carries — one of the two is enough.
  const remitNo = remittanceNoIn(details);
  if (to === 'Paid' || to === 'Partially Paid') {
    return event(at, 'RemittancePosted', user, `${to}${note}`, remit || claimLink(claim), remitNo || id, { status: to });
  }
  if (to === 'Denied') return event(at, 'Denied', user, `Denied${note}`, remit || claimLink(claim), remitNo || id, { status: 'Denied' });
  if (to === 'Appealed') return mk('Denied', `Appealed${note}`, claimLink(claim), { status: 'Appealed' });
  if (to === 'Closed') return mk('Closed', `Closed${note}`, claimLink(claim), { status: 'Closed' });
  if (to === 'Void') return mk('Closed', `Voided${note}`, claimLink(claim), { status: 'Void' });
  return null;
}

const has = (out, type, day = null) =>
  out.some((e) => e.type === type && (!day || iso(e.at) === iso(day)));

/**
 * What the claim's own fields say where the trail says nothing. A generated
 * claim carries createdAt, submittedAt and paidAt and no trail at all; a claim
 * the submission feature moved carries acknowledgedAt and rejection as well.
 * An acknowledgment nobody stamped is read off the SLA that made the claim
 * Acknowledged in the first place, and says so.
 */
function fromStamps(claim, out) {
  const n = (claim.lines || []).length;
  const submittedAt = claim.submission?.at || claim.submittedAt;
  if (!has(out, 'Assembled')) {
    // A claim is assembled before it is sent; a generated row stamped the day
    // after its date of service can carry a createdAt later than its
    // submission, and the earlier of the two is when it existed.
    const born = [claim.createdAt, submittedAt && stamp(submittedAt, '08:00')].filter(Boolean).sort()[0];
    out.push(event(born, 'Assembled', claim.createdBy || 'System',
      `Assembled — ${n} line${n === 1 ? '' : 's'} · ${usd(claim.totals?.payerShare)} to ${payerName(claim)}`,
      claimLink(claim, 'lines'), null, { status: 'Draft', derived: true }));
  }
  if (submittedAt && !has(out, 'Submitted')) {
    const s = claim.submission || {};
    out.push(event(stamp(submittedAt, '09:00'), 'Submitted', s.by || 'System',
      `Submitted to ${payerName(claim)}${s.method ? ` via ${s.method}` : ''}${s.reference ? ` · ref ${s.reference}` : ''}${
        s.batchNo ? ` · batch ${s.batchNo}` : ''}`,
      batchLink(claim) || claimLink(claim), s.batchNo || null, { status: 'Submitted' }));
  }
  if (!has(out, 'Acknowledged')) {
    if (claim.acknowledgedAt) {
      out.push(event(stamp(claim.acknowledgedAt, '10:00'), 'Acknowledged', payerName(claim),
        `Acknowledged by ${payerName(claim)}`, batchLink(claim) || claimLink(claim), null, { status: 'Acknowledged' }));
    } else if (claim.status === 'Acknowledged' && submittedAt) {
      const sla = Number(CONFIG.claima?.ackSlaDays) || 3;
      out.push(event(stamp(shift(submittedAt, sla), '10:00'), 'Acknowledged', payerName(claim),
        `Acknowledged — read off the ${sla}-day acknowledgment SLA; the payer's own stamp is not on file`,
        claimLink(claim), null, { status: 'Acknowledged', derived: true }));
    }
  }
  if (claim.rejection?.at && !has(out, 'Rejected')) {
    out.push(event(stamp(claim.rejection.at, '10:30'), 'Rejected', payerName(claim),
      `Rejected — ${claim.rejection.code || ''}${claim.rejection.reason ? ` ${claim.rejection.reason}` : ''}`.trim(),
      batchLink(claim) || claimLink(claim), null, { status: 'Rejected' }));
  }
  // A resubmission that is a claim of its own (the submission feature keeps
  // the number and counts cycles on the same row, so this is for a design that
  // does not); a cycle number that resolves to no claim is not an event.
  const next = claim.nextCycleNo ? claims.get(claim.nextCycleNo) : null;
  if (next && !has(out, 'Resubmitted')) {
    out.push(event(next.createdAt, 'Resubmitted', next.createdBy || 'System',
      `Resubmitted as ${next.claimNo}${next.cycle ? ` (cycle ${next.cycle})` : ''}`,
      link(next.claimNo, `#/claima/claims/${next.claimNo}`), next.claimNo));
  }
  if (claim.paidAt && !has(out, 'RemittancePosted')) {
    const t = claim.totals || {};
    out.push(event(stamp(claim.paidAt, '11:00'), 'RemittancePosted', payerName(claim),
      `Remittance posted — paid ${usd(t.paid)}${t.adjusted ? `, adjusted ${usd(t.adjusted)}` : ''}${
        claim.status === 'Partially Paid' ? ` · ${usd(Math.max(0, (t.payerShare || 0) - (t.paid || 0) - (t.adjusted || 0)))} short` : ''}`,
      remittanceLink(claim) || claimLink(claim), claim.remittanceId || null, { status: claim.status === 'Partially Paid' ? 'Partially Paid' : 'Paid' }));
  }
  if (claims.isDenied(claim) && !has(out, 'Denied')) {
    const when = claim.paidAt || submittedAt || claim.createdAt;
    out.push(event(stamp(when, '11:30'), 'Denied', payerName(claim),
      `Denied — ${claims.denialLabel(claim.denialReasonCode)}${claim.status === 'Appealed' ? ' · under appeal' : ''}${
        claim.paidAt ? '' : ' · answer date not on file, shown at submission'}`,
      remittanceLink(claim) || claimLink(claim), claim.remittanceId || null, { status: claim.status, derived: !claim.paidAt }));
  }
  if (claim.status === 'Closed' && !has(out, 'Closed')) {
    out.push(event(stamp(claim.paidAt || submittedAt || claim.createdAt, '12:00'), 'Closed', 'System', 'Closed', claimLink(claim), null, { status: 'Closed' }));
  }
  const ho = handoffs.forClaim(claim.id);
  if (ho) {
    out.push(event(ho.createdAt, 'HandedOff', ho.createdBy,
      `Handed off to Defensio — ${usd(ho.amount)} · ${ho.reason}${ho.status !== 'Handed off' ? ` · ${ho.status}` : ''}`,
      link('Defensio', handoffs.DEFENSIO_PATH), ho.id));
  }
}

/** The batch, remittance and denial registers, when they are loaded. */
function fromPeers(claim, out) {
  const b = peers.batches;
  for (const row of (b?.byClaim ? b.byClaim(claim.claimNo) : []) || []) {
    const batch = b.get?.(row.batchNo) || row;
    const href = `#/claima/submission/${row.batchNo}`;
    const at = batch.createdAt || row.submittedAt || claim.submittedAt || claim.createdAt;
    if (!out.some((e) => e.type === 'Batched' && e.sourceId === row.batchNo)) {
      out.push(event(at, 'Batched', batch.createdBy || 'System',
        `Added to batch ${row.batchNo}${row.cycle > 1 ? ` (cycle ${row.cycle})` : ''}${row.status ? ` · ${row.status}` : ''}`,
        link(row.batchNo, href), row.batchNo));
    }
    const gen = b.latestGeneration?.(batch);
    if (gen?.at && !out.some((e) => e.type === 'FileGenerated' && e.sourceId === row.batchNo)) {
      out.push(event(gen.at, 'FileGenerated', gen.by || 'System',
        `Submission file v${gen.version} generated — ${(gen.files || []).length} file${(gen.files || []).length === 1 ? '' : 's'}`,
        link(row.batchNo, `${href}/files`), row.batchNo));
    }
    const sub = batch.submission || (row.submittedAt ? { at: row.submittedAt, method: row.method, reference: row.reference } : null);
    if (sub?.at && !has(out, 'Submitted', sub.at)) {
      out.push(event(sub.at, 'Submitted', sub.by || 'System',
        `Submitted in ${row.batchNo}${sub.method ? ` via ${sub.method}` : ''}${sub.reference ? ` · ref ${sub.reference}` : ''}`,
        link(row.batchNo, `${href}/submission`), row.batchNo, { status: 'Submitted' }));
    }
    const ack = batch.acknowledgment;
    if (ack?.at && !has(out, 'Acknowledged', ack.at)) {
      out.push(event(ack.at, 'Acknowledged', payerName(claim),
        `Batch ${row.batchNo} acknowledged${ack.payerRef ? ` · payer ref ${ack.payerRef}` : ''}`,
        link(row.batchNo, `${href}/acknowledgment`), row.batchNo, { status: 'Acknowledged' }));
    }
  }
  const r = peers.remittances;
  for (const row of (r?.byClaim ? r.byClaim(claim.claimNo) : []) || []) {
    const href = `#/claima/remittances/${row.remittanceNo}`;
    if (!out.some((e) => e.type === 'RemittancePosted' && e.sourceId === row.remittanceNo)) {
      // The audit line for the same posting carries the status; this one carries the money.
      const dup = out.findIndex((e) => e.type === 'RemittancePosted' && !e.sourceId && iso(e.at) === iso(row.at));
      if (dup >= 0) out.splice(dup, 1);
      out.push(event(row.at, 'RemittancePosted', row.by || payerName(claim),
        `Remittance ${row.remittanceNo} — paid ${usd(row.paid)}${row.adjusted ? `, adjusted ${usd(row.adjusted)}` : ''}${
          row.denied ? `, denied ${usd(row.denied)}` : ''}`,
        link(row.remittanceNo, href), row.remittanceNo, { status: row.denied && !row.paid ? 'Denied' : claim.status }));
    }
    const shifted = (row.lines || []).reduce((n, l) => n + (Number(l.patientShift) || 0), 0);
    if (shifted > 0 && !out.some((e) => e.type === 'PatientShift' && e.sourceId === row.remittanceNo)) {
      out.push(event(row.at, 'PatientShift', row.by || 'System',
        `${usd(shifted)} shifted to the patient on remittance ${row.remittanceNo}`, link(row.remittanceNo, `${href}/postings`), row.remittanceNo));
    }
  }
  const d = peers.denials;
  for (const row of (d?.byClaim ? d.byClaim(claim.claimNo) : []) || []) {
    if (out.some((e) => e.type === 'Denied' && e.sourceId === row.id)) continue;
    // The trail's own status line for the same posting already says Denied.
    if (has(out, 'Denied', row.createdAt || row.at) && !out.some((e) => e.type === 'Denied' && e.derived)) continue;
    const dup = out.findIndex((e) => e.type === 'Denied' && e.derived);
    if (dup >= 0) out.splice(dup, 1);
    out.push(event(row.createdAt || row.at, 'Denied', payerName(claim),
      `Denied — ${row.code || ''}${row.reason ? ` ${row.reason}` : ''}${row.amount ? ` · ${usd(row.amount)}` : ''}${
        row.status === 'Reversed' ? ' · reversed' : ''}`.trim(),
      // A36 — the denial's own page is Defensio's; the remittance is a click away from it.
      link(row.id, `#/defensio/denials/${row.id}`),
      row.id, { status: 'Denied' }));
  }
}

const batchNoIn = (text) => (/(BAT-[\w-]+)/.exec(String(text || '')) || [])[1] || null;
const remittanceNoIn = (text) => (/(RMT-[\w-]+)/.exec(String(text || '')) || [])[1] || null;
const batchLink = (claim, text = '') => {
  const no = batchNoIn(text) || claim.submission?.batchNo || claim.batchId;
  return no ? link(no, `#/claima/submission/${no}`) : null;
};
const remittanceLink = (claim, text = '') => {
  const no = remittanceNoIn(text) || claim.remittanceId;
  return no ? link(no, `#/claima/remittances/${no}`) : null;
};

// --- silence, escalation, days in status ------------------------------------------

/** The last thing the payer did on a claim, or null. */
export function lastPayerEvent(claimNo, events = null) {
  const list = events || byClaim(claimNo);
  return [...list].reverse().find((e) => PAYER_TYPES.includes(e.type)) || null;
}

/** When the claim entered the status it is in now — the newest event that put it there. */
export function statusSince(claim, events = null) {
  const list = events || byClaim(claim.claimNo);
  const mine = [...list].reverse().find((e) => e.status === claim.status)
    || [...list].reverse().find((e) => STATUS_OF[e.type] === claim.status);
  return mine?.at || claim.paidAt || claim.submittedAt || claim.createdAt;
}

export const daysInStatus = (claim, events = null) => daysSince(statusSince(claim, events));

/** Days since the payer last spoke — since submission when it never has. */
export function silentDays(claim, events = null) {
  const list = events || byClaim(claim.claimNo);
  return silentDaysOf(claim, list);
}

function silentDaysOf(claim, list) {
  const last = lastPayerEvent(claim.claimNo, list);
  return daysSince(last?.at || claim.submission?.at || claim.submittedAt || claim.createdAt);
}

/** When the claim crossed the escalation threshold, or null while it has not. */
function escalatedAt(claim, list) {
  if (!claims.isPending(claim)) return null;
  const last = lastPayerEvent(claim.claimNo, list);
  const base = last?.at || claim.submission?.at || claim.submittedAt;
  if (!base) return null;
  const days = thresholdFor(claim, 'escalationDays');
  const at = shift(iso(base), days);
  return compareDates(at, todayIso()) <= 0 ? `${at}T00:00:00.000Z` : null;
}

export const isSilent = (claim, events = null) =>
  claims.isPending(claim) && silentDays(claim, events) >= thresholdFor(claim, 'silentDays');
export const isEscalated = (claim, events = null) =>
  claims.isPending(claim) && silentDays(claim, events) >= thresholdFor(claim, 'escalationDays');

export const bucketOf = (days) => BUCKETS.find((b) => days >= b.min && days <= b.max) || BUCKETS[BUCKETS.length - 1];

/** A status nothing is waiting on: days spent in it are age, not delay. */
export const SETTLED = ['Paid', 'Closed', 'Void'];

/**
 * The card's colour for days in a status: amber past 15, red past 30 — on a
 * status somebody is still waiting on. A claim paid in March has sat in Paid
 * for months and that is not a warning.
 */
export const daysTone = (days, status = '') =>
  (SETTLED.includes(status) ? '' : days > 30 ? 'critical' : days > 15 ? 'warning' : '');

// --- family -----------------------------------------------------------------------

/**
 * family(claimNo) → { original, cycles, supplementary, secondary, members, current }
 * — the original primary, every resubmission of it in order, and the
 * supplementary and secondary claims hanging off any cycle (with their own
 * resubmissions). Walks both ways, so it answers the same from any member.
 */
export function family(claimNo) {
  const current = claims.get(claimNo);
  if (!current) return null;
  let primary = current;
  const seen = new Set();
  while (primary.parentClaimNo && !seen.has(primary.claimNo)) {
    seen.add(primary.claimNo);
    const parent = claims.get(primary.parentClaimNo);
    if (!parent) break;
    primary = parent;
  }
  const original = firstCycle(primary);
  const cycles = cyclesOf(original);
  const children = cycles.flatMap((c) => claims.chainOf(c).children);
  const uniq = (list) => [...new Map(list.map((c) => [c.claimNo, c])).values()];
  const supplementary = uniq(children.filter((c) => claims.kindOf(c) === 'Supplementary').flatMap((c) => cyclesOf(firstCycle(c))));
  const secondary = uniq(children.filter((c) => claims.kindOf(c) === 'Secondary').flatMap((c) => cyclesOf(firstCycle(c))));
  return { original, cycles, supplementary, secondary, members: uniq([...cycles, ...supplementary, ...secondary]), current };
}

function firstCycle(claim) {
  let c = claim;
  const seen = new Set();
  while (c.previousCycleNo && !seen.has(c.claimNo)) {
    seen.add(c.claimNo);
    c = claims.get(c.previousCycleNo) || c;
    if (seen.has(c.claimNo)) break;
  }
  return c;
}

function cyclesOf(first) {
  const out = [first];
  const seen = new Set([first.claimNo]);
  let c = first;
  while (c.nextCycleNo && !seen.has(c.nextCycleNo)) {
    const next = claims.get(c.nextCycleNo);
    if (!next) break;
    seen.add(next.claimNo);
    out.push(next);
    c = next;
  }
  return out;
}

/** The claim that stands for a family on a collapsed board: its newest cycle. */
export const familyHead = (claimNo) => {
  const f = family(claimNo);
  return f ? f.cycles[f.cycles.length - 1] : null;
};

/** "Cycle 2", "Supp" or "Secondary" — the kind chip on a card. Primary cycle 1 says nothing. */
export function kindLabel(claim) {
  const kind = claims.kindOf(claim);
  if (kind === 'Supplementary') return 'Supp';
  if (kind === 'Secondary') return 'Secondary';
  const cycle = Number(claim.cycle) || (claim.previousCycleNo ? 2 : 1);
  return cycle > 1 ? `Cycle ${cycle}` : '';
}

// --- the lifecycle reads ----------------------------------------------------------

/** claim id → its audit entries, oldest first — one pass over the trail for a whole board. */
export function auditIndex() {
  const index = new Map();
  for (const row of audit.all()) {
    if (row.entity !== 'claims') continue;
    (index.get(row.entityId) || index.set(row.entityId, []).get(row.entityId)).push(row);
  }
  for (const list of index.values()) list.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return index;
}

/**
 * visible({ q, payerId, department, type, band, age, from, to, status }) → the
 * claims the board and the aging table both draw, so their totals agree by
 * construction. Void claims are never on the board.
 */
export function visible({
  q = '', payerId = '', department = '', type = '', band = '', age = '', from = '', to = '', status = '',
} = {}) {
  claims.ensureAssembled?.();
  return claims.search(q, { payerId, from, to, status })
    .filter((c) => BOARD_COLUMNS.includes(c.status))
    .filter((c) => !department || c.department === department)
    .filter((c) => !type || c.encounterType === type)
    .filter((c) => !band || claims.valueBandOf(c).id === band)
    .filter((c) => !age || claims.ageBandOf(c).id === age);
}

/**
 * annotate(rows) → [{ claim, events, days, tone, bucket, silent, escalated, kind }]
 * — every derived figure a card or a cell reads, computed once per claim.
 */
export function annotate(rows, index = auditIndex()) {
  return rows.map((claim) => {
    const events = byClaim(claim.claimNo, index);
    const days = daysInStatus(claim, events);
    const silent = claims.isPending(claim) ? silentDaysOf(claim, events) : 0;
    return {
      claim,
      events,
      days,
      tone: daysTone(days, claim.status),
      bucket: bucketOf(days),
      silent,
      isSilent: claims.isPending(claim) && silent >= thresholdFor(claim, 'silentDays'),
      escalated: claims.isPending(claim) && silent >= thresholdFor(claim, 'escalationDays'),
      kind: kindLabel(claim),
    };
  });
}

/**
 * board(filters, { collapse, bucket }) → { columns: [{ status, count, value, cards }], total }.
 * Collapsed, one card stands for a family — its newest cycle, carrying the
 * count of the members folded under it — in the column that head is in.
 */
export function board(filters = {}, { collapse = false, bucket = '' } = {}) {
  let cards = annotate(visible(filters));
  if (bucket) cards = cards.filter((a) => a.bucket.id === bucket);
  if (collapse) {
    const byFamily = new Map();
    for (const a of cards) {
      const key = (family(a.claim.claimNo)?.original || a.claim).claimNo;
      (byFamily.get(key) || byFamily.set(key, []).get(key)).push(a);
    }
    // The head is the family's newest cycle; when the filters left it out, the
    // member that moved most recently stands in for it.
    cards = [...byFamily.values()].map((members) => {
      const headNo = familyHead(members[0].claim.claimNo)?.claimNo;
      const head = members.find((m) => m.claim.claimNo === headNo)
        || [...members].sort((x, y) => x.days - y.days)[0];
      return { ...head, family: members.length };
    });
  }
  const columns = BOARD_COLUMNS.map((status) => {
    const mine = cards.filter((a) => a.claim.status === status)
      .sort((x, y) => y.days - x.days || x.claim.claimNo.localeCompare(y.claim.claimNo));
    return { status, count: mine.length, value: money(mine.map((a) => a.claim)), cards: mine };
  });
  return { columns, total: { count: cards.length, value: money(cards.map((a) => a.claim)) } };
}

/**
 * aging(filters) → { buckets, rows: [{ status, cells: [{ bucket, count, value }], count, value }], totals, grand }
 * over days in status, one row per board column — the same claims the board
 * draws, so the two reconcile.
 */
export function aging(filters = {}) {
  const cards = annotate(visible(filters));
  const rows = BOARD_COLUMNS.map((status) => {
    const mine = cards.filter((a) => a.claim.status === status);
    const cells = BUCKETS.map((bucket) => {
      const inBucket = mine.filter((a) => a.bucket.id === bucket.id).map((a) => a.claim);
      return { bucket, count: inBucket.length, value: money(inBucket) };
    });
    return { status, cells, count: mine.length, value: money(mine.map((a) => a.claim)) };
  });
  const totals = BUCKETS.map((bucket, i) => ({
    bucket, count: rows.reduce((n, r) => n + r.cells[i].count, 0), value: cents(rows.reduce((n, r) => n + r.cells[i].value, 0)),
  }));
  return {
    buckets: BUCKETS, rows, totals,
    grand: { count: cards.length, value: money(cards.map((a) => a.claim)) },
  };
}

/** Submitted or Acknowledged claims silent past their payer's threshold, longest silence first. */
export function silent(payerId = '') {
  // Only a claim with the payer can be silent, and the assembly seed never
  // writes one — so this read does not force that seed the way the board does.
  const index = auditIndex();
  return annotate(claims.all().filter((c) => claims.isPending(c) && (!payerId || c.payerId === payerId)), index)
    .filter((a) => a.isSilent)
    .sort((x, y) => y.silent - x.silent || x.claim.claimNo.localeCompare(y.claim.claimNo));
}

/** The silent claims past the escalation threshold as well — what the home screen counts. */
export const escalated = (payerId = '') => silent(payerId).filter((a) => a.escalated);

/** The queue's three figures over one payer or all of them. */
export function queueStats(payerId = '') {
  const rows = silent(payerId);
  const due = new Set(followups.dueOn());
  return {
    silentCount: rows.length,
    silentValue: money(rows.map((a) => a.claim)),
    escalated: rows.filter((a) => a.escalated).length,
    escalatedValue: money(rows.filter((a) => a.escalated).map((a) => a.claim)),
    dueToday: rows.filter((a) => due.has(a.claim.claimNo)).length,
  };
}

// --- internals ----------------------------------------------------------------------

const money = (rows) => cents(rows.reduce((n, c) => n + (Number(c.totals?.payerShare) || 0), 0));
const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;
const daysSince = (at) => {
  const day = iso(at);
  if (!day) return 0;
  return Math.max(0, Math.round((Date.parse(`${todayIso()}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86400000));
};
const shift = (isoDate, days) => new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
/** A date-only stamp, given a time of day so it sorts among timestamps rather than before them all. */
const stamp = (value, time) => (String(value || '').length > 10 ? String(value) : `${iso(value)}T${time}:00.000Z`);
