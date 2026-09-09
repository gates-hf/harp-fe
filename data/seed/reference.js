// Reference lists — departments, doctors, wards and bed classes. Owner: shared.
//
// Static shared data rather than a store table: nothing in the demo edits a
// department or hires a doctor, so these are read straight from here the way
// data/engines/rule-attributes.js is read, and no repository wraps them. A
// screen that offers a picker of any of them uses these lists and no local
// copy — an encounter, a referral and a clearance all name the same ward.

/** Where a visit is booked. The order is the order every picker shows. */
export const DEPARTMENTS = [
  'Internal Medicine',
  'Cardiology',
  'General Surgery',
  'Orthopaedics',
  'Paediatrics',
  'Obstetrics & Gynaecology',
  'Emergency',
  'Oncology',
];

/** Attending doctors, two or three to a department. Lebanese names. */
export const DOCTORS = [
  { id: 'DR-0001', name: 'Dr. Nabil Chammas', department: 'Internal Medicine' },
  { id: 'DR-0002', name: 'Dr. Rima Ghanem', department: 'Internal Medicine' },
  { id: 'DR-0003', name: 'Dr. Walid Abou Jaoude', department: 'Internal Medicine' },
  { id: 'DR-0004', name: 'Dr. Ghassan Tabet', department: 'Cardiology' },
  { id: 'DR-0005', name: 'Dr. Maya Sabbagh', department: 'Cardiology' },
  { id: 'DR-0006', name: 'Dr. Elias Rahme', department: 'General Surgery' },
  { id: 'DR-0007', name: 'Dr. Souad Baroudi', department: 'General Surgery' },
  { id: 'DR-0008', name: 'Dr. Karim Zaytouni', department: 'Orthopaedics' },
  { id: 'DR-0009', name: 'Dr. Hala Mansour', department: 'Orthopaedics' },
  { id: 'DR-0010', name: 'Dr. Joseph Attieh', department: 'Paediatrics' },
  { id: 'DR-0011', name: 'Dr. Nisrine Fakhoury', department: 'Paediatrics' },
  { id: 'DR-0012', name: 'Dr. Grace Matta', department: 'Obstetrics & Gynaecology' },
  { id: 'DR-0013', name: 'Dr. Amal Chehab', department: 'Obstetrics & Gynaecology' },
  { id: 'DR-0014', name: 'Dr. Ziad Kfoury', department: 'Emergency' },
  { id: 'DR-0015', name: 'Dr. Rana Ayoub', department: 'Emergency' },
  { id: 'DR-0016', name: 'Dr. Toufic Sleiman', department: 'Oncology' },
  { id: 'DR-0017', name: 'Dr. Lara Nakhle', department: 'Oncology' },
];

/**
 * The specialties a referral is written in, and the department each one lands
 * in here. A referring doctor writes "Gastroenterology"; the hospital books it
 * into Internal Medicine, and that is the mapping `validForEncounter` reads
 * when it asks whether a referral fits the visit being opened.
 */
export const SPECIALTY_DEPARTMENT = {
  'Internal Medicine': 'Internal Medicine',
  Gastroenterology: 'Internal Medicine',
  Neurology: 'Internal Medicine',
  Nephrology: 'Internal Medicine',
  Endocrinology: 'Internal Medicine',
  Cardiology: 'Cardiology',
  'General Surgery': 'General Surgery',
  Urology: 'General Surgery',
  Orthopaedics: 'Orthopaedics',
  Paediatrics: 'Paediatrics',
  'Obstetrics & Gynaecology': 'Obstetrics & Gynaecology',
  'Emergency Medicine': 'Emergency',
  Oncology: 'Oncology',
};

/** The order every specialty picker shows. */
export const SPECIALTIES = Object.keys(SPECIALTY_DEPARTMENT);

/** The department a specialty is seen in, or '' when nothing maps it. */
export const departmentOf = (specialty) => SPECIALTY_DEPARTMENT[specialty] || '';

/** Inpatient wards. The unit a bed sits on, not the bed class it is billed at. */
export const WARDS = [
  'Ward 2A — Medical',
  'Ward 3B — Surgical',
  'Ward 4A — Maternity',
  'Ward 5C — Paediatric',
  'Intensive care unit',
];

/** How a bed is billed. The contract prices the class, not the ward. */
export const BED_CLASSES = ['General', 'Semi-Private', 'Private', 'ICU'];

/** The doctors a department picker narrows to; every doctor with no department. */
export const doctorsIn = (department = '') =>
  DOCTORS.filter((d) => !department || d.department === department);

export const doctor = (id) => DOCTORS.find((d) => d.id === id) || null;

export const doctorName = (id) => doctor(id)?.name || '—';

/** The ward an ICU bed belongs on — the one pairing the two lists share. */
export const ICU_WARD = 'Intensive care unit';
