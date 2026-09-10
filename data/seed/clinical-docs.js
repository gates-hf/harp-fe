// Seed — clinical documents. Owner: modules/claima (amendment 26).
//
// The evidence a coder codes from: eight documents over the five charts the
// coding seed works, each with the text a coder actually reads — the discharge
// summary that names the diagnosis, the imaging report that says with or
// without contrast, the note that documents the oxygen but not the failure.
//
// A document hangs off an encounter, and the register hands the numbers out,
// so a chart is found by who it was for and what kind of visit it was rather
// than by a number written here. data/store.js does not import this file: it
// reads the encounter board to exist, and data/repositories/clinical-docs.js
// builds on first read of an empty table — the shape data/seed/claims.js uses.

import * as encounters from '../repositories/encounters.js';
import { doctorName } from './reference.js';

/**
 * The closed visit a seeded chart is about: this patient, this kind of visit,
 * this department, the most recent one that has been billed. Shared with the
 * coding seed so both land on the same encounter.
 */
export function pickEncounter(mrn, type, department) {
  return encounters.all()
    .filter((e) => e.patientMrn === mrn && e.type === type && e.department === department
      && ['Discharged', 'Completed'].includes(e.status) && e.chargesPosted)
    .sort((a, b) => String(b.endAt).localeCompare(String(a.endAt)))[0] || null;
}

/** The five charts the documents and the coding seed share. */
export const CHARTS = {
  heartFailure: ['MRN-000102', 'IP', 'Internal Medicine'],
  pneumonia: ['MRN-000105', 'IP', 'General Surgery'],
  ctChest: ['MRN-000108', 'OP', 'Cardiology'],
  chestPainEr: ['MRN-000101', 'ER', 'Oncology'],
  collapse: ['MRN-000131', 'IP', 'Internal Medicine'],
  collapseOrtho: ['MRN-000147', 'IP', 'Orthopaedics'],
};

/** [chart, type, title, dayOffset from the visit's end, text] */
const DOCS = [
  ['heartFailure', 'Discharge Summary', 'Discharge summary — decompensated heart failure', 0,
    `Presenting complaint: three days of worsening exertional dyspnoea, orthopnoea and bilateral ankle swelling.

Background: hypertension on amlodipine, type 2 diabetes on metformin. No prior admission for heart failure.

Course: admitted with pulmonary oedema on chest film and NT-proBNP 4,120 pg/mL. Treated with intravenous furosemide 40 mg twice daily; 3.8 kg negative balance over the stay. Transthoracic echocardiogram on day 2 reported a dilated left ventricle with an ejection fraction of 30%. Renal function stable, creatinine 98 µmol/L at discharge.

Diagnosis at discharge: acute decompensated heart failure with reduced ejection fraction. Hypertension. Type 2 diabetes mellitus.

Plan: bisoprolol 2.5 mg, ramipril 2.5 mg, furosemide 40 mg daily. Cardiology clinic in two weeks.`],
  ['heartFailure', 'Progress Note', 'Day 2 progress note', -1,
    `Overnight: slept with two pillows, no chest pain. Urine output 2.4 L on intravenous furosemide.

Examination: SpO2 95% on 2 L, bibasal crackles reduced, JVP 4 cm. Weight 82.1 kg (admission 84.6 kg).

Echocardiogram performed this morning; formal report awaited — sonographer estimates EF around 30%.

Plan: continue diuresis, start bisoprolol tomorrow if heart rate allows, repeat U&E.`],
  ['heartFailure', 'Lab Report', 'Laboratory report — admission bloods', -3,
    `Complete blood count: Hb 13.1 g/dL, WBC 8.4, platelets 231.
Renal profile: sodium 137, potassium 4.4, urea 7.9, creatinine 104 µmol/L, eGFR 71.
NT-proBNP: 4,120 pg/mL (reference < 300).
Troponin I: 0.02 ng/mL (negative).
HbA1c: 7.4%.`],
  ['pneumonia', 'Discharge Summary', 'Discharge summary — community-acquired pneumonia', 0,
    `Presenting complaint: four days of productive cough, fever to 39.2 °C and right-sided pleuritic pain.

On arrival: temperature 38.9 °C, respiratory rate 28, SpO2 88% on room air, rising to 94% on 4 L oxygen by nasal cannula. CRP 212 mg/L, WBC 16.8.

Imaging: right lower lobe consolidation, no effusion.

Course: intravenous ceftriaxone and oral clarithromycin for five days. Oxygen weaned by day 3. Blood cultures no growth; sputum culture normal flora. Surgical review requested for pleuritic pain — no empyema.

Diagnosis at discharge: right lower lobe pneumonia, organism not identified. Marked respiratory distress on admission.

Plan: oral amoxicillin-clavulanate to complete seven days. Repeat chest film in six weeks.`],
  ['pneumonia', 'Imaging Report', 'Chest radiograph — PA and lateral', -3,
    `Clinical details: cough, fever, hypoxia.

Findings: dense consolidation in the right lower lobe with air bronchograms. No pleural effusion. Heart size normal. Left lung clear.

Impression: right lower lobe pneumonia. Follow-up film after treatment to confirm resolution.`],
  ['ctChest', 'Imaging Report', 'CT thorax with intravenous contrast', 0,
    `Clinical details: atypical chest pain, D-dimer raised. Query pulmonary embolism.

Technique: CT pulmonary angiogram after 80 mL intravenous iodinated contrast.

Findings: no filling defect in the pulmonary arteries to segmental level. No consolidation, no effusion. Mild coronary calcification. No mediastinal lymphadenopathy.

Impression: no pulmonary embolism. Contrast study adequate.`],
  ['chestPainEr', 'Progress Note', 'Emergency department note', 0,
    `Triage: 48-year-old man, known non-small-cell carcinoma of the right lung under oncology, presenting with central chest pain for two hours.

Examination: haemodynamically stable, SpO2 96% on air, chest clear. ECG sinus rhythm, no acute change. Troponin negative at 0 and 3 hours.

Chest film: known right upper lobe mass, no pneumothorax, no new consolidation.

Impression: chest pain, non-cardiac, in a patient with lung carcinoma. Analgesia given (paracetamol 1 g intravenous ×2). Discharged to oncology follow-up.`],
  ['collapse', 'Discharge Summary', 'Discharge summary — collapse at home', 0,
    `Presenting complaint: collapsed on standing from bed, brief loss of consciousness, no injury.

Examination: lying blood pressure 148/88, standing 112/70 at one minute — a 36 mmHg systolic drop with symptoms reproduced. ECG sinus rhythm, no conduction defect. Telemetry overnight unremarkable.

Background: hypertension on three agents, hyperlipidaemia.

Diagnosis at discharge: orthostatic hypotension causing syncope, attributed to antihypertensive therapy.

Plan: doxazosin stopped, amlodipine reduced. Review in clinic in four weeks.`],
];

export function buildClinicalDocs() {
  const rows = [];
  let n = 0;
  for (const [chart, type, title, offset, text] of DOCS) {
    const enc = pickEncounter(...CHARTS[chart]);
    if (!enc) continue;
    const at = new Date(Date.parse(enc.endAt || enc.startAt) + offset * 86400000);
    n += 1;
    rows.push({
      id: `DOC-${String(n).padStart(4, '0')}`,
      encounterNo: enc.no,
      patientMrn: enc.patientMrn,
      type,
      title,
      fileName: `${enc.no}-${type.toLowerCase().replace(/\s+/g, '-')}.pdf`,
      date: at.toISOString().slice(0, 10),
      author: doctorName(enc.doctorId),
      authorId: enc.doctorId,
      textPreview: text,
    });
  }
  return rows;
}
