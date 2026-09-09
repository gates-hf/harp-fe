// Seed — referrals. Owner: modules/frontis.
//
// Ten hand-written rows, because the worklist has to open on exactly them: five
// inbound still to be booked (one written for three visits, one four days off
// lapsing, one for a person nobody has registered), one holding a place on an
// expected arrival, one already spent on a visit that is on today's board, one
// that ran out of time, and the two outbound the hospital wrote itself.
//
// Dates are offsets from today, so "expiring in four days" is always four days
// away and the lapsed one is always the row the sweep retires, whatever day the
// demo runs. The expired row is seeded open for exactly that reason —
// expireReferrals() is what closes it, so the trail says when and why.
//
// data/store.js does not import this file: a referral reads the register, the
// encounter board and the expected arrivals to exist.
// data/repositories/referrals.js builds on first read of an empty table — the
// shape data/seed/encounters.js and data/seed/prereg.js already use.

import * as patients from '../repositories/patients.js';
import * as encounters from '../repositories/encounters.js';
import * as prereg from '../repositories/prereg.js';
import { ROLES } from '../../shared/roles.js';
import { todayIso } from '../../shared/format.js';

const NURSE = ROLES.find((r) => r.id === 'nurse').name;
const CODER = ROLES.find((r) => r.id === 'coder').name;

/** The first number this register hands out. Sequential from there. */
const FIRST = 201;

/**
 * One row each. `days` is the referral date as an offset from today and `valid`
 * the validity as another; `spend` names the encounter to hang it off, found on
 * the board rather than written down, so the two registers never drift.
 */
const ROWS = [
  // Three visits on one referral: the reason the worklist has a Visits column.
  { key: 'nour-cardio', direction: 'Inbound', type: 'External', mrn: 'MRN-000103',
    days: -5, valid: 25, by: NURSE, visits: 3,
    source: { facilityId: 'RS-0001', doctorId: 'RS-0007' },
    destination: { specialty: 'Cardiology' },
    reason: 'Palpitations with a family history of arrhythmia — for Holter and specialist review.',
    payerRef: 'NSSF-REF-2026-88134',
    letter: { fileName: 'levant-referral-cardiology.pdf', size: 214000 } },

  // Four days left: the amber chip, and the row the Expiring card counts.
  { key: 'rami-ortho', direction: 'Inbound', type: 'External', mrn: 'MRN-000101',
    days: -26, valid: 30, by: NURSE,
    source: { facilityId: 'RS-0003', doctorId: 'RS-0011' },
    destination: { specialty: 'Orthopaedics' },
    reason: 'Persistent right shoulder pain after a fall, no improvement on physiotherapy.' },

  // Taken over the phone for somebody with no record. The number is the one the
  // pre-registration seed carries for Jad Moukarzel, so the pre-reg form offers
  // to link it and registration resolves it.
  { key: 'unregistered', direction: 'Inbound', type: 'External',
    unregistered: { name: 'Jad Moukarzel', phone: '+961 3 447 219' },
    days: -2, valid: 28, by: NURSE,
    source: { facilityId: 'RS-0001', doctorId: 'RS-0008' },
    destination: { specialty: 'Cardiology' },
    reason: 'Exertional chest tightness in a 32-year-old smoker — for a stress test.' },

  // A specialty the hospital has no department for, which the reference list
  // maps onto Internal Medicine: the case validForEncounter is written for.
  { key: 'ahmad-gastro', direction: 'Inbound', type: 'External', mrn: 'MRN-000110',
    days: -8, valid: 22, by: CODER,
    source: { facilityId: 'RS-0006', doctorId: 'RS-0014' },
    destination: { specialty: 'Gastroenterology' },
    reason: 'Epigastric pain and weight loss — for endoscopy.' },

  // One of our own departments referring to another: no facility, no external
  // doctor, and the department in their place. It is the arrival on today's
  // board, sent on from the emergency room it came into.
  { key: 'internal', direction: 'Inbound', type: 'Internal', mrn: 'MRN-000110',
    days: -1, valid: 29, by: NURSE,
    source: { internalDepartment: 'Emergency' },
    destination: { specialty: 'Orthopaedics', department: 'Orthopaedics' },
    reason: 'Right wrist deformity after a fall, seen in the emergency room — for orthopaedic review.' },

  // Holding a place on an expected arrival, which is what Scheduled means.
  { key: 'carla-obs', direction: 'Inbound', type: 'External', mrn: 'MRN-000108',
    days: -4, valid: 26, by: NURSE, scheduleFor: 'MRN-000108',
    source: { facilityId: 'RS-0002', doctorId: 'RS-0010' },
    destination: { specialty: 'Obstetrics & Gynaecology' },
    reason: 'Routine antenatal transfer of care at 28 weeks.' },

  // Spent: one visit written, one visit opened, and the referral is Used.
  { key: 'used-inbound', direction: 'Inbound', type: 'External', mrn: 'MRN-000111',
    days: -6, valid: 24, by: NURSE, spend: { department: 'Cardiology', type: 'OP' },
    source: { facilityId: 'RS-0001', doctorId: 'RS-0007' },
    destination: { specialty: 'Cardiology' },
    reason: 'Newly diagnosed hypertension — for cardiology assessment.',
    letter: { fileName: 'levant-referral-hypertension.pdf', size: 186000 } },

  // Written seven weeks ago and never booked. Seeded open: expireReferrals() is
  // what closes it on load, so the trail records the lapse rather than the seed.
  { key: 'lapsed', direction: 'Inbound', type: 'External', mrn: 'MRN-000116',
    days: -50, valid: 40, by: NURSE,
    source: { facilityId: 'RS-0004' },
    destination: { specialty: 'Endocrinology' },
    reason: 'Poorly controlled diabetes on oral agents — for specialist review.' },

  // Outbound, and the one the printable form is read on.
  { key: 'out-oncology', direction: 'Outbound', type: 'External', mrn: 'MRN-000101',
    days: 0, valid: null, by: CODER, attach: { department: 'General Surgery', type: 'IP' },
    source: { internalDepartment: 'General Surgery', doctorId: 'DR-0006' },
    destination: { facilityId: 'RS-0005', doctorName: 'Dr. Antoine Karam', specialty: 'Oncology' },
    reason: 'Histology from the cholecystectomy specimen needs an oncology opinion before discharge.' },

  // Outbound and closed: the patient was seen, and the question is answered.
  { key: 'out-cardio', direction: 'Outbound', type: 'External', mrn: 'MRN-000103',
    days: -12, valid: null, by: NURSE, used: true,
    source: { internalDepartment: 'Internal Medicine', doctorId: 'DR-0002' },
    destination: { facilityId: 'RS-0001', doctorName: 'Dr. Samir Khalifeh', specialty: 'Cardiology' },
    reason: 'Echocardiogram and rhythm review not available here this month.' },
];

const day = (offset) => {
  const when = new Date(`${todayIso()}T00:00:00Z`);
  when.setUTCDate(when.getUTCDate() + offset);
  return when.toISOString().slice(0, 10);
};

const stamp = (offset, hour = 10) => {
  const when = new Date(`${day(offset)}T00:00:00Z`);
  when.setUTCHours(hour, 20, 0, 0);
  return when.toISOString();
};

/** The encounter on the board a spec points at, found rather than written down. */
const encounterFor = (mrn, { department, type }) =>
  encounters.byPatient(mrn).find((row) => row.department === department && row.type === type) || null;

export function buildReferrals() {
  const year = new Date().getFullYear();
  const rows = [];

  ROWS.forEach((spec, i) => {
    if (spec.mrn && !patients.get(spec.mrn)) return;

    const total = spec.visits || 1;
    const encounter = spec.spend ? encounterFor(spec.mrn, spec.spend)
      : spec.attach ? encounterFor(spec.mrn, spec.attach) : null;
    // A visit only comes off when there is a visit: a board that did not
    // produce the encounter leaves the referral whole rather than half spent.
    const spent = spec.spend && encounter ? 1 : 0;
    const held = spec.scheduleFor ? prereg.byPatient(spec.scheduleFor).find(prereg.isOpen) : null;

    const row = {
      no: `REF-${year}-${String(FIRST + i).padStart(6, '0')}`,
      direction: spec.direction,
      type: spec.type,
      patientMrn: spec.mrn || null,
      unregistered: spec.unregistered ? { ...spec.unregistered } : null,
      source: {
        facilityId: spec.source.facilityId || null,
        doctorId: spec.source.doctorId || null,
        internalDepartment: spec.source.internalDepartment || null,
      },
      destination: {
        facilityId: spec.destination.facilityId || null,
        doctorName: spec.destination.doctorName || null,
        specialty: spec.destination.specialty || '',
        department: spec.destination.department || null,
      },
      reason: spec.reason,
      referralDate: day(spec.days),
      validUntil: spec.valid === null ? null : day(spec.days + spec.valid),
      payerRef: spec.payerRef || null,
      letter: spec.letter ? { ...spec.letter } : null,
      visits: { total, remaining: total - spent },
      status: 'New',
      statusReason: '',
      scheduledPreregNo: held?.no || null,
      encounterNos: encounter ? [encounter.no] : [],
      createdBy: spec.by,
      createdAt: stamp(spec.days),
      updatedAt: stamp(spec.days),
    };

    // The terminal states the seed writes itself. Expiry is not one of them:
    // the sweep runs on load and records its own entry.
    if (spec.spend && encounter) {
      row.status = row.visits.remaining ? 'New' : 'Used';
      row.updatedAt = encounter.startAt;
      // The visit names the referral it answered, the way registration does.
      // An outbound one is not written here: that field holds the referral the
      // payer asked for, and an outbound referral is not one.
      encounter.linked.referralId = row.no;
    }
    if (spec.used) row.status = 'Used';
    if (held) {
      row.status = 'Scheduled';
      row.updatedAt = stamp(spec.days, 15);
    }
    rows.push(row);
  });

  return rows;
}

/**
 * The seeded register's own trail, written with the times the events happened
 * at. audit.log() would stamp every one of them with now and with whoever is
 * signed in, which is not what a history is — the call the encounter and
 * pre-registration seeds already make.
 */
export function buildReferralTrail(rows) {
  const out = [];
  for (const row of rows) {
    const by = row.createdBy;
    out.push(entry(row, 'Created', by, row.createdAt,
      `${row.direction} ${row.type.toLowerCase()} — ${nameOf(row)}${
        row.destination.specialty ? `, ${row.destination.specialty}` : ''}`));
    if (row.scheduledPreregNo) {
      out.push(entry(row, 'Scheduled', by, row.updatedAt, `Held for ${row.scheduledPreregNo}`));
    }
    // An inbound referral is spent by the encounter it opens; an outbound one
    // is written from the visit that decided to refer, so the same field reads
    // as a different sentence either way.
    for (const no of row.encounterNos) {
      const left = row.visits.remaining;
      out.push(entry(row, 'Linked', by, row.updatedAt, row.direction === 'Inbound'
        ? `Encounter ${no} — ${left} of ${row.visits.total} visit${row.visits.total === 1 ? '' : 's'} left${
          left ? '' : ', referral used'}`
        : `Written from encounter ${no}`));
    }
    if (row.status === 'Used' && row.direction === 'Outbound') {
      out.push(entry(row, 'Used', by, row.updatedAt, 'The patient was seen and the report came back'));
    }
  }
  return out;
}

const entry = (row, action, user, at, details) =>
  ({ entity: 'referrals', entityId: row.no, action, user, at, details });

const nameOf = (row) =>
  (row.patientMrn ? patients.get(row.patientMrn)?.nameEn : row.unregistered?.name) || row.no;
