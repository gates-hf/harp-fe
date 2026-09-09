// Seed — contracts. One payer contract per row; versions of the same agreement
// share a `lineageId` and differ by `version`. Three contracts carry rate
// methodologies and overage, and two carry coverage, pre-auth and rules, so the
// tabs have something to read. Dates are 2026, the demo's current year.
//
// Fee schedules and case rates point at CDM rows by id, so this file reads the
// charge master seed and looks the codes up rather than hard-coding CDM ids.

import { cdm } from './cdm.js';

const byCode = new Map(cdm.map((row) => [row.chargeCode, row.id]));
const ref = (code) => byCode.get(code) || code;

/** Fixed Amount rows: [[charge code, agreed price], …]. */
const schedule = (lines) => lines.map(([code, price]) => ({ itemId: ref(code), price }));

// --- NSSF hospitalization (CTR-0001) — the worked example -------------------
// A default percentage, a lab fee schedule that beats it, a per-diem for the
// ward and one bundle priced as a case rate with its overage policy.

const NSSF_METHODOLOGIES = [
  { id: 'MT-001', scopeLevel: 'Default', scopeValue: null, method: '% of Charges',
    params: { percent: 80 }, effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31',
    updatedAt: '2026-01-14T11:22:00' },

  { id: 'MT-002', scopeLevel: 'Category', scopeValue: 'Lab', method: 'Fixed Amount',
    params: { feeSchedule: schedule([
      ['LAB-0001', 9.5], ['LAB-0002', 17.5], ['LAB-0003', 7.5],
      ['LAB-0004', 11], ['LAB-0005', 15], ['LAB-0006', 19],
    ]) },
    effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31', updatedAt: '2026-01-14T11:26:00' },

  { id: 'MT-003', scopeLevel: 'Category', scopeValue: 'Room & Board', method: 'Per Diem',
    params: { amount: 150, wardType: 'Private' },
    effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31', updatedAt: '2026-01-14T11:29:00' },

  { id: 'MT-004', scopeLevel: 'Item', scopeValue: ref('PKG-APP-001'), method: 'Case Rate',
    params: { amount: 1320, bundleId: ref('PKG-APP-001') },
    effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31', updatedAt: '2026-01-14T11:34:00' },
];

const NSSF_OVERAGE = [
  { id: 'OV-001', methodologyId: 'MT-004', action: 'Not Billable (Absorb)',
    tolerance: { type: '%', value: 10 },
    overrides: [
      { componentId: ref('RNB-0001'), action: 'Bill Payer at Contract Rate', tolerance: { type: 'Amount', value: 300 } },
      { componentId: ref('CNS-0002'), action: 'Split per Coverage', tolerance: { type: '%', value: 5 } },
    ],
    updatedAt: '2026-01-14T11:41:00' },
];

// --- AXA network (CTR-0005) — a default and nothing else --------------------
const AXA_METHODOLOGIES = [
  { id: 'MT-001', scopeLevel: 'Default', scopeValue: null, method: '% of Charges',
    params: { percent: 85 }, effectiveFrom: '2026-03-01', effectiveTo: '2026-12-05',
    updatedAt: '2026-02-24T11:40:00' },
];

// --- pre-authorization -------------------------------------------------------
// The precedence ladder in one matrix: a wide Inpatient rule, a Radiology rule
// with a threshold, an item that always needs approval and an item exempted
// from the category above it.

const NSSF_PREAUTH = [
  { id: 'PA-001', scopeLevel: 'Service Group', scopeValue: 'Inpatient', required: true,
    threshold: null, updatedAt: '2026-01-14T11:48:00' },
  { id: 'PA-002', scopeLevel: 'Category', scopeValue: 'Radiology', required: true,
    threshold: 300, updatedAt: '2026-01-14T11:50:00' },
  { id: 'PA-003', scopeLevel: 'Item', scopeValue: ref('RAD-0001'), required: true,
    threshold: null, updatedAt: '2026-01-14T11:52:00' },
  { id: 'PA-004', scopeLevel: 'Item', scopeValue: ref('RAD-0002'), required: false,
    threshold: null, updatedAt: '2026-01-14T11:53:00' },
  { id: 'PA-005', scopeLevel: 'Category', scopeValue: 'Pharmacy', required: true,
    threshold: 1000, updatedAt: '2026-01-14T11:55:00' },
];

/**
 * Referral required (amendment 18). The fund wants a doctor behind every
 * admission it pays for, and lets a consultation walk in — which is the ladder
 * the eligibility check reads: the contract row holds, and the narrower
 * category row exempts.
 */
const NSSF_REFERRAL = [
  { id: 'RR-001', scopeLevel: 'Contract', scopeValue: null, required: true,
    updatedAt: '2026-01-14T12:02:00' },
  { id: 'RR-002', scopeLevel: 'Category', scopeValue: 'Consultation', required: false,
    updatedAt: '2026-01-14T12:04:00' },
];

const AXA_REFERRAL = [
  { id: 'RR-001', scopeLevel: 'Category', scopeValue: 'Radiology', required: true,
    updatedAt: '2026-02-24T11:58:00' },
];

const AXA_PREAUTH = [
  { id: 'PA-001', scopeLevel: 'Category', scopeValue: 'Surgery', required: true,
    threshold: null, updatedAt: '2026-02-24T11:44:00' },
];

// --- MOPH dialysis draft (CTR-0007) — the activation gate's demo ------------
// A case rate with no overage policy and no default row: Activate refuses and
// names both.
const MOPH_METHODOLOGIES = [
  { id: 'MT-001', scopeLevel: 'Item', scopeValue: ref('PKG-CAT-003'), method: 'Case Rate',
    params: { amount: 810, bundleId: ref('PKG-CAT-003') },
    effectiveFrom: '2027-01-01', effectiveTo: '2027-12-31', updatedAt: '2026-09-01T10:52:00' },
];

// --- coverage ---------------------------------------------------------------
// What the patient pays out of an allowed amount, per linked plan. NSSF plan A
// carries the worked split and plan B is the same schedule copied across — what
// the Copy from plan dialog does on screen. Ids are unique within a contract.

/** [scope level, scope value, covered, share type, share value, deductible, ceiling] */
const NSSF_SPLIT = [
  ['Default', null, true, 'Co-pay %', 20, 0, 500],
  ['Category', 'Pharmacy', true, 'Co-pay %', 30, 0, null],
  ['Category', 'Lab', true, 'None', 0, 0, null],
  ['Item', ref('NCL-0001'), false, 'None', 0, 0, null],
];

/** buckets: [[planId, lines, updatedAt], …]. */
function coverage(buckets) {
  let serial = 0;
  return buckets.map(([planId, lines, updatedAt]) => ({
    planId,
    rows: lines.map(([scopeLevel, scopeValue, covered, shareType, shareValue, deductible, ceiling]) => ({
      id: `CV-${String(++serial).padStart(3, '0')}`,
      scopeLevel, scopeValue, covered, shareType, shareValue, deductible, ceiling, updatedAt,
    })),
  }));
}

const NSSF_COVERAGE = coverage([
  ['PL-0001', NSSF_SPLIT, '2026-01-16T09:40:00'],
  ['PL-0002', NSSF_SPLIT, '2026-01-16T09:44:00'],
]);

const AXA_COVERAGE = coverage([
  ['PL-0019', [['Default', null, true, 'Fixed Co-pay', 10, 0, null]], '2026-02-24T11:52:00'],
]);

// --- rules -------------------------------------------------------------------
// IF conditions THEN one action, run lowest priority first. NSSF carries the
// worked set — a nested group, an encounter rule, a patient rule, an overage
// override and a deliberate conflicting pair the Rules tab flags on sight.

const cond = (attr, operator, value) => ({ attr, operator, value });
const group = (op, items) => ({ op, items });

/** [id, name, description, priority, status, conditions, action, updatedAt] */
function rules(list) {
  return list.map(([id, name, description, priority, status, conditions, action, updatedAt]) => ({
    id, name, description, priority, status, conditions, action, updatedAt,
  }));
}

const NSSF_RULES = rules([
  ['RL-001', 'Small consumables on first class', 'Cheap consumables are absorbed rather than billed to the fund.',
    10, 'Active',
    group('AND', [
      cond('patient.plan', 'eq', 'PL-0001'),
      group('AND', [
        cond('item.category', 'eq', 'Consumables'),
        cond('item.standardPrice', 'lt', 20),
      ]),
    ]),
    { type: 'Not Billable', params: {} }, '2026-01-20T09:15:00'],

  ['RL-002', 'Long emergency stays need approval', 'An emergency admission running past five days goes back to the fund.',
    20, 'Active',
    group('AND', [
      cond('encounter.admissionType', 'eq', 'Emergency'),
      cond('encounter.lengthOfStay', 'gt', 5),
    ]),
    { type: 'Requires Prior Approval', params: {} }, '2026-01-20T09:22:00'],

  ['RL-003', 'Paediatric consultation discount', 'Consultations for children under 12 carry an agreed discount.',
    30, 'Active',
    group('AND', [
      cond('patient.age', 'lt', 12),
      cond('item.category', 'eq', 'Consultation'),
    ]),
    { type: '% Discount', params: { percent: 10 } }, '2026-01-20T09:28:00'],

  ['RL-004', 'Large overage goes to approval', 'Anything more than $500 past a bundle price is decided, not absorbed.',
    40, 'Active',
    group('AND', [cond('financial.overageAmount', 'gt', 500)]),
    { type: 'Override Overage Action', params: { action: 'Requires Approval' } }, '2026-01-20T09:35:00'],

  ['RL-005', 'Pharmacy absorbed', 'Pharmacy lines are inside the agreed rate and are not billed on top.',
    50, 'Active',
    group('AND', [cond('item.category', 'eq', 'Pharmacy')]),
    { type: 'Not Billable', params: {} }, '2026-01-20T09:41:00'],

  ['RL-006', 'Pharmacy discount on second class', 'Second class pharmacy is discounted rather than absorbed.',
    60, 'Active',
    group('AND', [
      cond('item.category', 'eq', 'Pharmacy'),
      cond('patient.plan', 'eq', 'PL-0002'),
    ]),
    { type: '% Discount', params: { percent: 20 } }, '2026-01-20T09:47:00'],
]);

const AXA_RULES = rules([
  ['RL-001', 'Surgery ceiling', 'A single surgical line is capped whatever the standard price says.',
    10, 'Active',
    group('AND', [
      cond('item.category', 'eq', 'Surgery'),
      cond('item.allowedAmount', 'gt', 2000),
    ]),
    { type: 'Ceiling', params: { amount: 2000 } }, '2026-02-25T10:12:00'],
]);

// --- NSSF version 1 (CTR-0010) — the 2025 agreement --------------------------
// The lineage's first version, closed when the 2026 one took over: the same
// configuration a year earlier and five points cheaper, so a date of service in
// 2025 prices through it and the billing simulator names the version it used.
// Every nested list is copied, so the two versions never share a row.

const NSSF_V1_METHODOLOGIES = structuredClone(NSSF_METHODOLOGIES).map((m) => ({
  ...m,
  params: m.method === '% of Charges' ? { percent: 75 } : m.params,
  effectiveFrom: '2025-01-01',
  effectiveTo: '2025-12-31',
  updatedAt: '2025-01-09T10:15:00',
}));

const NSSF_V1_COVERAGE = coverage([
  ['PL-0001', NSSF_SPLIT, '2025-01-12T09:40:00'],
  ['PL-0002', NSSF_SPLIT, '2025-01-12T09:44:00'],
]);

/**
 * Rate rows at one contract's own term. Every agreement below carries a Default
 * so a claim prices through the contract rather than falling back to the
 * standard price, plus one narrower row of its own.
 * rows: [[scope level, scope value, method, params], …]
 */
const rateRows = (from, to, rows) =>
  rows.map(([scopeLevel, scopeValue, method, params], i) => ({
    id: `MT-${String(i + 1).padStart(3, '0')}`,
    scopeLevel, scopeValue, method, params,
    effectiveFrom: from, effectiveTo: to, updatedAt: `${from}T09:30:00`,
  }));

// The three agreements that were signed without rates. Bankers v2 pays three
// points less than v1, so the version switcher has something to show.
const MOPH_RATES = rateRows('2026-02-01', '2026-09-30', [
  ['Default', null, '% of Charges', { percent: 75 }],
  ['Category', 'Room & Board', 'Per Diem', { amount: 120, wardType: 'General' }],
]);

const BANKERS_LAB = schedule([['LAB-0001', 11], ['LAB-0002', 19.5], ['LAB-0004', 12.5], ['LAB-0007', 24]]);

const BANKERS_V1_RATES = rateRows('2025-07-01', '2026-06-30', [
  ['Default', null, '% of Charges', { percent: 86 }],
  ['Category', 'Lab', 'Fixed Amount', { feeSchedule: BANKERS_LAB }],
]);

const BANKERS_V2_RATES = rateRows('2026-07-01', '2026-11-05', [
  ['Default', null, '% of Charges', { percent: 83 }],
  ['Category', 'Lab', 'Fixed Amount', { feeSchedule: structuredClone(BANKERS_LAB) }],
]);

const BUPA_RATES = rateRows('2026-08-01', '2027-07-31', [
  ['Default', null, '% of Charges', { percent: 92 }],
  ['Category', 'Room & Board', 'Per Diem', { amount: 200, wardType: 'Private' }],
]);

// --- the agreements that gave every remaining payer a contract --------------
// Five straightforward 2026 contracts, written as a table rather than five
// blocks: a default percentage, one narrower rate row, and the same coverage
// split on each linked plan. Performance reports on payers with claims, and a
// payer with no contract carries none.

/** The split a straightforward agreement carries: 20% capped at $400, lab free. */
const STANDARD_SPLIT = [
  ['Default', null, true, 'Co-pay %', 20, 0, 400],
  ['Category', 'Lab', true, 'None', 0, 0, null],
];

/** [id, payerId, no, lineage, name, start, end, planIds, default %, extra rate, author] */
const STRAIGHTFORWARD = [
  ['CTR-0011', 'PY-0003', 'CT-2026-008', 'CL-0009', 'Army health fund service agreement',
    '2026-01-01', '2026-12-31', ['PL-0007', 'PL-0008'], 78,
    ['Category', 'Room & Board', 'Per Diem', { amount: 140, wardType: 'Semi-Private' }], 'Tarek Solh'],

  ['CTR-0012', 'PY-0006', 'CT-2026-009', 'CL-0010', 'Civil servants cooperative agreement',
    '2026-02-15', '2027-02-14', ['PL-0012', 'PL-0013', 'PL-0014'], 82,
    ['Category', 'Consultation', 'Fixed Amount', { feeSchedule: schedule([
      ['CON-0001', 20], ['CON-0002', 36], ['CON-0003', 24], ['CON-0004', 34]]) }], 'Nadine Rizk'],

  ['CTR-0013', 'PY-0009', 'CT-2026-010', 'CL-0011', 'Allianz SNA provider network',
    '2026-01-20', '2026-12-31', ['PL-0022', 'PL-0023'], 88,
    ['Category', 'Radiology', 'Fixed Amount', { feeSchedule: schedule([
      ['RAD-0001', 265], ['RAD-0003', 380], ['RAD-0004', 55], ['RAD-0006', 130]]) }], 'Georges Khoury'],

  ['CTR-0014', 'PY-0011', 'CT-2026-011', 'CL-0012', 'Arope health network agreement',
    '2026-04-01', '2027-03-31', ['PL-0027', 'PL-0028'], 84,
    ['Category', 'Room & Board', 'Per Diem', { amount: 165, wardType: 'Private' }], 'Tarek Solh'],

  ['CTR-0015', 'PY-0026', 'CT-2026-012', 'CL-0013', 'Cigna Global provider agreement',
    '2026-03-15', '2027-03-14', ['PL-0057', 'PL-0058'], 90,
    ['Category', 'Lab', 'Fixed Amount', { feeSchedule: schedule([
      ['LAB-0001', 10.5], ['LAB-0003', 8], ['LAB-0005', 15.5], ['LAB-0008', 27]]) }], 'Nadine Rizk'],
];

const straightforward = STRAIGHTFORWARD.map(
  ([id, payerId, contractNo, lineageId, name, startDate, endDate, planIds, percent, extra, createdBy]) => ({
    id, payerId, contractNo, name, version: 1, lineageId,
    status: 'Active', startDate, endDate, effectiveDate: startDate,
    closedAt: null, terminationDate: null, terminationReason: '',
    planIds,
    document: { fileName: `${contractNo.toLowerCase()}-agreement.pdf`, size: 480000, uploadedAt: `${startDate}T09:20:00` },
    createdBy, createdAt: `${startDate}T09:15:00`, updatedAt: `${startDate}T09:30:00`,
    methodologies: rateRows(startDate, endDate, [['Default', null, '% of Charges', { percent }], extra]),
    overagePolicies: [],
    coverage: coverage(planIds.map((planId, i) => [planId, STANDARD_SPLIT, `${startDate}T10:${20 + i * 4}:00`])),
    preAuth: [], rules: [], ruleEvaluation: 'first-match',
  }),
);

export const contracts = [
  { id: 'CTR-0001', payerId: 'PY-0001', contractNo: 'CT-2026-001', name: 'NSSF hospitalization 2026', version: 2, lineageId: 'CL-0001',
    status: 'Active', startDate: '2026-01-01', endDate: '2026-12-31', effectiveDate: '2026-01-01',
    closedAt: null, terminationDate: null, terminationReason: '',
    planIds: ['PL-0001', 'PL-0002'],
    document: { fileName: 'nssf-hospitalization-2026.pdf', size: 842000, uploadedAt: '2026-01-14T11:05:00' },
    createdBy: 'Tarek Solh', createdAt: '2026-01-14T11:02:00', updatedAt: '2026-01-14T11:41:00',
    methodologies: NSSF_METHODOLOGIES, overagePolicies: NSSF_OVERAGE, coverage: NSSF_COVERAGE, preAuth: NSSF_PREAUTH, referralRequired: NSSF_REFERRAL, rules: NSSF_RULES, ruleEvaluation: 'first-match' },

  { id: 'CTR-0002', payerId: 'PY-0002', contractNo: 'CT-2026-002', name: 'MOPH uninsured coverage 2026', version: 1, lineageId: 'CL-0002',
    status: 'Active', startDate: '2026-02-01', endDate: '2026-09-30', effectiveDate: '2026-02-01',
    closedAt: null, terminationDate: null, terminationReason: '',
    planIds: ['PL-0004', 'PL-0006'],
    document: { fileName: 'moph-bed-quota-2026.pdf', size: 526000, uploadedAt: '2026-02-09T14:20:00' },
    createdBy: 'Georges Khoury', createdAt: '2026-02-09T14:18:00', updatedAt: '2026-02-09T14:25:00',
    methodologies: MOPH_RATES, overagePolicies: [], coverage: [], preAuth: [], rules: [], ruleEvaluation: 'first-match' },

  { id: 'CTR-0003', payerId: 'PY-0007', contractNo: 'CT-2026-003', name: 'Bankers Assurance master agreement', version: 1, lineageId: 'CL-0003',
    status: 'Expired', startDate: '2025-07-01', endDate: '2026-06-30', effectiveDate: '2025-07-01',
    closedAt: '2026-07-01', terminationDate: null, terminationReason: '',
    planIds: ['PL-0015', 'PL-0016'],
    document: { fileName: 'bankers-master-2025.pdf', size: 604000, uploadedAt: '2025-06-24T10:15:00' },
    createdBy: 'Tarek Solh', createdAt: '2025-06-24T10:10:00', updatedAt: '2026-07-01T09:05:00',
    methodologies: BANKERS_V1_RATES, overagePolicies: [], coverage: [], preAuth: [], rules: [], ruleEvaluation: 'first-match' },

  { id: 'CTR-0004', payerId: 'PY-0007', contractNo: 'CT-2026-003', name: 'Bankers Assurance master agreement', version: 2, lineageId: 'CL-0003',
    status: 'Active', startDate: '2026-07-01', endDate: '2026-11-05', effectiveDate: '2026-07-01',
    closedAt: null, terminationDate: null, terminationReason: '',
    planIds: ['PL-0015', 'PL-0016', 'PL-0017'],
    document: { fileName: 'bankers-master-2026-v2.pdf', size: 688000, uploadedAt: '2026-06-18T15:40:00' },
    createdBy: 'Nadine Rizk', createdAt: '2026-06-18T15:35:00', updatedAt: '2026-07-01T09:05:00',
    methodologies: BANKERS_V2_RATES, overagePolicies: [], coverage: [], preAuth: [], rules: [], ruleEvaluation: 'first-match' },

  { id: 'CTR-0005', payerId: 'PY-0008', contractNo: 'CT-2026-004', name: 'AXA network agreement', version: 1, lineageId: 'CL-0004',
    status: 'Active', startDate: '2026-03-01', endDate: '2026-12-05', effectiveDate: '2026-03-01',
    closedAt: null, terminationDate: null, terminationReason: '',
    planIds: ['PL-0019', 'PL-0020'],
    document: { fileName: 'axa-network-agreement-2026.pdf', size: 512000, uploadedAt: '2026-02-24T11:30:00' },
    createdBy: 'Tarek Solh', createdAt: '2026-02-24T11:25:00', updatedAt: '2026-08-11T10:05:00',
    methodologies: AXA_METHODOLOGIES, overagePolicies: [], coverage: AXA_COVERAGE, preAuth: AXA_PREAUTH, referralRequired: AXA_REFERRAL, rules: AXA_RULES, ruleEvaluation: 'first-match' },

  { id: 'CTR-0006', payerId: 'PY-0025', contractNo: 'CT-2026-005', name: 'Bupa Global provider agreement', version: 1, lineageId: 'CL-0005',
    status: 'Active', startDate: '2026-08-01', endDate: '2027-07-31', effectiveDate: '2026-08-01',
    closedAt: null, terminationDate: null, terminationReason: '',
    planIds: ['PL-0054', 'PL-0055'],
    document: { fileName: 'bupa-global-agreement.pdf', size: 1024000, uploadedAt: '2026-08-01T13:20:00' },
    createdBy: 'Georges Khoury', createdAt: '2026-08-01T13:18:00', updatedAt: '2026-08-01T13:30:00',
    methodologies: BUPA_RATES, overagePolicies: [], coverage: [], preAuth: [], rules: [], ruleEvaluation: 'first-match' },

  { id: 'CTR-0007', payerId: 'PY-0002', contractNo: 'CT-2027-001', name: 'MOPH dialysis programme 2027', version: 1, lineageId: 'CL-0006',
    status: 'Draft', startDate: '2027-01-01', endDate: '2027-12-31', effectiveDate: null,
    closedAt: null, terminationDate: null, terminationReason: '',
    planIds: ['PL-0006'],
    document: null,
    createdBy: 'Nadine Rizk', createdAt: '2026-09-01T10:45:00', updatedAt: '2026-09-01T10:52:00',
    methodologies: MOPH_METHODOLOGIES, overagePolicies: [], coverage: [], preAuth: [], rules: [], ruleEvaluation: 'first-match' },

  { id: 'CTR-0008', payerId: 'PY-0007', contractNo: 'CT-2026-007', name: 'Bankers corporate group addendum', version: 1, lineageId: 'CL-0007',
    status: 'Draft', startDate: '2026-11-06', endDate: '2027-11-05', effectiveDate: null,
    closedAt: null, terminationDate: null, terminationReason: '',
    planIds: ['PL-0017'],
    document: { fileName: 'bankers-corporate-addendum-draft.docx', size: 96000, uploadedAt: '2026-09-04T16:10:00' },
    createdBy: 'Tarek Solh', createdAt: '2026-09-04T16:05:00', updatedAt: '2026-09-04T16:12:00',
    methodologies: [], overagePolicies: [], coverage: [], preAuth: [], rules: [], ruleEvaluation: 'first-match' },

  { id: 'CTR-0009', payerId: 'PY-0001', contractNo: 'CT-2026-006', name: 'NSSF ambulatory pilot', version: 1, lineageId: 'CL-0008',
    status: 'Terminated', startDate: '2026-01-15', endDate: '2026-12-31', effectiveDate: '2026-01-15',
    closedAt: null, terminationDate: '2026-05-31', terminationReason: 'Pilot withdrawn by the fund — ambulatory care moved off direct billing.',
    planIds: ['PL-0003'],
    document: { fileName: 'nssf-ambulatory-pilot.pdf', size: 234000, uploadedAt: '2026-01-15T09:30:00' },
    createdBy: 'Georges Khoury', createdAt: '2026-01-15T09:25:00', updatedAt: '2026-05-31T14:20:00',
    methodologies: [], overagePolicies: [], coverage: [], preAuth: [], rules: [], ruleEvaluation: 'first-match' },

  { id: 'CTR-0010', payerId: 'PY-0001', contractNo: 'CT-2026-001', name: 'NSSF hospitalization 2026', version: 1, lineageId: 'CL-0001',
    status: 'Expired', startDate: '2025-01-01', endDate: '2025-12-31', effectiveDate: '2025-01-01',
    closedAt: '2026-01-01', terminationDate: null, terminationReason: '',
    planIds: ['PL-0001', 'PL-0002'],
    document: { fileName: 'nssf-hospitalization-2025.pdf', size: 806000, uploadedAt: '2025-01-09T10:05:00' },
    createdBy: 'Tarek Solh', createdAt: '2025-01-09T10:02:00', updatedAt: '2026-01-01T09:00:00',
    methodologies: NSSF_V1_METHODOLOGIES, overagePolicies: structuredClone(NSSF_OVERAGE), coverage: NSSF_V1_COVERAGE,
    preAuth: structuredClone(NSSF_PREAUTH), referralRequired: structuredClone(NSSF_REFERRAL),
    rules: structuredClone(NSSF_RULES), ruleEvaluation: 'first-match' },

  ...straightforward,
];
