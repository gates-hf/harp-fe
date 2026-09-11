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
    // Keyed on the encounter type, which is the only key anything reads it by.
    paymentMode: { OP: 'None', IP: 'Upfront Settlement', ER: 'None' },

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
    // enough that a discharge nobody chased is still this week's work. And the
    // residual worth flagging at all: below $25 it is a small balance to write
    // off, not a collection to chase.
    unsettledAfterDays: 3,
    unsettledResidualFloor: 25,

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

  // Claims. Three keys the module bootstraps with (amendment 24); each Claima
  // feature appends its own under this object and edits nobody else's.
  claima: {
    // How long after the date of service a claim may still be filed. A month
    // is the tightest filing window a Lebanese payer writes into a contract.
    submissionDeadlineDays: 30,

    // The checks a claim is run through before it can be Ready. Empty until
    // the scrubber feature fills it: a rule is { code, label, check }.
    scrubberRules: [],

    // How long a submitted claim may wait for the payer's acknowledgment
    // before the worklist chases it — and before a seeded claim reads as
    // Acknowledged rather than Submitted.
    ackSlaDays: 3,

    // --- A25: charge capture ---
    // A charge that arrives after the visit closed, or after its charges were
    // released to a claim, is late. Inside the window it is flagged and goes
    // through; outside it, it waits for a role with late-charge rights and a
    // reason. A week: the payer's own filing clock leaves room for that much.
    // The triggers say when each feed captures a line: a pharmacy order is
    // charged when it is placed, a lab or a scan when the result is filed, a
    // procedure when it is logged, and a bed at the midnight census.
    capture: {
      lateWindowDays: 7,
      triggers: {
        Lab: 'OnCompletion', Radiology: 'OnCompletion', Pharmacy: 'OnOrder',
        Procedure: 'OnCompletion', 'Room & Board': 'Midnight',
      },
    },

    // --- A26: encounter coding ---
    // Coding is worked from the day the visit's charges are released, and how
    // long a chart may wait is a policy per kind of visit: an outpatient chart
    // is coded inside three working days, an admission inside five.
    coding: {
      slaDays: { OP: 3, IP: 5, ER: 3 },
      // The charge-master categories a coded procedure has to account for.
      // Every released line in one of these must be linked to a procedure
      // before a chart is marked coded; a consultation or a night on the ward
      // is billed without a procedure code and is never asked for one.
      linkedCategories: ['Procedure', 'Surgery', 'Radiology'],
      // The age bands the backlog is reported in, as the upper bound of each
      // band in days; the last band is open-ended.
      ageBands: [1, 3, 7],
    },

    // --- A30: claim lifecycle ---
    // When a submitted claim has gone quiet. A payer that has said nothing for
    // a month is chased; one silent for two is escalated. Both are computed on
    // every read from the last thing the payer did, never stored, so a
    // remittance or an acknowledgment clears them by arriving. A payer id under
    // byPayer overrides the default for that payer alone. The board draws one
    // column per status in boardColumns; hiddenColumns is what the reader has
    // folded away, kept per session.
    lifecycle: {
      silentDays: { default: 30, byPayer: {} },
      escalationDays: { default: 60, byPayer: {} },
      boardColumns: [
        'Draft', 'Ready', 'Submitted', 'Acknowledged', 'Rejected', 'Paid', 'Partially Paid', 'Denied',
        'Appealed', 'Closed',
      ],
      hiddenColumns: [],
    },

    // --- A28: claim submission ---
    // How each payer takes its claims. Mode says what a batch generates — an
    // electronic file and its manifest, or printed forms with cover sheets —
    // and the cycle says when the desk is expected to send: every working day,
    // one weekday, or one day of the month. The profile is what the ready
    // queue reads to say a payer is due today, and the methods are what the
    // Mark submitted form offers. A payer not named here submits on the
    // default profile.
    submission: {
      methods: {
        Electronic: ['Portal upload', 'SFTP', 'API'],
        Manual: ['Courier', 'Hand delivery', 'Email'],
      },
      defaultProfile: { mode: 'Manual', cycle: { kind: 'Weekly', day: 'Monday' }, methods: ['Courier', 'Email'] },
      profiles: {
        'PY-0001': { mode: 'Electronic', cycle: { kind: 'Daily' }, methods: ['Portal upload', 'API'] },
        'PY-0002': { mode: 'Manual', cycle: { kind: 'Monthly', day: 5 }, methods: ['Courier', 'Hand delivery'] },
        'PY-0003': { mode: 'Manual', cycle: { kind: 'Monthly', day: 1 }, methods: ['Hand delivery'] },
        'PY-0004': { mode: 'Manual', cycle: { kind: 'Monthly', day: 1 }, methods: ['Hand delivery', 'Courier'] },
        'PY-0005': { mode: 'Manual', cycle: { kind: 'Monthly', day: 1 }, methods: ['Hand delivery'] },
        'PY-0006': { mode: 'Manual', cycle: { kind: 'Monthly', day: 10 }, methods: ['Courier', 'Hand delivery'] },
        'PY-0007': { mode: 'Electronic', cycle: { kind: 'Weekly', day: 'Thursday' }, methods: ['Portal upload', 'SFTP'] },
        'PY-0008': { mode: 'Manual', cycle: { kind: 'Weekly', day: 'Tuesday' }, methods: ['Courier', 'Email'] },
        'PY-0009': { mode: 'Electronic', cycle: { kind: 'Weekly', day: 'Wednesday' }, methods: ['Portal upload'] },
        'PY-0010': { mode: 'Electronic', cycle: { kind: 'Daily' }, methods: ['API', 'Portal upload'] },
        'PY-0011': { mode: 'Manual', cycle: { kind: 'Weekly', day: 'Monday' }, methods: ['Courier'] },
        'PY-0012': { mode: 'Manual', cycle: { kind: 'Weekly', day: 'Friday' }, methods: ['Courier', 'Email'] },
        'PY-0014': { mode: 'Electronic', cycle: { kind: 'Weekly', day: 'Monday' }, methods: ['Portal upload'] },
        'PY-0015': { mode: 'Manual', cycle: { kind: 'Weekly', day: 'Wednesday' }, methods: ['Courier'] },
        'PY-0016': { mode: 'Manual', cycle: { kind: 'Weekly', day: 'Tuesday' }, methods: ['Courier', 'Hand delivery'] },
        'PY-0017': { mode: 'Electronic', cycle: { kind: 'Weekly', day: 'Thursday' }, methods: ['SFTP'] },
        'PY-0019': { mode: 'Manual', cycle: { kind: 'Weekly', day: 'Monday' }, methods: ['Courier'] },
        'PY-0020': { mode: 'Electronic', cycle: { kind: 'Daily' }, methods: ['API'] },
        'PY-0021': { mode: 'Manual', cycle: { kind: 'Weekly', day: 'Friday' }, methods: ['Email', 'Courier'] },
        'PY-0022': { mode: 'Electronic', cycle: { kind: 'Daily' }, methods: ['API', 'SFTP'] },
        'PY-0023': { mode: 'Electronic', cycle: { kind: 'Daily' }, methods: ['API', 'Portal upload'] },
        'PY-0025': { mode: 'Electronic', cycle: { kind: 'Weekly', day: 'Wednesday' }, methods: ['Portal upload', 'SFTP'] },
        'PY-0026': { mode: 'Electronic', cycle: { kind: 'Weekly', day: 'Friday' }, methods: ['SFTP', 'Portal upload'] },
      },
    },
    // --- A29: ERA processing & payment posting ---
    // A remittance is posted line by line against what the contract said the
    // payer owed. `tolerance` is how far under that a payer may pay before the
    // shortfall is handed to Defensio: within the floor amount, or within the
    // share of the expected line, whichever is the kinder reading — a payer
    // with no entry reads `toleranceDefault`. `adjCodes` are the reason codes a
    // payer writes beside an adjustment: CO-* is contractual (the payer says it
    // owes less), PR-* moves the amount to the patient, OA-* is another payer's.
    // Money left on a remittance that no claim accounts for waits as unapplied
    // cash and turns red after `unappliedAgeWarnDays`.
    posting: {
      unappliedAgeWarnDays: 30,
      toleranceDefault: { pct: 0.05, amount: 25 },
      tolerance: {
        'PY-0001': { pct: 0.03, amount: 15 },
        'PY-0008': { pct: 0.05, amount: 50 },
      },
      adjCodes: [
        { code: 'CO-45', label: 'Charge exceeds fee schedule', group: 'CO' },
        { code: 'CO-97', label: 'Bundled into another service', group: 'CO' },
        { code: 'CO-59', label: 'Multiple procedure reduction', group: 'CO' },
        { code: 'PR-1', label: 'Deductible', group: 'PR' },
        { code: 'PR-2', label: 'Coinsurance', group: 'PR' },
        { code: 'PR-3', label: 'Co-payment', group: 'PR' },
        { code: 'OA-23', label: 'Prior payer adjudication', group: 'OA' },
      ],
    },
    // --- A33: write-off management ---
    // Who may sign a write-off is a question of how much it is for. Each tier
    // is the ceiling it covers (null is unlimited) and the role flag that
    // signs at that level; `tierFor(amount)` in data/engines/writeoff-tiers.js
    // picks the first tier whose ceiling the amount is under. In Single mode
    // one signature at the required tier is enough; in Sequential mode every
    // tier up to it signs in turn. A request may choose its mode; this is the
    // default. `autoPostOnApproval` posts the moment the last signature lands
    // rather than waiting for somebody to press Post.
    writeoffs: {
      tiers: [
        { tier: 1, max: 500, role: 'canApproveWO1' },
        { tier: 2, max: 5000, role: 'canApproveWO2' },
        { tier: 3, max: null, role: 'canApproveWO3' },
      ],
      mode: 'Single',
      autoPostOnApproval: false,
    },
    // --- A32: claim nullification ---
    // Withdrawing a claim is a financial correction: one role raises it and,
    // above the threshold, a second person signs. The amendment names $2,000;
    // the largest claim in the dataset bills $1,161 to its payer, so at that
    // figure the two-approver gate could never be reached in the demo — at
    // $1,000 it catches the few claims worth that much. `roles` names the
    // flags on shared/roles.js the dialog reads.
    nullification: {
      secondApproverThreshold: 1000,
      roles: { request: 'canNullifyClaim', approve: 'canApproveNullification' },
    },
    // --- A31: denial triage & routing ---
    // How long a payer gives the desk to appeal a denial, counted from the
    // day the denial lands. A month is the default; a payer id under byPayer
    // overrides it for that payer alone. The deadline is computed on every
    // read and never stored; inside `deadlineWarnDays` of it the worklist
    // paints the countdown amber, past it a denial nobody has routed reads
    // Deadline Passed with its money still open — nothing is written off by
    // a date.
    denials: {
      appealWindowDays: { default: 30, byPayer: { 'PY-0001': 45, 'PY-0002': 60, 'PY-0025': 21 } },
      deadlineWarnDays: 7,
    },
    // --- A34: daily transaction report ---
    // A cash session is closed against what the desk counted, and a variance
    // past the threshold needs a second person's signature — $50 is a note a
    // drawer can be out by honestly; more than that is somebody's answer to
    // give. `roles` names the flags on shared/roles.js the screens read: who
    // closes the day, who reopens a closed one, who documents a RED check
    // rather than fixing it, and who countersigns a session variance.
    dtr: {
      sessionVarianceCountersignThreshold: 50,
      roles: {
        canCloseDay: 'canCloseDay',
        canReopenDay: 'canReopenDay',
        canDocumentException: 'canDocumentException',
        canCountersign: 'canCountersign',
      },
    },
  },
  // --- Defensio (denial management) — each session adds its keys under here ---
  defensio: {
    // --- A38: appeal preparation & submission ---
    // A review needs a senior signature (canApproveSeniorAppeal) once the
    // disputed amount reaches seniorReviewAbove; the amendment's $5,000 is
    // unreachable on this dataset (the largest denial on file is $614), so
    // the threshold sits where the ministry appeal crosses it and the rest
    // do not. Filing is late past the denial's own deadline (the payer's
    // appeal window, CONFIG.claima.denials) and needs canOverrideAppealDeadline
    // plus a reason; inside deadlineWarnDays the workbench paints the row.
    // A level-2 appeal is filed level2WindowDays from the level-1 decision.
    appeals: {
      seniorReviewAbove: 200,
      deadlineWarnDays: 7,
      level2WindowDays: 30,
      methods: ['Portal', 'Email', 'Fax', 'Courier', 'Hand delivery'],
      hospital: { name: 'Harp Medical Centre', line: 'Rue de Damas, Beirut · +961 1 200 400', signatory: 'Revenue Cycle — Denial Management' },
    },
    // --- A39: appeal tracking & resolution ---
    // Two clocks a case carries and the screens never confuse: the
    // filingDeadline is the denial's own (the payer's appeal window, above),
    // the responseDeadline is how long the payer has to answer a submitted
    // appeal — responseWindowDays from the submission, read off the Pactum
    // payer record's `responseWindowDays` first, then byPayer here, then the
    // default. A conceded amount nobody has paid `recoveryAgingDays` after the
    // decision is flagged as aging; `disposition.acceptRole` names the flag on
    // shared/roles.js that may accept a lost share with a reason.
    appealTracking: {
      responseWindowDays: { default: 30, byPayer: { 'PY-0002': 45 } },
      responseWarnDays: 5,
      recoveryAgingDays: 45,
      disposition: { acceptRole: 'canResolveDenial' },
    },
    // --- A37: root cause & accountability ---
    // A root-cause case is opened by a trigger — a denial worth the amount
    // threshold, the same cause repeating inside the window, an appeal lost —
    // or by hand, and is due `targetDays` after it opens. An accountability
    // case gives the person named the response window before anything is
    // decided about them; `accountabilityRoles` are the role ids that read
    // the register with names on it — everyone else sees "Individual — case N".
    rca: {
      targetDays: 14,
      triggers: { amountThreshold: 500, repeat: { count: 3, windowDays: 90 } },
      responseWindowDays: 7,
      accountabilityRoles: ['coder', 'exec'],
    },
  },
};
