// Module manifest — Pactum, payer and contract management.
// Owns the `payers`, `cdm` and `contracts` entities (data/repositories/); other
// modules read them through those repositories and reference their ids.

import * as payers from '../../data/repositories/payers.js';
import * as cdm from '../../data/repositories/cdm.js';
import * as contracts from '../../data/repositories/contracts.js';

export default {
  id: 'pactum',
  name: 'Pactum',
  group: 'Revenue cycle',
  icon: 'handshake',

  nav: [
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
      count: () => cdm.counts().items,
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
  ],

  // One screen, two routes: #/pactum/payers is the list and
  // #/pactum/payers/import is the 4-step importer. The list feature hands off
  // when the deep link carries /import, so the manifest stays one entry.
  routes: {
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
  },
};
