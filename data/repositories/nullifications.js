// Repository — claim nullifications. Owner: modules/claima (amendment 32).
//
// A nullification is the desk withdrawing a claim outright: not a fix and a
// resubmission, not the payer's answer, but the record that the claim should
// not have existed in this shape. It is immutable — one write, `nullify`, and
// no update or delete — and it decides three things the claim repository
// then carries out: the path (what the claim's status allows), the gates (the
// reason, the role, the second signature above the threshold) and the
// disposition (where the claim's charge lines go). Blocked statuses are not
// nullified here at all: a paid claim is undone by reversing its posting, a
// denied one is worked from its denial, and `pathFor` names the screen.
//
// Reads claims, batches and charges, which never read this file; the two
// registers it only routes to — remittances and denials — arrive by dynamic
// import and are feature-detected. The table seeds itself once the claim
// repository's peers have settled (data/seed/nullifications.js), the shape
// the follow-up seed uses, so a seeded record sits on a claim the other
// seeds have finished with.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as claims from './claims.js';
import * as batches from './batches.js';
import * as charges from './charges.js';
import * as encounters from './encounters.js';
import * as patients from './patients.js';
import * as payers from './payers.js';
import * as policies from './policies.js';
import * as cdm from './cdm.js';
import { CONFIG } from '../../shared/config.js';
import { ROLES, current as currentRole } from '../../shared/roles.js';
import { compareDates, iso, todayIso } from '../../shared/format.js';
import {
  NULLIFICATION_REASONS, nullificationReason, nullificationLabel, reasonNeedsText,
  PATHS, PATH_LABELS, DISPOSITIONS, DISPOSITION_LABELS, NOTIFICATION_METHODS,
} from '../seed/nullification-reasons.js';
import { buildNullifications } from '../seed/nullifications.js';

const TABLE = 'nullifications';
const ENTITY = 'nullifications';

export {
  NULLIFICATION_REASONS, nullificationReason, nullificationLabel, reasonNeedsText,
  PATHS, PATH_LABELS, DISPOSITIONS, DISPOSITION_LABELS, NOTIFICATION_METHODS,
};

const KNOBS = () => CONFIG.claima?.nullification || { secondApproverThreshold: 2000, roles: {} };

/** The value above which a second person signs. */
export const threshold = () => Number(KNOBS().secondApproverThreshold) || 0;
export const requestFlag = () => KNOBS().roles?.request || 'canNullifyClaim';
export const approveFlag = () => KNOBS().roles?.approve || 'canApproveNullification';

// --- reads ---------------------------------------------------------------------------

export const all = () => store.table(TABLE);

export const get = (no) => all().find((n) => n.no === no) || null;

/** The nullifications written against one claim, oldest first — one, in practice. */
export const byClaim = (claimNo) => all().filter((n) => n.claimNo === claimNo).sort(byAt);

/** The nullification a claim was assembled to replace, or null. */
export const replacedBy = (claimNo) => all().find((n) => n.replacement?.claimNo === claimNo) || null;

export const history = (no) => audit.forEntity(ENTITY, no);

/** Sequential per year, read off the table: NUL-2026-000019 after the six seeded rows. */
export function nextNo(year = new Date().getFullYear()) {
  const prefix = `NUL-${year}-`;
  const max = all().reduce((n, row) => {
    if (!String(row.no).startsWith(prefix)) return n;
    const digits = Number(String(row.no).slice(prefix.length));
    return Number.isFinite(digits) && digits > n ? digits : n;
  }, 0);
  return `${prefix}${String(max + 1).padStart(6, '0')}`;
}

/** The value a nullification is gated on: what the claim bills its payer. */
export const valueOf = (claim) => Math.round((Number(claim?.totals?.payerShare) || 0) * 100) / 100;

export const needsSecondApprover = (claim) => valueOf(claim) >= threshold();

/** Who may sign as the second approver for this requester: the flag, and not the same person. */
export const approversFor = (requesterName = currentRole().name) =>
  ROLES.filter((r) => r[approveFlag()] && r.name !== requesterName);

/**
 * log(q, { reasonCode, path, disposition, payerId, from, to, replacement })
 * → rows, newest first. `replacement` is '1' for records with a replacement
 * claim, '0' for those without; the text matches the number, the claim, the
 * replacement, the patient's MRN or name.
 */
export function log(q = '', {
  reasonCode = '', path = '', disposition = '', payerId = '', from = '', to = '', replacement = '',
} = {}) {
  const needle = String(q || '').trim().toLowerCase();
  return all()
    .filter((n) => {
      if (reasonCode && n.reasonCode !== reasonCode) return false;
      if (path && n.path !== path) return false;
      if (disposition && n.disposition?.kind !== disposition) return false;
      if (payerId && n.payerId !== payerId) return false;
      if (from && compareDates(iso(n.at), from) < 0) return false;
      if (to && compareDates(iso(n.at), to) > 0) return false;
      if (replacement === '1' && !n.replacement?.claimNo) return false;
      if (replacement === '0' && n.replacement?.claimNo) return false;
      if (!needle) return true;
      const patient = patients.get(n.patientMrn);
      return [n.no, n.claimNo, n.replacement?.claimNo, n.patientMrn, patient?.nameEn, n.encounterNo, n.payerNotification?.reference]
        .some((v) => String(v || '').toLowerCase().includes(needle));
    })
    .sort((a, b) => String(b.at).localeCompare(String(a.at)) || b.no.localeCompare(a.no));
}

/** The first day of the month `on` sits in. */
export const monthStart = (on = todayIso()) => `${on.slice(0, 7)}-01`;

/**
 * stats({ from, to }) → { count, value, replaced, replacementRate, topReason }
 * over the rows in the range — the rail reads it month to date, and every
 * figure is the row count (or sum) of the slice its card selects.
 */
export function stats({ from = '', to = '' } = {}) {
  const rows = log('', { from, to });
  const replaced = rows.filter((n) => n.replacement?.claimNo).length;
  const byReason = new Map();
  for (const n of rows) byReason.set(n.reasonCode, (byReason.get(n.reasonCode) || 0) + 1);
  const top = [...byReason.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || null;
  return {
    count: rows.length,
    value: Math.round(rows.reduce((n, r) => n + (Number(r.valueAtNullification) || 0), 0) * 100) / 100,
    replaced,
    replacementRate: rows.length ? replaced / rows.length : 0,
    topReason: top ? { code: top[0], label: nullificationLabel(top[0]), count: top[1] } : null,
  };
}

// --- the path resolver -----------------------------------------------------------------

const peers = { remittances: null, denials: null };
for (const [key, path] of [['remittances', './remittances.js'], ['denials', './denials.js']]) {
  import(path).then((mod) => { peers[key] = mod; }).catch(() => {});
}

/** The open batch a claim is waiting in, or null. */
export const openBatchOf = (claim) =>
  batches.all().find((b) => batches.isOpen(b) && b.claimNos.includes(claim?.claimNo)) || null;

/**
 * pathFor(claim) → { path, blocked, why, route, batch, note }. Draft and
 * Ready (stale or scrub-failed included) go Direct — a Ready claim also
 * leaves any open batch; Submitted and Acknowledged need the payer told;
 * Rejected ends the chain. Paid, Partially Paid, Denied, Appealed and Closed
 * are blocked and `route` names the screen that undoes them first.
 */
export function pathFor(claim) {
  if (!claim) return { path: null, blocked: true, why: 'No claim', route: null, batch: null, note: '' };
  const s = claim.status;
  if (s === 'Void') {
    const no = claim.nullification?.no || null;
    return {
      path: null, blocked: true, batch: null, note: '',
      why: no ? `Already nullified — ${no}` : 'Already void',
      route: no ? { label: `Open ${no}`, href: `#/claima/nullifications/${no}` } : null,
    };
  }
  if (s === 'Draft' || s === 'Ready') {
    const batch = openBatchOf(claim);
    return {
      path: 'Direct', blocked: false, why: '', route: null, batch,
      note: `${claims.isStale(claim) ? 'Stale, ' : ''}${s} — nothing has gone to the payer, so the claim is withdrawn here${
        batch ? ` and removed from ${batch.batchNo}` : ''}.`,
    };
  }
  if (s === 'Submitted' || s === 'Acknowledged') {
    return {
      path: 'PayerNotified', blocked: false, why: '', route: null, batch: null,
      note: `${s} — the payer holds this claim, so the withdrawal is notified to them and the notification recorded here.`,
    };
  }
  if (s === 'Rejected') {
    return {
      path: 'EndChain', blocked: false, why: '', route: null, batch: null,
      note: `Rejected on cycle ${claims.cycleOf(claim)} — nullifying ends the chain: no further cycle is opened and the family is noted "chain ended".`,
    };
  }
  if (s === 'Paid' || s === 'Partially Paid' || s === 'Closed') {
    const rem = claim.remittanceId || (claim.remittances || [])[0] || null;
    return {
      path: null, blocked: true, batch: null, note: '',
      why: `${s} — money has been posted against this claim. Reverse the posting in Remittances first; the claim comes back to ${
        claim.statusBeforeRemittance || 'Acknowledged'} and can be nullified and replaced from there.`,
      route: { label: rem ? `Open remittance ${rem}` : 'Open remittances', href: rem ? `#/claima/remittances/${rem}` : '#/claima/remittances' },
    };
  }
  if (s === 'Denied' || s === 'Appealed') {
    const denial = peers.denials?.byClaim?.(claim.claimNo)?.find?.((d) => d.status !== 'Reversed') || null;
    return {
      path: null, blocked: true, batch: null, note: '',
      why: `${s} — the payer has answered. A denied claim is worked from its denial: appealed, corrected and resubmitted, or written off.`,
      route: { label: denial ? `Open denial ${denial.id}` : 'Open denials', href: denial ? `#/claima/denials/${denial.id}` : '#/claima/denials' },
    };
  }
  return { path: null, blocked: true, why: `${s} — not a status a claim is nullified from`, route: null, batch: null, note: '' };
}

// --- validation ----------------------------------------------------------------------------

/** The patient's other covers the wrong-payer path may re-classify to, plus Self-Pay. */
export function reclassOptions(claim) {
  const enc = claim?.encounterNo ? encounters.get(claim.encounterNo) : null;
  if (!enc) return [];
  const current = enc.financial?.policyId || null;
  const rows = policies.byPatient(enc.patientMrn)
    .filter((p) => p.status === 'Active' && p.id !== current)
    .map((p) => {
      const payer = payers.get(p.payerId);
      const plan = payer?.plans.find((x) => x.id === p.planId);
      return { policyId: p.id, label: `${payer?.nameEn || p.payerId}${plan ? ` · ${plan.name}` : ''}`, payerId: p.payerId, planId: p.planId };
    });
  if (current) rows.push({ policyId: null, label: 'Self-Pay — the patient settles the account', payerId: null, planId: null });
  return rows;
}

/**
 * validate(claim, form, actors) → the problems as sentences, empty when the
 * request may go. `form` is what the dialog collected: reasonCode,
 * reasonText, justification, notification { method, reference, date, note },
 * disposition ('ReturnToUnbilled' | 'ReturnAndHold'), holdReason, replace
 * (bool), reclassPolicyId (wrong payer, null for Self-Pay, undefined when
 * not chosen). `actors` is { requestedBy, approvedBy }.
 */
export function validate(claim, form = {}, actors = {}, role = currentRole()) {
  const out = [];
  const resolved = pathFor(claim);
  if (resolved.blocked) return [resolved.why];
  if (!role?.[requestFlag()]) out.push('Your role cannot nullify a claim — the RCM coder and the CMO can.');
  const reason = nullificationReason(form.reasonCode);
  if (!reason) out.push('Pick a reason.');
  if (reason?.textRequired && !String(form.reasonText || '').trim()) out.push('"Other" needs the reason in words.');
  if (!String(form.justification || '').trim()) out.push('Write the justification — it is what the log will say.');
  if (resolved.path === 'PayerNotified') {
    const n = form.notification || {};
    if (!NOTIFICATION_METHODS.includes(n.method)) out.push('Say how the payer was notified.');
    if (!String(n.reference || '').trim()) out.push('Record the notification reference — a portal ticket, an email subject, a call note.');
    if (!iso(n.date)) out.push('Give the date the payer was notified.');
  }
  if (!DISPOSITIONS.includes(form.disposition)) out.push('Choose what happens to the charge lines.');
  if (form.disposition === 'ReturnAndHold' && !String(form.holdReason || '').trim()) out.push('A hold needs a reason.');
  if (needsSecondApprover(claim)) {
    const approver = ROLES.find((r) => r.name === actors.approvedBy);
    if (!approver) out.push(`A claim worth ${threshold() ? `$${threshold().toLocaleString()}` : 'this much'} or more needs a second approver.`);
    else if (!approver[approveFlag()]) out.push(`${approver.name} cannot approve a nullification.`);
    else if (approver.name === actors.requestedBy) out.push('The second approver has to be somebody other than the requester.');
  }
  if (form.replace) {
    if (!claim.encounterNo) out.push('A claim with no visit behind it cannot be re-assembled — untick the replacement.');
    if (form.disposition === 'ReturnAndHold') out.push('Held lines cannot be assembled into a replacement — return them unheld, or replace later from the pool.');
    if (form.reasonCode === 'N01' && form.reclassPolicyId === undefined) out.push('Wrong payer: choose the cover the visit is re-classified to.');
  }
  return out;
}

// --- the one write ---------------------------------------------------------------------------

/**
 * nullify(claimNo, form, { at, by, actors, role }) → { record, replacement,
 * error }. The whole act in order: the number, the batch removal, the claim
 * to Void, the charge lines back to the pool, then — when asked — the
 * re-classification and a fresh assembly released from those same lines.
 * Every step is the owning repository's own write, so each trail reads as
 * that repository writes it; the record here is the summary and it is never
 * edited again. `at`/`by`/`actors` let the seed date and sign what it writes.
 */
export function nullify(claimNo, form = {}, { at = null, by = null, actors = null, role = currentRole(), no: seedNo = null } = {}) {
  const claim = claims.get(claimNo);
  if (!claim) return { record: null, replacement: null, error: `No claim ${claimNo}` };
  const who = { requestedBy: actors?.requestedBy || by || role.name, approvedBy: actors?.approvedBy || null };
  const problems = validate(claim, form, who, at ? { ...role, [requestFlag()]: true } : role);
  if (problems.length) return { record: null, replacement: null, error: problems.join(' ') };

  const resolved = pathFor(claim);
  const when = at || new Date().toISOString();
  const signer = by || who.requestedBy;
  const no = seedNo && !get(seedNo) ? seedNo : nextNo(Number(when.slice(0, 4)));
  const reason = nullificationReason(form.reasonCode);
  const label = reason.label;
  const lines = charges.linesForClaim(claim);
  const value = valueOf(claim);
  const hold = form.disposition === 'ReturnAndHold';
  const encounter = claim.encounterNo ? encounters.get(claim.encounterNo) : null;
  const before = encounter ? { ...encounter.financial } : null;

  // 1. Out of the open batch it was waiting in.
  let batchRemoved = null;
  if (resolved.batch) {
    batches.removeClaim(resolved.batch.batchNo, claim.claimNo, `Nullified ${no} — ${form.reasonCode} ${label}`, { at: when, by: signer });
    batchRemoved = { batchNo: resolved.batch.batchNo, at: when };
  }

  // 2. The claim itself.
  claims.nullify(claim.claimNo, {
    nullificationNo: no, reasonCode: form.reasonCode, reasonLabel: label,
    justification: String(form.justification || '').trim(), path: resolved.path, at: when, by: signer,
  });

  // 3. The charge lines back to the pool.
  const lineIds = lines.map((l) => l.id);
  const returned = lineIds.length
    ? charges.returnFromClaim(lineIds, { nullificationNo: no, claimNo: claim.claimNo, hold, reason: hold ? form.holdReason : null, at: when, by: signer })
    : { returned: [], skipped: [] };

  // 4. Wrong payer: the visit is re-classified before anything is assembled.
  let reclassification = null;
  if (form.replace && form.reasonCode === 'N01' && encounter && form.reclassPolicyId !== undefined) {
    const to = reclassOptions(claim).find((o) => o.policyId === form.reclassPolicyId) || { policyId: null, label: 'Self-Pay', payerId: null, planId: null };
    encounters.reclassify(encounter.no, { policyId: to.policyId, snapshotRef: null, reason: `Nullification ${no} — wrong payer: ${String(form.justification || '').trim()}` });
    if (at || by) restampEncounter(encounter.no, when, signer);
    reclassification = {
      from: { policyId: before?.policyId || null, payerId: before?.payerId || null, planId: before?.planId || null, label: coverLabel(before) },
      to: { policyId: to.policyId, payerId: to.payerId, planId: to.planId, label: to.label.split(' — ')[0] },
    };
  }

  // 5. The replacement: the returned lines released again, a fresh assembly.
  let replacement = null;
  let replaced = null;
  if (form.replace) {
    const later = plusMinutes(when, 2);
    if (returned.returned.length) {
      charges.releaseForReplacement(returned.returned.map((l) => l.id), { nullificationNo: no, claimNo: claim.claimNo, at: later, by: signer });
    }
    const res = claims.assembleReplacement(claim.claimNo, { at: plusMinutes(when, 5), by: signer });
    replaced = res.claim && res.created ? res.claim : null;
    replacement = {
      claimNo: replaced?.claimNo || null,
      kind: form.reasonCode === 'N01' ? 'WrongPayerReclass' : 'Fresh',
      at: plusMinutes(when, 5),
      reason: replaced ? '' : (res.reason || 'Nothing to assemble'),
    };
  }

  // 6. The record.
  const record = {
    no,
    claimNo: claim.claimNo,
    claimId: claim.id,
    patientMrn: claim.patientMrn,
    encounterNo: claim.encounterNo || null,
    payerId: claim.payerId,
    planId: claim.planId,
    policyId: claim.policyId || null,
    statusAtNullification: claim.statusAtNullification || resolved.path,
    path: resolved.path,
    reasonCode: form.reasonCode,
    reasonText: reason.textRequired ? String(form.reasonText || '').trim() : (String(form.reasonText || '').trim() || null),
    justification: String(form.justification || '').trim(),
    payerNotification: resolved.path === 'PayerNotified' ? {
      method: form.notification.method,
      reference: String(form.notification.reference).trim(),
      date: iso(form.notification.date),
      note: String(form.notification.note || '').trim() || null,
    } : null,
    disposition: {
      kind: form.disposition,
      reason: hold ? String(form.holdReason).trim() : null,
      lineIds: returned.returned.map((l) => l.id),
      skipped: returned.skipped,
    },
    lines: lines.map((l) => {
      const item = cdm.get(l.itemId);
      return {
        chargeLineId: l.id, itemId: l.itemId, chargeCode: item?.chargeCode || null, description: cdm.label(item) || l.itemId,
        qty: l.qty, amount: Math.round((Number(l.pricing?.allowed) || 0) * 100) / 100,
      };
    }),
    batchRemoved,
    reclassification,
    replacement,
    chainEnded: resolved.path === 'EndChain',
    actors: who,
    valueAtNullification: value,
    at: when,
  };
  all().push(record);
  audit.all().push({
    id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: no, action: 'Created', user: signer, at: when,
    details: `${claim.claimNo} · ${PATH_LABELS[resolved.path]} · ${form.reasonCode} ${label} · $${value.toFixed(2)}${
      who.approvedBy ? ` · approved by ${who.approvedBy}` : ''}${replaced ? ` · replaced by ${replaced.claimNo}` : ''}`,
  });
  store.commit('nullifications.create');
  return { record, replacement: replaced, error: '' };
}

// --- internals --------------------------------------------------------------------------------

const byAt = (a, b) => String(a.at).localeCompare(String(b.at)) || a.no.localeCompare(b.no);

/** `n` minutes after `at`, in the shape `at` came in — a seed's local stamp stays local, a live one stays UTC. */
function plusMinutes(at, n) {
  const d = new Date(Date.parse(at) + n * 60000);
  if (/Z$/.test(at)) return d.toISOString();
  const two = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

function coverLabel(financial) {
  if (!financial?.payerId) return 'Self-Pay';
  const payer = payers.get(financial.payerId);
  const plan = payer?.plans.find((p) => p.id === financial.planId);
  return `${payer?.nameEn || financial.payerId}${plan ? ` · ${plan.name}` : ''}`;
}

/** The seed's clock on the re-classification the encounter register just wrote. */
function restampEncounter(no, at, by) {
  const enc = encounters.get(no);
  if (enc?.financial) Object.assign(enc.financial, { classifiedAt: at, classifiedBy: by });
  const entries = audit.all();
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const e = entries[i];
    if (e.entity === 'encounters' && e.entityId === no && e.action === 'Re-classified') {
      e.at = at;
      e.user = by;
      return;
    }
  }
}

// --- seed ----------------------------------------------------------------------------------------

/**
 * The seeded records, once into an empty table, after the claim repository's
 * peers have settled — the assembled claims carry the capture register's ids
 * by then, and the submission and remittance seeds have moved what they move.
 * Runs again after a reset. Returns whether anything was written.
 */
export function seed() {
  if (all().length) return false;
  batches.all();
  charges.all();
  claims.ensureAssembled();
  for (const mod of Object.values(peers)) mod?.all?.();
  return buildNullifications({ nullify, threshold: threshold() });
}

export const ready = claims.peersReady.then(seed);
store.subscribe((reason) => { if (reason === 'reset') queueMicrotask(seed); });
