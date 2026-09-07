// The billing evaluation engine: what one charge costs under a contract, and
// why. Pure — no DOM, no writes — so the simulator today and a claims module
// later read the same answer from the same five steps:
//
//   1 methodology -> 2 overage -> 3 coverage -> 4 pre-auth -> 5 rules
//
// Rules run last and override what the four steps before them decided; every
// override is kept in the trace as "was X -> now Y (rule name)".

import * as contracts from '../repositories/contracts.js';
import * as cdm from '../repositories/cdm.js';
import { evaluate, actionSummary, conditionsText } from './rule-evaluator.js';
import { evaluateOverage } from './overage-engine.js';
import { date, usd } from '../../shared/format.js';

export const STATUSES = ['Priced', 'Held for approval', 'Not billable'];

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;

const splitOf = (allowed, row) => {
  const patient = contracts.patientShare(allowed, row);
  return { patient, payer: cents(allowed - patient) };
};

const splitText = (s) => `${usd(s.payer)} payer / ${usd(s.patient)} patient`;

/** A covered row with no share reads as words rather than the table's dash. */
const shareText = (row) => {
  const summary = contracts.shareSummary(row);
  return summary === '—' ? 'no patient share' : summary;
};

/**
 * One charge line through the whole ladder.
 * line = { itemId, qty, consumption?: [{ componentId, qty | amount }] }
 * Returns the trace, or null when the line names no charge.
 */
export function evaluateCharge(contract, planId, patientCtx = {}, encounterCtx = {}, line = {}) {
  const item = cdm.get(line.itemId);
  if (!contract || !item) return null;
  const qty = Math.max(1, Number(line.qty) || 1);
  const on = encounterCtx.dateOfService || contracts.today();
  const admissionType = encounterCtx.admissionType || null;

  // --- 1 methodology --------------------------------------------------------
  const methodology = contracts.resolveMethodology(contract, item, on, admissionType);
  const unitPrice = contracts.resolvedPrice(contract, item, on, admissionType);
  let allowed = cents(unitPrice * qty);
  const step1 = {
    n: 1,
    key: 'methodology',
    title: 'Methodology',
    scope: methodology ? contracts.scopeLabel(methodology) : 'None',
    method: methodology?.method || 'Standard price',
    params: methodology ? contracts.methodologySummary(methodology) : 'No row covers this charge',
    unitPrice,
    qty,
    allowedAmount: allowed,
  };

  // --- 2 overage ------------------------------------------------------------
  const caseRate = cdm.isBundle(item) && methodology?.method === 'Case Rate';
  let overage = caseRate
    ? evaluateOverage(contract, methodology, item, line.consumption || [], { planId, on, admissionType, qty })
    : null;
  const step2 = { n: 2, key: 'overage', title: 'Overage', applies: caseRate, reason: overageReason(item, methodology) };
  const fillOverage = () => Object.assign(step2, {
    rows: overage?.rows || [],
    lines: overage?.lines || [],
    total: overage?.total || 0,
    payer: overage?.payer || 0,
    patient: overage?.patient || 0,
  });
  fillOverage();

  // --- 3 coverage -----------------------------------------------------------
  const coverageRow = contracts.resolveCoverage(contract, planId, item);
  let shareMode = 'coverage';
  let copayRow = null;
  let shares = splitOf(allowed, coverageRow);
  const step3 = {
    n: 3,
    key: 'coverage',
    title: 'Coverage',
    scope: coverageRow ? contracts.scopeLabel(coverageRow) : 'None',
    share: coverageRow ? shareText(coverageRow) : 'No row',
    covered: coverageRow ? coverageRow.covered !== false : null,
    patientShare: shares.patient,
    payerShare: shares.payer,
    note: coverageRow
      ? ''
      : 'No coverage row names this charge, so the payer carries the whole allowed amount.',
  };

  // --- 4 pre-auth -----------------------------------------------------------
  const preAuth = contracts.resolvePreAuth(contract, item, allowed);
  let required = preAuth.required;
  const step4 = {
    n: 4,
    key: 'preauth',
    title: 'Pre-authorization',
    required,
    source: preAuth.source ? contracts.preAuthLabel(preAuth.source) : 'None',
    reason: preAuth.reason,
  };

  // --- 5 rules --------------------------------------------------------------
  const context = ruleContext({ contract, item, qty, allowed, planId, patientCtx, encounterCtx, overage, shares });
  const { mode, fired, outcome } = evaluate(contract, context);
  const naming = (attr, value) => (attr === 'patient.plan' ? contracts.planNameOf(contract, value) : null);
  const overrides = [];
  let notBillable = false;

  const recompute = () => {
    if (notBillable) return { patient: 0, payer: 0 };
    if (shareMode === 'payer') return { patient: 0, payer: allowed };
    if (shareMode === 'patient') return { patient: allowed, payer: 0 };
    return splitOf(allowed, shareMode === 'copay' ? copayRow : coverageRow);
  };

  for (const entry of outcome) {
    const type = entry.action?.type;
    const p = entry.action?.params || {};
    const was = { allowed, ...shares, required };

    if (type === 'Not Billable') {
      notBillable = true;
      allowed = 0;
    } else if (type === '% Discount') {
      allowed = cents(allowed * (1 - (Number(p.percent) || 0) / 100));
    } else if (type === 'Fixed Rate') {
      allowed = cents((Number(p.amount) || 0) * qty);
    } else if (type === 'Ceiling') {
      allowed = Math.min(allowed, cents(p.amount));
    } else if (type === 'Co-pay') {
      shareMode = 'copay';
      copayRow = { covered: true, shareType: p.shareType || 'Co-pay %', shareValue: p.value, deductible: 0, ceiling: null };
    } else if (type === 'Requires Prior Approval') {
      required = true;
    } else if (type === 'Route to Payer') {
      shareMode = 'payer';
    } else if (type === 'Route to Patient') {
      shareMode = 'patient';
    } else if (type === 'Override Overage Action' && overage) {
      overage = evaluateOverage(contract, methodology, item, line.consumption || [], {
        planId, on, admissionType, qty, forcedAction: p.action,
      });
      fillOverage();
      was.overageActions = [...new Set(overage.rows.filter((r) => r.forced).map((r) => r.policyAction))].join(', ');
    }

    shares = recompute();
    overrides.push(overrideNote(entry, { type, params: p, was, allowed, shares, required }));
  }

  const step5 = {
    n: 5,
    key: 'rules',
    title: 'Rules',
    mode,
    fired: fired.map((r) => ({
      id: r.id,
      name: r.name,
      priority: r.priority,
      action: actionSummary(r.action),
      conditions: conditionsText(r, naming),
    })),
    overrides,
    note: fired.length ? '' : 'No rule fired on this charge.',
  };

  const held = required || Boolean(overage?.held);
  return {
    item,
    qty,
    contractId: contract.id,
    contractNo: contract.contractNo,
    version: contract.version,
    dateOfService: on,
    steps: [step1, step2, step3, step4, step5],
    result: {
      allowed,
      patientShare: shares.patient,
      payerShare: shares.payer,
      preAuthRequired: required,
      status: notBillable ? 'Not billable' : held ? 'Held for approval' : 'Priced',
      overageLines: overage?.lines || [],
      rulesFired: fired.map((r) => r.id),
    },
  };
}

/**
 * A whole encounter: pick the contract version that billed this plan on the
 * date of service, then run every line through it.
 */
export function evaluateEncounter(payerId, planId, patientCtx = {}, encounterCtx = {}, lines = []) {
  const on = encounterCtx.dateOfService || contracts.today();
  const contract = payerId && planId ? contracts.contractForService(payerId, planId, on) : null;
  if (!contract) {
    return {
      contract: null,
      error: `No active contract for this plan on ${date(on)}.`,
      traces: [],
      totals: totalsOf([]),
    };
  }
  const traces = lines.map((line) => evaluateCharge(contract, planId, patientCtx, encounterCtx, line)).filter(Boolean);
  return { contract, error: '', traces, totals: totalsOf(traces) };
}

/** The invoice: one row per charge, then its overage rows marked apart. */
export function invoiceRows(traces) {
  const out = [];
  for (const trace of traces) {
    out.push({
      isOverage: false,
      chargeCode: trace.item.chargeCode,
      description: cdm.label(trace.item),
      qtyLabel: `${trace.qty}`,
      amount: trace.result.allowed,
      payer: trace.result.payerShare,
      patient: trace.result.patientShare,
      status: trace.result.status,
    });
    for (const line of trace.result.overageLines) out.push(line);
  }
  return out;
}

export function totalsOf(traces) {
  const rows = invoiceRows(traces);
  const sum = (key, filter = () => true) =>
    cents(rows.filter(filter).reduce((n, r) => n + (Number(r[key]) || 0), 0));
  return {
    lines: rows.length,
    allowed: sum('amount'),
    payer: sum('payer'),
    patient: sum('patient'),
    overage: sum('amount', (r) => r.isOverage),
    held: rows.filter((r) => r.status === 'Held for approval').length,
    notBillable: rows.filter((r) => r.status === 'Not billable').length,
  };
}

// --- internals ---------------------------------------------------------------

function overageReason(item, methodology) {
  if (!cdm.isBundle(item)) return 'Only a bundle priced as a case rate is measured against limits.';
  if (methodology?.method !== 'Case Rate') {
    return `This bundle is priced by ${methodology?.method || 'the standard price'} here, not as a case rate, so nothing is measured against its limits.`;
  }
  return '';
}

function overrideNote(entry, s) {
  const base = { ruleId: entry.ruleId, ruleName: entry.ruleName, action: actionSummary(entry.action) };
  if (s.type === 'Requires Prior Approval') {
    return s.was.required
      ? { ...base, what: 'Pre-authorization', was: 'required by the matrix', now: 'required by this rule too' }
      : { ...base, what: 'Pre-authorization', was: 'not required', now: 'required' };
  }
  if (s.type === 'Override Overage Action') {
    return {
      ...base,
      what: 'Overage action',
      was: s.was.overageActions || 'the contract policy',
      now: s.params.action || '—',
    };
  }
  if (s.type === 'Co-pay' || s.type === 'Route to Payer' || s.type === 'Route to Patient') {
    return { ...base, what: 'Split', was: splitText(s.was), now: splitText(s.shares) };
  }
  return { ...base, what: 'Allowed amount', was: usd(s.was.allowed), now: usd(s.allowed) };
}

/**
 * The flat context the rule engine reads. An attribute the encounter does not
 * carry is left out entirely, so a condition on it never fires.
 */
function ruleContext({ contract, item, qty, allowed, planId, patientCtx, encounterCtx, overage, shares }) {
  const context = {
    'patient.plan': planId,
    'patient.age': patientCtx.age,
    'patient.gender': patientCtx.gender,
    'patient.nationality': patientCtx.nationality,
    'patient.memberSince': patientCtx.memberSince,
    'item.chargeCode': item.chargeCode,
    'item.description': cdm.label(item),
    'item.category': item.category,
    'item.serviceGroup': contracts.serviceGroupOf(item.category),
    'item.standardPrice': Number(item.standardPrice) || 0,
    'item.allowedAmount': allowed,
    'item.quantity': qty,
    'item.isBundle': cdm.isBundle(item),
    'encounter.admissionType': encounterCtx.admissionType,
    'encounter.department': encounterCtx.department,
    'encounter.lengthOfStay': encounterCtx.lengthOfStay,
    'encounter.diagnosisCode': encounterCtx.diagnosisCode,
    'encounter.attendingDoctor': encounterCtx.attendingDoctor,
    'encounter.dateOfService': encounterCtx.dateOfService,
    'financial.claimTotal': encounterCtx.claimTotal ?? allowed,
    'financial.overageAmount': overage?.total || 0,
    'financial.overageComponent': overage?.lines?.[0]?.chargeCode,
    'financial.patientBalance': shares.patient,
    'financial.preAuthNumber': encounterCtx.preAuthNumber,
  };
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined || value === null || value === '') delete context[key];
  }
  return context;
}
