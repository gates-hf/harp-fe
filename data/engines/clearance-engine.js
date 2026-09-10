// Engine — financial clearance. The one place the checklist is decided.
//
// Clearance is a computed view, not a form. Nothing here is stored by a clerk
// ticking a box: the five items are read every time from the records that
// actually answer them — the eligibility snapshot the encounter was classified
// on, the referral linked to it, the authorisations covering its services, the
// estimate it was quoted from and the money taken against it. Which is what
// makes regression automatic: an authorisation that lapses overnight, or a
// check that ages past its window, flips its item on the next compute without
// anybody revisiting the encounter.
//
// Pure: it reads repositories, writes nothing and touches no DOM. The stamp is
// written by data/repositories/clearance.js, which is also what recomputes.
//
// It never imports data/repositories/encounters.js — the encounter arrives as
// an argument. That is deliberate: this engine reads six repositories and two
// of them (referrals, estimates, preauth-requests) reach the encounter register
// through their own seeds, so an arrow from encounters.js back to here would
// close a cycle. The wiring file owns both ends instead.

import * as eligibility from '../repositories/eligibility.js';
import * as referrals from '../repositories/referrals.js';
import * as preauth from '../repositories/preauth-requests.js';
import * as estimates from '../repositories/estimates.js';
import * as acknowledgments from '../repositories/acknowledgments.js';
import * as payments from '../repositories/payments.js';
import * as accounts from '../repositories/accounts.js';
import * as contracts from '../repositories/contracts.js';
import * as payers from '../repositories/payers.js';
import * as cdm from '../repositories/cdm.js';
import { CONFIG } from '../../shared/config.js';
import { compareDates, date as showDate, iso, todayIso, usd } from '../../shared/format.js';

/** The three answers clearance gives, worst first — the order the list sorts in. */
export const STATUSES = ['Blocked', 'Conditionally Cleared', 'Cleared'];

/** The four states one item can be in. Only two of them hold a visit up. */
export const STATES = ['Passed', 'Pending', 'Failed', 'N/A'];

/** The five items, in the order the desk works them. */
export const ITEM_KEYS = ['eligibility', 'referral', 'preauth', 'acknowledgment', 'payment'];

export const ITEM_LABELS = {
  eligibility: 'Eligibility',
  referral: 'Referral',
  preauth: 'Pre-authorisation',
  acknowledgment: 'Estimate acknowledged',
  payment: 'Payment / deposit',
};

export function statusTone(status) {
  if (status === 'Cleared') return 'success';
  if (status === 'Blocked') return 'critical';
  if (status === 'Conditionally Cleared') return 'warning';
  return '';
}

export function stateTone(state) {
  if (state === 'Passed') return 'success';
  if (state === 'Failed') return 'critical';
  if (state === 'Pending') return 'warning';
  return '';
}

export function stateIcon(state) {
  if (state === 'Passed') return 'check_circle';
  if (state === 'Failed') return 'cancel';
  if (state === 'Pending') return 'pending';
  return 'remove';
}

/** Short words for the status chip, where the whole phrase will not fit. */
export const shortStatus = (status) => (status === 'Conditionally Cleared' ? 'Conditional' : status);

/** An item nobody has to act on: it passed, or it was never asked. */
export const isSettled = (item) => item.state === 'Passed' || item.state === 'N/A';

// --- the computation ----------------------------------------------------------

/**
 * compute(encounter, ctx) -> { status, items, blocking, pendingSince }
 *
 * `ctx.on` is the day the question is asked, which is today everywhere except a
 * test. The service date — what a contract, an authorisation and a check are
 * all read against — is the encounter's own start, because that is the day the
 * money is owed for.
 */
export function compute(encounter, { on = todayIso() } = {}) {
  const enc = encounter || null;
  if (!enc) return { status: 'Blocked', items: [], blocking: [], pendingSince: null };

  const ctx = context(enc, on);
  const items = [
    eligibilityItem(ctx),
    referralItem(ctx),
    preauthItem(ctx),
    acknowledgmentItem(ctx),
    paymentItem(ctx),
  ];

  const unsettled = items.filter((item) => !isSettled(item));
  const status = items.some((item) => item.state === 'Failed')
    ? 'Blocked'
    : unsettled.length ? 'Conditionally Cleared' : 'Cleared';

  const pendingSince = unsettled
    .map((item) => item.since)
    .filter(Boolean)
    .sort()[0] || null;

  return { status, items, blocking: unsettled.map((item) => item.short), pendingSince };
}

/**
 * Everything the five items read, gathered once. The service date is clamped to
 * nothing — a visit booked for next week is asked about next week, because that
 * is when the cover has to hold.
 */
function context(enc, on) {
  const serviceDate = iso(String(enc.startAt).slice(0, 10)) || on;
  const selfPay = !enc.financial?.payerId;
  const payer = enc.financial?.payerId ? payers.get(enc.financial.payerId) : null;
  const contract = selfPay
    ? null
    : contracts.contractForService(enc.financial.payerId, enc.financial.planId, serviceDate);
  const estimate = estimateFor(enc);
  return {
    enc,
    on,
    serviceDate,
    selfPay,
    payer,
    payerName: payer?.nameEn || 'the payer',
    contract,
    estimate,
    services: anticipated(enc, estimate),
    mode: modeKey(enc),
  };
}

/**
 * The config keys are spelled by encounter type, with Day Case reserved: the
 * board has no such type — a day case is booked as an outpatient visit — but
 * estimates and pre-registrations do, and the key is here for when one is.
 */
const modeKey = (enc) => (enc?.type === 'IP' || enc?.type === 'ER' ? enc.type : 'OP');

/**
 * The estimate this encounter is priced against, narrowest claim first: the one
 * an acknowledgment already names, then one converted or linked to the visit,
 * then a live quotation for this patient that is actually about this visit —
 * same department and same kind of stay. A valid estimate for another
 * department is a quotation for something else and is not offered here.
 */
export function estimateFor(enc) {
  if (!enc?.patientMrn) return null;
  const named = acknowledgments.byEncounter(enc.no)[0]?.estimateNo;
  if (named && estimates.get(named)) return estimates.get(named);

  const linked = estimates.byEncounter(enc.no).find((row) => row.result);
  if (linked) return linked;

  return estimates
    .validForClearance(enc.patientMrn)
    .find((row) => aboutThisVisit(row, enc)) || null;
}

const aboutThisVisit = (estimate, enc) => {
  const quoted = estimate?.context || {};
  if (quoted.department && quoted.department !== enc.department) return false;
  return TYPE_OF_VISIT[quoted.visitType] === enc.type;
};

/** The estimate's vocabulary read back into the board's, Day Case folded into OP. */
const TYPE_OF_VISIT = {
  Outpatient: 'OP', Inpatient: 'IP', Emergency: 'ER', 'Day Case': 'OP',
};

/**
 * What this visit is expected to cost money for — the question the referral and
 * pre-auth rules are asked about. Three registers know part of the answer and
 * none of them knows all of it, so the union is taken: the estimate's lines,
 * the services the eligibility check was run for, and the services somebody has
 * already raised an authorisation request over.
 */
export function anticipated(enc, estimate = estimateFor(enc)) {
  const found = new Map();
  const add = (itemId, qty = 1) => {
    if (!itemId || !cdm.get(itemId)) return;
    found.set(itemId, Math.max(found.get(itemId) || 0, Math.max(1, Number(qty) || 1)));
  };

  for (const line of estimate?.lines || []) add(line.itemId, line.qty);

  const snapshot = enc?.financial?.snapshotRef ? eligibility.get(enc.financial.snapshotRef) : null;
  for (const service of snapshot?.services || []) add(service.itemId, service.qty);

  for (const request of preauth.byEncounter(enc?.no)) {
    for (const service of request.services || []) add(service.itemId, service.qty);
  }

  return [...found].map(([itemId, qty]) => ({ itemId, qty, item: cdm.get(itemId) }));
}

/**
 * What one line is worth, which is what a threshold rule is read against. The
 * estimate's own allowed amount when there is one — the figure the fee report,
 * the coverage preview and the billing simulator all answer for — and the
 * charge master's price when there is not.
 */
function amountOf(ctx, service) {
  const rows = ctx.estimate?.result?.rows || [];
  const row = rows.find((r) => r.chargeCode && r.chargeCode === service.item?.chargeCode);
  if (row && Number.isFinite(Number(row.allowed))) return Number(row.allowed);
  return (Number(service.item?.standardPrice) || 0) * service.qty;
}

// --- item 1: eligibility ------------------------------------------------------

function eligibilityItem(ctx) {
  const item = base('eligibility');
  if (ctx.selfPay) return na(item, 'Self-Pay encounter', 'Self-Pay encounter — there is no cover to verify.');

  const recheck = {
    label: 'Re-check eligibility',
    route: `#/frontis/eligibility/new?mrn=${ctx.enc.patientMrn}`
      + `${ctx.enc.financial.policyId ? `&policyId=${ctx.enc.financial.policyId}` : ''}`
      + `&encounterId=${ctx.enc.no}`,
  };

  // The item asks whether there is a good check on this cover — not whether the
  // one the visit happened to be classified on is still good. Re-check writes a
  // new snapshot and never re-points the classification, so an item reading
  // `financial.snapshotRef` alone could never be answered.
  //
  // So: the newest *passing* check on this cover, and the classification's own
  // snapshot when nothing on it has ever passed. Newest-of-any would be wrong
  // in both directions — it would let a pre-check run for some other visit fail
  // this one, and it would throw away a supervisor's override, which is a pass
  // recorded against exactly the refusal it answers.
  const ref = ctx.enc.financial?.snapshotRef;
  const classified = ref ? eligibility.get(ref) : null;
  const onCover = eligibility
    .byPatient(ctx.enc.patientMrn)
    .filter((row) => (row.policyId || null) === (ctx.enc.financial?.policyId || null));
  const snapshot = onCover.find((row) => eligibility.isPass(row.finalResult)) || classified || onCover[0];

  if (!snapshot) {
    return pending(item, 'Re-check needed',
      'No eligibility check is recorded against this encounter. Run one before the cover is relied on.',
      recheck, ctx.enc.createdAt);
  }

  const checkedOn = String(snapshot.checkedAt).slice(0, 10);
  const result = snapshot.finalResult;
  const overridden = Boolean(snapshot.override);
  // The visit was opened under one check and may be being read against a later
  // one, so the line names both rather than quietly swapping them.
  const later = classified && classified.ref !== snapshot.ref
    ? ` · re-checked since ${classified.ref}` : '';
  const trail = `${snapshot.ref} · checked ${showDate(checkedOn)}${overridden ? ' · overridden' : ''}${later}`;

  if (result === 'Not Eligible') {
    return fail(item, 'Not eligible',
      `${trail} — ${(snapshot.failureReasons || []).join(' ') || 'the payer refused cover for this visit.'}`,
      recheck, snapshot.checkedAt);
  }

  const age = daysBetween(checkedOn, ctx.serviceDate);
  if (age > eligibility.REUSE_DAYS) {
    return pending(item, 'Re-check needed',
      `${trail} — ${age} days before the service date, past the ${eligibility.REUSE_DAYS}-day window.`,
      recheck, snapshot.checkedAt);
  }

  if (!eligibility.isPass(result)) {
    return pending(item, 'Re-check needed', `${trail} — ${result}.`, recheck, snapshot.checkedAt);
  }

  // A check with conditions can carry four or five sentences. The first one is
  // what the desk acts on and the rest are on the snapshot, so the line names
  // one and counts the others rather than reprinting the whole answer.
  const conditions = snapshot.conditions || [];
  const rest = conditions.length - 1;
  return pass(item,
    `${trail} — ${result}${conditions.length
      ? `. ${conditions[0]}${rest > 0 ? ` (+${rest} more condition${rest === 1 ? '' : 's'} on the check)` : ''}`
      : '.'}`,
    { label: 'View snapshot', route: `#/frontis/eligibility/${snapshot.ref}` });
}

// --- item 2: referral ---------------------------------------------------------

function referralItem(ctx) {
  const item = base('referral');
  if (ctx.selfPay) return na(item, 'Self-Pay encounter', 'Self-Pay encounter — no payer is asking for a referral.');
  if (!ctx.contract) {
    return na(item, 'No agreement',
      `No agreement with ${ctx.payerName} covers this plan on ${showDate(ctx.serviceDate)}, so no referral rule applies.`);
  }

  const named = ctx.services.filter((s) => contracts.referralRequired(ctx.contract, s.item));
  const required = ctx.services.length
    ? named.length > 0
    : contracts.referralRequired(ctx.contract, null);
  if (!required) {
    return na(item, `Not required by ${ctx.payerName}`,
      `Not required by ${ctx.payerName} — ${ctx.contract.contractNo} asks for no referral on the services expected here.`);
  }

  const because = named.length
    ? `Required for ${named.map((s) => cdm.label(s.item)).join(', ')}.`
    : `Required across ${ctx.contract.contractNo}.`;
  const find = {
    label: 'Link referral',
    route: `#/frontis/referrals?view=all&q=${encodeURIComponent(ctx.enc.patientMrn)}`,
  };

  const linkedId = ctx.enc.linked?.referralId;
  if (!linkedId) {
    return fail(item, 'Referral missing',
      `Referral required by ${ctx.payerName} — missing. ${because}`, find, ctx.enc.createdAt);
  }

  const referral = referrals.get(linkedId);
  if (!referral) {
    return fail(item, 'Referral missing',
      `${linkedId} is linked to this encounter but is no longer on the register.`, find, ctx.enc.createdAt);
  }

  const view = { label: 'Open referral', route: `#/frontis/referrals/${referral.no}/view` };
  // A referral spent on this very visit is answered, whatever it says now: one
  // visit came off it here, which is exactly what it was written for.
  const spentHere = (referral.encounterNos || []).includes(ctx.enc.no);
  if (spentHere) {
    return pass(item,
      `${referral.no} — ${referrals.sourceLabel(referral)}, spent on this visit. ${because}`, view);
  }
  if (referral.validUntil && compareDates(referral.validUntil, ctx.serviceDate) < 0) {
    return fail(item, 'Referral expired',
      `${referral.no} lapsed on ${showDate(referral.validUntil)}, before the service date.`, view, referral.validUntil);
  }
  if (referrals.remaining(referral) <= 0) {
    return fail(item, 'Referral used up',
      `${referral.no} has no visits left — all ${referral.visits?.total || 1} have been spent elsewhere.`,
      view, ctx.enc.createdAt);
  }
  return pass(item, `${referral.no} — ${referrals.sourceLabel(referral)}, valid to ${
    referral.validUntil ? showDate(referral.validUntil) : 'no end date'}. ${because}`, view);
}

// --- item 3: pre-authorisation ------------------------------------------------

function preauthItem(ctx) {
  const item = base('preauth');
  if (ctx.selfPay) return na(item, 'Self-Pay encounter', 'Self-Pay encounter — there is no payer to ask.');
  if (!ctx.contract) {
    return na(item, 'No agreement',
      `No agreement with ${ctx.payerName} covers this plan on ${showDate(ctx.serviceDate)}, so nothing requires prior approval.`);
  }

  const flagged = ctx.services.filter(
    (s) => contracts.resolvePreAuth(ctx.contract, s.item, amountOf(ctx, s)).required,
  );
  const answers = flagged.map((service) => answerFor(ctx, service));
  // A request already raised against this visit is clearance work whether or
  // not the contract still flags what it was raised for. Somebody asked the
  // payer for a reason, and an approval that lapsed under an open encounter is
  // exactly the thing that gets missed.
  answers.push(...requestAnswers(ctx, answers));

  if (!answers.length) {
    return na(item, 'No prior approval needed',
      `No service requires prior approval — ${ctx.contract.contractNo} flags none of the ${
        ctx.services.length || 'anticipated'} lines on this visit, and no request has been raised against it.`);
  }

  const detail = answers.map((a) => a.line).join(' ');
  const worst = answers.some((a) => a.state === 'Failed')
    ? 'Failed' : answers.some((a) => a.state === 'Pending') ? 'Pending' : 'Passed';
  const since = answers.map((a) => a.since).filter(Boolean).sort()[0] || ctx.enc.createdAt;
  const worstShort = answers.find((a) => a.state === worst)?.short || 'Pre-auth outstanding';

  const named = answers.find((a) => a.state === worst && a.no) || answers.find((a) => a.no);
  const create = {
    label: named ? 'Open request' : 'Create request',
    route: named
      ? `#/frontis/preauth/${named.no}`
      : `#/frontis/preauth/new?mrn=${ctx.enc.patientMrn}&encounterNo=${ctx.enc.no}`,
  };

  if (worst === 'Passed') return pass(item, detail, create);
  if (worst === 'Pending') return pending(item, worstShort, detail, create, since);
  return fail(item, worstShort, detail, create, since);
}

/**
 * The requests hanging off this encounter that the flagged-service pass did not
 * already speak for — the physiotherapy course approved a month ago and lapsed
 * last night, the request still with the payer for a charge the contract stopped
 * flagging. One line each, and never a second line about a request already named.
 */
function requestAnswers(ctx, already) {
  const named = new Set(already.map((a) => a.no).filter(Boolean));
  const out = [];
  for (const row of preauth.byEncounter(ctx.enc.no)) {
    if (named.has(row.no)) continue;
    const services = preauth.servicesLabel(row);
    if (preauth.isPending(row)) {
      out.push({
        state: 'Pending', no: row.no, short: 'Pre-auth pending', since: row.submittedAt,
        line: `${row.no} (${services}) is with ${ctx.payerName}, submitted ${
          showDate(String(row.submittedAt).slice(0, 10))}.`,
      });
    } else if (row.status === 'Expired') {
      out.push({
        state: 'Failed', no: row.no, short: 'Pre-auth expired', since: row.decision?.validTo,
        line: `${row.no} (${services}) lapsed on ${showDate(row.decision?.validTo)} and has to be renewed.`,
      });
    } else if (row.status === 'Denied') {
      out.push({
        state: 'Failed', no: row.no, short: 'Pre-auth denied', since: row.decision?.capturedAt,
        line: `${row.no} (${services}) was refused — ${preauth.denialLabel(row.decision?.denialReasonCode)}.`,
      });
    }
    named.add(row.no);
  }
  return out;
}

/** One flagged charge's answer: authorised, with the payer, or nothing at all. */
function answerFor(ctx, service) {
  const name = cdm.label(service.item);
  const mrn = ctx.enc.patientMrn;

  const active = preauth.activeFor(mrn, service.itemId, ctx.serviceDate);
  if (active) {
    return {
      state: 'Passed', no: active.no, short: '',
      line: `${name}: authorised on ${active.no} (${active.authNumber}), valid to ${showDate(active.validTo)}.`,
    };
  }

  const mine = preauth.byPatient(mrn).filter(
    (row) => (row.services || []).some((s) => s.itemId === service.itemId),
  );

  const submitted = mine.find((row) => preauth.isPending(row));
  if (submitted) {
    return {
      state: 'Pending', no: submitted.no, short: 'Pre-auth pending', since: submitted.submittedAt,
      line: `${name}: ${submitted.no} is with ${ctx.payerName}, submitted ${showDate(String(submitted.submittedAt).slice(0, 10))}.`,
    };
  }

  const denied = mine.find((row) => row.status === 'Denied');
  if (denied) {
    return {
      state: 'Failed', no: denied.no, short: 'Pre-auth denied', since: denied.decision?.capturedAt,
      line: `${name}: refused on ${denied.no} — ${preauth.denialLabel(denied.decision?.denialReasonCode)}.`,
    };
  }

  const expired = mine.find((row) => row.status === 'Expired');
  if (expired) {
    return {
      state: 'Failed', no: expired.no, short: 'Pre-auth expired', since: expired.decision?.validTo,
      line: `${name}: ${expired.no} lapsed on ${showDate(expired.decision?.validTo)} and has to be renewed.`,
    };
  }

  const spent = mine.find((row) => preauth.isAuthorized(row));
  if (spent) {
    return {
      state: 'Failed', no: spent.no, short: 'Pre-auth used up',
      line: `${name}: nothing left on ${spent.no} — the approved quantity is spent.`,
    };
  }

  const draft = mine.find((row) => preauth.isDraft(row));
  return {
    state: 'Failed', no: draft?.no, short: 'Pre-auth missing',
    line: draft
      ? `${name}: ${draft.no} is still a draft — it has not been sent to ${ctx.payerName}.`
      : `${name}: prior approval is required and no request has been raised.`,
  };
}

// --- item 4: estimate acknowledged --------------------------------------------

function acknowledgmentItem(ctx) {
  const item = base('acknowledgment');
  const typeLabel = TYPE_WORDS[ctx.enc.type] || ctx.enc.type;
  if (!CONFIG.clearance.acknowledgmentRequired[ctx.mode]) {
    return na(item, `Not required for ${typeLabel}`,
      `Not required for ${typeLabel} — the patient signs for a quotation only where one has to be given in advance.`);
  }

  if (!ctx.estimate) {
    return fail(item, 'No estimate issued',
      'No estimate issued — there is nothing for the patient to acknowledge.',
      { label: 'Create estimate', route: `#/frontis/estimates/new?mrn=${ctx.enc.patientMrn}&encounterNo=${ctx.enc.no}` },
      ctx.enc.createdAt);
  }

  const open = { label: 'Open estimate', route: `#/frontis/estimates/${ctx.estimate.no}` };
  const ack = acknowledgments.byEncounter(ctx.enc.no)[0];
  if (!ack) {
    return pending(item, 'Not acknowledged',
      `${ctx.estimate.no} was issued for ${usd(ctx.estimate.result?.totals?.patientShare || 0)} to the patient. `
      + 'Awaiting patient acknowledgment.',
      { label: 'Acknowledge', act: 'acknowledge' }, ctx.estimate.issuedAt || ctx.enc.createdAt);
  }

  return pass(item,
    `${ack.estimateNo} acknowledged by ${acknowledgments.byLabel(ack)} — ${ack.method}, ${showDate(String(ack.at).slice(0, 10))}.`,
    open);
}

const TYPE_WORDS = { OP: 'an outpatient visit', IP: 'an admission', ER: 'an emergency attendance' };

// --- item 5: payment / deposit ------------------------------------------------

function paymentItem(ctx) {
  const item = base('payment');
  const money = depositFor(ctx.enc, ctx.estimate);
  if (money.mode === 'None') {
    return na(item, 'No payment before service',
      `No payment required before service on ${TYPE_WORDS[ctx.enc.type] || ctx.enc.type}.`);
  }

  if (!money.estimate?.result) {
    return pending(item, 'Deposit not computed',
      'Estimate needed to compute the deposit — the patient share is what the deposit is a share of.',
      { label: 'Create estimate', route: `#/frontis/estimates/new?mrn=${ctx.enc.patientMrn}&encounterNo=${ctx.enc.no}` },
      ctx.enc.createdAt);
  }

  const sum = money.summary;
  const collect = { label: 'Collect deposit', act: 'collect' };

  if (money.required <= 0) {
    return pass(item, `${sum} — ${ctx.payerName} carries the whole allowed amount, so nothing is owed at the desk.`);
  }
  if (money.received >= money.required) {
    return pass(item, `${sum}, ${usd(money.received)} received.`, { label: 'View payments', act: 'payments' });
  }
  if (money.received > 0) {
    return pending(item, `${usd(money.remaining)} remaining`,
      `${sum}, ${usd(money.received)} received — ${usd(money.remaining)} remaining.`,
      collect, lastPaymentAt(ctx.enc) || ctx.enc.createdAt);
  }
  return fail(item, 'Deposit not collected', `${sum}, nothing received.`, collect, ctx.enc.createdAt);
}

/**
 * The deposit arithmetic, in one place, so the checklist line, the payments card
 * and the collect dialog all quote the same figures rather than each deriving
 * them. A self-paying admission is asked for the whole patient share, an insured
 * one for half; Upfront Settlement — the mode the patient-accounts feature turns
 * on — is the whole share whoever is paying.
 */
export function depositFor(enc, estimate = estimateFor(enc)) {
  const key = modeKey(enc);
  const mode = CONFIG.clearance.paymentMode[key] || 'None';
  const pcts = CONFIG.clearance.depositPct;
  const upfront = mode === 'Upfront Settlement';
  const pct = upfront
    ? 1
    : key === 'IP' ? (enc?.financial?.payerId ? pcts.insuredIP : pcts.selfPayIP) : pcts.OP;
  const share = cents(estimate?.result?.totals?.patientShare);
  const required = cents(share * pct);
  // What has been received is read off the patient account, because that is
  // where the money is: a settlement answers the charges as they post and a
  // deposit waits to be applied, so the two are different transactions and the
  // mode decides which of them counts. Money taken as a deposit on a visit that
  // settles up front is not what was asked for, and says so by not counting.
  const received = upfront
    ? cents(accounts.settlementFor(enc?.no))
    : cents(accounts.depositsFor(enc?.no));
  return {
    mode,
    pct,
    estimate,
    share,
    required,
    received,
    remaining: Math.max(0, cents(required - received)),
    summary: upfront
      ? `settled up front — the whole ${usd(share)} patient share`
      : `${Math.round(pct * 100)}% × ${usd(share)} = ${usd(required)}`,
  };
}

const lastPaymentAt = (enc) => payments.byEncounter(enc.no).map((p) => p.at).sort().pop() || null;

// --- item helpers -------------------------------------------------------------

const base = (key) => ({ key, label: ITEM_LABELS[key] });

const pass = (item, detail, action = null) =>
  ({ ...item, state: 'Passed', short: '', detail, action, since: null });

const na = (item, short, detail) =>
  ({ ...item, state: 'N/A', short, detail, action: null, since: null });

const pending = (item, short, detail, action = null, since = null) =>
  ({ ...item, state: 'Pending', short, detail, action, since: since || null });

const fail = (item, short, detail, action = null, since = null) =>
  ({ ...item, state: 'Failed', short, detail, action, since: since || null });

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Whole days from one ISO day to another; negative when the first is later. */
function daysBetween(from, to) {
  const a = Date.parse(`${iso(from)}T00:00:00Z`);
  const b = Date.parse(`${iso(to)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86400000);
}
