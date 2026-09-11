// Seed — third-party administrators (amendment 42). Two administrators the
// payer master already carries as counterparties (GlobeMed and NEXtCARE sit
// on it with TPA licence numbers): GlobeMed administers Arope and Cigna's
// local network, NEXtCARE administers Allianz SNA. A link is dated — the
// administrator a fee is read against is the one on the payer on the
// remittance date, and NEXtCARE's Allianz link runs from June, two months
// before its first schedule version, which is what leaves July's fee
// unscheduled.

export const tpas = [
  {
    id: 'TP-0001', name: 'GlobeMed Lebanon', payerRecordId: 'PY-0022', status: 'Active',
    contact: { name: 'Rania Sleiman', role: 'Claims Manager', email: 'r.sleiman@globemed.com.lb', phone: '+961 71 550 903' },
    payerLinks: [
      { payerId: 'PY-0011', from: '2026-01-01', to: null },
      { payerId: 'PY-0026', from: '2026-01-01', to: null },
    ],
    note: 'Administers Arope Insurance and Cigna Global’s Lebanese network under the 2026 TPA contract.',
    createdAt: '2026-01-05T09:00:00.000Z', createdBy: 'Georges Khoury', updatedAt: '2026-01-05T09:00:00.000Z',
  },
  {
    id: 'TP-0002', name: 'NEXtCARE Lebanon', payerRecordId: 'PY-0023', status: 'Active',
    contact: { name: 'Yara Mansour', role: 'Claims Manager', email: 'y.mansour@nextcarehealth.com', phone: '+961 3 217 664' },
    payerLinks: [
      { payerId: 'PY-0009', from: '2026-06-01', to: null },
    ],
    note: 'Administers Allianz SNA from June 2026; the fee schedule arrived two months after the network annex.',
    createdAt: '2026-06-02T10:30:00.000Z', createdBy: 'Tarek Solh', updatedAt: '2026-06-02T10:30:00.000Z',
  },
];
