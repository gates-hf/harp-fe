// Seed — claims. Generated, not hand-written: about 600 adjudicated claim lines
// spread across every payer holding a contract this year. Owned by
// modules/pactum for now — a future claims module takes ownership, and the
// repository API sitting on top of this file stays as it is.
//
// Only the denial-reason list and the per-payer knobs below are written by
// hand. Everything else comes out of a seeded PRNG, so the numbers Performance
// reports are the same on every load and after every reset.
//
// The generator reads contracts and the charge master through their
// repositories — never their tables — so a claim always names rows that exist
// and carries the amount the contract itself would have priced on that date.
// data/store.js does not import this file: data/repositories/claims.js
// generates on first read, which is also how a reset regenerates it identically.

import * as contracts from '../repositories/contracts.js';
import * as cdm from '../repositories/cdm.js';
import { todayIso, compareDates } from '../../shared/format.js';

/** Extensible: a code added here shows up in the ranked reasons on both screens. */
export const DENIAL_REASONS = [
  { code: 'PA_MISSING', label: 'Prior auth missing', weight: 24 },
  { code: 'COV_RULE', label: 'Coverage rule trip', weight: 20 },
  { code: 'CODE_MISMATCH', label: 'Code mismatch', weight: 16 },
  { code: 'DOC_MISSING', label: 'Documentation missing', weight: 14 },
  { code: 'LATE_FILING', label: 'Late filing', weight: 12 },
  { code: 'MEMBER_INELIG', label: 'Member ineligible', weight: 9 },
  { code: 'DUPLICATE', label: 'Duplicate claim', weight: 5 },
];

/**
 * Each payer's behaviour, hand-written so the table sorts into a story: NSSF is
 * slow, denies a fifth of what it adjudicates and is getting worse; Bupa pays
 * in under three weeks and denies almost nothing. `volume` is a share of the
 * total, not a count.
 */
export const PAYER_KNOBS = {
  'PY-0001': { denialRate: 0.21, daysToPay: 74, underpayRate: 0.15, trend: 'worsening', volume: 3 },
  'PY-0002': { denialRate: 0.13, daysToPay: 46, underpayRate: 0.09, trend: 'flat', volume: 2 },
  'PY-0007': { denialRate: 0.09, daysToPay: 33, underpayRate: 0.06, trend: 'improving', volume: 2 },
  'PY-0008': { denialRate: 0.06, daysToPay: 25, underpayRate: 0.04, trend: 'flat', volume: 1.5 },
  'PY-0025': { denialRate: 0.04, daysToPay: 18, underpayRate: 0.02, trend: 'improving', volume: 1 },
};

/** A payer that gains a contract after this file was written still gets claims. */
const DEFAULT_KNOB = { denialRate: 0.10, daysToPay: 38, underpayRate: 0.07, trend: 'flat', volume: 1 };

export const TOTAL_CLAIMS = 600;

/** What a hospital actually bills, so Lab and Consultation carry the volume. */
const CATEGORY_WEIGHTS = {
  Lab: 22, Consultation: 18, Pharmacy: 14, Radiology: 12, Procedure: 10,
  Consumables: 8, 'Room & Board': 6, Surgery: 5, 'Professional Fee': 4, 'Non-Clinical': 1,
};

// --- generator ---------------------------------------------------------------

export function generateClaims() {
  const rand = prng(20260908);
  const today = todayIso();
  const year = today.slice(0, 4);
  const yearStart = `${year}-01-01`;
  const todayDay = day(today);

  const items = cdm.findActive().filter((r) => r.kind === 'item' && Number(r.standardPrice) > 0);
  if (!items.length) return [];

  const windows = billableWindows(yearStart, today);
  const payerIds = [...new Set(windows.map((w) => w.contract.payerId))].sort();
  if (!payerIds.length) return [];

  const totalVolume = payerIds.reduce((n, id) => n + knobOf(id).volume, 0);
  const rows = [];

  for (const payerId of payerIds) {
    const knob = knobOf(payerId);
    const mine = windows.filter((w) => w.contract.payerId === payerId);
    const count = Math.max(1, Math.round((TOTAL_CLAIMS * knob.volume) / totalVolume));

    for (let i = 0; i < count; i += 1) {
      const window = pick(mine, (w) => w.to - w.from + 1, rand);
      const dateOfService = isoOf(window.from + Math.floor(rand() * (window.to - window.from + 1)));
      const planIds = window.contract.planIds || [];
      const planId = planIds[Math.floor(rand() * planIds.length)] || null;
      // The version that billed that date, which is the whole point of storing
      // the contract id on the claim rather than the lineage.
      const contract = contracts.contractForService(payerId, planId, dateOfService) || window.contract;

      const item = pick(items, (it) => CATEGORY_WEIGHTS[it.category] ?? 3, rand);
      const qty = item.uom === 'Night' ? 1 + Math.floor(rand() * 4) : rand() < 0.78 ? 1 : 1 + Math.floor(rand() * 3);
      const grossBilled = round2(Number(item.standardPrice) * qty);
      const allowedExpected = round2(contracts.resolvedPrice(contract, item, dateOfService) * qty);

      const submittedDay = day(dateOfService) + 1 + Math.floor(rand() * 5);
      const payDays = Math.max(3, Math.round(knob.daysToPay * (0.55 + rand() * 0.9)));
      const claim = {
        claimNo: '',
        payerId,
        planId,
        contractId: contract.id,
        dateOfService,
        submittedAt: isoOf(Math.min(submittedDay, todayDay)),
        serviceGroup: contracts.serviceGroupOf(item.category),
        category: item.category,
        itemId: item.id,
        qty,
        grossBilled,
        allowedExpected,
        allowedPaid: 0,
        paidAt: null,
        status: 'Pending',
        denialReasonCode: null,
        appealed: false,
      };

      // Nothing is adjudicated before the payer would have got to it, so a
      // claim still inside its own turnaround is Pending and counts in no rate.
      if (submittedDay + payDays <= todayDay) {
        const drift = trendDrift(knob.trend, dateOfService);
        if (rand() < clamp(knob.denialRate * drift, 0.01, 0.45)) {
          claim.status = 'Denied';
          claim.denialReasonCode = pick(DENIAL_REASONS, (r) => r.weight, rand).code;
          claim.appealed = rand() < 0.35;
        } else {
          claim.paidAt = isoOf(submittedDay + payDays);
          if (rand() < knob.underpayRate) {
            claim.status = 'Partially Paid';
            claim.allowedPaid = round2(allowedExpected * (1 - (0.05 + rand() * 0.35)));
            claim.appealed = rand() < 0.15;
          } else {
            claim.status = 'Paid';
            claim.allowedPaid = allowedExpected;
          }
        }
      }
      rows.push(claim);
    }
  }

  // Ids read chronologically, so CLM-0001 is the oldest claim on the screen.
  rows.sort((a, b) => a.dateOfService.localeCompare(b.dateOfService) || a.payerId.localeCompare(b.payerId));
  return rows.map((row, i) => {
    const n = String(i + 1).padStart(4, '0');
    return { id: `CLM-${n}`, ...row, claimNo: `CN-${year}-${n}` };
  });
}

// --- internals ---------------------------------------------------------------

const knobOf = (payerId) => PAYER_KNOBS[payerId] || DEFAULT_KNOB;

/**
 * One entry per contract version that could carry a claim this year: the slice
 * of its term that falls inside the year and is already behind us. A draft
 * bills nothing, and neither does a version after it closed or was terminated.
 */
function billableWindows(yearStart, today) {
  const out = [];
  for (const contract of contracts.all()) {
    if (contract.status === 'Draft' || !(contract.planIds || []).length) continue;
    const from = latest(contract.startDate, contract.effectiveDate, yearStart);
    const to = earliest(contract.endDate, contract.terminationDate, contract.closedAt, today);
    if (!from || !to || compareDates(from, to) > 0) continue;
    out.push({ contract, from: day(from), to: day(to) });
  }
  return out;
}

const latest = (...dates) => dates.filter(Boolean).sort(compareDates).pop() || '';
const earliest = (...dates) => dates.filter(Boolean).sort(compareDates)[0] || '';

/** A worsening payer denies more as the year runs on; an improving one, less. */
function trendDrift(trend, dateOfService) {
  const month = Number(dateOfService.slice(5, 7)) - 1;
  if (trend === 'worsening') return 1 + month * 0.06;
  if (trend === 'improving') return Math.max(0.35, 1 - month * 0.06);
  return 1;
}

/** Deterministic PRNG (mulberry32) — the same seed gives the same 600 claims. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rows, weightOf, rand) {
  const total = rows.reduce((n, row) => n + (weightOf(row) || 0), 0);
  let n = rand() * total;
  for (const row of rows) {
    n -= weightOf(row) || 0;
    if (n <= 0) return row;
  }
  return rows[rows.length - 1];
}

const day = (isoDate) => Math.round(Date.parse(`${isoDate}T00:00:00Z`) / 86400000);
const isoOf = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
