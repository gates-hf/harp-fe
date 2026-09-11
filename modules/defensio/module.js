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
// A41 — denial analytics & payer scorecard: read-only over every register
// above; the one entity it owns is the scorecard archive, seeded on its
// first read. Neither entry carries a badge — a report is not work.
// A40 — prevention & risk: loading the pattern register runs the engine's
// first pass over the denials and seeds behind them; loading the risk-rule
// register is what pushes the "Denial Risk (Defensio)" category onto the
// claim scrubber and the outcome hook onto the remittances, before any claim
// is scrubbed. The badges: patterns nobody has acknowledged (new, or back
// after fading), and rules waiting on a decision (flagged for retirement, or
// proposed for suspension because their pattern faded).
import * as denialPatterns from '../../data/repositories/denial-patterns.js';
import * as preventionPlans from '../../data/repositories/prevention-plans.js';
import * as riskRules from '../../data/repositories/risk-rules.js';
// A42 — TPA fee accounting: loading the amendment register loads the whole
// chain (accruals, schedules, disputes) and runs each seed behind the last,
// so the ledger is whole before any screen reads it; the badge is what the
// desk still has to act on — overcharges nobody has disputed and fees no
// schedule version covers.
import * as tpaFeeAccruals from '../../data/repositories/tpa-fee-accruals.js';
import '../../data/repositories/tpa-amendments.js';
import { current as currentRole } from '../../shared/roles.js';

export default {
  id: 'defensio',
  name: 'Defensio',
  group: 'Revenue cycle',
  icon: 'shield',

  nav: [
    // --- A36: nav entries ---
    {
      // A43 — the landing screen: the module's dashboard (F0), first in the
      // nav so the shell's bare-module redirect lands on it. No badge — the
      // entries under it each carry their own.
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
    // --- A40: nav entries ---
    {
      // F5 — the prevention dashboard: the badge is the patterns nobody has
      // acknowledged. Reading the plan register here is what seeds it at boot,
      // so a pattern a plan targets reads Under plan before any screen asks.
      screen: 'prevention',
      label: 'Prevention',
      icon: 'insights',
      count: () => (preventionPlans.all(), denialPatterns.counts().attention),
    },
    {
      // F5 — the risk rules: the badge is the rules waiting on a decision (a retirement flag, a suspension proposed).
      screen: 'prevention/rules',
      label: 'Risk rules',
      icon: 'rule',
      count: () => riskRules.counts().flagged + riskRules.counts().proposed,
    },
    // --- A41: nav entries ---
    {
      // F6 — the six analytics views over every register; nothing to count.
      screen: 'analytics',
      label: 'Analytics',
      icon: 'query_stats',
    },
    {
      // F6 — the payer scorecard: generate, save as an immutable snapshot, archive.
      screen: 'scorecard',
      label: 'Scorecard',
      icon: 'scoreboard',
    },
    // --- A42: nav entries ---
    {
      // F7 — the TPA ledger: the badge is the open overcharges nobody has disputed plus the unscheduled fees.
      screen: 'tpa',
      label: 'TPA ledger',
      icon: 'account_balance_wallet',
      count: () => tpaFeeAccruals.counts().attention,
    },
  ],

  routes: {
    // --- A36: routes ---
    // #/defensio and #/defensio/home: the dashboard (A43); the shell
    // redirects a bare module path to the first nav screen.
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
    // --- A40: routes ---
    // #/defensio/prevention is the dashboard; it hands the mount over to the
    // plan page at /prevention/plans/new and /prevention/plans/<plan id>
    // (a tab id after it) and to the rules screen at /prevention/rules.
    prevention: () => import('./features/prevention/prevention-dashboard.js'),
    // --- A41: routes ---
    // #/defensio/analytics is the analytics screen; a view id after it
    // (/overview|reasons|breakdowns|funnel|governance|misclassification)
    // opens that sub-tab.
    analytics: () => import('./features/analytics/denial-analytics.js'),
    // #/defensio/scorecard is the generate form; it hands the mount over to
    // the archive at /scorecard/archive and to the frozen print view at
    // /scorecard/<scorecard no>.
    scorecard: () => import('./features/analytics/payer-scorecard.js'),
    // --- A42: routes ---
    // #/defensio/tpa is the ledger (a tab id after it: accruals | schedules |
    // disputes; an accrual id after /accruals opens its drawer); it hands the
    // mount over to the amendment archive at /tpa/amendments and the flow at
    // /tpa/amendments/new and /tpa/amendments/<amendment id>.
    tpa: () => import('./features/tpa/tpa-ledger.js'),
  },
};
