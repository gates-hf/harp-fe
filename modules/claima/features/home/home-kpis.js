// The six numbers at the top of the Claima dashboard. Each one is read from
// the helper the owning feature published in COORDINATION.md and links to the
// screen holding the rows it counted — the headline and the row count under
// the link are the same query, so a demo can click through and reconcile.
//
// Nothing here computes a rule of its own: `unbilledGrouped`, `worklist`,
// `readyForSubmission`, `readyQueueByPayer`, `queueStats`, `counts` and
// `nearDeadline` are the owning repositories' helpers. The one figure with two
// sources is the day's cash: amendment 34's `dtr.today()` when that repository
// is on disk, and the ledger and the remittances themselves until it is.

import * as charges from '../../../../data/repositories/charges.js';
import * as coding from '../../../../data/repositories/coding.js';
import * as claims from '../../../../data/repositories/claims.js';
import * as batches from '../../../../data/repositories/batches.js';
import * as lifecycle from '../../../../data/engines/claim-events.js';
import * as denials from '../../../../data/repositories/denials.js';
import * as remittances from '../../../../data/repositories/remittances.js';
import * as ledger from '../../../../data/repositories/ledger.js';
import { CONFIG } from '../../../../shared/config.js';
import { metricRailHtml } from '../../../../shared/metric-card.js';
import { iso, todayIso, usd } from '../../../../shared/format.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Whole days since a timestamp, for "oldest N d". */
const daysSince = (at) => {
  const then = Date.parse(at);
  return Number.isFinite(then) ? Math.max(0, Math.floor((Date.now() - then) / 86400000)) : 0;
};

// --- the daily transaction report (A34), feature-detected ---------------------

/** `{ module }` once the import has settled; null while A34's file is not on disk. */
const dtr = { module: null, loaded: false };

/**
 * Load `data/repositories/business-days.js` if it exists. The import is
 * dynamic and its failure is the answer "not yet", never an error: the home
 * renders either way and redraws when this settles.
 */
export async function loadDtr() {
  if (dtr.loaded) return dtr.module;
  try {
    const mod = await import('../../../../data/repositories/business-days.js');
    dtr.module = typeof mod.today === 'function' ? mod : null;
  } catch {
    dtr.module = null;
  }
  dtr.loaded = true;
  return dtr.module;
}

/**
 * The day's cash — `{ payer, patient, unposted, source }`. Off the report when
 * amendment 34 has landed; until then the same three figures read straight
 * off the registers: a posting made today, a receipt taken today, a remittance
 * captured and not yet posted.
 */
export function cashToday() {
  if (dtr.module) {
    const t = dtr.module.today();
    const payer = t?.sections?.payerCash || {};
    const patient = t?.sections?.patientCash || {};
    return {
      payer: Number(payer.total) || 0,
      patient: Number(patient.total) || 0,
      unposted: Number(payer.unposted?.count) || 0,
      source: 'dtr',
    };
  }
  const today = todayIso();
  const payer = remittances.all().reduce((sum, rem) => {
    const live = new Set(remittances.livePostings(rem).filter((p) => iso(p.at) === today).map((p) => p.id));
    if (!live.size) return sum;
    return sum + (rem.claims || [])
      .filter((r) => r.posted && live.has(r.postingId))
      .reduce((n, r) => n + (r.lines || []).reduce((m, l) => m + (Number(l.paid) || 0), 0), 0);
  }, 0);
  const patient = ledger.all()
    .filter((row) => ledger.isLive(row) && ledger.CREDIT_TYPES.includes(row.type) && iso(row.at) === today)
    .reduce((n, row) => n + (Number(row.amount) || 0), 0);
  return { payer, patient, unposted: remittances.counts().unposted, source: 'fallback' };
}

// --- the cards ------------------------------------------------------------------

export function cards() {
  // Unbilled charges — the capture worklist's rows, one per visit, closed
  // visits first; the card counts the lines under them.
  const groups = charges.unbilledGrouped('', {});
  const lines = groups.reduce((n, g) => n + g.lines.length, 0);
  const gross = groups.reduce((n, g) => n + (Number(g.gross) || 0), 0);
  const oldest = groups.reduce((max, g) => Math.max(max, daysSince(g.oldestAt)), 0);
  const lateWindow = Number(CONFIG.claima?.capture?.lateWindowDays) || 7;

  // Coding backlog — every chart on the worklist that is not yet Coded; the
  // worklist itself lists the coded ones last.
  const charts = coding.worklist();
  const backlog = charts.filter((r) => r.status !== 'Coded');
  const beyondSla = coding.counts(charts).beyondSla;

  // Ready to submit — Ready and not stale, the Claims badge's own figure; the
  // queue on the workbench is those not yet in an open batch, by payer.
  const ready = claims.readyForSubmission();
  const readyValue = ready.reduce((n, c) => n + (Number(c.totals?.payerShare) || 0), 0);
  const queue = batches.readyQueueByPayer();
  const queued = queue.reduce((n, r) => n + r.count, 0);
  const dueToday = queue.filter((r) => r.dueToday).length;

  // Awaiting payer — the follow-up queue's own three figures.
  const silence = lifecycle.queueStats();

  // Open denials — the triage worklist; the nearest appeal deadline is the
  // first row the repository hands back when asked for every open one.
  const open = denials.worklist();
  const dc = denials.counts();
  const nearest = denials.nearDeadline(Number.MAX_SAFE_INTEGER)[0];
  const nearestDays = nearest ? denials.deadline(nearest).daysLeft : null;
  const warnDays = Number(CONFIG.claima?.denials?.deadlineWarnDays) || 7;

  const cash = cashToday();

  return [
    {
      value: lines,
      label: 'Unbilled charges',
      sub: `${plural(groups.length, 'encounter')} · oldest ${oldest} d`,
      tone: oldest > lateWindow ? 'warning' : '',
      href: '#/claima/charges',
      title: `${plural(lines, 'unreleased line')} over ${plural(groups.length, 'visit')}, worth ${usd(gross)} at the standard price; the oldest has waited ${oldest} d${
        oldest > lateWindow ? ` — past the ${lateWindow}-day late window` : ''}. Opens the capture worklist, closed visits first`,
    },
    {
      value: backlog.length,
      label: 'Coding backlog',
      sub: `${beyondSla} beyond SLA`,
      tone: beyondSla ? 'warning' : '',
      href: '#/claima/coding',
      title: `${plural(backlog.length, 'chart')} not yet coded, ${beyondSla} past the SLA. Opens the coding worklist, oldest and beyond-SLA first; the ${
        charts.length - backlog.length} coded charts are listed after them`,
    },
    {
      value: ready.length,
      label: 'Ready to submit',
      sub: `${plural(dueToday, 'batch')} due today`,
      tone: dueToday ? 'warning' : '',
      href: '#/claima/submission',
      title: `${usd(readyValue)} finalized and not stale — ${queued} in the ready queue, ${
        ready.length - queued} already in an open batch. Opens the submission workbench on the queue`,
    },
    {
      value: silence.silentCount,
      label: 'Awaiting payer',
      sub: `${silence.escalated} escalated`,
      tone: silence.escalated ? 'warning' : '',
      href: '#/claima/followups',
      title: `${usd(silence.silentValue)} with a payer that has gone quiet past its threshold, ${
        usd(silence.escalatedValue)} of it escalated. Opens the follow-up queue, longest silence first`,
    },
    {
      value: open.length,
      label: 'Open denials',
      sub: `${dc.untriaged} untriaged · nearest deadline ${nearestDays == null ? '—' : `${nearestDays} d`}`,
      tone: dc.untriaged > 0 || (nearestDays != null && nearestDays <= warnDays) ? 'warning' : '',
      // A36 — denial management is Defensio's: the card opens its worklist.
      href: '#/defensio/denials?slice=open',
      title: `${usd(dc.openValue)} still open, ${dc.untriaged} nobody has looked at${
        nearest ? `; the nearest appeal window closes in ${nearestDays} d (${nearest.id})` : ''}. Opens the denial worklist, untriaged first`,
    },
    {
      value: cash.source === 'dtr' ? usd(cash.payer + cash.patient) : 'DTR arriving',
      text: true,
      label: 'Cash posted today',
      sub: `payer ${usd(cash.payer)} · patient ${usd(cash.patient)} · ${cash.unposted} unposted`,
      tone: cash.unposted ? 'warning' : '',
      href: '#/claima/remittances?status=Unposted',
      title: cash.source === 'dtr'
        ? `${usd(cash.payer)} posted from remittances and ${usd(cash.patient)} taken at the desk today, read off the daily transaction report; ${
          cash.unposted} remittance${cash.unposted === 1 ? '' : 's'} captured and not yet posted. Opens the remittance workbench on those`
        : `The daily transaction report (amendment 34) is not on disk yet; until it is, the figures are read off the ledger and the remittances — ${
          usd(cash.payer)} posted and ${usd(cash.patient)} taken at the desk today, ${cash.unposted} remittance${
          cash.unposted === 1 ? '' : 's'} not yet posted. Opens the remittance workbench on those`,
    },
  ];
}

export function kpisHtml() {
  return metricRailHtml(cards());
}
