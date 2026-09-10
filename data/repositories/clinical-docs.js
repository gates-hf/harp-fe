// Repository — clinical documents. Owner: modules/claima (amendment 26).
//
// What a chart is coded from: the discharge summary, the operative note, the
// reports. A document is evidence and is never edited — the repository reads
// them by encounter and adds one when a physician answers a query by filing
// what was missing. Amendment 27 reads byEncounter() for a claim's attachments.
//
// The dataset seeds itself on first read (data/seed/clinical-docs.js) rather
// than through data/store.js: it reads the encounter board to exist.

import { store } from '../store.js';
import * as audit from './audit.js';
import { buildClinicalDocs } from '../seed/clinical-docs.js';
import { current as currentRole } from '../../shared/roles.js';

const TABLE = 'clinicalDocs';

export const TYPES = [
  'Discharge Summary', 'Operative Note', 'Progress Note', 'Lab Report', 'Imaging Report', 'Consent',
];

export function all() {
  const rows = store.table(TABLE);
  if (!rows.length) rows.push(...buildClinicalDocs());
  return rows;
}

export const get = (id) => all().find((row) => row.id === id) || null;

/** Newest first — the workspace lists what was written last at the top. */
export const byEncounter = (no) =>
  all()
    .filter((row) => row.encounterNo === no)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

export const byPatient = (mrn) => all().filter((row) => row.patientMrn === mrn);

/** The icon a document type is drawn with. */
export function iconOf(type) {
  if (type === 'Imaging Report') return 'radiology';
  if (type === 'Lab Report') return 'biotech';
  if (type === 'Operative Note') return 'surgical';
  if (type === 'Consent') return 'draw';
  return 'description';
}

/**
 * File a document against a visit — what a physician does when a query says
 * one is missing. The text is what the coder reads; the file name is what the
 * claim attaches.
 */
export function add({ encounterNo, patientMrn = '', type, title, textPreview = '', date = null, authorId = null }) {
  if (!encounterNo || !TYPES.includes(type) || !title) return null;
  const role = currentRole();
  const row = {
    id: store.nextId(TABLE, 'DOC-'),
    encounterNo,
    patientMrn,
    type,
    title,
    fileName: `${encounterNo}-${type.toLowerCase().replace(/\s+/g, '-')}.pdf`,
    date: date || new Date().toISOString().slice(0, 10),
    author: role.name,
    authorId,
    textPreview,
  };
  all().push(row);
  store.commit('clinicalDoc.add');
  audit.log({ entity: 'clinicalDocs', entityId: encounterNo, action: 'Document filed', details: `${type} — ${title}` });
  return row;
}
