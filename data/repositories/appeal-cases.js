// Repository — appeal cases. Owner: modules/defensio (amendment 36 wrote the
// stub, amendment 38 took the entity over). Over the file cap on purpose:
// one entity, one file — the case, its grounds and citations, its evidence
// bundle, its letter versions, the review rounds, the frozen package and the
// submission are one set of rules.
//
// A case is the argument an appealable denial is taken to the payer with.
// The denial's Appeal route creates it (`create`, the A36 contract, kept)
// and from there it is the desk's: grounds are chosen, contract terms are
// cited off the version stamped on the claim (rendered text is stored as it
// was read — a citation does not move with the agreement afterwards),
// evidence is attached by reference into the registers (never copied), a
// letter is merged from a template and edited (every generation and every
// manual edit is a version), and the case goes to review — a reviewer who is
// not the preparer, at the standard tier or, past
// CONFIG.defensio.appeals.seniorReviewAbove, the senior one. Approval locks
// the letter; the package (letter, bundle index, cover sheet) is frozen once
// and printed from the frozen copy; submission records how and when it went
// and is late, with a role-gated override, past the denial's own deadline.
//
// Statuses this file writes: Draft, InReview, ApprovedToSubmit, Returned,
// Submitted, Withdrawn. Amendment 39 owns every status after Submitted and
// reads the four flat fields `submittedAt`, `method`, `reference`,
// `packageRef` (also nested under `submission`); it publishes the outcome
// through `outcomeHooks`, which is what enables a level-2 case here. The
// denials register is reached by dynamic import — it imports this file —
// and Claima's claims and follow-ups are read for the timeline event a
// submission writes.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as claims from './claims.js';
import * as payers from './payers.js';
import * as contracts from './contracts.js';
import * as patients from './patients.js';
import * as policies from './policies.js';
import * as preauth from './preauth-requests.js';
import * as followups from './followups.js';
import { GROUNDS, GROUND_EVIDENCE, BUNDLE_TYPES, ground, groundLabel, isContractGround } from '../seed/appeal-grounds.js';
import { TEMPLATES, template, templateFor, merge } from '../seed/letter-templates.js';
import { buildAppealCases } from '../seed/appeal-cases.js';
import { current as currentRole } from '../../shared/roles.js';
import { CONFIG } from '../../shared/config.js';
import { compareDates, date, esc, iso, todayIso, usd } from '../../shared/format.js';

const TABLE = 'appealCases';
const ENTITY = 'appealCases';

export const STATUSES = ['Draft', 'InReview', 'ApprovedToSubmit', 'Returned', 'Submitted', 'Withdrawn'];
/** What comes after Submitted is amendment 39's vocabulary; these are the ones that end a case. */
export const CLOSED_STATUSES = ['Withdrawn', 'Won', 'Partially Won', 'Lost', 'Settled', 'Closed'];
export const EDITABLE_STATUSES = ['Draft', 'Returned'];
export const TIERS = ['standard', 'senior'];
export { GROUNDS, GROUND_EVIDENCE, BUNDLE_TYPES, TEMPLATES, ground, groundLabel, isContractGround, template, templateFor, merge };

export const STATUS_LABELS = {
  Draft: 'Draft', InReview: 'In review', ApprovedToSubmit: 'Approved to submit', Returned: 'Returned', Submitted: 'Submitted', Withdrawn: 'Withdrawn',
};
export const statusLabel = (s) => STATUS_LABELS[s] || s || '—';

const cfg = () => CONFIG.defensio?.appeals || {};
export const seniorAbove = () => Number(cfg().seniorReviewAbove) || 5000;
export const warnDays = () => Number(cfg().deadlineWarnDays) || 7;
export const methods = () => cfg().methods || ['Portal', 'Email', 'Fax', 'Courier', 'Hand delivery'];

// --- peers -------------------------------------------------------------------------------

const peers = { denials: null, tracking: null };
let settled = false;
/** The denials register, once its own seed has run — what the seed below builds on. */
export const peersReady = import('./denials.js')
  .then((m) => { peers.denials = m; return m.seedReady; })
  .catch(() => null)
  .then(() => import('./appeal-tracking.js').then((m) => { peers.tracking = m; }).catch(() => null))
  .then(() => { settled = true; ensureSeeded(); });

/** Amendment 39 pushes `(caseId) => { outcome, decidedAt } | null` here, or writes `case.outcome` on the row it owns. */
export const outcomeHooks = [];

// --- reads -------------------------------------------------------------------------------

export function all() {
  const rows = store.table(TABLE);
  for (const row of rows) if (!row.level) upgrade(row);
  return rows;
}
export const get = (id) => all().find((a) => a.id === id) || null;
export const byDenial = (denialId) => all().filter((a) => a.denialId === denialId || (a.denialIds || []).includes(denialId)).sort(byAt);
export const byClaim = (claimNo) => all().filter((a) => a.claimNo === claimNo).sort(byAt);
export const history = (id) => audit.forEntity(ENTITY, id);

export const isClosed = (a) => CLOSED_STATUSES.includes(a?.status);
export const isOpen = (a) => Boolean(a) && !isClosed(a);
export const isEditable = (a) => EDITABLE_STATUSES.includes(a?.status);
export const isSubmitted = (a) => Boolean(a) && !EDITABLE_STATUSES.includes(a.status) && a.status !== 'InReview' && a.status !== 'ApprovedToSubmit' && a.status !== 'Withdrawn';
export const beforeSubmission = (a) => ['Draft', 'Returned', 'InReview', 'ApprovedToSubmit'].includes(a?.status);

/** The newest case on a denial, an open one first — what the denial page's chip reads. */
export function getAppealCaseForDenial(denialId) {
  const rows = byDenial(denialId);
  return rows.find(isOpen) || rows[rows.length - 1] || null;
}

/** What amendment 39 says happened to a submitted case: { outcome, decidedAt } or null. */
export function getAppealOutcome(id) {
  for (const fn of outcomeHooks) {
    const r = fn(id);
    if (r) return r;
  }
  const r = peers.tracking?.getAppealOutcome?.(id);
  if (r) return r;
  const row = get(id);
  if (row?.outcome) return { outcome: row.outcome.outcome || row.outcome.result || row.outcome, decidedAt: row.outcome.decidedAt || row.closedAt || null };
  return null;
}

export const claimOf = (row) => claims.get(row?.claimId || row?.claimNo);
export const denialOf = (row) => peers.denials?.get?.(row?.denialId) || null;
export const denialsOf = (row) => (row?.denialIds || []).map((id) => peers.denials?.get?.(id)).filter(Boolean);

export const tierFor = (amount) => (Number(amount) >= seniorAbove() ? 'senior' : 'standard');
export const requiredTierOf = (row) => row?.review?.requiredTier || tierFor(row?.disputedAmount);

/** { at, daysLeft, passed, warn, met } — met once the case has gone to the payer. */
export function deadlineOf(row, on = todayIso()) {
  const at = iso(row?.filingDeadline) || null;
  const met = Boolean(row) && !beforeSubmission(row) && row.status !== 'Withdrawn';
  if (!at) return { at: null, daysLeft: null, passed: false, warn: false, met };
  const daysLeft = Math.round((Date.parse(at) - Date.parse(on)) / 86400000);
  return { at, daysLeft, passed: !met && daysLeft < 0, warn: !met && daysLeft >= 0 && daysLeft <= warnDays(), met };
}

export const latestLetter = (row) => (row?.letter?.versions || [])[row.letter.versions.length - 1] || null;
export const lockedLetter = (row) => (row?.letter?.finalLockedAt != null && row.letter.lockedVersion != null ? row.letter.versions[row.letter.lockedVersion] || null : null);
export const latestPackage = (row) => (row?.packages || [])[row.packages.length - 1] || null;
export const packageOf = (row, ref) => (row?.packages || []).find((p) => p.ref === ref) || null;
export const includedBundle = (row) => [...(row?.bundle || [])].filter((b) => b.included).sort((a, b) => a.order - b.order);

/** A role's answer on a case: { ok, why } — the preparer never reviews, and a senior case needs the senior flag. */
export function canReview(row, role = currentRole()) {
  if (!row) return { ok: false, why: 'No such case' };
  if (row.status !== 'InReview') return { ok: false, why: `A ${statusLabel(row.status).toLowerCase()} case is not under review` };
  if (role.name === row.createdBy) return { ok: false, why: 'The preparer cannot review their own case' };
  const tier = requiredTierOf(row);
  if (tier === 'senior' && !role.canApproveSeniorAppeal) return { ok: false, why: `Disputed ${usd(row.disputedAmount)} is at or above ${usd(seniorAbove())} — the senior tier signs (the CMO)` };
  if (tier === 'standard' && !role.canReviewAppeal) return { ok: false, why: 'Only the RCM coder and the CMO review an appeal' };
  return { ok: true, why: '' };
}

/** What stops the case going to review — one sentence, or null when nothing does. */
export function reviewBlocker(row) {
  if (!row) return 'No such case';
  if (!isEditable(row)) return `A ${statusLabel(row.status).toLowerCase()} case is not sent for review`;
  if (!row.grounds?.primary) return 'Pick the primary ground first';
  if (isContractGround(row.grounds.primary) && !(row.citations || []).length) return 'A contract ground needs at least one citation';
  if (!(row.letter?.versions || []).length) return 'Generate the letter first';
  if (!includedBundle(row).length) return 'Include at least one item in the evidence bundle';
  return null;
}

/** What stops the package or the submission — null when nothing does. */
export function submissionBlocker(row) {
  if (!row) return 'No such case';
  if (row.status !== 'ApprovedToSubmit') return `A ${statusLabel(row.status).toLowerCase()} case is not submitted — it is approved first`;
  if (!lockedLetter(row)) return 'The approved letter is not locked';
  return null;
}

/** The evidence a ground expects and the bundle does not carry: [{ ground, missing[] }]. */
export function evidenceWarnings(row) {
  const have = new Set(includedBundle(row).map((b) => b.type));
  const ids = [row?.grounds?.primary, ...(row?.grounds?.secondary || [])].filter(Boolean);
  return ids.map((g) => ({ ground: g, label: groundLabel(g), missing: (GROUND_EVIDENCE[g] || []).filter((t) => !have.has(t)) })).filter((w) => w.missing.length);
}

/**
 * suggestedBundle(row) → the system items an appeal can attach, each a
 * reference into a register read through its published helpers, with
 * `attached` when the bundle already carries it.
 */
export function suggestedBundle(row) {
  const claim = claimOf(row);
  const denial = denialOf(row);
  const out = [];
  const add = (type, ref, description, href = null) => out.push({ type, ref, description, href, source: 'system' });
  if (claim) {
    add('Claim', claim.claimNo, `Claim ${claim.claimNo} as filed${claim.cycle > 1 ? ` — cycle ${claim.cycle}` : ''} · ${usd(claim.totals?.payerShare)} payer share`, `#/claima/claims/${claim.claimNo}`);
    if (claim.snapshotRef) add('Eligibility check', claim.snapshotRef, `Eligibility ${claim.snapshotRef} on the claim`, `#/frontis/eligibility/${claim.snapshotRef}`);
    if (claim.referralNo) add('Referral', claim.referralNo, `Referral ${claim.referralNo}`, `#/frontis/referrals/${claim.referralNo}/view`);
    if (claim.encounterNo) {
      add('Encounter record', claim.encounterNo, `Visit ${claim.encounterNo}${claim.department ? ` · ${claim.department}` : ''}`, `#/frontis/encounters/${claim.encounterNo}`);
      for (const a of preauth.byEncounter(claim.encounterNo)) add('Authorisation', a.no, `${a.no} · ${a.status}${a.decision?.authNumber ? ` · ${a.decision.authNumber}` : ''}`, `#/frontis/preauth/${a.no}`);
      for (const d of claims.clinicalDocsOf?.(claim.encounterNo) || []) add('Clinical document', d.id, `${d.type} — ${d.title}`, `#/claima/coding/${claim.encounterNo}`);
      if (claim.coding?.principal) add('Coding summary', claim.encounterNo, `Coding v${claim.coding.version} · ${claim.coding.principal.code} ${claim.coding.principal.desc || ''}`, `#/claima/coding/${claim.encounterNo}`);
    }
    for (const a of claim.attachments || []) add('Claim attachment', a.id, `${a.type} — ${a.fileName}`, `#/claima/claims/${claim.claimNo}/attachments`);
  }
  if (denial) {
    add('Denial notice', denial.id, `${denial.id} · ${denial.payerReason?.code || denial.code} ${denial.payerReason?.text || ''} · landed ${date(denial.createdAt)}`, `#/defensio/denials/${denial.id}`);
    if (denial.remittanceNo) add('Remittance advice', denial.remittanceNo, `Remittance ${denial.remittanceNo}`, `#/claima/remittances/${denial.remittanceNo}`);
  }
  for (const c of row?.citations || []) add('Contract extract', c.id, c.renderedText, c.href || null);
  const have = new Set((row?.bundle || []).map((b) => `${b.type}|${b.ref}`));
  return out.map((s) => ({ ...s, attached: have.has(`${s.type}|${s.ref}`) }));
}

/**
 * search(q, { payerId, status, level, tier, deadline ('week' | 'passed' |
 * 'open'), preparer ('me'), scope ('active' | 'submitted' | 'all'), from,
 * to }) → rows, deadline ascending for the cases still to file, then the
 * submitted ones newest first. `q` matches the case, its denials, the claim
 * and the patient.
 */
export function search(q = '', f = {}) {
  const needle = String(q || '').trim().toLowerCase();
  const me = currentRole().name;
  return all()
    .filter((a) => {
      const scope = f.scope || 'all';
      if (scope === 'active' && !beforeSubmission(a)) return false;
      if (scope === 'submitted' && beforeSubmission(a)) return false;
      if (scope === 'submitted' && a.status === 'Withdrawn') return false;
      if (f.payerId && a.payerId !== f.payerId) return false;
      if (f.status && a.status !== f.status) return false;
      if (f.level && String(a.level) !== String(f.level)) return false;
      if (f.tier && requiredTierOf(a) !== f.tier) return false;
      if (f.preparer && a.createdBy !== (f.preparer === 'me' ? me : f.preparer)) return false;
      if (f.from && compareDates(a.createdAt, f.from) < 0) return false;
      if (f.to && compareDates(a.createdAt, f.to) > 0) return false;
      if (f.deadline) {
        const dl = deadlineOf(a);
        if (f.deadline === 'passed' && !dl.passed) return false;
        if (f.deadline === 'week' && !dl.warn) return false;
        if (f.deadline === 'open' && !(beforeSubmission(a) && !dl.passed)) return false;
      }
      if (!needle) return true;
      const claim = claimOf(a);
      const patient = claim ? claims.search(needle, { patientMrn: claim.patientMrn }).length > 0 : false;
      return patient || [a.id, a.claimNo, ...(a.denialIds || []), a.reference, a.submission?.reference]
        .some((v) => String(v || '').toLowerCase().includes(needle));
    })
    .sort(byRank);
}

export function counts(on = todayIso()) {
  const rows = all();
  const role = currentRole();
  const month = on.slice(0, 7);
  const pre = rows.filter(beforeSubmission);
  const dueSoon = pre.filter((a) => { const dl = deadlineOf(a, on); return dl.warn || dl.passed; });
  const mine = rows.filter((a) => a.status === 'InReview' && canReview(a, role).ok);
  const submitted = rows.filter((a) => !beforeSubmission(a) && a.status !== 'Withdrawn');
  const submittedMtd = submitted.filter((a) => String(a.submittedAt || '').slice(0, 7) === month);
  const sum = (list) => cents(list.reduce((n, a) => n + (a.disputedAmount || 0), 0));
  return {
    total: rows.length,
    open: rows.filter(isOpen).length,
    active: pre.length,
    activeValue: sum(pre),
    draft: rows.filter((a) => a.status === 'Draft' || a.status === 'Returned').length,
    inReview: rows.filter((a) => a.status === 'InReview').length,
    awaitingMe: mine.length,
    approved: rows.filter((a) => a.status === 'ApprovedToSubmit').length,
    dueSoon: dueSoon.length,
    dueSoonValue: sum(dueSoon),
    submitted: submitted.length,
    submittedMtd: { count: submittedMtd.length, amount: sum(submittedMtd) },
    needsAttention: dueSoon.length + mine.length,
  };
}

export const statusTone = (s) => ({
  Draft: '', Returned: 'warning', InReview: 'info', ApprovedToSubmit: 'accent', Submitted: 'info', Withdrawn: '',
  'Under Review': 'info', Won: 'success', 'Partially Won': 'success', Lost: 'critical', Settled: 'info', Closed: '',
}[s] ?? '');

export const filterOptions = () => ({
  statuses: [...STATUSES, ...new Set(all().map((a) => a.status).filter((s) => !STATUSES.includes(s)))],
  tiers: TIERS,
  levels: [1, 2],
});

// --- writes: the case ----------------------------------------------------------------------

/**
 * create({ denialId, claimNo, claimId, payerId, amount, appealBy, reason,
 * note, level, parentCaseId }, { at, by, commit }) → the case, Draft. The
 * A36 contract: one open case per denial, a second call hands the first back.
 */
export function create(data = {}, { at = null, by = null, commit = true } = {}) {
  const open = byDenial(data.denialId).find(isOpen);
  if (open && !data.parentCaseId) return open;
  const when = at || data.at || new Date().toISOString();
  const who = by || data.by || currentRole().name;
  const amount = cents(data.amount ?? data.disputedAmount);
  const row = {
    id: store.nextId(TABLE, 'AC-'),
    level: data.level || 1,
    parentCaseId: data.parentCaseId || null,
    childCaseId: null,
    denialId: data.denialId || null,
    denialIds: data.denialIds || (data.denialId ? [data.denialId] : []),
    claimNo: data.claimNo || null,
    claimId: data.claimId || null,
    payerId: data.payerId || null,
    disputedAmount: amount,
    amount,
    grounds: { primary: data.grounds?.primary || '', secondary: [...(data.grounds?.secondary || [])] },
    citations: [],
    bundle: [],
    letter: { templateId: null, versions: [], finalLockedAt: null, lockedVersion: null },
    review: { rounds: [], requiredTier: tierFor(amount), requestedAt: null, requestedBy: null },
    status: 'Draft',
    submission: null,
    submittedAt: null, method: null, reference: null, packageRef: null,
    packages: [],
    filingDeadline: iso(data.appealBy || data.filingDeadline) || null,
    appealBy: iso(data.appealBy || data.filingDeadline) || null,
    reason: data.reason || '',
    note: data.note || '',
    outcome: null,
    createdAt: when,
    createdBy: who,
    updatedAt: when,
  };
  all().push(row);
  log(row, 'Created', `${row.denialId || '—'} · ${row.claimNo || '—'} · ${usd(row.disputedAmount)}${row.filingDeadline ? ` · file by ${date(row.filingDeadline)}` : ''}${
    row.level > 1 ? ` · level ${row.level} after ${row.parentCaseId}` : ''}${row.reason ? ` — ${row.reason}` : ''}`, when, who);
  if (commit) store.commit('appealCases.create');
  return row;
}

const editable = (row) => (!row ? { error: 'No such case' } : isEditable(row) ? null : { error: `A ${statusLabel(row.status).toLowerCase()} case is not edited${row.status === 'InReview' ? ' — the reviewer has it' : ''}` });

export function setGrounds(id, { primary = '', secondary = [] } = {}, opts = {}) {
  const row = get(id);
  const bad = editable(row);
  if (bad) return bad;
  if (primary && !ground(primary)) return { error: 'Not a ground' };
  const sec = [...new Set(secondary.filter((g) => g && g !== primary && ground(g)))];
  row.grounds = { primary, secondary: sec };
  if (primary && !row.letter.templateId) row.letter.templateId = templateFor(primary).id;
  touch(row, opts.at);
  log(row, 'Grounds set', `${primary ? groundLabel(primary) : '—'}${sec.length ? ` + ${sec.map(groundLabel).join(', ')}` : ''}`, opts.at, opts.by);
  commitUnless(opts, 'appealCases.update');
  return row;
}

/** addCitation(id, { sourceRef, renderedText, argument, href }) — the text arrives rendered by the citation engine and is stored as read. */
export function addCitation(id, { sourceRef, renderedText = '', argument = '', href = null } = {}, opts = {}) {
  const row = get(id);
  const bad = editable(row);
  if (bad) return bad;
  if (!sourceRef?.contractId || !sourceRef.section) return { error: 'A citation names a contract version and a section' };
  if (!String(renderedText).trim()) return { error: 'Nothing was rendered for this row' };
  const dup = row.citations.find((c) => sameRef(c.sourceRef, sourceRef));
  if (dup) return { error: `${dup.id} already cites this row` };
  const cit = { id: nextSub(row.citations, 'CIT-'), sourceRef: { ...sourceRef }, renderedText: String(renderedText).trim(), argument: String(argument || '').trim(), href, addedAt: opts.at || new Date().toISOString() };
  row.citations.push(cit);
  touch(row, opts.at);
  log(row, 'Citation added', `${cit.id} · ${cit.renderedText}`, opts.at, opts.by);
  commitUnless(opts, 'appealCases.update');
  return cit;
}

export function updateCitation(id, citationId, { argument = '' } = {}, opts = {}) {
  const row = get(id);
  const bad = editable(row);
  if (bad) return bad;
  const cit = row.citations.find((c) => c.id === citationId);
  if (!cit) return { error: 'No such citation' };
  cit.argument = String(argument || '').trim();
  touch(row, opts.at);
  log(row, 'Citation argued', `${cit.id} — ${cit.argument || '(argument cleared)'}`, opts.at, opts.by);
  commitUnless(opts, 'appealCases.update');
  return cit;
}

export function removeCitation(id, citationId, opts = {}) {
  const row = get(id);
  const bad = editable(row);
  if (bad) return bad;
  const i = row.citations.findIndex((c) => c.id === citationId);
  if (i < 0) return { error: 'No such citation' };
  const [gone] = row.citations.splice(i, 1);
  row.bundle = row.bundle.filter((b) => !(b.type === 'Contract extract' && b.ref === gone.id));
  touch(row, opts.at);
  log(row, 'Citation removed', `${gone.id} · ${gone.renderedText}`, opts.at, opts.by);
  commitUnless(opts, 'appealCases.update');
  return row;
}

/** addBundleItem(id, { type, source, ref, file, description, href }) — a reference into a register, or an upload's name and size. */
export function addBundleItem(id, { type, source = 'system', ref = null, file = null, description = '', href = null } = {}, opts = {}) {
  const row = get(id);
  const bad = editable(row);
  if (bad) return bad;
  if (!BUNDLE_TYPES.includes(type)) return { error: 'Not an evidence type' };
  if (source === 'system' && !ref) return { error: 'A system item names the record it points at' };
  if (source === 'upload' && !file?.name) return { error: 'Pick a file' };
  if (source === 'system' && row.bundle.some((b) => b.type === type && b.ref === ref)) return { error: 'Already in the bundle' };
  const item = {
    id: nextSub(row.bundle, 'B'), type, source, ref: source === 'system' ? ref : null,
    file: source === 'upload' ? { name: file.name, size: Number(file.size) || 0 } : null,
    description: String(description || (source === 'upload' ? file.name : ref)).trim(), href,
    included: true, order: row.bundle.length + 1, addedAt: opts.at || new Date().toISOString(),
  };
  row.bundle.push(item);
  touch(row, opts.at);
  log(row, 'Evidence attached', `${item.id} · ${type} — ${item.description}`, opts.at, opts.by);
  commitUnless(opts, 'appealCases.update');
  return item;
}

export function setBundleIncluded(id, itemId, included, opts = {}) {
  const row = get(id);
  const bad = editable(row);
  if (bad) return bad;
  const item = row.bundle.find((b) => b.id === itemId);
  if (!item) return { error: 'No such item' };
  item.included = Boolean(included);
  touch(row, opts.at);
  log(row, included ? 'Evidence included' : 'Evidence left out', `${item.id} · ${item.type} — ${item.description}`, opts.at, opts.by);
  commitUnless(opts, 'appealCases.update');
  return item;
}

export function moveBundleItem(id, itemId, dir, opts = {}) {
  const row = get(id);
  const bad = editable(row);
  if (bad) return bad;
  const sorted = [...row.bundle].sort((a, b) => a.order - b.order);
  const i = sorted.findIndex((b) => b.id === itemId);
  const j = i + (dir === 'up' ? -1 : 1);
  if (i < 0 || j < 0 || j >= sorted.length) return { error: 'Nothing to move' };
  [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
  sorted.forEach((b, n) => { b.order = n + 1; });
  touch(row, opts.at);
  commitUnless(opts, 'appealCases.update');
  return row;
}

export function removeBundleItem(id, itemId, opts = {}) {
  const row = get(id);
  const bad = editable(row);
  if (bad) return bad;
  const i = row.bundle.findIndex((b) => b.id === itemId);
  if (i < 0) return { error: 'No such item' };
  const [gone] = row.bundle.splice(i, 1);
  [...row.bundle].sort((a, b) => a.order - b.order).forEach((b, n) => { b.order = n + 1; });
  touch(row, opts.at);
  log(row, 'Evidence removed', `${gone.id} · ${gone.type} — ${gone.description}`, opts.at, opts.by);
  commitUnless(opts, 'appealCases.update');
  return row;
}

export function setTemplate(id, templateId, opts = {}) {
  const row = get(id);
  const bad = editable(row);
  if (bad) return bad;
  if (!template(templateId)) return { error: 'No such template' };
  row.letter.templateId = templateId;
  touch(row, opts.at);
  commitUnless(opts, 'appealCases.update');
  return row;
}

/** letterFields(row) → every merge field, read live off the registers — what generate merges. */
export function letterFields(row, { by = null, on = todayIso() } = {}) {
  const claim = claimOf(row);
  const denial = denialOf(row);
  const payer = payers.get(row.payerId);
  const patient = claim ? patients.get(claim.patientMrn) : null;
  const policy = claim?.policyId ? policies.get(claim.policyId) : null;
  const h = cfg().hospital || {};
  const lines = claim ? claim.lines.filter((l) => !denial || denial.scope === 'Claim' || l.id === denial.lineId) : [];
  const secondary = (row.grounds.secondary || []).map((g) => `${groundLabel(g)}: ${ground(g)?.summary || ''}`);
  return {
    'hospital.name': h.name || 'Hospital', 'hospital.line': h.line || '', 'hospital.signatory': h.signatory || '',
    today: date(on),
    'payer.name': payer?.nameEn || row.payerId || '—',
    'case.id': row.id, 'case.level': String(row.level || 1),
    'claim.no': row.claimNo || '—', 'claim.dos': date(claim?.dateOfService), 'claim.contract': contractLabel(claim),
    'patient.name': patient?.nameEn || claim?.patientMrn || '—', 'patient.mrn': claim?.patientMrn || '—',
    'member.id': policy?.memberId || '—', 'policy.no': policy?.policyNo || '—',
    'denial.id': denial?.id || row.denialId || '—', 'denial.code': denial?.payerReason?.code || denial?.code || '—',
    'denial.reason': denial?.payerReason?.text || denial?.reason || '—', 'denial.date': date(denial?.createdAt),
    'amount.disputed': usd(row.disputedAmount), 'amount.billed': usd(claim?.totals?.gross ?? claim?.grossBilled),
    'grounds.primary': row.grounds.primary ? `${groundLabel(row.grounds.primary)}: ${ground(row.grounds.primary)?.summary || ''}` : '',
    'grounds.secondary': secondary.length ? ` ${secondary.join(' ')}` : '',
    lines: linesTable(lines),
    citations: citationsList(row),
    'bundle.index': bundleIndex(row),
    deadline: date(row.filingDeadline),
    preparer: by || row.createdBy,
  };
}

/** generateLetter(id, { by }) → the new version, merged from the template with the fields as they stand now. */
export function generateLetter(id, opts = {}) {
  const row = get(id);
  const bad = editable(row);
  if (bad) return bad;
  const tpl = template(row.letter.templateId) || templateFor(row.grounds.primary);
  row.letter.templateId = tpl.id;
  const when = opts.at || new Date().toISOString();
  const html = merge(tpl, letterFields(row, { by: opts.by || currentRole().name, on: iso(when) }));
  const v = { n: row.letter.versions.length + 1, html, generatedAt: when, by: opts.by || currentRole().name, manuallyEdited: false, templateId: tpl.id };
  row.letter.versions.push(v);
  touch(row, when);
  log(row, 'Letter generated', `v${v.n} from ${tpl.name}`, when, opts.by);
  commitUnless(opts, 'appealCases.update');
  return v;
}

/** editLetter(id, html, { by }) → a new version carrying the hand-edited text, flagged. */
export function editLetter(id, html, opts = {}) {
  const row = get(id);
  const bad = editable(row);
  if (bad) return bad;
  if (!row.letter.versions.length) return { error: 'Generate the letter before editing it' };
  const when = opts.at || new Date().toISOString();
  const v = { n: row.letter.versions.length + 1, html: String(html || ''), generatedAt: when, by: opts.by || currentRole().name, manuallyEdited: true, templateId: row.letter.templateId };
  row.letter.versions.push(v);
  touch(row, when);
  log(row, 'Letter edited', `v${v.n} — edited by hand`, when, opts.by);
  commitUnless(opts, 'appealCases.update');
  return v;
}

// --- writes: review --------------------------------------------------------------------------

export function submitForReview(id, opts = {}) {
  const row = get(id);
  const why = reviewBlocker(row);
  if (why) return { error: why };
  const when = opts.at || new Date().toISOString();
  const who = opts.by || currentRole().name;
  row.review.requiredTier = tierFor(row.disputedAmount);
  row.review.requestedAt = when;
  row.review.requestedBy = who;
  row.status = 'InReview';
  touch(row, when);
  log(row, 'Sent for review', `${row.review.requiredTier === 'senior' ? 'Senior' : 'Standard'} tier · ${usd(row.disputedAmount)} disputed · letter v${row.letter.versions.length}`, when, who);
  commitUnless(opts, 'appealCases.status');
  return row;
}

/** review(id, { action: 'approve' | 'return', note }, { at, by, role }) — approve locks the letter; return needs a note. */
export function review(id, { action, note = '' } = {}, opts = {}) {
  const row = get(id);
  const role = opts.role || currentRole();
  const who = opts.by || role.name;
  const check = canReview(row, { ...role, name: who });
  if (!check.ok) return { error: check.why };
  if (action !== 'approve' && action !== 'return') return { error: 'Approve or return' };
  if (action === 'return' && !String(note || '').trim()) return { error: 'Say what the preparer has to change' };
  const when = opts.at || new Date().toISOString();
  row.review.rounds.push({ n: row.review.rounds.length + 1, reviewerId: who, action, note: String(note || '').trim(), at: when, tier: row.review.requiredTier });
  if (action === 'approve') {
    row.status = 'ApprovedToSubmit';
    row.letter.finalLockedAt = when;
    row.letter.lockedVersion = row.letter.versions.length - 1;
    log(row, 'Approved', `Round ${row.review.rounds.length} · ${row.review.requiredTier} tier · letter v${row.letter.versions.length} locked${note ? ` — ${String(note).trim()}` : ''}`, when, who);
  } else {
    row.status = 'Returned';
    log(row, 'Returned', `Round ${row.review.rounds.length} — ${String(note).trim()}`, when, who);
  }
  touch(row, when);
  commitUnless(opts, 'appealCases.status');
  return row;
}

// --- writes: package and submission ------------------------------------------------------

/**
 * generatePackage(id, { by }) → the frozen package: the locked letter, the
 * bundle index in order and the cover sheet, stamped with a reference. One
 * per approval — a second call hands the standing one back.
 */
export function generatePackage(id, opts = {}) {
  const row = get(id);
  const why = submissionBlocker(row);
  if (why) return { error: why };
  const standing = latestPackage(row);
  if (standing && standing.approvedAt === row.letter.finalLockedAt) return standing;
  const when = opts.at || new Date().toISOString();
  const who = opts.by || currentRole().name;
  const letter = lockedLetter(row);
  const claim = claimOf(row);
  const denial = denialOf(row);
  const payer = payers.get(row.payerId);
  const patient = claim ? patients.get(claim.patientMrn) : null;
  const pkg = {
    ref: `PKG-${row.id}-v${row.packages.length + 1}`,
    generatedAt: when, by: who, approvedAt: row.letter.finalLockedAt,
    letter: { html: letter.html, version: letter.n, templateId: letter.templateId, manuallyEdited: letter.manuallyEdited },
    bundle: includedBundle(row).map((b, n) => ({ n: n + 1, id: b.id, type: b.type, source: b.source, ref: b.ref, file: b.file, description: b.description })),
    cover: {
      caseId: row.id, level: row.level, payer: payer?.nameEn || row.payerId, payerId: row.payerId,
      claimNo: row.claimNo, patient: patient?.nameEn || claim?.patientMrn || '—', patientMrn: claim?.patientMrn || null,
      denialId: row.denialId, denialCode: denial?.payerReason?.code || denial?.code || null, dateOfService: claim?.dateOfService || null,
      disputedAmount: row.disputedAmount, filingDeadline: row.filingDeadline, primaryGround: groundLabel(row.grounds.primary),
      citations: row.citations.map((c) => c.renderedText), preparedBy: row.createdBy, approvedBy: row.review.rounds.filter((r) => r.action === 'approve').pop()?.reviewerId || null,
      hospital: cfg().hospital || {},
    },
  };
  row.packages.push(pkg);
  touch(row, when);
  log(row, 'Package generated', `${pkg.ref} · letter v${letter.n} · ${pkg.bundle.length} enclosure${pkg.bundle.length === 1 ? '' : 's'}`, when, who);
  commitUnless(opts, 'appealCases.update');
  return pkg;
}

/** Late when the filing date is past the denial's deadline: { late, daysLate }. */
export function lateness(row, on = todayIso()) {
  if (!row?.filingDeadline) return { late: false, daysLate: 0 };
  const d = Math.round((Date.parse(iso(on)) - Date.parse(row.filingDeadline)) / 86400000);
  return { late: d > 0, daysLate: Math.max(0, d) };
}

/**
 * submit(id, { method, reference, submittedAt, lateReason }, { at, by, role })
 * → the case Submitted: the package generated if none stands, the flat fields
 * and `submission` written, the denial's trail told, the claim moved to
 * Appealed when it was Denied and a follow-up logged on it (the timeline's
 * event). Late past the deadline needs the override flag and a reason.
 */
export function submit(id, { method, reference = '', submittedAt = todayIso(), lateReason = '' } = {}, opts = {}) {
  const row = get(id);
  const why = submissionBlocker(row);
  if (why) return { error: why };
  const role = opts.role || currentRole();
  const who = opts.by || role.name;
  if (!methods().includes(method)) return { error: 'Pick how it was filed' };
  if (!String(reference || '').trim()) return { error: 'The payer’s reference (portal id, email subject, courier slip) is required' };
  const on = iso(submittedAt);
  if (!on) return { error: 'When was it filed?' };
  if (compareDates(on, todayIso()) > 0) return { error: 'A filing date cannot be in the future' };
  const { late, daysLate } = lateness(row, on);
  if (late && !role.canOverrideAppealDeadline) return { error: `Filing on ${date(on)} is ${daysLate} day${daysLate === 1 ? '' : 's'} past the deadline of ${date(row.filingDeadline)} — only the CMO files late` };
  if (late && !String(lateReason || '').trim()) return { error: 'A late filing needs the reason recorded' };
  const when = opts.at || new Date().toISOString();
  const pkg = latestPackage(row)?.approvedAt === row.letter.finalLockedAt ? latestPackage(row) : generatePackage(id, { at: when, by: who, commit: false });
  if (pkg?.error) return pkg;
  row.submission = { method, reference: String(reference).trim(), submittedAt: on, lateOverride: late ? { by: who, reason: String(lateReason).trim(), daysLate } : null, packageRef: pkg.ref };
  row.submittedAt = on;
  row.method = method;
  row.reference = String(reference).trim();
  row.packageRef = pkg.ref;
  row.status = 'Submitted';
  touch(row, when);
  log(row, 'Submitted', `${method} · ref ${row.reference} · filed ${date(on)} · ${pkg.ref}${late ? ` · LATE by ${daysLate} day${daysLate === 1 ? '' : 's'} — ${row.submission.lateOverride.reason}` : ''}`, when, who);
  // The denial's trail and the claim's timeline both hear it — through the published writers.
  peers.denials?.markAppealSubmitted?.(row.denialId, { caseId: row.id, method, reference: row.reference, submittedAt: on, late }, { at: when, by: who });
  const claim = claimOf(row);
  if (claim) {
    if (claim.status === 'Denied') {
      claims.setStatus(claim.id, 'Appealed', { reason: 'Appeal submitted', details: `${row.id} · ${method} · ref ${row.reference}${late ? ' · late filing' : ''}` });
      // A seeded submission is dated by the seed: the status line the claim just wrote moves with it.
      if (opts.at) {
        const entries = audit.all();
        for (let i = entries.length - 1; i >= 0; i -= 1) {
          const e = entries[i];
          if (e.entity === 'claims' && e.entityId === claim.id && e.action === 'Status') { e.at = when; e.user = who; break; }
        }
      }
    }
    const fu = followups.log({
      claimNo: claim.claimNo, method: FOLLOWUP_METHOD[method] || 'Portal', contact: `${payers.get(row.payerId)?.nameEn || row.payerId} appeals desk`,
      note: `Appeal ${row.id} (level ${row.level}) filed by ${method.toLowerCase()} — ref ${row.reference}${late ? ` — ${daysLate} days late, ${row.submission.lateOverride.reason}` : ''}`,
      nextDueAt: daysAfter(on, 30),
    }, { commit: false });
    if (fu && opts.at) { fu.at = when; fu.by = who; }
  }
  commitUnless(opts, 'appealCases.status');
  return row;
}

const FOLLOWUP_METHOD = { Portal: 'Portal', Email: 'Email', Fax: 'Email', Courier: 'Visit', 'Hand delivery': 'Visit' };

/** withdraw(id, reason) — before submission only; the denial's route ends and it goes back to F1 for re-triage. */
export function withdraw(id, reason = '', opts = {}) {
  const row = get(id);
  if (!row) return { error: 'No such case' };
  if (!beforeSubmission(row)) return { error: `A ${statusLabel(row.status).toLowerCase()} case is not withdrawn here${row.status === 'Submitted' ? ' — it is with the payer' : ''}` };
  if (!String(reason || '').trim()) return { error: 'Say why the appeal is being withdrawn' };
  const when = opts.at || new Date().toISOString();
  const who = opts.by || currentRole().name;
  row.status = 'Withdrawn';
  row.withdrawal = { reason: String(reason).trim(), at: when, by: who };
  touch(row, when);
  log(row, 'Withdrawn', String(reason).trim(), when, who);
  for (const denialId of row.denialIds) peers.denials?.releaseAppealRoute?.(denialId, { caseId: row.id, reason: String(reason).trim() }, { at: when, by: who });
  commitUnless(opts, 'appealCases.status');
  return row;
}

/** The level-2 door: a lost level-1 case, no child yet, the denial still open. */
export function canEscalate(id) {
  const row = get(id);
  if (!row) return { ok: false, why: 'No such case' };
  if (row.childCaseId) return { ok: false, why: `Level ${row.level + 1} already raised — ${row.childCaseId}` };
  if (beforeSubmission(row)) return { ok: false, why: 'The case has not gone to the payer yet' };
  const out = getAppealOutcome(id);
  if (!out) return { ok: false, why: settled && peers.tracking ? 'No outcome recorded yet' : 'Outcome tracking (amendment 39) is not on disk yet' };
  if (out.outcome !== 'Lost') return { ok: false, why: `The case was ${String(out.outcome).toLowerCase()} — a second level follows a loss` };
  const denial = denialOf(row);
  if (denial && !peers.denials.isOpen(denial)) return { ok: false, why: `${denial.id} is ${denial.status.toLowerCase()} — reopen the denial before a second level` };
  return { ok: true, why: '' };
}

/**
 * createNextLevel(parentCaseId, { denialId, claimNo, claimId, payerId,
 * amount, reason, note }, { at, by, commit }) → the level-2 case: Draft,
 * chained to its parent, the citations copied and the parent's package
 * pre-loaded as evidence. Amendment 39 calls it on a lost share dispositioned
 * escalate; the page calls it through the same door.
 */
export function createNextLevel(parentCaseId, data = {}, opts = {}) {
  const parent = get(parentCaseId);
  if (!parent) return { error: 'No such case' };
  if (parent.childCaseId) return { error: `Level ${parent.level + 1} already raised — ${parent.childCaseId}` };
  const denial = peers.denials?.get?.(data.denialId || parent.denialId) || null;
  if (denial && peers.denials && !peers.denials.isOpen(denial)) return { error: `${denial.id} is ${denial.status.toLowerCase()} — reopen it before a second level` };
  const when = opts.at || new Date().toISOString();
  const who = opts.by || currentRole().name;
  const decided = getAppealOutcome(parentCaseId)?.decidedAt || when;
  const row = create({
    denialId: data.denialId || parent.denialId, denialIds: parent.denialIds, claimNo: data.claimNo || parent.claimNo, claimId: data.claimId || parent.claimId,
    payerId: data.payerId || parent.payerId, amount: data.amount ?? (denial?.amounts?.open || parent.disputedAmount),
    appealBy: daysAfter(iso(decided), Number(cfg().level2WindowDays) || 30),
    reason: data.reason || `Level ${parent.level + 1} — ${parent.id} lost`, note: data.note || '',
    level: parent.level + 1, parentCaseId: parent.id, grounds: parent.grounds,
  }, { at: when, by: who, commit: false });
  row.letter.templateId = parent.letter.templateId;
  for (const c of parent.citations) row.citations.push({ ...c, id: nextSub(row.citations, 'CIT-'), sourceRef: { ...c.sourceRef }, addedAt: when });
  for (const b of includedBundle(parent)) row.bundle.push({ ...b, id: nextSub(row.bundle, 'B'), order: row.bundle.length + 1, addedAt: when });
  if (parent.packageRef) row.bundle.push({ id: nextSub(row.bundle, 'B'), type: 'Prior appeal package', source: 'system', ref: parent.packageRef, file: null, description: `Level ${parent.level} package ${parent.packageRef} — ${parent.id}`, href: `#/defensio/appeals/${parent.id}/package`, included: true, order: row.bundle.length + 1, addedAt: when });
  parent.childCaseId = row.id;
  touch(parent, when);
  log(parent, 'Escalated', `Level ${row.level} raised as ${row.id}`, when, who);
  peers.denials?.repointAppealRoute?.(row.denialId, { caseId: row.id, level: row.level }, { at: when, by: who });
  commitUnless(opts, 'appealCases.create');
  return row;
}

// --- seed ---------------------------------------------------------------------------------

let seeding = false;
function ensureSeeded() {
  const rows = store.table(TABLE);
  if (!settled || seeding || !peers.denials || rows.some((r) => r.seedTag === 'A38')) return;
  seeding = true;
  try {
    store.batch(() => buildAppealCases({ ...api, denials: peers.denials }));
  } finally {
    seeding = false;
  }
}
// A reset empties the table with everything else; the next tick rebuilds it once the denials have.
store.subscribe((why) => { if (why === 'reset') setTimeout(ensureSeeded, 0); });

/** What the seed drives — this file's own writes, dated by the seed. */
const api = {
  today: todayIso(), all, get, byDenial, create, setGrounds, addCitation, updateCitation, addBundleItem, setBundleIncluded, moveBundleItem, setTemplate,
  generateLetter, editLetter, submitForReview, review, generatePackage, submit, suggestedBundle, tag: (row) => { row.seedTag = 'A38'; },
};

// --- internals ------------------------------------------------------------------------------

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;
const byAt = (a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id);
const rank = (a) => (beforeSubmission(a) ? 0 : a.status === 'Withdrawn' ? 2 : 1);
const byRank = (a, b) => rank(a) - rank(b)
  || (rank(a) === 0 ? String(a.filingDeadline || '9999').localeCompare(String(b.filingDeadline || '9999')) : String(b.submittedAt || b.updatedAt).localeCompare(String(a.submittedAt || a.updatedAt)))
  || a.id.localeCompare(b.id);
const sameRef = (a, b) => a?.contractId === b?.contractId && a?.section === b?.section && (a?.rowId || null) === (b?.rowId || null) && (a?.planId || null) === (b?.planId || null);
const nextSub = (list, prefix) => `${prefix}${String(list.reduce((n, x) => Math.max(n, Number(String(x.id).replace(prefix, '')) || 0), 0) + 1).padStart(prefix === 'B' ? 1 : 2, '0')}`;
const daysAfter = (isoDate, n) => { const d = new Date(`${String(isoDate).slice(0, 10)}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function touch(row, at = null) { row.updatedAt = at || new Date().toISOString(); }
function commitUnless(opts, reason) { if (opts.commit !== false) store.commit(reason); }

function log(row, action, details, at, by) {
  audit.all().push({
    id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: row.id, action, details,
    user: by || currentRole().name, at: at || new Date().toISOString(),
  });
}

/** A stub-era row (amendment 36's shape, restored from the session) reads as a Draft with nothing on it yet. */
function upgrade(row) {
  const amount = cents(row.disputedAmount ?? row.amount);
  Object.assign(row, {
    level: row.level || 1, parentCaseId: row.parentCaseId ?? null, childCaseId: row.childCaseId ?? null,
    denialIds: row.denialIds || (row.denialId ? [row.denialId] : []),
    disputedAmount: amount, amount,
    grounds: row.grounds || { primary: '', secondary: [] }, citations: row.citations || [], bundle: row.bundle || [],
    letter: row.letter || { templateId: null, versions: [], finalLockedAt: null, lockedVersion: null },
    review: row.review || { rounds: [], requiredTier: tierFor(amount), requestedAt: null, requestedBy: null },
    status: row.status === 'Open' ? 'Draft' : row.status === 'Lodged' ? 'Submitted' : row.status,
    submission: row.submission ?? null, submittedAt: row.submittedAt ?? null, method: row.method ?? null, reference: row.reference ?? null, packageRef: row.packageRef ?? null,
    packages: row.packages || [], filingDeadline: row.filingDeadline || iso(row.appealBy) || null, outcome: row.outcome ?? null,
  });
}

/** The version stamped on the claim, by its id — never the current one. */
function contractLabel(claim) {
  if (!claim?.contractId) return 'no agreement on file';
  const c = contracts.get(claim.contractId);
  return c ? `contract ${c.contractNo} v${c.version}` : `contract ${claim.contractId}`;
}

function linesTable(lines) {
  if (!lines.length) return '<p>(no lines)</p>';
  return `<table class="tbl"><thead><tr><th>Line</th><th>Charge</th><th>Qty</th><th>Billed</th><th>Expected</th></tr></thead><tbody>${
    lines.map((l) => `<tr><td>${esc(l.id)}</td><td>${esc(l.chargeCode || l.itemId)} ${esc(l.description || '')}</td><td>${l.qty}</td><td>${esc(usd(l.grossBilled))}</td><td>${esc(usd(l.payerShare))}</td></tr>`).join('')}</tbody></table>`;
}

function citationsList(row) {
  if (!row.citations.length) return '';
  return `<ol>${row.citations.map((c) => `<li>${esc(c.renderedText)}${c.argument ? ` — ${esc(c.argument)}` : ''}</li>`).join('')}</ol>`;
}

function bundleIndex(row) {
  const items = includedBundle(row);
  if (!items.length) return '<p>(none)</p>';
  return `<ol>${items.map((b) => `<li>${esc(b.type)} — ${esc(b.description)}</li>`).join('')}</ol>`;
}
