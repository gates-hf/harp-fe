// The settlement engine: what one visit was quoted, what it was actually
// charged, what has been paid against it, and which of the four answers that
// adds up to. Pure — no DOM, no writes. It reads the ledger, the register, the
// estimates and the acknowledgments, and is read by data/repositories/accounts.js,
// which is the file that writes the stamp and the Settlement row; nothing here
// imports that file back, so the arrow stays one-way.
//
// The arithmetic itself — actual share, paid, difference, outcome, drivers —
// is data/engines/account-engine.js's `reconcileRows`, over rows handed in,
// so the ledger seed can settle a visit while it is still building and this
// file can read the same answer off the live ledger. What this file adds is
// the lookups: the visit, its rows, the estimate the patient signed for, and
// the stamp and the consent already on the encounter.
//
// Estimates never settle — only actual charges do. The estimate is the third
// column of the strip and the source of the drivers, never the figure the
// difference is taken against.

import * as ledger from '../repositories/ledger.js';
import * as encounters from '../repositories/encounters.js';
import * as estimates from '../repositories/estimates.js';
import * as acknowledgments from '../repositories/acknowledgments.js';
import * as accountEngine from './account-engine.js';
import { CONFIG } from '../../shared/config.js';

export const OUTCOMES = ['Settled', 'Unsettled', 'Excess', 'Pending'];

export const outcomeTone = accountEngine.outcomeTone;

/** How long a closed visit may sit unsettled before the account is flagged, and the residual worth flagging. */
export const unsettledAfterDays = () => CONFIG.accounts?.unsettledAfterDays ?? 3;
export const unsettledResidualFloor = () => CONFIG.accounts?.unsettledResidualFloor ?? 25;

/**
 * reconcile(encounterNo | encounter) → the reconciliation, or null for a visit
 * the register does not hold. Every figure is computed from the rows under it
 * on every call; nothing is cached.
 */
export function reconcile(encounterOrNo) {
  const enc = typeof encounterOrNo === 'string' ? encounters.get(encounterOrNo) : encounterOrNo;
  if (!enc) return null;
  const quoted = acknowledgedEstimate(enc);
  const r = accountEngine.reconcileRows(ledger.byPatient(enc.patientMrn), enc.no, quoted);
  const mode = accountEngine.paymentModeOf(enc);
  const stamp = enc.settlement || null;
  const consent = stamp?.consent || null;
  return {
    ...r,
    mode,
    runsContinuously: mode === 'Upfront Settlement',
    // An excess the patient has agreed to leave on the account is resolved
    // without money moving: the outcome stays Excess — the figures are what
    // they are — and the consent says nobody needs to chase it.
    resolved: r.outcome === 'Settled' || (r.outcome === 'Excess' && Boolean(consent)),
    consent,
    stamp,
  };
}

/** The estimate the patient signed for on this visit, newest signature first. */
export function acknowledgedEstimate(enc) {
  const ack = acknowledgments.byEncounter(enc.no)[0];
  const byAck = ack ? estimates.get(ack.estimateNo) : null;
  if (byAck?.result?.totals) return byAck;
  // A visit converted from an estimate carries it in its links; a signature
  // recorded against the estimate elsewhere still counts.
  for (const no of enc.linked?.estimateIds || []) {
    const row = estimates.get(no);
    if (row?.result?.totals && acknowledgments.isAcknowledged(no)) return row;
  }
  return null;
}

/** The words the strip and the board say for an outcome. */
export function outcomeLabel(r) {
  if (!r) return '—';
  if (r.outcome === 'Settled') return 'Settled ✓';
  if (r.outcome === 'Unsettled') return `Residual $${r.difference.toFixed(2)}`;
  if (r.outcome === 'Excess') return `Excess $${Math.abs(r.difference).toFixed(2)}${r.consent ? ' · held as credit' : ''}`;
  return 'Pending';
}

/** Whether a closed visit has sat unsettled long enough, with a residual big enough, to flag. */
export function unsettledTooLong(enc, r, on = new Date()) {
  if (!enc || !r || r.outcome !== 'Unsettled' || r.difference < unsettledResidualFloor()) return false;
  if (!['Discharged', 'Completed'].includes(enc.status) || !enc.endAt) return false;
  const days = (on.getTime() - Date.parse(enc.endAt)) / 86400000;
  return days >= unsettledAfterDays();
}
