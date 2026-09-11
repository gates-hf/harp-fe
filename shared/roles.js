// Mock roles. The demo switches identity from the user menu; modules read
// current() to gate actions and label audit trails.

const KEY = 'harp.demo.role';

// Permissions are flags on the role, read by the screen that gates an action:
// canBlockPatients bars a record from registration, canViewVip reads a
// restricted record unmasked, canOverrideEligibility records a supervisor's
// answer beside a failed check, canReclassifyEncounter moves who pays after a
// visit has opened, canCancelWithCharges cancels an encounter billing has
// already posted against, canRefund gives money back off a patient account and
// canAdjust writes an amount off it — the last three are financial corrections
// rather than front-desk work, so they sit with the same two roles. A role
// missing a flag never sees a hidden button — it sees a disabled one saying
// which role it needs.
//
// Coding (amendment 26): canCode works a chart in the coding worklist,
// canAssignCoding hands charts to coders and takes them back (a supervisor's
// job), canRecode reopens a coded chart as a new version, and isPhysician
// answers a CDI query — the one flag that opens a screen rather than a button,
// since the physician view of the query worklist is theirs alone.
//
// Claim assembly (amendment 27): canReopenClaim takes a finalized claim back
// to draft and canAcknowledgeScrubWarning signs off a scrub warning with a
// reason — a biller's call, so both sit with the coder and the CMO.
//
// Charge capture (amendment 25): canLateCharge captures a charge after the late
// window has closed and approves one a feed captured there — a financial
// correction, so it sits with the same two roles.
//
// Write-offs (amendment 33): canApproveWO1 / WO2 / WO3 sign a write-off at
// that tier — up to $500, up to $5,000, unlimited (CONFIG.claima.writeoffs).
// The coder signs the small ones; anything larger is management's. A
// requester never signs their own request whatever tier they hold.
//
// Nullification (amendment 32): canNullifyClaim withdraws a claim outright
// and canApproveNullification is the second signature one worth more than
// CONFIG.claima.nullification.secondApproverThreshold needs — from a different
// person, so both flags sit with the coder and the CMO and each can sign for
// the other.
//
// Denials (amendment 31): canResolveDenial closes a denial by hand with a
// reason — recovered outside the system or given up on — where every other
// resolution is derived from a remittance, a hand-off or a write-off. A
// financial call, so it sits with the coder and the CMO.
//
// Daily transaction report (amendment 34): canCloseDay freezes the day's
// report and locks it, canReopenDay unlocks a closed day with a reason (the
// CMO alone — a reopened report is a version somebody has to answer for),
// canDocumentException records why a RED check is being closed over rather
// than fixed, and canCountersign is the second signature a cash session
// needs when its variance passes the threshold — from somebody other than the
// cashier, so the coder and the CMO can each sign for the other's drawer.
// Appeals (amendment 38): canReviewAppeal signs off an appeal case at the
// standard tier (approve or return it to the preparer), canApproveSeniorAppeal
// at the senior tier a disputed amount past CONFIG.defensio.appeals
// .seniorReviewAbove needs (the CMO alone), and canOverrideAppealDeadline
// files an appeal after the payer's window has closed, with a reason and a
// flag on the submission. A preparer never reviews their own case whatever
// tier they hold.
export const ROLES = [
  { id: 'physician', name: 'Dr. Rana Haddad',  title: 'Attending physician', icon: 'stethoscope',
    canBlockPatients: false, canViewVip: true,  canOverrideEligibility: false, canReclassifyEncounter: false,
    canCancelWithCharges: false, canRefund: false, canAdjust: false,
    canLateCharge: false,
    canCode: false, canAssignCoding: false, canRecode: false, isPhysician: true,
    canReopenClaim: false, canAcknowledgeScrubWarning: false,
    canApproveWO1: false, canApproveWO2: false, canApproveWO3: false,
    canNullifyClaim: false, canApproveNullification: false,
    canResolveDenial: false,
    canCloseDay: false, canReopenDay: false, canDocumentException: false, canCountersign: false,
    canReviewAppeal: false, canApproveSeniorAppeal: false, canOverrideAppealDeadline: false },
  { id: 'nurse',     name: 'Maya Zgheib',      title: 'Charge nurse',        icon: 'health_and_safety',
    canBlockPatients: false, canViewVip: false, canOverrideEligibility: false, canReclassifyEncounter: true,
    canCancelWithCharges: false, canRefund: false, canAdjust: false,
    canLateCharge: false,
    canCode: false, canAssignCoding: false, canRecode: false, isPhysician: false,
    canReopenClaim: false, canAcknowledgeScrubWarning: false,
    canApproveWO1: false, canApproveWO2: false, canApproveWO3: false,
    canNullifyClaim: false, canApproveNullification: false,
    canResolveDenial: false,
    canCloseDay: false, canReopenDay: false, canDocumentException: false, canCountersign: false,
    canReviewAppeal: false, canApproveSeniorAppeal: false, canOverrideAppealDeadline: false },
  { id: 'coder',     name: 'Tarek Solh',       title: 'RCM coder',           icon: 'receipt_long',
    canBlockPatients: true,  canViewVip: false, canOverrideEligibility: true,  canReclassifyEncounter: true,
    canCancelWithCharges: true,  canRefund: true,  canAdjust: true,
    canLateCharge: true,
    canCode: true,  canAssignCoding: false, canRecode: true,  isPhysician: false,
    canReopenClaim: true, canAcknowledgeScrubWarning: true,
    canApproveWO1: true,  canApproveWO2: false, canApproveWO3: false,
    canNullifyClaim: true,  canApproveNullification: true,
    canResolveDenial: true,
    canCloseDay: true,  canReopenDay: false, canDocumentException: true,  canCountersign: true,
    canReviewAppeal: true,  canApproveSeniorAppeal: false, canOverrideAppealDeadline: false },
  { id: 'pharmacy',  name: 'Nadine Rizk',      title: 'Pharmacist',          icon: 'medication',
    canBlockPatients: false, canViewVip: false, canOverrideEligibility: false, canReclassifyEncounter: false,
    canCancelWithCharges: false, canRefund: false, canAdjust: false,
    canLateCharge: false,
    canCode: false, canAssignCoding: false, canRecode: false, isPhysician: false,
    canReopenClaim: false, canAcknowledgeScrubWarning: false,
    canApproveWO1: false, canApproveWO2: false, canApproveWO3: false,
    canNullifyClaim: false, canApproveNullification: false,
    canResolveDenial: false,
    canCloseDay: false, canReopenDay: false, canDocumentException: false, canCountersign: false,
    canReviewAppeal: false, canApproveSeniorAppeal: false, canOverrideAppealDeadline: false },
  { id: 'exec',      name: 'Georges Khoury',   title: 'Chief medical officer', icon: 'analytics',
    canBlockPatients: true,  canViewVip: true,  canOverrideEligibility: true,  canReclassifyEncounter: true,
    canCancelWithCharges: true,  canRefund: true,  canAdjust: true,
    canLateCharge: true,
    canCode: true,  canAssignCoding: true,  canRecode: true,  isPhysician: false,
    canReopenClaim: true, canAcknowledgeScrubWarning: true,
    canApproveWO1: true,  canApproveWO2: true,  canApproveWO3: true,
    canNullifyClaim: true,  canApproveNullification: true,
    canResolveDenial: true,
    canCloseDay: true,  canReopenDay: true,  canDocumentException: true,  canCountersign: true,
    canReviewAppeal: true,  canApproveSeniorAppeal: true,  canOverrideAppealDeadline: true },
];

const subscribers = new Set();
let activeId = read();

function read() {
  try {
    const saved = sessionStorage.getItem(KEY);
    if (saved && ROLES.some((r) => r.id === saved)) return saved;
  } catch {
    /* private mode */
  }
  return ROLES[0].id;
}

export function current() {
  return ROLES.find((r) => r.id === activeId) || ROLES[0];
}

export function setRole(id) {
  if (!ROLES.some((r) => r.id === id) || id === activeId) return current();
  activeId = id;
  try {
    sessionStorage.setItem(KEY, id);
  } catch {
    /* private mode */
  }
  for (const fn of subscribers) fn(current());
  return current();
}

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
