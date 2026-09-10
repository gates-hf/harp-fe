// Seed — statements of account. Two, so the register opens with one of each
// shape the generator can produce: a detailed statement over a whole account
// in English, and a summary of one admission in Arabic. Both are built by the
// statement engine off the ledger as it stands at seed time and frozen the way
// a generated one is, so a reprint of a seeded statement is the same page a
// reprint of a live one is.
//
// The accounts are found by rule rather than by MRN — the account owing most
// for the detailed one, a discharged admission for the Arabic one — so the two
// exist whatever the ledger seed priced this month. data/store.js does not
// import this file: data/repositories/soa.js builds on first read.

import * as ledger from '../repositories/ledger.js';
import * as encounters from '../repositories/encounters.js';
import * as accounts from '../repositories/accounts.js';
import { buildStatement } from '../engines/statement-engine.js';
import { ROLES } from '../../shared/roles.js';

const CASHIER = ROLES.find((r) => r.id === 'nurse').name;
const FIRST = 89;

export function buildStatements() {
  ledger.all();
  // The account owing most: the statement a desk would actually be sending.
  const busiest = accounts.all().map(accounts.view)
    .sort((a, b) => b.balances.outstanding - a.balances.outstanding || a.mrn.localeCompare(b.mrn))[0]?.mrn;

  const admission = encounters.all()
    .filter((enc) => enc.type === 'IP' && enc.status === 'Discharged' && enc.chargesPosted && enc.patientMrn !== busiest)
    .sort((a, b) => String(b.endAt).localeCompare(String(a.endAt)))[0];

  const intents = [
    busiest && { mrn: busiest, params: { scope: 'Account', detail: 'Detailed', language: 'EN' }, daysAgo: 4 },
    admission && { mrn: admission.patientMrn, params: { scope: 'Encounters', encounterNos: [admission.no], detail: 'Summary', language: 'AR' }, daysAgo: 2 },
  ].filter(Boolean);

  const out = [];
  intents.forEach((intent, i) => {
    const at = new Date();
    at.setDate(at.getDate() - intent.daysAgo);
    at.setHours(11, 20 + i * 7, 0, 0);
    const built = buildStatement(intent.mrn, intent.params, { at: at.toISOString(), by: CASHIER });
    if (built.error) return;
    out.push({ no: `SOA-${at.getFullYear()}-${String(FIRST + i).padStart(6, '0')}`, ...built, reprints: [] });
  });
  return out;
}
