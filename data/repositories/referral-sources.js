// Repository — referral sources. Owner: modules/frontis.
//
// Facilities and the external doctors who work at them, in one list both the
// inbound and the outbound form pick from. It grows by being used: typing a
// name nothing matches creates the source, so the register the desk needs is
// the one the desk built, and a second referral from the same clinic finds it
// waiting at the top of the list.
//
// Nothing else writes here. `upsertFromForm` is the only door in, and it is
// called by the referral repository when a referral is saved.

import { store } from '../store.js';
import * as audit from './audit.js';

const TABLE = 'referralSources';

const ENTITY = 'referralSources';

export const KINDS = ['Facility', 'Doctor'];

export const all = () => store.table(TABLE);

export const get = (id) => all().find((row) => row.id === id) || null;

export const name = (id) => get(id)?.name || '';

/** A doctor reads with the facility behind them; a facility reads alone. */
export function label(id) {
  const row = get(id);
  if (!row) return '—';
  const facility = row.facilityId ? get(row.facilityId) : null;
  return facility ? `${row.name} · ${facility.name}` : row.name;
}

/**
 * search(kind, q, { facilityId }) — the combobox's list, most used first. A
 * doctor search narrows to one facility when the form has already named one,
 * because a doctor who works somewhere else is not the doctor being looked for.
 */
export function search(kind = 'Facility', q = '', { facilityId = '' } = {}) {
  const needle = String(q).trim().toLowerCase();
  return all()
    .filter((row) => {
      if (row.kind !== kind) return false;
      if (kind === 'Doctor' && facilityId && row.facilityId !== facilityId) return false;
      if (!needle) return true;
      return [row.name, row.specialty, row.address].some((v) =>
        String(v || '').toLowerCase().includes(needle));
    })
    .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0) || a.name.localeCompare(b.name));
}

/** The one already carrying this name, matched the way a clerk would match it. */
export const byName = (kind, value, { facilityId = '' } = {}) => {
  const needle = normalize(value);
  if (!needle) return null;
  return all().find((row) =>
    row.kind === kind
    && normalize(row.name) === needle
    && (kind !== 'Doctor' || !facilityId || row.facilityId === facilityId)) || null;
};

/**
 * upsertFromForm({ kind, id, name, facilityId, specialty, phone }) — the id the
 * referral should store. An id that already resolves is used as it stands; a
 * name that matches one is that source; anything else is created and audited,
 * because a register that grows silently is a register nobody trusts.
 */
export function upsertFromForm({ kind = 'Facility', id = '', name: value = '', facilityId = '', specialty = '', phone = '' } = {}) {
  if (id && get(id)) return id;
  const matched = byName(kind, value, { facilityId });
  if (matched) return matched.id;
  if (!String(value).trim()) return null;

  const row = {
    id: store.nextId(TABLE, 'RS-'),
    kind,
    name: String(value).trim(),
    facilityId: kind === 'Doctor' ? facilityId || null : null,
    specialty: kind === 'Doctor' ? specialty || null : null,
    address: '',
    phone: phone || '',
    usageCount: 0,
    createdAt: new Date().toISOString(),
  };
  all().push(row);
  store.commit('referralSource.create');
  audit.log({
    entity: ENTITY,
    entityId: row.id,
    action: 'Added',
    details: `${row.kind}: ${row.name}${row.facilityId ? ` at ${name(row.facilityId)}` : ''}`,
  });
  return row.id;
}

/** One more referral came through this source. Not audited — it is a counter. */
export function bump(...ids) {
  let moved = 0;
  for (const id of ids) {
    const row = get(id);
    if (!row) continue;
    row.usageCount = (row.usageCount || 0) + 1;
    moved += 1;
  }
  if (moved) store.commit('referralSource.usage');
  return moved;
}

const normalize = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
