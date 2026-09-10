// Seed — estimate acknowledgments. Owner: modules/frontis.
//
// Three rows, one for each admission on today's board that has a quotation to
// sign for. They are written as a table of intents — this visit, signed this
// way, this long ago — and the estimate each one names is read back off the
// register rather than written down, so the two never drift.
//
// data/store.js does not import this file: an acknowledgment reads the
// encounter board and the estimates to exist.
// data/repositories/acknowledgments.js builds on first read of an empty table —
// the shape data/seed/estimates.js and data/seed/referrals.js already use.

import * as encounters from '../repositories/encounters.js';
import * as estimates from '../repositories/estimates.js';
import * as patients from '../repositories/patients.js';
import { ROLES } from '../../shared/roles.js';
import { todayIso } from '../../shared/format.js';

const NURSE = ROLES.find((r) => r.id === 'nurse').name;
const CODER = ROLES.find((r) => r.id === 'coder').name;

/**
 * One row each. `visit` finds the encounter on the board rather than naming a
 * number, and `estimate` finds the quotation that is about that visit — the
 * same rule the clearance engine reads by, so the seed cannot name a document
 * the screen would not have offered.
 */
const ROWS = [
  // Layla Chamseddine signed for her coronary care admission on the ward, the
  // evening she was admitted. Bupa carries the whole allowed amount, so what she
  // signed for is a quotation with nothing owed at the desk.
  { visit: { mrn: 'MRN-000105', type: 'IP', department: 'Cardiology' },
    by: 'Patient', hours: -28, method: 'Signed in person', user: NURSE,
    document: { fileName: 'acknowledgment-layla-chamseddine.pdf', size: 96000 },
    note: 'Signed at the bedside; a copy was given to the patient.' },

  // Rami Haddad signed before theatre, which is why the deposit against his
  // admission was taken the same morning.
  { visit: { mrn: 'MRN-000101', type: 'IP', department: 'General Surgery' },
    by: 'Patient', hours: -5.5, method: 'Signed in person', user: CODER,
    document: { fileName: 'acknowledgment-rami-haddad.pdf', size: 88000 } },

  // Nour Baalbaki was admitted from clinic and signed on the tablet at the desk
  // on the way up to the ward.
  { visit: { mrn: 'MRN-000103', type: 'IP', department: 'General Surgery' },
    by: 'Patient', hours: -2.5, method: 'E-signature', user: NURSE,
    note: 'Signed on the desk tablet; the copy was emailed.' },
];

const fromNow = (hours) => new Date(Date.now() + hours * 3600000).toISOString();

const encounterFor = ({ mrn, type, department }) =>
  encounters.byPatient(mrn).find((row) => row.type === type && row.department === department) || null;

/**
 * The quotation that is about this visit: issued, still live, same department
 * and same kind of stay. It is the rule data/engines/clearance-engine.js reads
 * by, written out once here so a seeded signature can only ever name a document
 * the desk would actually have put in front of the patient.
 */
const TYPE_OF_VISIT = { Outpatient: 'OP', Inpatient: 'IP', Emergency: 'ER', 'Day Case': 'OP' };

const estimateFor = (enc) =>
  estimates.validForClearance(enc.patientMrn).find((row) => {
    const context = row.context || {};
    if (context.department && context.department !== enc.department) return false;
    return TYPE_OF_VISIT[context.visitType] === enc.type;
  }) || null;

export function buildAcknowledgments() {
  const out = [];
  let seq = 0;

  for (const spec of ROWS) {
    const enc = encounterFor(spec.visit);
    if (!enc) continue;
    const estimate = estimateFor(enc);
    if (!estimate) continue;
    const patient = patients.get(enc.patientMrn);
    seq += 1;
    out.push({
      id: `ACK-${String(seq).padStart(4, '0')}`,
      encounterNo: enc.no,
      estimateNo: estimate.no,
      by: spec.by,
      byName: spec.by === 'Patient' ? (patient?.nameEn || enc.patientMrn) : spec.byName || '',
      method: spec.method,
      document: spec.document ? { ...spec.document } : null,
      note: spec.note || '',
      user: spec.user,
      at: fromNow(spec.hours),
    });
    // The estimate says so too, wherever it is read.
    estimate.acknowledgedAt = out[out.length - 1].at;
    estimate.acknowledgedBy = out[out.length - 1].byName;
  }

  return out;
}

/**
 * The seeded trail, with the times the signatures were taken at. audit.log()
 * would stamp every one of them with now and with whoever is signed in, which
 * is not what a history is.
 */
export function buildAcknowledgmentTrail(rows) {
  return rows.map((row) => ({
    entity: 'acknowledgment',
    entityId: row.id,
    action: 'Acknowledged',
    user: row.user,
    at: row.at,
    details: `${row.estimateNo} acknowledged by ${row.byName} (${String(row.by).toLowerCase()}) — ${
      row.method}, encounter ${row.encounterNo}`,
  }));
}

/** Kept so a screen can ask "was this taken today?" without a second helper. */
export const takenToday = (row) => String(row?.at).slice(0, 10) === todayIso();
