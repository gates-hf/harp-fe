// Seed — audit. Shared, append-only trail for every governed entity in the
// platform. `entity` is the repository name, `entityId` the row it describes.
// Modules never edit or delete a row here; they only append.

export const audit = [
  { id: 'AU-0001', entity: 'payers', entityId: 'PY-0001', action: 'Created', user: 'Tarek Solh', at: '2026-01-14T11:02:00', details: 'Payer registered from the 2026 contract file' },
  { id: 'AU-0002', entity: 'payers', entityId: 'PY-0001', action: 'Document added', user: 'Tarek Solh', at: '2026-01-14T11:05:00', details: 'Contract — nssf-hospitalization-2026.pdf' },
  { id: 'AU-0003', entity: 'payers', entityId: 'PY-0001', action: 'Updated', user: 'Georges Khoury', at: '2026-06-02T09:40:00', details: 'Changed phone, documents' },
  { id: 'AU-0004', entity: 'payers', entityId: 'PY-0001', action: 'Updated', user: 'Tarek Solh', at: '2026-08-14T09:20:00', details: 'Changed plans — ambulatory care deactivated' },
  { id: 'AU-0005', entity: 'payers', entityId: 'PY-0002', action: 'Created', user: 'Georges Khoury', at: '2026-02-09T14:18:00', details: 'Payer registered' },
  { id: 'AU-0006', entity: 'payers', entityId: 'PY-0002', action: 'Updated', user: 'Nadine Rizk', at: '2026-09-01T10:40:00', details: 'Changed email, contacts' },
  { id: 'AU-0007', entity: 'payers', entityId: 'PY-0007', action: 'Created', user: 'Tarek Solh', at: '2026-03-11T10:40:00', details: 'Payer registered' },
  { id: 'AU-0008', entity: 'payers', entityId: 'PY-0007', action: 'Document added', user: 'Tarek Solh', at: '2026-03-11T10:52:00', details: 'License Copy — bankers-license.jpg' },
  { id: 'AU-0009', entity: 'payers', entityId: 'PY-0007', action: 'Updated', user: 'Nadine Rizk', at: '2026-09-02T11:30:00', details: 'Changed plans — legacy silver deactivated' },
  { id: 'AU-0010', entity: 'payers', entityId: 'PY-0013', action: 'Created', user: 'Tarek Solh', at: '2026-01-09T09:15:00', details: 'Payer registered' },
  { id: 'AU-0011', entity: 'payers', entityId: 'PY-0013', action: 'Deactivated', user: 'Georges Khoury', at: '2026-04-28T12:10:00', details: 'Direct billing suspended pending licence renewal' },
  { id: 'AU-0012', entity: 'payers', entityId: 'PY-0018', action: 'Deactivated', user: 'Georges Khoury', at: '2026-03-17T14:05:00', details: 'Contract terminated by the payer' },
  { id: 'AU-0013', entity: 'payers', entityId: 'PY-0024', action: 'Deactivated', user: 'Tarek Solh', at: '2026-02-12T11:40:00', details: 'Administration moved to NEXtCARE' },
  { id: 'AU-0014', entity: 'payers', entityId: 'PY-0022', action: 'Created', user: 'Georges Khoury', at: '2026-01-22T11:10:00', details: 'Administrator registered' },
  { id: 'AU-0015', entity: 'payers', entityId: 'PY-0022', action: 'Updated', user: 'Nadine Rizk', at: '2026-09-05T09:05:00', details: 'Changed contacts, documents' },
  { id: 'AU-0016', entity: 'payers', entityId: 'PY-0025', action: 'Created', user: 'Georges Khoury', at: '2026-08-01T13:20:00', details: 'International payer registered' },
  { id: 'AU-0017', entity: 'payers', entityId: 'PY-0020', action: 'Updated', user: 'Tarek Solh', at: '2026-09-04T12:35:00', details: 'Changed licenseNo, contacts, documents' },
  { id: 'AU-0018', entity: 'payers', entityId: 'PY-0027', action: 'Updated', user: 'Georges Khoury', at: '2026-09-06T08:15:00', details: 'Changed plans — instalment plan added' },
];
