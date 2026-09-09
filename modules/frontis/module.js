// Module manifest — Frontis, patient access and eligibility.
// Owns the `patients` and `duplicates` entities (data/repositories/): the MRN
// registry every downstream workflow hangs off, and the potential-duplicate
// pairs waiting for a decision. Other modules read patients through the
// repository and reference the MRN.

import * as patients from '../../data/repositories/patients.js';

export default {
  id: 'frontis',
  name: 'Frontis',
  group: 'Patient access',
  icon: 'badge',

  nav: [
    {
      // The badge counts the rows the list holds: merged records are folded
      // into the survivor and are out of the register.
      screen: 'patients',
      label: 'Patients',
      icon: 'groups',
      count: () => patients.counts().total,
    },
  ],

  // One screen, seven routes: the list at #/frontis/patients hands the mount
  // over to the register form, the record page, the duplicates worklist, the
  // merge screen and the importer on its deeper paths.
  routes: {
    patients: () => import('./features/patient-master/patient-list.js'),
  },
};
