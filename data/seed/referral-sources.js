// Seed — referral sources. Owner: modules/frontis.
//
// The facilities that send patients here and the doctors who sign the letters.
// It is a growing list rather than a fixed one: a clerk who types a name the
// register has never seen creates it, and the referral form is the only place
// that happens — which is why this is a store table with a repository over it,
// and not static reference data the way data/seed/reference.js is.
//
// `usageCount` is what orders the combobox: the clinic that sends four patients
// a week is the one the desk wants first.

/** Facilities: clinics, dispensaries and hospitals across Lebanon. */
const FACILITIES = [
  ['RS-0001', 'Clinique du Levant', 'Hazmieh, Beirut', '+961 5 456 100', 9],
  ['RS-0002', 'Centre Médical Al-Mina', 'Mina, Tripoli', '+961 6 601 220', 6],
  ['RS-0003', 'Saida Family Polyclinic', 'Riad Solh street, Saida', '+961 7 720 415', 5],
  ['RS-0004', 'Bekaa Dispensary — Zahle', 'Boulevard Zahle', '+961 8 802 337', 3],
  ['RS-0005', 'Mount Lebanon Medical Centre', 'Broummana', '+961 4 960 780', 4],
  ['RS-0006', 'Nabatieh Community Clinic', 'Nabatieh el-Tahta', '+961 7 763 902', 2],
];

/**
 * External doctors, each attached to the facility they refer from. Specialty is
 * what `validForEncounter` maps onto a department, so it is written in the
 * hospital's own words.
 */
const DOCTORS = [
  ['RS-0007', 'Dr. Samir Khalifeh', 'RS-0001', 'Cardiology', '+961 3 118 224', 7],
  ['RS-0008', 'Dr. Hoda Zein', 'RS-0001', 'Internal Medicine', '+961 3 447 016', 4],
  ['RS-0009', 'Dr. Fadi Chaaban', 'RS-0002', 'General Surgery', '+961 70 220 118', 5],
  ['RS-0010', 'Dr. Mona Awada', 'RS-0002', 'Obstetrics & Gynaecology', '+961 70 553 447', 3],
  ['RS-0011', 'Dr. Bassam Itani', 'RS-0003', 'Orthopaedics', '+961 71 340 902', 4],
  ['RS-0012', 'Dr. Salma Daher', 'RS-0004', 'Paediatrics', '+961 76 118 553', 2],
  ['RS-0013', 'Dr. Antoine Karam', 'RS-0005', 'Oncology', '+961 3 902 771', 3],
  ['RS-0014', 'Dr. Randa Sleiman', 'RS-0006', 'Internal Medicine', '+961 76 445 210', 1],
];

export const referralSources = [
  ...FACILITIES.map(([id, name, address, phone, usageCount]) => ({
    id,
    kind: 'Facility',
    name,
    facilityId: null,
    specialty: null,
    address,
    phone,
    usageCount,
    createdAt: '2026-01-05T09:00:00.000Z',
  })),
  ...DOCTORS.map(([id, name, facilityId, specialty, phone, usageCount]) => ({
    id,
    kind: 'Doctor',
    name,
    facilityId,
    specialty,
    address: '',
    phone,
    usageCount,
    createdAt: '2026-01-05T09:00:00.000Z',
  })),
];
