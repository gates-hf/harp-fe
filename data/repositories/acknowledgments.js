// Repository — estimate acknowledgments. Owner: modules/frontis.
//
// One row is a patient saying, on the record, that they were shown what the
// visit is expected to cost them and accepted it. It is append-only for the
// reason an eligibility snapshot is: it is evidence about a moment, and a
// signature that can be edited afterwards is not a signature.
//
// It names the estimate rather than copying its numbers. The estimate is
// already frozen at issue, so the acknowledgment points at what was actually
// handed over and nothing here can drift from it.
//
// The dataset seeds itself on first read (data/seed/acknowledgments.js) rather
// than through data/store.js: it reads the encounter board and the estimates to
// exist — the shape data/seed/estimates.js and data/seed/referrals.js use.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as estimates from './estimates.js';
import { buildAcknowledgments, buildAcknowledgmentTrail } from '../seed/acknowledgments.js';
import { CONFIG } from '../../shared/config.js';
import { current as currentRole } from '../../shared/roles.js';

const TABLE = 'acknowledgments';

/** The trail is keyed on this entity name; an acknowledgment's id is its own. */
const ENTITY = 'acknowledgment';

/** Who put their name to it. A guardian signs for a child or a dependant. */
export const BY_KINDS = ['Patient', 'Guardian'];

/** How it was taken. The list is platform config — the desk does not invent one. */
export const METHODS = CONFIG.clearance.ackMethods;

export function all() {
  const rows = store.table(TABLE);
  if (!rows.length) {
    rows.push(...buildAcknowledgments());
    // The seeded trail, written with the times the events happened at rather
    // than through audit.log(), which would stamp every one of them with now
    // and with whoever is signed in.
    const trail = audit.all();
    for (const entry of buildAcknowledgmentTrail(rows)) {
      trail.push({ id: store.nextId('audit', 'AU-'), ...entry });
    }
  }
  return rows;
}

export const get = (id) => all().find((row) => row.id === id) || null;

/** One encounter's acknowledgments, newest first — usually exactly one. */
export const byEncounter = (no) =>
  all()
    .filter((row) => row.encounterNo === no)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));

/** Every acknowledgment naming one estimate, oldest first. */
export const forEstimate = (no) =>
  all()
    .filter((row) => row.estimateNo === no)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));

/** Whether this estimate has been signed for at all, wherever it was signed. */
export const isAcknowledged = (no) => forEstimate(no).length > 0;

/** "Rami Haddad (patient)" / "Layla Haddad (guardian)" — who put their name to it. */
export const byLabel = (row) =>
  (row ? `${row.byName || row.by} (${String(row.by || '').toLowerCase()})` : '—');

// --- writes -------------------------------------------------------------------

/**
 * Record one. The estimate is flagged as acknowledged as well, so the document
 * says so wherever it is read — but the record of who signed and how lives
 * here, because it is a fact about a conversation at a desk and not about a
 * quotation.
 */
export function create(data = {}) {
  const rows = all();
  const row = {
    id: store.nextId(TABLE, 'ACK-'),
    encounterNo: data.encounterNo || '',
    estimateNo: data.estimateNo || '',
    by: BY_KINDS.includes(data.by) ? data.by : 'Patient',
    byName: String(data.byName || '').trim(),
    method: data.method || METHODS[0],
    // The signed copy, when one was scanned in. A file is a name and a size in
    // the demo, the shape every other document in the platform uses.
    document: data.document ? { ...data.document } : null,
    note: String(data.note || '').trim(),
    user: data.user || currentRole().name,
    at: data.at || new Date().toISOString(),
  };
  rows.push(row);
  markEstimate(row);
  store.commit('acknowledgment.create');
  audit.log({
    entity: ENTITY,
    entityId: row.id,
    action: 'Acknowledged',
    details: `${row.estimateNo} acknowledged by ${byLabel(row)} — ${row.method}, encounter ${row.encounterNo}`,
  });
  return row;
}

/** The flag on the estimate: a document that has been signed for says so. */
function markEstimate(row) {
  const estimate = estimates.get(row.estimateNo);
  if (!estimate || estimate.acknowledgedAt) return;
  estimate.acknowledgedAt = row.at;
  estimate.acknowledgedBy = row.byName || row.by;
}
