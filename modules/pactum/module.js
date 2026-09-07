// Module manifest — Pactum, payer and contract management.
// Owns the `payers` entity (data/repositories/payers.js); other modules read
// payers through that repository and reference payer ids.

import * as payers from '../../data/repositories/payers.js';

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
  ],

  // One screen, two routes: #/pactum/payers is the list and
  // #/pactum/payers/import is the 4-step importer. The list feature hands off
  // when the deep link carries /import, so the manifest stays one entry.
  routes: {
    payers: () => import('./features/payer-master/payer-list.js'),
  },
};
