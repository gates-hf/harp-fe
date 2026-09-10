// Seed — pre-authorisation requests. Owner: modules/frontis.
//
// Ten hand-written rows, because the worklist has to open on exactly them: two
// drafts (one prefilled from the seeded MRI estimate, one the resubmission of a
// denial), three with the payer (one urgent and four days unanswered, which is
// the red the Pending since column shows), two approved (one five days off
// lapsing, one part-consumed), one partially approved with a reduced pair and a
// refused line, one denied that the second draft answers, and one seeded live
// so expireAuths() is what retires it on load.
//
// Dates are offsets from today, so "expires in five days" is always five days
// away whatever day the demo runs, and the amounts are read off the contract
// rather than typed: a requested amount is what the agreement would allow for
// that quantity, which is what the desk puts on the form.
//
// data/store.js does not import this file: a request reads the register, the
// policy chains, the charge master, the contracts, the encounter board and the
// estimates to exist. data/repositories/preauth-requests.js builds on first
// read of an empty table — the shape data/seed/referrals.js already uses.

import * as patients from '../repositories/patients.js';
import * as policies from '../repositories/policies.js';
import * as cdm from '../repositories/cdm.js';
import * as contracts from '../repositories/contracts.js';
import * as encounters from '../repositories/encounters.js';
import * as estimates from '../repositories/estimates.js';
import { ROLES } from '../../shared/roles.js';
import { todayIso } from '../../shared/format.js';

const NURSE = ROLES.find((r) => r.id === 'nurse').name;
const CODER = ROLES.find((r) => r.id === 'coder').name;

/** The first number this register hands out. Sequential from there. */
const FIRST = 78;

/**
 * One row each.
 *
 * `days` is when it was raised, as an offset from today; `submitted` and
 * `decided` are the same for the two events that follow. `lines` is
 * [charge code, qty, approvedQty?, lineDecision?, lineReason?] — an approved
 * quantity left out is the requested one, which is what a straight approval
 * means. `visit` finds the encounter on the board rather than naming a number,
 * so the two registers never drift.
 */
const ROWS = [
  // Prefilled from Nour Baalbaki's MRI estimate: NSSF requires approval on MRI
  // brain outright, so the quotation carried the flag and this is the desk
  // acting on it. Still a draft — nothing has been sent.
  { key: 'nour-mri-draft', mrn: 'MRN-000103', policyId: 'POL-0001', days: 0, by: NURSE,
    doctorId: 'DR-0002', priority: 'Routine', fromEstimate: { mrn: 'MRN-000103', code: 'RAD-0001' },
    diagnosis: 'R51.9 — Headache, unspecified',
    justification: 'Six weeks of daily headache with morning vomiting and one episode of transient visual loss. '
      + 'Fundoscopy shows blurred disc margins. Imaging is needed to exclude a space-occupying lesion before '
      + 'starting treatment.',
    lines: [['RAD-0001', 1]] },

  // The resubmission of the denial below, with the report the payer asked for
  // attached. It is a draft because nobody has sent it yet — the chain reads
  // both ways from here.
  { key: 'marwan-ct-again', mrn: 'MRN-000113', policyId: 'POL-0014', days: -1, by: CODER,
    doctorId: 'DR-0001', priority: 'Routine', resubmits: 'marwan-ct',
    diagnosis: 'R05 — Cough, persistent',
    justification: 'Resubmission with the chest radiograph report and the six-week course of treatment the payer '
      + 'asked for. Plain films show a persistent right upper lobe opacity that has not cleared on antibiotics.',
    documents: [['Supporting', 'chest-xray-report-2026.pdf', 184000]],
    lines: [['RAD-0003', 1]] },

  // With the payer for two days, against the admission the board shows blocked:
  // its clearance already says "Pre-auth pending", and this is the request that
  // sentence is about.
  { key: 'nour-appendix', mrn: 'MRN-000103', policyId: 'POL-0002', days: -2, submitted: -2, by: NURSE,
    doctorId: 'DR-0007', priority: 'Urgent', visit: { mrn: 'MRN-000103', type: 'IP', department: 'General Surgery' },
    diagnosis: 'K35.80 — Acute appendicitis, unspecified',
    justification: 'Admitted from clinic with right iliac fossa tenderness, white cell count 14.2 and ultrasound '
      + 'showing a non-compressible appendix at 9 mm. For laparoscopic appendicectomy on today’s list.',
    documents: [['Supporting', 'ultrasound-abdomen-report.pdf', 152000]],
    lines: [['SUR-0003', 1], ['PRF-0001', 2]] },

  // Urgent and four days unanswered — the row the Pending since column paints
  // red, and the one with a communication log worth reading.
  { key: 'rami-stay', mrn: 'MRN-000101', policyId: 'POL-0004', days: -4, submitted: -4, by: NURSE,
    doctorId: 'DR-0006', priority: 'Urgent', visit: { mrn: 'MRN-000101', type: 'IP', department: 'General Surgery' },
    diagnosis: 'K80.20 — Calculus of gallbladder without cholecystitis',
    justification: 'Laparoscopic cholecystectomy performed, converted to an open procedure for dense adhesions. '
      + 'Three further nights and continued surgeon review are needed before discharge is safe.',
    documents: [['Supporting', 'operative-note-cholecystectomy.pdf', 96000]],
    comms: [
      { at: -3, hour: 11, channel: 'Phone', direction: 'Out',
        note: 'Called the NSSF pre-auth desk. Reference taken, told to expect an answer within two working days.' },
      { at: -1, hour: 9, channel: 'Phone', direction: 'In',
        note: 'NSSF called back to ask for the operative note. Uploaded and confirmed on the call.' },
    ],
    lines: [['RNB-0001', 3], ['PRF-0001', 2]] },

  // Sent yesterday and quiet. The third of the three the Submitted card counts.
  { key: 'sarah-mri', mrn: 'MRN-000111', policyId: 'POL-0012', days: -1, submitted: -1, by: NURSE,
    doctorId: 'DR-0004', priority: 'Routine',
    diagnosis: 'I48.91 — Atrial fibrillation, unspecified',
    justification: 'New onset atrial fibrillation with a transient hemiparesis lasting under an hour. Imaging is '
      + 'needed to distinguish an infarct from a bleed before anticoagulation is started.',
    lines: [['RAD-0001', 1]] },

  // Approved, five days left: the countdown on the worklist and the amber the
  // Expiring card counts.
  { key: 'rami-mri', mrn: 'MRN-000101', policyId: 'POL-0004', days: -11, submitted: -11, decided: -9, by: NURSE,
    doctorId: 'DR-0001', priority: 'Routine', result: 'Approved',
    authNumber: 'NSSF/PA/2026/40118', validFrom: -9, validTo: 5,
    diagnosis: 'G43.909 — Migraine, unspecified, without status migrainosus',
    justification: 'Migraine with new focal neurological signs and a family history of aneurysm. Imaging before '
      + 'the neurology clinic appointment.',
    documents: [['Payer response', 'nssf-approval-40118.pdf', 74000]],
    comms: [{ at: -9, hour: 14, channel: 'Portal', direction: 'In',
      note: 'Approval letter downloaded from the NSSF provider portal and attached.' }],
    lines: [['RAD-0001', 1]] },

  // Approved for eight sessions, three of them used: the Remaining column, and
  // what activeFor() counts down.
  { key: 'omar-physio', mrn: 'MRN-000107', policyId: 'POL-0010', days: -22, submitted: -22, decided: -20, by: CODER,
    doctorId: 'DR-0008', priority: 'Routine', result: 'Approved',
    authNumber: 'NSSF/PA/2026/39774', validFrom: -20, validTo: 40,
    diagnosis: 'M54.5 — Low back pain',
    justification: 'Chronic mechanical low back pain, no red flags, failed a home exercise programme. Supervised '
      + 'physiotherapy is the alternative to escalating analgesia.',
    documents: [['Payer response', 'nssf-approval-39774.pdf', 68000]],
    used: { 'PRC-0004': 3 },
    lines: [['PRC-0004', 10, 8]] },

  // Partially approved: two lines cut back and the report copy refused outright,
  // which is the grid the capture dialog writes.
  { key: 'nour-stay', mrn: 'MRN-000103', policyId: 'POL-0001', days: -6, submitted: -6, decided: -3, by: NURSE,
    doctorId: 'DR-0002', priority: 'Routine', result: 'Partially Approved',
    authNumber: 'NSSF/PA/2026/40233', validFrom: -3, validTo: 27,
    denialReasonCode: 'NOT_MEDICALLY_NEC',
    note: 'Two nights allowed for the procedure and the first post-operative day. A copy of the file is not a '
      + 'clinical service and is not covered under this plan.',
    diagnosis: 'K35.80 — Acute appendicitis, unspecified',
    justification: 'Planned inpatient stay with surgeon review on each post-operative day, and a copy of the file '
      + 'for the patient’s employer.',
    documents: [['Payer response', 'nssf-decision-40233.pdf', 81000]],
    lines: [
      ['RNB-0001', 4, 2, 'Approved', 'Two nights allowed; the rest is not supported by the operative note.'],
      ['PRF-0001', 3, 2, 'Approved', 'One review a day for two days.'],
      ['NCL-0001', 1, 0, 'Denied', 'A copy of the file is not a clinical service and is not covered by this plan.'],
    ] },

  // Denied for want of paperwork, and answered by the second draft above. The
  // chain reads both ways: this one names its successor, that one its
  // predecessor.
  { key: 'marwan-ct', mrn: 'MRN-000113', policyId: 'POL-0014', days: -8, submitted: -8, decided: -4, by: CODER,
    doctorId: 'DR-0001', priority: 'Routine', result: 'Denied',
    denialReasonCode: 'INSUFFICIENT_DOC',
    note: 'The plain film report and the record of the antibiotic course were not attached. Resubmit with both.',
    diagnosis: 'R05 — Cough, persistent',
    justification: 'Persistent cough for eight weeks in a smoker, unresolved on two courses of antibiotics.',
    documents: [['Payer response', 'nssf-denial-2026-8830.pdf', 62000]],
    lines: [['RAD-0003', 1]] },

  // Approved a month ago on a thirty-day validity and never used up, against
  // the admission that is still open on the board. Seeded live: the sweep on
  // load is what expires it, so the trail says when and why — and the visit's
  // clearance reads "Pre-auth expired" the moment it does.
  { key: 'rami-physio', mrn: 'MRN-000101', policyId: 'POL-0004', days: -35, submitted: -35, decided: -33, by: CODER,
    doctorId: 'DR-0008', priority: 'Routine', result: 'Approved',
    authNumber: 'NSSF/PA/2026/39901', validFrom: -33, validTo: -1,
    visit: { mrn: 'MRN-000101', type: 'IP', department: 'General Surgery' },
    diagnosis: 'M54.5 — Low back pain',
    justification: 'Mechanical back pain predating the admission, for supervised rehabilitation once the surgical '
      + 'wound allows it.',
    documents: [['Payer response', 'nssf-approval-39901.pdf', 58000]],
    lines: [['PRC-0004', 6]] },
];

/** Deterministic clock: the same offsets produce the same register every load. */
function stamp(offset, hour = 10, minute = 0) {
  const when = new Date(`${todayIso()}T00:00:00.000Z`);
  when.setUTCDate(when.getUTCDate() + offset);
  when.setUTCHours(hour, minute, 0, 0);
  return when.toISOString();
}

const day = (offset) => stamp(offset, 0).slice(0, 10);

const id = (code) => cdm.getByCode(code)?.id || '';

/** The encounter on the board a spec points at, found rather than written down. */
const encounterFor = ({ mrn, type, department }) =>
  encounters.byPatient(mrn).find((row) => row.type === type && row.department === department) || null;

/** The issued estimate a draft was raised off, found the same way. */
const estimateFor = ({ mrn, code }) =>
  estimates.byPatient(mrn).find((row) =>
    row.status !== 'Draft' && (row.lines || []).some((line) => line.itemId === id(code))) || null;

/**
 * What the agreement would allow for this line, which is what the desk asks
 * for. With no contract in force the charge master's own price is the ask —
 * a request is raised against what is being done, not against what is agreed.
 */
function askingPrice(policy, code, qty, on) {
  const item = cdm.getByCode(code);
  if (!item) return 0;
  const contract = policy
    ? contracts.contractForService(policy.payerId, policy.planId, on)
    : null;
  const unit = contract ? contracts.resolvedPrice(contract, item, on) : Number(item.standardPrice) || 0;
  return Math.round(unit * qty * 100) / 100;
}

export function buildPreauthRequests() {
  const year = new Date().getFullYear();
  const numbers = new Map();
  const out = [];

  ROWS.forEach((spec, i) => numbers.set(spec.key, `PA-${year}-${String(FIRST + i).padStart(6, '0')}`));

  for (const spec of ROWS) {
    if (!patients.get(spec.mrn)) continue;
    const policy = policies.get(spec.policyId);
    const raisedOn = day(spec.days);
    const visit = spec.visit ? encounterFor(spec.visit) : null;
    const estimate = spec.fromEstimate ? estimateFor(spec.fromEstimate) : null;
    const decided = spec.result ? stamp(spec.decided, 15, 40) : null;

    const services = spec.lines
      .filter(([code]) => id(code))
      .map(([code, qty, approvedQty, lineDecision, lineReason]) => {
        const requestedAmount = askingPrice(policy, code, qty, raisedOn);
        const approved = spec.result && spec.result !== 'Denied'
          ? (approvedQty === undefined ? qty : approvedQty)
          : null;
        return {
          itemId: id(code),
          qty,
          requestedAmount,
          approvedQty: approved,
          approvedAmount: approved === null ? null
            : Math.round((requestedAmount / qty) * approved * 100) / 100,
          lineDecision: spec.result === 'Denied' ? 'Denied'
            : lineDecision || (spec.result ? 'Approved' : null),
          lineReason: lineReason || null,
        };
      });

    out.push({
      no: numbers.get(spec.key),
      status: spec.result || (spec.submitted === undefined ? 'Draft' : 'Submitted'),
      patientMrn: spec.mrn,
      policyId: policy?.id || null,
      payerId: policy?.payerId || null,
      planId: policy?.planId || null,
      encounterNo: visit?.no || null,
      estimateNo: estimate?.no || null,
      snapshotRef: null,
      services,
      diagnosis: spec.diagnosis,
      justification: spec.justification,
      doctorId: spec.doctorId,
      priority: spec.priority,
      documents: (spec.documents || []).map(([kind, fileName, size], n) => ({
        id: `PAD-${numbers.get(spec.key).slice(-6)}-${n + 1}`,
        kind,
        fileName,
        size,
        uploadedBy: spec.by,
        uploadedAt: stamp(spec.decided ?? spec.submitted ?? spec.days, 12, 10 + n),
      })),
      submittedAt: spec.submitted === undefined ? null : stamp(spec.submitted, 11, 5),
      submittedBy: spec.submitted === undefined ? null : spec.by,
      decision: spec.result
        ? {
          result: spec.result,
          authNumber: spec.authNumber || null,
          validFrom: spec.validFrom === undefined ? null : day(spec.validFrom),
          validTo: spec.validTo === undefined ? null : day(spec.validTo),
          denialReasonCode: spec.denialReasonCode || null,
          capturedAt: decided,
          capturedBy: spec.by,
          note: spec.note || '',
        }
        : null,
      consumption: { usedQty: usedById(spec.used) },
      predecessorNo: spec.resubmits ? numbers.get(spec.resubmits) : null,
      successorNo: null,
      communications: (spec.comms || []).map((entry, n) => ({
        id: `PAC-${numbers.get(spec.key).slice(-6)}-${n + 1}`,
        at: stamp(entry.at, entry.hour ?? 10, 25),
        by: spec.by,
        channel: entry.channel,
        direction: entry.direction,
        note: entry.note,
      })),
      createdAt: stamp(spec.days, 9, 15),
      createdBy: spec.by,
      updatedAt: decided || (spec.submitted === undefined ? stamp(spec.days, 9, 15) : stamp(spec.submitted, 11, 5)),
    });
  }

  // The other half of a chain: a request that names its predecessor is that
  // predecessor's successor, so the page reads it both ways without the seed
  // writing the same fact twice.
  for (const row of out) {
    if (!row.predecessorNo) continue;
    const before = out.find((other) => other.no === row.predecessorNo);
    if (before) before.successorNo = row.no;
  }

  // The other half of a link. Outside the seed a request registers itself
  // through encounters.linkRecord() as it is created or answered; here the two
  // registers are written in one pass, so the visit's Linked Records tab reads
  // the same requests byEncounter() does.
  for (const row of out) {
    if (!row.encounterNo) continue;
    const visit = encounters.get(row.encounterNo);
    if (visit && !visit.linked.preAuthIds.includes(row.no)) visit.linked.preAuthIds.push(row.no);
  }

  return out;
}

/** Consumption is keyed by charge line id; the spec names charge codes. */
function usedById(used) {
  const out = {};
  for (const [code, qty] of Object.entries(used || {})) if (id(code)) out[id(code)] = qty;
  return out;
}

/**
 * The seeded register's own trail, written with the times the events happened
 * at. audit.log() would stamp every one of them with now and with whoever is
 * signed in, which is not what a history is — the call the referral and
 * encounter seeds already make.
 */
export function buildPreauthTrail(rows) {
  const out = [];
  for (const row of rows) {
    const name = patients.get(row.patientMrn)?.nameEn || row.patientMrn;
    out.push(entry(row, 'Created', row.createdBy, row.createdAt,
      `${name} — ${row.services.length} service${row.services.length === 1 ? '' : 's'}, ${row.priority.toLowerCase()}`));
    if (row.predecessorNo) {
      out.push(entry(row, 'Resubmitted', row.createdBy, row.createdAt, `Resubmission of ${row.predecessorNo}`));
    }
    if (row.submittedAt) {
      out.push(entry(row, 'Submitted', row.submittedBy, row.submittedAt,
        'Services and justification locked'));
    }
    for (const comm of row.communications) {
      out.push(entry(row, 'Communication', comm.by, comm.at,
        `${comm.channel} ${comm.direction === 'Out' ? 'out' : 'in'} — ${comm.note}`));
    }
    if (row.decision) {
      const d = row.decision;
      out.push(entry(row, 'Decision captured', d.capturedBy, d.capturedAt,
        `${d.result}${d.authNumber ? ` · ${d.authNumber}` : ''}${
          d.validTo ? ` · valid ${d.validFrom} to ${d.validTo}` : ''}`));
    }
    if (row.successorNo) {
      out.push(entry(row, 'Resubmitted', row.createdBy, row.updatedAt, `Resubmitted as ${row.successorNo}`));
    }
  }
  return out;
}

const entry = (row, action, user, at, details) =>
  ({ entity: 'preauth', entityId: row.no, action, user, at, details });
