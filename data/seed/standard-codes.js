// Seed — standard codes. Owner: modules/pactum (amendment 44).
//
// The codes of every seeded code-system version, one row per code per
// version. The ICD-10-CM 2026 and Procedures 2026 lists are the exact entries
// amendment 26 wrote for the coder's catalogues — moved here verbatim, lists
// and modifiers alike, so data/seed/code-sets.js is a thin re-export over this
// register and nothing Claima imported changes shape.
//
// Beside the migration: the 2025 ICD-10-CM release with three codes, one of
// which reads differently from 2026 (J18.9), so a lookup dated last year
// visibly resolves to another display; six HCPCS Level II codes; and three
// LOINC codes on a version nobody made current, which is what the landing's
// "No current version" card and the lookup's fallback warning are for.
//
// A code carries what the coder's sanity checks read — the sex it is valid for
// and the age band it makes sense in — under `attributes`, beside the CDM
// category a procedure code links a charge line by. Null when the code has no
// such rule.
//
// One entity, one seed file: over the line cap on purpose.

// --- ICD-10-CM, as amendment 26 wrote it ---------------------------------------

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

// --- Procedures, as amendment 26 wrote them ------------------------------------

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

// --- the hand-written rest --------------------------------------------------------

/** The 2025 release: three codes, J18.9 reading as it did before the 2026 revision. */
const ICD_2025 = [
  ['I10', 'Essential (primary) hypertension'],
  ['J18.9', 'Pneumonia, unspecified'],
  ['I50.9', 'Heart failure, unspecified'],
];

/** [code, display, category] — supplies and drugs a claim carries beside the procedures. */
const HCPCS = [
  ['A4550', 'Surgical trays', 'Consumables'],
  ['E0114', 'Crutches, underarm, aluminium, pair', 'Consumables'],
  ['J1100', 'Injection, dexamethasone sodium phosphate, 1 mg', 'Pharmacy'],
  ['J7030', 'Infusion, normal saline solution, 1,000 cc', 'Pharmacy'],
  ['L3670', 'Shoulder orthosis, acromio/clavicular, prefabricated', 'Consumables'],
  ['G0463', 'Hospital outpatient clinic visit for assessment and management', 'Consultation'],
];

/** [code, display] — on the version the laboratory never renewed. */
const LOINC = [
  ['2345-7', 'Glucose [Mass/volume] in Serum or Plasma'],
  ['718-7', 'Hemoglobin [Mass/volume] in Blood'],
  ['2160-0', 'Creatinine [Mass/volume] in Serum or Plasma'],
];

// --- assembly ---------------------------------------------------------------------

const attrs = (extra = {}) => ({ sex: null, ageMin: null, ageMax: null, category: null, chapter: null, ...extra });

function icdRows() {
  const rows = ICD_HAND.map(([code, display, sex = null, ageMin = null, ageMax = null]) =>
    [code, display, attrs({ sex, ageMin, ageMax, chapter: code[0] })]);
  for (const [root, desc, kind, sex = null, ageMin = null, ageMax = null] of ICD_FAMILIES) {
    for (const [suffix, mod] of MODS[kind]) {
      rows.push([`${root}.${suffix}`, `${desc}, ${mod}`, attrs({ sex, ageMin, ageMax, chapter: root[0] })]);
    }
  }
  return rows;
}

function procRows() {
  const rows = PROC_HAND.map(([code, display, category, sex = null, ageMin = null, ageMax = null]) =>
    [code, display, attrs({ category, sex, ageMin, ageMax })]);
  OPS.forEach(([base, op, category]) => {
    SITES.forEach((site, i) => rows.push([String(base + i), `${op}, ${site}`, attrs({ category })]));
  });
  MODALITIES.forEach(([base, modality]) => {
    REGIONS.forEach((region, i) => rows.push([String(base + i), `${modality}, ${region}`, attrs({ category: 'Radiology' })]));
  });
  return rows;
}

/** Version id → [validFrom, loadedAt, rows]. The ids are data/seed/code-system-versions.js's. */
const BY_VERSION = [
  ['CSV-0001', '2025-01-01', '2024-12-02T10:20:00', ICD_2025.map(([code, display]) => [code, display, attrs({ chapter: code[0] })])],
  ['CSV-0002', '2026-01-01', '2025-12-15T14:05:00', icdRows()],
  ['CSV-0003', '2026-01-01', '2025-12-15T15:10:00', procRows()],
  ['CSV-0004', '2026-01-01', '2026-01-05T11:30:00', HCPCS.map(([code, display, category]) => [code, display, attrs({ category })])],
  ['CSV-0005', '2025-01-01', '2025-01-10T09:45:00', LOINC.map(([code, display]) => [code, display, attrs({ category: 'Lab' })])],
];

function build() {
  const out = [];
  let n = 0;
  for (const [versionId, validFrom, at, rows] of BY_VERSION) {
    for (const [code, display, attributes] of rows) {
      n += 1;
      out.push({
        id: `SC-${String(n).padStart(6, '0')}`,
        codeSystemVersionId: versionId,
        code,
        display,
        status: 'Active',
        validFrom,
        attributes,
        createdAt: at,
        updatedAt: at,
      });
    }
  }
  return out;
}

export const standardCodes = build();

/** Codes per seeded version — what the seeded trail names. */
export const seededCount = (versionId) => standardCodes.filter((row) => row.codeSystemVersionId === versionId).length;
