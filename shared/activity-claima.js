// Recent activity — the Claima half of the resolver in shared/activity-trail.js:
// which screen a Claima audit entry leads back to. Split out by module so the
// trail file stays near the line cap while the platform keeps growing; the
// trail spreads these entity types into its own list and asks describeClaima()
// before falling back to a name without a link.
//
// Five of the entities are wired ahead of the amendments that create them
// (28–30): a batch, a remittance, a denial, a write-off and a nullification
// link by id to the route each of those features publishes, so their rows
// link from the day the feature lands. Until its repository exists a branch
// cannot check the record is still there — the owning session upgrades its
// branch to a lookup when it adds the repository, the way the first five
// branches here read theirs.

import * as charges from '../data/repositories/charges.js';
import * as claims from '../data/repositories/claims.js';
import * as coding from '../data/repositories/coding.js';
import * as encounters from '../data/repositories/encounters.js';
import * as cdm from '../data/repositories/cdm.js';
import * as denials from '../data/repositories/denials.js';
import * as writeoffs from '../data/repositories/writeoffs.js';
import * as nullifications from '../data/repositories/nullifications.js';

/** The Claima entity keys the trail uses, in the order the filter lists them. */
export const CLAIMA_ENTITY_TYPES = [
  { key: 'charges', label: 'Charge lines', module: 'claima' },
  { key: 'feeds', label: 'Charge feeds', module: 'claima' },
  { key: 'coding', label: 'Coding', module: 'claima' },
  { key: 'clinicalDocs', label: 'Clinical documents', module: 'claima' },
  { key: 'claims', label: 'Claims', module: 'claima' },
  { key: 'batches', label: 'Submission batches', module: 'claima' },
  { key: 'remittances', label: 'Remittances', module: 'claima' },
  { key: 'denials', label: 'Denials', module: 'claima' },
  { key: 'writeoffs', label: 'Write-offs', module: 'claima' },
  { key: 'nullifications', label: 'Nullifications', module: 'claima' },
];

/**
 * The entities whose repository is not on disk yet: the label the row wears
 * and the route the id is appended to. A row with no id is named and not
 * linked, like everywhere else in the trail.
 */
const BY_ID = {
  batches: { type: 'Submission batch', base: '/claima/submission/' },
  remittances: { type: 'Remittance', base: '/claima/remittances/' },
};

/**
 * One Claima audit entry as { type, name, path, withheld? }, or null when the
 * entity is not Claima's. `isMasked(mrn)` is the trail's own rule for a
 * restricted record, handed in so there is one copy of it.
 */
export function describeClaima(entry, isMasked) {
  const { entity, entityId } = entry;

  // A charge line is keyed on its own id and read on the capture worklist,
  // grouped under its visit — the deep link the worklist already accepts.
  if (entity === 'charges') {
    const row = entityId ? charges.get(entityId) : null;
    const item = row ? cdm.get(row.itemId) : null;
    return {
      type: 'Charge line',
      name: row ? `${item?.chargeCode || row.itemId} — ${cdm.label(item) || row.itemId} · ${row.encounterNo}` : entityId || '—',
      path: row ? `/claima/charges?encounter=${row.encounterNo}` : '',
      withheld: isMasked(row?.patientMrn),
    };
  }

  // A feed run is one entry for the whole feed, read on the capture health screen.
  if (entity === 'feeds') return { type: 'Charge feed', name: entityId && entityId !== 'feeds' ? entityId : 'All feeds', path: '/claima/charges/health' };

  // Coding and the documents it is coded from are both keyed on the encounter
  // number, and both are read in the workspace. Nothing is withheld: a
  // coding entry names codes and coders, not the cover — the line the
  // encounter's own visit tab draws.
  if (entity === 'coding' || entity === 'clinicalDocs') {
    const enc = entityId ? encounters.get(entityId) : null;
    const rec = entity === 'coding' && entityId ? coding.get(entityId) : null;
    return {
      type: entity === 'coding' ? 'Coding' : 'Clinical document',
      name: enc ? `${enc.no} — ${enc.patientMrn}${rec ? ` · ${rec.status}` : ''}` : entityId || '—',
      path: enc ? `/claima/coding/${enc.no}` : '',
    };
  }

  // A claim is keyed on its id and read by its number; it names the payer and
  // the money, so it withholds on the rule the encounter board draws.
  if (entity === 'claims') {
    const row = entityId ? claims.get(entityId) : null;
    return {
      type: 'Claim',
      name: row ? `${row.claimNo} — ${row.patientMrn}` : entityId || '—',
      path: row ? `/claima/claims/${row.claimNo}` : '',
      withheld: isMasked(row?.patientMrn),
    };
  }

  // A denial is keyed on its id and read on its own page; it names the payer,
  // the claim and the money, so it withholds on the rule the claim row draws.
  if (entity === 'denials') {
    const row = entityId ? denials.get(entityId) : null;
    return {
      type: 'Denial',
      name: row ? `${row.id} — ${row.claimNo} · ${row.status}` : entityId || '—',
      path: row ? `/claima/denials/${row.id}` : entityId ? `/claima/denials/${entityId}` : '',
      withheld: isMasked(row?.patientMrn),
    };
  }

  // A write-off is keyed on its id and read on its decision page; it names
  // the payer, the balance and what the patient owes, so it withholds on the
  // rule the claim row draws.
  if (entity === 'writeoffs') {
    const row = entityId ? writeoffs.get(entityId) : null;
    return {
      type: 'Write-off',
      name: row ? `${row.id} — ${writeoffs.SOURCE_LABELS[row.source.kind] || row.source.kind} ${row.source.ref} · ${row.status}` : entityId || '—',
      path: row ? `/claima/writeoffs/${row.id}` : entityId ? `/claima/writeoffs/${entityId}` : '',
      withheld: isMasked(row?.source?.mrn),
    };
  }

  // A nullification is keyed on its number and read on its own page; it
  // names the claim, the payer and the money, so it withholds on the rule
  // the claim row draws.
  if (entity === 'nullifications') {
    const row = entityId ? nullifications.get(entityId) : null;
    return {
      type: 'Nullification',
      name: row ? `${row.no} — ${row.claimNo} · ${nullifications.PATH_LABELS[row.path] || row.path}` : entityId || '—',
      path: row ? `/claima/nullifications/${row.no}` : entityId ? `/claima/nullifications/${entityId}` : '',
      withheld: isMasked(row?.patientMrn),
    };
  }

  const future = BY_ID[entity];
  if (future) return { type: future.type, name: entityId || '—', path: entityId ? `${future.base}${entityId}` : '' };

  return null;
}
