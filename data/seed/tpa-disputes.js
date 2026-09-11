// Seed — TPA fee disputes (amendment 42). Two disputes on the accruals the
// accrual seed leaves overcharged, driven through the register's own
// writes with the dates the events happened on: GlobeMed's fee on the
// Arope claim the fund refused outright, raised this week and not yet
// acknowledged; and the fifteen-dollar arithmetic slip on the May Arope
// remittance, raised in June, acknowledged with GlobeMed's reference,
// settled in July at ten dollars credited on the next statement with the
// five-dollar remainder raised as a small-balance write-off through
// Claima's own creator (Pending Approval — the first live request is the
// next number). Accruals are found by their seed key and their state, never
// by id.

const CODER = 'Tarek Solh';

export const INTENTS = [
  { key: 'refused', accrualKey: null, seedTag: 'A36', status: 'Raised', raised: 3,
    note: 'The agreement charges three per cent of what Arope pays; nothing was paid on this claim and the whole fee was withheld' },
  { key: 'slip', accrualKey: 'aropeSlip', status: 'Settled', raisedOn: '2026-06-10', acknowledgedOn: '2026-06-18', ackRef: 'GLB-DSP-2214', settledOn: '2026-07-03',
    note: 'The May statement withholds $38.89 against a three per cent fee of $23.89 — fifteen dollars over the rate',
    settlement: { recovered: 10, how: 'writeOff', reason: 'GlobeMed credited ten dollars on the July statement and holds the rest as rounding under its own statement policy',
      justification: 'Five dollars left of a TPA fee overcharge after GlobeMed’s partial credit — not worth a second round with the administrator' } },
];

/** buildTpaDisputes({ accruals, disputes, today }) → the disputes created. */
export function buildTpaDisputes(api) {
  const { accruals, disputes, today } = api;
  const out = [];
  const daysAgo = (n) => daysAfter(today, -n);
  for (const intent of INTENTS) {
    const accrual = intent.accrualKey
      ? accruals.all().find((a) => a.seedKey === intent.accrualKey)
      : accruals.all().find((a) => a.matchState === 'Overcharged' && !a.dispute && !(a.basis?.paid > 0));
    if (!accrual || accrual.dispute) { console.warn('[tpa seed] no overcharged accrual for dispute', intent.key); continue; }
    const raisedOn = intent.raisedOn || daysAgo(intent.raised);
    const row = disputes.raise({ tpaId: accrual.tpaId, accrualIds: [accrual.id], note: intent.note }, { at: `${raisedOn}T10:40:00.000Z`, by: CODER, commit: false });
    if (!row || row.error) { console.warn('[tpa seed] dispute refused', intent.key, row?.error); continue; }
    row.seedTag = 'A42';
    if (intent.acknowledgedOn) disputes.acknowledge(row.id, { ref: intent.ackRef }, { at: `${intent.acknowledgedOn}T09:30:00.000Z`, by: CODER, commit: false });
    if (intent.status === 'Settled' && intent.settlement) {
      const s = disputes.settle(row.id, { ...intent.settlement, reasonCode: 'W03' }, { at: `${intent.settledOn}T15:10:00.000Z`, by: CODER, commit: false });
      if (s?.error) console.warn('[tpa seed] settlement refused', intent.key, s.error);
    }
    out.push(row);
  }
  return out;
}

function daysAfter(isoDate, n) {
  const d = new Date(`${String(isoDate).slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
