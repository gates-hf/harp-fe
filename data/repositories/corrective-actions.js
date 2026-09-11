// Repository — corrective actions (amendment 37, Defensio F2). Owner:
// modules/defensio. What a root-cause case decides to change so the denial
// does not happen again: a configuration somebody edits (a Pactum matrix, a
// contract row — named by the screen it is made on), a training, a process,
// a staffing change, an escalation to the payer. Each has an owner and a due
// date, is marked Done by whoever did it and Verified by whoever checked,
// with the note that says what was checked. A case closes only when every
// action on it is Verified — data/repositories/rca-cases.js reads this file
// for that and this file never reads it back.
//
// Seeded by the root-cause register's own seed (a corrective action hangs
// off a case, so the case's builder drives `create` here with the ids it
// dealt); nothing in data/store.js.

import { store } from '../store.js';
import * as audit from './audit.js';
import { current as currentRole } from '../../shared/roles.js';
import { staffName } from '../seed/staff.js';
import { compareDates, todayIso } from '../../shared/format.js';

const TABLE = 'correctiveActions';
const ENTITY = 'correctiveActions';

export const TYPES = ['Configuration', 'Training', 'Process', 'Staffing', 'PayerEscalation'];
export const TYPE_LABELS = {
  Configuration: 'Configuration', Training: 'Training', Process: 'Process', Staffing: 'Staffing', PayerEscalation: 'Payer escalation',
};
export const typeLabel = (type) => TYPE_LABELS[type] || type || '—';
export const STATUSES = ['Open', 'Done', 'Verified'];

export const all = () => store.table(TABLE);
export const get = (id) => all().find((a) => a.id === id) || null;
export const byCase = (rcaCaseId) => all().filter((a) => a.rcaCaseId === rcaCaseId).sort(byAt);
export const history = (id) => audit.forEntity(ENTITY, id);

export const isOverdue = (row, on = todayIso()) => row?.status === 'Open' && Boolean(row.dueDate) && compareDates(row.dueDate, on) < 0;

export function statusTone(status) {
  if (status === 'Verified') return 'success';
  if (status === 'Done') return 'info';
  return 'warning';
}

/** Where a Configuration action is made — a hash route the chip opens, or a plain reference. */
export const targetHref = (row) => (row?.targetRef && String(row.targetRef).startsWith('#/') ? row.targetRef : null);

/**
 * create({ rcaCaseId, action, type, targetRef, ownerId, dueDate }) → the row
 * or { error }. A Configuration action names where it is made; every action
 * names an owner and a due date.
 */
export function create(data = {}, { at = null, by = null, commit = true } = {}) {
  const problems = validate(data);
  if (problems.length) return { error: problems.join(' ') };
  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  const row = {
    id: store.nextId(TABLE, 'CA-'),
    rcaCaseId: data.rcaCaseId,
    action: String(data.action).trim(),
    type: data.type,
    targetRef: data.type === 'Configuration' ? String(data.targetRef || '').trim() : String(data.targetRef || '').trim() || null,
    ownerId: data.ownerId,
    dueDate: data.dueDate,
    status: 'Open',
    doneAt: null,
    doneBy: null,
    doneNote: '',
    verificationNote: '',
    verifiedBy: null,
    verifiedAt: null,
    attachments: [],
    createdAt: when,
    createdBy: who,
    updatedAt: when,
  };
  all().push(row);
  log(row, 'Created', `${typeLabel(row.type)} · ${row.action} · owner ${staffName(row.ownerId)} · due ${row.dueDate}${row.targetRef ? ` · ${row.targetRef}` : ''}`, when, who);
  if (commit) store.commit('correctiveActions.create');
  return row;
}

export function validate(data = {}) {
  const problems = [];
  if (!data.rcaCaseId) problems.push('The action belongs to a case.');
  if (!String(data.action || '').trim()) problems.push('Say what will be done.');
  if (!TYPES.includes(data.type)) problems.push('Pick a type.');
  if (data.type === 'Configuration' && !String(data.targetRef || '').trim()) problems.push('A configuration action names where it is made.');
  if (!data.ownerId) problems.push('Name an owner.');
  if (!data.dueDate) problems.push('Set a due date.');
  return problems;
}

/** Edit an Open action's wording, type, target, owner or due date. */
export function update(id, patch = {}, { at = null, by = null } = {}) {
  const row = get(id);
  if (!row) return { error: 'No such action' };
  if (row.status !== 'Open') return { error: `A ${row.status.toLowerCase()} action is not edited — reopen it first` };
  const next = { ...row, ...patch };
  const problems = validate(next);
  if (problems.length) return { error: problems.join(' ') };
  const changes = [];
  for (const key of ['action', 'type', 'targetRef', 'ownerId', 'dueDate']) {
    if (patch[key] !== undefined && patch[key] !== row[key]) { changes.push(`${key}: ${row[key] ?? '—'} → ${patch[key]}`); row[key] = patch[key]; }
  }
  if (!changes.length) return row;
  touch(row, at);
  log(row, 'Updated', changes.join('; '), at, by);
  store.commit('correctiveActions.update');
  return row;
}

export function markDone(id, note = '', { at = null, by = null } = {}) {
  const row = get(id);
  if (!row) return { error: 'No such action' };
  if (row.status !== 'Open') return { error: `Already ${row.status.toLowerCase()}` };
  const when = at || new Date().toISOString();
  row.status = 'Done';
  row.doneAt = when;
  row.doneBy = by || currentRole().name;
  row.doneNote = String(note || '').trim();
  touch(row, when);
  log(row, 'Done', row.doneNote || 'Marked done', when, by);
  store.commit('correctiveActions.done');
  return row;
}

/** Verified — by somebody who checked, with what they checked. */
export function verify(id, { verificationNote = '' } = {}, { at = null, by = null } = {}) {
  const row = get(id);
  if (!row) return { error: 'No such action' };
  if (row.status === 'Verified') return { error: 'Already verified' };
  if (row.status !== 'Done') return { error: 'Mark the action done before it is verified' };
  const why = String(verificationNote || '').trim();
  if (!why) return { error: 'Say what was checked — the note is the verification' };
  const when = at || new Date().toISOString();
  row.status = 'Verified';
  row.verificationNote = why;
  row.verifiedBy = by || currentRole().name;
  row.verifiedAt = when;
  touch(row, when);
  log(row, 'Verified', why, when, by);
  store.commit('correctiveActions.verify');
  return row;
}

export function reopen(id, reason = '', { at = null, by = null } = {}) {
  const row = get(id);
  if (!row) return { error: 'No such action' };
  if (row.status === 'Open') return { error: 'Already open' };
  const why = String(reason || '').trim();
  if (!why) return { error: 'Say why the action is being reopened' };
  const was = row.status;
  row.status = 'Open';
  row.doneAt = null;
  row.doneBy = null;
  row.verificationNote = '';
  row.verifiedBy = null;
  row.verifiedAt = null;
  touch(row, at);
  log(row, 'Reopened', `Was ${was.toLowerCase()} — ${why}`, at, by);
  store.commit('correctiveActions.reopen');
  return row;
}

export function addAttachment(id, { fileName, size = 0 } = {}, { at = null, by = null } = {}) {
  const row = get(id);
  if (!row) return { error: 'No such action' };
  const name = String(fileName || '').trim();
  if (!name) return { error: 'Pick a file' };
  const when = at || new Date().toISOString();
  const doc = { id: `${row.id}-D${(row.attachments.length + 1)}`, fileName: name, size: Number(size) || 0, at: when, by: by || currentRole().name };
  row.attachments = [...row.attachments, doc];
  touch(row, when);
  log(row, 'Attachment added', name, when, by);
  store.commit('correctiveActions.attach');
  return row;
}

// --- internals --------------------------------------------------------------------------------

const byAt = (a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id);

function touch(row, at = null) { row.updatedAt = at || new Date().toISOString(); }

function log(row, action, details, at, by) {
  audit.all().push({
    id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: row.id, action, details,
    user: by || currentRole().name, at: at || new Date().toISOString(),
  });
}
