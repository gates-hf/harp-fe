// Engine — cost estimation. What a set of anticipated services would cost under
// the cover on file, in the shape an issued estimate freezes. Pure: no DOM, no
// writes, no store commits — the repository decides what to record.
//
// Nothing here prices anything itself. It runs data/engines/billing-engine.js,
// the same five steps a claim will be evaluated by, and then reads three things
// out of the traces that an estimate has to say out loud and a claim does not:
// what the patient is being asked to approve (the pre-auth flags), what the
// cover will not pay for at all (the exclusions), and where a bundle price runs
// out (the limits). A patient who signs an estimate has been told those three
// things, or has not been told anything.
//
// Self-Pay is not a contract case and is not faked as one: with no plan there is
// no methodology, no coverage row and no rule to run, so the charge master's
// standard price is the price and the whole of it is the patient's.

import * as cdm from '../repositories/cdm.js';
import { evaluateEncounter, invoiceRows } from './billing-engine.js';
import { limitRows, consumedLabel } from './overage-engine.js';
import { ADMISSION_OF } from './eligibility-engine.js';
import { todayIso } from '../../shared/format.js';

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;

const qtyOf = (line) => Math.max(1, Number(line.qty) || 1);

/** The charge lines that name a charge still on the master, in order. */
export const pricedLines = (estimate) =>
  (estimate?.lines || []).filter((line) => line.itemId && cdm.get(line.itemId));

/** The sum of standard price by quantity — the running total the builder shows. */
export const grossOf = (estimate) =>
  cents(pricedLines(estimate).reduce(
    (n, line) => n + (Number(cdm.get(line.itemId).standardPrice) || 0) * qtyOf(line), 0));

/**
 * Price one estimate. Returns the frozen-document shape whether it ran or not:
 * `error` is set when nothing could price the lines, and every other field is
 * still readable, so a builder shows the reason where the totals would go.
 *
 * `patient` is the register row, read raw — masking is a rule about who may look
 * at a record, not about what a rule engine may match on. A prospect has no
 * record, so its context is empty and a rule on patient age never fires.
 */
export function priceEstimate(estimate, { patient = null, disclaimer = '' } = {}) {
  const lines = pricedLines(estimate);
  const gross = grossOf(estimate);
  const context = estimate?.context || {};
  const policy = estimate?.policy || {};
  const on = context.dateOfService || todayIso();

  if (policy.selfPay || !policy.payerId || !policy.planId) return selfPay(lines, gross, disclaimer, on);

  const answer = evaluateEncounter(policy.payerId, policy.planId, patientCtx(patient), {
    dateOfService: on,
    department: context.department || '',
    admissionType: ADMISSION_OF[context.visitType] || null,
  }, lines);

  if (answer.error || !answer.contract) {
    return { ...empty(gross, disclaimer, on), error: answer.error || 'No agreement prices this cover.' };
  }

  const { contract, traces, totals } = answer;
  return {
    error: '',
    selfPay: false,
    contract: { id: contract.id, no: contract.contractNo, version: contract.version },
    lines: traces,
    rows: invoiceRows(traces).map(withGross),
    totals: {
      gross,
      allowed: totals.allowed,
      payerShare: totals.payer,
      patientShare: totals.patient,
      held: totals.held,
      notBillable: totals.notBillable,
      overageExposure: totals.overage,
    },
    limits: traces.map(limitsOf).filter(Boolean),
    preAuthFlags: traces.filter((t) => t.result.preAuthRequired).map(preAuthFlag),
    exclusions: traces.filter(isExcluded).map(exclusion),
    disclaimer,
    dateOfService: on,
    computedAt: new Date().toISOString(),
  };
}

/**
 * The invoice row with what it would have cost at the charge master's own
 * price beside what the agreement allows, which is the comparison an estimate
 * is read for. An overage row has no standard price of its own — it is what a
 * bundle price did not cover — so it carries none.
 */
function withGross(row) {
  if (row.isOverage) return { ...row, gross: null };
  const item = cdm.getByCode(row.chargeCode);
  const qty = Math.max(1, Number(row.qtyLabel) || 1);
  return { ...row, gross: cents((Number(item?.standardPrice) || 0) * qty) };
}

// --- self-pay ----------------------------------------------------------------

/**
 * No plan, no contract, no split: the standard price is the price and the
 * patient carries all of it. There are no five steps to trace, so the document
 * shows the lines and says why there is nothing to open under them.
 */
function selfPay(lines, gross, disclaimer, on) {
  const rows = lines.map((line) => {
    const item = cdm.get(line.itemId);
    const amount = cents((Number(item.standardPrice) || 0) * qtyOf(line));
    return {
      isOverage: false,
      chargeCode: item.chargeCode,
      description: cdm.label(item),
      qtyLabel: String(qtyOf(line)),
      gross: amount,
      amount,
      payer: 0,
      patient: amount,
      status: 'Priced',
    };
  });
  return {
    error: '',
    selfPay: true,
    contract: null,
    lines: [],
    rows,
    totals: {
      gross, allowed: gross, payerShare: 0, patientShare: gross,
      held: 0, notBillable: 0, overageExposure: 0,
    },
    limits: lines.map(selfPayLimits).filter(Boolean),
    preAuthFlags: [],
    exclusions: [],
    disclaimer,
    dateOfService: on,
    computedAt: new Date().toISOString(),
  };
}

/** A self-pay bundle still says what it includes; nothing measures it. */
function selfPayLimits(line) {
  const item = cdm.get(line.itemId);
  if (!cdm.isBundle(item)) return null;
  const rows = limitRows(item.id, qtyOf(line));
  if (!rows.length) return null;
  return {
    chargeCode: item.chargeCode,
    description: cdm.label(item),
    measured: false,
    note: 'Self-Pay prices the package at its own price; nothing measures what is used against it.',
    rows: rows.map((row) => componentLimit(row, {
      beyond: 'billed at the standard price', action: 'Bill Patient', tolerance: '—', source: 'Self-Pay',
    })),
  };
}

// --- what an estimate has to say out loud ------------------------------------

/**
 * Where a bundle price runs out, per component: what it includes, what happens
 * beyond it, and who pays for that. Read off the trace's overage step, so a
 * bundle priced by something other than a case rate says so instead of showing
 * limits nothing measures against.
 */
function limitsOf(trace) {
  if (!cdm.isBundle(trace.item)) return null;
  const step = trace.steps.find((s) => s.key === 'overage');
  if (!step?.applies) {
    const rows = limitRows(trace.item.id, trace.qty);
    if (!rows.length) return null;
    return {
      chargeCode: trace.item.chargeCode,
      description: cdm.label(trace.item),
      measured: false,
      note: step?.reason || '',
      rows: rows.map((row) => componentLimit(row, { beyond: 'not measured against this price' })),
    };
  }
  return {
    chargeCode: trace.item.chargeCode,
    description: cdm.label(trace.item),
    measured: true,
    note: '',
    rows: step.rows.map((row) => ({
      chargeCode: row.item.chargeCode,
      description: cdm.label(row.item),
      included: consumedLabel(row, row.included),
      consumed: consumedLabel(row, row.consumed),
      beyond: `beyond ${consumedLabel(row, row.included)}`,
      action: row.action,
      tolerance: row.toleranceLabel,
      source: row.source,
      overage: row.overage,
      amount: row.amount,
      payer: row.payer,
      patient: row.patient,
      status: row.status,
    })),
  };
}

/** The unmeasured shape: what it includes, and one line about what is beyond. */
const componentLimit = (row, { beyond, action = '—', tolerance = '—', source = '—' }) => ({
  chargeCode: row.item.chargeCode,
  description: cdm.label(row.item),
  included: consumedLabel(row, row.included),
  consumed: '',
  beyond,
  action,
  tolerance,
  source,
  overage: 0,
  amount: 0,
  payer: 0,
  patient: 0,
  status: '',
});

const preAuthFlag = (trace) => {
  const step = trace.steps.find((s) => s.key === 'preauth');
  return {
    chargeCode: trace.item.chargeCode,
    description: cdm.label(trace.item),
    source: step?.source || '—',
    reason: step?.reason || 'Pre-authorisation is required before this charge is billed.',
  };
};

/** A row that names the charge and refuses it — not the absence of a row. */
const isExcluded = (trace) => trace.steps.find((s) => s.key === 'coverage')?.covered === false;

const exclusion = (trace) => {
  const step = trace.steps.find((s) => s.key === 'coverage');
  return {
    chargeCode: trace.item.chargeCode,
    description: cdm.label(trace.item),
    scope: step?.scope || '—',
    amount: trace.result.patientShare,
    reason: `Not covered under ${step?.scope || 'this plan'} — the patient carries the whole amount.`,
  };
};

// --- internals ---------------------------------------------------------------

function patientCtx(patient) {
  if (!patient) return {};
  return {
    age: ageOf(patient.dob),
    gender: patient.gender,
    nationality: patient.nationality,
    memberSince: patient.createdAt ? String(patient.createdAt).slice(0, 10) : undefined,
  };
}

function ageOf(dob) {
  const born = Date.parse(dob);
  if (!Number.isFinite(born)) return undefined;
  return Math.floor((Date.now() - born) / (365.25 * 86400000));
}

const empty = (gross, disclaimer, on) => ({
  error: '',
  selfPay: false,
  contract: null,
  lines: [],
  rows: [],
  totals: {
    gross, allowed: 0, payerShare: 0, patientShare: 0, held: 0, notBillable: 0, overageExposure: 0,
  },
  limits: [],
  preAuthFlags: [],
  exclusions: [],
  disclaimer,
  dateOfService: on,
  computedAt: new Date().toISOString(),
});

/** How a document names what priced it, contract or no contract. */
export const contractLabel = (result) =>
  (result?.contract ? `${result.contract.no} v${result.contract.version}` : 'Self-Pay');
