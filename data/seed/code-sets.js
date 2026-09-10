// Seed — code sets. Owner: modules/claima (amendment 26).
//
// Two catalogues a coder picks from: ICD-10 diagnoses and a procedure list in
// the CPT shape a Lebanese payer accepts on a claim. Static shared data, the
// way data/seed/reference.js is — nothing in the demo edits a code, so no store
// table holds them and the repository reads straight from here.
//
// A code carries what the sanity checks read: the sex it is valid for and the
// age band it makes sense in. Both are null when the code has no such rule.
//
// Twenty-odd of each are written out because the seeded charts and the demo's
// searches land on them; the rest are families combined with a short list of
// fourth-character modifiers, so the catalogue is ~150 diagnoses and ~60
// procedures without a wall of literals.

/** [code, description, sex, ageMin, ageMax] */
const ICD_HAND = [
  ['I10', 'Essential (primary) hypertension'],
  ['E11.9', 'Type 2 diabetes mellitus without complications'],
  ['E11.65', 'Type 2 diabetes mellitus with hyperglycaemia'],
  ['E78.5', 'Hyperlipidaemia, unspecified'],
  ['I50.9', 'Heart failure, unspecified'],
  ['I50.21', 'Acute systolic (congestive) heart failure'],
  ['I50.23', 'Acute on chronic systolic (congestive) heart failure'],
  ['I21.9', 'Acute myocardial infarction, unspecified'],
  ['I25.10', 'Atherosclerotic heart disease of native coronary artery without angina pectoris'],
  ['J18.9', 'Pneumonia, unspecified organism'],
  ['J15.9', 'Unspecified bacterial pneumonia'],
  ['J96.01', 'Acute respiratory failure with hypoxia'],
  ['J44.1', 'Chronic obstructive pulmonary disease with (acute) exacerbation'],
  ['K35.80', 'Unspecified acute appendicitis'],
  ['K80.20', 'Calculus of gallbladder without cholecystitis without obstruction'],
  ['N39.0', 'Urinary tract infection, site not specified'],
  ['N18.30', 'Chronic kidney disease, stage 3 unspecified'],
  ['R07.9', 'Chest pain, unspecified'],
  ['R07.89', 'Other chest pain'],
  ['R55', 'Syncope and collapse'],
  ['I95.1', 'Orthostatic hypotension'],
  ['L03.116', 'Cellulitis of left lower limb'],
  ['L03.115', 'Cellulitis of right lower limb'],
  ['C34.90', 'Malignant neoplasm of unspecified part of unspecified bronchus or lung'],
  ['C50.919', 'Malignant neoplasm of unspecified site of unspecified female breast', 'F'],
  ['C61', 'Malignant neoplasm of prostate', 'M', 18],
  ['N40.0', 'Benign prostatic hyperplasia without lower urinary tract symptoms', 'M', 18],
  ['O80', 'Encounter for full-term uncomplicated delivery', 'F', 12, 55],
  ['Z38.00', 'Single liveborn infant, delivered vaginally', null, 0, 0],
  ['S72.001A', 'Fracture of unspecified part of neck of right femur, initial encounter for closed fracture'],
  ['M17.11', 'Unilateral primary osteoarthritis, right knee'],
  ['D64.9', 'Anaemia, unspecified'],
  ['E86.0', 'Dehydration'],
  ['A09', 'Infectious gastroenteritis and colitis, unspecified'],
  ['Z00.00', 'Encounter for general adult medical examination without abnormal findings', null, 18],
];

/** [root, description, kind, sex, ageMin, ageMax] — combined with MODS[kind]. */
const ICD_FAMILIES = [
  ['A41', 'Sepsis', 'organism'],
  ['B34', 'Viral infection of unspecified site', 'organism'],
  ['E03', 'Hypothyroidism', 'disease'],
  ['E66', 'Overweight and obesity', 'disease'],
  ['E87', 'Disorders of fluid, electrolyte and acid-base balance', 'disease'],
  ['F32', 'Depressive episode', 'disease'],
  ['G40', 'Epilepsy', 'disease'],
  ['G43', 'Migraine', 'disease'],
  ['H66', 'Suppurative otitis media', 'disease'],
  ['I48', 'Atrial fibrillation and flutter', 'disease'],
  ['I63', 'Cerebral infarction', 'disease'],
  ['I83', 'Varicose veins of lower extremities', 'disease'],
  ['J01', 'Acute sinusitis', 'disease'],
  ['J20', 'Acute bronchitis', 'organism'],
  ['J45', 'Asthma', 'disease'],
  ['K21', 'Gastro-oesophageal reflux disease', 'disease'],
  ['K29', 'Gastritis and duodenitis', 'disease'],
  ['K40', 'Inguinal hernia', 'disease'],
  ['K57', 'Diverticular disease of intestine', 'disease'],
  ['K81', 'Cholecystitis', 'disease'],
  ['L02', 'Cutaneous abscess, furuncle and carbuncle', 'disease'],
  ['M25', 'Other joint disorder', 'disease'],
  ['M54', 'Dorsalgia', 'disease'],
  ['N20', 'Calculus of kidney and ureter', 'disease'],
  ['N92', 'Excessive, frequent and irregular menstruation', 'disease', 'F', 10, 60],
  ['O21', 'Excessive vomiting in pregnancy', 'disease', 'F', 12, 55],
  ['O34', 'Maternal care for abnormality of pelvic organs', 'disease', 'F', 12, 55],
  ['P59', 'Neonatal jaundice', 'disease', null, 0, 0],
  ['P07', 'Disorders related to short gestation and low birth weight', 'disease', null, 0, 0],
  ['R10', 'Abdominal and pelvic pain', 'disease'],
  ['R50', 'Fever of other and unknown origin', 'disease'],
  ['S52', 'Fracture of forearm', 'injury'],
  ['S82', 'Fracture of lower leg', 'injury'],
  ['T78', 'Adverse effects, not elsewhere classified', 'disease'],
  ['Z01', 'Encounter for other special examination', 'encounter'],
];

const MODS = {
  disease: [['0', 'acute'], ['1', 'chronic'], ['8', 'other specified'], ['9', 'unspecified']],
  organism: [['0', 'due to streptococcus'], ['1', 'due to staphylococcus'], ['8', 'due to other specified organism'], ['9', 'unspecified organism']],
  injury: [['0', 'closed, initial encounter'], ['1', 'open, initial encounter'], ['2', 'subsequent encounter'], ['9', 'unspecified']],
  encounter: [['0', 'without abnormal findings'], ['1', 'with abnormal findings'], ['8', 'other']],
};

/** [code, description, category, sex, ageMin, ageMax] — category is the CDM's. */
const PROC_HAND = [
  ['99213', 'Office or outpatient visit, established patient, low complexity', 'Consultation'],
  ['99223', 'Initial hospital inpatient care, high complexity', 'Consultation'],
  ['99285', 'Emergency department visit, high complexity', 'Consultation'],
  ['71046', 'Radiologic examination, chest, 2 views', 'Radiology'],
  ['71260', 'Computed tomography, thorax, with contrast', 'Radiology'],
  ['70551', 'Magnetic resonance imaging, brain, without contrast', 'Radiology'],
  ['76700', 'Ultrasound, abdominal, complete', 'Radiology'],
  ['77067', 'Screening mammography, bilateral', 'Radiology', 'F', 30],
  ['93970', 'Duplex scan of extremity veins, complete bilateral', 'Radiology'],
  ['93000', 'Electrocardiogram, routine, with interpretation and report', 'Procedure'],
  ['93306', 'Transthoracic echocardiography, complete, with Doppler', 'Procedure'],
  ['36415', 'Collection of venous blood by venipuncture', 'Lab'],
  ['85025', 'Complete blood count with differential', 'Lab'],
  ['80061', 'Lipid panel', 'Lab'],
  ['44970', 'Laparoscopy, surgical, appendectomy', 'Surgery'],
  ['47562', 'Laparoscopy, surgical, cholecystectomy', 'Surgery'],
  ['43239', 'Oesophagogastroduodenoscopy with biopsy', 'Surgery'],
  ['66984', 'Extracapsular cataract removal with insertion of intraocular lens', 'Surgery'],
  ['59510', 'Routine obstetric care including caesarean delivery', 'Surgery', 'F', 12, 55],
  ['59400', 'Routine obstetric care including vaginal delivery', 'Surgery', 'F', 12, 55],
  ['27130', 'Arthroplasty, acetabular and proximal femoral (total hip)', 'Surgery'],
  ['27447', 'Arthroplasty, knee, condyle and plateau (total knee)', 'Surgery'],
  ['55866', 'Laparoscopic radical prostatectomy', 'Surgery', 'M', 18],
  ['12001', 'Simple repair of superficial wounds, 2.5 cm or less', 'Procedure'],
  ['94640', 'Inhalation treatment for airway obstruction, nebuliser', 'Procedure'],
  ['36000', 'Introduction of needle or intracatheter, vein', 'Procedure'],
  ['97110', 'Therapeutic exercises, each 15 minutes', 'Procedure'],
];

const SITES = ['knee', 'shoulder', 'hip', 'wrist', 'ankle', 'elbow'];
const OPS = [
  [29800, 'Arthroscopy, diagnostic', 'Surgery'],
  [25500, 'Closed treatment of fracture, without manipulation', 'Procedure'],
  [20600, 'Arthrocentesis, aspiration or injection', 'Procedure'],
];
const MODALITIES = [[72100, 'Radiologic examination'], [72125, 'Computed tomography'], [72141, 'Magnetic resonance imaging'], [76800, 'Ultrasound']];
const REGIONS = ['abdomen', 'pelvis', 'cervical spine', 'lumbar spine', 'shoulder'];

const entry = (code, desc, extra = {}) => ({ code, desc, sex: null, ageMin: null, ageMax: null, ...extra });

export function buildIcd() {
  const rows = ICD_HAND.map(([code, desc, sex = null, ageMin = null, ageMax = null]) =>
    entry(code, desc, { sex, ageMin, ageMax, chapter: code[0] }));
  for (const [root, desc, kind, sex = null, ageMin = null, ageMax = null] of ICD_FAMILIES) {
    for (const [suffix, mod] of MODS[kind]) {
      rows.push(entry(`${root}.${suffix}`, `${desc}, ${mod}`, { sex, ageMin, ageMax, chapter: root[0] }));
    }
  }
  return rows;
}

export function buildProc() {
  const rows = PROC_HAND.map(([code, desc, category, sex = null, ageMin = null, ageMax = null]) =>
    entry(code, desc, { category, sex, ageMin, ageMax }));
  OPS.forEach(([base, op, category]) => {
    SITES.forEach((site, i) => rows.push(entry(String(base + i), `${op}, ${site}`, { category })));
  });
  MODALITIES.forEach(([base, modality]) => {
    REGIONS.forEach((region, i) => rows.push(entry(String(base + i), `${modality}, ${region}`, { category: 'Radiology' })));
  });
  return rows;
}
