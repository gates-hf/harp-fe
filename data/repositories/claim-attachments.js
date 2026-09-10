// Repository — claim attachments. Owner: modules/claima (amendment 27).
//
// The register of files a biller uploaded against a claim. The claim's own
// `attachments[]` holds the links — an auto-pulled clinical document by its
// `docId`, an upload by its `fileId` here — so the claim says what it carries
// and this table says what the file is. Nothing here decides what a payer
// wants: that is the contract's documentation rows, read by the assembler and
// the scrubber, and `requirementStatus()` below only matches what a claim
// carries against what it was assembled to need.
//
// Writes come through data/repositories/claims.js (addUpload, removeAttachment),
// which audits on the claim; this file commits and keeps the file.

import { store } from '../store.js';
import { current as currentRole } from '../../shared/roles.js';

const TABLE = 'claimAttachments';

/** The kinds a claim file is filed under — the contract's vocabulary, plus the two a payer form needs. */
export const TYPES = [
  'Discharge Summary', 'Operative Note', 'Progress Note', 'Lab Report', 'Imaging Report', 'Consent',
  'Itemised bill', 'Other',
];

export const MAX_BYTES = 10 * 1024 * 1024;

export const all = () => store.table(TABLE);

export const get = (id) => all().find((row) => row.id === id) || null;

export const byClaim = (claimNo) =>
  all().filter((row) => row.claimNo === claimNo).sort((a, b) => String(a.uploadedAt).localeCompare(String(b.uploadedAt)));

/** Keep one uploaded file. Returns the stored row; the claim writes the link and the trail. */
export function record(claimNo, { fileName, type = 'Other', size = 0, lineIds = [] } = {}) {
  const row = {
    id: store.nextId(TABLE, 'CAT-'),
    claimNo,
    fileName,
    type: TYPES.includes(type) ? type : 'Other',
    size: Number(size) || 0,
    uploadedAt: new Date().toISOString(),
    uploadedBy: currentRole().name,
    lineIds: [...lineIds],
  };
  all().push(row);
  store.commit('claimAttachments.record');
  return row;
}

export function remove(id) {
  const rows = all();
  const at = rows.findIndex((row) => row.id === id);
  if (at < 0) return false;
  rows.splice(at, 1);
  store.commit('claimAttachments.remove');
  return true;
}

/**
 * The claim's requirements against what it carries: one entry per document
 * type the contract asked for, with the attachments that answer it. A
 * requirement with nothing behind it is what the Attachments tab marks and
 * the scrub names.
 */
export function requirementStatus(claim) {
  const attachments = claim?.attachments || [];
  return (claim?.docRequirements || []).map((req) => {
    const satisfiedBy = attachments.filter((a) => a.type === req.docType);
    return { ...req, satisfiedBy, met: satisfiedBy.length > 0 };
  });
}

export const missingRequirements = (claim) => requirementStatus(claim).filter((r) => !r.met);

/** "2 of 3 required documents attached", or '' when nothing is required. */
export function requirementSummary(claim) {
  const status = requirementStatus(claim);
  if (!status.length) return '';
  const met = status.filter((r) => r.met).length;
  return `${met} of ${status.length} required document${status.length === 1 ? '' : 's'} attached`;
}
