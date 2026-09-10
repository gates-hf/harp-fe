// Module manifest — Claima, claims management.
// Owns the `claims` entity (data/repositories/claims.js): the claim a visit's
// charges become, from draft to the payer's answer. Pactum's Performance keeps
// reading it through the repository — the file and the seed stay in data/ and
// do not move.
//
// Claima is built by three parallel sessions, one feature each, under
// modules/claima/COORDINATION.md. Each adds its nav entry and its routes inside
// the block marked with its TAG below and touches nothing else in this file.

// Imported for its side effect as much as its API: loading the repository
// registers the merge re-link hook that moves a merged record's claims to the
// survivor, before any screen renders.
import * as claims from '../../data/repositories/claims.js';
// A25 — the capture register: the Charges badge counts the visits still holding
// unreleased lines. Loading it also registers the feed and hook arrays A26 and
// A27 subscribe to.
import * as charges from '../../data/repositories/charges.js';
// A26 — the coding register: the Coding badge counts the charts past their
// SLA. Loading it registers afterCodedHooks / afterRecodeHooks for A27.
// Claima owns `coding` and `cdiQueries` (data/repositories/coding.js),
// `clinicalDocs` (clinical-docs.js) and the static `code-sets.js` catalogues.
import * as coding from '../../data/repositories/coding.js';
// A28 — the submission batches: the Submission badge counts the batches not
// yet with the payer, Rejections the claims sent back and still to fix.
// Claima owns `batches` (data/repositories/batches.js).
import * as batches from '../../data/repositories/batches.js';
// A30 — the lifecycle engine: the Follow-ups badge counts the claims a payer
// has gone silent on past its threshold, computed on every read. Claima owns
// `followups` (data/repositories/followups.js); the events themselves are
// derived, never stored.
import * as lifecycle from '../../data/engines/claim-events.js';
// A29 — the remittances: the badge counts the remittances captured and not
// yet posted. Loading it registers the seed hooks denials and unapplied cash
// fill from, and afterPostHooks for A30. Claima owns `remittances`, `denials`
// (until F7) and `unapplied` (data/repositories/remittances.js, denials.js,
// unapplied.js).
import * as remittances from '../../data/repositories/remittances.js';
// A31 — the denials: the badge counts what is still untriaged. Loading the
// repository subscribes it to remittances.afterPostHooks, which is how a
// posting that pays a denied line back resolves the denial. Ownership
// revoked → Defensio (A36): the entity is modules/defensio's from amendment
// 36 on; Claima keeps posting denials and the two routes below are redirect
// stubs to #/defensio/denials. The analytics screen stays here.
import * as denials from '../../data/repositories/denials.js';
// A33 — the write-offs: the badge counts the requests waiting for the
// signed-in role's signature. Loading the repository registers the merge
// re-link hook and, once the denials feature has loaded, seeds the register.
// Claima owns `writeoffs` (data/repositories/writeoffs.js).
import * as writeoffs from '../../data/repositories/writeoffs.js';
// A34 — the daily transaction report: the badge counts today's RED checks
// not yet fixed or documented. Loading the repository subscribes it to the
// ledger's afterAppend hook (prior-day tagging, session attachment) and seeds
// the five business days behind the claim repository's peers. Claima owns
// `businessDays` and `cashSessions` (data/repositories/business-days.js,
// cash-sessions.js).
import * as businessDays from '../../data/repositories/business-days.js';

export default {
  id: 'claima',
  name: 'Claima',
  group: 'Revenue cycle',
  icon: 'receipt_long',

  nav: [
    // --- A35: nav entries ---
    {
      // The dashboard: the badge is what wants a decision today — claims a
      // payer has gone quiet on past the escalation threshold, and denials
      // nobody has triaged. Both figures are the owning helpers' own.
      screen: 'home',
      label: 'Home',
      icon: 'dashboard',
      count: () => lifecycle.escalated().length + denials.counts().untriaged,
    },
    // --- A25: nav entries ---
    {
      screen: 'charges',
      label: 'Charges',
      icon: 'receipt',
      count: () => charges.counts().encounters,
    },
    // --- A26: nav entries ---
    {
      screen: 'coding',
      label: 'Coding',
      icon: 'medical_information',
      count: () => coding.counts().beyondSla,
    },
    {
      // The physician's side of the coding worklist, at #/claima/coding/queries.
      screen: 'coding/queries',
      label: 'Queries',
      icon: 'forum',
      count: () => coding.awaitingAnswer().length,
    },
    {
      screen: 'coding/metrics',
      label: 'Metrics',
      icon: 'monitoring',
    },
    // --- A27: nav entries ---
    {
      // The claim portfolio: the badge is what is Ready for submission.
      screen: 'claims',
      label: 'Claims',
      icon: 'description',
      count: () => claims.readyForSubmission().length,
    },
    // --- A28: nav entries ---
    {
      // The submission workbench: the ready queue by payer and the batches.
      screen: 'submission',
      label: 'Submission',
      icon: 'send',
      count: () => batches.counts().open,
    },
    {
      // Claims the payer sent back, at #/claima/submission/rejections.
      screen: 'submission/rejections',
      label: 'Rejections',
      icon: 'assignment_return',
      count: () => batches.counts().rejected,
    },
    // --- A29: nav entries ---
    {
      // The remittance workbench: the badge is what is captured and not posted.
      screen: 'remittances',
      label: 'Remittances',
      icon: 'payments',
      count: () => remittances.counts().unposted,
    },
    // --- A30: nav entries ---
    {
      // The kanban of every claim by status, moved by events rather than by hand.
      screen: 'pipeline',
      label: 'Pipeline',
      icon: 'view_kanban',
    },
    {
      // Status × days-in-status, reconciling with the board.
      screen: 'aging',
      label: 'Aging',
      icon: 'grid_on',
    },
    {
      // Claims the payer has gone quiet on; the badge is the queue.
      screen: 'followups',
      label: 'Follow-ups',
      icon: 'call',
      count: () => lifecycle.silent().length,
    },
    {
      screen: 'payer-stats',
      label: 'Payer statistics',
      icon: 'query_stats',
    },
    // --- A31: nav entries ---
    {
      // The triage worklist: the badge is what nobody has looked at yet.
      screen: 'denials',
      label: 'Denials',
      icon: 'report',
      count: () => denials.counts().untriaged,
    },
    {
      // Payer reasons beside root causes, and the prevention feed.
      screen: 'denials/analytics',
      label: 'Denial analytics',
      icon: 'insights',
    },
    // --- A32: nav entries ---
    {
      // The immutable log of withdrawn claims; no badge — a log is not work.
      screen: 'nullifications',
      label: 'Nullifications',
      icon: 'block',
    },
    // --- A33: nav entries ---
    {
      // The write-off register; the badge is what waits on the signed-in role.
      screen: 'writeoffs',
      label: 'Write-offs',
      icon: 'money_off',
      count: () => writeoffs.pendingFor().length,
    },
    // --- A34: nav entries ---
    {
      // Today's report; the badge is what stands between the day and its close.
      screen: 'dtr',
      label: 'Daily report',
      icon: 'summarize',
      count: () => businessDays.today().undocumentedReds,
    },
    {
      // Every frozen version, and the month rolled up — at #/claima/dtr/archive.
      screen: 'dtr/archive',
      label: 'DTR archive',
      icon: 'inventory_2',
    },
  ],

  routes: {
    // --- A35: routes ---
    // #/claima and #/claima/home: the shell redirects a bare module path to the
    // module's first nav screen — the dashboard, which replaced the A24
    // placeholder.
    home: () => import('./features/home/home.js'),
    // --- A25: routes ---
    // #/claima/charges is the unbilled worklist; /charges/health is the capture
    // health screen, which the worklist hands the mount over to on the deeper path.
    charges: () => import('./features/charge-capture/unbilled-worklist.js'),
    // --- A26: routes ---
    // #/claima/coding is the worklist; it hands the mount over to the physician
    // queue at /coding/queries, the metrics at /coding/metrics and the
    // workspace at /coding/<encounter no>.
    coding: () => import('./features/coding/coding-worklist.js'),
    // --- A27: routes ---
    // #/claima/claims is the portfolio; it hands the mount over to the claim
    // page at /claims/<claim no>, with a tab id after it.
    claims: () => import('./features/claims-assembly/portfolio.js'),
    // --- A28: routes ---
    // #/claima/submission is the workbench; it hands the mount over to the
    // rejections worklist at /submission/rejections and to the batch page at
    // /submission/<batch no>, with a tab id after it.
    submission: () => import('./features/submission/submission-workbench.js'),
    // --- A29: routes ---
    // #/claima/remittances is the workbench; it hands the mount over to the
    // upload stepper at /remittances/upload, manual entry at /remittances/new,
    // unapplied cash at /remittances/unapplied and the remittance page at
    // /remittances/<remittance no>, with a tab id after it.
    remittances: () => import('./features/remittance/workbench.js'),
    // --- A30: routes ---
    // #/claima/pipeline is the board, /aging the table beside it, /followups
    // the queue, /payer-stats the table per payer; /timeline/<claim no> is one
    // claim's events with its family strip.
    pipeline: () => import('./features/lifecycle/pipeline.js'),
    aging: () => import('./features/lifecycle/aging.js'),
    followups: () => import('./features/lifecycle/followups.js'),
    'payer-stats': () => import('./features/lifecycle/payer-stats.js'),
    timeline: () => import('./features/lifecycle/timeline.js'),
    // --- A31: routes ---
    // #/claima/denials and /denials/<denial id> redirect to Defensio (A36);
    // the stub still hands the mount over to the analytics at
    // /denials/analytics.
    denials: () => import('./features/denials/denials-worklist.js'),
    // --- A32: routes ---
    // #/claima/nullifications is the log; it hands the mount over to the
    // record at /nullifications/<nullification no>. The Nullify action itself
    // lives on the claim page.
    nullifications: () => import('./features/nullification/nullification-log.js'),
    // --- A33: routes ---
    // #/claima/writeoffs is the worklist; it hands the mount over to the
    // request screen at /writeoffs/new, the analytics at /writeoffs/analytics
    // and the decision page at /writeoffs/<id>, with a tab id after it.
    writeoffs: () => import('./features/writeoffs/writeoff-worklist.js'),
    // --- A34: routes ---
    // #/claima/dtr is today's report and /dtr/<date> another day's; it hands
    // the mount over to the archive at /dtr/archive and the frozen snapshot
    // at /dtr/archive/<date>.
    dtr: () => import('./features/dtr/dtr-today.js'),
  },
};
