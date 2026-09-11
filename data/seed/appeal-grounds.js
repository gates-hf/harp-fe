// Seed — appeal grounds (amendment 38). Static, like reference.js: the
// grounds an appeal case argues on, the kinds of evidence a bundle can carry,
// and which evidence each ground expects — the map the bundle tab warns from
// when a ground is argued with nothing behind it. A ground of kind
// `contract` is argued from the agreement and needs at least one citation
// rendered off the contract version stamped on the claim; the rest are
// argued from the record. Imports nothing, so the repository and the letter
// templates can both read it without a cycle.

export const GROUNDS = [
  { id: 'contract_violation', label: 'Adjudicated outside the contract terms', kind: 'contract',
    summary: 'The payer applied a rate, an exclusion or a condition the agreement in force on the date of service does not carry.' },
  { id: 'coverage_confirmed', label: 'Service covered under the plan', kind: 'contract',
    summary: 'The coverage table on the stamped contract version covers the charge; the refusal reads an exclusion that is not there.' },
  { id: 'medical_necessity', label: 'Medical necessity', kind: 'clinical',
    summary: 'The service was clinically indicated on the record — the diagnosis, the note and the protocol support it.' },
  { id: 'authorization_on_file', label: 'Authorisation on file', kind: 'administrative',
    summary: 'The payer authorised the service before it was rendered; the authorisation number is on the claim or on the request.' },
  { id: 'eligibility_confirmed', label: 'Eligibility confirmed on the date of service', kind: 'administrative',
    summary: 'The cover was verified on the day — the check is on file and the policy was in date.' },
  { id: 'documentation_supplied', label: 'Documentation supplied', kind: 'administrative',
    summary: 'The documents the payer says are missing were filed with the claim, or are attached to this appeal.' },
  { id: 'coding_supported', label: 'Coding supported by the record', kind: 'clinical',
    summary: 'The diagnosis and procedure codes are what the chart supports; the coding summary is attached.' },
  { id: 'timely_filing', label: 'Filed inside the window', kind: 'administrative',
    summary: 'The claim was submitted inside the filing window the agreement allows; the submission record shows the date.' },
  { id: 'not_duplicate', label: 'Not a duplicate service', kind: 'administrative',
    summary: 'Two distinct services on the same day, each documented — not one billed twice.' },
];

export const ground = (id) => GROUNDS.find((g) => g.id === id) || null;
export const groundLabel = (id) => ground(id)?.label || (id ? String(id) : '—');
export const isContractGround = (id) => ground(id)?.kind === 'contract';

/** What a bundle item can be. `system` items are references into the registers; `upload` is a file the desk added. */
export const BUNDLE_TYPES = [
  'Claim', 'Remittance advice', 'Denial notice', 'Contract extract', 'Eligibility check', 'Authorisation', 'Referral',
  'Clinical document', 'Claim attachment', 'Coding summary', 'Encounter record', 'Prior appeal package', 'Upload',
];

/** The evidence a ground expects in the bundle — the tab warns per missing type; nothing here blocks. */
export const GROUND_EVIDENCE = {
  contract_violation: ['Contract extract', 'Claim', 'Remittance advice'],
  coverage_confirmed: ['Contract extract', 'Claim'],
  medical_necessity: ['Clinical document', 'Coding summary'],
  authorization_on_file: ['Authorisation', 'Claim'],
  eligibility_confirmed: ['Eligibility check'],
  documentation_supplied: ['Clinical document', 'Claim attachment'],
  coding_supported: ['Coding summary', 'Clinical document'],
  timely_filing: ['Claim'],
  not_duplicate: ['Claim', 'Encounter record'],
};

/** The glyph a bundle type wears. */
export const BUNDLE_ICONS = {
  Claim: 'description', 'Remittance advice': 'payments', 'Denial notice': 'cancel', 'Contract extract': 'gavel',
  'Eligibility check': 'verified_user', Authorisation: 'task_alt', Referral: 'forward', 'Clinical document': 'clinical_notes',
  'Claim attachment': 'attach_file', 'Coding summary': 'code', 'Encounter record': 'local_hospital',
  'Prior appeal package': 'inventory_2', Upload: 'upload_file',
};
