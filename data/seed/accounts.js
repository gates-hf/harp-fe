// Seed — patient accounts. Owner: modules/frontis.
//
// There is nothing to write out: an account is opened by the first transaction,
// so the register is exactly the set of patients the ledger has rows for, and
// each one opens on the date its first row was written. Anything else would be
// an account with no money behind it or money with no account in front of it.
//
// data/store.js does not import this file — data/repositories/accounts.js
// builds on first read of an empty table, off a ledger that seeds itself the
// same way.

import * as ledger from '../repositories/ledger.js';

export function buildAccounts() {
  const byMrn = new Map();
  for (const tx of ledger.all()) {
    if (!tx.patientMrn) continue;
    const found = byMrn.get(tx.patientMrn);
    if (!found) byMrn.set(tx.patientMrn, { openedAt: tx.at, updatedAt: tx.at });
    else if (String(tx.at) > String(found.updatedAt)) found.updatedAt = tx.at;
  }
  return [...byMrn.entries()].map(([mrn, { openedAt, updatedAt }]) => ({
    mrn,
    openedAt,
    status: 'Open',
    // Part B fills these. An empty list is what every seeded account carries,
    // and the list column renders whatever is in it.
    flags: [],
    updatedAt,
  }));
}
