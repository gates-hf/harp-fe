// Seed — claim attachments (amendment 27). The files a biller uploaded against
// a claim by hand: the register of what was attached, as opposed to the
// clinical documents the coding feature files, which a claim pulls in by
// reference rather than by copy. Each row is one file; the claim's own
// `attachments[]` entry points at it by `fileId`.
//
// A leaf, the way data/seed/payers.js is: data/store.js imports it, so it
// reads nothing. The claims that carry these files are seeded by
// data/seed/claim-assembly.js, which names the same ids; `claimNo` here is a
// placeholder the claims repository overwrites with the number the claim was
// given, since claim numbers are read off the table rather than written.

export const claimAttachments = [
  // The surgeon's operative note on the Bupa admission, attached against the
  // theatre line — the fund asks for nothing, the biller attached it anyway.
  { id: 'CAT-0001', claimNo: 'bupa', fileName: 'operative-note-2026-08-20.pdf', type: 'Operative Note',
    size: 148000, uploadedAt: '2026-08-24T10:12:00', uploadedBy: 'Tarek Solh', lineIds: ['L3'] },
  // The ER triage sheet on the NSSF emergency visit — filed as a progress note
  // because that is the nearest type the payer reads; the discharge summary
  // the fund actually wants is still missing.
  { id: 'CAT-0002', claimNo: 'nssf-er', fileName: 'er-triage-sheet-2026-08-11.pdf', type: 'Progress Note',
    size: 92000, uploadedAt: '2026-08-16T09:40:00', uploadedBy: 'Tarek Solh', lineIds: [] },
  // The pathology report that came with the late CBC on the supplementary.
  { id: 'CAT-0003', claimNo: 'bupa-late', fileName: 'pathology-cbc-2026-08-22.pdf', type: 'Lab Report',
    size: 121000, uploadedAt: '2026-09-02T14:05:00', uploadedBy: 'Tarek Solh', lineIds: ['L1'] },
  // The consult note on the Allianz orthopaedics visit, attached when the scrub
  // warned that the principal diagnosis was unspecified.
  { id: 'CAT-0004', claimNo: 'allianz-2', fileName: 'orthopaedic-consult-note-2026-08-18.pdf', type: 'Progress Note',
    size: 210000, uploadedAt: '2026-08-21T11:30:00', uploadedBy: 'Georges Khoury', lineIds: [] },
];
