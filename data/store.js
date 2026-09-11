// In-memory demo store, persisted to sessionStorage so a reload keeps the
// demo's state and a new tab starts clean. Modules never touch this file —
// they go through data/repositories/*.

import { patients } from './seed/patients.js';
import { payers } from './seed/payers.js';
import { audit } from './seed/audit.js';
import { cdm } from './seed/cdm.js';
import { contracts } from './seed/contracts.js';
import { duplicates } from './seed/duplicates.js';
import { policies } from './seed/policies.js';
import { referralSources } from './seed/referral-sources.js';
import { claimAttachments } from './seed/claim-attachments.js'; // A27
import { codeSystems } from './seed/code-systems.js'; // A44
import { codeSystemVersions } from './seed/code-system-versions.js'; // A44
import { standardCodes } from './seed/standard-codes.js'; // A44

const KEY = 'harp.demo.v1';

// One entry per entity. Adding an entity: add its seed file, register it here,
// and give it a repository.
const SEEDS = {
  patients, payers, audit, cdm, contracts, duplicates, policies, referralSources, claimAttachments,
  codeSystems, codeSystemVersions, standardCodes,
};

const subscribers = new Set();
let state = load();
let resetting = false;
// A batch in progress (see store.batch): the reasons committed inside it, in
// first-seen order, announced once each when it ends; null when none is open.
let held = null;

function fresh() {
  return structuredClone(SEEDS);
}

function load() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // A seed added after this tab's snapshot was written still needs a table.
      for (const name of Object.keys(SEEDS)) {
        if (!parsed[name]) parsed[name] = structuredClone(SEEDS[name]);
      }
      return parsed;
    }
  } catch {
    /* private mode or corrupt snapshot — fall through to the seed */
  }
  return fresh();
}

export const store = {
  /** The live array for an entity. Repositories read and mutate it, then commit. */
  table(name) {
    if (!state[name]) state[name] = [];
    return state[name];
  },

  /** Persist and notify. `reason` is free text used for logging and toasts. */
  commit(reason = 'change') {
    if (held) { held.add(reason); return; }
    try {
      sessionStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* over quota or private mode — the in-memory state is still correct */
    }
    for (const fn of subscribers) fn(reason);
  },

  /**
   * Run fn with notifications held (A36): every commit inside it is
   * recorded and nobody is told until fn returns, when each distinct reason
   * is committed once, in the order it was first seen. A seed that drives a
   * register's own writes is one change, not fifty — and a subscriber that
   * reads the register halfway through (a badge, another register's seed)
   * would otherwise read it half built. A batch inside a batch just runs.
   */
  batch(fn) {
    if (held) return fn();
    held = new Set();
    let out;
    try {
      out = fn();
    } finally {
      const reasons = [...held];
      held = null;
      for (const reason of reasons) this.commit(reason);
    }
    return out;
  },

  /** Returns an unsubscribe function. */
  subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  },

  /**
   * Back to the seed. Runs once — a subscriber that reads a derived table
   * during the reset rebuilds it from the empty state, and one that called
   * back in here would start over — and then notifies every subscriber
   * exactly once with 'reset'.
   */
  resetToSeed() {
    if (resetting) return;
    resetting = true;
    try {
      state = fresh();
      this.commit('reset');
    } finally {
      resetting = false;
    }
  },

  /** Next sequential id for an entity, e.g. nextId('patients', 'PT-') -> 'PT-0041'. */
  nextId(name, prefix) {
    const rows = this.table(name);
    const max = rows.reduce((n, row) => {
      const digits = Number(String(row.id).replace(prefix, ''));
      return Number.isFinite(digits) && digits > n ? digits : n;
    }, 0);
    return prefix + String(max + 1).padStart(4, '0');
  },
};
