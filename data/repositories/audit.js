// Repository — audit. Shared by every module and append-only: there is no
// update and no delete, by design. A module records what it did here and reads
// the trail back for one entity.

import { store } from '../store.js';
import { current as currentRole } from '../../shared/roles.js';

const TABLE = 'audit';

export function all() {
  return store.table(TABLE);
}

/** Reverse-chronological trail for one row, e.g. forEntity('payers', 'PY-0007'). */
export function forEntity(entity, entityId) {
  return all()
    .filter((row) => row.entity === entity && row.entityId === entityId)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/**
 * Append one entry. `user` defaults to the signed-in demo role.
 * log({ entity, entityId, action, details, user }) -> the stored row.
 */
export function log({ entity, entityId = null, action, details = '', user }) {
  const row = {
    id: store.nextId(TABLE, 'AU-'),
    entity,
    entityId,
    action,
    user: user || currentRole().name,
    at: new Date().toISOString(),
    details,
  };
  all().push(row);
  store.commit('audit.log');
  return row;
}
