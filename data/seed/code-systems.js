// Seed — code systems. Owner: modules/pactum (amendment 44).
//
// Four systems: the two Claima's coder reads (ICD-10-CM for diagnoses, the
// CPT-shaped Procedures list), HCPCS Level II beside the procedures, and LOINC,
// whose only version was retired and never replaced — the one with no current
// version, so the landing's highlight and the lookup's fallback are reachable
// on a fresh load.
//
// The validity on the system is the agreement's term with the publisher; each
// version carries its own dates in data/seed/code-system-versions.js.

export const codeSystems = [
  {
    id: 'CS-0001',
    name: 'ICD-10-CM',
    systemType: 'DIAGNOSIS',
    status: 'Active',
    validFrom: '2025-01-01',
    validTo: null,
    description: 'Diagnosis codes on every claim. A new release each January; the coder resolves a chart on the release in force on its date of service.',
    createdAt: '2024-12-02T10:15:00',
    updatedAt: '2026-01-02T09:00:00',
  },
  {
    id: 'CS-0002',
    name: 'Procedures',
    systemType: 'PROCEDURE',
    status: 'Active',
    validFrom: '2026-01-01',
    validTo: null,
    description: 'The procedure list in the CPT shape a Lebanese payer accepts on a claim.',
    createdAt: '2025-12-15T15:00:00',
    updatedAt: '2025-12-15T15:20:00',
  },
  {
    id: 'CS-0003',
    name: 'HCPCS Level II',
    systemType: 'PROCEDURE',
    status: 'Active',
    validFrom: '2026-01-01',
    validTo: null,
    description: 'Supplies, drugs and equipment a claim carries beside the procedure codes.',
    createdAt: '2026-01-05T11:20:00',
    updatedAt: '2026-01-05T11:40:00',
  },
  {
    id: 'CS-0004',
    name: 'LOINC',
    systemType: 'LAB',
    status: 'Active',
    validFrom: '2025-01-01',
    validTo: null,
    description: 'Laboratory observation identifiers. The 2025 licence lapsed and no 2026 release has been loaded.',
    createdAt: '2025-01-10T09:30:00',
    updatedAt: '2026-01-09T16:00:00',
  },
];
