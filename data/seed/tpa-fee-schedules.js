// Seed — TPA fee schedules (amendment 42). One schedule per administrator ×
// payer link, versioned and append-only. GlobeMed charges Arope and Cigna
// three per cent of what the payer pays, two on laboratory claims, capped at
// $30 a claim; on 20 July it notified four per cent for Cigna from August,
// which the desk entered as v2 and GlobeMed withdrew in writing on 3
// September — the retrospective v3 that restates August at three per cent
// belongs to amendment TAM-0001 and is invisible until that amendment posts
// (the amendment seed posts it). NEXtCARE charges Allianz a flat $4 a claim
// from August; its link runs from June, so a July fee has no version to be
// read against.
//
// Versions are dated to cover the remittance dates the accrual seed lands
// on (May to September 2026), and the standing ones never overlap.

export const tpaFeeSchedules = [
  {
    id: 'TFS-0001', tpaId: 'TP-0001', payerId: 'PY-0011',
    versions: [
      { ref: 'TFS-0001/v1', n: 1, basis: 'pctPaid', rate: 3,
        scopes: [{ level: 'all', ref: null, rate: 3 }, { level: 'serviceGroup', ref: 'Lab', rate: 2 }],
        capPerClaim: 30, capPerPeriod: null, effectiveFrom: '2026-01-01', effectiveTo: null,
        retrospective: false, amendmentId: null, supersedesRef: null, posted: true, postedAt: '2026-01-05T09:10:00.000Z',
        note: '2026 TPA contract, annex C', createdAt: '2026-01-05T09:10:00.000Z', createdBy: 'Georges Khoury' },
    ],
    createdAt: '2026-01-05T09:10:00.000Z', updatedAt: '2026-01-05T09:10:00.000Z',
  },
  {
    id: 'TFS-0002', tpaId: 'TP-0001', payerId: 'PY-0026',
    versions: [
      { ref: 'TFS-0002/v1', n: 1, basis: 'pctPaid', rate: 3,
        scopes: [{ level: 'all', ref: null, rate: 3 }, { level: 'serviceGroup', ref: 'Lab', rate: 2 }],
        capPerClaim: 30, capPerPeriod: null, effectiveFrom: '2026-01-01', effectiveTo: '2026-07-31',
        retrospective: false, amendmentId: null, supersedesRef: null, posted: true, postedAt: '2026-01-05T09:12:00.000Z',
        note: '2026 TPA contract, annex C — closed by the August notice', createdAt: '2026-01-05T09:12:00.000Z', createdBy: 'Georges Khoury' },
      { ref: 'TFS-0002/v2', n: 2, basis: 'pctPaid', rate: 4,
        scopes: [{ level: 'all', ref: null, rate: 4 }, { level: 'serviceGroup', ref: 'Lab', rate: 2 }],
        capPerClaim: 30, capPerPeriod: null, effectiveFrom: '2026-08-01', effectiveTo: null,
        retrospective: false, amendmentId: null, supersedesRef: null, posted: true, postedAt: '2026-07-22T14:40:00.000Z',
        note: 'GlobeMed notice of 20 July — four per cent on Cigna claims from 1 August', createdAt: '2026-07-22T14:40:00.000Z', createdBy: 'Tarek Solh' },
      // Restated by TAM-0001 (reason: TPA error). Retrospective and unposted here — the amendment seed posts it.
      { ref: 'TFS-0002/v3', n: 3, basis: 'pctPaid', rate: 3,
        scopes: [{ level: 'all', ref: null, rate: 3 }, { level: 'serviceGroup', ref: 'Lab', rate: 2 }],
        capPerClaim: 30, capPerPeriod: null, effectiveFrom: '2026-08-01', effectiveTo: null,
        retrospective: true, amendmentId: 'TAM-0001', supersedesRef: 'TFS-0002/v2', posted: false, postedAt: null,
        note: 'GlobeMed’s letter of 3 September withdraws the July notice — the agreement’s three per cent stands from 1 August', createdAt: '2026-09-04T10:20:00.000Z', createdBy: 'Hala Mansour' },
    ],
    createdAt: '2026-01-05T09:12:00.000Z', updatedAt: '2026-09-04T10:20:00.000Z',
  },
  {
    id: 'TFS-0003', tpaId: 'TP-0002', payerId: 'PY-0009',
    versions: [
      { ref: 'TFS-0003/v1', n: 1, basis: 'flatClaim', rate: 4,
        scopes: [{ level: 'all', ref: null, rate: 4 }],
        capPerClaim: null, capPerPeriod: null, effectiveFrom: '2026-08-01', effectiveTo: null,
        retrospective: false, amendmentId: null, supersedesRef: null, posted: true, postedAt: '2026-08-03T11:05:00.000Z',
        note: 'NEXtCARE fee schedule received 3 August — a flat administration fee per claim', createdAt: '2026-08-03T11:05:00.000Z', createdBy: 'Tarek Solh' },
    ],
    createdAt: '2026-08-03T11:05:00.000Z', updatedAt: '2026-08-03T11:05:00.000Z',
  },
];
