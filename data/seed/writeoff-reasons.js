// Seed — the write-off reasons. Static like reference.js: a catalogue rather
// than a table, so there is no repository and no store entry. Each reason
// carries the classification a write-off inherits from it — Contractual is
// money the hospital was never going to see under the agreement, Discretionary
// is money it chose to let go — and the analytics screen's primary split reads
// that field off the reason and nowhere else.

export const WRITEOFF_REASONS = [
  { code: 'W01', label: 'Contractual adjustment', classification: 'Contractual',
    hint: 'What the agreement allowed was less than what was billed — the difference was never collectable.' },
  { code: 'W02', label: 'Timely filing', classification: 'Discretionary',
    hint: 'The claim missed the payer’s filing window and cannot be resubmitted.' },
  { code: 'W03', label: 'Small balance', classification: 'Contractual',
    hint: 'A remainder too small to be worth a statement, a call or a stamp.' },
  { code: 'W04', label: 'Charity / hardship', classification: 'Discretionary',
    hint: 'The patient cannot pay and the hospital has decided not to pursue it. Needs evidence on file.' },
  { code: 'W05', label: 'Bad debt', classification: 'Discretionary',
    hint: 'Pursued and not recovered — the balance is being written off after collection failed.' },
  { code: 'W06', label: 'Administrative error', classification: 'Discretionary',
    hint: 'A posting, a registration or a coding mistake the hospital owns; the amount is the cost of it.' },
  { code: 'W07', label: 'Payer non-response', classification: 'Discretionary',
    hint: 'Followed up past the escalation threshold with no answer; the claim is being closed out.' },
  { code: 'W99', label: 'Other', classification: 'Discretionary',
    hint: 'Say why in the justification — nothing above fits.' },
];

export const CLASSIFICATIONS = ['Contractual', 'Discretionary'];

export const reason = (code) => WRITEOFF_REASONS.find((r) => r.code === code) || null;

export const reasonLabel = (code) => reason(code)?.label || code || '—';

/** The classification a reason carries; an unknown code reads as Discretionary, the answer that asks for a signature. */
export const classificationOf = (code) => reason(code)?.classification || 'Discretionary';

/** The reasons a hardship write-off must carry evidence for. */
export const EVIDENCE_REASONS = ['W04'];
