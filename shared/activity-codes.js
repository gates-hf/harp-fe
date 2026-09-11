// Recent activity — the standard-codes half (amendment 44): the three audit
// entities Pactum's code systems write under, resolved to the system page.
// Split out of activity-trail.js the way the Claima and Defensio halves are,
// so the trail file stays near the cap as the platform grows. Reads
// repositories; the arrow runs shared/ -> data/ and never back.

import * as systems from '../data/repositories/code-systems.js';
import * as versions from '../data/repositories/code-system-versions.js';
import * as codes from '../data/repositories/standard-codes.js';

export const CODES_ENTITY_TYPES = [
  { key: 'codeSystems', label: 'Code systems', module: 'pactum' },
  { key: 'codeSystemVersions', label: 'Code system versions', module: 'pactum' },
  { key: 'standardCodes', label: 'Standard codes', module: 'pactum' },
];

const versionPath = (v) => (v ? `/pactum/standard-codes/${v.codeSystemId}/codes?version=${v.id}` : '');

/** { type, name, path } for a standard-codes entry, or null when the entry is another entity's. */
export function describeCodes(entry) {
  const { entity, entityId } = entry;

  if (entity === 'codeSystems') {
    const row = entityId ? systems.get(entityId) : null;
    return { type: 'Code system', name: row?.name || entityId || '—', path: row ? `/pactum/standard-codes/${row.id}` : '' };
  }

  if (entity === 'codeSystemVersions') {
    const row = entityId ? versions.get(entityId) : null;
    return { type: 'Code system version', name: row ? versions.label(row) : entityId || '—', path: versionPath(row) };
  }

  if (entity === 'standardCodes') {
    const row = entityId ? codes.get(entityId) : null;
    const version = row ? versions.get(row.codeSystemVersionId) : null;
    return {
      type: 'Standard code',
      name: row ? `${row.code} — ${row.display}${version ? ` · ${versions.label(version)}` : ''}` : entityId || '—',
      path: versionPath(version),
    };
  }

  return null;
}
