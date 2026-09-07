// Seed — cdm (Charge Description Master). One collection holds everything the
// hospital can sell: items and bundles. A bundle is a CDM row with
// kind:"bundle", category "Bundle" and a price of its own, so it lists, sells
// and nests beside the items it groups.
//
// Ten items are written out; the rest are short lists combined by category, so
// the file stays readable. Bundles reference their components by charge code
// and the builder below resolves those to ids.

const rows = [];
const byCode = new Map();
let seq = 0;

/** Items whose price or wording carries the demo. */
const HAND_WRITTEN = [
  ['CON-0001', 'General practitioner consultation', 'Consultation', 'Each', 25],
  ['CON-0002', 'Specialist consultation', 'Consultation', 'Each', 45],
  ['LAB-0001', 'Complete blood count (CBC)', 'Lab', 'Test', 12.5],
  ['LAB-0002', 'Lipid profile', 'Lab', 'Test', 22],
  ['RAD-0001', 'MRI brain, without contrast', 'Radiology', 'Each', 320],
  ['RAD-0002', 'Chest X-ray, two views', 'Radiology', 'Each', 28],
  ['RAD-0003', 'CT chest with contrast', 'Radiology', 'Each', 450],
  ['RNB-0001', 'Private room, per night', 'Room & Board', 'Night', 180],
  ['PRF-0001', 'Surgeon time, per hour', 'Professional Fee', 'Hour', 250],
  ['PHA-0001', 'Paracetamol 1g IV infusion', 'Pharmacy', 'Unit', 4.75],
  ['CNS-0001', 'Sterile surgical gown', 'Consumables', 'Each', 6.2],
];

/** The rest: one short list per category, priced from a base and a step. */
const GROUPS = [
  { prefix: 'LAB', category: 'Lab', uom: 'Test', base: 9.5, step: 4.5, names: [
    'Urea and electrolytes', 'Creatinine', 'HbA1c', 'Thyroid panel (TSH, T3, T4)',
    'Vitamin D 25-OH', 'Troponin I'] },
  { prefix: 'RAD', category: 'Radiology', uom: 'Each', base: 65, step: 45, names: [
    'Abdominal ultrasound', 'Mammography, bilateral', 'Doppler, lower limb'] },
  { prefix: 'PRC', category: 'Procedure', uom: 'Session', base: 18, step: 14, names: [
    'Wound dressing', 'Nebulisation session', 'IV cannulation', 'Physiotherapy session'] },
  { prefix: 'SUR', category: 'Surgery', uom: 'Each', base: 420, step: 165, names: [
    'Upper GI endoscopy', 'Cataract phacoemulsification', 'Appendectomy, laparoscopic', 'Caesarean section'] },
  { prefix: 'RNB', category: 'Room & Board', uom: 'Night', base: 70, step: 165, names: [
    'Shared room, per night', 'Nursery bassinet, per night', 'Intensive care unit, per night'] },
  { prefix: 'PHA', category: 'Pharmacy', uom: 'Unit', base: 3.4, step: 2.8, names: [
    'Ceftriaxone 1g vial', 'Ondansetron 4mg ampoule', 'Normal saline 500ml'] },
  { prefix: 'CNS', category: 'Consumables', uom: 'Each', base: 2.4, step: 3.6, names: [
    'Suture pack, absorbable', 'Surgical gloves, pair', 'Endoscope biopsy forceps, single use'] },
  { prefix: 'PRF', category: 'Professional Fee', uom: 'Hour', base: 95, step: 45, names: [
    'Nursing care, per hour', 'Anaesthetist time, per hour'] },
  { prefix: 'NCL', category: 'Non-Clinical', uom: 'Each', base: 9, step: 46, names: [
    'Medical report copy', 'Ambulance transfer, within Beirut'] },
  { prefix: 'CON', category: 'Consultation', uom: 'Session', base: 30, step: 12, names: [
    'Dietitian session', 'Physiotherapy assessment'] },
];

/** Retired lines the demo needs: one of them still sits inside a bundle. */
const INACTIVE = new Set(['CNS-0004', 'NCL-0002', 'RAD-0006']);

// A spread of 2026 timestamps, deterministic so every reset looks the same.
function stamp(n) {
  const pad = (v) => String(v).padStart(2, '0');
  return `2026-${pad(((n * 5) % 8) + 1)}-${pad(((n * 7) % 27) + 1)}T${pad(8 + (n % 9))}:${pad((n * 13) % 60)}:00`;
}

const nextId = () => `CDM-${String(++seq).padStart(4, '0')}`;

function item(chargeCode, descriptionEn, category, uom, standardPrice) {
  const row = {
    id: nextId(),
    chargeCode,
    descriptionEn,
    category,
    uom,
    standardPrice: Math.round(standardPrice * 100) / 100,
    status: INACTIVE.has(chargeCode) ? 'Inactive' : 'Active',
    updatedAt: stamp(seq),
    kind: 'item',
  };
  rows.push(row);
  byCode.set(chargeCode, row);
  return row;
}

/**
 * components: [[chargeCode, qty, limit?], …]. A component carries the limit the
 * bundle price covers: by default the quantity itself, or `{ allowance }` for a
 * money allowance — anything past it is overage, priced by the contract.
 * extra carries validity, the review flag and anything else only some bundles have.
 */
function bundle(chargeCode, name, bundleType, standardPrice, components, extra = {}) {
  const row = {
    id: nextId(),
    chargeCode,
    descriptionEn: name,
    name,
    category: 'Bundle',
    uom: 'Package',
    standardPrice,
    status: 'Active',
    updatedAt: stamp(seq),
    kind: 'bundle',
    bundleType,
    components: components.map(([code, qty, limit]) => ({
      refId: byCode.get(code).id,
      qty,
      limitType: limit?.allowance ? 'Amount Allowance' : 'Quantity',
      limitQty: limit?.allowance ? 0 : limit?.qty ?? qty,
      limitAmount: limit?.allowance || 0,
    })),
    validFrom: '',
    validTo: '',
    flaggedForReview: false,
    flagReason: '',
    ...extra,
  };
  rows.push(row);
  byCode.set(chargeCode, row);
  return row;
}

for (const [code, description, category, uom, price] of HAND_WRITTEN) {
  item(code, description, category, uom, price);
}

for (const group of GROUPS) {
  const used = rows.filter((r) => r.chargeCode.startsWith(`${group.prefix}-`)).length;
  group.names.forEach((name, i) => {
    item(
      `${group.prefix}-${String(used + i + 1).padStart(4, '0')}`,
      name,
      group.category,
      group.uom,
      group.base + i * group.step,
    );
  });
}

// --- bundles ----------------------------------------------------------------

bundle('PKG-APP-001', 'Appendectomy Package', 'Procedure', 1450, [
  ['SUR-0003', 1], ['PRF-0001', 2], ['PRF-0003', 2], ['RNB-0001', 2],
  ['CNS-0002', 2, { allowance: 60 }], ['PHA-0002', 3, { allowance: 120 }], ['LAB-0001', 1],
]);

bundle('PKG-DEL-002', 'Normal Delivery Package', 'Procedure', 1180, [
  ['PRF-0001', 3], ['PRF-0002', 6], ['RNB-0001', 2, { qty: 3 }], ['RNB-0003', 2],
  ['LAB-0001', 1], ['PHA-0004', 2, { allowance: 80 }],
]);

bundle('PKG-CAT-003', 'Cataract Surgery Package', 'Procedure', 890, [
  ['SUR-0002', 1], ['PRF-0001', 1], ['PRF-0003', 1], ['PHA-0003', 1, { allowance: 45 }],
  ['CNS-0003', 2], ['CON-0002', 1, { qty: 2 }],
]);

bundle('PRM-BLD-004', 'Blood Panel Offer', 'Promotional', 39, [
  ['LAB-0001', 1], ['LAB-0002', 1], ['LAB-0005', 1], ['LAB-0003', 1],
], { validFrom: '2026-06-01', validTo: '2026-12-31' });

bundle('PRM-CRD-005', 'Cardiac Screening Offer', 'Promotional', 149, [
  ['CON-0002', 1], ['LAB-0008', 1], ['LAB-0002', 1], ['RAD-0002', 1],
], { validFrom: '2026-05-01', validTo: '2026-11-30' });

// Nests the two offers above beside a consultation — the demo's nesting case.
bundle('PRM-CHK-006', 'Full Check-Up Offer', 'Promotional', 249, [
  ['PRM-BLD-004', 1], ['PRM-CRD-005', 1], ['CON-0001', 1],
], { validFrom: '2026-07-01', validTo: '2026-12-31' });

// Seeded Active with a validity that has passed: expireBundles() retires it on
// the first load, so the demo shows the rule working rather than its result.
bundle('PRM-RMD-007', 'Ramadan Wellness Offer', 'Promotional', 89, [
  ['CON-0003', 1], ['LAB-0007', 1], ['LAB-0001', 1],
], { validFrom: '2026-02-01', validTo: '2026-04-15' });

bundle('PKG-END-008', 'Endoscopy Package', 'Procedure', 640, [
  ['SUR-0001', 1], ['PRF-0003', 1], ['CNS-0004', 1], ['PHA-0003', 1, { allowance: 35 }], ['RNB-0002', 1],
], { flaggedForReview: true, flagReason: 'Component CNS-0004 deactivated' });

export const cdm = rows;
