// Seed — TPA fee accruals (amendment 42). Five separations beside the one
// the denials seed already wrote (TPA-0001, GlobeMed's fee on the Arope
// claim the fund then refused outright), each driven through the denial
// register's own writes — a denial created on the remittance the fee was
// withheld from, reclassified as a TPA fee, which is the call that accrues
// it here — with the dates the events happened on, so the accrual is built
// exactly the way a live separation builds one and lands with the same
// audit trail.
//
// Claims are found by rule, never by number, and always Paid or Partially
// Paid: every other Defensio seed picks Denied claims, so the two sets never
// meet. The fee is computed off what the payer paid and the schedule the
// accrual will be read against, so the states the ledger opens on are the
// arithmetic's and not a typed figure's: two lab claims matched at two per
// cent, a surgery claim taken at the four per cent GlobeMed notified for
// August (Matched until the amendment restates the month), a July Allianz
// fee with no NEXtCARE version to read it against (Unscheduled), and an
// Arope claim where the administrator's arithmetic slipped fifteen dollars
// past its three per cent (Overcharged, then disputed and settled).

const CODER = 'Tarek Solh';
const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * One intent per accrual. `pick` finds the claim; `fee(paid)` the amount the
 * administrator withheld; the days are offsets from the claim's payment
 * date (the remittance date), which is when the refused line landed.
 */
export const INTENTS = [
  { key: 'cignaLabA', payerId: 'PY-0026', group: 'Lab', month: '2026-08', status: 'Paid', order: 'largest',
    fee: (paid) => cents(paid * 0.02), landed: 1, reclassified: 2,
    note: 'GlobeMed’s two per cent laboratory fee under the Cigna agreement, withheld on the August statement' },
  { key: 'cignaLabB', payerId: 'PY-0026', group: 'Lab', month: '2026-08', status: 'Paid', order: 'smallest', minPaid: 15,
    fee: (paid) => cents(paid * 0.02), landed: 1, reclassified: 3,
    note: 'GlobeMed’s two per cent laboratory fee under the Cigna agreement, withheld on the August statement' },
  { key: 'cignaSurgery', payerId: 'PY-0026', group: 'Inpatient', month: '2026-08', status: 'Paid', order: 'largest',
    fee: (paid) => cents(paid * 0.04), landed: 1, reclassified: 2,
    note: 'GlobeMed’s administration fee on the August statement, taken at the four per cent notified in July' },
  { key: 'allianzJuly', payerId: 'PY-0009', group: 'Lab', month: '2026-07', status: 'Paid', order: 'largest',
    fee: () => 4, landed: 1, reclassified: 4,
    note: 'NEXtCARE’s flat administration fee on the July statement — no fee schedule on file for Allianz yet' },
  { key: 'aropeSlip', payerId: 'PY-0011', group: null, before: '2026-08-01', status: 'Partially Paid', order: 'largest',
    fee: (paid) => cents(paid * 0.03 + 15), landed: 1, reclassified: 3,
    note: 'GlobeMed’s three per cent fee under the Arope agreement — the statement withholds fifteen dollars more than the rate gives' },
];

/**
 * buildTpaFeeAccruals({ denials, claims, accruals, today }) → the accruals
 * created (in intent order). Idempotent per intent: a claim that already
 * carries a TPA separation is skipped.
 */
export function buildTpaFeeAccruals(api) {
  const { denials, claims } = api;
  const out = [];
  const used = new Set(denials.all().filter((d) => d.separation === 'TPA').map((d) => d.claimNo));
  for (const intent of INTENTS) {
    const claim = pickClaim(claims, intent, used);
    if (!claim) { console.warn('[tpa seed] no claim for', intent.key); continue; }
    used.add(claim.claimNo);
    const line = claim.lines[0];
    const paidOn = String(claim.paidAt || '').slice(0, 10) || api.today;
    const at = (n, hour = 10) => `${daysAfter(paidOn, n)}T${String(hour).padStart(2, '0')}:20:00.000Z`;
    const fee = intent.fee(claim.totals.paid);
    const denial = denials.create({
      claimNo: claim.claimNo, claimId: claim.id, lineId: line?.id || null, remittanceNo: claim.remittanceId || null, payerId: claim.payerId,
      code: 'OA-23', amount: fee, scope: line ? 'Line' : 'Claim', at: at(intent.landed, 9), by: CODER,
    });
    if (!denial) continue;
    const r = denials.reclassify(denial.id, 'TPA', { note: intent.note, category: 'Administrative', tier: 'Underpayment' }, { at: at(intent.reclassified, 11), by: CODER });
    if (r?.error) { console.warn('[tpa seed] reclassify refused', denial.id, r.error); continue; }
    const accrual = api.accruals.all().find((a) => (a.actual?.separationRefs || []).includes(denial.id) || a.denialId === denial.id);
    if (accrual) { accrual.seedKey = intent.key; out.push(accrual); }
  }
  return out;
}

/** The claim an intent names: this payer, this state, this service group, inside the month or before the date, largest or smallest paid. */
function pickClaim(claims, intent, used) {
  const pool = claims.all().filter((c) => c.payerId === intent.payerId && c.status === intent.status && !c.kind && !c.batchId && !c.remittanceId
    && !c.nullification && !used.has(c.claimNo) && (c.lines || []).length === 1 && c.paidAt
    && (!intent.group || c.serviceGroup === intent.group)
    && (!intent.month || String(c.paidAt).slice(0, 7) === intent.month)
    && (!intent.before || String(c.paidAt).slice(0, 10) < intent.before)
    && (!intent.minPaid || c.totals.paid >= intent.minPaid));
  pool.sort((a, b) => (intent.order === 'smallest' ? a.totals.paid - b.totals.paid : b.totals.paid - a.totals.paid) || a.claimNo.localeCompare(b.claimNo));
  return pool[0] || null;
}

function daysAfter(isoDate, n) {
  const d = new Date(`${String(isoDate).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
