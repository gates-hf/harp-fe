// Seed — the claims in assembly (amendment 27). Eleven claims over the nine
// closed, insured, charged encounters the board carries, written as a table of
// intents — this visit, this coding, this state — and assembled by the same
// engine a live visit goes through, so the lines are the ledger's and the
// scrub findings are the contracts' rather than a record of something that
// never ran.
//
// data/store.js does not import this file: data/repositories/claims.js reads
// it on first load of a table with no assembled claim and hands it the two
// factories it needs (`payloadFor`, `rowFor`), so the seed never writes and
// never imports the repository back.
//
// Nine encounters carry a contract and posted charges, and the assembler keeps
// one primary per encounter — so the amendment's twelve are eleven here: three
// plain drafts rather than four. The secondary is defined on the emergency
// visit's patient, whose AXA spouse cover was still in the chain when the
// claim was assembled and has since been put on hold — which is what a scrub
// of it now says.

const CODER = 'Tarek Solh';

/** Coding as the coding feature will hand it over: the current version of a chart. */
const coded = (version, codedAt, diagnoses, procedures = []) => ({
  status: 'Coded', version, codedAt, codedBy: CODER, diagnoses, procedures,
});
const dx = (code, desc, principal = false, poa = null) => ({ code, desc, principal, poa });

/**
 * One intent per claim, numbered in this order off the table. `pick` names the
 * charge codes a claim takes when the encounter's lines are split between two
 * claims; `late` flags them late; `parent` names another intent's key.
 */
const INTENTS = [
  { key: 'bupa', enc: 'ENC-2026-000410', createdAt: '2026-08-24T10:05:00', state: 'Ready',
    pick: ['RNB-0001', 'CON-0002', 'PRF-0001'],
    scrub: '2026-08-25T09:12:00', finalizedAt: '2026-08-25T09:20:00',
    coding: (lines) => coded(1, '2026-08-23T16:40:00',
      [dx('K35.30', 'Acute appendicitis with localized peritonitis, without perforation or abscess', true, 'Y'),
        dx('E11.65', 'Type 2 diabetes mellitus with hyperglycemia', false, 'Y')],
      [{ code: '0DTJ4ZZ', desc: 'Resection of appendix, percutaneous endoscopic approach', date: '2026-08-20', doctorId: 'DR-004',
        chargeLineIds: [lines('PRF-0001')] }]),
    uploads: [{ id: 'CAT-0001', type: 'Operative Note', lineIds: ['PRF-0001'] }] },

  // The two charts the coding register seeds as Coded carry its codes here, so
  // a refresh finds the same version it was assembled from.
  { key: 'nssf-er', enc: 'ENC-2026-000401', createdAt: '2026-08-16T09:30:00', state: 'Draft',
    coding: (lines) => coded(1, '2026-08-15T17:10:00',
      [dx('R07.9', 'Chest pain, unspecified', true), dx('C34.90', 'Malignant neoplasm of unspecified part of unspecified bronchus or lung')],
      [{ code: '71046', desc: 'Radiologic examination, chest; 2 views', date: '2026-08-11', doctorId: 'DR-0016',
        chargeLineIds: [lines('RAD-0002')] }]),
    uploads: [{ id: 'CAT-0002', type: 'Progress Note', lineIds: [] }] },

  { key: 'allianz-1', enc: 'ENC-2026-000402', createdAt: '2026-08-15T14:20:00', state: 'Draft',
    coding: () => coded(1, '2026-08-14T11:00:00', [dx('M17.11', 'Unilateral primary osteoarthritis, right knee', true)]) },

  { key: 'allianz-2', enc: 'ENC-2026-000408', createdAt: '2026-08-21T10:40:00', state: 'Draft',
    scrub: '2026-08-21T11:05:00',
    coding: () => coded(1, '2026-08-20T15:30:00', [dx('M25.569', 'Pain in unspecified knee', true)]),
    uploads: [{ id: 'CAT-0004', type: 'Progress Note', lineIds: [] }] },

  { key: 'moph-paeds', enc: 'ENC-2026-000412', createdAt: '2026-08-25T09:15:00', state: 'Draft',
    scrub: '2026-08-26T08:50:00',
    coding: () => coded(1, '2026-08-24T12:20:00', [dx('J06.9', 'Acute upper respiratory infection, unspecified', true)]) },

  { key: 'moph-obgyn', enc: 'ENC-2026-000415', createdAt: '2026-08-28T11:10:00', state: 'Ready',
    scrub: '2026-08-28T11:30:00', finalizedAt: '2026-08-28T11:34:00',
    coding: () => coded(1, '2026-08-27T09:45:00', [dx('Z34.83', 'Encounter for supervision of other normal pregnancy, third trimester', true)]) },

  // Stale: the chart was recoded after the claim was assembled — the claim
  // still carries version 1, and the recode voided its scrub.
  { key: 'moph-delivery', enc: 'ENC-2026-000416', createdAt: '2026-08-30T10:00:00', state: 'Draft',
    stale: { at: '2026-09-04T15:22:00', reason: 'Recode requested — coding version 2 supersedes the version this claim carries' },
    coding: () => coded(1, '2026-08-29T14:00:00',
      [dx('O80', 'Encounter for full-term uncomplicated delivery', true, 'Y'), dx('Z37.0', 'Single live birth', false, 'Y')]) },

  { key: 'moph-medicine', enc: 'ENC-2026-000418', createdAt: '2026-09-06T09:00:00', state: 'Draft',
    scrub: '2026-09-07T10:15:00',
    coding: () => coded(1, '2026-09-05T16:00:00',
      [dx('E11.65', 'Type 2 diabetes mellitus with hyperglycemia', true, 'Y'), dx('I10', 'Essential (primary) hypertension')]) },

  // The ISF plan no Pactum contract names: the visit was cleared on an
  // override, the charges were priced as self-pay, and the claim cannot go.
  { key: 'isf', enc: 'ENC-2026-000404', createdAt: '2026-08-17T13:30:00', state: 'Draft',
    scrub: '2026-08-18T09:00:00',
    coding: (lines) => coded(1, '2026-08-16T10:30:00',
      [dx('R07.9', 'Chest pain, unspecified', true), dx('I10', 'Essential (primary) hypertension')],
      [{ code: '71260', desc: 'CT thorax, with contrast', date: '2026-08-14', doctorId: 'DR-0009',
        chargeLineIds: [lines('RAD-0003')] }]) },

  // The CBC on the Bupa admission landed after the primary was finalized, so
  // it rides a supplementary chained to it.
  { key: 'bupa-late', enc: 'ENC-2026-000410', createdAt: '2026-09-02T14:00:00', state: 'Draft',
    kind: 'Supplementary', parent: 'bupa', pick: ['LAB-0001'], late: true,
    coding: (lines) => INTENTS[0].coding(lines),
    uploads: [{ id: 'CAT-0003', type: 'Lab Report', lineIds: ['LAB-0001'] }] },

  // Defined behind the emergency visit's primary while POL-0005 was still in
  // the chain; not activated — its lines are what the fund's remittance leaves.
  { key: 'nssf-secondary', enc: 'ENC-2026-000401', createdAt: '2026-08-16T09:30:00', state: 'Draft',
    kind: 'Secondary', parent: 'nssf-er',
    cover: { payerId: 'PY-0008', planId: 'PL-0020', policyId: 'POL-0005' } },
];

/**
 * buildAssemblyClaims({ payloadFor, rowFor, releasedLines }) →
 * { claims, scrubs: [{ claimNo, at, by }], finalize: [{ claimNo, at }], trail }.
 * The repository pushes the rows, runs the scrubs, finalizes what passes and
 * appends the trail with the times these things happened at.
 */
export function buildAssemblyClaims({ payloadFor, rowFor, releasedLines }) {
  const claims = [];
  const scrubs = [];
  const finalize = [];
  const trail = [];
  const byKey = new Map();

  for (const intent of INTENTS) {
    const charges = releasedLines(intent.enc);
    const codeOf = (chargeCode) => charges.find((c) => c.chargeCode === chargeCode)?.id || null;
    const pick = intent.pick ? (c) => intent.pick.includes(c.chargeCode) : null;
    let row;

    if (intent.kind === 'Secondary') {
      const parent = byKey.get(intent.parent);
      row = rowFor(payloadFor(intent.enc, { coding: parent.codingRecord, pick: () => false }), {
        kind: 'Secondary', parentClaimNo: parent.claimNo, createdAt: intent.createdAt,
      });
      Object.assign(row, intent.cover, {
        contractId: null, contractNo: null, contractVersion: null, coding: parent.coding, docRequirements: [], attachments: [],
      });
      parent.childClaimNos = [...new Set([...(parent.childClaimNos || []), row.claimNo])];
      trail.push(entry(row, intent.createdAt, 'Created', `Secondary defined behind ${parent.claimNo} — activates when the primary is remitted`));
    } else {
      const codingRecord = intent.coding(codeOf);
      const payload = payloadFor(intent.enc, {
        coding: codingRecord, pick, lateChargeLineIds: intent.late ? charges.filter(pick).map((c) => c.id) : [],
      });
      const parent = intent.parent ? byKey.get(intent.parent) : null;
      row = rowFor(payload, {
        kind: intent.kind || 'Primary', parentClaimNo: parent?.claimNo || null, createdAt: intent.createdAt,
      });
      row.codingRecord = codingRecord;
      if (parent) parent.childClaimNos = [...new Set([...(parent.childClaimNos || []), row.claimNo])];
      const n = row.lines.length;
      trail.push(entry(row, intent.createdAt, 'Created',
        `Assembled from ${intent.enc} · ${(intent.kind || 'Primary').toLowerCase()} · ${n} line${n === 1 ? '' : 's'}${
          row.coding ? ` · coding v${row.coding.version}` : ''}${row.contractNo ? ` · ${row.contractNo} v${row.contractVersion}` : ' · no contract'}`));
    }

    // Uploads: the file is in data/seed/claim-attachments.js under the same id;
    // the claim carries the link, with the line named by its charge code, and
    // the repository points the file back at the number this claim was given.
    for (const up of intent.uploads || []) {
      const lineIds = up.lineIds.map((code) => row.lines.find((l) => l.chargeCode === code)?.id).filter(Boolean);
      const serial = row.attachments.reduce((m, a) => Math.max(m, Number(String(a.id).slice(1)) || 0), 0);
      row.attachments.push({
        id: `A${serial + 1}`, docId: null, fileId: up.id, fileName: fileNameOf(up.id), type: up.type, origin: 'Upload',
        lineIds, required: row.docRequirements.some((r) => r.docType === up.type),
      });
      trail.push(entry(row, uploadedAtOf(up.id), 'Attachment added', `${fileNameOf(up.id)} (${up.type}${lineIds.length ? ` · ${lineIds.join(', ')}` : ''})`));
    }

    if (intent.stale) {
      row.stale = { flag: true, reason: intent.stale.reason, at: intent.stale.at };
      trail.push(entry(row, intent.stale.at, 'Stale', intent.stale.reason));
    }
    if (intent.scrub) scrubs.push({ claimNo: row.claimNo, at: intent.scrub, by: CODER });
    if (intent.state === 'Ready') finalize.push({ claimNo: row.claimNo, at: intent.finalizedAt });

    byKey.set(intent.key, row);
    claims.push(row);
  }
  for (const row of claims) delete row.codingRecord;

  return { claims, scrubs, finalize, trail };
}

const entry = (row, at, action, details) => ({ entity: 'claims', entityId: row.id, action, user: CODER, at, details });

// The upload register is seeded by data/seed/claim-attachments.js; these two
// maps read its file names and times back so the trail names the same file.
const FILES = {
  'CAT-0001': ['operative-note-2026-08-20.pdf', '2026-08-24T10:12:00'],
  'CAT-0002': ['er-triage-sheet-2026-08-11.pdf', '2026-08-16T09:40:00'],
  'CAT-0003': ['pathology-cbc-2026-08-22.pdf', '2026-09-02T14:05:00'],
  'CAT-0004': ['orthopaedic-consult-note-2026-08-18.pdf', '2026-08-21T11:30:00'],
};
const fileNameOf = (id) => FILES[id]?.[0] || id;
const uploadedAtOf = (id) => FILES[id]?.[1] || '';
