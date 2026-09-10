// Seed — unapplied cash (amendment 29). No hand-written rows: a row is what a
// remittance leaves when its payment carries more cash than its claims account
// for, so every seeded row comes out of a seeded posting in
// data/seed/remittances.js. What is written here is what happened to each of
// them afterwards, keyed by the remittance that left it — one applied to the
// payer's next claim a few days on; the rest still held, one of them long
// enough to paint red.

/** Remittance no. → what the desk did with the residue. A remittance not named here is still held. */
export const RESOLUTIONS = {
  'RMT-2026-000073': {
    kind: 'Applied', daysAfter: 3, by: 'Tarek Solh',
    reason: 'Payer confirmed the residue belongs to the following claim',
  },
};
