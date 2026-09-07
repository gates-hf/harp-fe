// Overage — what a claim consumed past what a bundle price covers, component
// by component. Pure: no DOM and no writes, so the billing engine, the
// simulator and a later claims module all read the same answer.
//
// The limits live on the parent bundle's component rows, so a component that is
// itself a bundle is measured as the one line it is and its own items are
// listed underneath as detail. Consumption is entered against the parent's
// rows, because that is where the limits are written.

import * as contracts from '../repositories/contracts.js';
import * as cdm from '../repositories/cdm.js';
import { usd } from '../../shared/format.js';

export const ABSORBED_BY_TOLERANCE = 'Absorbed (tolerance)';

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * The rows a bundle price is measured against: its own components, each with
 * the limit written on it scaled by how many bundles the line carries.
 * `unit` is 'qty' for a quantity limit and 'amount' for a money allowance.
 */
export function limitRows(bundleId, qty = 1) {
  const times = Number(qty) || 1;
  return cdm.componentRows(bundleId).map((c) => {
    const money = c.limitType === 'Amount Allowance';
    return {
      componentId: c.row.id,
      item: c.row,
      limitType: c.limitType,
      unit: money ? 'amount' : 'qty',
      uom: c.row.uom,
      included: cents((money ? c.limitAmount : c.limitQty) * times),
      // A nested bundle keeps the parent's limit; these read what it holds.
      inner: cdm.isBundle(c.row)
        ? cdm.componentRows(c.row.id).map((p) => ({ item: p.row, qty: p.qty * times }))
        : [],
    };
  });
}

/** What one component's consumption reads as: "5 nights", "$210.00". */
export const consumedLabel = (row, value) =>
  row.unit === 'amount' ? usd(value) : `${Number(value) || 0} ${(row.uom || 'unit').toLowerCase()}${Number(value) === 1 ? '' : 's'}`;

/**
 * Measure one bundle line against its limits and say who pays for the overrun.
 *
 * consumption: [{ componentId, qty | amount }] — a component the claim does not
 * name is assumed to have been consumed exactly to its limit.
 * ctx: { planId, on, admissionType, qty, forcedAction } — forcedAction is what
 * an Override Overage Action rule imposes on every row.
 */
export function evaluateOverage(contract, methodologyRow, bundle, consumption = [], ctx = {}) {
  const { planId = '', on = contracts.today(), admissionType = null, qty = 1, forcedAction = '' } = ctx;
  const policy = contracts.overagePolicyFor(contract, methodologyRow?.id);

  const rows = limitRows(bundle?.id, qty).map((base) => {
    const entry = consumption.find((c) => c.componentId === base.componentId);
    const consumed = cents(entry ? (base.unit === 'amount' ? entry.amount : entry.qty) ?? base.included : base.included);
    const overage = cents(Math.max(0, consumed - base.included));
    const price = contracts.resolvedPrice(contract, base.item, on, admissionType);
    const amount = cents(base.unit === 'amount' ? overage : overage * price);

    const override = (policy?.overrides || []).find((o) => o.componentId === base.componentId) || null;
    const source = override ? 'override' : 'default';
    const tolerance = (override ? override.tolerance : policy?.tolerance) || null;
    const policyAction = override?.action || policy?.action || 'Not Billable (Absorb)';
    const row = {
      ...base,
      consumed,
      overage,
      price,
      tolerance,
      toleranceLabel: contracts.toleranceLabel(tolerance),
      source,
      policyAction,
      action: forcedAction || policyAction,
      forced: Boolean(forcedAction) && forcedAction !== policyAction,
      amount,
      payer: 0,
      patient: 0,
      status: 'Within limit',
      note: '',
    };

    if (overage <= 0) {
      row.action = 'None';
      row.forced = false;
      row.note = 'Consumed inside the limit the bundle price covers.';
      row.amount = 0;
      return row;
    }
    if (withinTolerance(tolerance, row)) {
      row.action = ABSORBED_BY_TOLERANCE;
      row.forced = false;
      row.status = 'Absorbed';
      row.note = `Inside the ${contracts.toleranceLabel(tolerance)}, so it passes without a decision.`;
      return row;
    }
    return applyAction(row, contract, planId);
  });

  const lines = rows
    .filter((r) => r.overage > 0 && r.status !== 'Absorbed' && r.status !== 'Within limit')
    .map((r) => overageLine(r, bundle));

  return {
    policy,
    rows,
    lines,
    total: cents(lines.reduce((sum, l) => sum + l.amount, 0)),
    payer: cents(lines.reduce((sum, l) => sum + l.payer, 0)),
    patient: cents(lines.reduce((sum, l) => sum + l.patient, 0)),
    held: lines.some((l) => l.status === 'Held for approval'),
  };
}

/** Overage lines carry `isOverage`, so an invoice can mark them apart. */
function overageLine(row, bundle) {
  return {
    isOverage: true,
    componentId: row.componentId,
    item: row.item,
    chargeCode: row.item.chargeCode,
    description: `${cdm.label(row.item)} — over ${cdm.label(bundle)}`,
    qtyLabel: consumedLabel(row, row.overage),
    amount: row.amount,
    payer: row.payer,
    patient: row.patient,
    action: row.action,
    source: row.source,
    status: row.status,
  };
}

/**
 * A tolerance is read in its own unit: a percentage of what the bundle
 * includes (nights, or the allowance in money), an amount against the money
 * the overrun is worth.
 */
function withinTolerance(tolerance, row) {
  const value = Number(tolerance?.value) || 0;
  if (!tolerance?.type || value <= 0) return false;
  if (tolerance.type === '%') return row.overage <= cents((row.included * value) / 100);
  return row.amount <= value;
}

/** Who pays for the overrun. Mutates and returns the row it was handed. */
function applyAction(row, contract, planId) {
  if (row.action === 'Not Billable (Absorb)') {
    row.status = 'Absorbed';
    row.note = 'The hospital absorbs it — nothing is billed on top of the bundle.';
    return row;
  }
  if (row.action === 'Bill Payer at Contract Rate') {
    row.payer = row.amount;
    row.status = 'Billable';
    row.note = row.unit === 'amount' ? 'Billed to the payer.' : `Billed to the payer at ${usd(row.price)} each.`;
    return row;
  }
  if (row.action === 'Bill Patient') {
    row.patient = row.amount;
    row.status = 'Billable';
    row.note = 'Billed to the patient in full.';
    return row;
  }
  if (row.action === 'Split per Coverage') {
    const coverage = contracts.resolveCoverage(contract, planId, row.item);
    row.patient = contracts.patientShare(row.amount, coverage);
    row.payer = cents(row.amount - row.patient);
    row.status = 'Billable';
    row.note = coverage
      ? `Split by ${contracts.scopeLabel(coverage)} — patient ${contracts.shareSummary(coverage)}.`
      : 'No coverage row names this component, so the payer carries it.';
    return row;
  }
  if (row.action === 'Requires Approval') {
    row.status = 'Held for approval';
    row.note = 'The amount is computed, and it bills once the payer approves it.';
    return row;
  }
  row.status = 'Absorbed';
  row.note = 'No policy answers for this component, so nothing is billed on top.';
  return row;
}
