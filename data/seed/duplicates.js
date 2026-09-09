// Seed — potential duplicate pairs. Owner: modules/frontis. One row per pair
// the detector raised, whatever happened to it afterwards: the worklist is the
// record of the decision, not just of the open questions.
//
// Two open Name+DOB pairs are the near-duplicates in data/seed/patients.js, one
// open Phone pair is the shared line between two unrelated patients, and the
// fourth is the pair that was already merged, kept so the Status filter has
// something to show.

export const duplicates = [
  {
    id: 'DP-0001',
    mrnA: 'MRN-000101',
    mrnB: 'MRN-000102',
    basis: 'Name+DOB',
    detectedAt: '2026-07-19T09:12:00.000Z',
    status: 'Open',
    justification: 'Registered at the emergency desk out of hours; the clerk could not reach the first record.',
  },
  {
    id: 'DP-0002',
    mrnA: 'MRN-000103',
    mrnB: 'MRN-000104',
    basis: 'Name+DOB',
    detectedAt: '2026-08-31T14:40:00.000Z',
    status: 'Open',
    justification: 'Family name spelled two ways on the civil ID and the referral letter.',
  },
  {
    id: 'DP-0003',
    mrnA: 'MRN-000110',
    mrnB: 'MRN-000111',
    basis: 'Phone',
    detectedAt: '2026-08-25T11:26:00.000Z',
    status: 'Open',
    justification: 'Registered on the number of the household he works for; no other detail matches.',
  },
  {
    id: 'DP-0004',
    mrnA: 'MRN-000108',
    mrnB: 'MRN-000109',
    basis: 'Name+DOB',
    detectedAt: '2026-05-14T10:05:00.000Z',
    status: 'Merged',
    justification: 'Second record opened against a passport; merged into MRN-000108.',
  },
];
