// Repository — third-party administrators (amendment 42). Owner:
// modules/defensio. A TPA is the administrator that stands between a payer
// and the hospital and withholds its fee from the remittances it passes on;
// the register names it, who to call there, and which payers it administers
// over which dates. A payer has one administrator on any given day — a link
// that would overlap another on the same payer is refused — and the
// administrator a fee is read against is the one linked on the remittance
// date, never the one linked today.
//
// Seeded on first read from data/seed/tpas.js; a reset empties the table and
// the next read rebuilds it. Every write is audited under `tpas`.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as payers from './payers.js';
import { current as currentRole } from '../../shared/roles.js';
import { iso, todayIso, withinDates } from '../../shared/format.js';
import { tpas as SEED } from '../seed/tpas.js';

const TABLE = 'tpas';
const ENTITY = 'tpas';

export const STATUSES = ['Active', 'Inactive'];

export function all() {
  const rows = store.table(TABLE);
  if (!rows.length) rows.push(...structuredClone(SEED));
  return rows;
}

export const get = (id) => all().find((t) => t.id === id) || null;
export const findActive = () => all().filter((t) => t.status === 'Active');
export const nameOf = (id) => get(id)?.name || id || '—';
export const history = (id) => audit.forEntity(ENTITY, id);

/** The administrator linked on a payer on a date (today by default), or null when the payer deals direct. */
export function forPayer(payerId, on = todayIso()) {
  for (const t of all()) {
    if ((t.payerLinks || []).some((l) => l.payerId === payerId && withinDates(on, l.from, l.to))) return t;
  }
  return null;
}

/** Every link of a TPA with the payer's name beside it. */
export const linksOf = (id) => (get(id)?.payerLinks || []).map((l) => ({ ...l, payer: payers.get(l.payerId)?.nameEn || l.payerId, live: withinDates(todayIso(), l.from, l.to) }));

/** The payers a TPA administers today. */
export const payersOf = (id) => linksOf(id).filter((l) => l.live).map((l) => l.payerId);

export function counts() {
  const rows = all();
  return { total: rows.length, active: rows.filter((t) => t.status === 'Active').length, links: rows.reduce((n, t) => n + (t.payerLinks || []).length, 0) };
}

// --- writes ------------------------------------------------------------------------------

export function validate(data = {}, { excludeId = null } = {}) {
  const problems = [];
  if (!String(data.name || '').trim()) problems.push('Give the administrator a name.');
  if (all().some((t) => t.id !== excludeId && t.name.trim().toLowerCase() === String(data.name || '').trim().toLowerCase())) problems.push('An administrator with that name is already on the register.');
  if (data.contact?.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.contact.email)) problems.push('The contact email does not look like one.');
  return problems;
}

/** create({ name, contact { name, role, email, phone }, payerRecordId, note }) → the row or { error }. */
export function create(data = {}, { at = null, by = null, commit = true } = {}) {
  const problems = validate(data);
  if (problems.length) return { error: problems.join(' ') };
  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  const row = {
    id: store.nextId(TABLE, 'TP-'),
    name: String(data.name).trim(),
    payerRecordId: data.payerRecordId || null,
    status: 'Active',
    contact: { name: data.contact?.name || '', role: data.contact?.role || '', email: data.contact?.email || '', phone: data.contact?.phone || '' },
    payerLinks: [],
    note: data.note || '',
    createdAt: when, createdBy: who, updatedAt: when,
  };
  all().push(row);
  log(row, 'Registered', `${row.name}${row.contact.name ? ` · ${row.contact.name}` : ''}`, when, who);
  if (commit) store.commit('tpas.create');
  return row;
}

export function update(id, patch = {}, { at = null, by = null } = {}) {
  const row = get(id);
  if (!row) return { error: 'No such administrator' };
  const next = { ...row, ...patch, contact: { ...row.contact, ...(patch.contact || {}) } };
  const problems = validate(next, { excludeId: id });
  if (problems.length) return { error: problems.join(' ') };
  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  const changed = Object.keys(patch).filter((k) => k !== 'contact' && JSON.stringify(row[k]) !== JSON.stringify(patch[k]));
  if (patch.contact && JSON.stringify(row.contact) !== JSON.stringify(next.contact)) changed.push('contact');
  Object.assign(row, next, { updatedAt: when });
  log(row, 'Updated', changed.join(', ') || 'no change', when, who);
  store.commit('tpas.update');
  return row;
}

export function setStatus(id, status, { at = null, by = null } = {}) {
  const row = get(id);
  if (!row || !STATUSES.includes(status) || row.status === status) return row;
  const when = at || new Date().toISOString();
  row.status = status;
  row.updatedAt = when;
  log(row, status === 'Active' ? 'Activated' : 'Deactivated', '', when, by || currentRole().name);
  store.commit('tpas.status');
  return row;
}

/** linkBlocker(id, { payerId, from, to }) → a sentence or '' — a payer has one administrator at a time. */
export function linkBlocker(id, { payerId, from, to = null } = {}) {
  if (!payerId) return 'Pick the payer.';
  if (!payers.get(payerId)) return 'No such payer.';
  if (!iso(from)) return 'Give the link a start date.';
  if (to && iso(to) < iso(from)) return 'The link ends before it starts.';
  for (const t of all()) {
    const clash = (t.payerLinks || []).find((l) => l.payerId === payerId && !(to && iso(to) < iso(l.from)) && !(l.to && iso(from) > iso(l.to)));
    if (clash) return `${payers.get(payerId)?.nameEn || payerId} is administered by ${t.name} from ${clash.from}${clash.to ? ` to ${clash.to}` : ''} — end that link first.`;
  }
  return '';
}

/** addLink(id, { payerId, from, to }) → the row or { error }. */
export function addLink(id, link = {}, { at = null, by = null, commit = true } = {}) {
  const row = get(id);
  if (!row) return { error: 'No such administrator' };
  const why = linkBlocker(id, link);
  if (why) return { error: why };
  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  row.payerLinks = [...(row.payerLinks || []), { payerId: link.payerId, from: iso(link.from), to: link.to ? iso(link.to) : null }];
  row.updatedAt = when;
  log(row, 'Payer linked', `${payers.get(link.payerId)?.nameEn || link.payerId} from ${iso(link.from)}${link.to ? ` to ${iso(link.to)}` : ''}`, when, who);
  if (commit) store.commit('tpas.link');
  return row;
}

/** endLink(id, payerId, to) → the row or { error }: closes the open link on that payer. */
export function endLink(id, payerId, to, { at = null, by = null } = {}) {
  const row = get(id);
  if (!row) return { error: 'No such administrator' };
  const link = (row.payerLinks || []).find((l) => l.payerId === payerId && !l.to);
  if (!link) return { error: 'No open link on that payer' };
  if (!iso(to) || iso(to) < iso(link.from)) return { error: 'The end date has to be on or after the start' };
  const when = at || new Date().toISOString();
  link.to = iso(to);
  row.updatedAt = when;
  log(row, 'Payer link ended', `${payers.get(payerId)?.nameEn || payerId} to ${link.to}`, when, by || currentRole().name);
  store.commit('tpas.link');
  return row;
}

function log(row, action, details, at, user) {
  audit.all().push({ id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: row.id, action, details, user, at });
}
