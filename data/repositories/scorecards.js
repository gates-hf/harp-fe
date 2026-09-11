// Repository — payer scorecards. Owner: modules/defensio (amendment 41, F6
// — denial analytics & payer scorecard). A scorecard is an immutable
// snapshot: the figures data/engines/denial-analytics.js computed for one
// payer over one period, frozen with the notes the desk wrote at
// generation, numbered in sequence and versioned — generating the same
// payer and period again is a new version and both stay listed. The
// register never recomputes anything: what a row holds is what was read the
// day it was made, and the archive renders it from the row alone. This file
// imports no engine, which is what keeps that true by construction.
//
// Row: { id ('SC-0001'), scorecardNo ('SC-2026-0001'), payerId, period
// { key, kind, label, from, to }, compare (bool), figures (frozen — the
// engine's scorecard() shape), notes, generatedBy, generatedAt, version,
// seedTag }. Audit entity `scorecards`, entityId = the id. Seeded on first
// read from data/seed/scorecards.js; nothing in data/store.js.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as payers from './payers.js';
import { SCORECARDS } from '../seed/scorecards.js';
import { current as currentRole } from '../../shared/roles.js';
import { compareDates, iso } from '../../shared/format.js';

const TABLE = 'scorecards';
const ENTITY = 'scorecards';

let ready = false;
export function all() {
  const rows = store.table(TABLE);
  if (!ready || !rows.length) {
    if (!rows.length) for (const row of SCORECARDS) rows.push(structuredClone(row));
    ready = true;
  }
  return rows;
}
store.subscribe((reason) => { if (reason === 'reset') ready = false; });

export const get = (ref) => all().find((s) => s.id === ref || s.scorecardNo === ref) || null;
export const byPayer = (payerId) => all().filter((s) => s.payerId === payerId).sort(byAt);
export const history = (id) => audit.forEntity(ENTITY, id);
export const payerName = (row) => payers.get(row?.payerId)?.nameEn || row?.payerId || '—';

/** Every version generated for one payer over exactly this period, oldest first. */
export const versionsOf = (payerId, period) =>
  all().filter((s) => s.payerId === payerId && s.period?.from === period?.from && s.period?.to === period?.to).sort((a, b) => a.version - b.version);

/** The next number in the year's sequence, read off the table itself so a reset reproduces it. */
export function nextNo(year = new Date().getFullYear()) {
  const prefix = `SC-${year}-`;
  const max = all().reduce((n, s) => (String(s.scorecardNo).startsWith(prefix) ? Math.max(n, Number(String(s.scorecardNo).slice(prefix.length)) || 0) : n), 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

/** search(q, { payerId, from, to }) → rows, newest first; `q` matches the number, the payer and the period label. */
export function search(q = '', { payerId = '', from = '', to = '' } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  return all()
    .filter((s) => {
      if (payerId && s.payerId !== payerId) return false;
      if (from && compareDates(iso(s.generatedAt), from) < 0) return false;
      if (to && compareDates(iso(s.generatedAt), to) > 0) return false;
      if (!needle) return true;
      return [s.scorecardNo, s.id, payerName(s), s.period?.label, s.notes].some((v) => String(v || '').toLowerCase().includes(needle));
    })
    .sort((a, b) => byAt(b, a));
}

export const counts = () => {
  const rows = all();
  const month = new Date().toISOString().slice(0, 7);
  return { total: rows.length, payers: new Set(rows.map((s) => s.payerId)).size, thisMonth: rows.filter((s) => String(s.generatedAt).slice(0, 7) === month).length, versions: rows.filter((s) => s.version > 1).length };
};

/**
 * create({ payerId, period, compare, figures, notes }, { at, by, commit })
 * → the row or { error }. The figures arrive computed and are stored as
 * they are; the version is one more than the versions already held for
 * this payer and period.
 */
export function create({ payerId, period, compare = true, figures, notes = '' } = {}, { at = null, by = null, commit = true } = {}) {
  if (!payers.get(payerId)) return { error: 'Pick a payer' };
  if (!period?.from || !period?.to) return { error: 'Pick a period' };
  if (!figures || !Array.isArray(figures.headline)) return { error: 'Generate the scorecard before saving it' };
  const when = at || new Date().toISOString();
  const who = by || currentRole().name;
  const version = versionsOf(payerId, period).length + 1;
  const row = {
    id: store.nextId(TABLE, 'SC-'),
    scorecardNo: nextNo(Number(String(iso(when)).slice(0, 4))),
    payerId,
    period: { key: period.key || 'custom', kind: period.kind || 'custom', label: period.label || `${period.from} → ${period.to}`, from: period.from, to: period.to },
    compare: Boolean(compare),
    figures: structuredClone(figures),
    notes: String(notes || '').trim(),
    generatedBy: who,
    generatedAt: when,
    version,
    seedTag: null,
  };
  all().push(row);
  audit.all().push({
    id: store.nextId('audit', 'AU-'), entity: ENTITY, entityId: row.id, action: 'Generated',
    details: `${row.scorecardNo} · ${payerName(row)} · ${row.period.label} · v${version}${row.notes ? ` — ${row.notes.slice(0, 120)}` : ''}`, user: who, at: when,
  });
  if (commit) store.commit('scorecards.create');
  return row;
}

const byAt = (a, b) => String(a.generatedAt).localeCompare(String(b.generatedAt)) || a.id.localeCompare(b.id);
