// Seed — encounter coding. Owner: modules/claima (amendment 26).
//
// Six charts in the six states the worklist has to show, three CDI queries in
// the three states a query passes through, and the trail that says how each
// got there. Written as intents — this chart, this coder, this many days ago —
// and dated as offsets from today, so the SLA colours, the 14-day throughput
// chart and the query turnaround are demonstrable whatever day the demo runs.
//
// The charts are found on the board by who they were for rather than by
// number, the way data/seed/clinical-docs.js finds them, and the charge lines a
// procedure links to are read off the released lines the repository hands in —
// a line id written here would drift from the ledger the moment it changed.
// data/store.js does not import this file; data/repositories/coding.js builds
// on first read of an empty table.

import * as docs from '../repositories/clinical-docs.js';
import { CHARTS, pickEncounter } from './clinical-docs.js';
import { icd, proc } from '../repositories/code-sets.js';
import { ROLES } from '../../shared/roles.js';

/**
 * Who codes. The first is the demo's RCM coder role, so My work and
 * Self-assign land on the same name; the other two never sign in and exist so
 * that assignment, the Coder filter and the throughput chart have somebody to
 * compare against.
 */
export const CODERS = [
  { id: 'coder', name: 'Tarek Solh' },
  { id: 'CD-0002', name: 'Rita Saba' },
  { id: 'CD-0003', name: 'Hussein Farhat' },
];

const TAREK = 'coder';
const RITA = 'CD-0002';
const SUPERVISOR = ROLES.find((r) => r.id === 'exec').name;
const name = (id) => CODERS.find((c) => c.id === id)?.name || id;

/**
 * An ISO timestamp `days` ago at the given hour, UTC. A stamp meant for today
 * that would land after now is pulled back to twenty minutes ago, so a demo
 * run first thing in the morning never shows an answer from the future.
 */
function ago(days, hour = 9, minute = 0) {
  const d = new Date(Date.now() - days * 86400000);
  d.setUTCHours(hour, minute, 0, 0);
  if (d.getTime() > Date.now()) d.setTime(Date.now() - 20 * 60000);
  return d.toISOString();
}

const dx = (code, principal = false, poa = null) => {
  const row = icd.get(code);
  return { code, desc: row?.desc || code, principal, poa };
};

const px = (code, enc, lines, chargeCode) => {
  const row = proc.get(code);
  return {
    code,
    desc: row?.desc || code,
    date: String(enc.endAt || enc.startAt).slice(0, 10),
    doctorId: enc.doctorId,
    chargeLineIds: lines.filter((l) => l.chargeCode === chargeCode).map((l) => l.id),
  };
};

/** Every chart the seed works, in the order the trail is written. */
export function buildCoding(releasedLines) {
  const records = [];
  const queries = [];
  const trail = [];

  const log = (no, action, details, at, user) =>
    trail.push({ entity: 'coding', entityId: no, action, details, at, user });

  // Numbered in the order they were raised, which is not the order the
  // charts are written in below.
  const query = (no, id, spec) => {
    const row = { id, encounterNo: no, ...spec };
    queries.push(row);
    return row;
  };

  const chart = (key, fill) => {
    const enc = pickEncounter(...CHARTS[key]);
    if (!enc) return;
    const lines = releasedLines(enc.no);
    const released = lines.reduce((latest, l) => (String(l.at) > latest ? String(l.at) : latest), '') || enc.endAt;
    const rec = {
      id: enc.no,
      encounterNo: enc.no,
      status: 'Unassigned',
      assignedTo: null,
      versions: [],
      releasedAt: released,
      completedAt: null,
      slaDays: enc.type === 'IP' ? 5 : 3,
      assignments: [],
      recodeRequests: [],
      createdAt: released,
      updatedAt: released,
    };
    fill(rec, enc, lines);
    records.push(rec);
  };

  const version = (n, diagnoses, procedures, acks = [], coded = null, reason = null) => ({
    version: n,
    diagnoses,
    procedures,
    warningsAcknowledged: acks,
    codedAt: coded?.at || null,
    codedBy: coded?.by || null,
    reason,
  });

  // In progress, on the demo coder's own list, inside its SLA — the chart the
  // demo codes to the end. The echo the query asked for has been answered, so
  // I50.9 is now the unspecified warning waiting to be replaced by I50.21.
  chart('heartFailure', (rec, enc) => {
    rec.status = 'In Progress';
    rec.assignedTo = TAREK;
    rec.assignments.push({ by: SUPERVISOR, to: TAREK, at: ago(2, 8, 30), reason: 'Internal Medicine backlog' });
    rec.versions.push(version(1, [dx('I50.9', true, 'Y'), dx('I10', false, 'Y'), dx('E11.9', false, 'Y')], []));
    rec.updatedAt = ago(1, 10, 5);
    const summary = docs.byEncounter(enc.no).find((d) => d.type === 'Discharge Summary');
    query(enc.no, 'CDQ-0003', {
      type: 'Missing Documentation',
      physicianId: enc.doctorId,
      question: 'The discharge summary refers to an echocardiogram on day 2 but no echo report is on file. Please file the report — the ejection fraction decides whether this is coded as systolic or diastolic failure.',
      refs: { chargeLineIds: [], docIds: summary ? [summary.id] : [] },
      status: 'Answered',
      raisedBy: TAREK,
      thread: [
        { at: ago(1, 10, 20), by: name(TAREK), role: 'Coder', text: 'The discharge summary refers to an echocardiogram on day 2 but no echo report is on file. Please file the report — the ejection fraction decides whether this is coded as systolic or diastolic failure.' },
        { at: ago(0, 8, 30), by: 'Dr. Nabil Chammas', role: 'Physician', text: 'Echo on day 2: dilated LV, EF 30%, moderate MR. Heart failure with reduced ejection fraction, acute on new diagnosis. Report is with medical records.' },
      ],
      raisedAt: ago(1, 10, 20),
      answeredAt: ago(0, 8, 30),
      resolvedAt: null,
    });
    log(enc.no, 'Assigned', `To ${name(TAREK)} — Internal Medicine backlog`, ago(2, 8, 30), SUPERVISOR);
    log(enc.no, 'Draft saved', '3 diagnoses, 0 procedures', ago(1, 10, 5), name(TAREK));
    log(enc.no, 'Query raised', 'CDQ-0003 · Missing Documentation → Dr. Nabil Chammas', ago(1, 10, 20), name(TAREK));
    log(enc.no, 'Query answered', 'CDQ-0003 · Dr. Nabil Chammas', ago(0, 8, 30), 'Dr. Nabil Chammas');
  });

  // Query pending, long past its SLA: the note documents the oxygen and the
  // saturation but never says respiratory failure, which is the whole point
  // of a specificity query.
  chart('pneumonia', (rec, enc) => {
    rec.status = 'Query Pending';
    rec.assignedTo = TAREK;
    rec.assignments.push({ by: name(TAREK), to: TAREK, at: ago(8, 9, 10), reason: 'Self-assigned' });
    rec.versions.push(version(1, [dx('J18.9', true, 'Y'), dx('J96.01', false, 'Y')], []));
    rec.updatedAt = ago(7, 11, 40);
    const summary = docs.byEncounter(enc.no).find((d) => d.type === 'Discharge Summary');
    const text = 'The discharge summary documents SpO2 88% on room air and 4 L oxygen on arrival, and "marked respiratory distress". Was acute hypoxic respiratory failure present on admission? If so, please document it — it cannot be coded from the saturation alone.';
    query(enc.no, 'CDQ-0001', {
      type: 'Specificity',
      physicianId: enc.doctorId,
      question: text,
      refs: { chargeLineIds: [], docIds: summary ? [summary.id] : [] },
      status: 'Open',
      raisedBy: TAREK,
      thread: [{ at: ago(7, 11, 40), by: name(TAREK), role: 'Coder', text }],
      raisedAt: ago(7, 11, 40),
      answeredAt: null,
      resolvedAt: null,
    });
    log(enc.no, 'Self-assigned', name(TAREK), ago(8, 9, 10), name(TAREK));
    log(enc.no, 'Draft saved', '2 diagnoses, 0 procedures', ago(7, 11, 30), name(TAREK));
    log(enc.no, 'Query raised', 'CDQ-0001 · Specificity → Dr. Souad Baroudi', ago(7, 11, 40), name(TAREK));
  });

  // Coded, with the one query the demo can read end to end: asked, answered
  // and resolved before the chart was marked.
  chart('ctChest', (rec, enc, lines) => {
    rec.status = 'Coded';
    rec.assignedTo = TAREK;
    rec.assignments.push({ by: name(TAREK), to: TAREK, at: ago(3, 9, 0), reason: 'Self-assigned' });
    rec.versions.push(version(1,
      [dx('R07.9', true), dx('I10')],
      [px('71260', enc, lines, 'RAD-0003')],
      [{ code: 'unspecified:R07.9', reason: 'Symptom code — the CT excluded embolism and no cause was established' }],
      { at: ago(2, 15, 10), by: TAREK }));
    rec.completedAt = ago(2, 15, 10);
    rec.updatedAt = rec.completedAt;
    const report = docs.byEncounter(enc.no).find((d) => d.type === 'Imaging Report');
    const text = 'The charge line reads "CT chest with contrast" and the request card says non-contrast. Please confirm which study was performed.';
    query(enc.no, 'CDQ-0002', {
      type: 'Clarification',
      physicianId: enc.doctorId,
      question: text,
      refs: { chargeLineIds: lines.filter((l) => l.chargeCode === 'RAD-0003').map((l) => l.id), docIds: report ? [report.id] : [] },
      status: 'Resolved',
      raisedBy: TAREK,
      thread: [
        { at: ago(3, 9, 30), by: name(TAREK), role: 'Coder', text },
        { at: ago(2, 12, 0), by: 'Dr. Ghassan Tabet', role: 'Physician', text: 'CT pulmonary angiogram with 80 mL intravenous contrast, as the report states. The request card was superseded.' },
        { at: ago(2, 15, 0), by: name(TAREK), role: 'Coder', text: 'Resolved — coded 71260, with contrast.' },
      ],
      raisedAt: ago(3, 9, 30),
      answeredAt: ago(2, 12, 0),
      resolvedAt: ago(2, 15, 0),
    });
    log(enc.no, 'Self-assigned', name(TAREK), ago(3, 9, 0), name(TAREK));
    log(enc.no, 'Query raised', 'CDQ-0002 · Clarification → Dr. Ghassan Tabet', ago(3, 9, 30), name(TAREK));
    log(enc.no, 'Query answered', 'CDQ-0002 · Dr. Ghassan Tabet', ago(2, 12, 0), 'Dr. Ghassan Tabet');
    log(enc.no, 'Query resolved', 'CDQ-0002 — coded 71260, with contrast', ago(2, 15, 0), name(TAREK));
    log(enc.no, 'Marked coded', 'v1 · 2 diagnoses, 1 procedure', ago(2, 15, 10), name(TAREK));
  });

  // Coded by the other coder, yesterday — the second point on the throughput chart.
  chart('chestPainEr', (rec, enc, lines) => {
    rec.status = 'Coded';
    rec.assignedTo = RITA;
    rec.assignments.push({ by: SUPERVISOR, to: RITA, at: ago(2, 8, 45), reason: 'Emergency backlog' });
    rec.versions.push(version(1,
      [dx('R07.9', true), dx('C34.90')],
      [px('71046', enc, lines, 'RAD-0002')],
      [
        { code: 'unspecified:R07.9', reason: 'Non-cardiac chest pain, no cause documented' },
        { code: 'unspecified:C34.90', reason: 'Lobe not stated in the emergency note; oncology record holds the staging' },
      ],
      { at: ago(1, 11, 25), by: RITA }));
    rec.completedAt = ago(1, 11, 25);
    rec.updatedAt = rec.completedAt;
    log(enc.no, 'Assigned', `To ${name(RITA)} — Emergency backlog`, ago(2, 8, 45), SUPERVISOR);
    log(enc.no, 'Draft saved', '2 diagnoses, 1 procedure', ago(1, 11, 0), name(RITA));
    log(enc.no, 'Marked coded', 'v1 · 2 diagnoses, 1 procedure', ago(1, 11, 25), name(RITA));
  });

  // Coded six days ago and sent back: the summary names the cause and the
  // principal is still the symptom. This is the chart Recode opens v2 on.
  chart('collapse', (rec, enc) => {
    rec.status = 'Recode Requested';
    rec.assignedTo = TAREK;
    rec.assignments.push({ by: name(TAREK), to: TAREK, at: ago(6, 9, 0), reason: 'Self-assigned' });
    rec.versions.push(version(1,
      [dx('R55', true, 'Y'), dx('I10', false, 'Y'), dx('E78.5', false, 'Y')],
      [],
      [{ code: 'unspecified:E78.5', reason: 'Lipid profile abnormal, type not characterised' }],
      { at: ago(6, 14, 20), by: TAREK }));
    rec.completedAt = ago(6, 14, 20);
    rec.recodeRequests.push({
      id: 'RCR-0001',
      source: 'Manual',
      ref: 'Internal audit',
      reason: 'The discharge summary names orthostatic hypotension as the cause of the collapse — I95.1 should be principal, with R55 as the presenting symptom.',
      at: ago(2, 16, 0),
      by: SUPERVISOR,
      status: 'Open',
    });
    rec.updatedAt = ago(2, 16, 0);
    log(enc.no, 'Self-assigned', name(TAREK), ago(6, 9, 0), name(TAREK));
    log(enc.no, 'Draft saved', '3 diagnoses, 0 procedures', ago(6, 14, 0), name(TAREK));
    log(enc.no, 'Marked coded', 'v1 · 3 diagnoses, 0 procedures', ago(6, 14, 20), name(TAREK));
    log(enc.no, 'Recode requested', 'RCR-0001 · Manual · Internal audit — the discharge summary names orthostatic hypotension as the cause of the collapse', ago(2, 16, 0), SUPERVISOR);
  });

  // In progress with the other coder and past its SLA — what the Coder filter
  // and the Beyond SLA card separate from the demo coder's own list.
  chart('collapseOrtho', (rec) => {
    rec.status = 'In Progress';
    rec.assignedTo = RITA;
    rec.assignments.push({ by: name(RITA), to: RITA, at: ago(5, 9, 15), reason: 'Self-assigned' });
    rec.versions.push(version(1, [dx('R55', true, 'Y')], []));
    rec.updatedAt = ago(4, 10, 0);
    log(rec.encounterNo, 'Self-assigned', name(RITA), ago(5, 9, 15), name(RITA));
    log(rec.encounterNo, 'Draft saved', '1 diagnosis, 0 procedures', ago(4, 10, 0), name(RITA));
  });

  return { records, queries, trail };
}
