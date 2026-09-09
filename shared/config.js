// Platform configuration — the numbers and the wording a screen must not
// hard-code, in one place because more than one screen reads each of them.
//
// Nothing here is edited in the demo. A repository that owns a rule keeps its
// own knobs beside it (prereg.CONFIG, encounters.CONFIG); what lands here is
// what crosses a feature boundary — an estimate's validity is read by the
// repository that stamps it, by the dialog that offers to change it and by the
// document that prints it.

export const CONFIG = {
  // How long an issued cost estimate stays good for. Two weeks: long enough to
  // take home and think about, short enough that a contract change does not
  // outlive it.
  estimateValidityDays: 14,

  // Printed at the foot of every estimate, and frozen into the document when it
  // is issued — so a reissue under different wording never changes what a
  // patient was actually handed.
  estimateDisclaimer:
    'This is an estimate, not a bill. It prices the services listed above under the agreement in force on '
    + 'the date of service and the cover on file at the time it was issued. What is finally billed depends on '
    + 'the care actually given, on the payer’s adjudication of the claim, and on any pre-authorisation still '
    + 'outstanding. The patient share shown is the amount expected at the desk. This estimate is valid until '
    + 'the date shown above and is void after it.',

  // How long an inbound referral stays good for by default. A month: long
  // enough to get an appointment, short enough that the referring doctor's
  // question is still the question being answered.
  referralValidityDays: 30,
};
