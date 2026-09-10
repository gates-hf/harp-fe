// Engine — the arithmetic of a claim's shape. A leaf: it imports nothing, so
// the claims repository and the claims seed can both read it without a cycle.
//
// A claim is its lines. `totals` is a sum over them plus the two facts a
// remittance writes (what the payer paid and what was adjusted off), and the
// legacy flat fields Performance reads (amendment 11) are a view of the first
// line and the totals — never written by hand, always re-derived here, so the
// payer table and a claims worklist read one claim the same way.

/**
 * A line as the repository stores it — every field present, in this order.
 * Anything else the caller put on the line rides through untouched (the
 * assembler's charge-line reference, the stamped authorisation, the late
 * flag — amendment 27), so a re-derivation never strips a fact it does not
 * compute.
 */
export function lineOf(data = {}, id = 'L1') {
  return {
    ...data,
    id: data.id || id,
    itemId: data.itemId || null,
    qty: Number(data.qty) || 1,
    grossBilled: cents(data.grossBilled),
    allowedExpected: cents(data.allowedExpected),
    payerShare: cents(data.payerShare),
    patientShare: cents(data.patientShare),
    isOverage: Boolean(data.isOverage),
    ledgerTxIds: Array.isArray(data.ledgerTxIds) ? [...data.ledgerTxIds] : [],
    status: data.status || 'Open',
    denialReasonCode: data.denialReasonCode || null,
  };
}

/**
 * totals over the lines. `paid` is the payer's cash against the claim and
 * `adjusted` what the hospital wrote off the payer share; neither is a sum
 * over lines, so both are carried in and kept. Balance is what the payer still
 * owes: its share, less what it paid, less what was let go.
 */
export function totalsOf(lines = [], { paid = 0, adjusted = 0 } = {}) {
  const sum = (key) => cents(lines.reduce((n, line) => n + (Number(line[key]) || 0), 0));
  const totals = {
    gross: sum('grossBilled'),
    allowedExpected: sum('allowedExpected'),
    payerShare: sum('payerShare'),
    patientShare: sum('patientShare'),
    paid: cents(paid),
    adjusted: cents(adjusted),
  };
  totals.balance = cents(totals.payerShare - totals.paid - totals.adjusted);
  return totals;
}

/**
 * Re-derive `totals` and the legacy flat fields from the lines, in place.
 * The flat fields are what data/engines/performance-engine.js reads:
 * `allowedPaid` is what the payer allowed on its remittance — the cash it paid
 * plus the patient share it left to the desk — and is zero until it answers
 * with money, so a denied claim reads as allowing nothing.
 */
export function syncClaim(claim) {
  claim.lines = (claim.lines || []).map((line, i) => lineOf(line, `L${i + 1}`));
  claim.totals = totalsOf(claim.lines, claim.totals || {});
  const first = claim.lines[0] || {};
  claim.itemId = first.itemId || null;
  claim.qty = first.qty || 0;
  claim.grossBilled = claim.totals.gross;
  claim.allowedExpected = claim.totals.allowedExpected;
  claim.allowedPaid = claim.paidAt ? cents(claim.totals.paid + claim.totals.patientShare) : 0;
  return claim;
}

export const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;
