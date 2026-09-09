// Seed — patients. Owner: modules/frontis (Patient Access & Eligibility).
// Realistic Lebanese context: names in English and Arabic, civil IDs for
// nationals, passports for foreign nationals, +961 numbers, cities, 2026 dates.
//
// Ten rows are hand-written because the demo needs them exactly so: a VIP, a
// deceased record, a blocked one, a merged pair, and two near-duplicate pairs
// the worklist already holds. The rest are combined from short lists with a
// fixed-seed PRNG, so every tab loads the same sixty patients.

const HAND_WRITTEN = [
  // The first near-duplicate pair: same date of birth, one letter apart.
  ['MRN-000101', 'Rami Haddad', 'رامي حداد', '1978-04-12', 'Male', 'Lebanese', '61784120', null, '+961 3 214 587', 'rami.haddad@gmail.com', 'Achrafieh, Beirut', 'Beirut'],
  ['MRN-000102', 'Ramy Haddad', 'رامي حدّاد', '1978-04-12', 'Male', 'Lebanese', '61784121', null, '+961 3 907 441', '', 'Sassine, Beirut', 'Beirut'],
  // The second: a family name spelled two ways, and one phone between them.
  ['MRN-000103', 'Nour Baalbaki', 'نور بعلبكي', '2001-07-08', 'Female', 'Lebanese', '20017081', null, '+961 76 118 240', 'nour.b@hotmail.com', 'Mina, Tripoli', 'Tripoli'],
  ['MRN-000104', 'Nour Balbaki', 'نور بلبكي', '2001-07-08', 'Female', 'Lebanese', '20017082', null, '+961 76 118 240', '', 'Abou Samra, Tripoli', 'Tripoli'],
  // The VIP, the deceased record and the blocked one.
  ['MRN-000105', 'Layla Chamseddine', 'ليلى شمس الدين', '1991-11-30', 'Female', 'Lebanese', '91113301', null, '+961 71 902 334', 'l.chamseddine@me.com', 'Verdun, Beirut', 'Beirut'],
  ['MRN-000106', 'Charbel Sfeir', 'شربل صفير', '1946-12-01', 'Male', 'Lebanese', '46120101', null, '+961 9 934 512', '', 'Jbeil old souk', 'Byblos'],
  ['MRN-000107', 'Hussein Zeaiter', 'حسين زعيتر', '1962-06-24', 'Male', 'Lebanese', '62062401', null, '+961 3 611 470', '', 'Douris, Baalbek', 'Baalbek'],
  // The merged pair: 109 was registered twice and folded into 108.
  ['MRN-000108', 'Carla Gemayel', 'كارلا الجميل', '1988-10-14', 'Female', 'Lebanese', '88101401', null, '+961 71 208 996', 'carla.gemayel@gmail.com', 'Bikfaya main road', 'Bikfaya'],
  ['MRN-000109', 'Karla Gemayel', 'كارلا جميل', '1988-10-14', 'Female', 'Lebanese', null, 'LB7742019', '+961 71 208 996', '', 'Bikfaya main road', 'Bikfaya'],
  // A foreign national: a passport instead of a civil ID.
  ['MRN-000110', 'Ahmad Al-Sayed', 'أحمد السيد', '1983-02-17', 'Male', 'Syrian', null, 'N009184773', '+961 76 553 018', '', 'Bourj Hammoud', 'Beirut'],
];

const FIRST_NAMES = [
  ['Ziad', 'زياد', 'Male'], ['Rana', 'رنا', 'Female'], ['Marwan', 'مروان', 'Male'],
  ['Zeina', 'زينة', 'Female'], ['Bilal', 'بلال', 'Male'], ['Nadine', 'نادين', 'Female'],
  ['Elie', 'إيلي', 'Male'], ['Farah', 'فرح', 'Female'], ['Khaled', 'خالد', 'Male'],
  ['Rita', 'ريتا', 'Female'], ['Hadi', 'هادي', 'Male'], ['Mona', 'منى', 'Female'],
  ['Tarek', 'طارق', 'Male'], ['Yara', 'يارا', 'Female'], ['Antoine', 'أنطوان', 'Male'],
  ['Reem', 'ريم', 'Female'], ['Fadi', 'فادي', 'Male'], ['Dana', 'دانا', 'Female'],
  ['Samir', 'سمير', 'Male'], ['Joelle', 'جويل', 'Female'], ['Omar', 'عمر', 'Male'],
  ['Lina', 'لينا', 'Female'], ['Wissam', 'وسام', 'Male'], ['Nayla', 'نايلة', 'Female'],
  ['Jad', 'جاد', 'Male'],
];

const FAMILY_NAMES = [
  ['Maalouf', 'معلوف'], ['Fadlallah', 'فضل الله'], ['Talhouk', 'طلحوق'], ['Douaihy', 'الدويهي'],
  ['Karami', 'كرامي'], ['Rizk', 'رزق'], ['Chidiac', 'شدياق'], ['Hamade', 'حمادة'],
  ['Sinno', 'سنو'], ['Nassar', 'نصار'], ['Moussawi', 'الموسوي'], ['Kassab', 'قصاب'],
  ['Solh', 'الصلح'], ['Abou Chacra', 'أبو شقرا'], ['Saade', 'سعادة'], ['Harb', 'حرب'],
  ['Aoun', 'عون'], ['Mikati', 'ميقاتي'], ['Frangieh', 'فرنجية'], ['Karam', 'كرم'],
  ['Daouk', 'الداعوق'], ['Kanaan', 'كنعان'],
];

const CITIES = ['Beirut', 'Tripoli', 'Sidon', 'Tyre', 'Zahle', 'Jounieh', 'Baalbek', 'Nabatieh',
  'Byblos', 'Aley', 'Zgharta', 'Batroun', 'Baabda', 'Halba', 'Bikfaya'];

const STREETS = ['Hamra street', 'Mar Mikhael', 'Furn el Chebbak', 'Ain el Remmaneh', 'Corniche el Mazraa',
  'Old souk', 'Main road', 'Church street', 'Sea road', 'Municipality square'];

// Foreign nationals carry a passport and no civil ID.
const FOREIGN = ['Syrian', 'Iraqi', 'Egyptian', 'Palestinian', 'Jordanian', 'French', 'Canadian', 'Armenian'];

const LINES = ['3', '70', '71', '76', '1', '6', '9'];

/** Fixed-seed PRNG — the same sixty patients in every tab. */
function mulberry32(seed) {
  return function random() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function row(fields, extra = {}) {
  const [mrn, nameEn, nameAr, dob, gender, nationality, civilId, passportNo, phone, email, address, city] = fields;
  return {
    mrn,
    nameEn,
    nameAr,
    dob,
    gender,
    nationality,
    civilId,
    passportNo,
    phone,
    email,
    address,
    city,
    photo: null,
    status: 'Active',
    deceasedAt: null,
    blockReason: '',
    mergedInto: null,
    vip: false,
    lastVisitAt: '2026-08-28',
    createdAt: '2026-01-12T08:20:00.000Z',
    updatedAt: '2026-08-28T10:05:00.000Z',
    documents: [],
    ...extra,
  };
}

function generated() {
  const random = mulberry32(20260908);
  const rows = [];

  for (let i = 0; i < 50; i++) {
    const [firstEn, firstAr, gender] = FIRST_NAMES[i % FIRST_NAMES.length];
    const [familyEn, familyAr] = FAMILY_NAMES[i % FAMILY_NAMES.length];
    const foreign = i % 9 === 4;
    const year = 1940 + Math.floor(random() * 78);
    const month = String(1 + Math.floor(random() * 12)).padStart(2, '0');
    const day = String(1 + Math.floor(random() * 28)).padStart(2, '0');
    const phone = `+961 ${LINES[Math.floor(random() * LINES.length)]} ${100 + Math.floor(random() * 900)} ${100 + Math.floor(random() * 900)}`;
    const city = CITIES[i % CITIES.length];
    const month2 = 1 + (i % 8);

    rows.push(row([
      `MRN-000${111 + i}`,
      `${firstEn} ${familyEn}`,
      `${firstAr} ${familyAr}`,
      `${year}-${month}-${day}`,
      gender,
      foreign ? FOREIGN[i % FOREIGN.length] : 'Lebanese',
      foreign ? null : `${String(year).slice(2)}${month}${day}${i % 10}${(i * 3) % 10}`,
      foreign ? `P${1000000 + i * 7919}` : null,
      phone,
      i % 3 === 0 ? `${firstEn.toLowerCase()}.${familyEn.split(' ')[0].toLowerCase()}@gmail.com` : '',
      `${STREETS[i % STREETS.length]}, ${city}`,
      city,
    ], {
      lastVisitAt: i % 7 === 3 ? null : `2026-0${month2}-${String(2 + (i % 26)).padStart(2, '0')}`,
      createdAt: `2026-0${month2}-${String(1 + (i % 27)).padStart(2, '0')}T09:${String(10 + (i % 45)).padStart(2, '0')}:00.000Z`,
      updatedAt: `2026-0${month2}-${String(2 + (i % 26)).padStart(2, '0')}T11:${String(10 + (i % 45)).padStart(2, '0')}:00.000Z`,
    }));
  }
  return rows;
}

export const patients = [
  row(HAND_WRITTEN[0], { lastVisitAt: '2026-09-02' }),
  row(HAND_WRITTEN[1], { lastVisitAt: '2026-07-19' }),
  row(HAND_WRITTEN[2], { lastVisitAt: '2026-08-31' }),
  row(HAND_WRITTEN[3], { lastVisitAt: null }),
  row(HAND_WRITTEN[4], { vip: true, lastVisitAt: '2026-09-04' }),
  row(HAND_WRITTEN[5], { status: 'Deceased', deceasedAt: '2026-07-22', lastVisitAt: '2026-07-21' }),
  row(HAND_WRITTEN[6], {
    status: 'Blocked',
    blockReason: 'Unsettled balance from the August admission — registration to refer to the finance office.',
    lastVisitAt: '2026-08-18',
  }),
  row(HAND_WRITTEN[7], { lastVisitAt: '2026-09-01' }),
  row(HAND_WRITTEN[8], { status: 'Merged', mergedInto: 'MRN-000108', lastVisitAt: '2026-05-14' }),
  row(HAND_WRITTEN[9], { lastVisitAt: '2026-08-25' }),
  ...generated(),
];
