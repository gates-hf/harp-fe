// Repository — cost estimates. Owner: modules/frontis.
//
// An estimate is a quotation, not a posting: nothing here writes a charge, a
// claim or an encounter. It has two lives. While it is a Draft it is a working
// document and every field moves; the moment it is issued the price is frozen
// into `result` and never recomputed, because what the patient was handed is
// what the hospital has to stand behind — a contract that changes tomorrow
// changes the next estimate, not this one.
//
// Issuing also supersedes: a second estimate for the same subject over the same
// set of charges replaces the first, which is marked Superseded and points at
// the one that replaced it. Two live quotations for the same services is the
// one thing a front desk must never hand out.
//
// The dataset seeds itself on first read (data/seed/estimates.js) rather than
// through data/store.js: it reads the register, the policy chains, the charge
// master and the contracts to exist — the shape data/seed/eligibility.js and
// data/seed/encounters.js already use.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as patients from './patients.js';
import * as policies from './policies.js';
import * as payers from './payers.js';
import * as cdm from './cdm.js';
// data/engines/ reads repositories and no repository reads it back, so this is
// the same one-way arrow data/repositories/eligibility.js already makes to its
// own engine — estimate-pricing.js reads contracts and the charge master, never
// this file.
import { priceEstimate, grossOf, pricedLines } from '../engines/estimate-pricing.js';
import { buildEstimates, buildEstimateTrail } from '../seed/estimates.js';
import { CONFIG } from '../../shared/config.js';
import { current as currentRole } from '../../shared/roles.js';
import { compareDates, iso, todayIso } from '../../shared/format.js';

const TABLE = 'estimates';

/** The trail is keyed on this entity name; an estimate's id is its number. */
const ENTITY = 'estimate';

export const STATUSES = ['Draft', 'Issued', 'Converted', 'Expired', 'Superseded', 'Cancelled'];

/** The one status the builder edits from, and the one the document opens on. */
export const isDraft = (row) => row?.status === 'Draft';

/** Issued and still inside its validity — the only state anything acts on. */
export const isLive = (row, on = todayIso()) =>
  row?.status === 'Issued' && compareDates(row.validUntil, on) >= 0;

export { grossOf, pricedLines };

export function all() {
  const rows = store.table(TABLE);
  if (!rows.length) {
    rows.push(...buildEstimates());
    // The seeded trail, written with the times the events happened at rather
    // than through audit.log(), which would stamp every one of them with now
    // and with whoever is signed in.
    const trail = audit.all();
    for (const entry of buildEstimateTrail(rows)) {
      trail.push({ id: store.nextId('audit', 'AU-'), ...entry });
    }
  }
  return rows;
}

export const get = (no) => all().find((row) => row.no === no) || null;

export function statusTone(status) {
  if (status === 'Issued') return 'success';
  if (status === 'Draft') return 'warning';
  if (status === 'Converted') return 'accent';
  if (status === 'Cancelled') return 'critical';
  return '';
}

// --- reading ------------------------------------------------------------------

/** The name on the document: the register's, or the one taken at the counter. */
export const subjectName = (row) =>
  (row?.subject?.kind === 'patient'
    ? patients.get(row.subject.mrn)?.nameEn || row.subject.mrn
    : row?.subject?.name) || '—';

export const isProspect = (row) => row?.subject?.kind === 'prospect';

/** Two estimates are for the same person when they name the same record. */
export const sameSubject = (a, b) =>
  (a?.subject?.kind === 'patient' && b?.subject?.kind === 'patient'
    ? a.subject.mrn === b.subject.mrn
    : a?.subject?.kind === 'prospect' && b?.subject?.kind === 'prospect'
      && String(a.subject.name).trim().toLowerCase() === String(b.subject.name).trim().toLowerCase()
      && String(a.subject.phone).trim() === String(b.subject.phone).trim());

/** The cover in words — a policy on the chain, a plan picked by hand, or none. */
export function coverLabel(row) {
  const policy = row?.policy || {};
  if (policy.selfPay || (!policy.policyId && !policy.planId)) return 'Self-Pay';
  if (policy.policyId) {
    const found = policies.get(policy.policyId);
    if (found) return policies.label(found);
  }
  const payer = payers.get(policy.payerId) || policies.payerOfPlan(policy.planId);
  const plan = payer?.plans.find((p) => p.id === policy.planId);
  return `${payer?.nameEn || '—'}${plan ? ` · ${plan.name}` : ''}`;
}

/** "MRI brain, CBC +2" — the services column, first two and a count. */
export function servicesLabel(row) {
  const names = (row?.lines || []).map((line) => cdm.label(cdm.get(line.itemId))).filter(Boolean);
  if (!names.length) return 'No services';
  const shown = names.slice(0, 2).join(', ');
  return names.length > 2 ? `${shown} +${names.length - 2}` : shown;
}

/** Days until the estimate lapses; negative once it has. */
export function daysLeft(row) {
  const until = iso(row?.validUntil);
  if (!until) return null;
  return Math.round((Date.parse(until) - Date.parse(todayIso())) / 86400000);
}

/** One patient's estimates, newest first — what the record's section shows. */
export const byPatient = (mrn) =>
  all()
    .filter((row) => row.subject?.kind === 'patient' && row.subject.mrn === mrn)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

/** The estimates hung off one encounter, in the order they were converted. */
export const byEncounter = (no) => all().filter((row) => row.encounterNo === no);

/** Issued and still valid for this patient — what financial clearance reads. */
export const validForClearance = (mrn) => byPatient(mrn).filter((row) => isLive(row));

/**
 * search(q, filters) — the list's one query, newest first. `q` matches the
 * number, the subject's name and, for a registered one, the MRN.
 *
 * `live`, `expiring` and `convertedMonth` are the three slices the rail counts
 * and no select on the screen offers: validity is a fact about today, not a
 * status a clerk picks, so the card that counts them is their only control and
 * Clear filters clears them with the rest.
 */
export function search(q = '', {
  status = '', payerId = '', creator = '', from = '', to = '',
  live = false, expiring = false, convertedMonth = false,
} = {}) {
  const needle = String(q).trim().toLowerCase();
  const on = todayIso();
  return all()
    .filter((row) => {
      if (live && !isLive(row, on)) return false;
      if (expiring && !(isLive(row, on) && daysLeft(row) <= EXPIRING_DAYS)) return false;
      if (convertedMonth && !(row.status === 'Converted' && String(row.convertedAt).slice(0, 7) === on.slice(0, 7))) return false;
      if (status && row.status !== status) return false;
      if (payerId && row.policy?.payerId !== payerId) return false;
      if (creator && row.createdBy !== creator) return false;
      const day = String(row.createdAt).slice(0, 10);
      if (from && compareDates(day, from) < 0) return false;
      if (to && compareDates(day, to) > 0) return false;
      if (!needle) return true;
      return [row.no, subjectName(row), row.subject?.mrn, row.subject?.phone]
        .some((v) => String(v || '').toLowerCase().includes(needle));
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** How near the end of its validity an estimate starts asking to be reissued. */
export const EXPIRING_DAYS = 3;

/** The rail's figures, read off whatever list the screen is showing. */
export function counts(rows = all()) {
  const on = todayIso();
  const month = on.slice(0, 7);
  return {
    total: rows.length,
    live: rows.filter((row) => isLive(row, on)).length,
    drafts: rows.filter(isDraft).length,
    expiring: rows.filter((row) => isLive(row, on) && daysLeft(row) <= EXPIRING_DAYS).length,
    converted: rows.filter((row) => row.status === 'Converted' && String(row.convertedAt).slice(0, 7) === month).length,
  };
}

/** Next number in this year's sequence, read off the register itself. */
export function nextNo(year = new Date().getFullYear()) {
  const prefix = `EST-${year}-`;
  const max = all().reduce((n, row) => {
    if (!String(row.no).startsWith(prefix)) return n;
    const digits = Number(String(row.no).slice(prefix.length));
    return Number.isFinite(digits) && digits > n ? digits : n;
  }, 0);
  return prefix + String(max + 1).padStart(6, '0');
}

// --- pricing ------------------------------------------------------------------

/**
 * What this estimate would cost, run now. The builder calls it on Simulate and
 * issue() calls it once more before freezing — the same function either way, so
 * what is printed is what was on screen.
 */
export function simulate(row) {
  const patient = row?.subject?.kind === 'patient' ? patients.get(row.subject.mrn) : null;
  return priceEstimate(row, { patient, disclaimer: CONFIG.estimateDisclaimer });
}

// --- writes -------------------------------------------------------------------

export function create(data = {}) {
  const now = new Date().toISOString();
  const row = {
    no: nextNo(),
    status: 'Draft',
    subject: { kind: 'patient', mrn: '' },
    policy: { policyId: null, payerId: null, planId: null, selfPay: false },
    context: { visitType: 'Outpatient', department: '', dateOfService: todayIso() },
    lines: [],
    result: null,
    issuedAt: null,
    issuedBy: null,
    validUntil: null,
    supersededBy: null,
    supersedes: null,
    encounterNo: null,
    convertedAt: null,
    cancelReason: '',
    ...data,
    createdAt: now,
    createdBy: currentRole().name,
    updatedAt: now,
  };
  all().push(row);
  store.commit('estimate.create');
  log(row, 'Created', `${subjectName(row)} — ${coverLabel(row)}, ${row.lines.length} service${row.lines.length === 1 ? '' : 's'}`);
  return row;
}

/** A draft is the only thing that moves. Everything else is a frozen document. */
export function updateDraft(no, patch = {}, { details = 'Draft saved' } = {}) {
  const row = get(no);
  if (!row || !isDraft(row)) return null;
  const { no: ignored, status, result, ...rest } = patch;
  Object.assign(row, rest, { updatedAt: new Date().toISOString() });
  store.commit('estimate.update');
  log(row, 'Updated', details);
  return row;
}

/**
 * Issue: run the engine one last time, freeze what it answered, and stamp the
 * validity. The price stops moving here — every screen from now on reads
 * `result` and never the engine, which is what makes the document evidence.
 */
export function issue(no, { validUntil = '' } = {}) {
  const row = get(no);
  if (!row || !isDraft(row)) return null;
  if (!pricedLines(row).length) return null;

  const now = new Date().toISOString();
  row.result = simulate(row);
  row.status = 'Issued';
  row.issuedAt = now;
  row.issuedBy = currentRole().name;
  row.validUntil = iso(validUntil) || addDays(todayIso(), CONFIG.estimateValidityDays);
  row.updatedAt = now;
  store.commit('estimate.issue');
  log(row, 'Issued',
    `${row.result.contract ? `${row.result.contract.no} v${row.result.contract.version}` : 'Self-Pay'} — `
    + `patient share ${row.result.totals.patientShare.toFixed(2)}, valid to ${row.validUntil}`);
  supersede(row);
  return row;
}

/**
 * The one issued estimate for a subject and a set of services. Anything else
 * live over exactly the same charges is replaced, not left standing: a desk
 * that can hand out two prices for one operation has no price.
 */
function supersede(row) {
  const signature = lineSignature(row);
  const replaced = all().filter(
    (other) => other.no !== row.no && other.status === 'Issued'
      && sameSubject(other, row) && lineSignature(other) === signature,
  );
  if (!replaced.length) return [];
  for (const other of replaced) {
    other.status = 'Superseded';
    other.supersededBy = row.no;
    other.updatedAt = new Date().toISOString();
    log(other, 'Superseded', `Replaced by ${row.no} over the same services`);
  }
  log(row, 'Supersedes', `Replaces ${replaced.map((r) => r.no).join(', ')}`);
  store.commit('estimate.supersede');
  return replaced;
}

/** The set of charges, order-independent — what "the same estimate" means. */
const lineSignature = (row) =>
  [...new Set((row.lines || []).map((line) => line.itemId))].sort().join('|');

/**
 * A copy to work on. The source stays Issued until the copy is issued in its
 * turn, because a quotation being revised is still the quotation in force.
 */
export function duplicate(no) {
  const source = get(no);
  if (!source) return null;
  const copy = create({
    subject: { ...source.subject },
    policy: { ...source.policy },
    context: { ...source.context, dateOfService: todayIso() },
    lines: source.lines.map((line) => ({ ...line, consumption: (line.consumption || []).map((c) => ({ ...c })) })),
    supersedes: source.no,
  });
  log(copy, 'Duplicated', `Copied from ${source.no}`);
  return copy;
}

/** The prospect became a patient: the document is re-pointed at the record. */
export function linkSubject(no, mrn) {
  const row = get(no);
  if (!row || !mrn || !patients.get(mrn) || row.subject?.kind !== 'prospect') return null;
  const was = row.subject.name;
  row.subject = { kind: 'patient', mrn };
  row.updatedAt = new Date().toISOString();
  store.commit('estimate.link-subject');
  log(row, 'Linked', `Prospect ${was} linked to ${mrn}`);
  return row;
}

/** The encounter the estimate became. Written once, by the encounter flow. */
export function markConverted(no, encounterNo) {
  const row = get(no);
  if (!row || !encounterNo || !isLive(row)) return null;
  row.status = 'Converted';
  row.encounterNo = encounterNo;
  row.convertedAt = new Date().toISOString();
  row.updatedAt = row.convertedAt;
  store.commit('estimate.converted');
  log(row, 'Converted', `Encounter ${encounterNo}`);
  return row;
}

export function cancel(no, reason = '') {
  const row = get(no);
  if (!row || !(isDraft(row) || row.status === 'Issued')) return null;
  const was = row.status;
  row.status = 'Cancelled';
  row.cancelReason = reason;
  row.updatedAt = new Date().toISOString();
  store.commit('estimate.cancel');
  log(row, 'Cancelled', `${was} → Cancelled${reason ? ` — ${reason}` : ''}`);
  return row;
}

/**
 * Issued estimates past their validity, retired on load. A lapsed price is not
 * wrong, it is old: the document stays readable and says so on its face.
 */
export function expireEstimates(on = todayIso()) {
  let closed = 0;
  for (const row of all()) {
    if (row.status !== 'Issued' || compareDates(row.validUntil, on) >= 0) continue;
    row.status = 'Expired';
    row.updatedAt = new Date().toISOString();
    log(row, 'Expired', `Validity ended ${row.validUntil}`);
    closed += 1;
  }
  if (closed) store.commit('estimate.expire');
  return closed;
}

// --- merge --------------------------------------------------------------------

/**
 * Estimates follow the patient when two records are folded together, the way
 * the policies and the pre-registrations do: a quotation given to a person is
 * still a quotation given to whichever record survived.
 */
patients.relinkHooks.push({
  label: 'Estimates',
  count: (mrn) => byPatient(mrn).length,
  relink: (fromMrn, toMrn) => {
    const moving = byPatient(fromMrn);
    const now = new Date().toISOString();
    for (const row of moving) {
      row.subject = { kind: 'patient', mrn: toMrn };
      row.updatedAt = now;
      log(row, 'Re-linked', `Moved from ${fromMrn} to ${toMrn} on merge`);
    }
    return moving.length;
  },
});

// --- internals ----------------------------------------------------------------

function addDays(day, n) {
  const when = new Date(`${day}T00:00:00.000Z`);
  when.setUTCDate(when.getUTCDate() + n);
  return when.toISOString().slice(0, 10);
}

function log(row, action, details) {
  audit.log({ entity: ENTITY, entityId: row.no, action, details });
}


expireEstimates();
