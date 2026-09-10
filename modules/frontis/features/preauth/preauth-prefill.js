// Where a request comes from. Four ways in, and none of them retypes anything
// the platform already knows — which is the whole point of F8: the flag that
// says a charge needs approval was raised by Pactum's matrix, read by the
// eligibility ladder and printed on the estimate, and this is that same flag
// becoming a piece of work.
//
// A blank form is the fifth way in and the least interesting one. Everything
// here returns the same state shape, so preauth-form.js never learns which door
// was used — only what the banner should say.

import * as patients from '../../../../data/repositories/patients.js';
import * as policies from '../../../../data/repositories/policies.js';
import * as cdm from '../../../../data/repositories/cdm.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import * as eligibility from '../../../../data/repositories/eligibility.js';
import * as estimates from '../../../../data/repositories/estimates.js';
import { todayIso } from '../../../../shared/format.js';
import { askingPrice } from './preauth-form-panels.js';

/** A request is raised for today's agreement, whatever it is about. */
const blankState = () => ({
  no: '',
  patientMrn: '',
  policyId: '',
  encounterNo: '',
  estimateNo: '',
  snapshotRef: '',
  services: [],
  diagnosis: '',
  justification: '',
  doctorId: '',
  priority: 'Routine',
  documents: [],
  q: '',
  on: todayIso(),
  origin: null,
});

export const blankLine = () => ({ itemId: '', qty: 1, requestedAmount: 0 });

/** The stored draft, as the form holds it. */
export function fromRow(row) {
  return {
    ...blankState(),
    no: row.no,
    patientMrn: row.patientMrn || '',
    policyId: row.policyId || '',
    encounterNo: row.encounterNo || '',
    estimateNo: row.estimateNo || '',
    snapshotRef: row.snapshotRef || '',
    services: row.services.map((s) => ({
      itemId: s.itemId, qty: s.qty, requestedAmount: s.requestedAmount,
    })),
    diagnosis: row.diagnosis || '',
    justification: row.justification || '',
    doctorId: row.doctorId || '',
    priority: row.priority || 'Routine',
    documents: row.documents.map((doc) => ({ ...doc })),
  };
}

/**
 * A new request, filled from whichever door it came through. The order is the
 * order of evidence: an estimate and a snapshot both name the charges, an
 * encounter names the visit, and `mrn` alone names only the person.
 */
export function blank(query = {}) {
  const state = blankState();
  if (query.encounterNo) fromEncounter(state, query.encounterNo);
  if (query.estimate) fromEstimate(state, query.estimate);
  if (query.snapshot) fromSnapshot(state, query.snapshot);
  if (!state.patientMrn && query.mrn && patients.get(query.mrn)) state.patientMrn = query.mrn;
  if (!state.policyId) state.policyId = policies.chain(state.patientMrn)[0]?.id || '';
  // A per-line button on a snapshot or a document asks about one charge, not
  // all of them: the rest of the flagged lines are somebody else's request.
  if (query.item && state.services.some((line) => line.itemId === query.item)) {
    state.services = state.services.filter((line) => line.itemId === query.item);
    if (state.origin) state.origin.detail = `${cdm.label(cdm.get(query.item))}, the line the button was on.`;
  }
  price(state);
  return state;
}

/** The visit: who, which cover, which doctor — and the charges its check flagged. */
function fromEncounter(state, no) {
  const enc = encounters.get(no);
  if (!enc) return;
  state.encounterNo = enc.no;
  state.patientMrn = enc.patientMrn;
  state.policyId = enc.financial?.policyId || '';
  state.doctorId = enc.doctorId || '';
  state.snapshotRef = enc.financial?.snapshotRef || '';
  state.diagnosis = enc.visitReason || '';
  const flagged = flaggedFromSnapshot(state.snapshotRef);
  state.services = flagged;
  state.origin = {
    ref: enc.no,
    detail: flagged.length
      ? `${flagged.length} flagged service${flagged.length === 1 ? '' : 's'} from the visit's own eligibility check.`
      : 'The patient, the cover and the treating doctor come from the visit.',
  };
}

/** The quotation: the lines it printed a pre-auth flag against, at its prices. */
function fromEstimate(state, no) {
  const row = estimates.get(no);
  if (!row || row.subject?.kind !== 'patient') return;
  state.estimateNo = row.no;
  state.patientMrn = row.subject.mrn;
  state.policyId = row.policy?.policyId || state.policyId;
  state.encounterNo = row.encounterNo || state.encounterNo;
  const flags = row.result?.preAuthFlags || [];
  state.services = flags.map((flag) => {
    const item = flag.itemId ? cdm.get(flag.itemId) : cdm.getByCode(flag.chargeCode);
    const line = (row.lines || []).find((l) => l.itemId === item?.id);
    const priced = (row.result?.rows || []).find((r) => r.chargeCode === flag.chargeCode);
    return {
      itemId: item?.id || '',
      qty: Math.max(1, Number(line?.qty) || 1),
      requestedAmount: Number(priced?.amount) || 0,
    };
  }).filter((line) => line.itemId);
  state.origin = {
    ref: row.no,
    detail: `${state.services.length} flagged service${state.services.length === 1 ? '' : 's'} at the quoted `
      + 'allowed amounts.',
  };
}

/** The check: the charges its coverage table answered "pre-auth required" for. */
function fromSnapshot(state, ref) {
  const snapshot = eligibility.get(ref);
  if (!snapshot?.patientMrn) return;
  state.snapshotRef = snapshot.ref;
  state.patientMrn = snapshot.patientMrn;
  state.policyId = snapshot.policyId || state.policyId;
  state.encounterNo = snapshot.encounterId || state.encounterNo;
  state.services = flaggedFromSnapshot(ref);
  state.origin = {
    ref: snapshot.ref,
    detail: `${state.services.length} flagged service${state.services.length === 1 ? '' : 's'} from the check, `
      + 'at the amounts it allowed.',
  };
}

/**
 * The rows of one snapshot's coverage table that need approval. A snapshot is
 * immutable, so this is what the payer's own configuration said on the day —
 * the evidence the request is being raised on.
 */
function flaggedFromSnapshot(ref) {
  const snapshot = ref ? eligibility.get(ref) : null;
  return (snapshot?.coverageSummary?.rows || [])
    .filter((row) => row.preAuth?.required && !row.preAuth?.authorization && cdm.get(row.itemId))
    .map((row) => ({
      itemId: row.itemId,
      qty: Math.max(1, Number(row.qty) || 1),
      requestedAmount: Number(row.allowed) || 0,
    }));
}

/** Any line that arrived without a price is asked for at the agreed rate. */
function price(state) {
  for (const line of state.services) {
    if (!line.requestedAmount) line.requestedAmount = askingPrice(state, line.itemId, line.qty);
  }
}
