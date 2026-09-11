// Seed — code system versions. Owner: modules/pactum (amendment 44).
//
// One current version per system except LOINC, whose only version was retired
// on 2026-01-09 and never replaced. ICD-10-CM carries two: 2025, valid last year
// and no longer current, and 2026, current — the pair a dated lookup resolves
// differently on, since J18.9 reads differently in each.
//
// `isCurrent` is written here and asserted by the repository: at most one per
// system, and setCurrent() is the only live write that moves it.

export const codeSystemVersions = [
  {
    id: 'CSV-0001',
    codeSystemId: 'CS-0001',
    versionLabel: '2025',
    releaseDate: '2024-06-15',
    isCurrent: false,
    status: 'Active',
    validFrom: '2025-01-01',
    validTo: '2025-12-31',
    createdAt: '2024-12-02T10:18:00',
    updatedAt: '2026-01-02T09:00:00',
  },
  {
    id: 'CSV-0002',
    codeSystemId: 'CS-0001',
    versionLabel: '2026',
    releaseDate: '2025-06-13',
    isCurrent: true,
    status: 'Active',
    validFrom: '2026-01-01',
    validTo: null,
    createdAt: '2025-12-15T14:00:00',
    updatedAt: '2026-01-02T09:00:00',
  },
  {
    id: 'CSV-0003',
    codeSystemId: 'CS-0002',
    versionLabel: '2026',
    releaseDate: '2025-09-01',
    isCurrent: true,
    status: 'Active',
    validFrom: '2026-01-01',
    validTo: null,
    createdAt: '2025-12-15T15:05:00',
    updatedAt: '2025-12-15T15:20:00',
  },
  {
    id: 'CSV-0004',
    codeSystemId: 'CS-0003',
    versionLabel: '2026',
    releaseDate: '2025-11-01',
    isCurrent: true,
    status: 'Active',
    validFrom: '2026-01-01',
    validTo: null,
    createdAt: '2026-01-05T11:25:00',
    updatedAt: '2026-01-05T11:40:00',
  },
  {
    id: 'CSV-0005',
    codeSystemId: 'CS-0004',
    versionLabel: '2.78',
    releaseDate: '2024-08-01',
    isCurrent: false,
    status: 'Inactive',
    validFrom: '2025-01-01',
    validTo: '2025-12-31',
    createdAt: '2025-01-10T09:40:00',
    updatedAt: '2026-01-09T16:00:00',
  },
];
