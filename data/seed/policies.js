// Seed — insurance policies. Owner: modules/frontis (Patient Access & Eligibility).
// A policy links one patient to one payer plan; the chain (priority 1..3) is
// what eligibility and billing read, and Self-Pay is the fallback the chain
// never holds as a row.
//
// Hand-written for eight of the sixty seeded patients, because the demo needs
// each shape exactly so: a three-policy chain with a dependant, a chain with a
// suspended and an expired policy beside it, an expired-only record that falls
// back to Self-Pay, a plan whose payer has no active Pactum contract (the
// warning the policy modal raises), and four single-policy records. Every other
// patient — MRN-000104 among them — carries none, which is the empty state.
//
// Member IDs follow the payer: the public funds number them, the private
// insurers use their own alphanumeric series.
//
// Nine of the sixty carry a policy: the eight above and MRN-000113, whose two
// covers exist so a two-policy eligibility cascade can be run live.

/** [id, mrn, payerId, planId, memberId, policyNo, relationship, holder, from, to, priority, status] */
const ROWS = [
  // MRN-000103 Nour Baalbaki — the three-policy chain. She carries her own NSSF
  // cover, is still a dependant on her father's AXA, and the Bankers group cover
  // runs out inside the month, which is the amber the validity column shows.
  ['POL-0001', 'MRN-000103', 'PY-0001', 'PL-0001', '1120078451', 'NSSF/TR/44810', 'Self', null,
    '2026-01-01', '2026-12-31', 1, 'Active'],
  ['POL-0002', 'MRN-000103', 'PY-0008', 'PL-0019', 'AXA-LB-0448120', 'AXA-2026-11974', 'Child', 'Bilal Baalbaki',
    '2026-03-01', '2027-02-28', 2, 'Active'],
  ['POL-0003', 'MRN-000103', 'PY-0007', 'PL-0015', 'BNK-A-77315', 'BA-CORP-2026-338', 'Self', null,
    '2026-07-01', '2026-09-30', 3, 'Active'],

  // MRN-000101 Rami Haddad — one live policy, one held by the employer, one that
  // ran out in March. Both of the latter are out of the chain.
  ['POL-0004', 'MRN-000101', 'PY-0001', 'PL-0002', '0973214587', 'NSSF/BR/20194', 'Self', null,
    '2026-01-01', '2026-12-31', 1, 'Active'],
  ['POL-0005', 'MRN-000101', 'PY-0008', 'PL-0020', 'AXA-LB-0331902', 'AXA-2025-88420', 'Spouse', 'Maya Haddad',
    '2026-03-01', '2026-12-05', null, 'Suspended'],
  ['POL-0006', 'MRN-000101', 'PY-0010', 'PL-0025', 'MDG-H-119043', 'MG-2025-4471', 'Self', null,
    '2025-04-01', '2026-03-31', null, 'Expired'],

  // MRN-000110 Ahmad Al-Sayed — expired only, so the header chip reads Self-Pay.
  ['POL-0007', 'MRN-000110', 'PY-0007', 'PL-0016', 'BNK-B-50218', 'BA-IND-2025-902', 'Self', null,
    '2025-07-01', '2026-06-30', null, 'Expired'],

  // MRN-000108 Carla Gemayel — ISF dependants cover. No Pactum contract names
  // PL-0010, so editing this policy raises the eligibility warning.
  ['POL-0008', 'MRN-000108', 'PY-0004', 'PL-0010', 'ISF-D-30877', 'ISF/DEP/2026/8814', 'Spouse', 'Naji Gemayel',
    '2026-05-01', '2027-04-30', 1, 'Active'],

  // The four single-policy records: the VIP (masking does not reach policies),
  // the blocked patient, and two ordinary ones.
  ['POL-0009', 'MRN-000105', 'PY-0025', 'PL-0054', 'BUP-8842019', 'BG-LB-2026-5510', 'Self', null,
    '2026-08-01', '2027-07-31', 1, 'Active'],
  ['POL-0010', 'MRN-000107', 'PY-0001', 'PL-0001', '0662062401', 'NSSF/BK/11238', 'Self', null,
    '2026-01-01', '2026-12-31', 1, 'Active'],
  ['POL-0011', 'MRN-000102', 'PY-0002', 'PL-0004', 'MOPH-2026-40118', 'MOPH/UNI/9931', 'Self', null,
    '2026-02-01', '2026-09-30', 1, 'Active'],
  ['POL-0012', 'MRN-000111', 'PY-0009', 'PL-0022', 'SNA-G-220914', 'SNA-2026-6612', 'Self', null,
    '2026-01-20', '2026-12-31', 1, 'Active'],

  // MRN-000113 Marwan Talhouk — the live cascade. Both policies are Active and
  // in date, so both sit in the chain, but the hospital holds no agreement with
  // MEDGULF on PL-0024: a check on the primary refuses at the contract step and
  // the secondary underneath it answers. Every other chain in this seed is
  // headed by a plan Pactum contracts, so this is the only record where the
  // "Try next policy" prompt is reachable without editing anything.
  ['POL-0013', 'MRN-000113', 'PY-0010', 'PL-0024', 'MDG-H-204517', 'MG-2026-8830', 'Self', null,
    '2026-03-01', '2027-02-28', 1, 'Active'],
  ['POL-0014', 'MRN-000113', 'PY-0001', 'PL-0002', '5902224018', 'NSSF/SD/31760', 'Self', null,
    '2026-01-01', '2026-12-31', 2, 'Active'],
];

/** Why a policy left the chain, for the rows that are not Active. */
const REASONS = {
  'POL-0005': 'Employer confirmed the group policy is on hold pending the renewal.',
  'POL-0006': 'Validity ended 2026-03-31',
  'POL-0007': 'Validity ended 2026-06-30',
};

/** Verified at the desk on the patient's last visit. The rest are unverified. */
const VERIFIED = {
  'POL-0001': '2026-08-31',
  'POL-0004': '2026-09-02',
  'POL-0009': '2026-09-04',
  'POL-0010': '2026-08-18',
};

/**
 * Encounters do not exist yet, so nothing in the platform can flip this flag.
 * Three primaries are seeded as already used, because the edit guard — a reason
 * is required before the payer or plan of a policy claims were filed under can
 * change — has to be reachable in the demo before the Encounter feature lands.
 */
const USED = ['POL-0001', 'POL-0004', 'POL-0009'];

const CARD = (no) => ({ fileName: `${no.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-front.jpg`, size: 412000 });

export const policies = ROWS.map(
  ([id, patientMrn, payerId, planId, memberId, policyNo, relationship, holderName, validFrom, validTo, priority, status]) => ({
    id,
    patientMrn,
    payerId,
    planId,
    memberId,
    policyNo,
    relationship,
    holderName,
    validFrom,
    validTo,
    priority,
    status,
    statusReason: REASONS[id] || '',
    lastVerifiedAt: VERIFIED[id] || null,
    cardFront: status === 'Active' ? CARD(policyNo) : null,
    cardBack: null,
    usedInEncounters: USED.includes(id),
    createdAt: `${validFrom}T09:${String(10 + Number(id.slice(-2))).padStart(2, '0')}:00.000Z`,
    updatedAt: `${validFrom}T09:${String(20 + Number(id.slice(-2))).padStart(2, '0')}:00.000Z`,
  }),
);
