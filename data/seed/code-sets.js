// Seed — code sets. Owner: modules/claima (amendment 26).
//
// Since amendment 44 the ICD-10 and procedure catalogues are Pactum's standard
// code systems — data/seed/standard-codes.js holds the lists this file used to
// build, entry for entry, under the ICD-10-CM 2026 and Procedures 2026
// versions. The two builders are kept for the import path and read the
// register back through the published lookup, so a caller that still asks
// here gets the same rows the coder's picker does: `atDate` picks the version
// in force on that day, and no date reads the current one.
//
// Like data/seed/claims.js this seed reads a repository, so data/store.js does
// not import it — nothing here is a table of its own.

import { lookupCodes } from '../repositories/standard-codes.js';

const legacy = (row) => ({
  code: row.code,
  desc: row.display,
  sex: row.sex ?? null,
  ageMin: row.ageMin ?? null,
  ageMax: row.ageMax ?? null,
  ...(row.systemType === 'DIAGNOSIS' ? { chapter: row.chapter ?? row.code[0] } : { category: row.category ?? null }),
});

export const buildIcd = (atDate = '') => lookupCodes({ systemType: 'DIAGNOSIS', atDate }).map(legacy);
export const buildProc = (atDate = '') => lookupCodes({ systemType: 'PROCEDURE', atDate }).map(legacy);
