// Engine — eligibility. Pure: it reads the patient, the policy and the contract
// configuration and answers whether the cover applies on a date. No DOM, no
// writes, no store commits — the screen that calls it decides what to record.
//
// One function answers for every caller, which is the point: the check run at
// the desk and the one Encounter Registration runs inline cannot disagree,
// because there is only one implementation of the ladder.
//
// The ladder is six steps in a fixed order. The first three decide whether the
// cover exists at all — a closed record, a lapsed policy or a missing contract
// is Not Eligible and nothing below it is worth asking. The last three never
// refuse: they raise conditions, which is what a desk clerk acts on before the
// patient is admitted.

import * as contracts from '../repositories/contracts.js';
import * as cdm from '../repositories/cdm.js';
import { date as showDate, iso, todayIso, usd, withinDates } from '../../shared/format.js';

export const RESULTS = ['Eligible', 'Eligible with Conditions', 'Not Eligible', 'Self-Pay'];

/** How a patient arrives. A registration fact, not a contract one — see below. */
export const VISIT_TYPES = ['Outpatient', 'Inpatient', 'Emergency', 'Day Case'];

/** Passed as the policy when the patient pays for themselves. */
export const SELF_PAY = 'SELF_PAY';

/**
 * Visit type and the contract's admission type are two vocabularies that happen
 * to share two words. Only those two are handed to the rate resolver: guessing
 * that an inpatient visit is Elective would price the encounter off a
 * methodology nobody chose.
 */
export const ADMISSION_OF = { Emergency: 'Emergency', 'Day Case': 'Day Case' };

/**
 * How the ladder learns that a pre-authorisation flag has already been
 * answered. `data/repositories/preauth-requests.js` pushes its `activeFor`
 * lookup here as it loads, the way a repository pushes a re-link hook: the
 * engine asks the question and never learns what a request is, so it stays a
 * leaf and no cycle can form between the two.
 *
 * A hook takes (mrn, itemId, isoDate) and answers `{ no, validTo, remaining }`
 * for an authorisation in force, or null.
 */
export const authorizationHooks = [];

/** The first hook with an answer wins; with none registered, nothing is held. */
export function authorizationFor(mrn, itemId, on) {
  if (!mrn || !itemId) return null;
  for (const hook of authorizationHooks) {
    const found = hook(mrn, itemId, on);
    if (found) return found;
  }
  return null;
}

const STEP_LABELS = {
  patientStatus: 'Patient status',
  policyValidity: 'Policy validity',
  contract: 'Contract in force',
  coverage: 'Coverage',
  preAuth: 'Pre-authorisation',
  referral: 'Referral',
};

export function resultTone(result) {
  if (result === 'Eligible') return 'success';
  if (result === 'Eligible with Conditions') return 'warning';
  if (result === 'Not Eligible') return 'critical';
  return '';
}

export const isPass = (result) => result === 'Eligible' || result === 'Eligible with Conditions';

/**
 * verify({ patient, policy, date, visitType, services }) — the whole ladder.
 *
 * `policy` is a policy row, or the SELF_PAY sentinel, which short-circuits: a
 * self-paying patient has nothing to verify against, so the steps are skipped
 * and the answer is Self-Pay rather than a refusal.
 *
 * `services` is [{ itemId, qty }] and is optional. With no services the
 * coverage step answers off the plan's Default row alone, which is what a
 * pre-admission check at the desk actually knows.
 *
 * `referral` is whether a referral is already in hand for this visit — a
 * boolean, because the ladder only ever asks whether one exists, never which.
 */
export function verify({
  patient = null, policy = null, date = todayIso(), visitType = null, services = [], referral = false,
} = {}) {
  const on = iso(date) || todayIso();
  if (policy === SELF_PAY) return selfPayResult();

  const steps = [];
  const conditions = [];
  const failureReasons = [];
  const lines = normalize(services);

  const one = statusStep(patient);
  steps.push(one);

  const two = validityStep(policy, on, one.pass);
  steps.push(two);

  const three = contractStep(policy, on, one.pass && two.pass);
  steps.push(three);

  const contract = three.contract || null;
  const gate = one.pass && two.pass && three.pass;

  const four = coverageStep(contract, policy, on, visitType, lines, gate);
  steps.push(four.step);

  const five = preAuthStep(contract, four.rows, gate, patient?.mrn || '', on);
  steps.push(five.step);

  const six = referralStep(contract, four.rows, Boolean(referral), gate);
  steps.push(six.step);

  for (const step of steps) if (!step.pass && !step.skipped && step.reason) failureReasons.push(step.reason);
  conditions.push(...four.conditions, ...five.conditions, ...six.conditions);

  const result = !gate ? 'Not Eligible' : conditions.length ? 'Eligible with Conditions' : 'Eligible';

  return {
    result,
    steps,
    conditions,
    // Only the first three steps can refuse cover; the last two raise conditions.
    failureReasons: gate ? [] : failureReasons,
    coverageSummary: four.summary,
    contract: contract ? { id: contract.id, no: contract.contractNo, version: contract.version } : null,
  };
}

/** No policy, no ladder: the patient pays, and the check records that decision. */
function selfPayResult() {
  return {
    result: 'Self-Pay',
    steps: Object.entries(STEP_LABELS).map(([key, label]) => ({
      key,
      label,
      pass: false,
      skipped: true,
      detail: 'Not checked — the patient is paying for themselves.',
    })),
    conditions: ['The patient is responsible for the whole bill. No payer is involved.'],
    failureReasons: [],
    // There is no cover to summarise, which is not the same as a cover that
    // summarises to nothing — the screens draw no coverage panel for a null.
    coverageSummary: null,
    contract: null,
  };
}

// --- steps -------------------------------------------------------------------

function statusStep(patient) {
  const step = { key: 'patientStatus', label: STEP_LABELS.patientStatus, pass: false, detail: '' };
  if (!patient) {
    step.detail = 'No patient chosen.';
    step.reason = 'No patient was named on this check.';
    return step;
  }
  if (patient.status === 'Active') {
    step.pass = true;
    step.detail = `${patient.mrn} is Active and can be registered.`;
    return step;
  }
  step.detail = `${patient.mrn} is ${patient.status}.`;
  step.reason = patient.status === 'Merged'
    ? `Record ${patient.mrn} was merged into ${patient.mergedInto} — verify the record that survived.`
    : `A ${patient.status.toLowerCase()} record cannot be verified for cover.`;
  return step;
}

function validityStep(policy, on, ran) {
  const step = { key: 'policyValidity', label: STEP_LABELS.policyValidity, pass: false, detail: '' };
  if (!ran) return skip(step);
  if (!policy) {
    step.detail = 'No policy chosen.';
    step.reason = 'No policy was named on this check.';
    return step;
  }
  if (policy.status !== 'Active') {
    step.detail = `Policy is ${policy.status}.`;
    step.reason = `The policy is ${policy.status.toLowerCase()}${policy.statusReason ? ` — ${trimStop(policy.statusReason)}` : ''}.`;
    return step;
  }
  if (!withinDates(on, policy.validFrom, policy.validTo)) {
    step.detail = `Valid ${showDate(policy.validFrom)} – ${showDate(policy.validTo)}, checked for ${showDate(on)}.`;
    step.reason = `The policy does not cover ${showDate(on)}: it runs ${showDate(policy.validFrom)} to ${showDate(policy.validTo)}.`;
    return step;
  }
  step.pass = true;
  step.detail = `Active, valid ${showDate(policy.validFrom)} – ${showDate(policy.validTo)}.`;
  return step;
}

function contractStep(policy, on, ran) {
  const step = { key: 'contract', label: STEP_LABELS.contract, pass: false, detail: '' };
  if (!ran) return skip(step);
  const contract = contracts.contractForService(policy.payerId, policy.planId, on);
  if (!contract) {
    step.detail = `No contract version billed this plan on ${showDate(on)}.`;
    step.reason = `No contract covers this payer and plan on ${showDate(on)}, so the encounter has no rates to price against.`;
    return step;
  }
  step.pass = true;
  step.contract = contract;
  step.detail = `${contract.contractNo} v${contract.version} — ${contract.name}, ${showDate(contract.startDate)} – ${showDate(contract.endDate)}.`;
  return step;
}

/**
 * Coverage never refuses. A service the plan excludes is a condition the clerk
 * tells the patient about, not a reason to turn the cover down — the payer
 * still answers for everything else on the encounter.
 */
function coverageStep(contract, policy, on, visitType, lines, ran) {
  const step = { key: 'coverage', label: STEP_LABELS.coverage, pass: false, detail: '' };
  // A refused check never reached coverage, so it carries none — reporting an
  // empty summary would read as "nothing is covered", which is a different
  // answer from "this was never asked".
  if (!ran) return { step: skip(step), rows: [], conditions: [], summary: null };

  const planId = policy.planId;
  const admission = ADMISSION_OF[visitType] || null;
  const fallback = contracts.resolveCoverage(contract, planId, null);
  const summary = {
    rows: [],
    defaultRule: fallback ? contracts.shareSummary(fallback) : null,
    // No accumulator yet: the ceiling is the whole allowance on every check.
    ceilingRemaining: fallback?.ceiling ?? null,
    exclusions: [],
  };
  const conditions = [];

  if (!fallback) {
    conditions.push('This plan has no default coverage row on the contract, so the split is unresolved until one is added.');
  }

  for (const line of lines) {
    const item = cdm.get(line.itemId);
    if (!item) continue;
    const allowed = round(contracts.resolvedPrice(contract, item, on, admission) * line.qty);
    const rule = contracts.resolveCoverage(contract, planId, item);
    const row = {
      itemId: item.id,
      service: `${item.chargeCode} — ${cdm.label(item)}`,
      qty: line.qty,
      allowed,
      covered: Boolean(rule?.covered),
      shareRule: rule ? contracts.shareSummary(rule) : '—',
      scope: rule ? contracts.scopeLabel(rule) : null,
      ceiling: rule?.ceiling ?? null,
      estimatedPatientShare: contracts.patientShare(allowed, rule),
    };
    summary.rows.push(row);
    if (!row.covered) {
      summary.exclusions.push(row.service);
      conditions.push(`${cdm.label(item)} is not covered — patient responsibility (${usd(allowed)}).`);
    }
    if (row.ceiling) conditions.push(`Ceiling ${usd(row.ceiling)} applies to ${cdm.label(item)}.`);
  }

  if (!summary.rows.length && summary.ceilingRemaining) {
    conditions.push(`Ceiling ${usd(summary.ceilingRemaining)} applies to the patient share on this plan.`);
  }

  const covered = summary.rows.filter((r) => r.covered).length;
  step.pass = Boolean(fallback) && !summary.exclusions.length;
  step.detail = summary.rows.length
    ? `${covered} of ${summary.rows.length} anticipated ${summary.rows.length === 1 ? 'service is' : 'services are'} covered · default ${summary.defaultRule || 'none'}.`
    : `No services named — the plan's default rule is ${summary.defaultRule || 'not configured'}.`;

  return { step, rows: summary.rows, conditions, summary };
}

/**
 * Pre-auth answers per charge and only ever raises conditions.
 *
 * A charge the payer has already authorised is still a charge the payer wants
 * authorised — the requirement has not gone away, it has been met — so it keeps
 * its condition and the answer keeps its result. What changes is the sentence:
 * "Pre-auth required" becomes "Authorised — PA-…, valid until …", which is the
 * difference between something to chase and something on file.
 */
function preAuthStep(contract, rows, ran, mrn, on) {
  const step = { key: 'preAuth', label: STEP_LABELS.preAuth, pass: false, detail: '' };
  if (!ran) return { step: skip(step), conditions: [] };
  if (!rows.length) {
    step.pass = true;
    step.detail = 'No services named — pre-authorisation is answered per charge.';
    return { step, conditions: [] };
  }

  const conditions = [];
  let required = 0;
  let held = 0;
  for (const row of rows) {
    const item = cdm.get(row.itemId);
    const answer = contracts.resolvePreAuth(contract, item, row.allowed);
    row.preAuth = { required: answer.required, reason: answer.reason, authorization: null };
    if (!answer.required) continue;
    required += 1;
    const auth = authorizationFor(mrn, row.itemId, on);
    if (auth) {
      held += 1;
      row.preAuth.authorization = auth;
      conditions.push(`Authorised: ${cdm.label(item)} — ${auth.no}, valid until ${showDate(auth.validTo)}.`);
      continue;
    }
    conditions.push(`Pre-auth required: ${cdm.label(item)} — ${answer.reason}`);
  }

  step.pass = required === 0;
  step.detail = required
    ? `${required} of ${rows.length} ${rows.length === 1 ? 'service needs' : 'services need'} approval before the encounter${
      held ? `, and ${held === required ? 'each of those is' : `${held} of them ${held === 1 ? 'is' : 'are'}`} authorised already` : ''}.`
    : `None of the ${rows.length} anticipated ${rows.length === 1 ? 'service needs' : 'services need'} approval.`;
  return { step, conditions };
}

/**
 * Referral. The payer wants a doctor behind the visit, and this is the last
 * thing the ladder asks — like pre-auth it only ever raises a condition, since
 * a referral that is missing at the desk is a referral that can still be
 * chased. With no services named the contract's own row is the answer, which is
 * the question a pre-admission check can actually ask.
 */
function referralStep(contract, rows, hasReferral, ran) {
  const step = { key: 'referral', label: STEP_LABELS.referral, pass: false, detail: '' };
  if (!ran) return { step: skip(step), conditions: [] };

  const needed = rows.length
    ? rows.filter((row) => contracts.referralRequired(contract, cdm.get(row.itemId)))
    : (contracts.referralRequired(contract, null) ? [null] : []);

  if (!needed.length) {
    step.pass = true;
    step.detail = rows.length
      ? `None of the ${rows.length} anticipated ${rows.length === 1 ? 'service needs' : 'services need'} a referral.`
      : 'This agreement does not ask for a referral.';
    return { step, conditions: [] };
  }
  if (hasReferral) {
    step.pass = true;
    step.detail = 'A referral is on file for this visit.';
    return { step, conditions: [] };
  }

  const named = needed.filter(Boolean).map((row) => cdm.label(cdm.get(row.itemId))).filter(Boolean);
  step.detail = named.length
    ? `${named.length} of ${rows.length} ${named.length === 1 ? 'service needs' : 'services need'} a referral, and none is on file.`
    : 'This agreement asks for a referral on every visit, and none is on file.';
  return {
    step,
    conditions: [`Referral required by payer — missing${named.length ? ` (${named.join(', ')})` : ''}.`],
  };
}

// --- internals ---------------------------------------------------------------

/**
 * A step below a failed one is not a fail — it was never asked. The checklist
 * draws it as a dash, so the reader sees which answer actually refused cover.
 */
function skip(step) {
  step.skipped = true;
  step.detail = 'Not checked — an earlier step failed.';
  return step;
}

const normalize = (services) =>
  (Array.isArray(services) ? services : [])
    .filter((s) => s && s.itemId)
    .map((s) => ({ itemId: s.itemId, qty: Math.max(1, Number(s.qty) || 1) }));

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** A stored reason may or may not end in a full stop; the sentence adds its own. */
const trimStop = (text) => String(text).trim().replace(/\.+$/, '');
