// Repository — encounters. Owner: modules/frontis.
//
// The encounter is the spine the rest of the platform hangs off: pre-auth,
// clearance, estimates, referrals and the patient account all point at one
// encounter number. So a row carries two bags this file records but does not
// reason about — `linked`, the ids those later features write through
// linkRecord(), and `clearance`, the stamp the financial clearance feature
// stamps. Adding one of them never changes this file.
//
// The dataset seeds itself on first read (data/seed/encounters.js) rather than
// through data/store.js: it reads the register, the policy chains and the
// eligibility trail to exist — the shape data/seed/claims.js and
// data/seed/eligibility.js already use.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as patients from './patients.js';
import * as policies from './policies.js';
import * as payers from './payers.js';
import { buildEncounters, buildEncounterTrail } from '../seed/encounters.js';
import { doctorName } from '../seed/reference.js';
import { current as currentRole } from '../../shared/roles.js';
import { compareDates, iso, todayIso } from '../../shared/format.js';

const TABLE = 'encounters';

/** The trail is keyed on this entity name; an encounter's id is its number. */
const ENTITY = 'encounters';

export const TYPES = ['OP', 'IP', 'ER'];
export const TYPE_LABELS = { OP: 'Outpatient', IP: 'Inpatient', ER: 'Emergency' };

/**
 * The eligibility engine speaks in visit types, the board in two-letter codes.
 * One map, so a check run from registration is scoped the way a check run from
 * the desk is.
 */
export const VISIT_TYPE_OF = { OP: 'Outpatient', IP: 'Inpatient', ER: 'Emergency' };

/**
 * The way back. A cost estimate and an eligibility check speak in visit types,
 * where Day Case is a word of its own; the board has no Day Case, because a day
 * case is booked as an outpatient visit and priced as a day case. Anything that
 * arrives holding a visit type reads its encounter type here rather than
 * guessing, so the three vocabularies meet in one place.
 */
export const TYPE_OF_VISIT = {
  Outpatient: 'OP', Inpatient: 'IP', Emergency: 'ER', 'Day Case': 'OP',
};

export const STATUSES = ['Planned', 'Active', 'Discharged', 'Completed', 'Cancelled'];

/** The two an encounter can still be worked on from. */
export const OPEN_STATUSES = ['Planned', 'Active'];

export const CLEARANCE_STATUSES = ['Not started', 'Pending', 'Cleared', 'Blocked'];

/** Which field of `linked` each later feature writes into. */
export const LINK_FIELDS = {
  referral: 'referralId',
  preAuth: 'preAuthIds',
  clearance: 'clearanceId',
  estimate: 'estimateIds',
  account: 'accountId',
};

export const CONFIG = {
  // The hour an outpatient visit is deemed to have ended on the day it opened.
  // Nobody closes an OP encounter by hand, so the sweep does it overnight.
  opAutoCompleteHour: 23,
};

export function all() {
  const rows = store.table(TABLE);
  if (!rows.length) {
    rows.push(...buildEncounters());
    // The seeded register's own trail, written with the times the events
    // happened at. audit.log() would stamp every one of them with now and with
    // whoever is signed in, which is not what a history is.
    const trail = audit.all();
    for (const entry of buildEncounterTrail(rows)) {
      trail.push({ id: store.nextId('audit', 'AU-'), ...entry });
    }
  }
  return rows;
}

export const get = (no) => all().find((row) => row.no === no) || null;

export const isOpen = (enc) => OPEN_STATUSES.includes(enc?.status);

export const typeLabel = (type) => TYPE_LABELS[type] || type || '—';

export function statusTone(status) {
  if (status === 'Active') return 'success';
  if (status === 'Planned') return 'accent';
  if (status === 'Cancelled') return 'critical';
  return '';
}

/** Newest first — what the patient record's Encounters tab draws. */
export const byPatient = (mrn) =>
  all()
    .filter((row) => row.patientMrn === mrn)
    .sort((a, b) => String(b.startAt).localeCompare(String(a.startAt)));

/**
 * The open encounter of the same type this patient already has, if any. It is
 * what registration warns on: a second outpatient visit booked while the first
 * is still open is nearly always the same visit entered twice.
 */
export const activeOfType = (mrn, type) =>
  all().find((row) => row.patientMrn === mrn && row.type === type && isOpen(row)) || null;

/**
 * Today's work, which is not the same as today's start times: a patient
 * admitted on Monday is still on the ward on Wednesday. So the scope is
 * everything that started today plus everything still open.
 */
export const today = (on = todayIso()) =>
  all().filter((row) => startedOn(row, on) || isOpen(row));

export const startedOn = (row, on = todayIso()) => String(row.startAt).slice(0, 10) === iso(on);

/**
 * The board's list. `scope` is 'today' or 'all'; `financial` is a payer id or
 * 'self' for the self-pay bucket. Search reads the number, the patient name and
 * the MRN — the three things written on a wristband.
 */
export function search(q = '', {
  scope = 'today', type = '', status = '', department = '', doctorId = '',
  from = '', to = '', financial = '',
} = {}) {
  const needle = q.trim().toLowerCase();
  const rows = (scope === 'all' ? all() : today()).filter((row) => {
    if (type && row.type !== type) return false;
    if (status && row.status !== status) return false;
    if (department && row.department !== department) return false;
    if (doctorId && row.doctorId !== doctorId) return false;
    if (financial === 'self' && row.financial.payerId) return false;
    if (financial && financial !== 'self' && row.financial.payerId !== financial) return false;
    const day = String(row.startAt).slice(0, 10);
    if (from && compareDates(day, from) < 0) return false;
    if (to && compareDates(day, to) > 0) return false;
    if (!needle) return true;
    return (
      row.no.toLowerCase().includes(needle) ||
      row.patientMrn.toLowerCase().includes(needle) ||
      (patients.get(row.patientMrn)?.nameEn || '').toLowerCase().includes(needle)
    );
  });
  // Newest first: the board is read from the top, and the top is now.
  return rows.sort((a, b) => String(b.startAt).localeCompare(String(a.startAt)));
}

/** The rail's figures, read off whatever list the board is showing. */
export function counts(rows = today()) {
  const on = todayIso();
  const startedToday = rows.filter((row) => startedOn(row, on));
  return {
    active: rows.filter((row) => row.status === 'Active').length,
    op: startedToday.filter((row) => row.type === 'OP').length,
    ip: startedToday.filter((row) => row.type === 'IP').length,
    er: startedToday.filter((row) => row.type === 'ER').length,
    planned: rows.filter((row) => row.status === 'Planned').length,
    notCleared: rows.filter((row) => needsClearance(row)).length,
  };
}

/**
 * Clearance work, not the absence of clearance. An outpatient visit that never
 * needed clearing sits at Not started for ever, so counting it would make the
 * card a headcount; Pending and Blocked are the two the desk has to chase.
 */
export const needsClearance = (row) =>
  row.clearance?.status === 'Pending' || row.clearance?.status === 'Blocked';

/**
 * What the clearance column and the encounter header show: a short word for the
 * chip, the icon for the header line beside it, the tone, and the whole answer —
 * the items included — for the tooltip.
 */
export function clearanceIndicator(enc) {
  const status = enc?.clearance?.status || 'Not started';
  // A flag is an item the clearance desk has to answer for, so it reads as one
  // wherever the clearance answer is read — the board's tooltip included.
  const items = [...(enc?.clearance?.items || []), ...clearanceFlags(enc)];
  const detail = items.length ? ` — ${items.join('; ')}` : '';
  if (status === 'Cleared') return { status, short: 'Cleared', icon: 'check_circle', tone: 'success', label: `Financially cleared${detail}` };
  if (status === 'Blocked') return { status, short: 'Blocked', icon: 'block', tone: 'critical', label: `Clearance blocked${detail}` };
  if (status === 'Pending') return { status, short: 'Pending', icon: 'pending', tone: 'warning', label: `Clearance pending${detail}` };
  return { status, short: 'Not started', icon: 'radio_button_unchecked', tone: '', label: 'Clearance not started' };
}

/** The flags that are clearance work rather than a stamp of their own. */
export const clearanceFlags = (enc) =>
  (enc?.flags?.referralMissing ? ['Referral required — missing'] : []);

// --- financial classification -------------------------------------------------

/**
 * The short name a payer is known by at the desk, read off the licence number
 * every payer carries (GOV-NSSF-001 -> NSSF, INS-AXA-102 -> AXA) and falling
 * back to the first word of the name. The full payer and plan ride in the
 * column's tooltip, so the short form never has to carry them.
 */
export function shortPayer(payer) {
  if (!payer) return 'Self-Pay';
  const middle = String(payer.licenseNo || '').split('-')[1];
  return middle && /^[A-Z]{2,6}$/.test(middle) ? middle : payer.nameEn.split(' ')[0];
}

/** The Financial Class column: a payer's short name, or Self-Pay. */
export const financialLabel = (enc) =>
  (enc?.financial?.payerId ? shortPayer(payers.get(enc.financial.payerId)) : 'Self-Pay');

/** What that label stands for, in full — the tooltip beside it. */
export function financialTitle(enc) {
  const financial = enc?.financial;
  if (!financial?.payerId) return 'Self-Pay — no policy carried the visit';
  const payer = payers.get(financial.payerId);
  const plan = payer?.plans.find((p) => p.id === financial.planId);
  return `${payer?.nameEn || financial.payerId}${plan ? ` · ${plan.name}` : ''}`;
}

/**
 * One classification, built the same way whether registration set it or a
 * re-classification replaced it. A null policy is the self-pay decision, which
 * is a decision like any other and is recorded as one.
 */
export function classification({ policyId = null, snapshotRef = null, reason = null, overrideRef = null } = {}) {
  const policy = policyId ? policies.get(policyId) : null;
  return {
    policyId: policy ? policy.id : null,
    payerId: policy ? policy.payerId : null,
    planId: policy ? policy.planId : null,
    snapshotRef,
    classifiedAt: new Date().toISOString(),
    classifiedBy: currentRole().name,
    reason,
    overrideRef,
  };
}

const coverOf = (financial) => {
  if (!financial?.payerId) return 'Self-Pay';
  const payer = payers.get(financial.payerId);
  const plan = payer?.plans.find((p) => p.id === financial.planId);
  return `${payer?.nameEn || financial.payerId}${plan ? ` · ${plan.name}` : ''}`;
};

// --- writes -------------------------------------------------------------------

/** Next number in this year's sequence, read off the register itself. */
export function nextNo(year = new Date().getFullYear()) {
  const prefix = `ENC-${year}-`;
  const max = all().reduce((n, row) => {
    if (!String(row.no).startsWith(prefix)) return n;
    const digits = Number(String(row.no).slice(prefix.length));
    return Number.isFinite(digits) && digits > n ? digits : n;
  }, 0);
  return prefix + String(max + 1).padStart(6, '0');
}

export function create(data = {}) {
  const now = new Date().toISOString();
  const row = {
    no: nextNo(),
    patientMrn: '',
    type: 'OP',
    department: '',
    doctorId: '',
    visitReason: '',
    ward: '',
    bedClass: '',
    expectedLos: null,
    startAt: now,
    endAt: null,
    cancelReason: '',
    los: null,
    financial: classification(),
    financialHistory: [],
    chargesPosted: false,
    clearance: { status: 'Not started', items: [] },
    // What the visit is short of, stamped by the feature that noticed. The
    // referral flag is set at registration when the payer asked for one and
    // none was in hand, and cleared by linking a referral.
    flags: { referralMissing: false },
    linked: { referralId: null, preAuthIds: [], clearanceId: null, estimateIds: [], accountId: null },
    ...data,
    createdAt: now,
    updatedAt: now,
  };
  // Status is a fact about the start time, never a field the caller passes: a
  // visit booked for this afternoon is Planned, one opened at the desk is Active.
  row.status = new Date(row.startAt).getTime() > Date.now() ? 'Planned' : 'Active';
  all().push(row);
  store.commit('encounter.create');
  log(row, 'Created',
    `${typeLabel(row.type)} — ${row.department}, ${doctorName(row.doctorId)}, ${coverOf(row.financial)} (${row.status})`);
  return row;
}

/** The fields an open encounter may still be edited on: the visit, not the money. */
export const VISIT_FIELDS = ['department', 'doctorId', 'visitReason', 'ward', 'bedClass', 'expectedLos'];

const FIELD_LABELS = {
  department: 'Department',
  doctorId: 'Doctor',
  visitReason: 'Visit reason',
  ward: 'Ward',
  bedClass: 'Bed class',
  expectedLos: 'Expected LOS',
};

/**
 * Edit the visit. Who pays is not editable here — that is a re-classification,
 * which asks for a reason and keeps what it replaced.
 */
export function updateVisit(no, patch = {}) {
  const row = get(no);
  if (!row || !isOpen(row)) return null;
  const changed = [];
  for (const key of VISIT_FIELDS) {
    if (!(key in patch)) continue;
    const next = key === 'expectedLos' ? (patch[key] === '' || patch[key] === null ? null : Number(patch[key])) : patch[key];
    if ((row[key] ?? null) === (next ?? null)) continue;
    changed.push(`${FIELD_LABELS[key]}: ${show(key, row[key])} → ${show(key, next)}`);
    row[key] = next;
  }
  if (!changed.length) return row;
  row.updatedAt = new Date().toISOString();
  store.commit('encounter.update');
  log(row, 'Updated', changed.join('; '));
  return row;
}

const show = (key, value) => {
  if (value === null || value === undefined || value === '') return '—';
  return key === 'doctorId' ? doctorName(value) : String(value);
};

/** The patient arrived, so a planned visit opens — on the clock, not the diary. */
export function activate(no) {
  const row = get(no);
  if (!row || row.status !== 'Planned') return null;
  const now = new Date().toISOString();
  const booked = row.startAt;
  row.status = 'Active';
  // A visit booked for later that opens now started now: the length of stay and
  // the board's "today" both read the start, so it has to be the real one.
  if (new Date(booked).getTime() > Date.now()) row.startAt = now;
  row.updatedAt = now;
  store.commit('encounter.activate');
  log(row, 'Activated', booked === row.startAt ? 'Encounter opened' : `Opened early — booked for ${booked.slice(0, 16).replace('T', ' ')}`);
  return row;
}

/**
 * Why a cancellation may be refused, or '' when it may go ahead. Charges are
 * the reason: once billing has posted against an encounter, cancelling it is a
 * financial correction and not a front-desk one.
 */
export function cancelBlocked(enc, role = currentRole()) {
  if (!enc) return 'No such encounter';
  if (!isOpen(enc)) return `A ${String(enc.status).toLowerCase()} encounter cannot be cancelled`;
  if (enc.chargesPosted && !role.canCancelWithCharges) {
    return `Charges are posted against this encounter. ${role.title} cannot cancel one that has billed.`;
  }
  return '';
}

export function cancel(no, reason) {
  const row = get(no);
  if (!row || cancelBlocked(row) || !reason) return null;
  const now = new Date().toISOString();
  row.status = 'Cancelled';
  row.cancelReason = reason;
  row.endAt = now;
  row.updatedAt = now;
  store.commit('encounter.cancel');
  log(row, 'Cancelled', reason);
  return row;
}

/** Length of stay in days, counted from the start; a same-day stay is one day. */
export function lengthOfStay(startAt, endAt) {
  const ms = new Date(endAt).getTime() - new Date(startAt).getTime();
  return Math.max(1, Math.ceil(ms / 86400000));
}

/** Only a bed carries a discharge: an outpatient visit completes on its own. */
export function discharge(no, at) {
  const row = get(no);
  if (!row || row.status !== 'Active' || row.type === 'OP') return null;
  const end = new Date(at);
  if (!at || Number.isNaN(end.getTime()) || end.getTime() < new Date(row.startAt).getTime()) return null;
  row.endAt = end.toISOString();
  row.los = lengthOfStay(row.startAt, row.endAt);
  row.status = 'Discharged';
  row.updatedAt = new Date().toISOString();
  store.commit('encounter.discharge');
  log(row, 'Discharged', `Discharged ${row.endAt.slice(0, 16).replace('T', ' ')} — ${row.los} day${row.los === 1 ? '' : 's'}`);
  return row;
}

/**
 * An outpatient visit is never closed by hand, so yesterday's open ones are
 * closed here on load. It runs before any screen renders, which is why the
 * board never shows an OP encounter that has been Active since last week.
 */
export function autoCompleteOutpatients(on = todayIso()) {
  const now = new Date().toISOString();
  let closed = 0;
  for (const row of all()) {
    if (row.type !== 'OP' || row.status !== 'Active') continue;
    const day = String(row.startAt).slice(0, 10);
    if (compareDates(day, on) >= 0) continue;
    row.status = 'Completed';
    row.endAt = `${day}T${String(CONFIG.opAutoCompleteHour).padStart(2, '0')}:00:00.000Z`;
    row.updatedAt = now;
    closed += 1;
    log(row, 'Completed', `Outpatient visit closed automatically at ${CONFIG.opAutoCompleteHour}:00 on ${day}`);
  }
  if (closed) store.commit('encounter.autocomplete');
  return closed;
}

/**
 * The cover changed after the encounter opened — a card produced late, a policy
 * that turned out to be suspended. The classification it replaces is kept, so
 * the Financial tab can show what the visit was opened under.
 */
export function reclassify(no, { policyId = null, snapshotRef = null, reason = '', overrideRef = null } = {}) {
  const row = get(no);
  if (!row || !reason) return null;
  const before = row.financial;
  row.financialHistory = [...(row.financialHistory || []), before];
  row.financial = classification({ policyId, snapshotRef, reason, overrideRef });
  row.updatedAt = new Date().toISOString();
  store.commit('encounter.reclassify');
  log(row, 'Re-classified', `${coverOf(before)} → ${coverOf(row.financial)} — ${reason}`);
  return row;
}

/**
 * The hook the later features register their record through: a pre-auth, a
 * clearance, an estimate, a referral or the patient account. Two of the five
 * are lists, so the kind decides whether the id is set or appended.
 */
export function linkRecord(no, kind, id) {
  const row = get(no);
  const field = LINK_FIELDS[kind];
  if (!row || !field || !id) return null;
  if (Array.isArray(row.linked[field])) {
    if (row.linked[field].includes(id)) return row;
    row.linked[field] = [...row.linked[field], id];
  } else {
    row.linked[field] = id;
  }
  // The one flag a link answers: the payer wanted a referral and now there is
  // one. It is cleared here rather than by the referral feature, so any caller
  // that links a referral clears it.
  if (kind === 'referral' && row.flags?.referralMissing) row.flags = { ...row.flags, referralMissing: false };
  row.updatedAt = new Date().toISOString();
  store.commit('encounter.link');
  log(row, 'Linked', `${kind} ${id}`);
  return row;
}

/**
 * A flag the visit carries: something a later desk has to answer for. Nothing
 * here decides what it means — the feature that noticed sets it and the one
 * that answers it clears it.
 */
export function setFlag(no, key, value = true) {
  const row = get(no);
  if (!row) return null;
  const flags = { ...(row.flags || {}) };
  if (Boolean(flags[key]) === Boolean(value)) return row;
  flags[key] = Boolean(value);
  row.flags = flags;
  row.updatedAt = new Date().toISOString();
  store.commit('encounter.flag');
  return row;
}

/** The stamp the clearance feature writes. Nothing here decides what it says. */
export function setClearance(no, status, items = []) {
  const row = get(no);
  if (!row || !CLEARANCE_STATUSES.includes(status)) return null;
  row.clearance = { status, items: [...items] };
  row.updatedAt = new Date().toISOString();
  store.commit('encounter.clearance');
  log(row, 'Clearance', `${status}${items.length ? ` — ${items.join('; ')}` : ''}`);
  return row;
}

// --- merge --------------------------------------------------------------------

/**
 * Encounters follow the patient when two records are folded together — the
 * merge screen counts them here before anything moves, the way it counts
 * documents and policies.
 */
patients.relinkHooks.push({
  label: 'Encounters',
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

// --- internals ----------------------------------------------------------------

function log(row, action, details) {
  audit.log({ entity: ENTITY, entityId: row.no, action, details });
}

/** Yesterday's open outpatient visits are closed before any screen reads them. */
autoCompleteOutpatients();
