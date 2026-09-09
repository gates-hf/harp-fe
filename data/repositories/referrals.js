// Repository — referrals. Owner: modules/frontis.
//
// A referral is a doctor's question, and it is spent by being answered. An
// inbound one arrives from a clinic and is consumed by the encounters it opens
// — one visit each, until the visits it was written for run out and it is Used.
// An outbound one is the same record read the other way: this hospital asking
// somebody else, printed and handed over.
//
// Two things follow from that. It has a life of its own — it expires whether or
// not anybody looks at it — and it can be taken for a patient nobody has
// registered yet, because the clinic that phoned had a name and a number and
// nothing else. `attachMrn` is how that person becomes a record, and the
// patients repository calls it the moment one exists.
//
// The dataset seeds itself on first read (data/seed/referrals.js) rather than
// through data/store.js: it reads the register, the encounter board and the
// expected arrivals to exist — the shape data/seed/encounters.js already uses.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as patients from './patients.js';
import * as sources from './referral-sources.js';
import * as policies from './policies.js';
import * as contracts from './contracts.js';
import * as cdm from './cdm.js';
import { buildReferrals, buildReferralTrail } from '../seed/referrals.js';
import { departmentOf } from '../seed/reference.js';
import { normalizePhone } from '../engines/name-match.js';
import { CONFIG as PLATFORM } from '../../shared/config.js';
import { compareDates, iso, todayIso } from '../../shared/format.js';

const TABLE = 'referrals';

/** The trail is keyed on this entity name; a referral's id is its number. */
const ENTITY = 'referrals';

export const DIRECTIONS = ['Inbound', 'Outbound'];

export const TYPES = ['External', 'Internal'];

export const STATUSES = ['New', 'Scheduled', 'Used', 'Expired', 'Rejected', 'Cancelled'];

/** The two a referral can still be spent from. */
export const OPEN_STATUSES = ['New', 'Scheduled'];

export const CONFIG = {
  // A referral this close to lapsing is shown amber on the worklist: it is
  // still good, and it is the one to book first.
  expiringDays: 7,
};

export function all() {
  const rows = store.table(TABLE);
  if (!rows.length) {
    rows.push(...buildReferrals());
    // The seeded register's own trail, written with the times the events
    // happened at. audit.log() would stamp every one of them with now and with
    // whoever is signed in, which is not what a history is.
    const trail = audit.all();
    for (const entry of buildReferralTrail(rows)) {
      trail.push({ id: store.nextId('audit', 'AU-'), ...entry });
    }
  }
  return rows;
}

export const get = (no) => all().find((row) => row.no === no) || null;

export const isOpen = (row) => OPEN_STATUSES.includes(row?.status);

export function statusTone(status) {
  if (status === 'New') return 'success';
  if (status === 'Scheduled') return 'accent';
  if (status === 'Rejected' || status === 'Cancelled') return 'critical';
  if (status === 'Expired') return 'warning';
  return '';
}

// --- reading ------------------------------------------------------------------

/** The name to show: the linked record's, or the one the clinic gave. */
export const patientName = (row) =>
  (row?.patientMrn ? patients.get(row.patientMrn)?.nameEn : row?.unregistered?.name) || '—';

export const phoneOf = (row) =>
  (row?.patientMrn ? patients.get(row.patientMrn)?.phone : row?.unregistered?.phone) || '';

/**
 * Who wrote it, in words. Inbound is the clinic and its doctor; outbound and
 * internal are our own department — the `source.doctorId` on those is one of
 * the hospital's DR- ids rather than a source in the referral register, which
 * is why the department is what this reads.
 */
export function sourceLabel(row) {
  const src = row?.source || {};
  if (src.facilityId) {
    const facility = sources.name(src.facilityId);
    const doctor = src.doctorId ? sources.get(src.doctorId)?.name : '';
    return doctor ? `${facility} · ${doctor}` : facility || '—';
  }
  return src.internalDepartment || '—';
}

/** Where it is going: our department inbound, the facility and doctor outbound. */
export function destinationLabel(row) {
  const dst = row?.destination || {};
  if (dst.facilityId) {
    const facility = sources.name(dst.facilityId);
    return dst.doctorName ? `${facility} · ${dst.doctorName}` : facility || '—';
  }
  return dst.department || dst.specialty || '—';
}

/** The two ends of the arrow, whichever way it points. */
export const partiesLabel = (row) =>
  (row?.direction === 'Inbound' ? sourceLabel(row) : destinationLabel(row));

export const specialtyOf = (row) => row?.destination?.specialty || '';

/** Days left on the validity, or null when it carries none. */
export function daysLeft(row, on = todayIso()) {
  if (!row?.validUntil) return null;
  const from = new Date(`${iso(on)}T00:00:00Z`).getTime();
  const to = new Date(`${iso(row.validUntil)}T00:00:00Z`).getTime();
  return Math.round((to - from) / 86400000);
}

export const isExpiring = (row, on = todayIso()) => {
  if (!isOpen(row)) return false;
  const left = daysLeft(row, on);
  return left !== null && left >= 0 && left <= CONFIG.expiringDays;
};

/** The visits still on it — a single-visit referral is 1 until it is spent. */
export const remaining = (row) => Math.max(0, Number(row?.visits?.remaining) || 0);

/** One patient's referrals, newest first — what the record's section lists. */
export const byPatient = (mrn) =>
  all()
    .filter((row) => row.patientMrn === mrn)
    .sort((a, b) => String(b.referralDate).localeCompare(String(a.referralDate)));

/**
 * Open referrals taken for a person with no record, matched on the number the
 * clinic gave. The digits are what is compared: a clerk writes 03 447 219 and
 * the clinic wrote +961 3 447 219, and they are the same phone.
 */
export const byPhone = (phone) => {
  const needle = digits(phone);
  if (needle.length < 7) return [];
  return all().filter((row) =>
    isOpen(row) && !row.patientMrn && digits(row.unregistered?.phone) === needle);
};

/** The inbound referrals still worth acting on — the nav badge and the card. */
export const activeInbound = () => all().filter((row) => row.direction === 'Inbound' && isOpen(row));

/** The referral holding a place on this pre-registration, if any. */
export const scheduledFor = (preregNo) =>
  all().find((row) => row.scheduledPreregNo === preregNo && isOpen(row)) || null;

/**
 * Every referral naming one encounter — the inbound one the visit answered, and
 * any outbound one written from it. The encounter's own `linked.referralId`
 * holds the inbound one alone, because that is the referral the payer asked for
 * and the only one that answers the flag.
 */
export const forEncounter = (encounterNo) =>
  all().filter((row) => (row.encounterNos || []).includes(encounterNo));


/**
 * The referrals a visit may be opened against: still open, still in date, with
 * a visit left on them, and about the department the visit is being booked in.
 * A referral that names no specialty fits anywhere — the clinic sent the
 * patient here and left the routing to us.
 */
export function validForEncounter(mrn, department = '', on = todayIso()) {
  const day = iso(on) || todayIso();
  return byPatient(mrn)
    .filter((row) => row.direction === 'Inbound' && isOpen(row) && remaining(row) > 0)
    .filter((row) => !row.validUntil || compareDates(row.validUntil, day) >= 0)
    .filter((row) => fitsDepartment(row, department))
    .sort((a, b) => String(a.validUntil || '').localeCompare(String(b.validUntil || '')));
}

/** Department match, or the specialty the reference list maps onto it. */
export function fitsDepartment(row, department = '') {
  if (!department) return true;
  const dst = row?.destination || {};
  if (dst.department) return dst.department === department;
  if (!dst.specialty) return true;
  return departmentOf(dst.specialty) === department;
}

/**
 * search(q, filters) — the worklist's one query, newest referral first. `view`
 * is the three the toggle offers: the inbound work, everything, or the outbound
 * side.
 */
export function search(q = '', {
  view = 'inbound', direction = '', status = '', specialty = '', sourceId = '',
  expiring = '', from = '', to = '',
} = {}) {
  const needle = String(q).trim().toLowerCase();
  const on = todayIso();
  return all()
    .filter((row) => {
      if (view === 'inbound' && !(row.direction === 'Inbound' && isOpen(row))) return false;
      if (view === 'outbound' && row.direction !== 'Outbound') return false;
      if (direction && row.direction !== direction) return false;
      if (status && row.status !== status) return false;
      if (expiring && !isExpiring(row, on)) return false;
      if (specialty && specialtyOf(row) !== specialty) return false;
      if (sourceId && ![row.source?.facilityId, row.source?.doctorId, row.destination?.facilityId].includes(sourceId)) {
        return false;
      }
      if (from && compareDates(row.referralDate, from) < 0) return false;
      if (to && compareDates(row.referralDate, to) > 0) return false;
      if (!needle) return true;
      return [
        row.no, patientName(row), row.patientMrn, phoneOf(row), row.payerRef,
        sourceLabel(row), destinationLabel(row), specialtyOf(row),
      ].some((v) => String(v || '').toLowerCase().includes(needle));
    })
    .sort((a, b) => String(b.referralDate).localeCompare(String(a.referralDate)) || b.no.localeCompare(a.no));
}

/**
 * The rail's figures, read off whatever list the worklist is showing, so the
 * number on a card and the row count under it are one figure. `outboundMonth`
 * is this calendar month, which is the period a referring pattern is read over.
 */
export function counts(rows = all()) {
  const on = todayIso();
  const month = on.slice(0, 7);
  return {
    inbound: rows.filter((row) => row.direction === 'Inbound' && isOpen(row)).length,
    expiring: rows.filter((row) => isExpiring(row, on)).length,
    scheduled: rows.filter((row) => row.status === 'Scheduled').length,
    outboundMonth: rows.filter((row) =>
      row.direction === 'Outbound' && String(row.referralDate).startsWith(month)).length,
  };
}

/** Next number in this year's sequence, read off the register itself. */
export function nextNo(year = new Date().getFullYear()) {
  const prefix = `REF-${year}-`;
  const max = all().reduce((n, row) => {
    if (!String(row.no).startsWith(prefix)) return n;
    const digitsOnly = Number(String(row.no).slice(prefix.length));
    return Number.isFinite(digitsOnly) && digitsOnly > n ? digitsOnly : n;
  }, 0);
  return prefix + String(max + 1).padStart(6, '0');
}

/** The default validity an inbound referral is written with. */
export const defaultValidUntil = (from = todayIso()) => {
  const when = new Date(`${iso(from)}T00:00:00Z`);
  when.setUTCDate(when.getUTCDate() + PLATFORM.referralValidityDays);
  return when.toISOString().slice(0, 10);
};

/**
 * Whether the payer wants a referral for this visit and none is in hand — the
 * flag an encounter carries. It reads the same contract rows the eligibility
 * ladder's sixth step reads, so the check and the flag cannot disagree; with no
 * services named the contract's own answer is the question, which is all a
 * registration desk knows.
 */
export function referralGap({ policyId = null, on = todayIso(), services = [], hasReferral = false } = {}) {
  if (hasReferral || !policyId) return false;
  const policy = policies.get(policyId);
  if (!policy) return false;
  const contract = contracts.contractForService(policy.payerId, policy.planId, iso(on) || todayIso());
  if (!contract) return false;
  const lines = (services || []).map((s) => cdm.get(s.itemId)).filter(Boolean);
  return lines.length
    ? lines.some((item) => contracts.referralRequired(contract, item))
    : contracts.referralRequired(contract, null);
}

// --- writes -------------------------------------------------------------------

export function create(data = {}) {
  const now = new Date().toISOString();
  const total = Math.max(1, Number(data.visits?.total) || 1);
  const row = {
    no: nextNo(),
    direction: 'Inbound',
    type: 'External',
    patientMrn: null,
    unregistered: null,
    source: { facilityId: null, doctorId: null, internalDepartment: null },
    destination: { facilityId: null, doctorName: null, specialty: '', department: null },
    reason: '',
    referralDate: todayIso(),
    validUntil: null,
    payerRef: null,
    letter: null,
    status: 'New',
    statusReason: '',
    scheduledPreregNo: null,
    encounterNos: [],
    ...data,
    visits: { total, remaining: total },
    createdAt: now,
    updatedAt: now,
  };
  all().push(row);
  sources.bump(row.source.facilityId, row.source.doctorId, row.destination.facilityId);
  store.commit('referral.create');
  log(row, 'Created',
    `${row.direction} ${row.type.toLowerCase()} — ${patientName(row)}, ${partiesLabel(row)}${
      row.destination.specialty ? ` · ${row.destination.specialty}` : ''}`);
  return row;
}

/** The fields the form may still change while the referral is open. */
export const FORM_FIELDS = [
  'type', 'patientMrn', 'unregistered', 'source', 'destination', 'reason',
  'referralDate', 'validUntil', 'payerRef', 'letter',
];

/**
 * Edit an open referral. The direction never moves — an inbound referral that
 * turned out to be outbound is a different referral — and neither does the
 * visit count once one has been spent, since the remaining count is evidence.
 */
export function update(no, patch = {}) {
  const row = get(no);
  if (!row || !isOpen(row)) return null;

  const before = snapshot(row);
  for (const key of FORM_FIELDS) if (key in patch) row[key] = patch[key];
  if (patch.visits && remaining(row) === row.visits.total) {
    const total = Math.max(1, Number(patch.visits.total) || 1);
    row.visits = { total, remaining: total };
  }
  row.updatedAt = new Date().toISOString();
  sources.bump(row.source.facilityId, row.source.doctorId, row.destination.facilityId);
  store.commit('referral.update');

  const changed = diff(before, snapshot(row));
  if (changed.length) log(row, 'Updated', changed.join('; '));
  return row;
}

/**
 * A visit was opened against it. One visit comes off, the encounter is kept,
 * and a referral with nothing left is Used — spent, not closed by anybody.
 */
export function link(no, encounterNo) {
  const row = get(no);
  if (!row || !isOpen(row) || !encounterNo || remaining(row) < 1) return null;
  if ((row.encounterNos || []).includes(encounterNo)) return row;
  row.encounterNos = [...(row.encounterNos || []), encounterNo];
  row.visits = { ...row.visits, remaining: remaining(row) - 1 };
  const left = remaining(row);
  if (!left) row.status = 'Used';
  row.updatedAt = new Date().toISOString();
  store.commit('referral.link');
  log(row, 'Linked', `Encounter ${encounterNo} — ${left} of ${row.visits.total} visit${
    row.visits.total === 1 ? '' : 's'} left${left ? '' : ', referral used'}`);
  return row;
}

/**
 * The visit an outbound referral was written from. It spends nothing: an
 * outbound referral is a question this hospital asked, and the encounter is
 * where it was asked, not where it was answered.
 */
export function attachEncounter(no, encounterNo) {
  const row = get(no);
  if (!row || row.direction !== 'Outbound' || !encounterNo) return null;
  if ((row.encounterNos || []).includes(encounterNo)) return row;
  row.encounterNos = [...(row.encounterNos || []), encounterNo];
  row.updatedAt = new Date().toISOString();
  store.commit('referral.attachEncounter');
  log(row, 'Linked', `Written from encounter ${encounterNo}`);
  return row;
}

/** A place is held for it on an expected arrival. */
export function schedule(no, preregNo) {
  const row = get(no);
  if (!row || !isOpen(row) || !preregNo) return null;
  row.scheduledPreregNo = preregNo;
  row.status = 'Scheduled';
  row.updatedAt = new Date().toISOString();
  store.commit('referral.schedule');
  log(row, 'Scheduled', `Held for ${preregNo}`);
  return row;
}

/** The clinic asked for something this hospital does not do, or will not. */
export const reject = (no, reason) => close(no, 'Rejected', reason);

/** Withdrawn by whoever wrote it, or entered twice. */
export const cancel = (no, reason) => close(no, 'Cancelled', reason);

function close(no, status, reason) {
  const row = get(no);
  if (!row || !isOpen(row) || !reason) return null;
  row.status = status;
  row.statusReason = reason;
  row.updatedAt = new Date().toISOString();
  store.commit('referral.close');
  log(row, status, reason);
  return row;
}

/**
 * More time on it. An expired referral is the main reason to reach for this, so
 * extending one puts it back on the worklist as New — the question it was
 * asking is still the question, and now there is time to answer it.
 */
export function extend(no, validUntil, reason) {
  const row = get(no);
  if (!row || !validUntil || !reason) return null;
  if (!isOpen(row) && row.status !== 'Expired') return null;
  if (compareDates(validUntil, todayIso()) <= 0) return null;

  const was = row.validUntil;
  const wasStatus = row.status;
  row.validUntil = iso(validUntil);
  if (row.status === 'Expired') row.status = row.scheduledPreregNo ? 'Scheduled' : 'New';
  row.updatedAt = new Date().toISOString();
  store.commit('referral.extend');
  log(row, 'Validity extended',
    `${was || 'none'} → ${row.validUntil} — ${reason}${wasStatus === 'Expired' ? `; ${wasStatus} → ${row.status}` : ''}`);
  return row;
}

/**
 * The patient this was taken for now has a record. Write-once and audited: it
 * changes only which record the referral hangs off, never what it asks for.
 * `patients.afterCreateHooks` calls it, so a walk-in registered at the desk
 * finds the referral the clinic phoned in last week.
 */
export function attachMrn(no, mrn) {
  const row = get(no);
  if (!row || row.patientMrn || !patients.get(mrn)) return null;
  row.patientMrn = mrn;
  row.updatedAt = new Date().toISOString();
  store.commit('referral.attach');
  log(row, 'Linked to patient', `${mrn} — registered ${patients.get(mrn).nameEn}`);
  return row;
}

/**
 * Open referrals whose validity has run out, retired on load. It is measured on
 * the day, not the hour: a referral good until the 30th is good all of the 30th.
 */
export function expireReferrals(on = todayIso()) {
  let closed = 0;
  for (const row of all()) {
    if (!isOpen(row) || !row.validUntil) continue;
    if (compareDates(row.validUntil, on) >= 0) continue;
    row.status = 'Expired';
    row.updatedAt = new Date().toISOString();
    log(row, 'Expired', `Valid until ${row.validUntil}, and ${remaining(row)} visit${
      remaining(row) === 1 ? '' : 's'} unspent`);
    closed += 1;
  }
  if (closed) store.commit('referral.expire');
  return closed;
}

// --- hooks --------------------------------------------------------------------

/**
 * A referral follows the patient when two records are folded together: the
 * question it asks is about the person, and the person is whichever record
 * survived.
 */
patients.relinkHooks.push({
  label: 'Referrals',
  count: (mrn) => all().filter((row) => row.patientMrn === mrn).length,
  relink: (fromMrn, toMrn) => {
    const moving = all().filter((row) => row.patientMrn === fromMrn);
    const now = new Date().toISOString();
    for (const row of moving) {
      row.patientMrn = toMrn;
      row.updatedAt = now;
      log(row, 'Re-linked', `Moved from ${fromMrn} to ${toMrn} on merge`);
    }
    return moving.length;
  },
});

/**
 * Registration resolves the referrals taken for that phone. It is the same act
 * as the pre-registration's: the evidence was always about this person, and now
 * there is a record to hang it off.
 */
patients.afterCreateHooks.push((patient) => {
  for (const row of byPhone(patient.phone)) attachMrn(row.no, patient.mrn);
});

// --- internals ----------------------------------------------------------------

/**
 * The comparable part of a number: the country code and the trunk zero are the
 * two things two people write differently for one phone, so both come off
 * before anything is compared. `normalizePhone` is the register's own rule.
 */
const digits = (value) => normalizePhone(value).replace(/^0+/, '');

const snapshot = (row) => ({
  type: row.type,
  patientMrn: row.patientMrn,
  name: patientName(row),
  source: sourceLabel(row),
  destination: destinationLabel(row),
  specialty: specialtyOf(row),
  reason: row.reason,
  referralDate: row.referralDate,
  validUntil: row.validUntil,
  payerRef: row.payerRef,
  letter: row.letter?.fileName || '',
  visits: row.visits.total,
});

const LABELS = {
  type: 'Type',
  patientMrn: 'Patient record',
  name: 'Patient',
  source: 'Source',
  destination: 'Destination',
  specialty: 'Specialty',
  reason: 'Reason',
  referralDate: 'Referral date',
  validUntil: 'Valid until',
  payerRef: 'Payer reference',
  letter: 'Letter',
  visits: 'Visits',
};

const show = (v) => (v === '' || v == null ? '—' : String(v));

const diff = (before, after) =>
  Object.entries(LABELS)
    .filter(([key]) => String(before[key] ?? '') !== String(after[key] ?? ''))
    .map(([key, text]) => `${text} ${show(before[key])} → ${show(after[key])}`);

function log(row, action, details) {
  audit.log({ entity: ENTITY, entityId: row.no, action, details });
}

/** Referrals past their validity are retired before any screen reads the list. */
expireReferrals();
