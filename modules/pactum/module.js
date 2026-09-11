// Module manifest — Pactum, payer and contract management.
// Owns the `payers`, `cdm` and `contracts` entities (data/repositories/); other
// modules read them through those repositories and reference their ids.
//
// It also holds `handoffs` for now: Performance needs it and no module owns it
// yet — Defensio takes it. `claims` belongs to Claima since amendment 24;
// Performance keeps reading it through the repository, which stayed in data/.
//
// Since amendment 44 it also owns the standard code systems — `codeSystems`,
// `codeSystemVersions` and `standardCodes` — the reference-data root every
// other module looks a code up in through `lookupCodes()` in
// data/repositories/standard-codes.js (Claima's coding catalogues read there).

import * as payers from '../../data/repositories/payers.js';
import * as cdm from '../../data/repositories/cdm.js';
import * as contracts from '../../data/repositories/contracts.js';
import * as claims from '../../data/repositories/claims.js';
import * as codeSystems from '../../data/repositories/code-systems.js';

export default {
  id: 'pactum',
  name: 'Pactum',
  group: 'Revenue cycle',
  icon: 'handshake',

  nav: [
    {
      // The module's landing screen: every number on it is read live from the
      // repositories below, so it counts nothing of its own.
      screen: 'home',
      label: 'Home',
      icon: 'dashboard',
    },
    {
      screen: 'payers',
      label: 'Payer Master',
      icon: 'account_balance',
      count: () => payers.counts().total,
    },
    {
      screen: 'cdm',
      label: 'CDM',
      icon: 'sell',
      // The CDM screen lists items and bundles together, so the badge counts
      // what that list holds; Bundles below counts its own subset.
      count: () => cdm.counts().total,
    },
    {
      // A nav entry may point deeper than one screen segment: bundles are a
      // view of the CDM screen, at #/pactum/cdm/bundles.
      screen: 'cdm/bundles',
      label: 'Bundles',
      icon: 'inventory_2',
      count: () => cdm.counts().bundles,
    },
    {
      screen: 'contracts',
      label: 'Contracts',
      icon: 'contract',
      count: () => contracts.counts().active,
    },
    {
      // The evaluation engine's screen: it reads contracts and prices a claim,
      // so it counts nothing of its own.
      screen: 'billing-simulator',
      label: 'Billing Simulator',
      icon: 'calculate',
    },
    {
      // Read-only analytics over the claims dataset. The badge counts the
      // payers the screen reports on, which is the row count of its table.
      screen: 'performance',
      label: 'Performance',
      icon: 'monitoring',
      count: () => claims.counts().payers,
    },
    {
      // Standard code systems (A44): the badge counts the systems the landing
      // lists, the way Payer Master's counts its payers.
      screen: 'standard-codes',
      label: 'Standard Codes',
      icon: 'menu_book',
      count: () => codeSystems.counts().total,
    },
  ],

  // One screen, two routes: #/pactum/payers is the list and
  // #/pactum/payers/import is the 4-step importer. The list feature hands off
  // when the deep link carries /import, so the manifest stays one entry.
  routes: {
    // #/pactum and #/pactum/home are the dashboard; #/pactum/activity is the
    // full audit list its Recent activity panel links to.
    home: () => import('./features/home/home.js'),
    activity: () => import('./features/home/activity-list.js'),
    payers: () => import('./features/payer-master/payer-list.js'),
    // One screen, four routes: the list at #/pactum/cdm hands off to the
    // importer, the bundles list and the bundle builder on its deeper paths.
    cdm: () => import('./features/cdm/cdm-list.js'),
    // #/pactum/contracts is every active contract; the list hands off to the
    // contract page at #/pactum/contracts/<id>. One payer's contracts live
    // under the payer screen, at #/pactum/payers/<id>/contracts.
    contracts: () => import('./features/contracts/contracts-global.js'),
    // #/pactum/billing-simulator, and /<contract id> to open pre-filled with
    // that contract's payer and plan.
    'billing-simulator': () => import('./features/billing-eval/simulator.js'),
    // #/pactum/performance is the payer table; the screen hands off to the
    // contract page at #/pactum/performance/contracts/<contract id>.
    performance: () => import('./features/performance/payer-performance.js'),
    // #/pactum/standard-codes is the landing; it hands off to the system page
    // at /<id> (+ a tab id, ?version=) and to the importer at /<id>/import.
    'standard-codes': () => import('./features/standard-codes/standard-codes.js'),
  },
};
