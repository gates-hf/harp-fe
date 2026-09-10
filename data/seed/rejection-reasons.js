// Seed — rejection reasons (amendment 28). Why a payer sends a claim back
// unprocessed, as distinct from a denial: a rejection is about the form of the
// claim, a denial about the care. Each code names the route that fixes it,
// which is what Fix & Resubmit follows — a member-ID problem is corrected on
// the patient's insurance tab, a data problem by re-assembling the claim, a
// coding problem by asking the coder, and the rest by reading the claim.
//
// Static like data/seed/reference.js: no store table, no repository. The list
// is extensible — a code the payer uses that is not here reads as R99.

export const FIX_ROUTES = ['Policy', 'Refresh', 'Recode', 'Contract', 'Review'];

export const REJECTION_REASONS = [
  { code: 'R01', label: 'Member ID invalid', fixRoute: 'Policy',
    fixLabel: 'Correct the policy on the patient’s Insurance tab, then resubmit',
    description: 'The member or policy number is not one the payer recognises for this plan.' },
  { code: 'R02', label: 'Missing or invalid data', fixRoute: 'Refresh',
    fixLabel: 'Re-assemble the claim from the visit and scrub it again',
    description: 'A required field is empty or malformed — a date, a doctor, a charge code, an attachment the contract asks for.' },
  { code: 'R03', label: 'Coding format', fixRoute: 'Recode',
    fixLabel: 'Ask the coder to correct the chart, then re-assemble',
    description: 'A diagnosis or procedure code is not valid for the date of service, or the principal is missing.' },
  { code: 'R04', label: 'Duplicate claim', fixRoute: 'Review',
    fixLabel: 'Read the claim beside the one the payer already holds',
    description: 'The payer already holds a claim for this visit and these services.' },
  { code: 'R05', label: 'Filing limit exceeded', fixRoute: 'Review',
    fixLabel: 'Read the claim — a late filing is appealed, not resubmitted',
    description: 'The claim reached the payer after the filing window in the contract closed.' },
  { code: 'R06', label: 'Provider not recognised', fixRoute: 'Contract',
    fixLabel: 'Check the provider identifiers on the contract in Pactum',
    description: 'The payer does not recognise the provider number or the facility on the claim.' },
  { code: 'R07', label: 'Attachment unreadable', fixRoute: 'Refresh',
    fixLabel: 'Replace the attachment and re-assemble',
    description: 'A document the claim carried could not be opened or did not match the claim.' },
  { code: 'R08', label: 'Plan not covered on date of service', fixRoute: 'Policy',
    fixLabel: 'Check the policy dates on the patient’s Insurance tab',
    description: 'The plan on the claim was not in force on the date of service the payer holds for the member.' },
  { code: 'R99', label: 'Other', fixRoute: 'Review',
    fixLabel: 'Read the payer’s note on the claim',
    description: 'A reason the payer gave in words rather than a code.' },
];

export const rejectionReason = (code) => REJECTION_REASONS.find((r) => r.code === code) || null;
export const rejectionLabel = (code) => rejectionReason(code)?.label || code || '—';
export const fixRouteOf = (code) => rejectionReason(code)?.fixRoute || 'Review';
