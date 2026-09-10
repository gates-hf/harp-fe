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

  // How near the end of its validity an approved pre-authorisation starts
  // asking to be renewed. A week: the payer's own turnaround on a renewal, so a
  // request raised inside it can still be answered before the cover lapses.
  preauthExpiryWarnDays: 7,

  // Financial clearance. Everything here is a policy about what a hospital asks
  // for before it treats somebody, which is why it is config and not code: the
  // engine derives the checklist, and these are the four knobs that say what
  // the checklist expects of each kind of visit.
  clearance: {
    // Whether the patient has to sign for the estimate before the service. A
    // planned stay is quoted and signed for; nobody signs a quotation on the
    // way into an emergency room, and an outpatient visit is settled at the
    // desk on the day.
    acknowledgmentRequired: { OP: false, IP: true, ER: false, DayCase: true },

    // How a signature can be taken. The desk picks from this list rather than
    // typing, so a trail of acknowledgments can be counted.
    ackMethods: ['Signed in person', 'Verbal (documented)', 'E-signature', 'Guardian signed'],

    // What is collected before the service. Deposit takes a share of what the
    // patient is expected to owe; Upfront Settlement takes the whole share and
    // is what the patient-accounts feature turns on; None asks for nothing.
    //
    // An admission settles up front now that there is an account to settle it
    // on: the money is taken before theatre and applied to the charges as they
    // are posted, which is the difference between a deposit and a settlement.
    // A day case still leaves with a bed to pay for, so it stays on a deposit.
    paymentMode: { OP: 'None', IP: 'Upfront Settlement', ER: 'None', DayCase: 'Deposit' },

    // The share of the expected patient responsibility asked for as a deposit.
    // A self-funded admission is asked for all of it and an insured one for
    // half, because half of the insured share is what a payer's adjudication
    // typically moves by.
    depositPct: { selfPayIP: 1.0, insuredIP: 0.5, OP: 0 },

    // How long an item may sit outstanding before the worklist paints it. A
    // day: long enough that a request sent this morning is not nagged about,
    // short enough that nothing waits a weekend unnoticed.
    pendingAgeWarnHours: 24,
  },

  // The patient account. What is here is what crosses a feature boundary: the
  // threshold is read by the accounts list, the account page and the flag that
  // paints an account red, and the reasons are read by the dialogs that write
  // an adjustment or a refund.
  accounts: {
    // What a patient may owe before the account is worth chasing. $500 is about
    // a night on a ward: below it the balance is ordinary, above it somebody
    // rings.
    outstandingThreshold: 500,

    // How long a closed visit may sit unsettled before the account is flagged.
    // Three days: long enough for a payer to answer a line it is holding, short
    // enough that a discharge nobody chased is still this week's work.
    unsettledAfterDays: 3,

    // Why an amount was written off. The desk picks from this list rather than
    // typing, so a month of adjustments can be counted by reason.
    adjustmentReasons: [
      'Contract correction', 'Duplicate posting', 'Write-off — management approval', 'Goodwill', 'Other',
    ],

    // Why money was given back.
    refundReasons: [
      'Over-collected at the desk', 'Service not delivered', 'Payer paid after the patient did',
      'Duplicate payment', 'Other',
    ],
  },
};
