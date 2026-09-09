// What the builder holds while an estimate is being priced, and what it means.
// Pure: it builds the state, reads a cover out of the repositories, says when
// the state is complete and turns it into the row the repository stores.
//
// It is a file of its own so estimate-builder.js can stay the screen — the
// draw and the events — and because the two things worth being careful about
// live here: `payloadOf`, which is the only place the entity's shape is written
// from the rail, and `signatureOf`, which is what "this price is the price of
// what is on screen" means. A price nobody has seen is not a price anybody can
// be handed, so the freshness gate is only as honest as that one function.

import * as patients from '../../../../data/repositories/patients.js';
import * as policies from '../../../../data/repositories/policies.js';
import * as payers from '../../../../data/repositories/payers.js';
import * as estimates from '../../../../data/repositories/estimates.js';
import { todayIso } from '../../../../shared/format.js';

/** No cover at all — the shape every other answer replaces. */
export const SELF_PAY_COVER = { policyId: null, payerId: null, planId: null, selfPay: true };
export const NO_COVER = { policyId: null, payerId: null, planId: null, selfPay: false };

/** A new builder, with whatever the link that opened it already knew. */
export function blank(query = {}) {
  const prospect = query.subject === 'prospect';
  const mrn = patients.get(query.mrn) ? query.mrn : '';
  const first = mrn ? policies.chain(mrn)[0] : null;
  return {
    no: '',
    subject: { kind: prospect ? 'prospect' : 'patient', mrn, name: '', phone: '' },
    q: '',
    // A walk-in is quoted off a card far more often than not, so the payer
    // picker opens live; a patient with nothing on their chain is self-pay.
    policy: first ? coverOf(first.id) : prospect ? { ...NO_COVER } : { ...SELF_PAY_COVER },
    context: { visitType: 'Outpatient', department: '', dateOfService: todayIso() },
    lines: [blankLine()],
    outcome: null,
    signature: '',
    lineFilter: 'all',
    // The encounter this estimate is being quoted for, when it was started from
    // one. It is carried into the draft so the Linked Records tab that opened
    // the builder is the one the estimate comes back to.
    encounterNo: query.encounterNo || '',
  };
}

/** An existing draft, opened again. The frozen half does not exist yet. */
export function fromRow(row) {
  return {
    no: row.no,
    subject: {
      kind: row.subject.kind,
      mrn: row.subject.mrn || '',
      name: row.subject.name || '',
      phone: row.subject.phone || '',
    },
    q: '',
    policy: { ...row.policy },
    context: { ...row.context },
    lines: row.lines.map(copyLine),
    outcome: null,
    signature: '',
    lineFilter: 'all',
    encounterNo: row.encounterNo || '',
  };
}

export const blankLine = () => ({ itemId: '', qty: 1, consumption: [] });

const copyLine = (line) => ({ ...line, consumption: (line.consumption || []).map((c) => ({ ...c })) });

/** A policy on the chain, read into the shape the entity holds. */
export function coverOf(policyId) {
  const policy = policies.get(policyId);
  return policy
    ? { policyId: policy.id, payerId: policy.payerId, planId: policy.planId, selfPay: false }
    : { ...SELF_PAY_COVER };
}

/** A payer picked by hand takes its first active plan, so the pair is never half set. */
export function coverOfPayer(payerId) {
  const plan = (payers.get(payerId)?.plans || []).find((p) => p.status === 'Active');
  return { policyId: null, payerId: payerId || null, planId: plan?.id || null, selfPay: false };
}

/** The estimate as the repository holds it, built from the rail's state. */
export const payloadOf = (state) => ({
  subject: state.subject.kind === 'patient'
    ? { kind: 'patient', mrn: state.subject.mrn }
    : { kind: 'prospect', name: state.subject.name.trim(), phone: state.subject.phone.trim() },
  policy: { ...state.policy },
  context: { ...state.context },
  lines: state.lines.filter((line) => line.itemId),
  encounterNo: state.encounterNo || null,
});

/** Everything the inputs say, as one string: what "the same price" means. */
export const signatureOf = (state) =>
  JSON.stringify([state.subject, state.policy, state.context, state.lines]);

/** Why this estimate cannot be priced or issued yet, or ''. */
export function validationError(state) {
  if (state.subject.kind === 'patient') {
    const patient = patients.get(state.subject.mrn);
    if (!patient) return 'Choose the patient this estimate is for';
    if (patient.status === 'Merged') return 'A merged record is read-only — quote on the record that survived';
  } else {
    if (!state.subject.name.trim()) return 'Enter the name this quotation is for';
    if (!state.subject.phone.trim()) return 'Enter a mobile number for the quotation';
    if (!state.policy.selfPay && !state.policy.planId) return 'Choose the plan on the card, or quote Self-Pay';
  }
  if (!state.context.department) return 'Choose the department';
  if (!estimates.pricedLines(state).length) return 'Add at least one service';
  return '';
}
