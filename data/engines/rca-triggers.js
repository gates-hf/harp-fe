// Engine — root-cause triggers (amendment 37, Defensio F2). The one place
// the rule that opens a root-cause case lives: a denial worth the amount
// threshold, the same cause repeating inside the window, an appeal the
// hospital lost. Pure over what the repository hands it — the denials, the
// cases already open, the lost appeals the appeal-tracking register publishes
// — and reads nothing from data/ itself, which is what lets
// data/repositories/rca-cases.js import it (a repository imports only a leaf
// engine). It decides; the repository writes.
//
// Idempotent by construction: a denial that sits in any case, whatever its
// status, is covered and never re-cased, and a repeat cluster that already
// has an open case is extended rather than doubled. Evaluate it on every
// load and after every denial and the register converges on the same set.

export const TRIGGERS = ['amount', 'repeat', 'appealLost', 'manual'];

export const TRIGGER_LABELS = {
  amount: 'Amount',
  repeat: 'Repeat',
  appealLost: 'Appeal lost',
  manual: 'Manual',
};

export const triggerLabel = (kind) => TRIGGER_LABELS[kind] || kind || '—';

/** The default rule, overridden by CONFIG.defensio.rca.triggers. */
export const DEFAULTS = { amountThreshold: 500, repeat: { count: 3, windowDays: 90 } };

/**
 * The key a repeat cluster is built on: the cause and where it originated.
 * `cause` is the confirmed root cause of a concluded case covering the denial
 * when there is one, else the tag the triage gave it; `origin` is the group
 * the cause belongs to — the stage of the revenue cycle the failure came
 * from, which is what the prevention feed already calls a denial's origin —
 * so a cause retagged at conclusion moves its denials between clusters.
 */
export const clusterKey = (causeId, origin) => (causeId ? `${causeId}|${origin || ''}` : '');

/**
 * evaluate({ denials, cases, lostAppeals, causeOf, originOf, on, config })
 * → { create: [{ trigger, denialIds, detail, key }], extend: [{ caseId, denialIds, detail }] }
 *
 * `denials` are the register's rows (withdrawn ones excluded by the caller),
 * `cases` the root-cause cases on file, `lostAppeals` what the appeal
 * register publishes ([{ appealCaseId, denialIds, outcome, decidedAt }] —
 * empty when it is not on disk), `causeOf(denial)` the confirmed-or-tagged
 * cause id, `originOf(causeId)` the group it belongs to, `labelOf(causeId)`
 * its label for the case's own line. Amount first, then lost appeals, then
 * repeats: a denial worth the threshold or lost on appeal opens its own case
 * even when it also belongs to a cluster, since each is the stronger reason
 * and the cluster reads what is left.
 */
export function evaluate({ denials = [], cases = [], lostAppeals = [], causeOf, originOf, labelOf = null, on = null, config = DEFAULTS } = {}) {
  const create = [];
  const extend = [];
  const covered = new Set();
  for (const c of cases) for (const id of c.denialIds || []) covered.add(id);
  const isCovered = (id) => covered.has(id);
  const cover = (ids) => { for (const id of ids) covered.add(id); };
  const today = on || new Date().toISOString().slice(0, 10);

  // 1. Amount: one case per denial worth the threshold or more.
  const threshold = Number(config?.amountThreshold ?? DEFAULTS.amountThreshold);
  for (const d of denials) {
    if (isCovered(d.id)) continue;
    if (d.status === 'Reclassified') continue; // never a denial
    if ((d.amounts?.denied || 0) >= threshold) {
      create.push({ trigger: 'amount', denialIds: [d.id], key: `amount|${d.id}`, detail: `${d.id} denied ${money(d.amounts.denied)} — at or above the ${money(threshold)} threshold` });
      cover([d.id]);
    }
  }

  // 2. Lost appeals: one case per appeal case the hospital lost, over the denials it carried.
  for (const a of lostAppeals) {
    if (!a?.appealCaseId) continue;
    if (cases.some((c) => c.trigger === 'appealLost' && c.triggerRef === a.appealCaseId)) continue;
    const ids = (a.denialIds || []).filter((id) => !isCovered(id));
    if (!ids.length) continue;
    create.push({
      trigger: 'appealLost', denialIds: ids, key: `appeal|${a.appealCaseId}`, triggerRef: a.appealCaseId,
      detail: `${a.appealCaseId} ${String(a.outcome || 'lost').toLowerCase()}${a.decidedAt ? ` on ${String(a.decidedAt).slice(0, 10)}` : ''}`,
    });
    cover(ids);
  }


  // 3. Repeat: the same cause from the same origin, `count` times inside the window, clustered into one case.
  const need = Number(config?.repeat?.count ?? DEFAULTS.repeat.count);
  const windowDays = Number(config?.repeat?.windowDays ?? DEFAULTS.repeat.windowDays);
  const since = daysBefore(today, windowDays);
  const clusters = new Map();
  for (const d of denials) {
    if (d.status === 'Reclassified') continue;
    const cause = causeOf ? causeOf(d) : d.rootCauseId;
    if (!cause) continue;
    const landed = String(d.createdAt || '').slice(0, 10);
    if (!landed || landed < since) continue;
    const key = clusterKey(cause, originOf ? originOf(cause) : '');
    if (!clusters.has(key)) clusters.set(key, { key, cause, origin: originOf ? originOf(cause) : '', all: [], fresh: [] });
    const cl = clusters.get(key);
    cl.all.push(d.id);
    if (!isCovered(d.id)) cl.fresh.push(d.id);
  }
  for (const cl of clusters.values()) {
    if (!cl.fresh.length) continue;
    const open = cases.find((c) => c.trigger === 'repeat' && c.clusterKey === cl.key && (c.status === 'Open' || c.status === 'InAnalysis'));
    if (open) {
      extend.push({ caseId: open.id, denialIds: cl.fresh, detail: `${cl.fresh.join(', ')} — same cause inside the ${windowDays}-day window` });
      cover(cl.fresh);
      continue;
    }
    if (cl.all.length >= need && cl.fresh.length >= need) {
      create.push({
        trigger: 'repeat', denialIds: [...cl.fresh], key: cl.key,
        detail: `${labelOf ? labelOf(cl.cause) : cl.cause} (${cl.origin || 'same origin'}) ${cl.fresh.length} times in ${windowDays} days — at or above ${need}`,
      });
      cover(cl.fresh);
    }
  }

  return { create, extend };
}

/** Whole days from `openedAt` to the target, and whether the target has passed on `on`. */
export function targetOf(openedAt, targetDays, on = null) {
  const opened = String(openedAt || '').slice(0, 10);
  const due = daysAfter(opened, Number(targetDays) || 0);
  const today = on || new Date().toISOString().slice(0, 10);
  const daysLeft = Math.round((Date.parse(due) - Date.parse(today)) / 86400000);
  return { due, daysLeft, passed: daysLeft < 0 };
}

const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function daysAfter(isoDate, n) {
  const d = new Date(`${String(isoDate || '').slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const daysBefore = (isoDate, n) => daysAfter(isoDate, -n);
