// Mock roles. The demo switches identity from the user menu; modules read
// current() to gate actions and label audit trails.

const KEY = 'harp.demo.role';

// Permissions are flags on the role, read by the screen that gates an action:
// canBlockPatients bars a record from registration, canViewVip reads a
// restricted record unmasked. A role missing a flag never sees a hidden button
// — it sees a disabled one saying which role it needs.
export const ROLES = [
  { id: 'physician', name: 'Dr. Rana Haddad',  title: 'Attending physician', icon: 'stethoscope',
    canBlockPatients: false, canViewVip: true },
  { id: 'nurse',     name: 'Maya Zgheib',      title: 'Charge nurse',        icon: 'health_and_safety',
    canBlockPatients: false, canViewVip: false },
  { id: 'coder',     name: 'Tarek Solh',       title: 'RCM coder',           icon: 'receipt_long',
    canBlockPatients: true,  canViewVip: false },
  { id: 'pharmacy',  name: 'Nadine Rizk',      title: 'Pharmacist',          icon: 'medication',
    canBlockPatients: false, canViewVip: false },
  { id: 'exec',      name: 'Georges Khoury',   title: 'Chief medical officer', icon: 'analytics',
    canBlockPatients: true,  canViewVip: true },
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
