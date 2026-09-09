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

const KEY = 'harp.demo.v1';

// One entry per entity. Adding an entity: add its seed file, register it here,
// and give it a repository.
const SEEDS = { patients, payers, audit, cdm, contracts, duplicates, policies };

const subscribers = new Set();
let state = load();

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
    try {
      sessionStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* over quota or private mode — the in-memory state is still correct */
    }
    for (const fn of subscribers) fn(reason);
  },

  /** Returns an unsubscribe function. */
  subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  },

  resetToSeed() {
    state = fresh();
    this.commit('reset');
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
