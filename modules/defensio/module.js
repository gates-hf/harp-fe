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
// A38 — the appeal register: the badge is what the signed-in role still owes
// a case (a review waiting on their signature, a draft inside the warning
// window or past its deadline).
import * as appealCases from '../../data/repositories/appeal-cases.js';
// A39 — appeal tracking: loading the repository registers the response-window
// resolver, the posting-hook match (through expected-recoveries.js) and the
// ledger self-check; the badge is what the desk has to chase — payers past
// their response window and conceded money aging unpaid. tabs.js is the
// module's tab registry, loaded here so a registration is in place before
// any case view reads it.
import * as appealTracking from '../../data/repositories/appeal-tracking.js';
import './tabs.js';
// A37 — root cause & accountability: loading the repository seeds the cases
// behind the denials and runs the trigger engine once on load; the badge is
// the open cases past their target, and the register's is the accountability
// cases open — for the roles that read it.
import * as rcaCases from '../../data/repositories/rca-cases.js';
import * as accountabilityCases from '../../data/repositories/accountability-cases.js';
import { current as currentRole } from '../../shared/roles.js';

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
    // --- A38: nav entries ---
    {
      // F3 — the appeals workbench: every case, deadline first.
      screen: 'appeals',
      label: 'Appeals',
      icon: 'gavel',
      count: () => appealCases.counts().needsAttention,
    },
    // --- A39: nav entries ---
    {
      // F4 — appeal tracking: the badge is the overdue answers and the aging recoveries.
      screen: 'appeal-tracking',
      label: 'Appeal tracking',
      icon: 'track_changes',
      count: () => { const f = appealTracking.getF4HomeFlags(); return f.overdue.length + f.aging.length; },
    },
    // --- A37: nav entries ---
    {
      // F2 — root-cause cases: the badge is the open cases past their target.
      screen: 'rca',
      label: 'Root cause',
      icon: 'troubleshoot',
      count: () => rcaCases.counts().overdue,
    },
    {
      // F2 — the accountability register, authorised roles only: the badge is the open cases, for those roles alone.
      screen: 'accountability',
      label: 'Accountability',
      icon: 'gavel',
      count: () => (accountabilityCases.canRead(currentRole()) ? accountabilityCases.counts().open : 0),
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
    // --- A38: routes ---
    // #/defensio/appeals is the workbench; it hands the mount over to the case
    // page at /appeals/<case id> (a tab id after it) and to the printable
    // package at /appeals/<case id>/package.
    appeals: () => import('./features/appeals/appeals-workbench.js'),
    // --- A39: routes ---
    // #/defensio/appeal-tracking is the worklist; it hands the mount over to
    // the case host at /appeal-tracking/<case id>, which draws the Tracking &
    // outcome tab tabs.js also registers for the case page above.
    'appeal-tracking': () => import('./features/appeal-tracking/appeal-tracking.js'),
    // --- A37: routes ---
    // #/defensio/rca is the root-cause worklist; it hands the mount over to
    // the case page at /rca/<case id>, with a tab id after it.
    rca: () => import('./features/rca/rca-worklist.js'),
    // #/defensio/accountability is the register (authorised roles only); it
    // hands the mount over to the case page at /accountability/<case id>.
    accountability: () => import('./features/rca/accountability-register.js'),
  },
};
