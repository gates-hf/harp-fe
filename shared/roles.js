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
export const ROLES = [
  { id: 'physician', name: 'Dr. Rana Haddad',  title: 'Attending physician', icon: 'stethoscope',
    canBlockPatients: false, canViewVip: true,  canOverrideEligibility: false, canReclassifyEncounter: false,
    canCancelWithCharges: false, canRefund: false, canAdjust: false },
  { id: 'nurse',     name: 'Maya Zgheib',      title: 'Charge nurse',        icon: 'health_and_safety',
    canBlockPatients: false, canViewVip: false, canOverrideEligibility: false, canReclassifyEncounter: true,
    canCancelWithCharges: false, canRefund: false, canAdjust: false },
  { id: 'coder',     name: 'Tarek Solh',       title: 'RCM coder',           icon: 'receipt_long',
    canBlockPatients: true,  canViewVip: false, canOverrideEligibility: true,  canReclassifyEncounter: true,
    canCancelWithCharges: true,  canRefund: true,  canAdjust: true },
  { id: 'pharmacy',  name: 'Nadine Rizk',      title: 'Pharmacist',          icon: 'medication',
    canBlockPatients: false, canViewVip: false, canOverrideEligibility: false, canReclassifyEncounter: false,
    canCancelWithCharges: false, canRefund: false, canAdjust: false },
  { id: 'exec',      name: 'Georges Khoury',   title: 'Chief medical officer', icon: 'analytics',
    canBlockPatients: true,  canViewVip: true,  canOverrideEligibility: true,  canReclassifyEncounter: true,
    canCancelWithCharges: true,  canRefund: true,  canAdjust: true },
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
