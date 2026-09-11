// Engine — denial patterns (amendment 40, Defensio F5). A leaf: it imports
// nothing from data/ and works over the facts the repository hands it, so
// data/repositories/denial-patterns.js can wrap it without a cycle.
//
// A pattern is the same payer, the same cause and the same service refused
// `threshold` times inside the rolling window. The cause is one id per
// denial — the confirmed root cause of a concluded root-cause case, else the
// triage tag, else the root cause the payer's own code usually comes down to
// (the router's starting point) — so an untriaged denial counts from the
// day it lands and a triage that agrees keeps it where it was. The service
// is read at the most specific level that reaches the threshold: the charge
// line itself, then its category, then its service group, then any service.
//
// Detection is idempotent: a pattern's id is a stable hash of its
// dimensions, an existing record keeps its dimensions and is recounted on
// every pass (most specific first, so a denial counts in one pattern at
// most), and only what is left over can form a new one. Counters are live —
// the window's occurrences, the denied and recovered value inside it, the
// two half-windows the trend compares — and the status follows the count:
// New until somebody acknowledges it, Acknowledged, UnderPlan while a plan
// targets it, Faded when the window no longer holds the threshold,
// Reactivated when a faded pattern fills the window again.
//
// fact = { id, payerId, causeId, causeKind ('confirmed'|'tagged'|'code'),
//   code, origin, item: { id, chargeCode, name, category, group } | null,
//   landedAt (ISO date), denied, recovered, open, resolved, lostAppeal }

export const LEVELS = ['item', 'category', 'group', 'any'];
export const LEVEL_LABELS = { item: 'Charge line', category: 'Category', group: 'Service group', any: 'Any service' };
export const STATUSES = ['New', 'Acknowledged', 'UnderPlan', 'Faded', 'Reactivated'];
export const STATUS_LABELS = { New: 'New', Acknowledged: 'Acknowledged', UnderPlan: 'Under plan', Faded: 'Faded', Reactivated: 'Reactivated' };
/** The statuses a pattern holds while the window still carries the threshold. */
export const ACTIVE_STATUSES = ['New', 'Acknowledged', 'UnderPlan', 'Reactivated'];
export const TRENDS = ['accelerating', 'steady', 'slowing'];
export const DEFAULTS = { threshold: 3, windowDays: 90 };

/** djb2 over the dimension key — seven base-36 characters, stable across loads. */
export function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i += 1) h = (((h << 5) + h) + str.charCodeAt(i)) >>> 0;
  return h.toString(36).toUpperCase().padStart(7, '0').slice(-7);
}

export const dimsKey = (dims) => `${dims.payerId || '*'}|${dims.causeId || '*'}|${dims.service?.level || 'any'}:${dims.service?.value ?? '*'}`;
export const idFor = (dims) => `DP-${hash(dimsKey(dims))}`;

/** The service value a fact reads at a level, or null when it has none there. */
export function valueAt(fact, level) {
  if (level === 'any') return '*';
  if (!fact.item) return null;
  if (level === 'item') return fact.item.id || null;
  if (level === 'category') return fact.item.category || null;
  if (level === 'group') return fact.item.group || null;
  return null;
}

export function matches(fact, dims) {
  if (!fact || !dims) return false;
  if (dims.payerId && fact.payerId !== dims.payerId) return false;
  if (dims.causeId && fact.causeId !== dims.causeId) return false;
  const level = dims.service?.level || 'any';
  return level === 'any' || valueAt(fact, level) === dims.service.value;
}

/** Lower is more specific — the order existing records are recounted in. */
export const specificity = (dims) => Math.max(0, LEVELS.indexOf(dims?.service?.level || 'any'));

export function trendOf(firstHalf, secondHalf) {
  if (secondHalf > firstHalf) return 'accelerating';
  if (secondHalf < firstHalf) return 'slowing';
  return 'steady';
}

/**
 * The status a pattern moves to on a pass. A plan in force holds it Under
 * plan whatever the count says (the plan's measurement is what reads the
 * count); otherwise the window decides — the threshold reached keeps New,
 * Acknowledged and Reactivated as they are, brings a faded pattern back as
 * Reactivated and drops a pattern whose plan ended to whatever it was before
 * the plan; below the threshold everything fades.
 */
export function nextStatus(prev, { occurrences, threshold, planned, acknowledged }) {
  if (planned) return 'UnderPlan';
  if (occurrences >= threshold) {
    if (!prev) return 'New';
    if (prev === 'Faded') return 'Reactivated';
    if (prev === 'UnderPlan') return acknowledged ? 'Acknowledged' : 'New';
    return prev;
  }
  return 'Faded';
}

/**
 * detect({ facts, existing, planned, on, config }) → records[], one per
 * pattern (every existing record, recounted, plus the new detections), each
 * carrying the fields the repository stores. `planned` is the set of pattern
 * ids an active plan targets; `on` the day the pass runs.
 */
export function detect({ facts = [], existing = [], planned = new Set(), on, config = DEFAULTS } = {}) {
  const threshold = Number(config?.threshold) || DEFAULTS.threshold;
  const windowDays = Number(config?.windowDays) || DEFAULTS.windowDays;
  const today = on || new Date().toISOString().slice(0, 10);
  const since = daysBefore(today, windowDays);
  const mid = daysBefore(today, Math.floor(windowDays / 2));
  const inWindow = facts.filter((f) => f.landedAt && f.landedAt >= since && f.landedAt <= today);
  const taken = new Set();
  const found = [];

  // Existing records first, the most specific first, so a denial already
  // read by a charge-line pattern is not read again by its category's.
  for (const rec of [...existing].sort((a, b) => specificity(a.dims) - specificity(b.dims) || String(a.id).localeCompare(String(b.id)))) {
    const mine = inWindow.filter((f) => !taken.has(f.id) && matches(f, rec.dims));
    for (const f of mine) taken.add(f.id);
    found.push({ rec, mine });
  }

  // What is left forms new patterns: per payer and cause, at the most
  // specific service level that reaches the threshold.
  const buckets = new Map();
  for (const f of inWindow) {
    if (taken.has(f.id) || !f.payerId || !f.causeId) continue;
    const key = `${f.payerId}|${f.causeId}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(f);
  }
  for (const list of buckets.values()) {
    let rest = list;
    for (const level of LEVELS) {
      const groups = new Map();
      for (const f of rest) {
        const v = valueAt(f, level);
        if (v == null) continue;
        if (!groups.has(v)) groups.set(v, []);
        groups.get(v).push(f);
      }
      for (const [value, mine] of groups) {
        if (mine.length < threshold) continue;
        const first = mine[0];
        const dims = { payerId: first.payerId, causeId: first.causeId, service: { level, value } };
        for (const f of mine) taken.add(f.id);
        found.push({ rec: { id: idFor(dims), dims, status: null, origin: first.origin || null }, mine });
      }
      rest = rest.filter((f) => !taken.has(f.id));
      if (!rest.length) break;
    }
  }

  return found.map(({ rec, mine }) => {
    const lifetime = facts.filter((f) => matches(f, rec.dims)).sort((a, b) => String(a.landedAt).localeCompare(String(b.landedAt)));
    const firstHalf = mine.filter((f) => f.landedAt < mid).length;
    const secondHalf = mine.length - firstHalf;
    const occurrences = mine.length;
    const status = nextStatus(rec.status, { occurrences, threshold, planned: planned.has(rec.id), acknowledged: Boolean(rec.acknowledged) });
    const codes = {};
    for (const f of mine) if (f.code) codes[f.code] = (codes[f.code] || 0) + 1;
    const kinds = {};
    for (const f of mine) kinds[f.causeKind || 'code'] = (kinds[f.causeKind || 'code'] || 0) + 1;
    return {
      ...rec,
      origin: rec.origin || mine[0]?.origin || lifetime[0]?.origin || null,
      status,
      previousStatus: rec.status || null,
      counters: {
        occurrences,
        lifetime: lifetime.length,
        deniedValue: cents(mine.reduce((n, f) => n + (Number(f.denied) || 0), 0)),
        recoveredValue: cents(mine.reduce((n, f) => n + (Number(f.recovered) || 0), 0)),
        openValue: cents(mine.reduce((n, f) => n + (Number(f.open) || 0), 0)),
        lifetimeValue: cents(lifetime.reduce((n, f) => n + (Number(f.denied) || 0), 0)),
        resolved: mine.filter((f) => f.resolved).length,
        lostAppeals: mine.filter((f) => f.lostAppeal).length,
        firstHalf,
        secondHalf,
        trend: trendOf(firstHalf, secondHalf),
        codes,
        causeKinds: kinds,
      },
      denialIds: lifetime.map((f) => f.id),
      windowDenialIds: mine.map((f) => f.id),
      firstSeenAt: lifetime[0]?.landedAt || rec.firstSeenAt || null,
      lastSeenAt: lifetime[lifetime.length - 1]?.landedAt || rec.lastSeenAt || null,
      window: { since, mid, until: today, days: windowDays, threshold },
    };
  });
}

/** Whole days between two ISO dates (b − a). */
export const daysBetween = (a, b) => Math.round((Date.parse(String(b).slice(0, 10)) - Date.parse(String(a).slice(0, 10))) / 86400000);

export function daysBefore(isoDate, n) {
  const d = new Date(`${String(isoDate || '').slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;
