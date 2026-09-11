// Reference list — staff (amendment 37, Defensio F2). Owner: modules/defensio
// registered it; shared the way data/seed/reference.js is. Static: nothing in
// the demo hires anybody, so no repository wraps it and a screen that offers a
// person picker reads this list and no local copy.
//
// The five demo roles keep their role ids, so `currentRole().id` is a staff
// id and the person signed in can be named as an analyst, a decider or a
// reviewer without a second lookup; the coders carry the ids the coding seed
// gave them. The rest never sign in — clerks, a registrar, a pre-authorisation
// coordinator, a supervisor, the director and the HR partner — and exist so
// an accountability case has somebody to name, a decision has somebody higher
// to review its appeal, and a deduction has somebody to be sent to.
//
// `level` is the seniority ladder the role-separation rules read: an appeal
// is reviewed by somebody higher than the person who decided it. 1 staff,
// 2 senior staff, 3 supervisor, 4 executive, 5 director.

export const LEVELS = { 1: 'Staff', 2: 'Senior staff', 3: 'Supervisor', 4: 'Executive', 5: 'Director' };

export const STAFF = [
  { id: 'physician', name: 'Dr. Rana Haddad', title: 'Attending physician', department: 'Internal Medicine', level: 3 },
  { id: 'nurse', name: 'Maya Zgheib', title: 'Charge nurse', department: 'Nursing', level: 2 },
  { id: 'coder', name: 'Tarek Solh', title: 'RCM coder', department: 'Revenue cycle', level: 2 },
  { id: 'pharmacy', name: 'Nadine Rizk', title: 'Pharmacist', department: 'Pharmacy', level: 2 },
  { id: 'exec', name: 'Georges Khoury', title: 'Chief medical officer', department: 'Administration', level: 4 },
  { id: 'CD-0002', name: 'Rita Saba', title: 'Medical coder', department: 'Revenue cycle', level: 1 },
  { id: 'CD-0003', name: 'Hussein Farhat', title: 'Medical coder', department: 'Revenue cycle', level: 1 },
  { id: 'ST-0001', name: 'Rima Nassar', title: 'Billing clerk', department: 'Revenue cycle', level: 1 },
  { id: 'ST-0002', name: 'Hassan Kobeissi', title: 'Collections officer', department: 'Revenue cycle', level: 1 },
  { id: 'ST-0003', name: 'Layal Karam', title: 'Patient access officer', department: 'Front desk', level: 1 },
  { id: 'ST-0004', name: 'Bilal Chahine', title: 'Pre-authorisation coordinator', department: 'Front desk', level: 1 },
  { id: 'ST-0005', name: 'Nour Khalil', title: 'Revenue cycle supervisor', department: 'Revenue cycle', level: 3 },
  { id: 'ST-0006', name: 'Samir Abou Khalil', title: 'Hospital director', department: 'Administration', level: 5 },
  { id: 'ST-0007', name: 'Dima Saad', title: 'HR business partner', department: 'Human resources', level: 3 },
];

export const staff = (id) => STAFF.find((s) => s.id === id) || null;

export const staffName = (id) => staff(id)?.name || (id ? String(id) : '—');

/** The audit trail names people, not ids — this is the way back. */
export const staffByName = (name) => STAFF.find((s) => s.name === name) || null;

export const staffLevel = (id) => staff(id)?.level || 0;

export const levelLabel = (level) => LEVELS[level] || '—';

/** Everybody above a given level, most senior first — who may review a decision made at it. */
export const above = (level) => STAFF.filter((s) => s.level > level).sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
