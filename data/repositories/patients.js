// Repository — patients. The only way any module reads or writes this entity.
// Owner: the module that seeds it; every other module references patient ids.

import { store } from '../store.js';

const TABLE = 'patients';

export const STATUSES = [
  { id: 'inpatient', label: 'Inpatient', tone: 'accent' },
  { id: 'emergency', label: 'Emergency', tone: 'critical' },
  { id: 'outpatient', label: 'Outpatient', tone: '' },
  { id: 'discharged', label: 'Discharged', tone: 'success' },
];

export function statusOf(id) {
  return STATUSES.find((s) => s.id === id) || { id, label: id, tone: '' };
}

export function all() {
  return store.table(TABLE);
}

export function get(id) {
  return all().find((p) => p.id === id) || null;
}

export function cities() {
  return [...new Set(all().map((p) => p.city))].sort();
}

export function insurers() {
  return [...new Set(all().map((p) => p.insurer))].sort();
}

/** list({ q, status, city, sort, dir }) — filtered and sorted copy. */
export function list({ q = '', status = '', city = '', sort = 'name', dir = 'asc' } = {}) {
  const needle = q.trim().toLowerCase();
  const rows = all().filter((p) => {
    if (status && p.status !== status) return false;
    if (city && p.city !== city) return false;
    if (!needle) return true;
    return (
      p.name.toLowerCase().includes(needle) ||
      p.mrn.includes(needle) ||
      p.phone.replace(/\s/g, '').includes(needle.replace(/\s/g, '')) ||
      p.insurer.toLowerCase().includes(needle)
    );
  });
  const sign = dir === 'desc' ? -1 : 1;
  return rows.sort((a, b) => {
    const x = a[sort];
    const y = b[sort];
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * sign;
    return String(x ?? '').localeCompare(String(y ?? '')) * sign;
  });
}

export function counts() {
  const rows = all();
  return {
    total: rows.length,
    inpatient: rows.filter((p) => p.status === 'inpatient').length,
    emergency: rows.filter((p) => p.status === 'emergency').length,
    outstandingUsd: rows.reduce((sum, p) => sum + p.balanceUsd, 0),
  };
}

export function create(data) {
  const row = {
    id: store.nextId(TABLE, 'PT-'),
    mrn: String(Math.floor(38500 + Math.random() * 1400)).padStart(6, '0'),
    balanceUsd: 0,
    admittedOn: null,
    lastVisit: new Date().toISOString().slice(0, 10),
    ...data,
  };
  all().push(row);
  store.commit('patient.create');
  return row;
}

export function update(id, patch) {
  const row = get(id);
  if (!row) return null;
  Object.assign(row, patch);
  store.commit('patient.update');
  return row;
}

export function discharge(id) {
  return update(id, { status: 'discharged', lastVisit: new Date().toISOString().slice(0, 10) });
}
