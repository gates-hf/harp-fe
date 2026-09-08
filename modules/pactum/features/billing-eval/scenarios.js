// Three canned encounters the simulator can load, each written against the
// seeded contracts so it fires something worth reading. Every scenario is a
// function: charge lines name CDM rows by charge code and resolve to ids when
// it is loaded, so a reset of the demo data never leaves a stale id behind.
//
// `name` is short because it labels an option in the panel header's dropdown;
// `hint` is the sentence the screen prints under it.

import * as cdm from '../../../../data/repositories/cdm.js';
import * as contracts from '../../../../data/repositories/contracts.js';

const id = (code) => cdm.getByCode(code)?.id || code;

export const SCENARIOS = [
  {
    id: 'outpatient-labs',
    name: 'Outpatient labs',
    hint: 'NSSF first class — the lab fee schedule prices three lines, and the consumables rule takes one off the bill.',
    build: () => ({
      payerId: 'PY-0001',
      planId: 'PL-0001',
      patient: { age: 34, gender: 'Female', nationality: 'Lebanese' },
      encounter: {
        dateOfService: contracts.today(),
        admissionType: 'Day Case',
        department: 'Outpatient clinic',
        lengthOfStay: 0,
        diagnosisCode: 'E11.9',
      },
      lines: [
        { itemId: id('LAB-0001'), qty: 3 },
        { itemId: id('LAB-0002'), qty: 1 },
        { itemId: id('CNS-0001'), qty: 2 },
      ],
    }),
  },

  {
    id: 'appendectomy-overage',
    name: 'Package with an overrun',
    hint: 'Three nights past the two the package covers and $150 over the consumables allowance — one component absorbed, one billed to the payer, one split.',
    build: () => ({
      payerId: 'PY-0001',
      planId: 'PL-0001',
      patient: { age: 41, gender: 'Male', nationality: 'Lebanese' },
      encounter: {
        dateOfService: contracts.today(),
        admissionType: 'Elective',
        department: 'Surgery',
        lengthOfStay: 5,
        diagnosisCode: 'K35.80',
      },
      lines: [
        {
          itemId: id('PKG-APP-001'),
          qty: 1,
          consumption: [
            { componentId: id('RNB-0001'), qty: 5 },
            { componentId: id('CNS-0002'), amount: 210 },
            { componentId: id('PHA-0002'), amount: 126 },
          ],
        },
      ],
    }),
  },

  {
    id: 'emergency-imaging',
    name: 'Emergency imaging, 2025',
    hint: 'A date of service in 2025 prices through version 1 of the agreement; the CT clears the radiology threshold and the length-of-stay rule holds the whole encounter.',
    build: () => ({
      payerId: 'PY-0001',
      planId: 'PL-0001',
      patient: { age: 58, gender: 'Male', nationality: 'Lebanese' },
      encounter: {
        dateOfService: '2025-11-20',
        admissionType: 'Emergency',
        department: 'Emergency',
        lengthOfStay: 7,
        diagnosisCode: 'J18.9',
      },
      lines: [
        { itemId: id('RAD-0001'), qty: 1 },
        { itemId: id('RAD-0003'), qty: 1 },
        { itemId: id('RNB-0001'), qty: 7 },
      ],
    }),
  },
];

export const scenarioById = (scenarioId) => SCENARIOS.find((s) => s.id === scenarioId) || null;
