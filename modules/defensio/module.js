// Module manifest — Defensio, denial management.
// Owns the `denials` entity (data/repositories/denials.js, its seed, the
// router engine and the root-cause catalogue) from amendment 36 on — taken
// over from Claima, which keeps posting denials as it posts remittances and
// hands everything after to this module: intake, triage, routing,
// resolution. Owns the two stubs that later amendments fill: `appealCases`
// (data/repositories/appeal-cases.js, A38) and `tpaFeeAccruals`
// (data/repositories/tpa-fee-accruals.js, A42). The repositories and seeds
// stay in data/ and do not move.
//
// Defensio is built by parallel sessions from amendment 37 on, under
// modules/defensio/COORDINATION.md. Each adds its nav entry and its routes
// inside the block marked with its TAG below and touches nothing else here.
// The design system names no module colour, so a module is its icon and its
// group, the way the other three are.

// Loading the repository registers the appeal-window resolver on the router
// and subscribes the register to the remittance hooks, before any screen
// renders. The badge is what nobody has triaged.
import * as denials from '../../data/repositories/denials.js';
// The resolution engine asserts the ledger identity once the peers settle
// (`ready`) — imported for that side effect as much as for the panel.
import '../../data/engines/denial-resolution.js';

export default {
  id: 'defensio',
  name: 'Defensio',
  group: 'Revenue cycle',
  icon: 'shield',

  nav: [
    // --- A36: nav entries ---
    {
      // The landing screen; F0 (the dashboard) replaces the placeholder last.
      screen: 'home',
      label: 'Home',
      icon: 'dashboard',
    },
    {
      // F1 — the intake worklist: the badge is what nobody has looked at yet.
      screen: 'denials',
      label: 'Denials',
      icon: 'report',
      count: () => denials.counts().untriaged,
    },
  ],

  routes: {
    // --- A36: routes ---
    // #/defensio and #/defensio/home: the shell redirects a bare module path
    // to the first nav screen.
    home: () => import('./features/home/home.js'),
    // #/defensio/denials is the worklist; it hands the mount over to the
    // denial page at /denials/<denial id>, with a tab id after it.
    denials: () => import('./features/denials/denials-worklist.js'),
  },
};
