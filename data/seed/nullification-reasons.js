// Seed — nullification reasons (amendment 32). Why a claim is withdrawn
// outright rather than fixed and sent again: a nullification is the desk
// saying the claim should never have existed in this shape, where a rejection
// or a denial is the payer saying something about a claim that should. Each
// code says whether a fresh replacement is the usual next step, which is what
// the dialog defaults from.
//
// Static like data/seed/rejection-reasons.js: no store table, no repository.

export const NULLIFICATION_REASONS = [
  { code: 'N01', label: 'Wrong payer', replace: true,
    description: 'The visit was classified on the wrong cover. Re-classify it first; the replacement is assembled against the new payer.' },
  { code: 'N02', label: 'Duplicate', replace: false,
    description: 'Another claim already bills the same services on the same visit — the payer holds it or will.' },
  { code: 'N03', label: 'Wrong encounter', replace: false,
    description: 'The charges belong to a different visit. Return them to the pool and capture them where they belong.' },
  { code: 'N04', label: 'Coding error requiring full rebuild', replace: true,
    description: 'The chart was coded again from the ground up and a refresh would carry the wrong shape forward.' },
  { code: 'N05', label: 'Payer instruction', replace: false,
    description: 'The payer asked for the claim to be withdrawn, or said it will not take it in any form.' },
  { code: 'N06', label: 'Internal test / erroneous assembly', replace: false,
    description: 'The claim was assembled by mistake or for a test and never belonged in the portfolio.' },
  { code: 'N99', label: 'Other', replace: false, textRequired: true,
    description: 'A reason not listed — say it in words.' },
];

export const nullificationReason = (code) => NULLIFICATION_REASONS.find((r) => r.code === code) || null;
export const nullificationLabel = (code) => nullificationReason(code)?.label || code || '—';
export const reasonNeedsText = (code) => Boolean(nullificationReason(code)?.textRequired);

/** The three ways out, in the order the resolver tries them. */
export const PATHS = ['Direct', 'PayerNotified', 'EndChain'];

export const PATH_LABELS = {
  Direct: 'Direct',
  PayerNotified: 'Payer notified',
  EndChain: 'End of chain',
};

/** What happens to the claim's charge lines. */
export const DISPOSITIONS = ['ReturnToUnbilled', 'ReturnAndHold'];

export const DISPOSITION_LABELS = {
  ReturnToUnbilled: 'Return to unbilled',
  ReturnAndHold: 'Return and hold',
};

/** How the payer was told a submitted claim is withdrawn. */
export const NOTIFICATION_METHODS = ['Portal', 'Email', 'Phone', 'Letter'];
