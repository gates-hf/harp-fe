// Repository — escalation requests. Owner: modules/defensio (amendment 39).
// The fallback path for a lost appeal share dispositioned `escalate`: when
// amendment 38's level-2 creator (`appealCases.createNextLevel`) is not on
// disk, the tracking repository writes a request here for the appeal
// feature to pick up, and `take(id, caseId)` is what closes it once the
// level-2 case exists. With the creator present nothing is written here.
//
// Row: { id ('ESC-0001'), appealCaseId, denialId, claimNo, payerId, amount,
// reason, status (Pending | Taken), takenCaseId, createdAt, createdBy }.

import { store } from '../store.js';
import * as audit from './audit.js';
import { current as currentRole } from '../../shared/roles.js';
import { usd } from '../../shared/format.js';

const TABLE = 'escalationRequests';
const ENTITY = 'escalationRequests';

export const all = () => store.table(TABLE);
export const get = (id) => all().find((r) => r.id === id) || null;
export const byCase = (appealCaseId) => all().filter((r) => r.appealCaseId === appealCaseId);
export const pending = () => all().filter((r) => r.status === 'Pending');
export const counts = () => ({ total: all().length, pending: pending().length });

export function create(data = {}, { at = null, by = null, commit = true } = {}) {
  const dup = all().find((r) => r.appealCaseId === data.appealCaseId && r.denialId === data.denialId && r.status === 'Pending');
  if (dup) return dup;
  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  const row = {
    id: store.nextId(TABLE, 'ESC-'),
    appealCaseId: data.appealCaseId,
    denialId: data.denialId || null,
    claimNo: data.claimNo || null,
    payerId: data.payerId || null,
    amount: Math.round((Number(data.amount) || 0) * 100) / 100,
    reason: String(data.reason || '').trim(),
    status: 'Pending',
    takenCaseId: null,
    createdAt: when,
    createdBy: who,
  };
  all().push(row);
  audit.all().push({ id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: row.id, action: 'Created',
    details: `${row.appealCaseId} · ${row.denialId} · ${usd(row.amount)} — level 2 requested${row.reason ? `: ${row.reason}` : ''}`, user: who, at: when });
  if (commit) store.commit('appealTracking.escalation');
  return row;
}

/** The appeal feature marks the request taken by the level-2 case it created. */
export function take(id, caseId, { at = null, by = null, commit = true } = {}) {
  const row = get(id);
  if (!row || row.status !== 'Pending') return row;
  const when = at || new Date().toISOString();
  row.status = 'Taken';
  row.takenCaseId = caseId;
  audit.all().push({ id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: row.id, action: 'Taken',
    details: `Level-2 case ${caseId}`, user: by || currentRole().name, at: when });
  if (commit) store.commit('appealTracking.escalation');
  return row;
}
